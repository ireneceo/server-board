// 계정별 설정(답할 수 있는 방·넣은 일 시작) · 안내 메일 주소
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { team: { approval: true, memberAnswers: 'own', members: [
  { user: 'kim', name: '김', role: 'member', projects: ['demo'] },                                                  // 팀 기본
  { user: 'lee', name: '이', role: 'member', projects: ['demo'], answers: 'project', approval: 'off', email: 'lee@example.com' },
  { user: 'park', name: '박', role: 'member', projects: ['demo'], answers: 'none', approval: 'on', email: 'not an email' },
  { user: 'choi', name: '최', role: 'member', projects: ['demo'], answers: 'all', approval: 'maybe' },              // 모르는 값 → 팀 기본
] } } });
test.after(() => sb.cleanup());
const who = (id) => Object.assign(board.personOf(id), { via: 'tunnel' });

test('모르는 값·이상한 메일은 버리고 팀 기본으로', () => {
  assert.deepEqual(board.memberRule('kim'), { answers: 'own', approval: true });
  assert.deepEqual(board.memberRule('lee'), { answers: 'project', approval: false });
  assert.deepEqual(board.memberRule('park'), { answers: 'none', approval: true });
  assert.deepEqual(board.memberRule('choi'), { answers: 'own', approval: true });
  assert.equal(board.cleanEmail('lee@example.com'), 'lee@example.com');
  for (const x of ['not an email', 'a@b', '<x>@y.com', 'a@b.com\nBcc: c@d.com', 'x'.repeat(130) + '@a.com']) assert.equal(board.cleanEmail(x), '', x);
});

test('답할 수 있는 방 — 계정마다 · 자기 방은 방 주인 기록으로 가름', () => {
  const st = board.loadState(); st.roomBy = { r1: { user: 'kim' }, r2: { user: 'lee' } }; board.saveState(st);
  assert.equal(board.memberMayAnswer(who('kim'), 'r1', 'demo'), true, '자기 방');
  assert.equal(board.memberMayAnswer(who('kim'), 'r2', 'demo'), false, '남의 방(팀 기본 own)');
  assert.equal(board.memberMayAnswer(who('lee'), 'r1', 'demo'), true, '이 사람만 «맡은 솔루션 모든 방»');
  assert.equal(board.memberMayAnswer(who('park'), 'r1', 'demo'), false, '이 사람만 «없음»');
  assert.equal(board.memberMayAnswer(who('lee'), 'r1', 'other'), false, '맡지 않은 솔루션은 계정 설정과 상관없이 안 됨');
  board.setTeamForTest({ approval: true, memberAnswers: 'project', members: [{ user: 'kim', name: '김', role: 'member', projects: ['demo'] }, { user: 'v', role: 'viewer', projects: ['demo'], answers: 'project' }] });
  assert.equal(board.memberMayAnswer(who('kim'), 'r2', 'demo'), true, '팀 기본을 바꾸면 «팀 기본» 계정은 따라감');
  assert.equal(board.memberMayAnswer(who('v'), 'r2', 'demo'), false, '보기만은 계정 설정이 있어도 못 답함');
});

let port;
function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok({ code: res.statusCode, j }); });
    });
    r.on('error', no); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

test('저장 — 메일 주소가 이상하면 거절 · 계정별 값이 남음', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const base = { approval: true, memberAnswers: 'own', members: [{ user: 'kim', name: '김', role: 'member', projects: ['demo'], email: 'kim@@x' }] };
    const bad = await call('POST', '/api/team', 'terminal', { team: base });
    assert.equal(bad.code, 400, JSON.stringify(bad.j));
    base.members[0].email = 'kim@example.com'; base.members[0].answers = 'none'; base.members[0].approval = 'off';
    const ok = await call('POST', '/api/team', 'terminal', { team: base });
    assert.equal(ok.code, 200, JSON.stringify(ok.j));
    const t = await call('GET', '/api/team', 'terminal');
    const k = t.j.team.members.find((m) => m.user === 'kim');
    assert.deepEqual({ email: k.email, answers: k.answers, approval: k.approval }, { email: 'kim@example.com', answers: 'none', approval: 'off' });
    assert.deepEqual(board.memberRule('kim'), { answers: 'none', approval: false });
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('넣은 일 — 계정별 «승인 없이 바로»·«승인 뒤» 가 팀 기본과 반대로 · 팀원·작업방은 팀 설정을 못 고침', async () => {
  board.setTeamForTest({ approval: true, memberAnswers: 'own', members: [
    { user: 'kim', name: '김', role: 'member', projects: ['demo'] },
    { user: 'lee', name: '이', role: 'member', projects: ['demo'], approval: 'off' },
  ] });
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  const tok = { kim: board.auth.createSession('kim', 'tunnel', true), lee: board.auth.createSession('lee', 'tunnel', true) };
  const as = (id, url, body) => new Promise((ok, no) => {
    const headers = { 'x-test-sock': id === 'agent' ? 'agent' : 'tunnel', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    if (tok[id]) headers.cookie = 'sb_sess_8800=' + encodeURIComponent(tok[id]);
    const r = http.request({ host: '127.0.0.1', port, path: url, method: 'POST', agent: false, headers }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok([res.statusCode, j]); }); });
    r.on('error', no); r.write(JSON.stringify(body)); r.end();
  });
  try {
    const k = await as('kim', '/api/rooms', { project: 'demo', task: '김의 일', queue: true });
    assert.equal(k[0], 200, JSON.stringify(k[1])); assert.ok(k[1].proposal, '팀 기본(승인 뒤) → 제안');
    const l = await as('lee', '/api/rooms', { project: 'demo', task: '이의 일', queue: true });
    assert.equal(l[0], 200, JSON.stringify(l[1])); assert.ok(!l[1].proposal, '이 사람만 «바로» → 대기열');
    const team = { approval: false, memberAnswers: 'project', members: [{ user: 'kim', name: '김', role: 'member', projects: ['demo'], approval: 'off', answers: 'project' }] };
    assert.equal((await as('kim', '/api/team', { team }))[0], 403, '팀원은 자기 설정을 못 넓힘');
    assert.equal((await as('agent', '/api/team', { team }))[0], 403, '작업방도 못 고침');
    board.setTeamForTest({ approval: false, memberAnswers: 'own', members: [{ user: 'kim', name: '김', role: 'member', projects: ['demo'], approval: 'on' }] });
    const k2 = await as('kim', '/api/rooms', { project: 'demo', task: '김의 일 2', queue: true });
    assert.ok(k2[1].proposal, '팀 기본이 «바로» 여도 이 사람만 «승인 뒤» → 제안');
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});
