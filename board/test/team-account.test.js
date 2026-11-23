// ⚙ 팀·권한 «서버 계정 붙여 넣기 한 줄» — 개발자만 셸 · 나머지 통로만 · 서버 계정 꼭 있음 · 열쇠 글은 종류·base64 만
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { serverName: '시험서버', team: { members: [] } } });
test.after(() => sb.cleanup());
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

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

test('공개 열쇠 — 꼬리표·따옴표·명령은 버리고 종류·base64 만', () => {
  assert.equal(board.cleanPubkey(KEY + ' kim@mac'), KEY);
  assert.equal(board.cleanPubkey("  " + KEY + "  x'; rm -rf / #"), KEY, '꼬리표에 든 따옴표·명령은 줄에 안 들어감');
  assert.equal(board.cleanPubkey("ssh-ed25519 AAAA'$(id)'"), '', '본문이 base64 가 아니면 버림');
  assert.equal(board.cleanPubkey('command="x" ' + KEY), '', '열쇠 줄 앞 옵션은 받지 않음');
  assert.equal(board.cleanPubkey('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'), '', '비밀 열쇠는 안 받음');
});

test('한 줄 — 개발자는 셸·제한 없음 · 나머지는 nologin + 통로 하나만', () => {
  const accts = [{ user: 'kim', shell: 'tunnel', admin: false }, { user: 'lee', shell: 'login', admin: false }];
  const dev = board.accountSetup({ user: 'lee', job: 'developer', pubkey: KEY }, accts);
  assert.equal(dev.shell, 'login'); assert.equal(dev.ready, true);
  assert.match(dev.cmd, /useradd -m -s \/bin\/bash lee/); assert.match(dev.cmd, /usermod -s \/bin\/bash lee && echo OK$/);
  assert.doesNotMatch(dev.cmd, /restrict|permitopen/);
  const des = board.accountSetup({ user: 'kim', job: 'designer', pubkey: KEY }, accts);
  assert.equal(des.shell, 'tunnel'); assert.equal(des.ready, true, '이미 통로 전용이면 준비됨');
  assert.match(des.cmd, /restrict,port-forwarding,permitopen="127\.0\.0\.1:\d+",permitlisten="127\.0\.0\.1:\d+",command="\/usr\/sbin\/nologin" ssh-ed25519 /);
  assert.match(des.cmd, /usermod -s \/usr\/sbin\/nologin kim/);
  assert.match(des.cmd, /sudo -H -u kim sh -c/, '열쇠 파일은 그 계정으로 씀');
  assert.doesNotMatch(des.cmd, /localhost/, 'localhost 는 ::1 로 풀릴 수 있어 안 씀');
  // 개발자 → 디자이너: 셸 계정을 통로 전용으로 낮추지 않음(cron 등 남음) — 줄 없음
  const down = board.accountSetup({ user: 'lee', job: 'designer', pubkey: KEY }, accts);
  assert.deepEqual([down.block, down.cmd, down.ready], ['downgrade', '', false]);
  // 줄을 만들 때마다 다시 가름 — 시스템·관리자·주인 계정이면 줄 없음
  assert.equal(board.accountSetup({ user: 'root', job: 'developer', pubkey: KEY }, accts, new Set(['root'])).cmd, '');
  assert.equal(board.accountSetup({ user: 'root', job: 'developer', pubkey: KEY }, accts, new Set(['root'])).block, 'system');
  assert.equal(board.accountSetup({ user: 'adm', job: 'developer', pubkey: KEY }, [{ user: 'adm', shell: 'login', admin: true }]).cmd, '');
  assert.equal(board.accountSetup({ user: 'me', job: 'developer', pubkey: KEY }, [{ user: 'me', shell: 'login', owner: true }]).block, 'admin');
  const nw = board.accountSetup({ user: 'park', job: '', pubkey: '' }, accts);
  assert.deepEqual([nw.exists, nw.needKey, nw.cmd, nw.ready], [false, true, '', false], '열쇠 없으면 줄 없음');
  // 줄 안의 작은따옴표는 printf 와 sh -c 두 쌍뿐 — 열쇠에서 따옴표가 새로 들어오지 않음
  assert.equal((des.cmd.match(/'/g) || []).length, 6);
});

test('저장 — 서버 계정 꼭 · 시스템·관리자 계정 거절 · 아직 없는 이름은 저장되고 한 줄이 나옴', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const save = (members) => call('POST', '/api/team', 'terminal', { team: { members } });
    let r = await save([{ name: '메일만', tailscale: 'a@b.c', role: 'member', projects: [] }]);
    assert.equal(r.code, 400); assert.match(r.j.message, /서버 계정/);
    r = await save([{ user: 'root', name: 'r', role: 'viewer', projects: [] }]);
    assert.equal(r.code, 400, '시스템 계정');
    r = await save([{ user: 'Bad Name', name: 'x', role: 'viewer', projects: [] }]);
    assert.equal(r.code, 400);
    r = await save([{ user: 'zz-new-test', name: '새사람', role: 'member', job: 'planner', pubkey: KEY + ' me@mac', projects: [] }]);
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const t = await call('GET', '/api/team', 'terminal');
    assert.equal(t.j.team.members[0].pubkey, KEY, '꼬리표 뺀 열쇠로 저장');
    const su = t.j.setup['zz-new-test'];
    assert.deepEqual([su.exists, su.shell, su.ready], [false, 'tunnel', false]);
    assert.match(su.cmd, /useradd -m -s \/usr\/sbin\/nologin zz-new-test/);
    assert.ok(t.j.accounts.every((a) => a.shell === 'login' || a.shell === 'tunnel'), '통로 전용 계정도 목록에(셸 표시)');
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});
