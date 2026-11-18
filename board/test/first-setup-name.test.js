// 처음 설정 — 서버 이름이 비었으면 키를 넣기 전에 이름부터 · 맥 자동 통로 안내(공개판) · 끊김·통로 권하기 자리
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { serverName: '', devSsh: 'ssh owner@203.0.113.5', port: 8801 } });
test.after(() => sb.cleanup());

let port;
function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const headers = { 'x-test-sock': sock, host: 'localhost:8801', origin: 'http://localhost:8801', 'content-type': 'application/json' };
    const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} ok({ code: res.statusCode, j }); });
    });
    r.on('error', no); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

test('처음 설정: 서버 이름 비었으면 nameEmpty → 통로로만 한 번 정함 → 앱 항목 이름이 바뀜(같은 키)', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const b1 = await call('POST', '/api/auth/setup-begin', 'tunnel', {});
    assert.equal(b1.code, 200, JSON.stringify(b1.j));
    assert.equal(b1.j.kind, 'first');
    assert.equal(b1.j.nameEmpty, true);
    assert.equal(b1.j.issuer, 'Server Board · 203.0.113.5', '빈 이름이면 주소가 앱 항목에 들어감 — 그래서 묻는다');

    for (const sock of ['agent', 'terminal', 'tailscale', 'root']) {
      const r = await call('POST', '/api/auth/setup-name', sock, { name: 'X' });
      assert.equal(r.code, 403, sock + ' 은 못 바꿈');
    }
    assert.equal((await call('POST', '/api/auth/setup-name', 'tunnel', { name: '   ' })).code, 400);
    assert.equal((await call('POST', '/api/auth/setup-name', 'tunnel', { name: 'a$b' })).code, 400);

    const ok = await call('POST', '/api/auth/setup-name', 'tunnel', { name: ' Office:dev ' });
    assert.equal(ok.code, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.name, 'Office dev', '«:» 는 띄어쓰기로(앱 항목을 가르는 글자)');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sb.dir, 'config.json'), 'utf8')).serverName, 'Office dev');
    assert.equal(board.serverLabel(), 'Office dev');

    const b2 = await call('POST', '/api/auth/setup-begin', 'tunnel', {});
    assert.equal(b2.j.nameEmpty, false);
    assert.equal(b2.j.issuer, 'Server Board · Office dev');
    assert.equal(b2.j.secret, b1.j.secret, '이름을 바꿔도 키는 그대로(이미 앱에 넣었어도 맞음)');

    assert.equal((await call('POST', '/api/auth/setup-name', 'tunnel', { name: '딴이름' })).code, 409, '이미 이름이 있으면 덮어쓰지 않음');

    // 처음 설정을 마치면 다시는 못 바꿈
    const done = await call('POST', '/api/auth/setup', 'tunnel', { nonce: b2.j.nonce, password: 'abcdefghijk1', code: board.auth.totpNow(b2.j.secret) });
    assert.equal(done.code, 200, JSON.stringify(done.j));
    assert.equal((await call('POST', '/api/auth/setup-name', 'tunnel', { name: 'Y' })).code, 403);
  } finally { board.server.close(); }
});

test('화면: 공개판 자동 통로 안내만 · 포트·통로 종류 채움 · 끊김 진단·통로 권하기·새 판 배지 자리', () => {
  const html = board.renderIndex();
  assert.ok(!/<!--tun[LC]-->|__MAC_TUN__|__BOARD_PORT__/.test(html), '자리표·표시가 남지 않음');
  assert.ok(html.includes("MAC_TUN = 'connect'"), '이 저장소에 옛 스크립트가 없으면 공개판 안내');
  assert.ok(html.includes("BOARD_PORT = '8801'"));
  assert.ok(!/mac-setup\.sh \| bash<\/pre>|mac-setup\.sh<\/code>|Host dev<\/code>/.test(html), '옛 스크립트 안내 글은 지워짐(값 한 줄은 공개판 묶기가 지움)');
  assert.ok(html.includes('class="js-rc js-tuninst"'), '자동 통로 한 줄 자리');
  assert.ok(html.includes('id="cx-mactun"') && html.includes('class="tun-steps"'), '①~④ 단계 칸');
  assert.ok(html.includes('id="updbadge"'), '머리 새 판 배지');
  assert.ok(html.includes('function tunHintBox') && html.includes('#autotunnel='), '통로 권하기 · 자동 통로 표시');
  assert.ok(html.includes("cm.appendChild(rc(TUN.diag))"), '끊김 화면에 바로 진단 한 줄');
  assert.ok(html.includes('TUN.check = ') && html.includes("K('이미 깔았어요', 'Already installed')"), '통로 권하기에 «이미 깔았어요» 점검 한 줄(다른 브라우저·표시 전 멈춤)');
});
