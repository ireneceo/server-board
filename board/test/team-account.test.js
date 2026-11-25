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
  assert.match(dev.cmd, /useradd -m -s \/bin\/bash lee/); assert.match(dev.cmd, /usermod -c board-[0-9a-f]{10} -s \/bin\/bash lee && echo OK$/);
  assert.doesNotMatch(dev.cmd, /restrict|permitopen/);
  const des = board.accountSetup({ user: 'kim', job: 'designer', pubkey: KEY }, accts);
  assert.equal(des.shell, 'tunnel'); assert.equal(des.ready, true, '이미 통로 전용이면 준비됨');
  assert.match(des.cmd, /restrict,port-forwarding,permitopen="127\.0\.0\.1:\d+",permitlisten="127\.0\.0\.1:\d+",command="\/usr\/sbin\/nologin" ssh-ed25519 /);
  assert.match(des.cmd, /usermod -c board-[0-9a-f]{10} -s \/usr\/sbin\/nologin kim/);
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
  // 상황판 계정 먼저 · 서버 계정은 열쇠 없이도 만듦
  const nw = board.accountSetup({ user: 'park', job: '', pubkey: '' }, accts);
  assert.deepEqual([nw.exists, nw.needKey, nw.ready], [false, true, false]);
  assert.equal(nw.cmd, '(id -u park >/dev/null 2>&1 || sudo useradd -m -s /usr/sbin/nologin park) && sudo usermod -c board -s /usr/sbin/nologin park && echo OK', '열쇠 없이 계정만 — 열쇠 파일은 안 건드림');
  // 계정 만들어짐(표지 board) · 열쇠 아직 → 줄 없음, 열쇠 받으면 넣기
  const made = [{ user: 'park', shell: 'tunnel', admin: false, note: 'board' }];
  const k0 = board.accountSetup({ user: 'park', job: '', pubkey: '' }, made);
  assert.deepEqual([k0.acctOk, k0.keyOk, k0.ready, k0.cmd], [true, false, false, '']);
  // 열쇠 넣고 저장 → 열쇠 등록 줄 · 표지가 그 열쇠 지문이 될 때까지 준비 안 됨
  const k1 = board.accountSetup({ user: 'park', job: '', pubkey: KEY }, made);
  assert.deepEqual([k1.acctOk, k1.keyOk, k1.ready], [true, false, false]);
  const tag = k1.cmd.match(/usermod -c (board-[0-9a-f]{10}) /)[1];
  assert.match(k1.cmd, /authorized_keys/);
  const k2 = board.accountSetup({ user: 'park', job: '', pubkey: KEY }, [{ user: 'park', shell: 'tunnel', admin: false, note: tag }]);
  assert.equal(k2.ready, true, '줄을 실행하면(표지 = 이 열쇠) 준비됨');
  // 열쇠를 바꾸면 다시 준비 안 됨
  const KEY2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
  assert.equal(board.accountSetup({ user: 'park', job: '', pubkey: KEY2 }, [{ user: 'park', shell: 'tunnel', admin: false, note: tag }]).ready, false);
  // 줄 안의 작은따옴표는 printf 와 sh -c 두 쌍뿐 — 열쇠에서 따옴표가 새로 들어오지 않음
  assert.equal((des.cmd.match(/'/g) || []).length, 6);
});

test('저장 — 서버 계정 꼭 · 시스템·관리자 계정 거절 · 아직 없는 이름은 저장되고 한 줄이 나옴', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const save = (members) => call('POST', '/api/team', 'terminal', { team: { members } });
    let r = await save([{ name: '메일만', tailscale: 'a@b.c', role: 'member', projects: [] }]);
    assert.equal(r.code, 400); assert.match(r.j.message, /아이디/);
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
    // 열쇠 없이 저장 — 상황판 계정 먼저, 서버 계정 줄은 그대로 나옴
    r = await save([{ user: 'zz-nokey', name: '열쇠없음', role: 'viewer', job: '', projects: [] }]);
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const t2 = await call('GET', '/api/team', 'terminal');
    assert.match(t2.j.setup['zz-nokey'].cmd, /useradd -m -s \/usr\/sbin\/nologin zz-nokey\) && sudo usermod -c board /);
    assert.ok(t.j.accounts.every((a) => a.shell === 'login' || a.shell === 'tunnel'), '통로 전용 계정도 목록에(셸 표시)');
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

// 상황판이 열쇠 만들기 — 통로 전용만 · 개인 열쇠는 메모리에만 · 초대 때 «준비됨» 이어야 한 번
test('열쇠 만들기 — 개발자도 됨(터미널 줄) · 통로 전용은 공개 열쇠 저장·keyGen · 개인 열쇠는 /api/team·config 에 없음 · 준비 전 초대 거절', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  port = board.server.address().port;
  try {
    const save = (members) => call('POST', '/api/team', 'terminal', { team: { members } });
    let r = await save([{ user: 'zz-gen', name: '통로', role: 'member', job: 'planner', projects: [] }, { user: 'zz-dev', name: '개발', role: 'member', job: 'developer', projects: [] }]);
    assert.equal(r.code, 200, JSON.stringify(r.j));
    r = await call('POST', '/api/team/keygen', 'terminal', { user: 'zz-dev' });
    assert.equal(r.code, 200, '개발자(셸)도 상황판이 만든 열쇠 (2026-11-25 __OWNER__)');
    { const t0 = await call('GET', '/api/team', 'terminal'); const sd = t0.j.setup['zz-dev'];
      assert.deepEqual([sd.keyGen, sd.keyPending, sd.canGen, sd.shell], [true, true, true, 'login']);
      assert.match(sd.cmd, /\/bin\/bash/); assert.doesNotMatch(sd.cmd, /restrict/, '개발자 줄은 통로 제한 없음');
      // 같은 개발자로 다시 저장 = 열쇠 유지 · 통로 전용으로 바꾸면 버림
      const dm = t0.j.team.members.find((x) => x.user === 'zz-dev');
      await save([{ user: 'zz-gen', name: '통로', role: 'member', job: 'planner', projects: [] }, { user: 'zz-dev', name: '개발', role: 'member', job: 'developer', pubkey: dm.pubkey, projects: [] }]);
      let t1 = await call('GET', '/api/team', 'terminal'); assert.equal(t1.j.team.members.find((x) => x.user === 'zz-dev').keyGen, true);
      await save([{ user: 'zz-gen', name: '통로', role: 'member', job: 'planner', projects: [] }, { user: 'zz-dev', name: '개발', role: 'member', job: 'planner', pubkey: dm.pubkey, projects: [] }]);
      t1 = await call('GET', '/api/team', 'terminal'); const d1 = t1.j.team.members.find((x) => x.user === 'zz-dev');
      assert.deepEqual([d1.pubkey, d1.keyGen, board.genKeys.has('zz-dev')], ['', false, false], '개발자 → 통로 전용이면 상황판 열쇠 버림'); }
    r = await call('POST', '/api/team/keygen', 'terminal', { user: 'zz-gen' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const t = await call('GET', '/api/team', 'terminal');
    const m = t.j.team.members.find((x) => x.user === 'zz-gen');
    assert.match(m.pubkey, /^ssh-ed25519 [A-Za-z0-9+/=]+$/); assert.equal(m.keyGen, true);
    const su = t.j.setup['zz-gen'];
    assert.deepEqual([su.keyGen, su.keyPending, su.canGen, su.ready], [true, true, true, false]);
    assert.match(su.cmd, /restrict,port-forwarding/);
    assert.doesNotMatch(JSON.stringify(t.j), new RegExp('PRIVATE ' + 'KEY'), '/api/team 에 개인 열쇠 없음');
    assert.doesNotMatch(require('fs').readFileSync(require('path').join(sb.dir, 'config.json'), 'utf8'), new RegExp('PRIVATE ' + 'KEY'), 'config 에 개인 열쇠 없음');
    assert.ok(board.genKeys.get('zz-gen').priv.startsWith('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'));
    // 서버 계정이 아직 «준비됨» 이 아니면 안내문(열쇠 포함) 거절 — 열쇠는 그대로 남음
    r = await call('POST', '/api/auth/invite', 'terminal', { id: 'zz-gen' });
    assert.equal(r.code, 409, JSON.stringify(r.j)); assert.ok(board.genKeys.has('zz-gen'));
    // 같은 열쇠로 다시 저장해도 keyGen 유지 · 직무를 개발자로 바꾸면 열쇠 버림
    r = await save([{ user: 'zz-gen', name: '통로', role: 'member', job: 'planner', pubkey: m.pubkey, keyGen: false, projects: [] }]);
    let t2 = await call('GET', '/api/team', 'terminal');
    assert.equal(t2.j.team.members[0].keyGen, true, '화면이 보낸 keyGen 값이 아니라 서버가 가름');
    r = await save([{ user: 'zz-gen', name: '통로', role: 'member', job: 'developer', pubkey: m.pubkey, projects: [] }]);
    t2 = await call('GET', '/api/team', 'terminal');
    assert.deepEqual([t2.j.team.members[0].pubkey, t2.j.team.members[0].keyGen, board.genKeys.has('zz-gen')], ['', false, false]);
    await save([{ user: 'zz-up', name: 'u', role: 'member', job: 'planner', projects: [] }]);
    assert.equal((await call('POST', '/api/team/keygen', 'terminal', { user: 'zz-up' })).code, 200);
    { const up = (await call('GET', '/api/team', 'terminal')).j.team.members[0];
      await save([{ user: 'zz-up', name: 'u', role: 'member', job: 'developer', pubkey: up.pubkey, projects: [] }]);
      const u2 = (await call('GET', '/api/team', 'terminal')).j.team.members[0];
      assert.deepEqual([u2.pubkey, u2.keyGen, board.genKeys.has('zz-up')], ['', false, false], '통로 → 개발자면 상황판 열쇠 버림'); }
    // 화면이 keyGen:true 를 꾸며 보내도 안 됨
    r = await save([{ user: 'zz-x', name: 'x', role: 'member', job: 'planner', pubkey: KEY, keyGen: true, projects: [] }]);
    t2 = await call('GET', '/api/team', 'terminal');
    assert.equal(t2.j.team.members[0].keyGen, false);
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});

test('만든 열쇠 — 그 공개 열쇠일 때만 남은 것으로 · 24시간 지나면 버림', async () => {
  const kp = await board.makeKeyPair('zz-once');
  board.setTeamForTest({ members: [{ user: 'zz-once', name: 'o', role: 'member', job: 'planner', pubkey: kp.pub, keyGen: true, projects: [] }] });
  board.genKeys.set('zz-once', { priv: kp.priv, pub: kp.pub, at: Date.now() });
  assert.equal(board.genKeyPending({ user: 'zz-once', keyGen: true, pubkey: kp.pub }), true);
  board.genKeys.get('zz-once').at = Date.now() - 25 * 3600e3;
  assert.equal(board.genKeyPending({ user: 'zz-once', keyGen: true, pubkey: kp.pub }), false, '24시간 지나면 버림');
  assert.equal(board.genKeys.has('zz-once'), false);
});

test('만든 열쇠 + 표지 없는 있는 계정 — 붙여 넣기 전엔 준비 안 됨 · authorized_keys 교체 경고', () => {
  const pub = KEY;
  for (const note of ['', 'Kim']) {
    const r = board.accountSetup({ user: 'kim', job: 'planner', pubkey: pub, keyGen: true }, [{ user: 'kim', shell: 'tunnel', admin: false, note }]);
    assert.deepEqual([r.ready, r.hadKeys], [false, true], note);
    assert.match(r.cmd, /restrict,port-forwarding/);
  }
  const ok = board.accountSetup({ user: 'kim', job: 'planner', pubkey: pub, keyGen: true }, [{ user: 'kim', shell: 'tunnel', admin: false, note: board.accountSetup({ user: 'kim', job: 'planner', pubkey: pub }, []).cmd.match(/usermod -c (board-[0-9a-f]+)/)[1] }]);
  assert.deepEqual([ok.ready, ok.hadKeys], [true, false]);
  // 표지 없는 예전 계정에 그 사람이 보낸 열쇠(keyGen 아님)는 예전처럼
  assert.equal(board.accountSetup({ user: 'kim', job: 'planner', pubkey: pub }, [{ user: 'kim', shell: 'tunnel', admin: false, note: '' }]).ready, true);
});
