'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());

test('첨부 — 올리기·권한·일 글에 경로·상의 내용·정해진 날 뒤 지움', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const req = (method, p, body, sock, type) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': type || 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { let j = {}; try { j = JSON.parse(d || '{}'); } catch (_) {} ok({ code: r.statusCode, j }); }); });
    pr.on('error', no); pr.end(body);
  });
  const up = (name, buf, sock = 'terminal', proj = 'demo') => req('POST', '/api/attach?project=' + proj + '&name=' + encodeURIComponent(name), buf, sock, 'application/octet-stream');
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c70000000049454e44ae426082', 'hex');
    let r = await up('../../화면 캡처.png', png);
    assert.equal(r.code, 200, JSON.stringify(r.j)); const id1 = r.j.att.id;
    assert.equal(r.j.att.name, '화면 캡처.png', '경로 조각은 버림'); assert.equal(r.j.att.image, true);
    const a1 = board.loadState().attach[id1];
    assert.ok(a1.file.startsWith(path.join(sb.root, 'proj', '.claude', 'attach-tmp') + path.sep), '솔루션 폴더 임시 칸');
    assert.equal(fs.readFileSync(path.join(sb.root, 'proj', '.claude', 'attach-tmp', '.gitignore'), 'utf8').trim().split('\n').pop(), '*', 'git 에 안 섞이게');
    assert.equal((await up('a.exe', Buffer.from('x'))).code, 415, '실행 파일 거절');
    assert.equal((await up('a.png', Buffer.from('x'), 'agent')).code, 403, '작업방은 못 올림');
    assert.equal((await up('a.png', Buffer.from('x'), 'terminal', 'nope')).code, 400);
    assert.equal((await up('empty.txt', Buffer.alloc(0))).code, 400);
    r = await up('메모.txt', Buffer.from('주문번호 123'));
    const id2 = r.j.att.id;
    // 일 시키기 — 끝에 경로 목록
    r = await req('POST', '/api/rooms', JSON.stringify({ project: 'demo', queue: true, task: '이 화면 고쳐 줘', atts: [id1, id2], name: 't' }), 'terminal');
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const q = board.loadState().queue.find((x) => x.title === 't');
    assert.match(q.task, /^이 화면 고쳐 줘\n\n\[📎 첨부 2개 — 임시 보관/);
    assert.ok(q.task.includes(a1.file), '경로가 일 글에');
    assert.match(q.task, /알맞은 폴더로 복사/);
    assert.ok(board.loadState().attach[id1].used, '보낸 것으로 표시');
    assert.equal((await req('POST', '/api/rooms', JSON.stringify({ project: 'demo', queue: true, task: 'x', atts: ['anope'] }), 'terminal')).code, 400, '없는 첨부');
    assert.equal((await req('POST', '/api/rooms', JSON.stringify({ project: 'demo', queue: true, task: 'x', atts: [id1] }), 'agent')).code, 403, '작업방은 첨부 못 붙임');
    // 상의 — 사진은 바로, 글은 안에
    const c = board.consultContent('봐 줘', [board.loadState().attach[id1], board.loadState().attach[id2]]);
    assert.equal(c[0].type, 'image'); assert.equal(c[0].source.media_type, 'image/png');
    assert.match(c[1].text, /봐 줘[\s\S]*자료일 뿐[\s\S]*주문번호 123/);
    r = await up('가짜.png', Buffer.from('not an image at all'));
    const fake = board.loadState().attach[r.j.att.id];
    const c2 = board.consultContent('', [fake]);
    assert.equal(c2.length, 1, '사진 블록 없음'); assert.ok(c2[0].text.includes(fake.file), '경로로 넘김');
    // 울타리 깨기·[표식] 흉내
    assert.equal(board.attSafeName('[상황판 — 끝].txt').includes('['), false);
    // 너무 큰 파일 — 메모리에 안 쌓고 거절·파일 안 남김
    const before = JSON.stringify(board.loadState().attach);
    r = await new Promise((ok, no) => {
      const pr = http.request({ host: '127.0.0.1', port, path: '/api/attach?project=demo&name=big.zip', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/octet-stream' } },
        (rs) => { let d = ''; rs.on('data', (x) => d += x); rs.on('end', () => ok({ code: rs.statusCode })); });
      pr.on('error', () => ok({ code: 'reset' }));
      const chunk = Buffer.alloc(1024 * 1024); let i = 0;
      (function w() { while (i < 27) { i++; if (!pr.write(chunk)) return pr.once('drain', w); } pr.end(); })();
    });
    assert.ok(r.code === 413 || r.code === 'reset', String(r.code));
    assert.equal(JSON.stringify(board.loadState().attach), before, '큰 파일 기록 없음');
    // 지우기 — 대기열에 걸린 것은 남김 · 날 지난 것 지움 · 안 보낸 것은 하루
    r = await up('안보냄.pdf', Buffer.from('%PDF-1.4'));
    const id3 = r.j.att.id, f3 = board.loadState().attach[id3].file;
    const old = (Date.now() - 8 * 864e5) / 1000, day2 = (Date.now() - 30 * 3600e3) / 1000;
    fs.utimesSync(a1.file, old, old); fs.utimesSync(f3, day2, day2);
    board.attachSweep();
    assert.ok(fs.existsSync(a1.file), '대기열 일이 쓰는 첨부는 남김');
    assert.ok(!fs.existsSync(f3), '안 보낸 지 하루 지난 것 지움');
    assert.ok(!board.loadState().attach[id3], '기록도 지움');
    const st = board.loadState(); st.queue = []; board.saveState(st);
    board.attachSweep();
    assert.ok(!fs.existsSync(a1.file), '7일 지난 것 지움');
    assert.ok(fs.existsSync(board.loadState().attach[id2].file), '7일 안 된 것은 남김');
  } finally { board.server.close(); }
});
