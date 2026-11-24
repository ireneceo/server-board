'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => { try { board.server.close(); } catch (_) {} sb.cleanup(); });
const auth = board.auth;
const PJ = path.join(sb.home, 'dev-server', 'projects.json');
const P = () => JSON.parse(fs.readFileSync(PJ, 'utf8'))[0];
let cookie = '';

function call(method, p, sock, body, raw) {
  return new Promise((ok, no) => {
    const port = board.server.address().port;
    const headers = { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    if (cookie && sock !== 'terminal' && sock !== 'agent') headers.cookie = 'sb_sess_' + (board.server.address() && process.env.BOARD_PORT || 8800) + '=' + cookie;
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers },
      (r) => { const bufs = []; r.on('aborted', () => ok({ code: -1 })); r.on('error', () => ok({ code: -1 })); r.on('data', (c) => bufs.push(c)); r.on('end', () => { const d = Buffer.concat(bufs); let j = {}; if (!raw) { try { j = JSON.parse(d.toString() || '{}'); } catch (_) {} } ok({ code: r.statusCode, j, body: d, h: r.headers }); }); });
    pr.on('error', no); pr.end(body ? JSON.stringify(body) : undefined);
  });
}

test('백업 없음 → 만들기 일 · 겹침 409 · 일이 사라지면 «다시 만들기» · 스크립트 생기면 승인 전', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const a = JSON.parse(fs.readFileSync(PJ, 'utf8')); delete a[0].backup; fs.writeFileSync(PJ, JSON.stringify(a));
  const proj = P();
  let v = board.backupView(proj, board.loadState(), []);
  assert.equal(v.level, 'none', '등록 없음 = none(카드 빨강)');

  // 작업방(AI)·터미널 아닌 팀원은 못 누름 — AGENT_POST 에 없음 · SENSITIVE_POST 에 있음 (Fable 꼭 9)
  assert.equal((await call('POST', '/api/projects/demo/backup-create', 'agent', {})).code, 403);
  assert.equal((await call('POST', '/api/projects/demo/backup-download', 'agent', {})).code, 403);
  assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel' }, '/api/projects/demo/backup-create'));
  assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel' }, '/api/projects/demo/backup-download'));

  let r = await call('POST', '/api/projects/demo/backup-create', 'terminal', {});
  if (r.code === 409) { await call('GET', '/api/board', 'terminal'); r = await call('POST', '/api/projects/demo/backup-create', 'terminal', {}); }   // 방 목록이 아직 없으면 미룸 — 상황판 자료를 한 번 만든 뒤
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const b = P().backup;
  assert.equal(b.command, 'scripts/board-backup.sh');
  assert.ok(path.isAbsolute(b.local[0].path) && b.local[0].path.endsWith(path.join('backups', 'board', 'demo')), '절대 경로 (Fable 꼭 3)');
  assert.equal(b.made, undefined, 'made 는 projects.json 이 아니라 state');
  const st = board.loadState();
  const q = st.queue.find((x) => x.ref === 'backup-create:demo');
  assert.ok(q, '대기열에 들어감');
  assert.match(q.task, /^\[(상황판 — 백업 만들기|Board — create backup)\]/);
  assert.match(q.task, /crontab -l|crontab/); assert.match(q.task, /최신 3개|newest 3/); assert.match(q.task, /--single-transaction/); assert.match(q.task, /mktemp/);
  assert.ok(q.task.includes(st.backupMade.demo.mark));

  v = board.backupView(P(), board.loadState(), []);
  assert.equal(v.pending, 'making', '대기열에 있으면 만드는 중');
  assert.equal((await call('POST', '/api/projects/demo/backup-create', 'terminal', {})).code, 409, '겹침');

  // 방이 그 일을 받아 도는 중 → 만드는 중 · 방이 끝났는데 스크립트 없음 → stalled → 다시 만들기 됨
  const s2 = board.loadState(); s2.queue = s2.queue.filter((x) => x.qid !== q.qid); board.saveState(s2);
  const room = { id: 'abcd1234', name: '백업 만들기', project: 'demo', firstPrompt: q.task, alive: true, status: { code: 'working' } };
  assert.equal(board.backupView(P(), board.loadState(), [room]).pending, 'making');
  // 방이 막 시작돼 목록에 안 잡힌 틈 — qStarted 로 이어 «만드는 중» (Fable 완료 ③)
  const s4 = board.loadState(); s4.qStarted = Object.assign({}, s4.qStarted, { [q.qid]: { id: 'ffff0000', at: new Date().toISOString() } }); board.saveState(s4);
  assert.equal(board.backupView(P(), board.loadState(), []).pending, 'making');
  s4.qStarted[q.qid].at = new Date(Date.now() - 10 * 60e3).toISOString(); board.saveState(s4);
  // 일하다 꺼진 방 → 다시 만들기 (Fable 완료 ②)
  assert.equal(board.backupView(P(), board.loadState(), [Object.assign({}, room, { alive: false })]).pending, 'stalled');
  room.status.code = 'done';
  assert.equal(board.backupView(P(), board.loadState(), [room]).pending, 'stalled');
  // 끝난 방의 마지막 보고 첫 줄을 주인에게 — 기존 백업을 찾고 경로만 보고한 경우 «왜 스크립트가 없나» 가 보이게 · 팀원에게는 안 감
  room.lastReport = '✅ 완료 — 기존 백업(/WORK/backup)이 이미 매일 돌아 새로 만들지 않음\n자세한 내용';
  const ev = board.backupView(P(), board.loadState(), [room]);
  assert.equal(ev.ended && ev.ended.head, '✅ 완료 — 기존 백업(/WORK/backup)이 이미 매일 돌아 새로 만들지 않음');
  assert.equal(ev.ended.roomName, '백업 만들기');
  assert.equal((board.backupForViewer(ev) || {}).ended, undefined, '팀원 화면에는 방 보고 없음');
  await call('GET', '/api/board', 'terminal');
  r = await call('POST', '/api/projects/demo/backup-create', 'terminal', {});
  assert.equal(r.code, 200, '일이 사라지면 다시 누를 수 있음 (Fable 꼭 2) ' + JSON.stringify(r.j));

  // 방이 스크립트를 만들었다 → pending 없음 · 승인 전
  const script = path.join(P().dir, 'scripts', 'board-backup.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, '#!/bin/sh\necho ok\n', { mode: 0o755 });
  v = board.backupView(P(), board.loadState(), []);
  assert.equal(v.pending, undefined);
  assert.equal(board.backup.isApproved(P()), false, '방이 만든 뒤에는 주인 승인 전');
  assert.equal((await call('POST', '/api/projects/demo/backup-create', 'terminal', {})).code, 409, '스크립트가 있으면 다시 만들기 안 됨');
  // 이미 다른 백업이 등록된 솔루션(만들기로 안 한 것)은 409
  const s3 = board.loadState(); delete s3.backupMade.demo; board.saveState(s3);
  assert.equal((await call('POST', '/api/projects/demo/backup-create', 'terminal', {})).code, 409);
  // 팀원 화면 — 경로·누가 만들었는지 안 보임
  const fv = board.backupView({ key: 'zz', name: 'zz', dir: '/tmp' }, { backupMade: { zz: { at: 'x', by: '__OWNER__', mark: 'm' } }, queue: [{ ref: 'backup-create:zz' }] }, []);
  assert.equal(fv.level, 'none'); assert.equal(fv.making.where, 'queue');
});

test('PC 로 받기 — 터미널·인증 앱 없는 주인 거절 · 표 한 번만 · 끝까지 받으면 기록 · 폴더는 tar', async () => {
  const proj = P();
  const out = proj.backup.local[0].path;
  fs.mkdirSync(path.join(out, '20261124'), { recursive: true });
  fs.writeFileSync(path.join(out, '20261124', 'db.sql.gz'), 'hello-backup');
  board.backup.approve(P(), 'test');
  await board.backupRefresh(P(), true);

  // 서버 터미널 길은 화면이 아님 → 거절 (Fable 꼭 7)
  let r = await call('POST', '/api/projects/demo/backup-download', 'terminal', { kind: 'local', i: 0, name: '20261124' });
  assert.equal(r.code, 403);
  // 통로로 연 주인 — 인증 앱 없음 → 거절
  const OID = board.decideWho({ kind: 'terminal' }, null).user;
  await auth.setPassword(OID, 'correct horse battery');
  cookie = auth.createSession(OID, 'tunnel', true, 'ua');
  r = await call('POST', '/api/projects/demo/backup-download', 'tunnel', { kind: 'local', i: 0, name: '20261124' });
  assert.equal(r.code, 403, JSON.stringify(r.j));
  // 인증 앱 등록 → 표
  auth.setTotp(OID, auth.newTotpSecret(), 0);
  r = await call('POST', '/api/projects/demo/backup-download', 'tunnel', { kind: 'local', i: 0, name: '../etc' });
  assert.equal(r.code, 400, '등록 폴더 밖 이름 거절');
  r = await call('POST', '/api/projects/demo/backup-download', 'tunnel', { kind: 'local', i: 0, name: '20261124' });
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.match(r.j.url, /^\/api\/backup-dl\/[0-9a-f]{32}$/);
  // 다른 사람(쿠키 없음)은 표가 있어도 못 받음 — 그리고 표는 소진
  const saved = cookie; cookie = '';
  assert.ok([401, 403].includes((await call('GET', r.j.url, 'tunnel', null, true)).code), '로그인 없는 사람');
  cookie = saved;
  const g = await call('GET', r.j.url, 'tunnel', null, true);
  assert.equal(g.code, 200);
  assert.match(g.h['content-disposition'], /attachment/); assert.equal(g.h['x-content-type-options'], 'nosniff'); assert.equal(g.h['cache-control'], 'no-store');
  assert.equal(g.body[0], 0x1f); assert.equal(g.body[1], 0x8b, '폴더는 tar.gz 로 흘림');
  assert.equal((await call('GET', r.j.url, 'tunnel', null, true)).code, 404, '표는 한 번만');
  await new Promise((ok) => setTimeout(ok, 100));
  const pl = board.loadState().backupPulled.demo;
  assert.ok(pl && pl.name === '20261124.tar.gz', '끝까지 받으면 기록');
  assert.equal(board.backupView(P(), board.loadState(), []).pulled.name, '20261124.tar.gz');

  // 팀원 화면 /api/backup — 받은 기록·누가 만들었는지·길 정보 없음 (Fable 완료 ⑤)
  board.setTeamForTest({ members: [{ user: 'mem', name: '팀원', role: 'member', projects: ['demo'] }] });
  await auth.setPassword('mem', 'another long password');
  const keep = cookie; cookie = auth.createSession('mem', 'tunnel', true, 'ua');
  const mv = await call('GET', '/api/backup?p=demo', 'tunnel');
  cookie = keep;
  assert.equal(mv.code, 200, JSON.stringify(mv.j));
  assert.equal(mv.j.pulled, undefined); assert.equal(mv.j.via, undefined); assert.equal(mv.j.totp, undefined); assert.equal(mv.j.made, undefined);

  // tar 가 중간에 실패하면 «PC 로 받음» 을 기록하지 않음 (Fable 완료 ④)
  const s5 = board.loadState(); delete s5.backupPulled; board.saveState(s5);
  const bad = path.join(out, '20261125'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'locked'), 'x'); fs.chmodSync(path.join(bad, 'locked'), 0);
  await board.backupRefresh(P(), true);
  r = await call('POST', '/api/projects/demo/backup-download', 'tunnel', { kind: 'local', i: 0, name: '20261125' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await call('GET', r.j.url, 'tunnel', null, true).catch(() => null);
  await new Promise((ok) => setTimeout(ok, 300));
  fs.chmodSync(path.join(bad, 'locked'), 0o600);
  assert.equal((board.loadState().backupPulled || {}).demo, undefined, '실패한 받기는 기록 없음');
});
