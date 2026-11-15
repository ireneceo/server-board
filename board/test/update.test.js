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

const sh = (cwd, line) => execFileSync('/bin/sh', ['-c', line], { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).trim();
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// 가짜 상황판 — /api/ping·/ 에 200 (BROKEN 파일이 있는 판은 바로 죽음)
const GOOD_SERVER = `const fs=require('fs'),path=require('path');if(fs.existsSync(path.join(__dirname,'BROKEN')))process.exit(1);
require('http').createServer((q,s)=>{s.writeHead(200);s.end(fs.readFileSync(path.join(__dirname,'VERSION'),'utf8'))}).listen(+process.env.PORT,'127.0.0.1');`;
// 가짜 pm2 — stop/restart/jlist 만 · pid 는 <root>/pm2.pid
const FAKE_PM2 = `#!/bin/sh
R="$FAKE_ROOT"; cmd="$1"
stop() { [ -f "$R/pm2.pid" ] && kill "$(cat "$R/pm2.pid")" 2>/dev/null; rm -f "$R/pm2.pid"; sleep 0.2; }
case "$cmd" in
  stop) stop; echo "$*" >> "$R/pm2.log";;
  restart) stop; cd "$FAKE_DIR/board" && PORT="$FAKE_PORT" nohup node server.js >/dev/null 2>&1 & echo $! > "$R/pm2.pid"; echo "$*" >> "$R/pm2.log";;
  jlist) P=$(cat "$R/pm2.pid" 2>/dev/null || echo 0); N=$(cat "$R/pm2.log" 2>/dev/null | wc -l); echo '[{"pm_id":7,"pid":'"$P"',"pm2_env":{"status":"online","restart_time":'"$N"',"pm_exec_path":"'"$FAKE_DIR"'/board/server.js"}}]';;
esac
`;

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
    const cl = fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8').replace('# Changelog\n\n', '# Changelog\n\n## [' + ver + '] — ' + (opts.notes || 'new') + '\n- b\n\n');
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), cl);
    sh(work, 'git add -A && git commit -qm ' + ver + ' && git tag -a v' + ver + ' -m v' + ver + ' && git push -q ' + JSON.stringify(bare) + ' main v' + ver);
  };
  const pm = { id: '7', bin: path.join(bin, 'pm2') };
  const runEnv = { UPDATE_TESTING: '1', UPDATE_TEST_CMD: 'test ! -f "{dir}/FAIL_TESTS"', UPDATE_HEALTH_MS: '8000', UPDATE_STABLE_MS: '1500', UPDATE_MIN_MEM_MB: '1' };
  const waitDone = async () => { for (let i = 0; i < 150; i++) { const r = up.readResult(inst); if (r && r.result && !up.running(inst)) return r; await new Promise((x) => setTimeout(x, 200)); } throw new Error('runner timeout'); };
  const head = () => sh(inst, 'git rev-parse HEAD');
  const cleanup = () => { try { sh(root, '[ -f pm2.pid ] && kill $(cat pm2.pid) 2>/dev/null; true'); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); };
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
    assert.ok(!fs.existsSync(path.join(t.root, 'pm2.log')) || !/stop/.test(fs.readFileSync(path.join(t.root, 'pm2.log'), 'utf8').split('\n').slice(1).join('\n')));
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
    sh(t.inst, 'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m local');
    c = await up.check(t.inst, {}, {}, '7');
    assert.strictEqual(c.why, 'diverged');
    c = await up.check(t.inst, { update: { off: true } }, {}, '7');
    assert.strictEqual(c.on, false);
    assert.strictEqual(up.start(t.inst, { tag: 'main', pm2: t.pm }).ok, false);
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
    for (const u of ['/api/update/apply', '/api/update/revert', '/api/update/check', '/api/update/keep', '/api/update/templates']) {
      const d = await board.permit({ role: 'agent', user: 'x', projects: ['*'] }, u, {});
      assert.ok(d && d[0] === 403, u);
      const m = await board.permit({ role: 'member', user: 'm', projects: ['*'] }, u, {});
      assert.ok(m && m[0] === 403, u);
    }
    assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel', fresh: false }, '/api/update/apply'));
    assert.ok(board.needsFresh({ role: 'owner', via: 'tunnel', fresh: false }, '/api/update/revert'));
  } finally { board.server.close(); sb.cleanup(); }
});
