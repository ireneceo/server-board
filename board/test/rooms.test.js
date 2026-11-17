// 방 상태 판정·터미널 창 대화·AI 로그인 끊김 — 상황판이 «무엇을 보여 주고 무엇을 저절로 하나» 의 뿌리
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());

const now = Date.now();
const bg = (o) => Object.assign({ kind: 'background', id: 'abcd1234', name: '일', state: 'idle', status: 'idle' }, o);
const tr = (o) => Object.assign({ lastReport: '', lastActivity: now }, o);

test('꺼진 방 — 보고 첫 줄로 상태', () => {
  assert.equal(board.judge(bg({}), tr({ lastReport: '✅ 완료 — 끝' }), now).code, 'done');
  assert.equal(board.judge(bg({}), tr({ lastReport: '⏸ 답 필요\n**할까요?**' }), now).code, 'waiting');
  assert.equal(board.judge(bg({}), tr({ lastReport: '❌ 막힘 — 권한' }), now).code, 'blocked');
  assert.equal(board.judge(bg({}), tr({ lastReport: '' }), now).code, 'off');
});

test('멈춘 방 — 로그인 만료 · 대화 너무 김 · 그 밖', () => {
  const login = board.judge(bg({ state: 'blocked' }), tr({ lastReport: 'Login expired · Please run /login' }), now);
  assert.equal(login.code, 'stopped'); assert.equal(login.loginGone, true);
  const long = board.judge(bg({ state: 'blocked' }), tr({ lastReport: 'Prompt is too long' }), now);
  assert.equal(long.code, 'stopped'); assert.equal(long.tooLong, true);
  const other = board.judge(bg({ state: 'blocked' }), tr({ lastReport: 'Hook blocked' }), now);
  assert.equal(other.code, 'stopped'); assert.ok(!other.loginGone && !other.tooLong);
});

test('일하는 중 · 30분 넘게 움직임 없으면 «멈춘 것 같음»', () => {
  assert.equal(board.judge(bg({ pid: 1, status: 'busy' }), tr({}), now).code, 'working');
  assert.equal(board.judge(bg({ pid: 1, status: 'busy' }), tr({ lastActivity: now - 31 * 60e3 }), now).code, 'stuck');
});

test('터미널 창 — 허락 창이면 맨 위로(termWin), 그 밖엔 그냥 터미널 창', () => {
  const w = board.judge({ kind: 'interactive', pid: 1, status: 'waiting', waitingFor: 'permission prompt' }, tr({}), now);
  assert.equal(w.code, 'waiting'); assert.equal(w.termWin, true);
  assert.equal(board.judge({ kind: 'interactive', pid: 1, status: 'busy' }, tr({}), now).code, 'working');
});

test('터미널 창에서 --resume 으로 연 대화를 알아봄', () => {
  const proc = path.join(sb.root, 'proc');
  const sid = 'ab12cd34-1111-2222-3333-444455556666';
  const mk = (pid, argv, tty) => {
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
    fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), argv.join('\0') + '\0');
    fs.writeFileSync(path.join(proc, String(pid), 'stat'), pid + ' (claude) S 1 ' + pid + ' ' + pid + ' ' + tty + ' 0 0');
  };
  mk(10, ['/home/x/.local/bin/claude', '--resume', sid], 0);          // 뒤에서 도는 것(터미널 없음) — 아님
  assert.equal(board.termHolder(sid, proc), null);
  mk(11, ['/home/x/.local/bin/claude', '--resume', 'ffffffff-0000'], 34817);   // 다른 대화 — 아님
  assert.equal(board.termHolder(sid, proc), null);
  mk(12, ['/home/x/.local/share/claude/versions/2.1.314', '-r', sid.slice(0, 8)], 34818);   // 터미널 + 같은 대화(앞 8자리)
  assert.deepEqual(board.termHolder(sid, proc), { pid: 12, tty: 34818 });
  mk(13, ['/usr/bin/vim', '--resume', sid], 34819);                   // claude 가 아닌 프로그램 — 아님
  fs.rmSync(path.join(proc, '12'), { recursive: true });
  assert.equal(board.termHolder(sid, proc), null);
});

test('AI 연결 — 로그인 뒤 «Login expired» 로 멈춘 방이 있으면 끊김, 오래된 것은 아님', () => {
  const room = (t) => ({ status: { loginGone: true }, lastActivity: t });
  const v = board.aiView([room(now - 60e3)], now);
  assert.equal(v.expired, true); assert.equal(v.loggedIn, false); assert.equal(v.stopped, 1);
  const old = board.aiView([room(now - 13 * 3600e3)], now);
  assert.ok(!old || !old.expired);
  // 열쇠 파일이 그 방보다 나중이면(다시 로그인함) 끊김 아님
  fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, '.claude', '.credentials.json'), '{}');
  const after = board.aiView([room(now - 60e3)], now);
  assert.ok(!after || !after.expired);
});

test('상황판에서 AI 다시 로그인 — 주소 받기 · 다른 주소 코드 · 틀린 코드 · 맞는 코드', async () => {
  const s = await board.aiLoginStart('claudeai');
  assert.equal(s.ok, true); assert.match(s.url, /state=STATE123/);
  const other = await board.aiLoginCode('GOOD#OTHER');
  assert.equal(other.code, 'OTHER_LINK');          // 창은 열린 채
  const bad = await board.aiLoginCode('BAD#STATE123');
  assert.equal(bad.ok, false); assert.equal(bad.code, 'BAD_CODE');
  const s2 = await board.aiLoginStart('claudeai');
  assert.equal(s2.ok, true);
  const good = await board.aiLoginCode('GOOD#STATE123');
  assert.equal(good.ok, true);
  assert.equal(board.authStatus().loggedIn, true);
  const closed = await board.aiLoginCode('GOOD#STATE123');
  assert.equal(closed.code, 'NOT_STARTED');
  board.aiLoginStop();
});

test('로그인 만료 문구 — Claude Code 가 쓰는 말들', () => {
  for (const t of ['Login expired · Please run /login', 'OAuth token has expired', 'Invalid API key · Please run /login', 'Not logged in'])
    assert.ok(board.LOGIN_GONE_RE.test(t), t);
  assert.ok(!board.LOGIN_GONE_RE.test('✅ 완료 — 로그인 화면 고침'));
});

// Claude Code 업데이트로 명령이 바뀌면 — 점검이 실패를 잡고, 기록·알림을 남김 (판매 전 조건 ③)
test('Claude Code 점검 — 그대로면 통과 · 명령이 없어지면 실패로 잡고 알림', async () => {
  const ok = await board.claudeContract();
  assert.equal(ok.version, '9.9.9'); assert.equal(ok.ok, true, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  process.env.FAKE_HELP = 'old';
  try {
    const r = await board.claudeCheckRun('test');
    assert.equal(r.ok, false);
    assert.ok(r.fails.some((f) => /--bg/.test(f.detail)), JSON.stringify(r.fails));
    assert.equal(board.loadState().claudeCheck.ok, false);
    const n = JSON.parse(fs.readFileSync(path.join(sb.dir, 'log', 'notify.json'), 'utf8')).notices;
    assert.ok(n.some((x) => /9\.9\.9/.test(x.title)), '알림 한 건');
  } finally { delete process.env.FAKE_HELP; }
  const back = await board.claudeCheckRun('test');
  assert.equal(back.ok, true); assert.equal(back.okVersion, '9.9.9');
});

test('방 목록 — id 없는 터미널 창 줄: 점검 통과 · 방 목록에 sessionId 로 보임 · 둘 다 없는 줄은 건너뜀', async () => {
  const cwd = path.join(sb.root, 'proj');
  process.env.FAKE_AGENTS = JSON.stringify([
    { kind: 'interactive', sessionId: 'aaaa0001-0000-0000-0000-000000000000', cwd, startedAt: Date.now() },
    { kind: 'interactive', cwd },
  ]);
  try {
    board.resetAgentsCache();
    const c = await board.claudeContract();
    assert.equal(c.ok, true, JSON.stringify(c.checks.filter((x) => !x.ok)));
    board.resetAgentsCache();
    const b = await board.buildBoard();
    const t = b.rooms.filter((r) => r.kind === 'interactive');
    assert.equal(t.length, 1); assert.equal(t[0].id, null); assert.equal(t[0].sessionId, 'aaaa0001-0000-0000-0000-000000000000'); assert.equal(t[0].attach, null);
    process.env.FAKE_AGENTS = JSON.stringify([{ kind: 'background', sessionId: 'bbbb0001-0000-0000-0000-000000000000', cwd, name: 'x', state: 'done', startedAt: 1 }]);
    const c2 = await board.claudeContract();
    assert.ok(c2.checks.some((x) => !x.ok && /background\.id/.test(x.detail)), '작업방 줄에 id 가 없으면 잡음');
  } finally { delete process.env.FAKE_AGENTS; board.resetAgentsCache(); }
});

test('원본 폴더 작업이 none 이 아니고 커밋 안 한 변경이 있으면 일 넣을 때 경고', async () => {
  const { execFileSync } = require('child_process');
  const dir = path.join(sb.root, 'wtproj'); fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  const proj = { key: 'wt', dir };
  fs.writeFileSync(path.join(sb.home, '.claude', 'settings.json'), JSON.stringify({ worktree: { bgIsolation: 'none' } }));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.equal(await board.worktreeWarn(proj), '');   // none — 원본에서 일함
  fs.writeFileSync(path.join(sb.home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
  assert.match(await board.worktreeWarn(proj), /커밋 안 한 변경 1개/);   // 비어 있음 = worktree
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ worktree: { bgIsolation: 'none' } }));
  assert.equal(board.bgIsolationOf(dir), 'none');   // 솔루션 설정이 우선
  assert.equal(await board.worktreeWarn(proj), '');
  fs.rmSync(path.join(sb.home, '.claude', 'settings.json'));
});

test('보고 뒤 마무리 검사(Stop 훅)에 막혀 덧붙인 말 — 앞 보고(✅)를 이 방의 보고로', () => {
  const cwd = path.join(sb.root, 'hookproj'), sid = 'bead0001-0000-0000-0000-000000000000';
  const file = board.transcriptPath(cwd, sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const L = (o) => JSON.stringify(o);
  const ts = (m) => new Date(now - m * 60e3).toISOString();
  fs.writeFileSync(file, [
    L({ type: 'user', timestamp: ts(10), message: { role: 'user', content: '일 해 줘' } }),
    L({ type: 'assistant', timestamp: ts(5), message: { role: 'assistant', content: [{ type: 'text', text: '✅ 완료 — 고쳤어요' }] } }),
    L({ type: 'user', isMeta: true, timestamp: ts(4), message: { role: 'user', content: 'Stop hook feedback: [fable-gate] 정지' } }),
    L({ type: 'assistant', timestamp: ts(3), message: { role: 'assistant', content: [{ type: 'text', text: 'This stop is not caused by this work.' }] } })
  ].join('\n') + '\n');
  const t = board.readTranscript(file);
  assert.match(t.lastReport, /^✅ 완료/);
  assert.match(t.afterHook, /This stop/);
  const j = board.judge(bg({ state: 'blocked' }), t, now);
  assert.equal(j.code, 'done'); assert.ok(j.stopNote);
  // 사람 말이 끼면 지난 차례 보고 — 쓰지 않음
  fs.appendFileSync(file, L({ type: 'user', timestamp: ts(2), message: { role: 'user', content: '다시 해 줘' } }) + '\n'
    + L({ type: 'assistant', timestamp: ts(1), message: { role: 'assistant', content: [{ type: 'text', text: '하는 중' }] } }) + '\n');
  const t2 = board.readTranscript(file);
  assert.equal(t2.lastReport, '하는 중');
  assert.equal(board.judge(bg({ state: 'blocked' }), t2, now).resolve.auto, false, '까닭 모르는 보고 없이 멈춤 — 👉 __OWNER__');
});

test('🕓 기다림 — 이름은 무엇을 · resolve 는 언제·누가 · 앞날짜는 그날까지', () => {
  const t0 = Date.parse('2026-11-01T03:00:00Z');
  const d = board.laterStatus('🕓 나중에 — 11-09 새 기능 출시: 11-02~11-08 시험을 지나야', t0);
  assert.equal(d.until, 20261109); assert.match(d.label, /11-09/); assert.equal(d.resolve.auto, true);
  assert.equal(board.laterStatus('🕓 나중에 — 운영 배포 뒤 확인', t0).wait, 'deploy');
  assert.equal(board.laterStatus('🕓 나중에 — __OWNER__ 가 키를 보내 주시면', t0).resolve.auto, false);
  assert.equal(board.laterStatus('🕓 나중에 — 태블릿 종이 확인(할 일 카드 «태블릿에 … 확인하기»)이 «✓ 좋아요» 가 되면', t0).wait, 'owner', '카드 기다림은 __OWNER__ 행동');
  assert.equal(board.laterStatus('🕓 나중에 — 10-20 에 했던 것 다시 볼 때', t0).until, undefined, '지난 날짜는 무시');
  assert.equal(board.laterUntil('버전 1.2.3 · 07:00', t0), null);
  assert.equal(board.laterUntil('11월 5일 이후', t0), 20261105);
});

test('묵은 멈춤 정리 — 뒤 점검이 끝난 점검 방 · 쌍둥이 방이 이어 간 허락 창 방 · 보통 «■ 중지» 는 그대로', () => {
  const st = { parked: {}, completed: {}, queue: [], stopInfo: { s2: { by: 'aside', at: new Date(now - 3600e3).toISOString() } } };
  const R = (o) => Object.assign({ kind: 'background', alive: false, project: 'demo', cwd: '/nowhere' }, o);
  const rooms = [
    R({ id: 's1', sessionId: 's1', name: '정기 점검 10/28 00:00', startedAt: now - 5 * 864e5, status: { code: 'stopped' } }),
    R({ id: 'n1', sessionId: 'n1', name: '정기 점검 10/29 00:00', startedAt: now - 4 * 864e5, status: { code: 'done' } }),
    R({ id: 's2', sessionId: 's2', name: '관리자 메뉴', startedAt: now - 2 * 3600e3, status: { code: 'stopped' } }),
    R({ id: 't2', sessionId: 't2', name: '관리자  메뉴', startedAt: now - 3000e3, status: { code: 'done' } }),
    R({ id: 's3', sessionId: 's3', name: '보통 일', startedAt: now - 3600e3, status: { code: 'stopped' } }),
    R({ id: 's4', sessionId: 's4', name: '정기 점검 11/01 00:00', startedAt: now - 3600e3, status: { code: 'stopped' } })
  ];
  const out = board.retireStops(rooms, st, now).map((x) => x.r.id).sort();
  assert.deepEqual(out, ['s1', 's2']);
  assert.equal(board.gateKind('아침 점검 10/01'), '정기 점검');
});

test('문제없이 끝난 점검·배포 방 정리 — ✅ 이고 남은 카드 없는 정해진 일 방만', () => {
  const st = { parked: {}, completed: {}, queue: [{ resumeSessionId: 'q1' }], asks: { x: { sessionId: 'c1' } } };
  const R = (o) => Object.assign({ kind: 'background', alive: false, project: 'demo', cwd: '/nowhere', status: { code: 'done' }, lastReport: '✅ 완료 — 끝' }, o);
  const rooms = [
    R({ id: 'a1', sessionId: 'a1', name: '정기 점검 11/03 00:00' }),
    R({ id: 'a2', sessionId: 'a2', name: '할 일 점검: 3장' }),
    R({ id: 'a3', sessionId: 'a3', name: '답: WorkApp 정기 점검 — 배포는 뺌(확인 안 된 일 9개)' }),
    R({ id: 'a4', sessionId: 'a4', name: '답: ShopApp 운영 배포가 밀림 — 1일째' }),
    R({ id: 'c1', sessionId: 'c1', name: '답: ShopApp 정기 점검 — 배포는 뺌(35개)' }),
    R({ id: 'w1', sessionId: 'w1', name: '정기 점검 11/02 00:00', lastReport: '⏸ 답 필요 — 배포할까요?' }),
    R({ id: 'q1', sessionId: 'q1', name: '할 일 점검: 1장' }),   // 답이 줄 서 있음
    R({ id: 'o1', sessionId: 'o1', name: '레스토랑 오너 발주 승인 탭 검토' }),
    R({ id: 'b1', sessionId: 'b1', name: '정기 점검 11/04 00:00', alive: true, idle: false }),
    R({ id: 'l1', sessionId: 'l1', name: '할 일 점검: 2장', status: { code: 'later' } })
  ];
  const out = board.retireStops(rooms, st, now).map((x) => x.r.id).sort();
  assert.deepEqual(out, ['a1', 'a2', 'a3', 'a4']);
});

test('배포 준비 방 — 일시정지를 쥔 동안은 치우지 않음 · 앞말 붙은 ✅ 도 ✅', () => {
  const R = (o) => Object.assign({ kind: 'background', alive: false, project: 'demo', cwd: '/nowhere', status: { code: 'done' }, lastReport: '✅ 배포 준비 끝' }, o);
  const st = { parked: {}, completed: {}, queue: [], asks: {}, paused: { demo: { gate: 'deploy', gateRoom: 'p1', runnerPending: true } } };
  const rooms = [R({ id: 'p1', sessionId: 'p1', name: '배포 준비' }), R({ id: 'p2', sessionId: 'p2', name: '배포 준비' })];
  assert.deepEqual(board.retireStops(rooms, st, now).map((x) => x.r.id), ['p2']);
  assert.equal(board.reportOk('✅ 배포 준비 끝'), true);
  assert.equal(board.reportOk('이제 보고만 남았습니다.\n\n✅ 배포 준비 끝'), true);
  assert.equal(board.reportOk('⏸ 답 필요\n✅ 준비는 끝'), false);
  assert.equal(board.reportOk('배포 준비 끝'), false);
  assert.equal(board.reportOk(''), false);
});
