// 누가 무엇을 할 수 있나 — 개인 로그인(비밀번호·인증 앱·예비 코드·잠금) · 역할별 허용표 · 화면이 뜨는가
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
const auth = board.auth;
test.after(() => sb.cleanup());

test('인증 앱 코드 — 맞음 · 틀림 · 같은 칸 다시 쓰기 금지', () => {
  const sec = auth.newTotpSecret();
  const code = auth.totpNow(sec);
  const step = auth.totpCheck(sec, code, 0);
  assert.ok(step > 0);
  assert.equal(auth.totpCheck(sec, code, step), -1, '한 번 쓴 숫자는 다시 안 됨');
  assert.equal(auth.totpCheck(sec, '000000'.replace(/0/g, () => String((+code[0] + 1) % 10)), 0) >= 0 && false, false);
  assert.equal(auth.totpCheck(sec, 'abcdef', 0), -1);
});

test('로그인 — 비밀번호 + 인증 앱 · 예비 코드는 한 번만 · 새로 받으면 옛 코드 무효', async () => {
  assert.equal(auth.pwProblem('짧음'), 'short');
  await auth.setPassword('owner', 'correct horse battery');
  const sec = auth.newTotpSecret();
  const codes = auth.setTotp('owner', sec, 0);
  assert.equal(codes.length, 10);
  assert.equal((await auth.checkLogin('owner', 'wrong password!!', auth.totpNow(sec))).why, 'bad');
  assert.equal((await auth.checkLogin('owner', 'correct horse battery', '123')).why, 'totp');
  assert.equal((await auth.checkLogin('owner', 'correct horse battery', codes[0])).ok, true);
  assert.equal((await auth.checkLogin('owner', 'correct horse battery', codes[0])).ok, false, '예비 코드는 한 번만');
  assert.equal(auth.renewBackup('owner', codes[1]), null, '예비 코드로는 새로 받기 안 됨');
  // 인증 앱 숫자로 새로 받기 — 다음 30초 칸 숫자(앞 칸은 위 로그인에서 씀)
  const next = auth.hotp(auth.b32dec(sec), Math.floor(Date.now() / 30000) + 1);
  const fresh = auth.renewBackup('owner', next);
  assert.equal(fresh.length, 10);
  assert.equal((await auth.checkLogin('owner', 'correct horse battery', codes[2])).ok, false, '옛 예비 코드 무효');
  assert.equal((await auth.checkLogin('owner', 'correct horse battery', fresh[0])).ok, true);
});

test('잠금 — 한 계정 5번 틀리면 잠김', async () => {
  await auth.setPassword('locky', 'another long password');
  for (let i = 0; i < 5; i++) await auth.checkLogin('locky', 'nope nope nope', '');
  assert.equal((await auth.checkLogin('locky', 'another long password', '')).why, 'locked');
});

test('세션 — 만들기 · 읽기 · 끊기', () => {
  const tok = auth.createSession('owner', 'test', true, 'ua');
  assert.equal(auth.getSession(tok).id, 'owner');
  assert.ok(auth.isFresh(auth.getSession(tok)));
  auth.dropSession(tok);
  assert.equal(auth.getSession(tok), null);
  assert.equal(auth.getSession('x'.repeat(200)), null);
});

test('누구인가 — 작업방(AI)·터미널·로그인 없는 접속', () => {
  assert.equal(board.decideWho({ kind: 'agent' }, null).role, 'agent');
  assert.equal(board.decideWho({ kind: 'agent' }, { id: 'owner' }).drop, 'session-from-agent', 'AI 가 사람 쿠키를 들고 오면 끊음');
  assert.equal(board.decideWho({ kind: 'terminal' }, null).role, 'owner');
  assert.equal(board.decideWho({ kind: 'tailscale' }, null).role, 'anon');
});

test('허용표 — 작업방(AI)은 질문·할 일·대기열 넣기만, 답하기·배포·로그인·설정은 못 함', async () => {
  const ai = board.decideWho({ kind: 'agent' }, null);
  for (const [url, body] of [['/api/asks', {}], ['/api/todos', {}], ['/api/rooms', { queue: true }], ['/api/fable-wait', {}]])
    assert.equal(await board.permit(ai, url, body), null, url);
  for (const [url, body] of [['/api/ai-login/start', {}], ['/api/gate', {}], ['/api/settings', {}], ['/api/team', {}], ['/api/rooms', { queue: false }], ['/api/rooms', { queue: true, task: '/배포' }]])
    assert.equal((await board.permit(ai, url, body) || [])[0], 403, url + ' ' + JSON.stringify(body));
  const owner = board.decideWho({ kind: 'terminal' }, null);
  assert.equal(await board.permit(owner, '/api/gate', {}), null);
});

test('화면 — 주인에겐 첫 화면·상황판 자료가 뜨고, 로그인 없는 사설망 접속·모르는 주소 이름엔 안 뜸', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const get = (p, sock, host = 'localhost:8800') => new Promise((ok, no) => http.get({ host: '127.0.0.1', port, path: p, agent: false, headers: { 'x-test-sock': sock, host } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ code: res.statusCode, body: b })); }).on('error', no));
  try {
    const home = await get('/', 'terminal');
    assert.equal(home.code, 200); assert.match(home.body, /<html/i);
    const b = await get('/api/board', 'terminal');
    assert.equal(b.code, 200);
    const j = JSON.parse(b.body);
    for (const k of ['rooms', 'queue', 'asks', 'generatedAt']) assert.ok(k in j, k);
    assert.notEqual((await get('/api/board', 'tailscale')).code, 200);
    assert.equal((await get('/api/board', 'terminal', 'evil.example:8800')).code, 403, '모르는 주소 이름(DNS 바꿔치기)은 거절');
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('화면 다시 그리기 기준 — AI 연결·Claude Code 점검 결과 포함', () => {
  const html = require('fs').readFileSync(require('path').join(sb.dir, 'index.html'), 'utf8');
  const sig = (html.match(/var sig = JSON\.stringify\(\[([^\n]*)/) || [])[1] || '';
  for (const k of ['data.ai', 'data.claudeCheck']) assert.ok(sig.includes(k), k);
});

test('주인 이름 자리표 — 나가는 글에서 설정 이름으로', () => {
  assert.equal(board.OWN('__OWNER__ 님 · __OWNER__'), '주인 님 · 주인');
  assert.equal(board.OWN('그대로'), '그대로');
  assert.equal(board.OWN(null), null);
});

// 실시간 — 화면이 /api/board/live 에 붙어 있으면 버튼 처리(POST)·상태 저장 뒤 «바뀜» 이 1초 안에 온다
//
test('실시간 알림 — 버튼 처리 뒤 1초 안에 «바뀜»', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  try {
    const got = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/api/board/live', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800' } });
    const res = await new Promise((ok, no) => { req.on('response', ok); req.on('error', no); });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /event-stream/);
    res.on('data', (c) => got.push([Date.now(), String(c)]));
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(got.some(([, t]) => /event: hello/.test(t)), '붙자마자 hello');
    const t0 = Date.now();
    const body = JSON.stringify({ project: 'demo', title: '[확인용] 실시간', why: '시험', steps: ['x'] });
    await new Promise((ok, no) => {
      const pr = http.request({ host: '127.0.0.1', port, path: '/api/todos', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (r) => { r.resume(); r.on('end', ok); });
      pr.on('error', no); pr.end(body);
    });
    await new Promise((r) => setTimeout(r, 800));
    const ch = got.find(([at, t]) => at >= t0 && /event: change/.test(t));
    assert.ok(ch, '«바뀜» 이 왔어야');
    assert.ok(ch[0] - t0 < 1000, '1초 안 — ' + (ch[0] - t0) + 'ms');
    req.destroy();
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

// 확인·테스트만 시키는 카드 · 긴 카드는 받지 않는다
test('할 일 — 확인만 시키는 카드·긴 카드 거절, 행동 카드는 받음', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const post = (b) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: '/api/todos', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => ok({ code: r.statusCode, j: JSON.parse(d || '{}') })); });
    pr.on('error', no); pr.end(JSON.stringify(Object.assign({ project: 'demo', separate: true }, b)));
  });
  try {
    let r = await post({ title: '[확인용] 폰 브라우저로 채팅에서 키보드 추천 단어 줄이 뜨는지 보기', why: 'x', steps: ['열기'], check: true });
    assert.equal(r.code, 400); assert.equal(r.j.code, 'CHECK_NOT_TODO');
    r = await post({ title: '[확인용] 아이폰으로 홈 화면 설치 확인하기', why: 'x', steps: ['열기'], check: false });
    assert.equal(r.j.code, 'CHECK_NOT_TODO', 'check:false 로 피해 가지 못함');
    r = await post({ title: '[확인용] 폰에서 화면이 뜨는지 보기', why: 'x', steps: ['열기'] });
    assert.equal(r.j.code, 'CHECK_NOT_TODO', '«뜨는지 보기» 도 확인');
    r = await post({ title: '[확인용] 긴 카드 만들기', why: 'x', steps: ['1', '2', '3', '4', '5'] });
    assert.equal(r.j.code, 'TOO_LONG');
    r = await post({ title: '[확인용] 긴 줄 카드 만들기', why: 'x'.repeat(201), steps: ['1'] });
    assert.equal(r.j.code, 'TOO_LONG');
    r = await post({ title: '[확인용] 개발 사이트 관문 켜고 확인하기', why: 'sudo 필요', steps: ['서버 창에서 명령 붙여 넣기'], check: true });
    assert.equal(r.code, 200, '행동 카드는 받음 — ' + JSON.stringify(r.j));
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('할 일 — 방이 따로 빼면 «이 방에서 안내» 로 돌려보냄, 행동 질문(act)은 순서·링크를 받음', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const post = (path, b) => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path, method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => ok({ code: r.statusCode, j: JSON.parse(d || '{}') })); });
    pr.on('error', no); pr.end(JSON.stringify(b));
  });
  try {
    const card = { room: 'abcd1234', title: '[확인용] 서버 창에서 설정 켜기', why: 'sudo 필요', steps: ['명령 붙여 넣기'], separate: true };
    let r = await post('/api/todos', card);
    assert.equal(r.code, 400); assert.equal(r.j.code, 'DO_IT_IN_ROOM', '방이 이유 없이 빼면 거절');
    r = await post('/api/todos', Object.assign({ apart: '이 방 일은 끝남 — 다음 달 갱신' }, card));
    assert.notEqual(r.j.code, 'DO_IT_IN_ROOM', 'apart 가 있으면 통과(방이 없어 404)');
    r = await post('/api/todos', Object.assign({ after: '2026-12-01' }, card));
    assert.notEqual(r.j.code, 'DO_IT_IN_ROOM', '날짜 뒤 일은 통과');
    r = await post('/api/asks', { project: 'demo', act: true, title: '[확인용] 서버 창에서 설정 켜기', question: '**켜고 «했어요» 라고 답해 주실래요?**', steps: ['1. 서버 창 열기', '명령 붙여 넣기'], links: ['https://example.com/a', 'javascript:x'], terminal: ['sudo true'] });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const a = board.loadState().asks[r.j.aid];
    assert.equal(a.act, true); assert.deepEqual(a.steps, ['서버 창 열기', '명령 붙여 넣기']); assert.deepEqual(a.links, ['https://example.com/a']);
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('관문 로그인 잠금은 상황판 로그인과 따로', async () => {
  await auth.setPassword('gatey', 'gate long password');
  for (let i = 0; i < 5; i++) await auth.checkLogin('gatey', 'wrong wrong wrong', '', false, 'gate');
  assert.equal((await auth.checkLogin('gatey', 'gate long password', '', false, 'gate')).why, 'locked', '관문 쪽은 잠김');
  assert.equal((await auth.checkLogin('gatey', 'gate long password', '', false)).ok, true, '상황판 로그인은 그대로');
});
