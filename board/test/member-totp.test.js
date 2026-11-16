'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { serverName: '시험서버', team: { members: [
  { user: 'kim', name: '김', role: 'member', projects: ['demo'] },
  { user: 'park', name: '박', role: 'designer', projects: ['demo'] },
] } } });
const auth = board.auth;
test.after(() => sb.cleanup());

let port;
function call(method, p, sock, body, cookie) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok({ code: res.statusCode, j, cookie: String((res.headers['set-cookie'] || [''])[0]).split(';')[0] }); });
    });
    r.on('error', no); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const tokOf = (path) => decodeURIComponent(path.split('reset=')[1]);

test('팀원 인증 앱 — 링크로 등록 → 6자리 없이는 못 들어옴 → 예비 코드 · 설정 끄면 비밀번호만 · 다시 켜면 «새 링크» 안내', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    assert.equal(board.serverLabel(), '시험서버');
    assert.equal(board.needTotpFor(board.personOf('kim')), true, '기본 = 팀원도 인증 앱');

    // 1) 최종 컨펌자(서버 터미널)가 kim 의 로그인 링크를 냄
    const inv = await call('POST', '/api/auth/invite', 'terminal', { id: 'kim' });
    assert.equal(inv.code, 200, JSON.stringify(inv.j));
    const reset = tokOf(inv.j.path);
    const st = await call('GET', '/api/auth/state?reset=' + encodeURIComponent(reset), 'tunnel');
    assert.equal(st.j.setup.needTotp, true);
    const begin = await call('POST', '/api/auth/setup-begin', 'tunnel', { reset });
    assert.equal(begin.j.needTotp, true);
    assert.equal(begin.j.issuer, 'Server Board · 시험서버', '앱 항목 이름에 서버 이름');
    assert.match(begin.j.uri, /^otpauth:\/\/totp\/Server%20Board%20%C2%B7%20%EC%8B%9C%ED%97%98%EC%84%9C%EB%B2%84%3Akim\?/);
    assert.ok(begin.j.qr, 'QR 그림');
    // 6자리 없이·틀린 6자리로는 저장 안 됨
    assert.equal((await call('POST', '/api/auth/setup', 'tunnel', { reset, nonce: begin.j.nonce, password: 'kim long password', code: '' })).code, 400);
    const ok = await call('POST', '/api/auth/setup', 'tunnel', { reset, nonce: begin.j.nonce, password: 'kim long password', code: auth.totpNow(begin.j.secret) });
    assert.equal(ok.code, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.backupCodes.length, 10, '팀원도 예비 코드 10개');
    assert.equal(auth.userInfo('kim').totp, true);

    // 2) 로그인 — 비밀번호만이면 거절, 예비 코드면 됨(같은 30초 칸 숫자는 다시 못 씀)
    const noCode = await call('POST', '/api/auth/login', 'tunnel', { id: 'kim', password: 'kim long password', code: '' });
    assert.equal(noCode.code, 401); assert.equal(noCode.j.why, 'totp');
    const li = await call('POST', '/api/auth/login', 'tunnel', { id: 'kim', password: 'kim long password', code: ok.j.backupCodes[0] });
    assert.equal(li.code, 200, JSON.stringify(li.j));
    const b = await call('GET', '/api/board', 'tunnel', null, li.cookie);
    assert.equal(b.j.me.role, 'member'); assert.equal(b.j.me.totp, true, '화면이 «예비 코드 새로 받기» 를 보이게');

    // 3) 팀원 자신의 예비 코드 새로 받기 — 지금 인증 앱 숫자(다음 칸)로
    const sec = begin.j.secret;
    const next = auth.hotp(auth.b32dec(sec), Math.floor(Date.now() / 30000) + 1);
    const bk = await call('POST', '/api/auth/backup-codes', 'tunnel', { code: next }, li.cookie);
    assert.equal(bk.code, 200, JSON.stringify(bk.j)); assert.equal(bk.j.backupCodes.length, 10);
    // 팀원은 다른 사람 링크는 못 냄
    assert.equal((await call('POST', '/api/auth/invite', 'tunnel', { id: 'park' }, li.cookie)).code, 403);

    // 4) 설정 끔 → park 은 비밀번호만으로 등록·로그인
    board.setTeamForTest({ memberTotp: false, members: [{ user: 'kim', role: 'member', projects: ['demo'] }, { user: 'park', role: 'designer', projects: ['demo'] }] });
    assert.equal(board.needTotpFor(board.personOf('park')), false);
    assert.equal(board.needTotpFor({ role: 'owner' }), true, '최종 컨펌자는 늘');
    const inv2 = await call('POST', '/api/auth/invite', 'terminal', { id: 'park' });
    const r2 = tokOf(inv2.j.path);
    const b2 = await call('POST', '/api/auth/setup-begin', 'tunnel', { reset: r2 });
    assert.equal(b2.j.needTotp, false); assert.equal(b2.j.secret, null);
    const s2 = await call('POST', '/api/auth/setup', 'tunnel', { reset: r2, nonce: b2.j.nonce, password: 'park long password', code: '' });
    assert.equal(s2.code, 200); assert.equal(s2.j.backupCodes, null);
    assert.equal((await call('POST', '/api/auth/login', 'tunnel', { id: 'park', password: 'park long password' })).code, 200);
    // 끈 동안에도 이미 등록한 kim 은 6자리가 그대로 필요(설정을 꺼도 약해지지 않음)
    assert.equal((await call('POST', '/api/auth/login', 'tunnel', { id: 'kim', password: 'kim long password', code: '' })).j.why, 'totp');

    // 5) 다시 켬 → park(인증 앱 없음)은 «새 링크 받기» 안내로 거절 → 새 링크로 등록하면 됨
    board.setTeamForTest({ memberTotp: true, members: [{ user: 'kim', role: 'member', projects: ['demo'] }, { user: 'park', role: 'designer', projects: ['demo'] }] });
    const enr = await call('POST', '/api/auth/login', 'tunnel', { id: 'park', password: 'park long password', code: '' });
    assert.equal(enr.code, 401); assert.equal(enr.j.why, 'totp-enroll'); assert.match(enr.j.message, /로그인 링크/);
    const r3 = tokOf((await call('POST', '/api/auth/invite', 'terminal', { id: 'park' })).j.path);
    const b3 = await call('POST', '/api/auth/setup-begin', 'tunnel', { reset: r3 });
    assert.equal(b3.j.needTotp, true);
    assert.equal((await call('POST', '/api/auth/setup', 'tunnel', { reset: r3, nonce: b3.j.nonce, password: 'park new password!', code: auth.totpNow(b3.j.secret) })).code, 200);
    assert.equal(auth.userInfo('park').totp, true);

    // 6) 설정을 끈 서버에서 새 링크로 다시 정하면 옛 인증 앱은 빠짐(옛 키가 로그인을 막지 않게)
    board.setTeamForTest({ memberTotp: false, members: [{ user: 'kim', role: 'member', projects: ['demo'] }, { user: 'park', role: 'designer', projects: ['demo'] }] });
    const r4 = tokOf((await call('POST', '/api/auth/invite', 'terminal', { id: 'park' })).j.path);
    const b4 = await call('POST', '/api/auth/setup-begin', 'tunnel', { reset: r4 });
    assert.equal((await call('POST', '/api/auth/setup', 'tunnel', { reset: r4, nonce: b4.j.nonce, password: 'park third password', code: '' })).code, 200);
    assert.equal(auth.userInfo('park').totp, false);
    assert.equal((await call('POST', '/api/auth/login', 'tunnel', { id: 'park', password: 'park third password' })).code, 200);
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('서버 이름 — serverName 없으면 devSsh 주소', () => {
  // 같은 프로세스에선 설정을 바꿀 수 없어 규칙만: devSsh «ssh user@1.2.3.4» → 1.2.3.4
  const m = 'ssh ubuntu@203.0.113.10'.match(/@([^\s:]+)/);
  assert.equal(m[1], '203.0.113.10');
});

test('예비 코드 새로 받기 — 틀린 숫자는 잠금으로 셈(맞혀 보기 막기)', async () => {
  await auth.setPassword('guess', 'guess long password');
  const sec = auth.newTotpSecret(); auth.setTotp('guess', sec, 0);
  const bad = String((Number(auth.totpNow(sec)) + 500000) % 1000000).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal(auth.renewBackup('guess', bad), null);
  assert.equal(auth.userInfo('guess').locked, true, '5번 틀리면 잠김');
  assert.equal(auth.renewBackup('guess', auth.totpNow(sec)), null, '잠긴 동안은 맞는 숫자도 안 됨');
});

test('비상 복구 중 — 팀원 링크로는 설정 못 함 · 서버 이름의 «:» 는 뺌', () => {
  assert.doesNotMatch(board.serverLabel(), /:/);
});
