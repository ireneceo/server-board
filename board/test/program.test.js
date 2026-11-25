// 개발 계획(설계 문서 → 자동 연속 개발) — 계획 검사 · 승인 · 단계 넣기 · 통과 판정 · 고치기 1번 · 멈춤 · 배포 막음
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const PRG = board.PRG;
const repo = path.join(sb.root, 'proj');
const proj = { key: 'demo', name: 'Demo', dir: repo, stateFile: 'session-state.md' };
const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env }).toString();
const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };

execFileSync('git', ['init', '-q', repo]);
write('docs/design.md', '# 설계\n## 1 목록\n## 2 상세\n');
write('.gitignore', '.claude/programs/\n');
commit('처음');

const PLAN = (over) => JSON.stringify(Object.assign({ title: '목록·상세', estimate: '방 2개', steps: [
  { title: '목록 화면', section: '1 목록', goal: 'g', scope: ['src/list/'], pass: 'npm test', confirm: '', safe: false },
  { title: '상세 화면', section: '2 상세', goal: 'g', scope: ['src/detail/'], pass: 'npm test', confirm: '', safe: true },
], decisions: [{ q: '정렬 기준?', recommend: '최신순' }] }, over || {}));

test('계획·경로 검사 — 별표·..·safe 빠짐 거절 · 문서는 폴더 안 파일만', () => {
  const pid = 'gchk01';
  const f = PRG.files(proj, pid); fs.mkdirSync(f.dir, { recursive: true });
  fs.writeFileSync(f.plan, '# 계획');
  fs.writeFileSync(f.json, PLAN()); assert.equal(PRG.readPlan(proj, pid).ok, true);
  fs.writeFileSync(f.json, PLAN({ steps: [{ title: 'a', scope: ['src/*'], safe: true }] })); assert.match(PRG.readPlan(proj, pid).err, /scope/);
  fs.writeFileSync(f.json, PLAN({ steps: [{ title: 'a', scope: ['../x'], safe: true }] })); assert.match(PRG.readPlan(proj, pid).err, /scope/);
  fs.writeFileSync(f.json, PLAN({ steps: [{ title: 'a', scope: ['src/'] }] })); assert.match(PRG.readPlan(proj, pid).err, /safe/);
  fs.writeFileSync(f.json, PLAN({ steps: Array.from({ length: 16 }, () => ({ title: 'a', scope: ['src/'], safe: true })) })); assert.match(PRG.readPlan(proj, pid).err, /15/);
  assert.equal(PRG.cleanDoc(proj, 'docs/design.md'), 'docs/design.md');
  for (const bad of ['../etc/passwd', '/etc/passwd', 'docs', 'nope.md', '']) assert.equal(PRG.cleanDoc(proj, bad), null, bad);
});

test('단계 일은 묶음·선검사에서 빠지고 넣은 순서 그대로', () => {
  const q = { qid: 'x', project: 'demo', task: '[상황판 — 개발 계획 …]', program: 'g1', step: 1 };
  assert.equal(board.needsCheck(q), false); assert.equal(board.plainItem(q), false); assert.equal(board.pinnedItem(q), true);
});

test('전체 흐름 — 계획 → 승인 카드 → 단계 넣기(배포 막음) → 통과 → 다음 단계 → 범위 밖이면 고치기 1번 → 또 실패면 멈춤', () => {
  let st = board.loadState();
  const pid = 'gflow01', now = Date.now();
  st.programs[pid] = { pid, project: 'demo', doc: 'docs/design.md', docHash: PRG.sha(path.join(repo, 'docs/design.md')), status: 'planning', createdAt: new Date().toISOString(), limit: 4, day: { d: PRG.today(now), n: 0 }, steps: [], cur: 0 };
  assert.equal(board.programTick(st, [], now), true);
  const pq = st.queue.find((q) => q.program === pid);
  assert.ok(pq && /개발 계획 세우기/.test(pq.task) && /plan\.json/.test(pq.task));
  // 계획 방이 시작해 plan 을 씀
  st.queue = st.queue.filter((q) => q !== pq); st.qStarted = { [pq.qid]: { id: 'aaaa1111', at: new Date().toISOString() } };
  const f = PRG.files(proj, pid); fs.mkdirSync(f.dir, { recursive: true }); fs.writeFileSync(f.plan, '# 계획'); fs.writeFileSync(f.json, PLAN());
  let rooms = [{ id: 'aaaa1111', sessionId: 'sess-plan', status: { code: 'working' }, turnOpen: true, lastReport: '' }];
  board.programTick(st, rooms, now); assert.equal(st.programs[pid].status, 'planning', '일하는 중엔 그대로');
  rooms = [{ id: 'aaaa1111', sessionId: 'sess-plan', status: { code: 'done' }, lastReport: '✅ 계획 2단계', lastReportAt: now }];
  board.programTick(st, rooms, now);
  let p = st.programs[pid];
  assert.equal(p.status, 'approval'); assert.equal(p.steps.length, 2); assert.equal(p.planSid, 'sess-plan');
  const ask = Object.values(st.asks).find((a) => a.program === pid);
  assert.equal(ask.progAct, 'approve'); assert.match(ask.question, /정렬 기준\?.*최신순/); assert.match(ask.question, /\*\*.*\?\*\*/);
  // 승인(API 대신 상태로) → 1단계 넣기 · safe=false 라 배포 막음
  p.status = 'running';
  board.programTick(st, rooms, now);
  const s1q = st.queue.find((q) => q.program === pid && q.step === 1);
  assert.ok(s1q && /단계 1\/2/.test(s1q.task) && /src\/list\//.test(s1q.task) && /개발완료.*하지 않는다/.test(s1q.task));
  assert.ok(st.deployHold.demo['p' + pid], '반쯤 된 구간 — 배포 막음');
  assert.equal(board.programsView(st).find((x) => x.pid === pid).held, true);
  // 시작 — 시작 지점 기록
  board.saveState(st); board.programMarkStart(proj, s1q); st = board.loadState(); p = st.programs[pid];
  assert.ok(p.steps[0].startHead);
  st.queue = st.queue.filter((q) => q.qid !== s1q.qid); st.qStarted[s1q.qid] = { id: 'bbbb2222', at: new Date().toISOString() };
  board.programTick(st, rooms, now); assert.equal(p.steps[0].state, 'running');
  write('src/list/a.js', '1'); commit('목록');
  fs.writeFileSync(f.progress, '## 단계 1 통과\n- npm test 3/3\n');
  rooms.push({ id: 'bbbb2222', sessionId: 'sess-1', status: { code: 'done' }, lastReport: '✅ 완료', lastReportAt: now });
  board.programTick(st, rooms, now);
  assert.equal(p.steps[0].state, 'passed', JSON.stringify(p.steps[0].judged)); assert.equal(p.cur, 1);
  // 2단계 — 범위 밖 파일을 고침 → 고치기 1번
  board.programTick(st, rooms, now);
  const s2q = st.queue.find((q) => q.program === pid && q.step === 2);
  assert.ok(s2q); assert.equal(st.deployHold.demo['p' + pid] !== undefined, true, '1단계가 safe=false 라 아직 막음');
  board.saveState(st); board.programMarkStart(proj, s2q); st = board.loadState(); p = st.programs[pid];
  st.queue = st.queue.filter((q) => q.qid !== s2q.qid); st.qStarted[s2q.qid] = { id: 'cccc3333', at: new Date().toISOString() };
  board.programTick(st, rooms, now);
  write('src/detail/a.js', '1'); write('server/x.js', '1'); commit('상세 + 범위 밖');
  fs.appendFileSync(f.progress, '## 단계 2 통과\n');
  rooms.push({ id: 'cccc3333', sessionId: 'sess-2', status: { code: 'done' }, lastReport: '✅ 완료', lastReportAt: now });
  board.programTick(st, rooms, now);
  assert.equal(p.steps[1].state, 'todo'); assert.match(p.steps[1].fixWhy.join(' '), /범위 밖.*server\/x\.js/);
  board.programTick(st, rooms, now);
  const fixq = st.queue.find((q) => q.program === pid && q.step === 2);
  assert.match(fixq.task, /고치기/); assert.match(fixq.task, /server\/x\.js/);
  st.queue = st.queue.filter((q) => q.qid !== fixq.qid); st.qStarted[fixq.qid] = { id: 'dddd4444', at: new Date().toISOString() };
  board.programTick(st, rooms, now);
  rooms.push({ id: 'dddd4444', sessionId: 'sess-3', status: { code: 'done' }, lastReport: '✅ 완료', lastReportAt: now });
  board.programTick(st, rooms, now);
  assert.equal(p.status, 'stopped'); assert.match(p.why, /고치기 뒤에도/);
  assert.equal(Object.values(st.asks).find((a) => a.program === pid).progAct, 'stopped');
  assert.ok(st.deployHold.demo['p' + pid], '멈춰도 배포 막음은 남김');
});

test('통과 — 범위를 지키고 safe 단계가 통과하면 배포 막음을 풂 · 끝 카드', () => {
  const st = board.loadState();
  const pid = 'gok01', now = Date.now();
  const f = PRG.files(proj, pid); fs.mkdirSync(f.dir, { recursive: true }); fs.writeFileSync(f.plan, '# p');
  fs.writeFileSync(f.json, JSON.stringify({ steps: [{ title: '하나', scope: ['src/one/'], safe: true }] }));
  const plan = PRG.readPlan(proj, pid).plan;
  st.programs[pid] = { pid, project: 'demo', doc: 'docs/design.md', docHash: PRG.sha(path.join(repo, 'docs/design.md')), status: 'running', planHash: PRG.planHash(proj, pid),
    createdAt: new Date().toISOString(), limit: 4, day: { d: PRG.today(now), n: 0 }, steps: plan.steps.map((s) => Object.assign(s, { state: 'running', qid: 'q1', startHead: git('rev-parse', 'HEAD').trim(), dirtyAtStart: [] })), cur: 0 };
  st.deployHold = { demo: { ['p' + pid]: { hid: 'p' + pid } } };
  st.qStarted = Object.assign(st.qStarted || {}, { q1: { id: 'eeee5555', at: new Date().toISOString() } });
  write('src/one/a.js', '1'); commit('하나');
  fs.writeFileSync(f.progress, '## 단계 1 통과\n');
  // «확인 못 함» 이 있으면 통과 아님
  const j = PRG.judgeStep(proj, st.programs[pid], st.programs[pid].steps[0], '✅ 완료\n확인 못 함: 휴대폰', false);
  assert.equal(j.pass, false); assert.match(j.why.join(), /확인 못 함/);
  assert.equal(PRG.judgeStep(proj, st.programs[pid], st.programs[pid].steps[0], '✅ 완료', true).pass, false, '열린 카드');
  board.programTick(st, [{ id: 'eeee5555', sessionId: 's5', status: { code: 'done' }, lastReport: '✅ 완료', lastReportAt: now }], now);
  assert.equal(st.programs[pid].status, 'done');
  assert.equal(st.deployHold.demo['p' + pid], undefined);
  assert.equal(Object.values(st.asks).find((a) => a.program === pid).progAct, 'done');
});

test('설계 문서가 바뀌면 멈춤 · 하루 방 한도면 기다림 · 유지보수 일 먼저', () => {
  const st = board.loadState(); const now = Date.now();
  const mk = (pid, extra) => { st.programs[pid] = Object.assign({ pid, project: 'demo', doc: 'docs/design.md', docHash: PRG.sha(path.join(repo, 'docs/design.md')), status: 'planning', createdAt: new Date().toISOString(), limit: 1, day: { d: PRG.today(now), n: 0 }, steps: [], cur: 0 }, extra); return st.programs[pid]; };
  const a = mk('glim01', { day: { d: PRG.today(now), n: 1 } });
  board.programTick(st, [], now); assert.equal(a.planQid, undefined); assert.match(a.note, /한도/);
  const b = mk('gdoc01', { docHash: 'old' });
  board.programTick(st, [], now); assert.equal(b.status, 'stopped'); assert.match(b.why, /설계 문서/);
  // 유지보수 일 먼저
  const pid = 'ggap01'; const f = PRG.files(proj, pid); fs.mkdirSync(f.dir, { recursive: true }); fs.writeFileSync(f.plan, '#'); fs.writeFileSync(f.json, JSON.stringify({ steps: [{ title: 'x', scope: ['src/'], safe: true }] }));
  const c = mk(pid, { status: 'running', limit: 4, planHash: PRG.planHash(proj, pid), steps: PRG.readPlan(proj, pid).plan.steps.map((s) => Object.assign(s, { state: 'todo' })), gap: ['m1'], gapAt: new Date().toISOString() });
  st.queue.push({ qid: 'm1', project: 'demo', task: '문구 고치기' });
  board.programTick(st, [], now); assert.match(c.note, /유지보수/); assert.equal(c.steps[0].state, 'todo');
  st.queue = st.queue.filter((q) => q.qid !== 'm1');
  board.programTick(st, [], now); assert.equal(c.steps[0].state, 'queued');
});

test('주소 — 주인만 넣기·승인(작업방·팀원 403) · 잘못된 문서 400 · 같은 솔루션 두 개 409 · 승인 · 끝내기', async () => {
  const ai = board.decideWho({ kind: 'agent' }, null);
  for (const u of ['/api/programs', '/api/programs/gabc123/approve', '/api/programs/gabc123/next', '/api/programs/gabc123/unhold'])
    assert.equal((await board.permit(ai, u, { project: 'demo', doc: 'docs/design.md' }) || [])[0], 403, u);
  const http = require('http');
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const post = (p, body) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => ok({ code: r.statusCode, j: JSON.parse(d || '{}') })); });
    pr.on('error', no); pr.end(JSON.stringify(body));
  });
  try {
    const st0 = board.loadState(); for (const p of Object.values(st0.programs)) p.status = 'ended'; board.saveState(st0);
    assert.equal((await post('/api/programs', { project: 'demo', doc: '../x.md' })).code, 400);
    const a = await post('/api/programs', { project: 'demo', doc: 'docs/design.md', limit: 99 });
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.equal(board.loadState().programs[a.j.pid].limit, 8, '하루 한도는 8까지');
    assert.equal((await post('/api/programs', { project: 'demo', doc: 'docs/design.md' })).code, 409);
    assert.equal((await post('/api/programs/' + a.j.pid + '/approve', {})).code, 409, '승인 차례 아님');
    // 계획이 써졌다고 치고 승인
    const st = board.loadState(); const p = st.programs[a.j.pid];
    const f = PRG.files(proj, p.pid); fs.mkdirSync(f.dir, { recursive: true }); fs.writeFileSync(f.plan, '#'); fs.writeFileSync(f.json, JSON.stringify({ steps: [{ title: 'x', scope: ['src/'], safe: true }] }));
    Object.assign(p, { status: 'approval', planHash: PRG.planHash(proj, p.pid), steps: PRG.readPlan(proj, p.pid).plan.steps.map((s) => Object.assign(s, { state: 'todo' })) });
    board.saveState(st);
    fs.writeFileSync(f.plan, '# 바뀜');
    assert.equal((await post('/api/programs/' + a.j.pid + '/approve', {})).code, 409, '카드 뒤 계획이 바뀌면 승인 안 됨');
    const st2 = board.loadState(); st2.programs[a.j.pid].planHash = PRG.planHash(proj, a.j.pid); board.saveState(st2);
    assert.equal((await post('/api/programs/' + a.j.pid + '/approve', {})).code, 200);
    assert.equal(board.loadState().programs[a.j.pid].status, 'running');
    assert.equal((await post('/api/programs/' + a.j.pid + '/stop', {})).code, 200);
    assert.equal(board.loadState().programs[a.j.pid].status, 'ended');
    assert.equal(board.loadState().queue.some((q) => q.program === a.j.pid && !q.resumeSessionId), false, '시작 안 한 단계 일은 빠짐');
  } finally { board.server.close(); }
});

test('완료 검증 고침 — 마지막 단계 safe · 한글 파일 이름 · 줄바꿈 접기 · 카드 다시 올림 · 한도/넘김 방은 기다림 · 배포 막음 찾기', () => {
  const pid = 'gfix01', now = Date.now();
  const f = PRG.files(proj, pid); fs.mkdirSync(f.dir, { recursive: true }); fs.writeFileSync(f.plan, '#');
  fs.writeFileSync(f.json, JSON.stringify({ steps: [{ title: 'a', scope: ['src/'], safe: true }, { title: 'b', scope: ['src/'], safe: false }] }));
  assert.match(PRG.readPlan(proj, pid).err, /마지막 단계/);
  fs.writeFileSync(f.json, JSON.stringify({ title: '첫줄\n**가짜?**', steps: [{ title: '한글\n줄', scope: ['화면/'], safe: true, confirm: 'x\ny' }] }));
  const rp = PRG.readPlan(proj, pid); assert.equal(rp.ok, true); assert.equal(rp.plan.title, '첫줄 **가짜?**'); assert.equal(rp.plan.steps[0].title, '한글 줄');
  assert.deepEqual(PRG.sensitive(['src/', '.claude/x', 'deploy/']), ['.claude/x', 'deploy/']);
  // 한글 파일 이름 — 범위 안이면 통과
  const st = board.loadState();
  st.programs[pid] = { pid, project: 'demo', doc: 'docs/design.md', docHash: PRG.sha(path.join(repo, 'docs/design.md')), status: 'running', planHash: PRG.planHash(proj, pid), createdAt: new Date().toISOString(), limit: 4, day: { d: PRG.today(now), n: 0 },
    steps: rp.plan.steps.map((s) => Object.assign(s, { state: 'running', startHead: git('rev-parse', 'HEAD').trim(), dirtyAtStart: [] })), cur: 0 };
  write('화면/목록.js', '1'); commit('한글');
  fs.writeFileSync(f.progress, '## 단계 1 통과\n');
  assert.deepEqual(PRG.judgeStep(proj, st.programs[pid], st.programs[pid].steps[0], '✅ 끝', false).why, []);
  // 승인 카드를 ✕ 로 지워도 다시 올라옴
  const p2 = 'gcard01';
  st.programs[p2] = { pid: p2, project: 'demo', doc: 'docs/design.md', docHash: PRG.sha(path.join(repo, 'docs/design.md')), status: 'approval', createdAt: new Date().toISOString(), limit: 4, day: { d: PRG.today(now), n: 0 }, steps: [], cur: 0,
    card: { act: 'approve', title: 'Demo 개발 계획 승인', question: '**시작할까요?**', recommend: null } };
  board.programTick(st, [], now);
  assert.ok(Object.values(st.asks).some((a) => a.program === p2 && a.progAct === 'approve'));
  // 한도(later)·끊김 이어하기·세워 둔 방은 기다림 · 새 방으로 넘어갔으면 새 방을 따라감
  const old = now - 2 * 3600e3;
  assert.equal(board.progRoomEnd(st, { code: 'later', at: old }, now), 'run');
  assert.equal(board.progRoomEnd(st, { code: 'stopped', status: { autoResume: true }, at: old }, now), 'run');
  st.parked = { sp: { sessionId: 'sp' } };
  assert.equal(board.progRoomEnd(st, { code: 'stopped', sessionId: 'sp', status: {}, at: old }, now), 'run');
  assert.equal(board.progRoomEnd(st, { code: 'stopped', sessionId: 'sx', status: {}, at: old }, now), 'lost');
  st.qStarted = Object.assign(st.qStarted || {}, { qh: { id: 'old11111', at: new Date().toISOString() } });
  st.handover = { 'sess-old': { qid: 'x', id: 'old11111' } };
  const rooms = [{ id: 'old11111', sessionId: 'sess-old', status: { code: 'blocked' }, lastReport: '❌ Prompt is too long' }, { id: 'new22222', sessionId: 'sess-new', status: { code: 'done' }, lastReport: '✅ 끝' }];
  assert.equal(board.progRoom(st, rooms, 'qh').code, 'working', '넘김 일이 줄 서 있으면 일하는 중');
  st.handover['sess-old'].newId = 'new22222';
  assert.equal(board.progRoom(st, rooms, 'qh').id, 'new22222');
  // 배포 막음 찾기(실행기 없는 배포 길이 봄)
  assert.equal(board.planHold({ deployHold: { demo: { rabc: { hid: 'rabc' } } } }, 'demo'), null);
  assert.ok(board.planHold({ deployHold: { demo: { pg1: { hid: 'pg1', reason: 'x' } } } }, 'demo'));
});

test('실행기 없는 솔루션 — 개발 계획 배포 막음이면 배포 버튼 409(PLAN_HOLD)', async () => {
  const http = require('http');
  const st = board.loadState(); st.deployHold = { demo: { pgx: { hid: 'pgx', reason: '개발 계획 1단계' } } }; board.saveState(st);
  const pf = path.join(sb.home, 'dev-server', 'projects.json'); const pj0 = fs.readFileSync(pf, 'utf8');
  fs.writeFileSync(pf, JSON.stringify(JSON.parse(pj0).map((x) => Object.assign({}, x, { prodLabel: '운영' }))));
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  try {
    const [code, j] = await new Promise((ok, no) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/projects/demo/deploy', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok([res.statusCode, JSON.parse(d || '{}')])); });
      r.on('error', no); r.end(JSON.stringify({ typed: 'demo' }));
    });
    assert.equal(code, 409, JSON.stringify(j)); assert.equal(j.code, 'PLAN_HOLD');
  } finally { board.server.close(); fs.writeFileSync(pf, pj0); const s2 = board.loadState(); s2.deployHold = {}; board.saveState(s2); }
});
