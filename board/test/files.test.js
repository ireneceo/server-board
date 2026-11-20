'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());

test('내려받기 — 내주기 권한·경로 막기·사본·받기·카드 목록·지움', async () => {
  const proj = path.join(sb.root, 'proj');
  const ROOM = 'abcd1234';
  fs.mkdirSync(path.join(sb.home, '.claude', 'jobs', ROOM, 'tmp'), { recursive: true });
  process.env.FAKE_AGENTS = JSON.stringify([{ id: ROOM, kind: 'background', sessionId: 'aaaa0001-0000-0000-0000-000000000000', cwd: proj, name: '매출 엑셀 뽑기', status: 'busy', startedAt: 1 }]);
  board.resetAgentsCache();
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const req = (method, p, body, sock) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } },
      (r) => { const ch = []; r.on('data', (c) => ch.push(c)); r.on('end', () => { const buf = Buffer.concat(ch); let j = {}; try { j = JSON.parse(buf.toString() || '{}'); } catch (_) {} ok({ code: r.statusCode, j, buf, h: r.headers }); }); });
    pr.on('error', no); pr.end(body);
  });
  const offer = (o, sock = 'agent') => req('POST', '/api/files', JSON.stringify(Object.assign({ room: ROOM }, o)), sock);
  try {
    const out = path.join(proj, 'exports'); fs.mkdirSync(out, { recursive: true });
    const xl = path.join(out, '11월 매출.xlsx'); fs.writeFileSync(xl, 'PK\u0003\u0004 fake xlsx');
    let r = await offer({ path: xl, note: '11월 매장별 매출' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const id = r.j.id; assert.match(id, /^f[0-9a-z]+$/); assert.equal(r.j.name, '11월 매출.xlsx');
    assert.match(r.j.message, /📥/);
    // 사본 — 원본을 바꿔도 받은 그대로
    fs.writeFileSync(xl, 'changed');
    r = await req('GET', '/api/files/' + id, undefined, 'terminal');
    assert.equal(r.code, 200); assert.equal(r.buf.toString(), 'PK\u0003\u0004 fake xlsx', '내준 순간의 사본');
    assert.equal(r.h['content-type'], 'application/octet-stream', '상황판 주소에서 열리지 않게');
    assert.match(r.h['content-disposition'], /^attachment; .*filename\*=UTF-8''11%EC%9B%94/);
    assert.equal(r.h['x-content-type-options'], 'nosniff');
    // 방 작업 폴더 안 파일도 됨
    const tmpf = path.join(sb.home, '.claude', 'jobs', ROOM, 'tmp', 'report.pdf'); fs.writeFileSync(tmpf, '%PDF-1.4');
    assert.equal((await offer({ path: tmpf, name: '보고서.pdf' })).code, 200);
    // 막는 것
    assert.equal((await offer({ path: 'exports/a.xlsx' })).code, 400, '상대 경로');
    assert.equal((await offer({ path: path.join(proj, 'none.txt') })).code, 404);
    assert.equal((await offer({ path: out })).code, 400, '폴더');
    const outside = path.join(sb.root, 'outside.txt'); fs.writeFileSync(outside, 'x');
    assert.equal((await offer({ path: outside })).code, 403, '솔루션 밖');
    fs.symlinkSync(outside, path.join(proj, 'link.txt'));
    assert.equal((await offer({ path: path.join(proj, 'link.txt') })).code, 403, '링크로 밖을 가리켜도 막음');
    fs.writeFileSync(path.join(proj, '.env'), 'DB_PASS=x');
    assert.equal((await offer({ path: path.join(proj, '.env') })).code, 403, '.env');
    fs.writeFileSync(path.join(proj, 'server.key'), 'k');
    assert.equal((await offer({ path: path.join(proj, 'server.key') })).code, 403, '키');
    fs.writeFileSync(path.join(proj, 'empty.txt'), '');
    assert.equal((await offer({ path: path.join(proj, 'empty.txt') })).code, 400, '빈 파일');
    assert.equal((await offer({ path: xl, room: 'ffff0000' })).code, 404, '없는 방');
    assert.equal((await offer({ path: xl, room: '../x' })).code, 400);
    // 받기 권한 — 작업방은 못 받음 · 로그인 안 한 사람 못 받음
    assert.equal((await req('GET', '/api/files/' + id, undefined, 'agent')).code, 403);
    assert.equal((await req('GET', '/api/files/' + id, undefined, 'anon')).code, 401);
    assert.equal((await req('GET', '/api/files/fnope12345', undefined, 'terminal')).code, 404);
    // 카드 목록 — 경로는 화면에 안 감
    const list = board.filesByRoom()[ROOM];
    assert.equal(list.length, 2); assert.equal(list[0].note, '11월 매장별 매출'); assert.equal(list[0].file, undefined); assert.equal(list[0].src, undefined);
    const b = await req('GET', '/api/board', undefined, 'terminal');
    const room = (b.j.rooms || []).find((x) => x.id === ROOM);
    assert.ok(room && room.files.length === 2, '방 카드에 단추');
    const mock = () => { const m = { code: 0, h: null, body: '' }; m.writeHead = (c, h) => { m.code = c; m.h = h; }; m.setHeader = () => {}; m.end = (x) => { m.body += x || ''; }; m.write = () => true; m.on = () => m; m.once = () => m; m.emit = () => true; return m; };
    const member = { role: 'member', user: 'kim', projects: ['demo'], via: 'tunnel' };
    let m = mock(); board.fileServe({}, m, member, id); assert.equal(m.code, 403, '맡은 솔루션 팀원도 기본은 못 받음');
    m = mock(); board.fileServe({}, m, { role: 'viewer', user: 'v', projects: ['other'], via: 'tunnel' }, id); assert.equal(m.code, 403);
    const sc = board.scopeBoard({ rooms: [{ project: 'demo', files: [{ id }] }], completed: [{ project: 'demo', files: [{ id }] }] }, member);
    assert.deepEqual(sc.rooms[0].files, []); assert.deepEqual(sc.completed[0].files, []);
    assert.equal(board.scopeBoard({ rooms: [{ project: 'demo', files: [{ id }] }] }, { role: 'owner', projects: ['*'] }).rooms[0].files.length, 1);
    // 상황판 기록·DB 덤프도 거절
    fs.writeFileSync(path.join(proj, 'backup.sql'), 'insert');
    assert.equal((await offer({ path: path.join(proj, 'backup.sql') })).code, 403, 'DB 덤프');
    assert.ok(board.FILE_SECRET.test('/home/x/dev-server/board/log/push.json') && board.FILE_SECRET.test('/x/board/state.json.tmp') && board.FILE_SECRET.test('/x/board/downloads/f1-a.txt'));
    // 거두기 — 다른 방은 못 거둠 · 그 방 자신·주인은 됨
    const id2 = board.filesByRoom()[ROOM][1].id;
    assert.equal((await req('POST', '/api/files/' + id2 + '/drop', JSON.stringify({ room: 'ffff0000' }), 'agent')).code, 403, '다른 방');
    assert.equal((await req('POST', '/api/files/' + id2 + '/drop', JSON.stringify({ room: ROOM }), 'agent')).code, 200, '내준 방');
    assert.equal(board.filesByRoom()[ROOM].length, 1);
    r = await offer({ path: tmpf, name: '다시.pdf' }); const id3 = r.j.id;
    assert.equal((await req('POST', '/api/files/' + id3 + '/drop', '{}', 'terminal')).code, 200, '주인');
    // 받은 사람 기록
    const logTxt = fs.readdirSync(path.join(sb.dir, 'log')).map((f) => fs.readFileSync(path.join(sb.dir, 'log', f), 'utf8')).join('');
    assert.match(logTxt, /"action":"file-download"[^\n]*"by":"owner/);
    // 지움 — 정해진 날 지난 것
    const st = board.loadState(); const f0 = st.files[id];
    f0.at = new Date(Date.now() - 15 * 864e5).toISOString(); board.saveState(st);
    assert.equal(board.filesSweep(), 1);
    assert.ok(!fs.existsSync(f0.file), '사본 지움'); assert.equal((await req('GET', '/api/files/' + id, undefined, 'terminal')).code, 404);
    assert.equal(board.filesByRoom()[ROOM], undefined, '다 지워짐');
  } finally { board.server.close(); delete process.env.FAKE_AGENTS; board.resetAgentsCache(); }
});
