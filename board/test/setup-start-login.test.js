// 처음 설정 «AI 로 설치 마무리» — 목록이 «로그인 ✔» 이면 시작도 로그인된 것으로 본다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { port: 8801 }, projects: [{ key: 'server', name: 'Server', dir: path.join(require('os').tmpdir()), stateFile: 'session-state.md' }] });
test.after(() => sb.cleanup());
fs.writeFileSync(path.join(sb.home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' }, worktree: { bgIsolation: 'none' } }));

let port;
function call(method, p, body) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': 'terminal', host: 'localhost:8801', origin: 'http://localhost:8801', 'content-type': 'application/json' };
    const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok({ code: res.statusCode, j }); });
    });
    r.on('error', no); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

test('처음 설정 시작: 로그인 안 됨이면 NOT_LOGGED_IN · 로그인 됨이면(목록 ✔) 시작됨', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    process.env.FAKE_LOGGED_IN = '0';
    const no = await call('POST', '/api/setup/start', {});
    assert.equal(no.code, 409, JSON.stringify(no.j));
    assert.equal(no.j.code, 'NOT_LOGGED_IN');

    process.env.FAKE_LOGGED_IN = '1';
    const yes = await call('POST', '/api/setup/start', {});
    const login = (board.setupBoard(board.loadState(), []).items || []).find((x) => x.key === 'login');
    assert.equal(login && login.ok, true, '목록의 로그인 칸 ✔');
    assert.notEqual(yes.j.code, 'NOT_LOGGED_IN', '목록이 ✔ 인데 시작이 «로그인 아직» 으로 막히면 안 됨');
    assert.equal(yes.code, 200, JSON.stringify(yes.j));
    assert.ok((board.loadState().queue || []).some((q) => q.setup), '처음 설정 방이 대기열에');
  } finally { board.server.close(); }
});
