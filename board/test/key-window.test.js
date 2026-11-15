'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('../key-window');

const root = fs.mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'keywin-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const credFile = path.join(root, '.credentials.json'), offFile = path.join(root, 'KEYWIN-OFF');
let NOW = 1_800_000_000_000;
const MIN = 60e3;
const put = (exp, refresh = 'r'.repeat(100)) => fs.writeFileSync(credFile, JSON.stringify({ claudeAiOauth: { accessToken: 'a'.repeat(100), refreshToken: refresh, expiresAt: exp } }));
function mk(refreshImpl) {
  const logs = [], calls = [];
  const kw = create({ credFile, offFile, now: () => NOW, longKey: () => false, log: (e) => logs.push(e), tickMs: 1e9,
    refresh: (n, done) => { calls.push(n); refreshImpl(n, done); } });
  return { kw, logs, calls };
}

test('만료 10분 전 = 열림 · 6분 전 = 닫힘(미룸) · 4.5분 전 갱신 → 새 열쇠면 미룬 것 실행', () => {
  put(NOW + 10 * MIN);
  const { kw, logs, calls } = mk((n, done) => { put(NOW + 8 * 60 * MIN); done(null); });
  let ran = 0;
  kw.wait(() => ran++); assert.equal(ran, 1);
  NOW += 4.5 * MIN;                       // 5.5분 남음
  assert.equal(kw.closed(), true);
  kw.wait(() => ran++); assert.equal(ran, 1); assert.equal(kw.pending(), 1);
  kw.tick(); assert.equal(calls.length, 0, '아직 갱신 문턱(4.5분) 전');
  NOW += 1.1 * MIN;                       // 4.4분 남음
  kw.tick();
  assert.deepEqual(calls, [1]);
  assert.equal(ran, 2); assert.equal(kw.pending(), 0); assert.equal(kw.closed(), false);
  assert.ok(logs.find((l) => l.action === 'key-refresh' && l.ok === true));
  assert.ok(logs.find((l) => l.action === 'key-window-open'));
  kw.stop();
});

test('갱신이 안 되면 1분마다 3번 → 그 뒤 5분마다 · 30분 닫힌 뒤에만 포기 · 90초 넘게 기다린 명령은 «갱신 중» 으로 답함', () => {
  put(NOW + 4 * MIN);
  const { kw, logs, calls } = mk((n, done) => done('x'));
  let ran = 0, late = 0;
  kw.wait(() => ran++, () => late++);
  kw.tick(); kw.tick();                   // 바로 두 번 — 1분 안이라 한 번만
  assert.deepEqual(calls, [1]);
  NOW += 61e3; kw.tick();
  assert.equal(late, 0, '61초 — 아직 기다림'); assert.equal(kw.pending(), 1);
  NOW += 61e3; kw.tick();
  assert.equal(late, 1, '122초 → 실행 않고 onLate'); assert.equal(ran, 0); assert.equal(kw.pending(), 0);
  assert.deepEqual(calls, [1, 2, 3]);
  NOW += 61e3; kw.tick(); assert.equal(calls.length, 3, '3번 뒤엔 5분 간격');
  NOW += 4 * MIN; kw.tick(); assert.equal(calls.length, 4);
  assert.equal(kw.closed(), true, '아직 포기 안 함(만료 직전에 한꺼번에 풀지 않음)');
  NOW += 25 * MIN; kw.tick();
  assert.equal(kw.closed(), false); assert.ok(logs.find((l) => l.action === 'key-window-giveup'));
  put(NOW + 8 * 60 * MIN); kw.tick();    // 새 로그인 → 다음 창은 다시 지킴
  NOW += (8 * 60 - 5) * MIN; assert.equal(kw.closed(), true);
  kw.stop();
});

test('갱신이 열쇠를 비우면(거절) 더 안 막음 · 로그인 없음·1년 열쇠·OFF 파일이면 늘 열림', () => {
  put(NOW + 4 * MIN);
  const { kw, logs } = mk((n, done) => { put(0, ''); done(null); });
  let ran = 0; kw.wait(() => ran++); kw.tick();
  assert.equal(ran, 1); assert.ok(logs.find((l) => l.action === 'key-refresh' && l.wiped === true));
  kw.stop();
  fs.unlinkSync(credFile);
  assert.equal(mk(() => {}).kw.closed(), false);
  put(NOW + 2 * MIN);
  assert.equal(create({ credFile, offFile, now: () => NOW, longKey: () => true, refresh() {} }).closed(), false);
  fs.writeFileSync(offFile, ''); assert.equal(mk(() => {}).kw.closed(), false); fs.unlinkSync(offFile);
});

test('기록에 열쇠 글자 없음', () => {
  put(NOW + 4 * MIN);
  const { kw, logs } = mk((n, done) => { put(NOW + 480 * MIN); done(null); });
  kw.tick(); kw.stop();
  const all = JSON.stringify(logs);
  assert.ok(!/aaaaaaaaaa|rrrrrrrrrr/.test(all));
});

test('상황판: 창이 닫히면 claude agents 등은 미루고 -p 는 바로 · 방 목록은 직전 결과', async () => {
  const { loadBoard } = require('./sandbox');
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const { board, sb } = loadBoard();
  try {
    const cf = path.join(sb.home, '.claude', '.credentials.json');
    const putB = (exp) => fs.writeFileSync(cf, JSON.stringify({ claudeAiOauth: { accessToken: 'a'.repeat(100), refreshToken: 'r'.repeat(100), expiresAt: exp } }));
    putB(Date.now() + 60 * MIN);
    const first = await board.listAgents();
    assert.equal(first.ok, true);
    putB(Date.now() + 5.5 * MIN);
    assert.equal(board.keyWin.closed(), true);
    assert.equal(await board.listAgents(), first, '닫힌 동안 직전 목록');
    let agentsDone = false, pDone = false;
    board.execFile(process.env.CLAUDE_BIN, ['agents', '--json'], {}, () => { agentsDone = true; });
    await new Promise((r) => board.execFile(process.env.CLAUDE_BIN, ['-p', 'hi'], {}, () => { pDone = true; r(); }));
    assert.equal(pDone, true); assert.equal(agentsDone, false);
    putB(Date.now() + 480 * MIN); board.keyWin.tick();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(agentsDone, true, '열리면 미룬 명령 실행');
    // 재시작 직후(직전 목록 없음)엔 기다리지 않고 «못 읽음»
    board.keyWin.stop();
  } finally { board.keyWin.stop(); sb.cleanup(); }
});

test('상황판: 재시작 직후 창이 닫혀 있으면 방 목록은 기다리지 않고 바로 «못 읽음»', async () => {
  const { loadBoard } = require('./sandbox');
  const { board, sb } = loadBoard();
  try {
    fs.writeFileSync(path.join(sb.home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'a'.repeat(100), refreshToken: 'r'.repeat(100), expiresAt: Date.now() + 5 * MIN } }));
    const t0 = Date.now(); const r = await board.listAgents();
    assert.equal(r.ok, false); assert.equal(r.error, 'key-window'); assert.ok(Date.now() - t0 < 500);
  } finally { board.keyWin.stop(); sb.cleanup(); }
});
