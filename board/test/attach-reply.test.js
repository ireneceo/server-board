// 📎 답하기·방 메시지·할 일 묻기에도 첨부
//   일하는 방에 보낸 답(차례 끝나면 전달)은 대기열에 경로가 남아 정리에서 빠지고, 대기열에서 빠지면 7일 규칙대로 지워진다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
const ROOM = 'c0ffee01';
test.after(() => sb.cleanup());

test('첨부 — 방 답하기·할 일 묻기', async () => {
  const proj = path.join(sb.root, 'proj');
  process.env.FAKE_AGENTS = JSON.stringify([{ id: ROOM, kind: 'background', sessionId: 'bbbb0001-0000-0000-0000-000000000000', cwd: proj, name: '로고 바꾸기', status: 'busy', pid: process.pid, startedAt: 1 }]);
  board.resetAgentsCache();
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const req = (method, p, body, sock, type) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': type || 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { let j = {}; try { j = JSON.parse(d || '{}'); } catch (_) {} ok({ code: r.statusCode, j }); }); });
    pr.on('error', no); pr.end(body);
  });
  const up = (name, buf) => req('POST', '/api/attach?project=demo&name=' + encodeURIComponent(name), buf, 'terminal', 'application/octet-stream');
  try {
    let r = await up('새 로고.svg', Buffer.from('<svg/>'));
    assert.equal(r.code, 200, JSON.stringify(r.j)); const id1 = r.j.att.id;
    const f1 = board.loadState().attach[id1].file;
    // 일하는 방 — 차례 끝나면 전달(대기열에 남긴 말) · 글 없이 첨부만도 됨
    r = await req('POST', '/api/rooms/' + ROOM + '/reply', JSON.stringify({ text: '', when: 'after', atts: [id1] }), 'terminal');
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const q = board.loadState().queue.find((x) => x.note && x.resumeSessionId === 'bbbb0001-0000-0000-0000-000000000000');
    assert.ok(q, '남긴 말이 대기열에');
    const qt = JSON.stringify(q);
    assert.ok(qt.includes('첨부를 봐 주세요'), '글 없으면 기본 말'); assert.ok(qt.includes(f1.replace(/\\/g, '\\\\')), '경로가 답 글에');
    assert.ok(board.loadState().attach[id1].used, '보낸 것으로 표시');
    // «확인» 한 마디 + 첨부는 완료 처리가 아님(일하는 방이라 원래도 아니지만 — 글 검사 우회 확인)
    // 작업방은 못 붙임 · /명령에는 못 붙임 · 없는 번호
    assert.equal((await req('POST', '/api/rooms/' + ROOM + '/reply', JSON.stringify({ text: 'x', when: 'after', atts: [id1] }), 'agent')).code, 403);
    assert.equal((await req('POST', '/api/rooms/' + ROOM + '/reply', JSON.stringify({ text: '/개발완료', when: 'after', atts: [id1] }), 'terminal')).code, 400);
    assert.equal((await req('POST', '/api/rooms/' + ROOM + '/reply', JSON.stringify({ text: 'x', when: 'after', atts: ['anope'] }), 'terminal')).code, 400);
    // 할 일 «💬 묻기·말하기» 에도
    r = await up('오류 화면.png', Buffer.from('89504e470d0a1a0a', 'hex'));
    const id2 = r.j.att.id, f2 = board.loadState().attach[id2].file;
    r = await req('POST', '/api/todos/ask', JSON.stringify({ project: 'demo', stateText: '키 넣기', message: '3번 화면이 이래요', atts: [id2] }), 'terminal');
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.ok(JSON.stringify(board.loadState().queue).includes(f2.replace(/\\/g, '\\\\')), '묻기 글에 경로');
    // 정리 — 대기열에 걸린 동안은 7일 지나도 남김 · 빠지면 지움
    const old = (Date.now() - 8 * 864e5) / 1000;
    fs.utimesSync(f1, old, old); fs.utimesSync(f2, old, old);
    board.attachSweep();
    assert.ok(fs.existsSync(f1) && fs.existsSync(f2), '전달 전 답에 걸린 첨부는 남김');
    const st = board.loadState(); st.queue = []; board.saveState(st);
    board.attachSweep();
    assert.ok(!fs.existsSync(f1) && !fs.existsSync(f2), '7일 지난 것 지움');
  } finally { board.server.close(); delete process.env.FAKE_AGENTS; board.resetAgentsCache(); }
});
