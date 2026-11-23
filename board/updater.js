'use strict';
/**
 * 상황판 «한 번에 업데이트» — 설치한 서버가 공개 저장소의 새 판(태그 vX.Y.Z)을 알림 + 버튼 한 번으로 받는다.
 *
 * 이 파일은 상황판 안에서 «확인»만 한다(git fetch · 읽기). 실제 받기·재시작·되돌리기는 따로 도는 update-runner.js —
 * 상황판이 자기 자신을 재시작해야 하기 때문.
 * 받는 쪽 정보는 어디에도 보내지 않는다(원격 확인 = git fetch 뿐).
 */
const fs = require('fs');
const path = require('path');
const acct = require('./account');
const execFile = (file, args, opts, cb) => acct.execFile('self', file, args, opts, cb);
const spawn = (file, args, opts) => acct.spawn('self', file, args, opts);

const VER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const parseVer = (s) => { const m = String(s || '').trim().match(VER_RE); return m ? [+m[1], +m[2], +m[3]] : null; };
const cmpVer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const fmtVer = (v) => v.join('.');

function git(dir, args, timeout = 20000) {
  return new Promise((resolve) => execFile('git', ['-C', dir].concat(args), { timeout, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }) },
    (e, o, se) => resolve({ ok: !e, out: String(o || '').trim(), err: e ? String(se || e.message).trim().slice(-400) : null })));
}

/** 이 설치본의 판 — board/VERSION (없으면 null) */
function currentVersion(dir) {
  try { return parseVer(fs.readFileSync(path.join(dir, 'board', 'VERSION'), 'utf8')); } catch (_) { return null; }
}

/** 켜져 있나 — { on, why } · 원본 서버(만드는 곳)는 config.update.off 로 끈다 */
async function enabled(dir, config) {
  const u = (config && config.update) || {};
  if (u.off === true) return { on: false, why: 'off' };
  if (!currentVersion(dir)) return { on: false, why: 'no-version' };
  const r = await git(dir, ['remote', 'get-url', 'origin']);
  if (!r.ok || !r.out) return { on: false, why: 'no-origin' };
  return { on: true, origin: r.out };
}

/** 추적 파일 중 고친 것 — 있으면 받지 않는다(덮어쓰지 않게). 설정·기록 파일은 .gitignore 라 여기 안 잡힘 */
async function dirtyFiles(dir) {
  const r = await git(dir, ['status', '--porcelain', '--untracked-files=no']);
  if (!r.ok) return null;
  return r.out ? r.out.split('\n').map((l) => l.replace(/^\s*\S+\s+/, '')).slice(0, 20) : [];
}

/** 원격 태그 중 가장 높은 vX.Y.Z — 로컬 태그가 아니라 원격 목록 기준(원격에서 지운 판은 사라짐 · Fable ⑥) → { tag, v, commit } */
async function latestRemote(dir) {
  const r = await git(dir, ['ls-remote', '--tags', '--refs', 'origin', 'v*'], 60000);
  if (!r.ok) return { err: r.err };
  let best = null;
  for (const line of r.out.split('\n')) {
    const m = line.match(/^([0-9a-f]{40})\s+refs\/tags\/(v\d+\.\d+\.\d+)$/); if (!m) continue;
    const v = parseVer(m[2]); if (v && (!best || cmpVer(v, best.v) > 0)) best = { tag: m[2], v, obj: m[1] };
  }
  return { best };
}

/** CHANGELOG.md 에서 지금 판보다 높은 절만 (## [x.y.z] 머리) — 최대 4000자 · 화면에는 글자로만(Fable ⑧) */
function notesBetween(changelog, cur) {
  const out = []; let take = false;
  for (const line of String(changelog || '').split('\n')) {
    const m = line.match(/^##\s*\[?v?(\d+\.\d+\.\d+)\]?/);
    if (m) { const v = parseVer(m[1]); take = !!(v && cmpVer(v, cur) > 0); }
    if (take) out.push(line);
  }
  return out.join('\n').trim().slice(0, 4000);
}

/** PM2 로 돌고 있나 — 재시작을 이름이 아니라 내 pm_id 로 (Fable ②) → { id, bin } | null */
function pm2Info(pmId) {
  if (pmId === undefined || pmId === null || !/^\d+$/.test(String(pmId))) return null;
  const dirs = String(process.env.PATH || '').split(':').concat([path.dirname(process.execPath)]);
  for (const d of dirs) { const f = path.join(d, 'pm2'); try { fs.accessSync(f, fs.constants.X_OK); return { id: String(pmId), bin: f }; } catch (_) {} }
  return null;
}
/** 그 pm_id 가 정말 이 설치본의 server.js 인가 (pm2 jlist) */
function pm2Owns(pm, dir) {
  return new Promise((resolve) => execFile(pm.bin, ['jlist'], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (e, o) => {
    if (e) return resolve(false);
    try {
      const a = JSON.parse(String(o).slice(String(o).indexOf('[')));
      const me = a.find((x) => String(x.pm_id) === pm.id);
      resolve(!!me && path.resolve(me.pm2_env.pm_exec_path || '') === path.join(dir, 'board', 'server.js'));
    } catch (_) { resolve(false); }
  }));
}

/**
 * 확인 — { on, current, latest, tag, commit, notes, newer, canApply, why, dirty, templates, origin, checkedAt }
 *   why: off · no-version · no-origin · fetch · origin-changed · tag-moved · tag-version · no-pm2 · dirty · diverged · git · null
 *   seen: 지난 확인 결과(state.update) — 처음 본 origin·태그 커밋을 고정해 바뀌면 거부(Fable ⑥)
 */
async function check(dir, config, seen, pmId) {
  seen = seen || {};
  const at = new Date().toISOString();
  const en = await enabled(dir, config);
  const cur = currentVersion(dir);
  const base = { on: en.on, current: cur ? fmtVer(cur) : null, checkedAt: at, origin: en.origin || seen.origin || null, tags: Object.assign({}, seen.tags || {}) };
  if (!en.on) return Object.assign(base, { why: en.why, newer: false, canApply: false });
  if (seen.origin && seen.origin !== en.origin) return Object.assign(base, { origin: seen.origin, why: 'origin-changed', now: en.origin, newer: false, canApply: false });
  const lr = await latestRemote(dir);
  if (lr.err) return Object.assign(base, { why: 'fetch', err: lr.err, newer: false, canApply: false });
  const best = lr.best;
  if (!best || cmpVer(best.v, cur) <= 0) return Object.assign(base, { latest: best ? fmtVer(best.v) : base.current, newer: false, canApply: false, why: null });
  const res = Object.assign(base, { latest: fmtVer(best.v), tag: best.tag, newer: true });
  if (base.tags[best.tag] && base.tags[best.tag] !== best.obj) return Object.assign(res, { canApply: false, why: 'tag-moved' });
  base.tags[best.tag] = best.obj;
  // 그 태그만 받는다 — «+» 없이: 이미 있는 같은 이름 태그가 다른 커밋이면 git 이 거부
  const f = await git(dir, ['fetch', '--no-tags', '--quiet', 'origin', 'refs/tags/' + best.tag + ':refs/tags/' + best.tag], 120000);
  if (!f.ok) return Object.assign(res, { canApply: false, why: /rejected|would clobber/.test(f.err || '') ? 'tag-moved' : 'fetch', err: f.err });
  const tc = await git(dir, ['rev-parse', best.tag + '^{commit}']);
  res.commit = tc.ok ? tc.out : null;
  const tv = await git(dir, ['show', best.tag + ':board/VERSION']);   // 태그 안 VERSION 이 태그와 같아야
  if (!tv.ok || !parseVer(tv.out) || cmpVer(parseVer(tv.out), best.v) !== 0) return Object.assign(res, { canApply: false, why: 'tag-version' });
  const cl = await git(dir, ['show', best.tag + ':CHANGELOG.md']);
  res.notes = cl.ok ? notesBetween(cl.out, cur) : '';
  const pm = pm2Info(pmId);
  if (!pm || !(await pm2Owns(pm, dir))) return Object.assign(res, { canApply: false, why: 'no-pm2' });
  const dirty = await dirtyFiles(dir);
  if (dirty === null) return Object.assign(res, { canApply: false, why: 'git' });
  if (dirty.length) return Object.assign(res, { canApply: false, why: 'dirty', dirty });
  const anc = await git(dir, ['merge-base', '--is-ancestor', 'HEAD', best.tag]);
  if (!anc.ok) return Object.assign(res, { canApply: false, why: 'diverged' });
  const tp = await git(dir, ['diff', '--name-only', 'HEAD', best.tag, '--', 'kit/templates', 'kit/commands']);
  res.templates = tp.ok && tp.out ? tp.out.split('\n').slice(0, 30) : [];
  return Object.assign(res, { canApply: true, why: null });
}

/** 지금 받는 중인가 — board/update.lock 의 pid 가 살아 있으면 */
const lockFile = (dir) => path.join(dir, 'board', 'update.lock');
const resultFile = (dir) => path.join(dir, 'board', 'update-result.json');
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function procStart(pid) { try { const t = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19] || null; } catch (_) { return null; } }
function running(dir) {
  try { const lk = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')); return lk && lk.pid && pidAlive(lk.pid) && (!lk.procStart || procStart(lk.pid) === lk.procStart) ? lk : null; } catch (_) { return null; }
}
function readResult(dir) { try { return JSON.parse(fs.readFileSync(resultFile(dir), 'utf8')); } catch (_) { return null; } }

/** 결과 파일이 «끝나지 않음» 인데 실행기가 죽었나 — 받는 도중 멈춘 것(Fable ④) */
function stalled(dir) {
  const r = readResult(dir);
  return r && r.phase && !r.result && !running(dir) ? r : null;
}

/**
 * 받기 시작 — update-runner.js 를 상황판과 떨어진 프로세스로 띄운다.
 *   중간 셸이 runner 를 «&» 로 띄우고 바로 끝남 → runner 부모 = init(ppid 1) → PM2 가 dev-board 를 재시작하며 자식 나무를 죽여도(treekill) 살아남음(Fable ①)
 * opts: { tag, port, pm2: { id, bin }, mode: 'apply'|'revert', prev, env } → { ok, err }
 */
function start(dir, opts) {
  if (running(dir)) return { ok: false, err: 'running' };
  const mode = opts.mode === 'revert' ? 'revert' : 'apply';
  if (mode === 'apply' && !/^v\d+\.\d+\.\d+$/.test(String(opts.tag || ''))) return { ok: false, err: 'tag' };
  if (mode === 'revert' && !/^[0-9a-f]{40}$/.test(String(opts.prev || ''))) return { ok: false, err: 'prev' };
  if (!opts.pm2 || !opts.pm2.bin) return { ok: false, err: 'no-pm2' };
  const logDir = path.join(dir, 'board', 'log', 'update'); fs.mkdirSync(logDir, { recursive: true });
  // 지금 디스크의 runner 는 받는 도중 새 판으로 바뀐다 → 임시 사본으로 돌린다
  const tmp = path.join(logDir, 'runner-' + Date.now() + '.js');
  fs.copyFileSync(path.join(__dirname, 'update-runner.js'), tmp);
  const args = [tmp, '--dir', dir, '--mode', mode, '--port', String(opts.port || 8800), '--pm2id', String(opts.pm2.id), '--pm2bin', opts.pm2.bin]
    .concat(mode === 'apply' ? ['--tag', opts.tag] : ['--prev', opts.prev]);
  const q = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
  const line = 'nohup ' + [process.execPath].concat(args).map(q).join(' ') + ' >>' + q(path.join(logDir, 'runner.out')) + ' 2>&1 </dev/null &';
  const env = Object.assign({}, process.env, opts.env || {});
  for (const k of Object.keys(env)) if (k !== 'PM2_HOME' && /^(pm_|PM2_|NODE_APP_INSTANCE|NODE_CHANNEL)/.test(k)) delete env[k];   // PM2 자식 표시를 뗌
  const ch = spawn('/bin/sh', ['-c', line], { cwd: dir, detached: true, stdio: 'ignore', env });
  ch.unref();
  return { ok: true };
}

module.exports = { parseVer, cmpVer, fmtVer, currentVersion, enabled, check, notesBetween, pm2Info, pm2Owns, running, readResult, stalled, start, lockFile, resultFile };
