// 배포 실패 뒤 — 원인 읽기 · 고치는 일 하나만·앞으로 · 일시적 실패는 다시 누르기 · 나가면 고치기 뺌
//
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const runner = board.runner;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'depfail-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GATE_LOG = `[OK] 운영서버 SSH OK
[ERROR] health-check 실패 — 배포 중단. 자세히: tail -40 /tmp/deploy-gate-health.log
✗ 1 FAILED / 100 passed / 101 total

깨진 항목:
  1. [external] 메일 ownEmails 가 실제 도착 주소를 덮는가
      90일간 10건 이상 도착했는데 "우리 주소" 에 없는 주소: x@example.edu(10건/biz3) — 별칭 등록 필요
`;
const FLAKY_LOG = `[ERROR] health-check 실패 — 배포 중단.
깨진 항목:
  1. [security] 사용자 ID 파라미터 IDOR → 403
      PUT http://localhost:3003/api/users/1004 → 429 (expected 403): Too many requests
  2. [security] 비소속 워크스페이스 → 403
      GET http://localhost:3003/api/sale/9/clients → 429 (expected 403): Too many requests
`;

test('원인 읽기 — 배포 전 검사 · 일시적(429) · 메모리 · 시간 넘김 · 그 밖', () => {
  const g = runner.failCause(GATE_LOG);
  assert.equal(g.kind, 'gate'); assert.equal(g.retry, false);
  assert.match(g.title, /배포 전 검사\(health-check\) — 1건 걸림: \[external\] 메일 ownEmails/);
  assert.match(g.items[0], /별칭 등록 필요/);
  const f = runner.failCause(FLAKY_LOG);
  assert.equal(f.kind, 'flaky'); assert.equal(f.retry, true); assert.equal(f.items.length, 2);
  assert.equal(runner.failCause('Building...\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory').kind, 'memory');
  assert.equal(runner.failCause('...', { timedOut: true }).kind, 'timeout');
  const o = runner.failCause('step 1\n[ERROR] rsync 실패: 디스크 가득');
  assert.equal(o.kind, 'other'); assert.match(o.title, /rsync 실패/);
});

const proj = { key: 'demo', name: 'Demo', deploy: { command: './deploy.sh' } };
let seq = 0;
function failRun(st, text, extra) {
  const runId = 'dep' + (++seq);
  const log = path.join(tmp, runId + '.log'); fs.writeFileSync(log, text);
  const run = Object.assign({ runId, key: 'demo', at: new Date(Date.now() - 60000).toISOString(), end: new Date().toISOString(), via: 'button', dry: false, command: './deploy.sh --routine', code: 1, result: 'fail', log, tail: runner.tailOf(log, 25) }, extra || {});
  run.cause = runner.failCause(runner.tailOf(log, 80), {});
  st.deployRuns = st.deployRuns || {}; st.deployRuns.demo = run;
  st.deployRunLog = [{ key: 'demo', runId, at: run.at, end: run.end, via: 'button', dry: false, result: run.result }].concat(st.deployRunLog || []);
  board.saveState(st);
  board.runnerDone(proj, run);
  return run;
}
const fixItems = (st) => st.queue.filter((q) => q.project === 'demo' && q.deployFix);
const failAsks = (st) => Object.values(st.asks).filter((a) => a.project === 'demo' && /배포 실패/.test(a.title));

test('검사 실패 — 고치는 일 하나를 다른 새 일 앞에 · 다시 실패하면 같은 일에 더함 · 맨 위 카드는 하나(원인 붙음)', () => {
  let st = board.loadState();
  st.queue = [{ qid: 'other1', project: 'demo', task: '다른 일', createdAt: new Date().toISOString() }]; st.asks = {}; st.deployRunLog = []; st.deployFix = {};
  board.saveState(st);
  failRun(board.loadState(), GATE_LOG);
  st = board.loadState();
  assert.equal(fixItems(st).length, 1);
  assert.equal(st.queue[0].deployFix, true, '고치기가 다른 새 일보다 앞');
  assert.match(st.queue[0].task, /별칭 등록 필요/);
  assert.match(st.queue[0].task, /검사를 끄거나 건너뛰는 것은 고침이 아님/);
  const qid = st.queue[0].qid;
  assert.equal(st.deployRuns.demo.fixQid, qid);
  assert.equal(failAsks(st).length, 1);
  assert.match(failAsks(st)[0].title, /배포 실패 — 배포 전 검사/);
  // 고치기 전에 다시 눌러 같은 실패
  failRun(board.loadState(), GATE_LOG);
  st = board.loadState();
  assert.equal(fixItems(st).length, 1, '같은 고치기에 더함');
  assert.match(fixItems(st)[0].task, /같은 일 — .* 다시 실패/);
  assert.equal(st.deployRuns.demo.fixQid, qid);
  assert.equal(failAsks(st).length, 1, '지난 실패 카드는 이번 것으로 바뀜');
  assert.match(failAsks(st)[0].recommend, /이미 대기열에 있어/);
  // 버튼 상태 — 까닭·고치기 대기
  const d = board.deployState(st, [], 'demo', Date.now());
  assert.equal(d.phase, 'fail'); assert.match(d.cause.title, /health-check/);
  assert.equal(d.fix.state, 'queued'); assert.equal(d.fix.pos, 1);
});

test('고치는 방이 일하는 중 · ✅ 로 끝남 — 상태가 따라감 · 일하는 중 다시 실패하면 또 넣지 않음', () => {
  let st = board.loadState();
  const qid = st.deployRuns.demo.fixQid;
  st.queue = st.queue.filter((q) => q.qid !== qid);   // 대기열이 방을 띄움
  st.qStarted = st.qStarted || {}; st.qStarted[qid] = { id: 'fix00001', at: new Date().toISOString() };
  board.saveState(st);
  const rr = st.deployRuns.demo;
  const working = [{ id: 'fix00001', project: 'demo', alive: true, turnOpen: true, status: { code: 'working' }, lastReportAt: 0, firstPrompt: '' }];
  assert.equal(board.deployState(st, working, 'demo', Date.now()).fix.state, 'working');
  failRun(board.loadState(), GATE_LOG);
  st = board.loadState();
  assert.equal(fixItems(st).length, 0, '방이 맡고 있으면 새로 안 넣음');
  assert.equal(st.deployRuns.demo.fixQid, qid);
  assert.match(failAsks(st)[0].recommend, /이미 일하는 중/);
  const done = [{ id: 'fix00001', project: 'demo', alive: true, turnOpen: false, status: { code: 'done' }, lastReportAt: Date.parse(st.deployRuns.demo.end) + 1000, lastReport: '✅ 완료 — 별칭 등록', firstPrompt: rr.log }];
  const d = board.deployState(st, done, 'demo', Date.now());
  assert.equal(d.fix.state, 'done'); assert.equal(d.fixed.room, 'fix00001');
});

test('일시적 실패(429) — 처음엔 고칠 일 없이 «다시 누르기» · 연달아 또 실패하면 고치기 넣음', () => {
  let st = board.loadState();
  st.queue = []; st.asks = {}; st.deployRunLog = [{ key: 'demo', runId: 'okprev', result: 'ok', dry: false }]; st.deployFix = {};
  board.saveState(st);
  failRun(board.loadState(), FLAKY_LOG);
  st = board.loadState();
  assert.equal(fixItems(st).length, 0);
  assert.match(failAsks(st)[0].recommend, /일시적 실패/);
  assert.equal(board.deployState(st, [], 'demo', Date.now()).fix.state, 'none');
  failRun(board.loadState(), FLAKY_LOG);
  st = board.loadState();
  assert.equal(fixItems(st).length, 1, '두 번째 연속이면 고칠 일');
});

test('배포가 나가면 — 아직 시작 안 한 고치기·실패 카드를 뺌', () => {
  let st = board.loadState();
  assert.ok(fixItems(st).length >= 1);
  const run = { runId: 'okrun', key: 'demo', result: 'ok', dry: false, log: path.join(tmp, 'none.log') };
  board.runnerDone(proj, run);
  st = board.loadState();
  assert.equal(fixItems(st).length, 0);
  assert.equal(failAsks(st).length, 0);
  assert.equal((st.deployFix || {}).demo, undefined);
});
