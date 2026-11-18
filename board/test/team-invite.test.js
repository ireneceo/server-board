// ⚙ 팀·권한 «안내문 복사» — 들어오는 길 값(SSH 주소·포트·상황판 포트·서버 이름) · 링크 열린 시각
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { serverName: '시험서버', devSsh: 'ssh -p 2222 ops@203.0.113.10', team: { members: [
  { user: 'kim', name: '김', role: 'member', projects: ['demo'] },
] } } });
test.after(() => sb.cleanup());

let port;
function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok({ code: res.statusCode, j }); });
    });
    r.on('error', no); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

test('팀 칸 — 안내문에 넣을 길 값 · 링크를 만들면 «~시각까지 열림» · 다시 만들면 옛 링크 무효', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const t = await call('GET', '/api/team', 'terminal');
    assert.equal(t.code, 200, JSON.stringify(t.j));
    assert.deepEqual({ host: t.j.route.host, sshPort: t.j.route.sshPort, serverName: t.j.route.serverName }, { host: '203.0.113.10', sshPort: '2222', serverName: '시험서버' });
    assert.equal(typeof t.j.route.port, 'number');
    t.j.accounts.forEach((a) => assert.ok('home' in a, '서버 계정마다 집 폴더(열쇠 넣는 명령용)'));

    let s = await call('GET', '/api/auth/sessions', 'terminal');
    assert.equal(s.j.users.find((u) => u.id === 'kim').inviteExp, null, '링크 만들기 전');
    const a = await call('POST', '/api/auth/invite', 'terminal', { id: 'kim' });
    assert.equal(a.code, 200);
    s = await call('GET', '/api/auth/sessions', 'terminal');
    const exp = s.j.users.find((u) => u.id === 'kim').inviteExp;
    assert.ok(exp > Date.now() + 23 * 3600e3 && exp <= Date.now() + 24 * 3600e3 + 1000, '24시간 뒤까지');
    const b = await call('POST', '/api/auth/invite', 'terminal', { id: 'kim' });
    const tok = (x) => decodeURIComponent(x.j.path.split('reset=')[1]);
    assert.equal(board.auth.peekReset(tok(a)), null, '새 안내문을 만들면 옛 링크는 안 열림');
    assert.ok(board.auth.peekReset(tok(b)));
    // 팀원은 팀 칸을 못 봄
    assert.equal((await call('GET', '/api/team', 'tunnel:kim')).code === 200, false);
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});
