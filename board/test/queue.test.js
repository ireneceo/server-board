'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const blank = () => board.loadState();

test('대기 일에 말 덧붙이기 — 빈 말·없는 일·상황판이 정한 글은 거절 · 선검사 다시', () => {
  const st = blank();
  st.queue = [{ qid: 'q1', project: 'demo', task: '처음 글', check: { verdict: 'done', at: new Date().toISOString() } }, { qid: 'g1', project: 'demo', task: '/배포', gate: 'deploy' }];
  assert.equal(board.queueAppend(st, 'q1', '  ').code, 400);
  assert.equal(board.queueAppend(st, 'nope', '말').code, 404);
  assert.equal(board.queueAppend(st, 'g1', '말').code, 400);
  const r = board.queueAppend(st, 'q1', '하나 더', new Date('2026-10-30T01:02:00Z'));
  assert.equal(r.ok, true); assert.equal(r.recheck, true);
  assert.match(st.queue[0].task, /처음 글\n\n\[__OWNER__ 덧붙임 2026-10-30 01:02 UTC\]\n하나 더$/);
  assert.equal(st.queue[0].notes, 1); assert.equal(st.queue[0].check, undefined);
});

test('선검사 — 대상 · 답 읽기', () => {
  assert.equal(board.needsCheck({ task: '고쳐 줘' }), true);
  for (const k of ['gate', 'priority', 'manualRun', 'note', 'handoverFrom']) assert.equal(board.needsCheck({ task: '고쳐 줘', [k]: 'x' }), false, k);
  assert.equal(board.needsCheck({ task: '/개발완료' }), false);
  assert.deepEqual(board.parseCheck('blah {"verdict":"done","evidence":"abc123 커밋"} 끝'), { verdict: 'done', evidence: 'abc123 커밋' });
  assert.equal(board.parseCheck('{"verdict":"maybe"}'), null);
  assert.equal(board.parseCheck('글만'), null);
});

test('선검사 근거 — 커밋 시각이 상황판 시간대 · 시간 차 안내', async () => {
  const repo = path.join(sb.root, 'proj');
  execFileSync('git', ['init', '-q', repo]);
  const env = Object.assign({}, process.env, { GIT_AUTHOR_DATE: '2026-10-30T10:15:00Z', GIT_COMMITTER_DATE: '2026-10-30T10:15:00Z', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', '배포 실패 원인 고침'], { env });
  const lines = await board.gitRecent(repo, 3650);
  assert.match(lines[0], /^[0-9a-f]+ 2026-10-30 19:15 배포 실패 원인 고침$/);   // 서울 = UTC+9
  assert.equal(board.tzOffsetText(Date.parse('2026-10-30T00:00:00Z')), '+9h');
  const prompt = board.checkPrompt({ name: 'Demo' }, { task: '19:17 배포 실패', createdAt: '2026-10-30T11:17:00Z' }, { commits: lines, done: [], notes: [], live: [], queued: [] });
  assert.match(prompt, /UTC.*\+9h/);
  assert.match(prompt, /넣은 날 2026-10-30 20:17/);
});

test('직접 할 일 — 날짜·먼저 할 카드를 기다림', () => {
  const st = blank();
  const now = Date.parse('2026-10-30T03:00:00Z');
  assert.equal(board.todoWaiting(st, { aid: 't1', title: '공개하기', after: '2026-11-06', createdAt: '2026-10-30T00:00:00Z' }, now).until, '2026-11-06');
  assert.equal(board.todoWaiting(st, { aid: 't2', title: '11-03 이후 GTM 게시', createdAt: '2026-10-30T00:00:00Z' }, now).until, '2026-11-03');
  assert.equal(board.todoWaiting(st, { aid: 't3', title: '공개하기', after: '2026-10-01', createdAt: '2026-10-30T00:00:00Z' }, now), null);
  st.asks = { a: { aid: 'a', kind: 'todo', title: '저장소 만들기', project: 'server' } };
  assert.equal(board.todoWaiting(st, { aid: 'b', title: '공개', waitFor: 'a', createdAt: '2026-10-30T00:00:00Z' }, now).forTid, 'a');
});

test('직접 할 일 순서 — 다른 카드가 기다리는 앞 카드 먼저 · 그다음 오래된 것부터 · 날짜 카드는 그날부터', () => {
  const now = Date.parse('2026-11-15T03:00:00Z');
  const out = [
    { aid: 'new', kind: 'todo', title: '어제 들어온 일', createdAt: '2026-11-14T00:00:00Z' },
    { aid: 'old', kind: 'todo', title: '한 달 된 일', createdAt: '2026-10-12T00:00:00Z' },
    { aid: 'pre', kind: 'todo', title: '저장소 만들기', createdAt: '2026-11-10T00:00:00Z' },
    { aid: 'post', kind: 'todo', title: '출시 점검', createdAt: '2026-10-30T00:00:00Z', after: '2026-11-19', waitFor: 'pre', waiting: { until: '2026-11-19' } },
    { aid: 'dated', kind: 'todo', title: '11-03 이후 게시', createdAt: '2026-10-18T00:00:00Z', after: '2026-11-03' },
    { aid: 'q', kind: 'ask', title: '질문은 그대로', createdAt: '2026-11-15T00:00:00Z' },
    { aid: null, owner: true, from: 'state', title: '작업기록 줄', createdAt: null },
  ];
  const order = board.todoRank(out, now).map((o) => o.aid || 'state');
  assert.deepEqual(order, ['pre', 'old', 'post', 'dated', 'new', 'state']);
  assert.equal(out.find((o) => o.aid === 'pre').unblocks[0].tid, 'post');
  assert.equal(out.find((o) => o.aid === 'q').rank, undefined);
});

test('직접 할 일 — 솔루션이 달라도 같은 외부 번호면 겹침', () => {
  const st = blank();
  st.asks = { a: { aid: 'a', kind: 'todo', project: 'workapp', title: 'GTM-TEST1234 게시' }, c: { aid: 'c', kind: 'todo', project: 'studyapp', title: '다른 일' } };
  const o = board.todoOverlap(st, { aid: 'b', project: 'shopapp', title: '컨테이너 GTM-TEST1234 병합' });
  assert.equal(o.length, 1); assert.equal(o[0].tid, 'a');
  assert.deepEqual(board.todoOverlap(st, { aid: 'd', project: 'shopapp', title: '번호 없음' }), []);
});

test('한도 중 — 손으로 누른 우선 실행만 바로, 배포 버튼이 줄 서 있으면 그 뒤', async () => {
  const bgLog = path.join(sb.root, 'bg.log');
  const st = blank();
  const old = new Date(Date.now() - 60e3).toISOString();
  st.queue = [{ qid: 'auto1', project: 'demo', title: '자동 우선', task: '자동', priority: true, createdAt: old },
    { qid: 'hand1', project: 'demo', title: '손 우선', task: '손으로 누름', priority: true, hand: true, createdAt: old }];
  st.queue.push({ qid: 'dep1', project: 'demo', title: '배포', task: '/배포', gate: 'deploy', createdAt: old });
  board.saveState(st);
  await board.startHandNow({});
  assert.ok(board.loadState().queue.some((q) => q.qid === 'hand1'), '배포 버튼 일이 먼저 — 손 우선은 그 뒤');
  const st2 = board.loadState(); st2.queue = st2.queue.filter((q) => q.qid !== 'dep1'); board.saveState(st2);
  await board.startHandNow({});
  const left = board.loadState().queue.map((q) => q.qid);
  assert.ok(!left.includes('hand1'), '손 우선 일이 시작돼 대기열에서 빠짐');
  assert.ok(left.includes('auto1'), '자동 우선은 한도 동안 기다림');
  assert.ok(fs.readFileSync(bgLog, 'utf8').includes('손으로 누름'));
});

test('🕓 방 다음 차례 — 처음은 넣고, 그 차례에 «아직» 으로 다시 🕓 하면 곧바로 또 넣지 않음', () => {
  const sid = 'cafe0001-0000-0000-0000-000000000000', cwd = path.join(sb.root, 'proj');
  const tdir = path.join(sb.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  const say = (t) => fs.writeFileSync(path.join(tdir, sid + '.jsonl'), JSON.stringify({ type: 'user', message: { role: 'user', content: t } }) + '\n');
  const room = (repAt) => ({ kind: 'background', id: sid.slice(0, 8), sessionId: sid, cwd, name: '기다리는 방', project: 'demo', lastReportAt: repAt, status: { code: 'later', wait: 'other' } });
  const st = blank(); st.queue = [];
  const t0 = Date.parse('2026-10-30T16:00:00Z');
  say('처음 일');
  board.queueLaterRooms([room(t0)], st, t0 + 1000);
  assert.equal(st.queue.length, 1, '처음 🕓 는 다음 차례로');
  st.queue = [];
  say('[상황판 다음 차례] 이 방은 첫 줄 🕓 로 멈춰 있었고 …');
  board.queueLaterRooms([room(t0 + 60e3)], st, t0 + 90e3);
  assert.equal(st.queue.length, 0, '«아직» 답 30초 뒤 — 또 넣지 않음');
  board.queueLaterRooms([room(t0 + 60e3)], st, t0 + 7 * 3600e3);
  assert.equal(st.queue.length, 1, '6시간 뒤엔 다시 한 번 확인');
  st.queue = [];
  say('[상황판 — AI 로그인 다시 됨] Claude 로그인이 끊겨 멈췄던 일이야.');
  board.queueLaterRooms([room(t0 + 7 * 3600e3 + 60e3)], st, t0 + 7 * 3600e3 + 90e3);
  assert.equal(st.queue.length, 0, '«로그인 다시 됨» 차례의 🕓 도 «아직» 으로 봄');
  say('[상황판에서 __OWNER__ 가 보낸 답]\n이제 했어');
  board.queueLaterRooms([room(t0 + 8 * 3600e3)], st, t0 + 8 * 3600e3 + 1000);
  assert.equal(st.queue.length, 1, '사람 답 뒤의 새 🕓 는 바로');
});

test('선검사 판정 적용 — 묻는 카드 없이 합치기·기다리기·빼고 알림·시작', () => {
  const proj = { key: 'demo', name: 'Demo' };
  const at = new Date().toISOString();
  const mk = () => { const st = blank(); st.asks = {}; st.completed = {}; st.checkClosed = [];
    st.queue = [{ qid: 'a', project: 'demo', title: 'AI 접속 점검', task: '터미널 안내에 서버 들어가는 명령도', createdAt: at }, { qid: 'b', project: 'demo', title: 'AI 끊김 원인 점검', task: '왜 끊기나', createdAt: at }];
    return st; };
  // ① 같은 요청이 다른 대기 일 → 그 일 끝에 글을 붙이고 뺌, 카드 없음
  let st = mk(); let q = st.queue[0]; let c = { verdict: 'superseded', ref: 'AI 끊김 원인 점검', evidence: 'x', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [st.queue[1]], liveRooms: [], commits: [] }).act, 'merge');
  assert.deepEqual(st.queue.map((x) => x.qid), ['b']);
  assert.match(st.queue[0].task, /같은 일이라 합침[\s\S]*서버 들어가는 명령도/);
  assert.equal(Object.keys(st.asks).length, 0);
  // ② «일하는 중» 방이 맡음 → 기다림(대기열이 건너뜀) · 방이 멈추면 다시 선검사
  st = mk(); q = st.queue[0]; c = { verdict: 'superseded', ref: 'ai 왜 자꾸 끊겨?', evidence: 'x', at };
  const room = { id: 'r1', name: 'ai 왜 자꾸 끊겨?', turnOpen: true, status: { code: 'working' } };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [room], commits: [] }).act, 'wait');
  q.check = c;
  assert.equal(board.checkHeld(q), true); assert.equal(board.checkOk(q), false);
  assert.equal(board.checkWaitTick(st, [room]), 0);
  assert.equal(board.checkWaitTick(st, [{ ...room, turnOpen: false, status: { code: 'waiting' } }]), 1);
  assert.equal(q.check, undefined);
  // ②' 답 기다림 방을 짚으면 맡은 게 아님 → 그냥 시작
  st = mk(); q = st.queue[0]; c = { verdict: 'superseded', ref: 'ai 왜 자꾸 끊겨?', evidence: 'x', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [{ ...room, turnOpen: false, status: { code: 'waiting' } }], commits: [] }).act, 'go');
  q.check = c; assert.equal(board.checkOk(q), true); assert.equal(board.checkHeld(q), false);
  assert.match(board.checkHead(q), /확인할 수 없어 시작함/);
  // ②'' 답 기다림 방을 짚었어도 근거의 커밋이 해냈으면 → 빼고 알림
  st = mk(); q = st.queue[0]; c = { verdict: 'superseded', ref: 'ai 왜 자꾸 끊겨?', evidence: 'b2c3d4e 가 원인 조사를 했다', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [{ ...room, turnOpen: false, status: { code: 'waiting' } }], commits: ['b2c3d4e 2026-11-01 12:30 AI 끊김 원인 조사'] }).act, 'close');
  // ③ 끝난 일이 해냄 → 빼고 «확인» 알림(링크) · «안 됐어요 — 다시 하기» 로 되돌림
  st = mk(); q = st.queue[0];
  st.completed = { x: { id: 'abcd1234', name: 'AI 접속 안내 고침', project: 'demo', startedAt: at, report: '✅ 완료\n- http://localhost:8800 — 안내 확인', links: [{ url: 'http://localhost:8800', label: '안내 확인' }] } };
  c = { verdict: 'done', ref: 'AI 접속 안내 고침', evidence: '끝난 일이 해냄', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [st.queue[1]], liveRooms: [], commits: [] }).act, 'close');
  assert.deepEqual(st.queue.map((x) => x.qid), ['b']);
  const seen = Object.values(st.asks);
  assert.equal(seen.length, 1); assert.equal(seen[0].kind, 'seen'); assert.equal(seen[0].links[0].url, 'http://localhost:8800');
  assert.doesNotMatch(seen[0].title + seen[0].question, /할까요\?|필요해요\?/);
  assert.equal(board.seenAnswer(st, seen[0].aid, 'redo').ok, true);
  const back = st.queue.find((x) => x.qid === 'a');
  assert.equal(board.checkOk(back), true); assert.match(board.checkHead(back), /다시 하기/);
  // ④ 근거를 못 찾음(지어낸 해시) → 그냥 시작
  st = mk(); q = st.queue[0]; c = { verdict: 'done', ref: 'deadbeef1', evidence: 'deadbeef1 커밋', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [], commits: ['1234abc 2026-11-01 10:00 다른 일'] }).act, 'go');
  // ⑤ 커밋 해시로 해냄 → 빼고 알림
  st = mk(); q = st.queue[0]; c = { verdict: 'done', ref: '1234abc', evidence: '1234abc 가 고침', at };
  assert.equal(board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [], commits: ['1234abc 2026-11-01 10:00 AI 접속 안내'] }).act, 'close');
  assert.match(Object.values(st.asks)[0].question, /1234abc 2026-11-01 10:00 AI 접속 안내/);
  // ⑤' 알림 첫 줄(굵게)에 «무엇이 됐는지» — 맡긴 일 제목이 잘린 원문이어도
  { const s5 = Object.values(st.asks).find((x) => x.kind === 'seen');
    assert.match(s5.title, /^이미 했어요: AI 접속 안내 — 대기열에서 뺐어요$/);
    assert.match(s5.question, /^\*\*이미 된 것: AI 접속 안내 \(커밋 1234abc · 2026-11-01 10:00\)\*\*/);
    assert.match(s5.recommend, /1234abc/); }
  st = mk(); q = st.queue[0]; q.title = '답: (이전 —  2026-11-13 → ① 대화방';
  c = { verdict: 'done', ref: 'a1b2c3d4', what: '채팅 알림 끄기', evidence: 'e', at };
  board.checkApply(st, proj, q, c, { queuedQ: [], liveRooms: [], commits: ['a1b2c3d4 2026-11-01 09:30 feat(chat): 채팅 알림 끄기(나만) — 보통 메시지'] });
  { const s6 = Object.values(st.asks).find((x) => x.kind === 'seen');
    assert.equal(s6.title, '이미 했어요: 채팅 알림 끄기 — 대기열에서 뺐어요');
    assert.match(s6.question, /^\*\*이미 된 것: 채팅 알림 끄기 \(커밋 a1b2c3d4 · 2026-11-01 09:30\)\*\*\n\n뺀 일: «답: \(이전/); }
  assert.equal(board.seenWhat({}, { commit: { hash: 'a1b2c3d4', line: 'a1b2c3d4 2026-11-01 09:30 feat(chat): 채팅 알림 끄기(나만) — 보통 메시지' } }), '채팅 알림 끄기(나만)');
  assert.equal(board.parseCheck('{"verdict":"done","ref":"x","what":"**채팅** 알림 끄기","evidence":"e"}').what, '채팅 알림 끄기');
  // 옛 «아직 필요해요?» 판정(카드 기다림)은 더는 막지 않고 다시 선검사
  assert.equal(board.checkHeld({ task: 't', check: { verdict: 'superseded', evidence: 'x', at } }), false);
  assert.equal(board.parseCheck('{"verdict":"done","ref":"abc1234","evidence":"e"}').ref, 'abc1234');
});

test('허락 창 비켜 세움 카드 — 같은 이름 쌍둥이 방에서 __OWNER__ 가 말했거나 방이 지워졌으면 빠짐', () => {
  const cwd = path.join(sb.root, 'proj');
  const tdir = path.join(sb.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  const s1 = 'aaaa0001-0000-0000-0000-000000000000', s2 = 'bbbb0002-0000-0000-0000-000000000000', s3 = 'cccc0003-0000-0000-0000-000000000000';
  const line = (t, at) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: t } }) + '\n';
  fs.writeFileSync(path.join(tdir, s1 + '.jsonl'), line('[상황판에서 __OWNER__ 가 맡긴 일] 관리자 메뉴', '2026-11-01T04:17:58Z'));
  fs.writeFileSync(path.join(tdir, s2 + '.jsonl'), line('[상황판에서 __OWNER__ 가 맡긴 일] 관리자 메뉴', '2026-11-01T04:18:07Z') + line('그래서 뭐가 문제야?', '2026-11-01T04:45:00Z'));
  fs.writeFileSync(path.join(tdir, s3 + '.jsonl'), line('[상황판에서 __OWNER__ 가 맡긴 일] 다른 일', '2026-11-01T04:18:07Z') + line('다른 방에 한 말', '2026-11-01T04:45:00Z'));
  const room = (sid, name) => ({ kind: 'background', id: sid.slice(0, 8), sessionId: sid, cwd, name, project: 'demo', status: { code: 'stopped' } });
  const ask = (aid, sid, name) => ({ aid, project: 'demo', room: sid.slice(0, 8), sessionId: sid, roomName: name, title: '«' + name + '» 방이 일하던 중 물음 (허락 창)', question: 'Hook …', options: [], createdAt: '2026-11-01T04:39:24.929Z', bySetAside: true, permissionAsk: true, terminal: [] });
  const projects = board.loadProjects();
  let st = blank(); st.asks = { a1: ask('a1', s1, '관리자 메뉴 1.') };
  let out = board.collectAsks(projects, [room(s1, '관리자 메뉴 1.'), room(s2, '관리자  메뉴 1.')], st);
  assert.ok(!out.some((a) => a.aid === 'a1'), '쌍둥이 방 답으로 빠짐');
  // ② 이름이 다른 방에서 한 말은 답이 아님 → 남음
  st = blank(); st.asks = { a2: ask('a2', s1, '관리자 메뉴 1.') };
  out = board.collectAsks(projects, [room(s1, '관리자 메뉴 1.'), room(s3, '다른 일')], st);
  assert.ok(out.some((a) => a.aid === 'a2'), '다른 일 방의 말로는 안 빠짐');
  // ③ 카드의 방이 목록에서 지워짐 → 빠짐 (방 목록이 비었으면 판단 안 함)
  st = blank(); st.asks = { a3: ask('a3', s1, '관리자 메뉴 1.') };
  out = board.collectAsks(projects, [], st);
  assert.ok(out.some((a) => a.aid === 'a3'), '방 목록을 못 읽으면 그대로');
  out = board.collectAsks(projects, [room(s3, '다른 일')], st);
  assert.ok(!out.some((a) => a.aid === 'a3'), '방이 지워졌으면 빠짐');
});

test('🕓 방 다음 차례 — 적힌 앞날짜 전엔 넣지 않고 그날 넣음', () => {
  const sid = 'cafe0002-0000-0000-0000-000000000000', cwd = path.join(sb.root, 'proj2');
  const st = blank(); st.queue = [];
  const t0 = Date.parse('2026-11-01T03:00:00Z');
  const room = (at) => ({ kind: 'background', id: sid.slice(0, 8), sessionId: sid, cwd, name: '날짜 기다림', project: 'demo', lastReportAt: t0, status: board.laterStatus('🕓 나중에 — 11-09 출시 점검', at) });
  board.queueLaterRooms([room(t0)], st, t0 + 1000);
  assert.equal(st.queue.length, 0, '11-09 전 — 안 넣음');
  const d9 = Date.parse('2026-11-09T01:00:00Z');
  board.queueLaterRooms([room(d9)], st, d9);
  assert.equal(st.queue.length, 1, '11-09 — 넣음');
});

test('직접 할 일 — «켜고 확인하기» 는 확인 카드가 아님 · «좋아요» 뒤 다시 올림 감지', () => {
  assert.equal(board.todoIsCheck({ title: 'ShopApp 개발 사이트 관문 켜고 확인하기', check: true }), false);
  assert.equal(board.todoIsCheck({ title: '회사 메일함에 support@example.com 을 보내는 주소로 등록하고, 답장이 그 주소로 가는지 보기' }), false);
  assert.equal(board.todoIsCheck({ title: '아이패드 가로로 문서·업무 설명·메일 쓰기 확인하기 (키보드 올라올 때)', check: true }), true);
  assert.equal(board.todoIsCheck({ title: '폰·앱에서 회사·개인 계정 같이 쓰기 확인하기 (운영 배포 뒤)', check: true }), true);
  assert.equal(board.todoIsCheck({ title: '아이폰에서 새 접속 안내대로 상황판 열어 보기', check: true }), true);
  assert.equal(board.todoIsCheck({ title: '안드로이드 앱 새 빌드를 Play 에 올리기', check: true }), false);
  assert.equal(board.todoIsCheck({ title: '폰 «브라우저»로 개발 사이트 채팅에서 키보드 추천 단어 줄이 뜨는지 보기', check: true }), true);
  const st = blank(), now = Date.parse('2026-11-02T09:30:00Z');
  st.todoDoneRecent = [{ at: '2026-11-02T09:25:58Z', project: 'server', title: 'ShopApp 개발 사이트 관문 켜고 확인하기', check: false },
    { at: '2026-11-02T09:24:54Z', project: 'server', title: 'ShopApp 개발 사이트 관문 켜고 확인하기', check: false },
    { at: '2026-11-01T09:00:00Z', project: 'server', title: 'StudyApp 개발 사이트 관문 켜고 확인하기', check: false }];
  assert.equal(board.todoRepostOf(st, 'server', 'ShopApp 개발 사이트 관문 켜고 확인하기', now).length, 2);
  assert.equal(board.todoRepostOf(st, 'workapp', 'ShopApp 개발 사이트 관문 켜고 확인하기', now).length, 0);
  assert.equal(board.todoRepostOf(st, 'server', 'StudyApp 개발 사이트 관문 켜고 확인하기', now).length, 0);   // 12시간 지남
});

test('쉬던 방에 보낸 답 — 대기열이 방금 같은 솔루션에 띄운 방(아직 목록에 안 잡힘)도 폴더를 잡은 것으로 본다', () => {
  const now = Date.now();
  const resting = { id: 'aaaa1111', sessionId: 's-a', project: 'demo', kind: 'background', alive: false, idle: true, turnOpen: false };
  board.setJustWoke('demo', undefined);
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 0);
  board.setJustWoke('demo', { at: now - 4000, id: 'bbbb2222' });   // 4초 전 시작 · 목록에 아직 없음
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 1);
  board.setJustWoke('demo', { at: now - 4000, id: null });         // 시작하는 중(번호 모름)
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 1);
  board.setJustWoke('demo', { at: now - 4000, id: 'aaaa1111' });   // 방금 깨운 게 이 방 자신이면 막지 않음
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 0);
  board.setJustWoke('demo', { at: now - 120000, id: 'bbbb2222' }); // 90초 지남 — 목록 판정만
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 0);
  board.setJustWoke('other', { at: now - 4000, id: null });        // 다른 솔루션은 상관없음
  board.setJustWoke('demo', undefined);
  assert.equal(board.replyHolders([resting], 'demo', 'aaaa1111', 's-a', now).length, 0);
  board.setJustWoke('other', undefined);
});

test('빠진 할 일 카드를 기다리는 🕓 방 — __OWNER__ 행동 아님 · 까닭을 붙여 한 번 깨움 · 같은 카드가 다시 올라오면 그대로 __OWNER__', () => {
  const s0 = board.loadState();
  s0.todoDropped = [{ at: new Date().toISOString(), project: 'demo', title: '개발서버 스왑 비우기 — 서버 창에서 sudo 한 줄 실행하기', reason: '서버 방이 원인을 고쳐 필요 없음' }];
  board.saveState(s0);
  const a = board.laterStatus('🕓 나중에 — 서버 스왑 비우기 기다림(__OWNER__ 할 일 «개발서버 스왑 비우기 — sudo 한 줄»)');
  assert.equal(a.wait, 'card'); assert.equal(a.resolve.auto, true); assert.doesNotMatch(a.label, /__OWNER__/);
  assert.equal(board.laterStatus('🕓 나중에 — __OWNER__ 가 키를 보내 주시면').wait, 'owner', '다른 카드는 그대로');
  assert.equal(board.laterStatus('🕓 나중에 — 운영 배포 뒤 개발서버 스왑 비우기').wait, 'deploy', '배포 기다림은 그대로');
  const sid = 'cafe0002-0000-0000-0000-000000000000';
  const room = { kind: 'background', id: sid.slice(0, 8), sessionId: sid, cwd: path.join(sb.root, 'proj'), name: '프린터 방', project: 'demo', lastReportAt: 1, status: a };
  const st = blank(); st.queue = [];
  board.queueLaterRooms([room], st, Date.now());
  assert.equal(st.queue.length, 1); assert.match(st.queue[0].task, /카드는 빠졌어/); assert.match(st.queue[0].task, /원인을 고쳐/);
  st.queue = [];
  board.queueLaterRooms([room], st, Date.now() + 1000);
  assert.equal(st.queue.length, 0, '같은 빠진 카드로는 한 번만');
  const s1 = board.loadState();
  s1.asks = Object.assign(s1.asks || {}, { todoX: { aid: 'todoX', kind: 'todo', project: 'demo', title: '개발서버 스왑 비우기 — 다시 필요함' } });
  board.saveState(s1);
  assert.equal(board.laterStatus('🕓 나중에 — 개발서버 스왑 비우기 기다림 __OWNER__').wait, 'owner', '같은 제목이 다시 열려 있으면 __OWNER__ 행동');
  delete s1.asks.todoX; s1.todoDropped = []; board.saveState(s1);
});

test('배포 — 준비 끝·메모리 기다림 중에도 버튼은 «기다림» (누르기 전으로 안 돌아감)', () => {
  const st = blank();
  const now = Date.parse('2026-11-11T02:46:00Z');
  st.queue = [];
  st.paused.demo = { at: '2026-11-11T02:40:12Z', gate: 'deploy', gateQid: 'g1', gateRoom: 'prep1', gateStartedAt: '2026-11-11T02:40:24Z', runnerPending: true, memWaitSince: '2026-11-11T02:42:27Z', memNeed: 3584, memAvail: 2700 };
  const d = board.deployState(st, [], 'demo', now);
  assert.equal(d.phase, 'run'); assert.equal(d.pending, true);
  assert.equal(d.since, Date.parse('2026-11-11T02:42:27Z'));
  assert.equal(d.mem.need, 3584); assert.equal(d.mem.giveUpAt, Date.parse('2026-11-11T02:42:27Z') + 20 * 60 * 1000);
  delete st.paused.demo.memWaitSince;
  const d2 = board.deployState(st, [], 'demo', now);
  assert.equal(d2.pending, true); assert.equal(d2.mem, null);
  delete st.paused.demo.runnerPending;
  assert.equal(board.deployState(st, [], 'demo', now), null);
});
