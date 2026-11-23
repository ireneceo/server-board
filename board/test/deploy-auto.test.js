// 자동 다시 배포 + 상황판이 못 지켜본 실행의 정확한 판정
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const runner = board.runner;
fs.mkdirSync(path.join(sb.home, 'dev-server', 'board'), { recursive: true });   // 실행기 잠금 자리
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'depauto-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 시험용 솔루션 git 폴더 — 배포 스크립트·검사 파일
const dir = path.join(tmp, 'demo');
fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
const git = (...a) => execFileSync('git', ['-C', dir].concat(a), { encoding: 'utf8' }).trim();
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.writeFileSync(path.join(dir, 'deploy.sh'), '#!/bin/sh\necho "[ERROR] health-check 실패 — 배포 중단."\nexit "$(cat "$(dirname "$0")/code.txt" 2>/dev/null || echo 0)"\n', { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'scripts', 'health-check.js'), 'check1\n');
fs.writeFileSync(path.join(dir, 'app.js'), 'v1\n');
git('add', '-A'); git('commit', '-qm', 'one');
const proj = { key: 'demo', name: 'Demo', dir, deploy: { command: './deploy.sh --routine', autoRetry: true, gateFiles: ['scripts/health-*.js'] } };

const GATE_LOG = `[ERROR] health-check 실패 — 배포 중단. 자세히: tail -40 /tmp/x.log
깨진 항목:
  1. [clientlink] 빈 행
      개발 DB project_clients 빈 행 3건
`;
let seq = 0;
function failRun(text, extra) {
  const st = board.loadState();
  const runId = 'dep' + (++seq);
  const log = path.join(tmp, runId + '.log'); fs.writeFileSync(log, text);
  const run = Object.assign({ runId, key: 'demo', at: new Date(Date.now() - 60000).toISOString(), end: new Date().toISOString(), via: 'button', dry: false, command: './deploy.sh --routine', code: 1, result: 'fail', log,
    commit: git('rev-parse', 'HEAD'), scriptsHash: runner.scriptsHash(runner.conf(proj)), markerBefore: '2026-11-18T10:00:00.000Z' }, extra || {});
  run.tail = runner.tailOf(log, 25); run.cause = runner.failCause(runner.tailOf(log, 80), run.timedOut ? { timedOut: true } : {});
  st.deployRuns = st.deployRuns || {}; st.deployRuns.demo = run;
  st.deployRunLog = [{ key: 'demo', runId, at: run.at, end: run.end, via: run.via, dry: false, result: run.result }].concat(st.deployRunLog || []);
  board.saveState(st);
  board.runnerDone(proj, run);
  return run;
}
function press(extra) { const st = board.loadState(); st.deployAuto = { demo: Object.assign({ pressedAt: new Date().toISOString(), by: '__OWNER__', n: 0 }, extra || {}) }; st.queue = []; st.asks = {}; st.deployFix = {}; board.saveState(st); }

test('종료 코드 — 감싼 실행이 스크립트 종료 코드를 그대로 돌려주고 파일에도 남김 (0·3)', async () => {
  const p2 = { key: 'wrap', name: 'Wrap', dir, deploy: { command: './deploy.sh --routine', minMemMb: 1 } };
  try { fs.unlinkSync(path.join(sb.dir, 'deploy.lock')); } catch (_) {}   // 사본에 딸려 온 실제 잠금
  for (const code of [0, 3]) {
    fs.writeFileSync(path.join(dir, 'code.txt'), String(code));   // 실행기는 환경을 정리하므로 파일로 넘김
    const r = await runner.start(p2, { via: 'button', by: 't' });
    assert.equal(r.ok, true, String(r.err));
    for (let i = 0; i < 100 && ((board.loadState().deployRuns || {}).wrap || {}).result === 'running'; i++) await new Promise((s) => setTimeout(s, 50));
    const run = board.loadState().deployRuns.wrap;
    assert.equal(run.code, code, '지켜본 종료 코드');
    assert.equal(run.result, code === 0 ? 'ok' : 'fail');
    assert.equal(fs.readFileSync(run.exitFile, 'utf8').trim(), String(code), '종료 코드 파일');
    assert.ok(!fs.existsSync(path.join(sb.dir, 'deploy.lock')), '잠금 풀림');
  }
  fs.unlinkSync(path.join(dir, 'code.txt'));
});

test('recover — 못 지켜본 실행: 종료 코드 파일 0 → ok · 1 → fail · 파일 없음 → 모름 · runId 다름 → 모름', async () => {
  const lockP = path.join(sb.dir, 'deploy.lock')
  const p2 = { key: 'wrap', name: 'Wrap', dir, deploy: { command: './deploy.sh --routine' } };
  const orig = runner._running;
  const cases = [['0', 'ok'], ['1', 'fail'], [null, 'unknown'], ['0', 'unknown', true]];
  for (const [code, want, otherId] of cases) {
    const runId = 'deprec' + (++seq), log = path.join(tmp, runId + '.log'), exitFile = path.join(tmp, runId + '.exit');
    fs.writeFileSync(log, 'Deployment Complete\n');
    if (code !== null) fs.writeFileSync(exitFile, code + '\n');
    const st = board.loadState();
    st.deployRuns = st.deployRuns || {};
    st.deployRuns.wrap = { runId: otherId ? 'someother' : runId, key: 'wrap', at: new Date().toISOString(), via: 'button', dry: false, command: 'x', result: 'running', log, exitFile, commit: 'abc' };
    board.saveState(st);
    fs.writeFileSync(lockP, JSON.stringify({ key: 'wrap', runId, pid: 999999, at: new Date().toISOString(), log, exitFile }));
    // 테스트 솔루션을 projOf 가 찾게
    const pj = path.join(sb.home, 'dev-server', 'projects.json');
    const pjs = JSON.parse(fs.readFileSync(pj, 'utf8')); const arr = pjs.projects || pjs;
    if (!arr.find((x) => x.key === 'wrap')) { arr.push(p2); fs.writeFileSync(pj, JSON.stringify(pjs)); }
    runner.recover();
    runner.recover();   // 두 번 불러도 한 번만(running 자리 표시)
    for (let i = 0; i < 60 && board.loadState().deployRuns.wrap.result === 'running'; i++) await new Promise((s) => setTimeout(s, 50));
    const run = board.loadState().deployRuns.wrap;
    assert.equal(run.result, want, 'code=' + code + ' other=' + !!otherId);
    if (want === 'ok' || want === 'fail') assert.equal(run.recovered, true);
    try { fs.unlinkSync(lockP); } catch (_) {}
    assert.ok(!orig.has('wrap'));
  }
});

test('원인 — «=====» 장식줄은 원인 제목이 아님', () => {
  const c = runner.failCause('step\n[dev-status] done\n=========================================\n  Deployment Complete (600s)\n=========================================');
  assert.equal(c.title, 'Deployment Complete (600s)');
});

test('대상 가리기 — 켜짐·fail·버튼/auto·검사류·6시간·2번·기록 있음일 때만', () => {
  press();
  const st = board.loadState();
  const base = { result: 'fail', via: 'button', scriptsHash: 'h', commit: 'c', markerBefore: 'm' };
  const gate = { kind: 'gate' };
  assert.equal(board.deployAutoWhyNot(st, proj, base, gate), null);
  assert.equal(board.deployAutoWhyNot(st, proj, Object.assign({}, base, { via: 'auto' }), { kind: 'flaky' }), null);
  assert.match(board.deployAutoWhyNot(st, Object.assign({}, proj, { deploy: { command: 'x' } }), base, gate), /안 켬/);
  assert.match(board.deployAutoWhyNot(st, Object.assign({}, proj, { deploy: { command: 'x', autoRetry: true } }), base, gate), /gateFiles/);
  assert.match(board.deployAutoWhyNot(st, proj, Object.assign({}, base, { result: 'unknown' }), gate), /모름/);
  assert.match(board.deployAutoWhyNot(st, proj, Object.assign({}, base, { recovered: true }), gate), /지켜보지 못한/);
  assert.match(board.deployAutoWhyNot(st, proj, Object.assign({}, base, { via: 'schedule' }), gate), /버튼/);
  assert.match(board.deployAutoWhyNot(st, proj, base, { kind: 'other' }), /운영을 건드렸을/);
  assert.match(board.deployAutoWhyNot(st, proj, base, { kind: 'timeout' }), /운영을 건드렸을/);
  assert.match(board.deployAutoWhyNot(st, proj, Object.assign({}, base, { markerBefore: null }), gate), /기록이 없음/);
  st.deployAuto.demo.pressedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
  assert.match(board.deployAutoWhyNot(st, proj, base, gate), /6시간/);
  st.deployAuto.demo.pressedAt = new Date().toISOString(); st.deployAuto.demo.n = 2;
  assert.match(board.deployAutoWhyNot(st, proj, base, gate), /2번을 다 씀/);
  delete st.deployAuto.demo;
  assert.match(board.deployAutoWhyNot(st, proj, base, gate), /누름 기록/);
});

test('검사 실패 + 대상 — 고칠 일에 «✅ 면 자동 다시 배포» · 묶음에 pending(fix) · 카드에 «할 것 없음»', () => {
  press();
  const run = failRun(GATE_LOG);
  const st = board.loadState();
  const fx = st.queue.find((q) => q.deployFix);
  assert.ok(fx);
  assert.match(fx.task, /자동 다시 배포 — 1\/2번째/);
  assert.match(fx.task, /검사를 느슨하게 하는 것은 고침이 아니다/);
  assert.deepEqual(st.deployAuto.demo.pending, { kind: 'fix', runId: run.runId, fixQid: fx.qid });
  const a = Object.values(st.asks).find((x) => x.project === 'demo');
  assert.match(a.recommend, /할 것 없음/);
  assert.match(a.question, /자동 다시 배포 1\/2번째/);
});

test('일시적 실패(429) + 대상 — 고칠 일 없이 pending(retry) · 대상 아님(꺼짐)이면 지금처럼', () => {
  press();
  failRun('[ERROR] health-check 실패 — 배포 중단.\n깨진 항목:\n  1. [security] x\n      GET → 429 (expected 403): Too many requests\n');
  let st = board.loadState();
  assert.equal(st.queue.filter((q) => q.deployFix).length, 0);
  assert.equal(st.deployAuto.demo.pending.kind, 'retry');
  // 꺼진 솔루션
  press();
  const off = Object.assign({}, proj, { deploy: { command: './deploy.sh --routine' } });
  const st2 = board.loadState();
  const log = path.join(tmp, 'off.log'); fs.writeFileSync(log, GATE_LOG);
  const run = { runId: 'depoff', key: 'demo', at: new Date().toISOString(), end: new Date().toISOString(), via: 'button', dry: false, command: 'x', code: 1, result: 'fail', log, tail: GATE_LOG, cause: runner.failCause(GATE_LOG) };
  st2.deployRuns.demo = run; board.saveState(st2);
  board.runnerDone(off, run);
  st = board.loadState();
  assert.equal(st.deployAuto.demo.pending, undefined);
  assert.match(st.queue.find((q) => q.deployFix).task, /__OWNER__ 버튼/);
});

test('누르기 직전 다시 보기 — 스크립트 지문 · 검사 파일 · 일시적 실패 뒤 새 커밋 · 다른 방 일 · 배포 조건', async () => {
  press();
  const run = failRun(GATE_LOG);
  const st = board.loadState();
  const fixRoom = { id: 'fix00001', sessionId: 'sfix', project: 'demo', name: '고침', turnOpen: false, lastActivity: Date.now() };
  const bd = (rooms) => ({ rooms: rooms || [fixRoom], completed: [] });
  const pdFix = { kind: 'fix', runId: run.runId }, pdRetry = { kind: 'retry', runId: run.runId };
  // 그대로면 — 앞의 것은 다 통과하고 배포 조건(승인 안 됨)에서 막힘 = runner.check 를 탐
  assert.match(await board.deployAutoBlock(proj, run, pdFix, fixRoom, bd(), st), /승인/);
  // 고친 방이 앱 코드를 고쳐 커밋 → 통과 쪽(여전히 승인에서만 막힘)
  fs.writeFileSync(path.join(dir, 'app.js'), 'v2\n'); git('commit', '-qam', 'fix app');
  assert.match(await board.deployAutoBlock(proj, run, pdFix, fixRoom, bd(), st), /승인/);
  // 일시적 실패인데 새 커밋
  assert.match(await board.deployAutoBlock(proj, run, pdRetry, null, bd(), st), /새 커밋/);
  // 다른 방도 일함
  const other = { id: 'oth00001', sessionId: 'soth', project: 'demo', name: '다른 일', turnOpen: true, lastActivity: Date.now() };
  assert.match(await board.deployAutoBlock(proj, run, pdFix, fixRoom, bd([fixRoom, other]), st), /다른 방도 일함/);
  // 검사 파일을 고침
  fs.writeFileSync(path.join(dir, 'scripts', 'health-check.js'), 'check-loose\n'); git('commit', '-qam', 'loosen');
  assert.match(await board.deployAutoBlock(proj, run, pdFix, fixRoom, bd(), st), /검사 파일이 바뀜: scripts\/health-check\.js/);
  // 배포 스크립트 지문이 바뀜
  fs.appendFileSync(path.join(dir, 'deploy.sh'), '# x\n');
  assert.match(await board.deployAutoBlock(proj, run, pdFix, fixRoom, bd(), st), /배포 스크립트가 실패 뒤 바뀜/);
  git('checkout', '--', 'deploy.sh');
});

test('틱 — 6시간 넘음·고칠 일 사라짐이면 «자동 다시 배포 안 함» 카드 · 일시적 실패는 기다림 시간 전엔 아무것도 안 함', async () => {
  press();
  failRun('[ERROR] health-check 실패 — 배포 중단.\n깨진 항목:\n  1. [security] x\n      GET → 429 (expected 403): Too many requests\n');
  let r = await board.deployAutoTick();
  assert.deepEqual(r.did, []);
  assert.ok(board.loadState().deployAuto.demo.pending);
  // 6시간 넘음
  let st = board.loadState(); st.deployAuto.demo.pressedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString(); board.saveState(st);
  r = await board.deployAutoTick();
  st = board.loadState();
  assert.equal(st.deployAuto.demo.pending, undefined);
  assert.ok(Object.values(st.asks).some((a) => /자동 다시 배포 안 함 — «배포» 누른 지 6시간/.test(a.title)));
  // 고칠 일이 대기열에서 사라짐
  press();
  failRun(GATE_LOG);
  st = board.loadState(); st.queue = []; board.saveState(st);
  await board.deployAutoTick();
  st = board.loadState();
  assert.equal(st.deployAuto.demo.pending, undefined);
  assert.ok(Object.values(st.asks).some((a) => /고칠 일이 대기열에서 빠짐/.test(a.title)));
  // 주인이 직접 확인(ack)하면 맡지 않음
  press();
  failRun(GATE_LOG);
  st = board.loadState(); st.deployRuns.demo.ackAt = new Date().toISOString(); st.deployRuns.demo.ackBy = '__OWNER__'; board.saveState(st);
  await board.deployAutoTick();
  assert.equal(board.loadState().deployAuto.demo.pending, undefined);
});

test('성공하면 묶음을 지움 · 세 번째는 없음', () => {
  press({ n: 2 });
  const run = failRun(GATE_LOG, { via: 'auto' });
  let st = board.loadState();
  assert.equal(st.deployAuto.demo.pending, undefined, '2번 다 쓰면 자동 안 함');
  assert.match(Object.values(st.asks).find((a) => a.project === 'demo').question, /자동으로 다시 배포하지 않아요 — 자동 다시 배포 2번을 다 씀/);
  board.runnerDone(proj, { runId: 'okx', key: 'demo', result: 'ok', dry: false, via: 'auto', log: run.log });
  st = board.loadState();
  assert.equal(st.deployAuto.demo, undefined);
});

test('완료 검증 ① — HEAD 가 그대로여도 커밋 안 한 검사 파일 변경·새 검사 파일은 막음', async () => {
  press();
  const run = failRun(GATE_LOG);
  const st = board.loadState();
  const fixRoom = { id: 'fix00002', sessionId: 'sfix2', project: 'demo', name: '고침', turnOpen: false, lastActivity: Date.now() };
  const bd = { rooms: [fixRoom], completed: [] };
  fs.writeFileSync(path.join(dir, 'scripts', 'health-check.js'), 'loosened-uncommitted\n');
  assert.match(await board.deployAutoBlock(proj, run, { kind: 'fix' }, fixRoom, bd, st), /검사 파일이 바뀜: scripts\/health-check\.js/);
  git('checkout', '--', 'scripts/health-check.js');
  fs.writeFileSync(path.join(dir, 'scripts', 'health-new.js'), 'x\n');
  assert.match(await board.deployAutoBlock(proj, run, { kind: 'fix' }, fixRoom, bd, st), /health-new\.js/);
  fs.unlinkSync(path.join(dir, 'scripts', 'health-new.js'));
});

test('예고 → 5분 → 시작 · 실패 기록에 ackAt 안 찍음 · 전체 일시정지면 기다림 · 자동 실행이 또 실패하면 새 고칠 일 (완료 검증 ②③⑤)', async () => {
  const origCheck = runner.check;
  runner.check = async () => [{ code: 'approved', ok: true, text: 'ok' }];   // 승인 등은 위 시험에서 봄 — 여기선 흐름만
  const pj = path.join(sb.home, 'dev-server', 'projects.json');   // 틱은 projects.json 에서 솔루션을 찾음
  const pjs = JSON.parse(fs.readFileSync(pj, 'utf8')); const arr = pjs.projects || pjs;
  const i = arr.findIndex((x) => x.key === 'demo'); if (i >= 0) arr[i] = proj; else arr.push(proj);
  fs.writeFileSync(pj, JSON.stringify(pjs));
  try {
    press();
    const run = failRun('[ERROR] health-check 실패 — 배포 중단.\n깨진 항목:\n  1. [security] x\n      GET → 429 (expected 403): Too many requests\n');
    let st = board.loadState(); st.deployAuto.demo.pending.startAt = new Date(Date.now() - 1000).toISOString(); board.saveState(st);
    let r = await board.deployAutoTick();
    assert.deepEqual(r.did, ['demo:notice'], JSON.stringify(Object.values(board.loadState().asks).map((a) => a.title)));
    st = board.loadState();
    const notice = Object.values(st.asks).find((a) => /5분 뒤 자동으로 다시 배포 \(1\/2\)/.test(a.title));
    assert.ok(notice);
    // 5분 지남 + 전체 일시정지 → 기다림
    st.deployAuto.demo.pending.noticeAt = new Date(Date.now() - 6 * 60000).toISOString(); st.paused.all = { at: new Date().toISOString() }; board.saveState(st);
    r = await board.deployAutoTick();
    assert.deepEqual(r.did, []);
    st = board.loadState(); delete st.paused.all; board.saveState(st);
    r = await board.deployAutoTick();
    assert.deepEqual(r.did, ['demo:start']);
    st = board.loadState();
    assert.equal(st.deployAuto.demo.n, 1);
    assert.equal(st.deployRuns.demo.ackAt, undefined, '실패 기록에 주인 확인 표시 안 함');
    const gate = st.queue.find((q) => q.project === 'demo' && q.gate === 'deploy');
    assert.ok(gate && gate.autoRetry && gate.ack, '버튼과 같은 길(대기열 gate · auto)');
    assert.ok(Object.values(st.asks).some((a) => /자동으로 다시 배포 중/.test(a.title)));
    // 예고 카드를 닫으면 취소
    st.queue = st.queue.filter((q) => !q.gate); delete st.paused.demo; board.saveState(st);
    press();
    failRun(GATE_LOG);
    st = board.loadState();
    const fq = st.deployAuto.demo.pending.fixQid;
    // 고칠 일이 돌았고 시작됨 → 다음 실패에서 같은 방을 «일하는 중» 으로 안 잡음
    st.queue = st.queue.filter((q) => q.qid !== fq); st.qStarted = st.qStarted || {}; st.qStarted[fq] = { id: 'fix00003', at: new Date().toISOString() };
    st.deployFix.demo.doneAt = new Date().toISOString();   // 자동 시작이 찍는 값
    board.saveState(st);
    failRun(GATE_LOG, { via: 'auto' });
    st = board.loadState();
    const nf = st.queue.find((q) => q.deployFix);
    assert.ok(nf && nf.qid !== fq, '새 고칠 일');
    assert.equal(st.deployAuto.demo.pending.fixQid, nf.qid);
  } finally { runner.check = origCheck; }
});
