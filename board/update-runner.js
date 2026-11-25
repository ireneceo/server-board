#!/usr/bin/env node
'use strict';
/**
 *
 *  apply  1 잠금 · 배포 중이면 안 함 → 2 다시 확인(고친 파일 0 · 메모리 · 앞으로만 못 가면 이 서버 커밋을 새 판 위에 다시 얹음)
 *         → 3 새 판 코드를 임시 폴더에 꺼내 자동 시험(설치본은 아직 그대로 — 실패면 아무것도 안 바뀜)
 *         → 4 결과 파일에 phase=switching·prev 먼저(중간에 죽으면 상황판이 켜질 때 알아챔)
 *         → 5 pm2 stop → 설정·기록 사본(멈춘 뒤라 최신) → git merge --ff-only (이 서버에만 있는 커밋이 있으면: 임시 폴더에서 새 판 위에 다시 얹은 커밋으로 reset --keep · 원래 이력은 board-local-backup-* 가지) → pm2 restart → 뜨는지(/api/ping·/ 가 20초 계속 대답)
 *         → 6 안 뜨면: stop → 새 판이 쓴 기록은 state.after.json 으로 남김 → (고친 파일 0 일 때만) reset --hard prev → 기록 되돌림 → restart
 *  revert 받는 도중 멈춘 판을 주인 버튼으로 prev 로 되돌림 — 코드만(그사이 쌓인 기록은 지금 것 유지 · Fable 완료 검증 ②)
 * 결과: board/update-result.json { phase, result: done|rolled-back|blocked|broken, … } · 과정: board/log/update/<시각>/run.log
 * 시험용(UPDATE_TESTING=1 일 때만 먹음): UPDATE_TEST_CMD(시험 명령 · {dir} = 꺼낸 폴더) · UPDATE_HEALTH_MS · UPDATE_STABLE_MS · UPDATE_MIN_MEM_MB
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, spawn } = require('child_process');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('dir'), MODE = arg('mode', 'apply'), TAG = arg('tag'), PREV_ARG = arg('prev'), PORT = +arg('port', 8800);
const PM2ID = arg('pm2id'), PM2BIN = arg('pm2bin', 'pm2');
const TESTING = process.env.UPDATE_TESTING === '1';
const TV = (k) => (TESTING ? process.env[k] : undefined);
const HEALTH_MS = +(TV('UPDATE_HEALTH_MS') || 90000), STABLE_MS = +(TV('UPDATE_STABLE_MS') || 20000);
const MIN_MEM_MB = +(TV('UPDATE_MIN_MEM_MB') || 400);
const TEST_CMD = TV('UPDATE_TEST_CMD');
let stopped = false;   // pm2 stop 뒤 다시 켜기 전 — 예외가 나도 꺼진 채 끝나지 않게(Fable 완료 검증 ③)
if (!DIR || !/^\d+$/.test(String(PM2ID)) || (MODE === 'apply' ? !/^v\d+\.\d+\.\d+$/.test(String(TAG)) : !/^[0-9a-f]{40}$/.test(String(PREV_ARG)))) {
  console.error('usage: update-runner --dir <dir> --pm2id N --pm2bin <pm2> (--mode apply --tag vX.Y.Z | --mode revert --prev <sha>)'); process.exit(2);
}

const B = path.join(DIR, 'board');
const RUN_DIR = path.join(B, 'log', 'update', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(RUN_DIR, { recursive: true });
const LOG = path.join(RUN_DIR, 'run.log');
const log = (s) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + s + '\n'); } catch (_) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => execFile(cmd, args, Object.assign({ cwd: DIR, timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, opts),
    (e, o, se) => resolve({ ok: !e, out: String(o || '').trim(), err: e ? (String(se || '').trim() || e.message).slice(-1500) : null })));
}
/** 시험 — 따로 프로세스 묶음으로 돌려 시간이 넘으면 묶음째 끝냄(sh 만 죽고 node --test 가 남지 않게) */
function runGroup(line, timeout, env) {
  return new Promise((resolve) => {
    const ch = spawn('/bin/sh', ['-c', line], { cwd: DIR, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    ch.stdout.on('data', (d) => { out += d; if (out.length > 16e6) out = out.slice(-8e6); });
    ch.stderr.on('data', (d) => { err += d; if (err.length > 1e6) err = err.slice(-5e5); });
    const t = setTimeout(() => { try { process.kill(-ch.pid, 'SIGKILL'); } catch (_) {} }, timeout);
    ch.on('close', (code, sig) => { if (done) return; done = true; clearTimeout(t); resolve({ ok: code === 0, out: out.trim(), err: code === 0 ? null : (err.trim() || 'exit ' + (code === null ? sig : code)).slice(-1500) }); });
  });
}
const git = (...a) => run('git', ['-C', DIR].concat(a), { env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });
const pm2 = async (...a) => { const r = await run(PM2BIN, a, { timeout: 60000 }); if (r.ok && a[0] === 'stop') stopped = true; if (r.ok && a[0] === 'restart') stopped = false; return r; };
/** pm2 jlist 의 내 앱 — { pid, restarts, status } (못 읽으면 null) */
async function pm2State() {
  const r = await run(PM2BIN, ['jlist'], { timeout: 20000 });
  if (!r.ok) return null;
  try { const a = JSON.parse(r.out.slice(r.out.indexOf('['))); const me = a.find((x) => String(x.pm_id) === String(PM2ID)); return me ? { pid: me.pid, restarts: me.pm2_env && me.pm2_env.restart_time, status: me.pm2_env && me.pm2_env.status } : null; } catch (_) { return null; }
}
function procStart(pid) { try { const t = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19] || null; } catch (_) { return null; } }
const LOCK = path.join(B, 'update.lock'), RESULT = path.join(B, 'update-result.json');
const readVer = () => { try { return fs.readFileSync(path.join(B, 'VERSION'), 'utf8').trim(); } catch (_) { return null; } };
const SNAP = [['board', 'state.json'], ['board', 'config.json'], ['projects.json']];
const snapName = (p) => p.join('__');

let rec = { mode: MODE, tag: TAG || null, startedAt: new Date().toISOString(), log: path.relative(DIR, LOG), pid: process.pid };
function writeRec(extra) {
  rec = Object.assign(rec, extra || {});
  try { fs.writeFileSync(RESULT + '.tmp', JSON.stringify(rec, null, 2) + '\n'); fs.renameSync(RESULT + '.tmp', RESULT); } catch (e) { log('결과 파일 실패 ' + e.message); }
}
let TDIR = null;
function finish(result, extra) {
  try { require('child_process').execFileSync('git', ['-C', DIR, 'update-ref', '-d', 'refs/board-update/candidate'], { stdio: 'ignore', timeout: 10000 }); } catch (_) {}   // 다시 얹은 커밋 임시 표지 — 시험 실패·멈춤 실패 때도 남지 않게
  if (TDIR) { try { fs.rmSync(TDIR, { recursive: true, force: true }); } catch (_) {} TDIR = null; }
  writeRec(Object.assign({ result, phase: 'end', at: new Date().toISOString() }, extra || {}));
  log('결과 ' + result + ' ' + JSON.stringify(extra || {}));
  try { const lk = JSON.parse(fs.readFileSync(LOCK, 'utf8')); if (lk.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) {}
  try { if (/runner-\d+\.js$/.test(__filename)) fs.unlinkSync(__filename); } catch (_) {}   // 임시 사본 정리
  process.exit(result === 'done' ? 0 : 1);
}

/** 상황판이 대답하나 — 500 미만이면(로그인 전 401 도) 살아 있음 */
function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 3000, headers: { Host: 'localhost:' + PORT } }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
/** HEALTH_MS 안에 대답하기 시작해 STABLE_MS 동안 계속 대답하면 성공(켜졌다 바로 죽는 판을 걸러냄) */
async function healthy() {
  const until = Date.now() + HEALTH_MS; let upSince = 0, st0 = null;
  const same = (a, b) => !!a && !!b && a.status === 'online' && b.status === 'online' && a.pid === b.pid && a.restarts === b.restarts;
  while (Date.now() < until) {
    if ((await get('/api/ping')) && (await get('/'))) {
      if (!upSince) { upSince = Date.now(); st0 = await pm2State(); }
      else if (Date.now() - upSince >= STABLE_MS) {
        // 안정 구간 앞뒤로 같은 프로세스(pid·재시작 횟수)여야 — 1초 사이에 죽었다 다시 뜬 판을 거름(Fable 완료 검증 ④)
        const st1 = await pm2State();
        if (same(st0, st1)) return true;
        log('안정 구간 사이 재시작됨 ' + JSON.stringify([st0, st1])); upSince = 0;
      }
    } else upSince = 0;
    await sleep(1000);
  }
  return false;
}
/** 이 서버에만 있는 커밋을 새 판 위에 다시 얹기 — 설치본 말고 임시 작업 폴더에서 (updater.js rebasePlan 과 같은 일 · 이 실행기는 임시 사본이라 그 파일을 못 부름)
 *  → { ok, commit, why, conflict, err } */
async function rebaseOnto(tag) {
  const mg = await git('rev-list', '--merges', tag + '..HEAD');
  if (!mg.ok) return { ok: false, why: 'git', err: mg.err };
  if (mg.out) return { ok: false, why: 'diverged-merge' };
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'board-rebase-'));
  const gw = (...a) => run('git', ['-C', wt, '-c', 'user.name=Server Board', '-c', 'user.email=board@localhost', '-c', 'rebase.updateRefs=false', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'].concat(a), { timeout: 120000, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });
  try {
    const add = await git('worktree', 'add', '--detach', '--quiet', wt, 'HEAD');
    if (!add.ok) return { ok: false, why: 'git', err: add.err };
    const rb = await gw('rebase', '--quiet', tag);
    if (!rb.ok) { const u = await gw('diff', '--name-only', '--diff-filter=U'); await gw('rebase', '--abort'); const cf = u.out ? u.out.split('\n').slice(0, 20) : []; return { ok: false, why: cf.length ? 'diverged' : 'git', conflict: cf, err: rb.err }; }
    const nh = await gw('rev-parse', 'HEAD'), v1 = await gw('show', 'HEAD:board/VERSION'), v2 = await git('show', tag + ':board/VERSION');
    if (!nh.ok || !v1.ok || v1.out !== v2.out) return { ok: false, why: 'diverged-version' };
    const keep = await git('update-ref', 'refs/board-update/candidate', nh.out);   // 임시 폴더를 지워도 새 커밋이 정리(gc)되지 않게
    if (!keep.ok) return { ok: false, why: 'git', err: keep.err };
    return { ok: true, commit: nh.out };
  } finally {
    await git('worktree', 'remove', '--force', wt);
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch (_) {}
    await git('worktree', 'prune');
  }
}
function memAvailMb() { try { return Math.round(+fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)[1] / 1024); } catch (_) { return Infinity; } }

/** 되돌리기 — stop → 새 판 기록 남김 → (고친 파일 0 일 때만) reset → 기록 되돌림 → restart → 뜨는지 */
async function rollback(prev, snapDir, why) {
  log('되돌림 시작: ' + why + ' → ' + prev);
  writeRec({ phase: 'rolling-back', why });
  await pm2('stop', PM2ID);
  const st = await git('status', '--porcelain', '--untracked-files=no');
  if (!st.ok || st.out) {   // 그사이 누가 추적 파일을 고침 — 덮지 않고 멈춤(Fable ⑤)
    await pm2('restart', PM2ID, '--update-env');
    return { ok: false, why: 'dirty-during', dirty: st.out ? st.out.split('\n').slice(0, 20) : null };
  }
  const rs = await git('reset', '--hard', '--quiet', prev);
  if (!rs.ok) { await pm2('restart', PM2ID, '--update-env'); return { ok: false, why: 'reset', err: rs.err }; }
  if (snapDir) for (const p of SNAP) {
    const s = path.join(snapDir, snapName(p)), f = path.join(DIR, ...p);
    if (!fs.existsSync(s)) continue;
    try { if (fs.existsSync(f)) fs.copyFileSync(f, path.join(RUN_DIR, snapName(p) + '.after')); fs.copyFileSync(s, f); }   // 새 판이 쓴 기록도 남김
    catch (e) { log('기록 되돌리기 실패 ' + p.join('/') + ' ' + e.message); }   // 기록을 못 되돌려도 상황판은 다시 켠다
  }
  const r2 = await pm2('restart', PM2ID, '--update-env');
  const up = r2.ok && await healthy();
  log('되돌린 뒤 ' + (up ? '뜸' : '안 뜸'));
  return { ok: up, why: up ? null : 'down-after-revert' };
}

(async () => {
  // 1 잠금
  const mine = JSON.stringify({ pid: process.pid, procStart: procStart(process.pid), mode: MODE, tag: TAG, at: new Date().toISOString() });
  try { fs.writeFileSync(LOCK, mine, { flag: 'wx' }); }
  catch (_) {
    let lk = null; try { lk = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (__) {}
    let alive = false; try { process.kill(lk.pid, 0); alive = !lk.procStart || procStart(lk.pid) === lk.procStart; } catch (__) {}
    if (alive) { log('이미 받는 중 pid ' + lk.pid); process.exit(1); }
    fs.writeFileSync(LOCK, mine);
  }
  log('시작 ' + MODE + ' ' + (TAG || PREV_ARG) + ' · 지금 판 ' + readVer());

  if (MODE === 'revert') {
    const last = (() => { try { return JSON.parse(fs.readFileSync(RESULT, 'utf8')); } catch (_) { return {}; } })();
    writeRec({ tag: last.tag || null, prev: PREV_ARG, from: last.from || null, to: last.to || null, snap: last.snap || null });
    const r = await rollback(PREV_ARG, null, 'button');   // 코드만 — 멈춘 뒤 며칠이 지났을 수 있어 기록은 지금 것을 둔다(사본은 snap 폴더에 그대로)
    return finish(r.ok ? 'rolled-back' : 'broken', Object.assign({ why: r.why || 'stalled' }, r.dirty ? { dirty: r.dirty } : {}, r.err ? { err: r.err } : {}));
  }

  try { const dl = JSON.parse(fs.readFileSync(path.join(B, 'deploy.lock'), 'utf8')); let a = false; try { process.kill(dl.pid, 0); a = true; } catch (_) {} if (a) return finish('blocked', { why: 'deploy' }); } catch (_) {}

  // 2 다시 확인
  const st = await git('status', '--porcelain', '--untracked-files=no');
  if (!st.ok) return finish('blocked', { why: 'git', err: st.err });
  if (st.out) return finish('blocked', { why: 'dirty', dirty: st.out.split('\n').slice(0, 20) });
  const head = await git('rev-parse', 'HEAD'), tagc = await git('rev-parse', TAG + '^{commit}');
  if (!head.ok || !tagc.ok) return finish('blocked', { why: 'git', err: head.err || tagc.err });
  if (memAvailMb() < MIN_MEM_MB) return finish('blocked', { why: 'memory', memMb: memAvailMb() });
  const prev = head.out, from = readVer();
  // 앞으로만 갈 수 있으면 태그 그대로 · 이 서버에만 있는 커밋이 있으면 새 판 위에 다시 얹은 커밋으로(원래 이력은 백업 가지)
  let target = TAG, backup = null;
  if (!(await git('merge-base', '--is-ancestor', 'HEAD', TAG)).ok) {
    const rb = await rebaseOnto(TAG);
    if (!rb.ok) return finish('blocked', Object.assign({ why: rb.why }, rb.conflict ? { conflict: rb.conflict } : {}, rb.err ? { err: rb.err } : {}));
    target = rb.commit;
    backup = 'board-local-backup-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    log('이 서버 커밋을 ' + TAG + ' 위에 다시 얹음 → ' + target + ' (원래 이력 → 가지 ' + backup + ')');
  }
  writeRec({ prev, from, to: TAG.slice(1), rebased: !!backup, backup });

  // 3 새 판 코드를 임시 폴더에 꺼내 시험 — 설치본은 그대로
  const tdir = TDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'board-update-'));
  try {
    const ar = await run('/bin/sh', ['-c', 'git -C "$0" archive --format=tar "$1" board | tar -x -C "$2"', DIR, target, tdir], { timeout: 60000 });
    if (!ar.ok) return finish('blocked', { why: 'archive', err: ar.err });
    const tb = path.join(tdir, 'board');
    const cmd = TEST_CMD ? TEST_CMD.split('{dir}').join(tb)
      : 'cd "' + tb + '" && "' + process.execPath + '" --test --test-reporter=tap $(ls test/*.test.js | grep -v "/public.test.js$")';
    const tenv = Object.assign({}, process.env); delete tenv.NODE_TEST_CONTEXT;
    const t = await runGroup(cmd, 300000, tenv);
    const pass = +((t.out.match(/^# pass (\d+)/m) || [])[1] || 0), fail = +((t.out.match(/^# fail (\d+)/m) || [])[1] || 0);
    if (!t.ok || (!TEST_CMD && (!pass || fail))) return finish('blocked', { why: 'tests', pass, fail, err: (t.err || '') + '\n' + t.out.split('\n').filter((l) => /^not ok|^# (pass|fail)/.test(l)).slice(0, 12).join('\n') });
    log('새 판 시험 통과' + (pass ? ' ' + pass + '개' : ''));
  } finally { try { fs.rmSync(tdir, { recursive: true, force: true }); } catch (_) {} TDIR = null; }

  // 4·5 바꿔 끼우기 — 먼저 «중간» 표시
  writeRec({ phase: 'switching', snap: path.relative(DIR, RUN_DIR) });
  const s1 = await pm2('stop', PM2ID);
  if (!s1.ok) { writeRec({ phase: null }); return finish('blocked', { why: 'pm2', err: s1.err }); }
  try { for (const p of SNAP) { const f = path.join(DIR, ...p); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(RUN_DIR, snapName(p))); } }
  catch (e) { await pm2('restart', PM2ID, '--update-env'); return finish('blocked', { why: 'snapshot', err: e.message }); }   // 받기 전이라 다시 켜기만
  const h2 = await git('rev-parse', 'HEAD'), st2 = await git('status', '--porcelain', '--untracked-files=no');
  if (!h2.ok || h2.out !== prev || !st2.ok || st2.out) { await pm2('restart', PM2ID, '--update-env'); return finish('blocked', { why: 'head-moved' }); }
  if (backup) {
    const bk = await git('branch', backup, prev);
    if (!bk.ok) { await pm2('restart', PM2ID, '--update-env'); return finish('blocked', { why: 'merge', err: bk.err }); }
  }
  const mg = backup ? await git('reset', '--keep', '--quiet', target) : await git('merge', '--ff-only', '--quiet', TAG);
  if (backup) await git('update-ref', '-d', 'refs/board-update/candidate');
  if (!mg.ok) {
    await pm2('restart', PM2ID, '--update-env');
    return finish('blocked', { why: 'merge', err: mg.err });
  }
  log('받음 ' + (backup ? target + ' (' + TAG + ' + 이 서버 커밋)' : tagc.out) + ' · 판 ' + readVer());
  const r1 = await pm2('restart', PM2ID, '--update-env');
  log('재시작 ' + (r1.ok ? 'ok' : 'fail ' + r1.err));
  if (r1.ok && await healthy()) return finish('done', {});

  // 6 안 뜸 → 되돌림
  const r = await rollback(prev, RUN_DIR, 'health');
  return finish(r.ok ? 'rolled-back' : 'broken', Object.assign({ why: r.ok ? 'health' : r.why }, r.dirty ? { dirty: r.dirty } : {}, r.err ? { err: r.err } : {}, r1.ok ? {} : { restartErr: r1.err }));
})().catch(async (e) => {
  log('예외 ' + String(e && e.stack || e).slice(0, 800));
  if (stopped) { try { await pm2('restart', PM2ID, '--update-env'); } catch (_) {} }   // 멈춘 채 끝나지 않게
  finish('broken', { why: 'runner', err: String(e && e.stack || e).slice(0, 1500) });
});
