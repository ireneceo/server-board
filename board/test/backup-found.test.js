// 방이 찾은 기존 백업 «제안» → 주인 «이대로 등록»
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => { try { board.server.close(); } catch (_) {} sb.cleanup(); });
const PJ = path.join(sb.home, 'dev-server', 'projects.json');
const P = () => JSON.parse(fs.readFileSync(PJ, 'utf8'))[0];

function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    const pr = http.request({ host: '127.0.0.1', port: board.server.address().port, path: p, method, agent: false, headers },
      (r) => { const bufs = []; r.on('data', (c) => bufs.push(c)); r.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(bufs).toString() || '{}'); } catch (_) {} ok({ code: r.statusCode, j }); }); });
    pr.on('error', no); pr.end(body ? JSON.stringify(body) : undefined);
  });
}

test('방은 제안만 · 표가 맞아야 · 못 읽는 폴더 거절 · 주인 저장이 등록하고 제안을 지움', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const a = JSON.parse(fs.readFileSync(PJ, 'utf8')); delete a[0].backup; fs.writeFileSync(PJ, JSON.stringify(a));
  const dir = path.join(sb.home, 'WORK', 'backup'); fs.mkdirSync(path.join(dir, '20261124'), { recursive: true });
  const found = { project: 'demo', local: [{ label: '이 서버 사본', path: dir }], every: 24, note: '/WORK/backup.sh · cron 05:00' };

  // 만들기 일이 없으면 제안도 못 함
  assert.equal((await call('POST', '/api/backup-found', 'agent', Object.assign({ mark: 'x' }, found))).code, 403);
  await call('GET', '/api/board', 'terminal');
  let r = await call('POST', '/api/projects/demo/backup-create', 'terminal', {});
  if (r.code === 409) { await call('GET', '/api/board', 'terminal'); r = await call('POST', '/api/projects/demo/backup-create', 'terminal', {}); }
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const mark = board.loadState().backupMade.demo.mark;
  assert.match(board.loadState().queue.find((q) => q.ref === 'backup-create:demo').task, /\/api\/backup-found/);

  assert.equal((await call('POST', '/api/backup-found', 'agent', Object.assign({ mark: 'wrong' }, found))).code, 403, '표가 틀리면 거절');
  assert.equal((await call('POST', '/api/backup-found', 'agent', Object.assign({}, found, { mark, local: [{ path: path.join(sb.home, 'nope') }] }))).code, 400, '못 읽는 폴더 거절');
  assert.equal((await call('POST', '/api/backup-found', 'agent', Object.assign({}, found, { mark, local: [{ path: 'rel/x' }] }))).code, 400, '상대 경로 거절');
  r = await call('POST', '/api/backup-found', 'agent', Object.assign({ mark }, found));
  assert.equal(r.code, 200, JSON.stringify(r.j));

  // projects.json 은 그대로(만들기 기본 등록) · 승인 없음 · 카드는 «found»
  assert.equal(P().backup.command, 'scripts/board-backup.sh', '방은 등록을 바꾸지 못함');
  assert.equal(board.backup.isApproved(P()), false);
  const v = board.backupView(P(), board.loadState(), []);
  assert.equal(v.pending, 'found'); assert.equal(v.found.backup.local[0].path, dir);
  assert.equal(board.backupForViewer(v).found, undefined, '팀원에게는 안 보냄');

  // 방은 주인 저장(backup-setup)을 못 누름 · 주인이 누르면 등록·승인·제안 지움
  assert.equal((await call('POST', '/api/projects/demo/backup-setup', 'agent', { local: found.local })).code, 403);
  r = await call('POST', '/api/projects/demo/backup-setup', 'terminal', { local: found.local, every: 24 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(P().backup.local[0].path, dir); assert.equal(P().backup.command, undefined);
  assert.equal(board.backup.isApproved(P()), true);
  const st = board.loadState();
  assert.equal((st.backupFound || {}).demo, undefined); assert.equal((st.backupMade || {}).demo, undefined);
  // 등록 뒤에는 다시 제안 못 함
  assert.equal((await call('POST', '/api/backup-found', 'agent', Object.assign({ mark }, found))).code, 403);
});
