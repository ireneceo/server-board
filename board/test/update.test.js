'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..');
const up = require(path.join(SRC, 'updater.js'));

const sh = (cwd, line) => execFileSync('/bin/sh', ['-c', line], { cwd, encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).trim();
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// 가짜 상황판 — /api/ping·/ 에 200 (BROKEN 파일이 있는 판은 바로 죽음)
const GOOD_SERVER = `const fs=require('fs'),path=require('path');if(fs.existsSync(path.join(__dirname,'BROKEN')))process.exit(1);
require('http').createServer((q,s)=>{s.writeHead(200);s.end(fs.readFileSync(path.join(__dirname,'VERSION'),'utf8'))}).listen(+process.env.PORT,'127.0.0.1');`;
// 가짜 pm2 — stop/restart/jlist 만 · pid 는 <root>/pm2.pid
const FAKE_PM2 = `#!${process.env.UPD_TEST_SH || "/bin/sh"}
R="$FAKE_ROOT"; cmd="$1"
stop() { [ -f "$R/pm2.pid" ] && kill "$(cat "$R/pm2.pid")" 2>/dev/null; rm -f "$R/pm2.pid"; sleep 0.2; }
case "$cmd" in
  stop) stop; echo "$*" >> "$R/pm2.log";;
  restart) stop; cd "$FAKE_DIR/board" || exit 1
    # 한 줄씩 — «cd && node &» 는 bash(RHEL 의 /bin/sh)에서 묶음 전체가 서브셸로 떠 시험의 출력 관을 붙잡고 $! 도 node 가 아니었다
    PORT="$FAKE_PORT" nohup node server.js >/dev/null 2>&1 </dev/null &
    echo $! > "$R/pm2.pid"; echo "$*" >> "$R/pm2.log";;
  jlist) P=$(cat "$R/pm2.pid" 2>/dev/null || echo 0); N=$(cat "$R/pm2.log" 2>/dev/null | wc -l); echo '[{"pm_id":7,"pid":'"$P"',"pm2_env":{"status":"online","restart_time":'"$N"',"pm_exec_path":"'"$FAKE_DIR"'/board/server.js"}}]';;
esac
`;

/** 시험 폴더 안에서 돈 프로세스(가짜 상황판·실행기)를 pid 로 모두 끝냄 — 남으면 시험이 끝나지 않고 포트·임시 폴더가 남는다 */
function killUnder(root) {
  let real, all;
  try { real = fs.realpathSync(root); all = fs.readdirSync('/proc'); } catch (_) { return; }
  for (const pid of all.filter((x) => /^\d+$/.test(x) && +x !== process.pid)) {
    let cwd = '', cmd = '';
    try { cwd = fs.readlinkSync('/proc/' + pid + '/cwd'); } catch (_) {}
    try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch (_) {}
    if (cwd === real || cwd.startsWith(real + '/') || cmd.includes(real + '/')) { try { process.kill(+pid, 'SIGKILL'); } catch (_) {} }
  }
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-upd-'));
  const work = path.join(root, 'work'), bare = path.join(root, 'public.git'), inst = path.join(root, 'install'), bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(work, 'board'), { recursive: true }); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(work, 'board', 'server.js'), GOOD_SERVER);
  fs.writeFileSync(path.join(work, 'board', 'VERSION'), '0.1.0\n');
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n\n## [0.1.0] — first\n- a\n');
  fs.writeFileSync(path.join(work, '.gitignore'), 'board/state.json\nboard/log/\nboard/update.lock\nboard/update-result.json\n');
  sh(work, 'git init -q -b main && git add -A && git commit -qm 0.1.0 && git tag -a v0.1.0 -m v0.1.0');
  sh(root, 'git clone -q --bare work public.git && git clone -q public.git install');
  fs.writeFileSync(path.join(inst, 'board', 'state.json'), '{"keep":"old"}');
  fs.writeFileSync(path.join(bin, 'pm2'), FAKE_PM2, { mode: 0o755 });
  const port = await freePort();
  const env = { FAKE_ROOT: root, FAKE_DIR: inst, FAKE_PORT: String(port) };
  Object.assign(process.env, env);
  process.env.PATH = bin + ':' + process.env.PATH;
  sh(inst, '"' + path.join(bin, 'pm2') + '" restart 7');   // 설치본 상황판 켜기
  /** 새 판 내기 — opts: { broken, failTests, notes } */
  const release = (ver, opts = {}) => {
    fs.writeFileSync(path.join(work, 'board', 'VERSION'), ver + '\n');
    if (opts.broken) fs.writeFileSync(path.join(work, 'board', 'BROKEN'), '1'); else fs.rmSync(path.join(work, 'board', 'BROKEN'), { force: true });
    if (opts.failTests) fs.writeFileSync(path.join(work, 'board', 'FAIL_TESTS'), '1'); else fs.rmSync(path.join(work, 'board', 'FAIL_TESTS'), { force: true });
    fs.rmSync(path.join(work, 'board', 'test'), { recursive: true, force: true });
    if (opts.tests) { fs.mkdirSync(path.join(work, 'board', 'test')); for (const [n, src] of Object.entries(opts.tests)) fs.writeFileSync(path.join(work, 'board', 'test', n), src); }
    const cl = fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8').replace('# Changelog\n\n', '# Changelog\n\n## [' + ver + '] — ' + (opts.notes || 'new') + '\n- b\n\n');
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), cl);
    sh(work, 'git add -A && git commit -qm ' + ver + ' && git tag -a v' + ver + ' -m v' + ver + ' && git push -q ' + JSON.stringify(bare) + ' main v' + ver);
  };
  const pm = { id: '7', bin: path.join(bin, 'pm2') };
  fs.mkdirSync(path.join(root, 'tmp'));
  const runEnv = { TMPDIR: path.join(root, 'tmp'), UPDATE_TESTING: '1', UPDATE_TEST_CMD: 'test ! -f "{dir}/FAIL_TESTS"', UPDATE_HEALTH_MS: '8000', UPDATE_STABLE_MS: '1500', UPDATE_MIN_MEM_MB: '1' };
  const waitDone = async () => { for (let i = 0; i < 150; i++) { const r = up.readResult(inst); if (r && r.result && !up.running(inst)) return r; await new Promise((x) => setTimeout(x, 200)); } throw new Error('runner timeout'); };
  const head = () => sh(inst, 'git rev-parse HEAD');
  const cleanup = () => { killUnder(root); fs.rmSync(root, { recursive: true, force: true }); };
  return { root, inst, port, release, pm, runEnv, waitDone, head, cleanup };
}

test('업데이트: 새 판 알림 → 받기 성공 · 기록 그대로', async () => {
  const t = await setup();
  try {
    let c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.newer, false); assert.strictEqual(c.current, '0.1.0');
    t.release('0.2.0', { notes: '<b>new</b> things' });
    c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.newer, true); assert.strictEqual(c.latest, '0.2.0'); assert.strictEqual(c.canApply, true, JSON.stringify(c));
    assert.match(c.notes, /0\.2\.0/); assert.doesNotMatch(c.notes, /0\.1\.0/);
    assert.strictEqual(c.tags['v0.2.0'].length, 40);
    const s = up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env: t.runEnv });
    assert.ok(s.ok, JSON.stringify(s));
    const r = await t.waitDone();
    assert.strictEqual(r.result, 'done', JSON.stringify(r));
    assert.deepStrictEqual(fs.readdirSync(path.join(t.root, 'tmp')), []);
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'VERSION'), 'utf8').trim(), '0.2.0');
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'state.json'), 'utf8'), '{"keep":"old"}');
    assert.strictEqual(up.running(t.inst), null);
    c = await up.check(t.inst, {}, c, '7');
    assert.strictEqual(c.newer, false);
  } finally { t.cleanup(); }
});

test('업데이트: 새 판 시험 실패 → 설치본 그대로(재시작도 안 함)', async () => {
  const t = await setup();
  try {
    const before = t.head();
    t.release('0.2.0', { failTests: true });
    const c = await up.check(t.inst, {}, {}, '7');
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env: t.runEnv });
    const r = await t.waitDone();
    assert.strictEqual(r.result, 'blocked'); assert.strictEqual(r.why, 'tests');
    assert.strictEqual(t.head(), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(t.root, 'tmp')), [], '새 판 시험 임시 폴더가 남음');
    assert.ok(!fs.existsSync(path.join(t.root, 'pm2.log')) || !/stop/.test(fs.readFileSync(path.join(t.root, 'pm2.log'), 'utf8').split('\n').slice(1).join('\n')));
  } finally { t.cleanup(); }
});

test('업데이트: 흔들린 시험은 따로 다시 돌려 받음 · 늘 깨지는 시험은 막고 이름을 남김', async () => {
  const t = await setup();
  try {
    const OK = "require('node:test')('fine', () => {});\n";
    const FLAKY = "const fs = require('fs'), p = require('path').join(process.env.FAKE_ROOT, 'flaky-once');\nrequire('node:test')('once', () => { if (!fs.existsSync(p)) { fs.writeFileSync(p, '1'); throw new Error('race'); } });\n";
    const BAD = "require('node:test')('always', () => { require('assert').strictEqual(1, 2); });\n";
    const env = Object.assign({}, t.runEnv); delete env.UPDATE_TEST_CMD;
    t.release('0.2.0', { tests: { 'a.test.js': OK, 'b.test.js': FLAKY } });
    let c = await up.check(t.inst, {}, {}, '7');
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env });
    let r = await t.waitDone();
    assert.strictEqual(r.result, 'done', JSON.stringify(r));
    assert.match(fs.readFileSync(path.join(t.inst, r.log), 'utf8'), /따로 다시 돌린 시험 통과/);
    const before = t.head();
    t.release('0.3.0', { tests: { 'a.test.js': OK, 'c.test.js': BAD } });
    c = await up.check(t.inst, {}, c, '7');
    fs.rmSync(up.resultFile(t.inst), { force: true });   // 앞 받기 결과를 새 결과로 읽지 않게
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env });
    r = await t.waitDone();
    assert.strictEqual(r.tag, 'v0.3.0', JSON.stringify(r));
    assert.strictEqual(r.result, 'blocked', JSON.stringify(r)); assert.strictEqual(r.why, 'tests');
    assert.strictEqual(t.head(), before);
    assert.deepStrictEqual(r.failed, ['always']); assert.strictEqual(r.fail, 1); assert.ok(r.retried && r.retried.ok === false);
    const lg = fs.readFileSync(path.join(t.inst, r.log), 'utf8');
    assert.match(lg, /깨진 시험 자세히[\s\S]*not ok 1 - always[\s\S]*(expected|Expected)/);
  } finally { t.cleanup(); }
});

test('업데이트: 새 판이 안 뜸 → 이전 판·기록으로 되돌리고 다시 뜸', async () => {
  const t = await setup();
  try {
    const before = t.head();
    t.release('0.2.0', { broken: true });
    const c = await up.check(t.inst, {}, {}, '7');
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env: t.runEnv });
    const r = await t.waitDone();
    assert.strictEqual(r.result, 'rolled-back', JSON.stringify(r)); assert.strictEqual(r.why, 'health');
    assert.strictEqual(t.head(), before);
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'VERSION'), 'utf8').trim(), '0.1.0');
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'state.json'), 'utf8'), '{"keep":"old"}');
    const res = await fetch('http://127.0.0.1:' + t.port + '/'); assert.strictEqual(res.status, 200);
  } finally { t.cleanup(); }
});

test('업데이트: 고친 파일·갈라진 이력·옮겨진 태그·바뀐 주소·PM2 아님 → 받지 않음', async () => {
  const t = await setup();
  try {
    t.release('0.2.0');
    fs.appendFileSync(path.join(t.inst, 'board', 'server.js'), '\n// local edit\n');
    let c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.canApply, false); assert.strictEqual(c.why, 'dirty'); assert.deepStrictEqual(c.dirty, ['board/server.js']);
    sh(t.inst, 'git checkout -q board/server.js');
    c = await up.check(t.inst, {}, {}, null);
    assert.strictEqual(c.why, 'no-pm2');
    c = await up.check(t.inst, {}, { origin: 'https://example.com/other.git' }, '7');
    assert.strictEqual(c.why, 'origin-changed');
    c = await up.check(t.inst, {}, { tags: { 'v0.2.0': '0'.repeat(40) } }, '7');
    assert.strictEqual(c.why, 'tag-moved');
    // 같은 줄을 고친 이 서버 커밋 → 저절로 못 얹음(겹친 파일·커밋 목록) · 임시 작업 폴더가 남지 않음
    fs.writeFileSync(path.join(t.inst, 'board', 'VERSION'), '0.1.0\n');
    fs.writeFileSync(path.join(t.inst, 'CHANGELOG.md'), '# local\n');
    sh(t.inst, 'git -c user.name=t -c user.email=t@t commit -qam local-cl');
    c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.why, 'diverged', JSON.stringify(c)); assert.strictEqual(c.canApply, false);
    assert.deepStrictEqual(c.conflict, ['CHANGELOG.md']); assert.match(c.local[0], /local-cl$/);
    assert.strictEqual(sh(t.inst, 'git worktree list').split('\n').length, 1);
    assert.strictEqual(sh(t.inst, 'git status --porcelain --untracked-files=no'), '');
    sh(t.inst, 'git reset -q --hard origin/main');
    c = await up.check(t.inst, { update: { off: true } }, {}, '7');
    assert.strictEqual(c.on, false);
    assert.strictEqual(up.start(t.inst, { tag: 'main', pm2: t.pm }).ok, false);
  } finally { t.cleanup(); }
});

test('업데이트: 이 서버에만 있는 커밋 → 새 판 위에 다시 얹어 받음 · 원래 이력은 백업 가지 (2026-11-25 0.6.15→0.6.21 갈라짐)', async () => {
  const t = await setup();
  try {
    fs.writeFileSync(path.join(t.inst, 'LOCAL.md'), 'mine\n');
    sh(t.inst, 'git add LOCAL.md && git -c user.name=t -c user.email=t@t commit -qm local-note && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m local-empty');
    const before = t.head();
    t.release('0.2.0');
    const c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.canApply, true, JSON.stringify(c)); assert.strictEqual(c.why, null);
    assert.strictEqual(c.rebase.local.length, 2); assert.strictEqual(c.rebase.kept, 2);
    assert.strictEqual(sh(t.inst, 'git worktree list').split('\n').length, 1);
    assert.strictEqual(t.head(), before, '확인만으로 설치본이 바뀜');
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env: t.runEnv });
    const r = await t.waitDone();
    assert.strictEqual(r.result, 'done', JSON.stringify(r)); assert.ok(r.rebased); assert.match(r.backup, /^board-local-backup-/);
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'VERSION'), 'utf8').trim(), '0.2.0');
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'LOCAL.md'), 'utf8'), 'mine\n');
    sh(t.inst, 'git merge-base --is-ancestor v0.2.0 HEAD');
    assert.strictEqual(sh(t.inst, 'git rev-parse ' + r.backup), before);
    assert.strictEqual(sh(t.inst, 'git for-each-ref refs/board-update'), '');
    assert.deepStrictEqual(fs.readdirSync(path.join(t.root, 'tmp')), []);
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'state.json'), 'utf8'), '{"keep":"old"}');
    // 그다음 판도 같은 식으로
    t.release('0.3.0');
    const c2 = await up.check(t.inst, {}, c, '7');
    assert.strictEqual(c2.canApply, true, JSON.stringify(c2)); assert.strictEqual(c2.rebase.local.length, 2);
  } finally { t.cleanup(); }
});

test('업데이트: 시험하는 사이 이 서버에서 커밋이 생김 → 바꿔 끼우지 않음(그 커밋이 사라지지 않게)', async () => {
  const t = await setup();
  try {
    t.release('0.2.0');
    const c = await up.check(t.inst, {}, {}, '7');
    const env = Object.assign({}, t.runEnv, { UPDATE_TEST_CMD: 'git -C ' + JSON.stringify(t.inst) + ' -c user.name=t -c user.email=t@t commit -q --allow-empty -m mid-test' });
    up.start(t.inst, { tag: c.tag, port: t.port, pm2: t.pm, env });
    const r = await t.waitDone();
    assert.strictEqual(r.result, 'blocked', JSON.stringify(r)); assert.strictEqual(r.why, 'head-moved');
    assert.strictEqual(sh(t.inst, 'git log -1 --format=%s'), 'mid-test');
    assert.strictEqual(fs.readFileSync(path.join(t.inst, 'board', 'VERSION'), 'utf8').trim(), '0.1.0');
    const res = await fetch('http://127.0.0.1:' + t.port + '/'); assert.strictEqual(res.status, 200);
  } finally { t.cleanup(); }
});

test('업데이트: 원본 서버(VERSION 없음)는 꺼짐 · 판 비교', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'board-upd0-'));
  try {
    const c = await up.check(d, {}, {}, '1');
    assert.strictEqual(c.on, false); assert.strictEqual(c.why, 'no-version');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  // 받는 도중 멈춘 것(결과 파일이 «중간» 인데 실행기가 없음) → stalled · 다 끝난 것은 아님
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'board-upd1-'));
  try {
    fs.mkdirSync(path.join(d2, 'board'));
    fs.writeFileSync(path.join(d2, 'board', 'update-result.json'), JSON.stringify({ phase: 'switching', prev: 'a'.repeat(40), tag: 'v0.2.0', pid: 999999999 }));
    assert.strictEqual(up.stalled(d2).prev, 'a'.repeat(40));
    fs.writeFileSync(path.join(d2, 'board', 'update-result.json'), JSON.stringify({ phase: 'end', result: 'done' }));
    assert.strictEqual(up.stalled(d2), null);
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
  assert.ok(up.cmpVer(up.parseVer('v0.10.0'), up.parseVer('0.9.9')) > 0);
  assert.strictEqual(up.parseVer('v1.2'), null);
});

test('업데이트: 상황판이 결과를 재시작 없이 읽음 · 멈춘 받기 칸 · 주인만', async () => {
  const { loadBoard } = require('./sandbox');
  const { board, sb } = loadBoard({ lang: 'ko' });
  try {
    const rf = path.join(sb.dir, 'update-result.json');
    fs.writeFileSync(rf, JSON.stringify({ mode: 'apply', tag: 'v0.2.0', phase: 'end', result: 'rolled-back', why: 'health', from: '0.1.0', to: '0.2.0', at: '2026-11-11T00:00:00.000Z' }));
    board.updateBootResult();
    assert.strictEqual(board.loadState().update.last.result, 'rolled-back');
    assert.strictEqual(board.updateView().last.why, 'health');
    const n0 = board.notifyState().notices.length;
    board.updateBootResult();   // 같은 결과는 한 번만
    assert.strictEqual(board.notifyState().notices.length, n0);
    fs.writeFileSync(rf, JSON.stringify({ mode: 'apply', tag: 'v0.3.0', phase: 'switching', prev: 'b'.repeat(40), pid: 999999999, startedAt: '2026-11-11T01:00:00.000Z' }));
    board.updateBootResult();
    assert.strictEqual(board.updateView().stalled.tag, 'v0.3.0');
    assert.strictEqual(board.loadState().update.last.result, 'stalled');
    for (const u of ['/api/update/apply', '/api/update/revert', '/api/update/check', '/api/update/keep', '/api/update/templates', '/api/update/diverged', '/api/update/testfail']) {
      const d = await board.permit({ role: 'agent', user: 'x', projects: ['*'] }, u, {});
      assert.ok(d && d[0] === 403, u);
      const m = await board.permit({ role: 'member', user: 'm', projects: ['*'] }, u, {});
      assert.ok(m && m[0] === 403, u);
    }
    assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel', fresh: false }, '/api/update/apply'));
    assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel', fresh: false }, '/api/update/revert'));
  } finally { board.server.close(); sb.cleanup(); }
});

test('업데이트: 시험 실패면 깨진 시험 이름을 보이고 서버 방에 까닭 찾기를 맡김(한 번만)', async () => {
  const { loadBoard } = require('./sandbox');
  const { board, sb } = loadBoard({ lang: 'ko', projects: [{ key: 'server', name: 'Server', dir: path.join(os.tmpdir()), stateFile: 'session-state.md' }] });
  try {
    fs.writeFileSync(path.join(sb.dir, 'update-result.json'), JSON.stringify({ mode: 'apply', tag: 'v0.2.0', phase: 'end', result: 'blocked', why: 'tests', from: '0.1.0', to: '0.2.0', pass: 9, fail: 1, failed: ['백업: 도는 중'], log: 'board/log/update/x/run.log', at: '2026-11-26T00:00:00.000Z' }));
    board.updateBootResult();
    const v = board.updateView();
    assert.deepStrictEqual(v.last.tests, { pass: 9, fail: 1, failed: ['백업: 도는 중'], retried: false });
    assert.strictEqual(v.last.testfailQueued, false);
    await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
    const port = board.server.address().port;
    const call = () => new Promise((ok, no) => {
      const r = require('http').request({ host: '127.0.0.1', port, path: '/api/update/testfail', method: 'POST', agent: false, headers: { 'x-test-sock': 'terminal', host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok([res.statusCode, d])); });
      r.on('error', no); r.end('{}');
    });
    const [c1, b1] = await call();
    assert.strictEqual(c1, 200, b1);
    const q = board.loadState().queue.filter((x) => x.ref === 'testfail:v0.2.0');
    assert.strictEqual(q.length, 1); assert.strictEqual(q[0].project, 'server');
    assert.match(q[0].task, /백업: 도는 중/); assert.match(q[0].task, /run\.log/); assert.match(q[0].task, /test-concurrency=1/);
    assert.strictEqual(board.updateView().last.testfailQueued, true);
    assert.strictEqual((await call())[0], 409, '두 번 안 넣음');
  } finally { board.server.close(); sb.cleanup(); }
});

test('업데이트: 확인 실패(연결 못 함)를 «최신» 이라 하지 않음 · 실패면 1시간 뒤 다시 · 6시간마다', async () => {
  // 설치본처럼 VERSION 있고 origin 이 닿지 않는 곳 → why fetch
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'board-upd2-'));
  try {
    fs.mkdirSync(path.join(d, 'board')); fs.writeFileSync(path.join(d, 'board', 'VERSION'), '0.5.0\n');
    sh(d, 'git init -q && git remote add origin ' + path.join(d, 'no-such-repo'));
    const c = await up.check(d, {}, {}, '1');
    assert.strictEqual(c.on, true); assert.strictEqual(c.why, 'fetch'); assert.strictEqual(c.newer, false);
    sh(d, 'git remote remove origin');
    const c2 = await up.check(d, {}, {}, '1');
    assert.strictEqual(c2.on, false); assert.strictEqual(c2.why, 'no-origin');
    const { loadBoard } = require('./sandbox');
    const { board, sb } = loadBoard({ lang: 'ko' });
    try {
      assert.ok(!/최신/.test(board.updateCheckMessage(c)), board.updateCheckMessage(c));
      assert.ok(/연결 안 됨/.test(board.updateCheckMessage(c)));
      assert.ok(/origin/.test(board.updateCheckMessage(c2)) && !/꺼져/.test(board.updateCheckMessage(c2)));
      assert.ok(/최신/.test(board.updateCheckMessage({ on: true, newer: false, current: '0.6.0', why: null })));
      // 화면 자료에 실패 까닭이 실림
      const st = board.loadState(); st.update = { check: Object.assign({}, c, { checkedAt: new Date(Date.now() - 2 * 3600e3).toISOString() }) }; board.saveState(st);
      assert.strictEqual(board.updateView().why, 'fetch');
      // 실패 2시간 전 → 다시 확인함(시험 상자는 VERSION 이 없어 no-version 으로 바뀜)
      await board.updateTick();
      assert.strictEqual(board.loadState().update.check.why, 'no-version');
      // 성공 2시간 전 → 다시 안 함 · 7시간 전 → 다시 함
      const st2 = board.loadState(); st2.update.check = { on: true, why: null, current: '0.6.0', checkedAt: new Date(Date.now() - 2 * 3600e3).toISOString() }; board.saveState(st2);
      await board.updateTick();
      assert.strictEqual(board.loadState().update.check.why, null);
      const st3 = board.loadState(); st3.update.check.checkedAt = new Date(Date.now() - 7 * 3600e3).toISOString(); board.saveState(st3);
      await board.updateTick();
      assert.strictEqual(board.loadState().update.check.why, 'no-version');
    } finally { board.server.close(); sb.cleanup(); }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('업데이트: 서버 창에서 손으로 받은 뒤 옛 확인·«…로 업데이트했어요» 를 보이지 않음 · 바로 다시 확인 (2026-11-25 다른 서버 0.6.15→0.6.22)', async () => {
  const { loadBoard } = require('./sandbox');
  const { board, sb } = loadBoard({ lang: 'ko' });
  try {
    const vf = path.join(sb.dir, 'VERSION');
    fs.writeFileSync(vf, '0.6.15\n');
    const rf = path.join(sb.dir, 'update-result.json');
    fs.writeFileSync(rf, JSON.stringify({ mode: 'apply', tag: 'v0.6.15', phase: 'end', result: 'done', from: '0.6.14', to: '0.6.15', at: new Date().toISOString() }));
    board.updateBootResult();
    const st = board.loadState(); st.update.check = { on: true, why: 'diverged', current: '0.6.15', latest: '0.6.21', tag: 'v0.6.21', newer: true, canApply: false, checkedAt: new Date(Date.now() - 600e3).toISOString() }; board.saveState(st);
    // 받은 판 그대로면 «0.6.15 로 업데이트했어요» 와 새 판 칸 그대로
    let v = board.updateView();
    assert.strictEqual(v.last.to, '0.6.15'); assert.strictEqual(v.newer, true); assert.strictEqual(v.stale, false);
    // 손으로 0.6.22 를 받음 → 옛 결과·옛 확인은 안 보임, 지금 판은 실제 판
    fs.writeFileSync(vf, '0.6.22\n');
    v = board.updateView();
    assert.strictEqual(v.last, null); assert.strictEqual(v.current, '0.6.22');
    assert.strictEqual(v.newer, false); assert.strictEqual(v.canApply, false); assert.strictEqual(v.stale, true);
    // 6시간 안이라도 바로 다시 확인(시험 상자는 git 이 없어 연결 실패 까닭으로 바뀜 — «옛 판 기준» 만 아니면 됨)
    await board.updateTick();
    const c = board.loadState().update.check;
    assert.strictEqual(c.current, '0.6.22'); assert.notStrictEqual(c.why, 'diverged');
    // 실패 결과(되돌림)는 지금 판이 그 판 이상이면 풀린 것 → 안 보임 · 아래면 그대로
    fs.writeFileSync(rf, JSON.stringify({ mode: 'apply', tag: 'v0.6.21', phase: 'end', result: 'blocked', why: 'diverged', from: '0.6.15', to: '0.6.21', at: new Date(Date.now() + 1000).toISOString() }));
    board.updateBootResult();
    assert.strictEqual(board.updateView().last, null);
    fs.writeFileSync(vf, '0.6.15\n');
    assert.strictEqual(board.updateView().last.result, 'blocked');
  } finally { board.server.close(); sb.cleanup(); }
});
