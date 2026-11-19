'use strict';
/**
 * 상황판 배포 실행기 — 정해진 시각·주인 버튼에 «등록·승인된 배포 명령» 을 상황판이 직접 실행한다.
 *
 * 지키는 선 (Fable 1절):
 *  - 시작 = 주인이 정한 일정 또는 주인이 누른 버튼. AI 방은 «막기»(hold)만 할 수 있고 실행·재시도·승인은 못 한다(server.js permit — AGENT_POST 에 없음).
 *  - 명령 = projects.json «deploy.command» 그대로 + 주인이 화면에서 승인한 지문(state.deployApproved)과 같을 때만. 바뀌면 다시 승인 전엔 안 돈다.
 *  - 인자는 허용 목록만(--auto · --routine). --skip-* · --force · --no-* 같은 우회는 설정에 넣어도 거부.
 *  - 배포 스크립트가 마지막 성공 뒤 바뀌었으면 정기 점검은 돌리지 않는다(버튼으로만) · 첫 실행도 버튼으로만.
 *  - 자동 다시 시도는 server.js deployAutoTick 만 — 주인이 버튼을 누른 묶음 안(6시간 · 최대 2번)에서, 운영을 안 건드린 실패(배포 전 검사·일시적)를
 *    고치는 방이 ✅ 로 고친 뒤에만. 이 실행기 자체는 다시 시도하지 않는다.
 *    실패·«모름» 뒤에는 주인이 확인할 때까지 정기 점검 배포도 선다.
 *  - 검증·백업·원복은 솔루션 배포 스크립트 안 그대로 — 이 실행기는 누르고·지켜보고·기록할 뿐.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ALLOWED_ARGS = ['--auto', '--routine'];
const DRY_ARGS = ['--dry-run'];
const WIP_RE = /^wip: ?auto-?save/i;
const DEFAULT_MEM_MB = 3584;
const DEFAULT_TIMEOUT_MIN = 75;
const MEM_WAIT_MS = 20 * 60 * 1000;   // 부르는 쪽(server.js)이 이만큼 기다리다 포기

let D = null;   // server.js 가 넘기는 것: { home, loadState, saveState, writeLog, memAvailableMb, readProdMarker, K, onDone }
function init(deps) { D = deps; }

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const git = (dir, args) => new Promise((res) => execFile('git', ['-C', dir].concat(args), { timeout: 15000 }, (e, o) => res(e ? null : String(o).trim())));
const lockPath = () => path.join(D.home, 'dev-server', 'board', 'deploy.lock');
const logDir = () => path.join(D.home, 'dev-server', 'board', 'log', 'deploy');
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** /proc/<pid>/stat 22번째 칸(부팅 뒤 시작 시각) — pid 가 다른 프로세스에 다시 쓰였는지 가린다 (Fable 완료 검증 ②) */
function procStart(pid) { try { const t = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19] || null; } catch (_) { return null; } }
const lockAlive = (lk) => !!(lk && lk.pid && pidAlive(lk.pid) && (!lk.procStart || procStart(lk.pid) === lk.procStart));

/** projects.json «deploy» → 실행 설정 (없으면 null) */
function conf(proj) {
  const d = proj && proj.deploy;
  if (!d || !d.command) return null;
  const parts = String(d.command).trim().split(/\s+/);
  const script = path.resolve(proj.dir, parts[0]);
  const args = parts.slice(1);
  const dry = d.dryRun ? String(d.dryRun).trim().split(/\s+/) : null;
  const scripts = Array.from(new Set([script].concat((proj.deployScripts || []).concat(d.extraScripts || []).map((x) => path.resolve(proj.dir, x)))));   // extraScripts = 지문에만(프로세스 감지엔 안 씀 — 개발 중 실행을 배포로 잘못 잡지 않게)
  return { key: proj.key, dir: proj.dir, script, args, dry, scripts, prep: !!d.prep,
    minMemMb: Number(d.minMemMb) || DEFAULT_MEM_MB, timeoutMin: Number(d.timeoutMin) || DEFAULT_TIMEOUT_MIN,
    marker: proj.prodMarker || null, command: String(d.command).trim(),
    hash: sha([proj.dir, script, args.join(' '), dry ? dry.join(' ') : ''].join('\n')) };
}
/** 설정 자체의 문제 — 문자열 배열(없으면 빈 배열) */
function confProblems(c) {
  const out = [];
  const bad = c.args.filter((a) => !ALLOWED_ARGS.includes(a));
  if (bad.length) out.push(D.K('허용 안 된 인자: ', 'Argument not allowed: ') + bad.join(' ') + D.K(' (허용: ', ' (allowed: ') + ALLOWED_ARGS.join(' ') + ')');
  if (c.dry && (c.dry.some((a) => !DRY_ARGS.includes(a) && !ALLOWED_ARGS.includes(a)) || !c.dry.includes('--dry-run'))) out.push(D.K('시험 배포 인자는 --dry-run 이 있어야 하고 허용 인자만', 'Dry-run arguments must include --dry-run and only allowed ones'));
  const rel = path.relative(c.dir, c.script);
  if (rel.startsWith('..') || path.isAbsolute(rel)) out.push(D.K('배포 스크립트가 솔루션 폴더 밖에 있음', 'Deploy script is outside the project folder'));
  else try {
    const real = fs.realpathSync(c.script), rr = path.relative(fs.realpathSync(c.dir), real);
    if (rr.startsWith('..') || path.isAbsolute(rr)) out.push(D.K('배포 스크립트가 링크로 솔루션 폴더 밖을 가리킴', 'Deploy script links outside the project folder'));
    else if (!fs.statSync(real).isFile()) out.push(D.K('배포 스크립트가 일반 파일이 아님', 'Deploy script is not a regular file'));
  } catch (_) {}
  try { fs.accessSync(c.script, fs.constants.X_OK); } catch (_) { out.push(D.K('배포 스크립트가 없거나 실행 권한 없음: ', 'Deploy script missing or not executable: ') + c.script); }
  return out;
}
/** 배포 스크립트 파일들의 내용 지문 — 마지막 성공 때와 같아야 정기 점검이 돌린다 */
function scriptsHash(c) {
  return sha(c.scripts.map((f) => { try { return f + '\n' + fs.readFileSync(f, 'utf8'); } catch (_) { return f + '\n<missing>'; } }).join('\n\0'));
}
function readLock() {
  try { return JSON.parse(fs.readFileSync(lockPath(), 'utf8')); } catch (_) { return null; }
}
/** 지금 도는 실행(이 상황판이 띄운 것 · 재시작 전 것은 lock 의 pid 로) */
const running = new Map();   // key → { runId, child, startedAt }

/**
 * 조건 검사 — [{ code, ok, text }] 를 돌려준다(모두 ok 면 실행 가능).
 * ctx: { via: 'button'|'schedule'|'dry', behind, fableWait, unchecked, stashLeft, prepOk, ack }
 */
async function check(proj, ctx) {
  const st = D.loadState(), c = conf(proj), out = [];
  const add = (code, ok, text) => out.push({ code, ok: !!ok, text });
  if (!c) { add('conf', false, D.K('배포 명령이 등록되지 않음 (projects.json «deploy.command») — 이 솔루션은 상황판이 배포하지 않음', 'No deploy command registered (projects.json «deploy.command») — the board does not deploy this project')); return out; }
  const cp = confProblems(c);
  add('conf', !cp.length, cp.length ? cp.join(' · ') : D.K('배포 명령: ', 'Deploy command: ') + c.command);
  const ap = (st.deployApproved || {})[proj.key];
  add('approved', ap && ap.hash === c.hash, ap && ap.hash === c.hash ? D.K('주인 승인: ', 'Approved by ') + ap.by + ' ' + String(ap.at).slice(0, 16).replace('T', ' ')
    : ap ? D.K('승인한 뒤 배포 명령이 바뀜 — 화면에서 다시 승인해야 돎', 'The deploy command changed after approval — approve again on the board') : D.K('주인이 화면에서 이 배포 명령을 아직 승인 안 함', 'The owner has not approved this deploy command on the board yet'));
  // 배포 스크립트가 HEAD 에 커밋돼 있고 작업 폴더와 같음
  const rels = c.scripts.map((f) => path.relative(c.dir, f));
  const dirty = await git(c.dir, ['status', '--porcelain', '--'].concat(rels));
  add('scripts-committed', dirty === '', dirty === '' ? D.K('배포 스크립트 커밋됨', 'Deploy scripts committed') : D.K('배포 스크립트에 커밋 안 된 변경: ', 'Deploy scripts have uncommitted changes: ') + String(dirty || '?').split('\n').map((x) => x.trim()).join(', ') +
    D.K(' — 작업방이 이 파일을 고치다 멈춘 것. 그 일을 끝내 커밋하거나 되돌려야 풀림(다시 눌러도 같음)', ' — a session stopped mid-edit on this file. It unblocks once that work is committed or reverted (pressing again does not help)'));
  const subj = await git(c.dir, ['log', '-1', '--format=%s']);
  add('head-not-wip', subj !== null && !WIP_RE.test(subj), subj === null ? D.K('git 을 읽지 못함', 'Could not read git') : WIP_RE.test(subj) ? D.K('마지막 커밋이 자동 저장(wip) 커밋', 'HEAD is an auto-save (wip) commit') : D.K('마지막 커밋: ', 'HEAD: ') + subj.slice(0, 80));
  if (ctx.behind === 0) add('new-commits', false, D.K('운영 배포 뒤 새 커밋 없음 — 나갈 것 없음', 'No new commits since the production deploy — nothing to ship'));
  else add('new-commits', true, ctx.behind == null ? D.K('운영 표식 모름 — 새 커밋 수 확인 못 함', 'Production marker unknown — commit count not checked') : D.K('나갈 커밋 ', 'Commits to ship: ') + ctx.behind);
  add('fable', !(ctx.fableWait > 0), ctx.fableWait > 0 ? D.K('Fable 대기 ', 'Fable wait: ') + ctx.fableWait + D.K('건', '') + (ctx.fableTitles && ctx.fableTitles.length ? ' (' + ctx.fableTitles.map((t) => '«' + t + '»').join(', ') + ')' : '') : D.K('Fable 대기 0', 'Fable wait: 0'));
  const holds = Object.values((st.deployHold || {})[proj.key] || {});
  add('hold', !holds.length, holds.length ? D.K('막음 표식: ', 'Hold: ') + holds.map((h) => '«' + h.reason + '»(' + (h.roomName || h.room || '?') + ')').join(', ') : D.K('막음 표식 없음', 'No hold'));
  add('unchecked', !(ctx.unchecked > 0), ctx.unchecked > 0 ? D.K('«배포 전 확인 완료» 안 된 끝난 일 ', 'Finished work not «Checked»: ') + ctx.unchecked : D.K('확인 안 된 일 없음', 'Nothing unchecked'));
  add('stash', !ctx.stashLeft, ctx.stashLeft ? D.K('상황판이 비켜 둔 진행 중 변경(stash)이 남아 있음', 'A board stash of in-progress work is still there') : D.K('stash 없음', 'No stash'));
  const lk = readLock();
  const stale = !!(lk && !lockAlive(lk) && !running.has(lk.key));
  add(stale ? 'lock-stale' : 'lock', !lk, lk ? D.K('배포 잠금(한 번에 하나만 배포하게 거는 표시) 있음: ', 'Deploy lock held: ') + ((D.projOf && D.projOf(lk.key) || {}).name || lk.key) + ' ' + String(lk.at).slice(0, 16).replace('T', ' ') + D.K(' 실행', ' run') + (lockAlive(lk) ? D.K(' (실행 중 — 끝나면 저절로 풀림)', ' (running — clears when it ends)') : D.K(' (그 실행은 이미 멈춤 — «확인하고 다시 배포» 를 누르면 풀림)', ' (that run is gone — press «Confirm and deploy again» to clear it)')) : D.K('잠금 없음', 'No lock'));
  // 상황판을 거치지 않고 도는 배포(준비 방·터미널에서 직접) — 겹치지 않게 (Fable 완료 검증 ⑤)
  if (ctx.procRunning) add('proc', false, D.K('이 솔루션 배포 스크립트가 이미 돌고 있음(상황판 밖에서 실행)', 'A deploy script for this project is already running (started outside the board)'));
  if (ap && ap.hash === c.hash && D.approvedInLog && !D.approvedInLog(proj.key, c.hash)) add('approved-log', false, D.K('승인 기록(로그)에 이 지문이 없음 — 화면에서 다시 승인하세요', 'No approval of this command in the log — approve again on the board'));
  // 준비 방(버튼·정기 점검 공통)이 ✅ 로 끝나지 않았으면 막음 (Fable 완료 검증 ③)
  if (ctx.via !== 'schedule' && ctx.prepOk === false) add('prep', false, D.K('배포 준비 방이 ✅ 로 끝나지 않음', 'The deploy prep session did not end with ✅'));
  const last = (st.deployRuns || {})[proj.key];
  const ps = (st.prodSeen || {})[proj.key];
  const lastBad = last && !last.dry && (last.result === 'fail' || last.result === 'unknown') && !last.ackAt && !(ps && ps.at && last.end && Date.parse(ps.at) > Date.parse(last.end));
  if (ctx.via === 'schedule') {
    add('last-run', !lastBad, lastBad ? D.K('지난 배포가 «' + (last.result === 'fail' ? '실패' : '모름') + '» — 주인이 확인할 때까지 정기 배포는 섬', 'The last deploy was «' + last.result + '» — scheduled deploys wait until the owner confirms') : D.K('지난 배포 문제 없음', 'Last deploy fine'));
    const okHash = (st.deployScriptHash || {})[proj.key];
    add('scripts-same', !!okHash && okHash === scriptsHash(c), !okHash ? D.K('상황판 실행기로 끝까지 나간 배포가 아직 없음 — 첫 배포는 버튼으로', 'No successful board-run deploy yet — the first one must be from the button')
      : okHash === scriptsHash(c) ? D.K('배포 스크립트가 지난 성공 때와 같음', 'Deploy scripts unchanged since the last success') : D.K('배포 스크립트가 지난 성공 뒤 바뀜 — 이번엔 버튼으로만', 'Deploy scripts changed since the last success — button only this time'));
    add('prep', ctx.prepOk !== false, ctx.prepOk === false ? D.K('점검 방 보고가 ✅ 가 아님(개발완료·배포 준비)', 'The check session did not report ✅ (dev-done / deploy prep)') : D.K('점검 방 ✅', 'Check session ✅'));
  } else if (lastBad && ctx.via !== 'dry') add('last-run', !!ctx.ack, ctx.ack ? D.K('지난 배포 «' + last.result + '» — 주인이 버튼으로 확인함', 'Last deploy «' + last.result + '» — owner confirmed by pressing') : D.K('지난 배포가 «' + last.result + '» — 확인하고 누르세요', 'The last deploy was «' + last.result + '» — confirm before pressing'));
  return out;
}

/** 실행 — 조건은 부르는 쪽이 check() 로 먼저 본다. 돌려주기 { ok, runId, err } · 끝나면 D.onDone(key, run) */
async function start(proj, opts) {
  const c = conf(proj);
  if (!c) return { ok: false, err: 'no-conf' };
  const dry = !!opts.dry;
  if (dry && !c.dry) return { ok: false, err: D.K('이 솔루션 배포 스크립트는 시험 배포(--dry-run)를 지원하지 않음', 'This deploy script has no dry-run') };
  // 메모리 — 여기서 기다리지 않는다(틱을 붙잡지 않게). 모자라면 memWait 를 돌려주고 부르는 쪽이 다음 틱에 다시 본다(그동안 deployMemTick 이 비켜 줌)
  if (!dry && (D.memAvailableMb() || 0) < c.minMemMb) return { ok: false, memWait: true, need: c.minMemMb, avail: D.memAvailableMb() || 0, err: D.K('남은 메모리 ' + D.memAvailableMb() + 'MB < ' + c.minMemMb + 'MB', 'Free memory ' + D.memAvailableMb() + 'MB < ' + c.minMemMb + 'MB') };
  // 자리 잡기 — 기다림 없이 그 자리에서(같은 순간 두 번 불러도 한 번만) (Fable 완료 검증 ①)
  if (running.has(proj.key)) return { ok: false, err: D.K('배포 잠금 있음', 'Deploy lock held') };
  const runId = 'dep' + Date.now().toString(36);
  running.set(proj.key, { runId, starting: true });
  if (!dry) {
    try { const lfd = fs.openSync(lockPath(), 'wx'); fs.writeSync(lfd, JSON.stringify({ key: proj.key, runId, pid: null, at: new Date().toISOString(), starting: true })); fs.closeSync(lfd); }
    catch (e) { running.delete(proj.key); return { ok: false, err: D.K('배포 잠금 있음', 'Deploy lock held') }; }
  }
  const release = () => { running.delete(proj.key); if (!dry) { try { const lk = readLock(); if (lk && lk.runId === runId) fs.unlinkSync(lockPath()); } catch (_) {} } };
  fs.mkdirSync(logDir(), { recursive: true });
  const logFile = path.join(logDir(), proj.key + '-' + new Date().toISOString().replace(/[:.]/g, '-') + (dry ? '-dry' : '') + '.log');
  const fd = fs.openSync(logFile, 'a');
  const commit = await git(c.dir, ['rev-parse', 'HEAD']);
  const before = c.marker && !dry ? await D.readProdMarker(c.marker) : null;
  const args = dry ? c.dry : c.args;
  // 환경 정리 — 상황판 프로세스의 것 중 실행에 필요한 것만 (설정·비밀은 솔루션 스크립트가 스스로 읽음)
  const env = {};
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'SSH_AUTH_SOCK']) if (process.env[k]) env[k] = process.env[k];
  env.TERM = 'dumb'; env.DEPLOY_BY = 'dev-board'; env.DEPLOY_VIA = opts.via;
  fs.writeSync(fd, `# dev-board deploy runner · ${new Date().toISOString()} · ${proj.key} · via=${opts.via} · by=${opts.by} · ${dry ? 'DRY-RUN · ' : ''}${c.script} ${args.join(' ')} · HEAD ${commit}\n`);
  let child;
  const exitFile = logFile.replace(/\.log$/, '') + '.exit';
  //   sh 는 스크립트의 종료 코드를 그대로 돌려준다(exit $rc — 지켜보는 finish() 도 같은 값) · 파일 경로는 인자로(스크립트 환경에 안 샘) · tmp→mv 로 반쯤 쓴 파일 없음 (Fable 설계 판정 ①)
  try { child = spawn('/bin/sh', ['-c', 'f=$1; shift; "$0" "$@"; rc=$?; echo "$rc" > "$f.tmp" && mv "$f.tmp" "$f"; exit $rc', c.script, exitFile].concat(args), { cwd: c.dir, env, detached: true, stdio: ['ignore', fd, fd] }); }
  catch (e) { fs.closeSync(fd); release(); return { ok: false, err: String(e.message || e) }; }
  if (!child.pid) { fs.closeSync(fd); release(); return { ok: false, err: D.K('배포 스크립트를 띄우지 못함', 'Could not start the deploy script') }; }
  fs.closeSync(fd);
  const run = { runId, key: proj.key, at: new Date().toISOString(), via: opts.via, by: opts.by, dry, command: c.script + ' ' + args.join(' '), commit, pid: child.pid,
    markerBefore: before && before.at ? before.at : null, log: logFile, exitFile, scriptsHash: scriptsHash(c), result: 'running' };
  if (!dry) fs.writeFileSync(lockPath(), JSON.stringify({ key: proj.key, runId, pid: child.pid, procStart: procStart(child.pid), at: run.at, log: logFile, exitFile }));
  saveRun(proj.key, run);
  D.writeLog({ action: 'deploy-run-start', project: proj.key, runId, via: opts.via, by: opts.by, dry, pid: child.pid, commit: commit && commit.slice(0, 9) });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }, 30000);
  }, c.timeoutMin * 60000);
  running.set(proj.key, { runId, child, startedAt: Date.now() });   // 자리 잡기 표시를 실제 실행으로
  child.on('exit', (code, sig) => { clearTimeout(timer); finish(proj, c, run, timedOut ? null : code, sig, timedOut).catch((e) => D.writeLog({ action: 'deploy-run-finish-error', err: String(e.message || e) })); });
  child.on('error', (e) => D.writeLog({ action: 'deploy-run-spawn-error', project: proj.key, err: String(e.message || e) }));
  return { ok: true, runId, log: logFile };
}
function tailOf(file, n) {
  try { const s = fs.readFileSync(file, 'utf8'); return s.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((x) => x.trim()).slice(-n).join('\n'); } catch (_) { return ''; }
}
/** 실패 원인을 기록에서 읽어 한 줄로 — 맨 위 카드·버튼·고치는 방이 같은 말을 쓰게
 *  retry = 고치지 않고 다시 눌러도 될 만한 것 */
function failCause(text, opts) {
  opts = opts || {};
  const t = String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
  const K = (D && D.K) || ((a) => a);
  const lines = t.split('\n');
  if (opts.timedOut) return { kind: 'timeout', retry: false, title: K('시간을 넘겨 멈춤', 'Stopped after the time limit'), items: [],
    hint: K('운영이 반쯤 바뀌었을 수 있어요 — 고치는 방이 읽기로 운영 상태를 확인해요', 'Production may be half-changed — the fix session checks it read-only') };
  const items = [], names = [];
  const bi = lines.findIndex((l) => /깨진 항목|Failed items|FAILED:/i.test(l));
  if (bi >= 0) {
    for (let i = bi + 1; i < lines.length && items.length < 6; i++) {
      const m = lines[i].match(/^\s*\d+\.\s+(.+)$/);
      if (m) { const nx = (lines[i + 1] || '').trim(); names.push(m[1].trim().slice(0, 120)); items.push((m[1].trim() + (nx && !/^\d+\./.test(nx) ? ' — ' + nx : '')).slice(0, 300)); }
    }
  }
  const errLine = (lines.find((l) => /\[ERROR\]|^ERROR|✗ .*실패|FATAL/i.test(l)) || '').replace(/^\s*\[ERROR\]\s*/, '').trim().slice(0, 200);
  const mem = /heap out of memory|ENOMEM|Cannot allocate memory|^Killed\b|메모리 (부족|모자)/im.test(t);
  const gate = items.length || (!mem && /게이트|\bgate\b|health-check|검사.*실패/i.test(errLine));
  if (gate) {
    const flaky = items.length && items.every((x) => /\b429\b|Too many requests|ECONNRESET|ETIMEDOUT|socket hang up/i.test(x));
    const what = !errLine ? K('배포 전 검사', 'pre-deploy check') : /health-check/.test(errLine) ? K('배포 전 검사(health-check)', 'Pre-deploy check (health-check)') : errLine.replace(/\s*[—-]\s*배포 중단.*$/, '').replace(/\s*자세히:.*$/, '');
    return { kind: flaky ? 'flaky' : 'gate', retry: !!flaky, items,
      title: (what + (items.length ? K(' — ' + items.length + '건 걸림: ', ' — ' + items.length + ' failed: ') + names[0] : '')).slice(0, 160),
      hint: flaky ? K('요청 횟수 제한(429) 같은 일시적 실패예요 — 몇 분 뒤 다시 누르면 대개 통과해요', 'A temporary failure (rate limit 429 etc.) — pressing again in a few minutes usually passes')
        : K('운영은 그대로예요. 개발서버의 코드·데이터를 고쳐야 통과해요 — 고치기 전에 다시 누르면 같은 검사에 또 걸려요', 'Production is unchanged. The dev code/data must be fixed first — pressing again before that fails the same check') };
  }
  if (mem) return { kind: 'memory', retry: true, items: [], title: K('메모리 부족', 'Out of memory'),
    hint: K('다른 무거운 일(빌드·시험)이 끝난 뒤 다시 누르면 돼요', 'Press again after other heavy work (builds, tests) finishes') };
  if (/ssh: connect|Connection (timed out|refused|reset)|Could not resolve|Permission denied \(publickey|운영서버 SSH.*(실패|FAIL)/i.test(t)) return { kind: 'network', retry: true, items: [], title: K('운영서버 접속 실패', 'Could not reach production'),
    hint: K('몇 분 뒤 다시 누르세요 — 계속되면 운영서버 상태를 봐야 해요', 'Press again in a few minutes — if it keeps failing, production needs a look') };
  const last = errLine || (lines.filter((l) => l.trim() && !/^[\s=*\-─━_#~.]+$/.test(l)).slice(-1)[0] || '').trim().slice(0, 200);   // «=====» 같은 장식줄은 원인이 아님
  return { kind: 'other', retry: false, items: [], title: last || K('원인 줄을 못 찾음', 'No error line found'), hint: K('고치는 방이 기록 전체를 읽고 원인을 찾아요', 'The fix session reads the whole log to find the cause') };
}
async function finish(proj, c, run, code, sig, timedOut) {
  // running 은 결과를 다 적은 뒤에 지운다 — 표식 확인(최대 2분) 사이에 recover() 가 «모름» 으로 마감하지 않게
  run.end = new Date().toISOString(); run.code = code; run.signal = sig || null;
  if (run.dry) run.result = code === 0 ? 'dry-ok' : 'dry-fail';
  else if (timedOut) run.result = 'unknown';
  else if (code !== 0) run.result = 'fail';
  else {
    // 종료 코드 0 만으로는 안 믿는다 — 운영 공개 표식이 바뀌어야 성공 (Fable 3절)
    let after = null;
    for (let i = 0; i < 6 && c.marker; i++) { after = await D.readProdMarker(c.marker); if (after.at && after.at !== run.markerBefore) break; await new Promise((r) => setTimeout(r, D.markerWaitMs || 20000)); }   // 공개 표식이 캐시로 늦게 바뀔 수 있어 2분까지
    run.markerAfter = after && after.at ? after.at : null;
    // 배포 전 표식을 읽었고 · 배포 뒤 표식이 그와 다르고 · 이번 실행 시작(1분 여유) 뒤 시각이어야 ok (Fable 완료 검증 ④)
    const fresh = run.markerAfter && Date.parse(run.markerAfter) >= Date.parse(run.at) - 60000;
    run.result = !c.marker ? 'ok' : run.markerBefore && run.markerAfter && run.markerAfter !== run.markerBefore && fresh ? 'ok' : 'unknown';
    if (run.result === 'unknown') run.why = !run.markerBefore ? D.K('배포 전 운영 표식을 못 읽어 바뀐 것을 확인 못 함', 'could not read the production marker before deploying, so the change is unconfirmed')
      : D.K('종료 코드 0 인데 운영 표식이 이번 배포 시각으로 안 바뀜', 'exit 0 but the production marker did not move to this deploy');
  }
  if (timedOut) run.why = D.K(c.timeoutMin + '분 넘어 멈춤 — 운영이 반쯤 바뀌었을 수 있음', 'stopped after ' + c.timeoutMin + ' min — production may be half-changed');
  run.tail = tailOf(run.log, 25);
  if (run.result === 'fail' || run.result === 'unknown' || run.result === 'dry-fail') run.cause = failCause(tailOf(run.log, 80), { timedOut });
  const st = D.loadState();
  if (run.result === 'ok') {
    st.deployScriptHash = st.deployScriptHash || {}; st.deployScriptHash[proj.key] = scriptsHash(c);
    st.deployDoneAt = st.deployDoneAt || {}; st.deployDoneAt[proj.key] = run.at;
  }
  D.saveState(st);
  // 잠금은 끝까지 나간 것(성공·실패·시험)만 푼다 — «모름» 은 주인이 확인할 때까지 그대로 (Fable 3절)
  if (!run.dry && run.result !== 'unknown') { try { const lk = readLock(); if (lk && lk.runId === run.runId) fs.unlinkSync(lockPath()); } catch (_) {} }
  saveRun(proj.key, run);
  running.delete(proj.key);
  D.writeLog({ action: 'deploy-run-end', project: proj.key, runId: run.runId, result: run.result, code, signal: sig || null, markerBefore: run.markerBefore, markerAfter: run.markerAfter || null });
  if (D.onDone) D.onDone(proj, run);
}
function saveRun(key, run) {
  const st = D.loadState();
  st.deployRuns = st.deployRuns || {};
  if (run.dry) { st.deployDry = st.deployDry || {}; st.deployDry[key] = run; }
  else st.deployRuns[key] = run;
  st.deployRunLog = [{ key, runId: run.runId, at: run.at, end: run.end || null, via: run.via, dry: run.dry, result: run.result }].concat((st.deployRunLog || []).filter((x) => x.runId !== run.runId)).slice(0, 50);
  D.saveState(st);
}
/** 상황판 재시작 뒤 — 잠금이 남았는데 이 프로세스가 띄운 게 아니면: 살아 있으면 지켜보기만, 끝났으면 종료 코드 파일로 finish() 와 같은 판정(다시 실행하지 않음)
 *  종료 코드 파일이 없으면(옛 실행·시간 넘김 kill) «모름» 그대로 */
function recover() {
  const lk = readLock();
  if (!lk || running.has(lk.key)) return;
  const st = D.loadState(); const r = ((st.deployRuns || {})[lk.key]) || {};
  if (r.runId === lk.runId && r.result !== 'running') return;
  if (lockAlive(lk)) return;   // 아직 돎 — 끝 코드를 못 받으니 끝나면 다음 틱에 아래로 (틱마다 부름 · Fable 완료 검증 ②)
  if (lk.starting && Date.now() - Date.parse(lk.at || 0) < 120000) return;   // 다른 프로세스가 막 자리 잡는 중
  const proj = D.projOf ? D.projOf(lk.key) : null, c = proj ? conf(proj) : null;
  let code = null;
  try { const t = fs.readFileSync(lk.exitFile || r.exitFile || '', 'utf8').trim(); if (/^\d+$/.test(t)) code = Number(t); } catch (_) {}
  if (code !== null && c && r.runId === lk.runId) {
    const run = Object.assign({}, r, { log: r.log || lk.log, recovered: true });
    running.set(lk.key, { runId: lk.runId, recovering: true });   // 표식 확인(최대 2분) 사이 다음 틱이 또 부르지 않게 — finish() 가 지움
    D.writeLog({ action: 'deploy-run-recovered', project: lk.key, runId: lk.runId, code });
    finish(proj, c, run, code, null, false).catch((e) => { running.delete(lk.key); D.writeLog({ action: 'deploy-run-finish-error', err: String(e.message || e) }); });
    return;
  }
  const run = Object.assign({}, r, { runId: lk.runId, key: lk.key, result: 'unknown', end: new Date().toISOString(), via: r.via || '?', command: r.command || '?', at: r.at || lk.at,
    why: D.K('상황판이 지켜보지 못한 사이 끝남(재시작 등) — 결과 모름', 'ended while the board was not watching (restart etc.) — result unknown'), tail: tailOf(lk.log, 25), log: lk.log });
  run.cause = failCause(tailOf(lk.log, 80), {});
  saveRun(lk.key, run);
  D.writeLog({ action: 'deploy-run-recovered-unknown', project: lk.key, runId: lk.runId });
  if (D.onDone && proj) D.onDone(proj, run);
}
/** 주인 확인 — 실패·모름을 봤다고 표시하고(정기 배포 다시 허용) 남은 잠금을 푼다 */
function ack(key, by) {
  const st = D.loadState(); const r = (st.deployRuns || {})[key];
  if (r && (r.result === 'fail' || r.result === 'unknown')) { r.ackAt = new Date().toISOString(); r.ackBy = by; }
  D.saveState(st);
  const lk = readLock();
  let freed = null;
  if (lk && !lockAlive(lk) && !running.has(lk.key)) { try { fs.unlinkSync(lockPath()); freed = lk; } catch (_) {} }
  D.writeLog({ action: 'deploy-run-ack', project: key, by, freedLock: freed ? { key: freed.key, runId: freed.runId, at: freed.at } : null });
}
function approve(proj, by) {
  const c = conf(proj); if (!c) return null;
  const st = D.loadState(); st.deployApproved = st.deployApproved || {};
  st.deployApproved[proj.key] = { hash: c.hash, command: c.command, dry: c.dry ? c.dry.join(' ') : null, by, at: new Date().toISOString() };
  D.saveState(st);
  D.writeLog({ action: 'deploy-approve', project: proj.key, by, command: c.command, hash: c.hash });
  return st.deployApproved[proj.key];
}
/** AI 방이 남기는 «배포 막음» — 막기만(풀기는 주인 또는 같은 방) */
function hold(key, h) {
  const st = D.loadState(); st.deployHold = st.deployHold || {}; st.deployHold[key] = st.deployHold[key] || {};
  const hid = h.room ? 'r' + h.room : 'h' + Date.now().toString(36);
  st.deployHold[key][hid] = Object.assign({ hid, at: new Date().toISOString() }, h);
  D.saveState(st);
  D.writeLog({ action: 'deploy-hold', project: key, hid, room: h.room || null, reason: h.reason });
  return hid;
}
function unhold(key, hid, by) {
  const st = D.loadState(); const m = (st.deployHold || {})[key] || {};
  const gone = hid ? [hid] : Object.keys(m);
  for (const k of gone) delete m[k];
  D.saveState(st);
  D.writeLog({ action: 'deploy-unhold', project: key, hids: gone, by });
  return gone.length;
}
/** 카드 표시용 */
function summary(proj) {
  const c = conf(proj); if (!c) return null;
  const st = D.loadState(), ap = (st.deployApproved || {})[proj.key];
  const lk = readLock();
  return { command: c.command, dry: !!c.dry, prep: c.prep, approved: !!(ap && ap.hash === c.hash), approvedBy: ap ? ap.by : null, approvedChanged: !!(ap && ap.hash !== c.hash),
    problems: confProblems(c), running: running.has(proj.key) || !!(lk && lk.key === proj.key),
    last: (st.deployRuns || {})[proj.key] || null, lastDry: (st.deployDry || {})[proj.key] || null,
    holds: Object.values((st.deployHold || {})[proj.key] || {}), scheduledReady: !!((st.deployScriptHash || {})[proj.key]) };
}
module.exports = { MEM_WAIT_MS, init, conf, confProblems, check, start, recover, ack, approve, hold, unhold, summary, scriptsHash, readLock, failCause, tailOf, ALLOWED_ARGS, _running: running };
