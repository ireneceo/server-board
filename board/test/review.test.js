'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadBoard } = require('./sandbox');
const review = require('../review');

const projects = (root) => [
  { key: 'demo', name: 'Demo', dir: path.join(root, 'proj'), stateFile: 'session-state.md', prodLabel: 'demo.example' },
  { key: 'other', name: 'Other', dir: path.join(root, 'proj2'), stateFile: 'session-state.md', prodLabel: 'other.example' },
];
const os = require('os');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
const { board, sb } = loadBoard({
  projects: projects(path.dirname(path.join(tmpRoot, 'x'))),
  config: { team: {
    members: [
      { user: 'rev', name: '검토', role: 'reviewer', projects: ['demo'] },
      { user: 'mem', name: '팀원', role: 'member', projects: ['demo'] },
      { user: 'vw', name: '보기', role: 'viewer', projects: ['demo'] },
    ],
    deployConfirm: ['demo', 'other'], review: { demo: 'bundle', other: 'strict', bogus: 'auto', x: 'nope' },
  } },
});
test.after(() => { sb.cleanup(); fs.rmSync(tmpRoot, { recursive: true, force: true }); });

const who = (id) => Object.assign(board.personOf(id), { via: 'tunnel' });
const owner = { role: 'owner', user: 'owner', name: '__OWNER__', projects: ['*'], via: 'terminal' };
const SID = (n) => '0000000' + n + '-aaaa-bbbb-cccc-dddddddddddd';
// 가짜 대화 기록 — 고친 파일 하나
function transcript(sid, file, cmd) {
  const d = path.join(sb.home, '.claude', 'projects', 'x'); fs.mkdirSync(d, { recursive: true });
  const c = file ? { type: 'tool_use', name: 'Edit', input: { file_path: file } } : { type: 'tool_use', name: 'Bash', input: { command: cmd } };
  fs.writeFileSync(path.join(d, sid + '.jsonl'), JSON.stringify({ type: 'assistant', message: { content: [c] } }) + '\n');
}
async function settle() { board.gradeKick(); for (let i = 0; i < 50 && board.gradeJobs.size; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 20)); }
const T0 = Date.now();
function boardOf(items) { return { rooms: [], completed: items.map((x, i) => ({ project: x.project || 'demo', sessionId: x.sid, id: x.sid.slice(0, 8), name: x.name || 'job' + i, report: x.report || '✅ 완료', confirmedAt: new Date(T0 - 1000 * (10 - i)).toISOString(), cwd: '/nowhere' })) }; }

test('등급: 경로·표지·낱말·판정 불가는 «필요», 서버 코드만이면 «보통»', () => {
  const dir = '/p';
  const g = (o) => review.grade(Object.assign({ dir, paths: null }, o));
  const tf = (f) => { const t = path.join(tmpRoot, Math.random().toString(36).slice(2) + '.jsonl'); fs.writeFileSync(t, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] } }) + '\n'); return t; };
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/src/pages/Home.vue') }).need, true);
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/backend/routes/stats.js') }).need, false);
  assert.equal(g({ report: '✅ 완료\n[최종 확인 필요] 문구 의견', transcript: tf('/p/backend/x.js') }).need, true);
  assert.equal(g({ report: '✅ 완료 — 결제 화면 문구', transcript: tf('/p/backend/x.js') }).need, true);
  assert.deepEqual(g({ report: '✅ 완료', transcript: null }).why, ['unknown']);
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/db/migrations/2026-add.js') }).need, true);
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/backend/x.js'), raised: { by: 'mem' } }).need, true);
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/README.md') }).need, false, '문서만 = 보통');
  assert.equal(g({ report: '✅ 완료', transcript: tf('/elsewhere/a.vue') }).need, false, '솔루션 밖 파일은 셈하지 않음');
  assert.equal(g({ report: '✅ 완료', transcript: tf('/p/backend/x.js'), paths: ['backend/**'] }).need, true, '솔루션별 경로');
  assert.deepEqual(review.writeTargets('grep KEY app/.env > /dev/null'), [], '읽기만 = 셈 안 함');
  assert.deepEqual(review.writeTargets('cp a.js web/b.vue'), ['web/b.vue']);
  assert.deepEqual(review.writeTargets("python3 - <<EOF\nopen('web/x.css','w').write('a')\nEOF"), ['web/x.css']);
  assert.ok(review.globRe('**/*.{vue,css}').test('a/b/c.css'));
  assert.ok(!review.globRe('**/*.{vue,css}').test('a/b/c.js'));
});

test('설정: 모르는 방식·솔루션은 버림 · reviewer 는 권한 목록에 있음', () => {
  assert.equal(board.personOf('rev').role, 'reviewer');
  assert.equal(board.reviewMode('demo'), 'bundle');
  assert.equal(board.reviewMode('other'), 'strict');
  assert.equal(board.reviewMode('nothing'), 'strict');
  assert.match(board.reviewNote('demo'), /최종 확인 필요/);
  assert.equal(board.reviewNote('other'), '');
});

test('허용표: reviewer 는 맡은 솔루션의 확인·남의 제안만 · 배포·팀·설정 403 · member/viewer 는 확인 403', async () => {
  const rev = who('rev'), mem = who('mem'), vw = who('vw');
  assert.equal(await board.permit(rev, '/api/deploy-check', { project: 'demo', sids: [SID(1)] }), null);
  assert.equal((await board.permit(rev, '/api/deploy-check', { project: 'other', sids: [SID(1)] }) || [])[0], 403, '안 맡은 솔루션');
  for (const u of ['/api/team', '/api/settings', '/api/projects/demo/deploy', '/api/projects/demo/deploy-baseline'])
    assert.equal((await board.permit(rev, u, { project: 'demo' }) || [])[0], 403, u);
  assert.equal((await board.permit(mem, '/api/deploy-check', { project: 'demo', sids: [SID(1)] }) || [])[0], 403);
  assert.equal((await board.permit(vw, '/api/deploy-check', { project: 'demo', sids: [SID(1)] }) || [])[0], 403);
  assert.equal(await board.permit(mem, '/api/deploy-need', { project: 'demo', sids: [SID(1)] }), null, '팀원은 «필요» 로 올리기만');
  assert.equal((await board.permit(vw, '/api/deploy-need', { project: 'demo', sids: [SID(1)] }) || [])[0], 403);
  const ai = { role: 'agent', user: 'owner', name: 'AI', projects: ['*'], via: 'agent' };
  assert.equal((await board.permit(ai, '/api/deploy-check', { project: 'demo', sids: [SID(1)] }) || [])[0], 403);
  assert.equal((await board.permit(ai, '/api/deploy-need', { project: 'demo', sids: [SID(1)] }) || [])[0], 403);
  // 제안: 남의 것은 되고 자기 것은 안 됨
  const st = board.loadState(); st.proposals = { pa1: { pid: 'pa1', project: 'demo', task: 't', by: { user: 'mem' } }, pa2: { pid: 'pa2', project: 'demo', task: 't', by: { user: 'rev' } } }; board.saveState(st);
  assert.equal(await board.permit(rev, '/api/proposals/pa1/approve', {}), null);
  assert.equal((await board.permit(rev, '/api/proposals/pa2/approve', {}) || [])[0], 403, '자기 제안');
  assert.equal((await board.permit(mem, '/api/proposals/pa1/approve', {}) || [])[0], 403, '팀원은 승인 못 함');
  assert.equal(await board.permit(rev, '/api/proposals/pa1/approve', { task: 't' }), null, '그대로 하기(화면이 원문을 같이 보냄)');
  assert.equal((await board.permit(rev, '/api/proposals/pa1/approve', { task: '/배포 지금' }) || [])[0], 403, '중간 컨펌자는 고쳐서 하기 못 함');
  assert.equal(await board.permit(owner, '/api/proposals/pa1/approve', { task: '고친 글' }), null, '주인은 고쳐서 하기');
});

test('막는 규칙: bundle 은 중간 확인만으론 남음 · 필요는 최종 확인 전 남음 · auto 는 보통+중간 확인이면 통과 · strict 는 중간 무시 · 예전 기록 = 최종', async () => {
  const proj = path.join(tmpRoot, 'proj');
  transcript(SID(1), path.join(proj, 'server/stats.js'));          // 보통
  transcript(SID(2), path.join(proj, 'web/pages/Home.vue'));         // 필요(화면)
  transcript(SID(3), path.join(proj, 'server/other.js'));          // 보통, 예전 확인 기록
  const items = [{ sid: SID(1) }, { sid: SID(2) }, { sid: SID(3) }];
  const b = boardOf(items);
  let st = board.loadState(); st.deployChecked = { [SID(3)]: { by: '__OWNER__', at: new Date().toISOString() } }; st.roomBy = { [SID(1).slice(0, 8)]: { user: 'rev' } }; board.saveState(st);
  board.uncheckedWork(b, board.loadState(), 'demo'); await settle();
  let unc = board.uncheckedWork(b, board.loadState(), 'demo');
  assert.deepEqual(unc.map((x) => [x.sid, x.need]), [[SID(1), false], [SID(2), true]], '예전 기록(level 없음)은 최종으로 읽음');
  assert.equal(unc[0].by, 'rev');
  // 중간 확인 — bundle 에서는 여전히 막음(표시만)
  st = board.loadState(); board.markChecked(st, [SID(1)], '검토', 'mid'); board.saveState(st);
  unc = board.uncheckedWork(b, board.loadState(), 'demo');
  assert.equal(unc.length, 2); assert.equal(unc[0].mid.by, '검토');
  // auto 로 바꾸면 보통+중간 확인은 통과, 필요는 남음
  board.setTeamForTest(Object.assign({}, { members: [{ user: 'rev', role: 'reviewer', projects: ['demo'] }], deployConfirm: ['demo', 'other'], review: { demo: 'auto' } }));
  unc = board.uncheckedWork(b, board.loadState(), 'demo');
  assert.deepEqual(unc.map((x) => x.sid), [SID(2)]);
  // 필요에 중간 확인을 찍어도(직접 기록) 남음 · 최종이면 빠짐 + 앞선 중간 기록 보존
  st = board.loadState(); board.markChecked(st, [SID(2)], '검토', 'mid'); board.saveState(st);
  assert.deepEqual(board.uncheckedWork(b, board.loadState(), 'demo').map((x) => x.sid), [SID(2)]);
  st = board.loadState(); board.markChecked(st, [SID(2)], '__OWNER__', 'final'); board.saveState(st);
  assert.deepEqual(board.uncheckedWork(b, board.loadState(), 'demo'), []);
  assert.equal(board.loadState().deployChecked[SID(2)].mid.by, '검토');
  // strict 는 중간 확인을 무시(예전과 같은 동작 — 등급 없음)
  board.setTeamForTest({ members: [{ user: 'rev', role: 'reviewer', projects: ['demo'] }], deployConfirm: ['demo'], review: { demo: 'strict' } });
  unc = board.uncheckedWork(b, board.loadState(), 'demo');
  assert.deepEqual(unc.map((x) => [x.sid, x.need]), [[SID(1), undefined]]);
});

test('API: reviewer 자기 일 403 · 필요 403 · 남의 보통 200 level=mid · 다른 솔루션 sid 400 · 올리기 · 주인 확인 final', async () => {
  board.setTeamForTest({ members: [{ user: 'rev', name: '검토', role: 'reviewer', projects: ['demo'] }, { user: 'mem', name: '팀원', role: 'member', projects: ['demo'] }], deployConfirm: ['demo', 'other'], review: { demo: 'bundle' } });
  const proj = path.join(tmpRoot, 'proj');
  transcript(SID(4), path.join(proj, 'server/a.js'));   // 보통, 남의 일
  transcript(SID(5), path.join(proj, 'server/b.js'));   // 보통, rev 의 일
  transcript(SID(6), path.join(proj, 'ui/x.css'));      // 필요
  const st = board.loadState(); st.completed = {}; st.deployChecked = {}; st.roomBy = { [SID(5).slice(0, 8)]: { user: 'rev' } };
  for (const [i, n] of [[4, 'a'], [5, 'b'], [6, 'c']]) st.completed[SID(i)] = { project: 'demo', sessionId: SID(i), id: SID(i).slice(0, 8), name: n, report: '✅ 완료', confirmedAt: new Date(Date.now() - 5000 + i).toISOString(), cwd: '/nowhere' };
  st.completed[SID(7)] = { project: 'other', sessionId: SID(7), id: SID(7).slice(0, 8), name: 'o', report: '✅ 완료', confirmedAt: new Date().toISOString(), cwd: '/nowhere' };
  board.saveState(st);
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const tok = { rev: board.auth.createSession('rev', 'tunnel', true), mem: board.auth.createSession('mem', 'tunnel', true) };
  const call = (as, url, body) => new Promise((ok, no) => {
    const headers = { 'x-test-sock': 'tunnel', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    if (as === 'owner') headers['x-test-sock'] = 'terminal'; else headers.cookie = 'sb_sess_8800=' + encodeURIComponent(tok[as]);
    const r = http.request({ host: '127.0.0.1', port, path: url, method: 'POST', agent: false, headers }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok([res.statusCode, j]); }); });
    r.on('error', no); r.write(JSON.stringify(body)); r.end();
  });
  try {
    board.uncheckedWork(await board.buildBoard(), board.loadState(), 'demo'); await settle();
    const unc = board.uncheckedWork(await board.buildBoard(), board.loadState(), 'demo');
    assert.deepEqual(unc.map((x) => [x.name, x.need, x.by]), [['a', false, undefined], ['b', false, 'rev'], ['c', true, undefined]]);
    assert.equal((await call('owner', '/api/deploy-check', { project: 'demo', sids: [SID(7)] }))[0], 400, '다른 솔루션 sid 는 확인할 일이 아님');
    assert.equal((await call('rev', '/api/deploy-check', { project: 'demo', sids: [SID(5)] }))[0], 403, '자기 일');
    assert.equal((await call('rev', '/api/deploy-check', { project: 'demo', sids: [SID(6)] }))[0], 403, '필요');
    assert.equal((await call('mem', '/api/deploy-check', { project: 'demo', sids: [SID(4)] }))[0], 403, '팀원');
    const [s1, j1] = await call('rev', '/api/deploy-check', { project: 'demo', sids: [SID(4)] });
    assert.equal(s1, 200, JSON.stringify(j1));
    assert.equal(board.loadState().deployChecked[SID(4)].level, 'mid');
    assert.equal(board.uncheckedWork(await board.buildBoard(), board.loadState(), 'demo').length, 3, 'bundle — 중간 확인만으론 배포를 안 풂');
    // 팀원이 «필요» 로 올림 → 중간 확인 못 함
    const [s2, j2] = await call('mem', '/api/deploy-need', { project: 'demo', sids: [SID(5)], why: '문구 의견' });
    assert.equal(s2, 200, JSON.stringify(j2));
    const b5 = board.uncheckedWork(await board.buildBoard(), board.loadState(), 'demo').find((x) => x.name === 'b');
    assert.equal(b5.need, true); assert.match(b5.why[0], /^raised:/);
    // 주인 확인 = final, 중간 기록 보존
    const [s3] = await call('owner', '/api/deploy-check', { project: 'demo', sids: [SID(4), SID(6)] });
    assert.equal(s3, 200);
    const c4 = board.loadState().deployChecked[SID(4)];
    assert.equal(c4.level, 'final'); assert.equal(c4.mid.by, '검토');
    // strict 솔루션에서는 reviewer 확인 거절
    board.setTeamForTest({ members: [{ user: 'rev', name: '검토', role: 'reviewer', projects: ['demo'] }], deployConfirm: ['demo'], review: { demo: 'strict' } });
    assert.equal((await call('rev', '/api/deploy-check', { project: 'demo', sids: [SID(5)] }))[0], 400);
  } finally { await new Promise((r) => board.server.close(r)); }
});

test('배포 버튼: «필요» 일은 하나씩 체크(needSids) 없이는 «모두 확인» 으로 못 넘김', async () => {
  board.setTeamForTest({ members: [], deployConfirm: ['demo'], review: { demo: 'bundle' } });
  const proj = path.join(tmpRoot, 'proj');
  transcript(SID(8), path.join(proj, 'server/n.js'));
  transcript(SID(9), path.join(proj, 'ui/n.vue'));
  const st = board.loadState(); st.completed = {}; st.deployChecked = {}; st.deployNeed = {};
  for (const [i, n] of [[8, 'n1'], [9, 'n2']]) st.completed[SID(i)] = { project: 'demo', sessionId: SID(i), id: SID(i).slice(0, 8), name: n, report: '✅ 완료', confirmedAt: new Date(Date.now() - 3000 + i).toISOString(), cwd: '/nowhere' };
  board.saveState(st);
  board.uncheckedWork(await board.buildBoard(), board.loadState(), 'demo'); await settle();
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const call = (body) => new Promise((ok, no) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/projects/demo/deploy', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok([res.statusCode, j]); }); });
    r.on('error', no); r.write(JSON.stringify(body)); r.end();
  });
  try {
    const sids = [SID(8), SID(9)];
    const [a, ja] = await call({ typed: 'demo', checkAll: true, sids });
    assert.equal(a, 409, JSON.stringify(ja)); assert.equal(ja.code, 'UNCHECKED'); assert.equal(ja.mode, 'bundle');
    assert.deepEqual(ja.list.map((x) => x.need), [false, true]);
    assert.ok(!board.loadState().deployChecked[SID(8)], '막혔으면 아무것도 표시 안 함');
    const [b] = await call({ typed: 'demo', checkAll: true, sids, needSids: [SID(9)] });
    assert.notEqual(b, 409, '하나씩 체크하면 지나감(다음 단계 결과는 이 시험 밖)');
    assert.equal(board.loadState().deployChecked[SID(9)].level, 'final');
    assert.equal(board.loadState().deployChecked[SID(9)].need, true);
  } finally { await new Promise((r) => board.server.close(r)); }
});

test('판정 도중 목록을 계속 불러도 판정이 끝남(저장 전 결과를 다시 대기열에 안 넣음)', async () => {
  board.setTeamForTest({ members: [], deployConfirm: ['demo'], review: { demo: 'bundle' } });
  const proj = path.join(tmpRoot, 'proj');
  const st = board.loadState(); st.completed = {}; st.deployChecked = {}; st.deployNeed = {}; st.deployGrade = {};
  for (let i = 0; i < 120; i++) {
    const sid = 'b' + String(i).padStart(7, '0') + '-aaaa-bbbb-cccc-dddddddddddd';
    transcript(sid, path.join(proj, 'server/s' + i + '.js'));
    st.completed[sid] = { project: 'demo', sessionId: sid, id: sid.slice(0, 8), name: 'g' + i, report: '✅ 완료', confirmedAt: new Date(Date.now() - 200000 + i).toISOString(), cwd: '/nowhere' };
  }
  board.saveState(st);
  const b = await board.buildBoard();
  let pend = 0;
  for (let k = 0; k < 40; k++) { pend = board.uncheckedWork(b, board.loadState(), 'demo').filter((x) => (x.why || []).includes('pending')).length; if (!pend && !board.gradeJobs.size) break; await new Promise((r) => setTimeout(r, 5)); }
  await settle();
  const after = board.uncheckedWork(b, board.loadState(), 'demo');
  assert.equal(after.filter((x) => (x.why || []).includes('pending')).length, 0);
  assert.equal(after.filter((x) => x.need === false).length, 120);
});
