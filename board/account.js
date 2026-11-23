'use strict';
/**
 *
 * 상황판이 바깥 프로그램을 띄우는 길은 전부 여기 하나를 지난다(child_process 를 직접 부르는 파일은 이것뿐 — test/account.test.js 가 검사).
 *   verb(무슨 일) → 실행 계정(runAs 표). 그 계정이 상황판을 돌리는 계정과 같으면 그냥 실행(지금까지와 똑같음).
 *   다르면 `sudo -n -u <계정> /usr/local/lib/server-board/run-as <verb> [--cwd D] [--env K=V]… -- <프로그램> <인자…>`
 *   run-as(root 소유)가 verb 마다 정해진 프로그램만 허락한다 — kit/account-split/run-as.
 *
 * 계정 셋(지금 서버에서는 전부 owner — 통로 대상 = 자기 자신):
 *   ME            상황판을 돌리는 계정(나중에 board)
 *   OWNER_ACCOUNT 사람 주인의 서버 계정 = 최종 컨펌자 · AI 작업방이 도는 계정 (config.ownerAccount · 없으면 ME)
 *   runAs[verb]   그 일을 하는 계정 (config.runAs.{verb|default} · 없으면 OWNER_ACCOUNT) — 2단계에서 claude→ai, deploy→deploy 로 값만 바꿈
 *
 * 경로 둘(지금은 os.homedir() 하나가 둘 다 맡았음):
 *   BOARD_DIR  상황판 실행 사본(projects.json·services.json·docs·install-info) — SB_BOARD_DIR · config.boardDir · 기본 ~/dev-server
 *   WORK_HOME  일하는 사람의 집(~/.claude·jobs·longkey·.claude.json·.ssh) — SB_WORK_HOME · config.workHome · 기본: 주인 계정이 나면 os.homedir(), 다르면 그 계정의 집
 *   WORK_DIR   일하는 계정이 돌리는 스크립트 자리(morning-check.sh·kit/verify.sh·bin/) — SB_WORK_DIR · config.workDir · 기본 WORK_HOME/dev-server
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
/** 일 이름 — run-as 가 아는 것과 같아야 한다. self = 늘 상황판 계정 자신(상황판 시험·ss·자기 갱신) */
const VERBS = ['claude', 'git', 'deploy', 'backup', 'pm2', 'crontab', 'tailscale', 'ssh', 'check', 'peer'];
const RUN_AS_BIN_DEFAULT = '/usr/local/lib/server-board/run-as';
const SUDO = '/usr/bin/sudo';
/** 통로 너머로 넘겨도 되는 환경 값 — 비밀(열쇠·토큰)은 넘기지 않는다(명령 줄은 ps 로 보임). AI 열쇠는 run-as 가 그 계정 파일에서 스스로 읽음 */
const PASS_ENV_RE = /^(PATH|LANG|LC_ALL|TZ|TERM|BROWSER|GIT_[A-Z_]+|SSH_ASKPASS|DEPLOY_BY|DEPLOY_VIA|ONLY|GAP|STEPS|AT|GUARD|RUNNER|RUNNER_CMD|NODE_ENV)$/;
const SECRET_ENV_RE = /TOKEN|SECRET|PASSW|KEY|COOKIE|SESS/i;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) || {}; } catch (_) { return {}; }
}
function passwdOf(name) {
  try {
    for (const l of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const f = l.split(':');
      if (f[0] === name && f.length > 5) return { name, uid: Number(f[2]), home: f[5] };
    }
  } catch (_) { /* /etc/passwd 없음 */ }
  return null;
}

/** 표를 만든다 — 시험이 다른 설정·계정으로 부를 수 있게 순수 함수로 */
function build(cfg, env, me) {
  cfg = cfg || {}; env = env || {};
  const ME = me || os.userInfo().username;
  const ownerAccount = NAME_RE.test(String(cfg.ownerAccount || '')) ? String(cfg.ownerAccount) : ME;
  const ra = cfg.runAs && typeof cfg.runAs === 'object' ? cfg.runAs : {};
  const pick = (v) => (NAME_RE.test(String(v || '')) ? String(v) : null);
  const runAs = {};
  for (const v of VERBS) runAs[v] = pick(ra[v]) || pick(ra.default) || ownerAccount;
  runAs.self = ME;
  const ownerPw = ownerAccount === ME ? null : passwdOf(ownerAccount);
  const WORK_HOME = env.SB_WORK_HOME || cfg.workHome || (ownerPw ? ownerPw.home : os.homedir());
  const BOARD_DIR = env.SB_BOARD_DIR || cfg.boardDir || path.join(os.homedir(), 'dev-server');
  const WORK_DIR = env.SB_WORK_DIR || cfg.workDir || path.join(WORK_HOME, 'dev-server');
  return {
    ME, OWNER_ACCOUNT: ownerAccount, SPLIT: ownerAccount !== ME, runAs,
    BOARD_DIR, WORK_HOME, WORK_DIR,
    RUN_AS_BIN: env.SB_RUN_AS_BIN || RUN_AS_BIN_DEFAULT,
  };
}

const T = build(readConfig(), process.env);

function accountOf(verb) {
  if (verb === 'self') return T.ME;
  if (!VERBS.includes(verb)) throw new Error('account: unknown verb ' + verb);
  return T.runAs[verb];
}

/**
 * 실행 계획 — { file, args, opts, as } · 같은 계정이면 받은 그대로(지금과 같음).
 * 다른 계정이면 sudo → run-as. cwd·환경은 run-as 에 인자로(sudo 가 환경을 지우므로), sudo 자신은 / 에서 빈 환경으로.
 */
function plan(verb, file, args, opts, table) {
  const t = table || T;
  args = Array.isArray(args) ? args : [];
  opts = Object.assign({}, opts || {});
  const who = verb === 'self' ? t.ME : (VERBS.includes(verb) ? t.runAs[verb] : null);
  if (!who) throw new Error('account: unknown verb ' + verb);
  if (who === t.ME) return { file, args, opts, as: who, via: false };
  const pre = ['-n', '-u', who, t.RUN_AS_BIN, verb];
  if (opts.cwd) pre.push('--cwd', String(opts.cwd));
  const env = opts.env || null;
  if (env) {
    for (const k of Object.keys(env).sort()) {
      const v = env[k];
      if (v === undefined || v === null || !PASS_ENV_RE.test(k) || SECRET_ENV_RE.test(k)) continue;
      if (/[\n\0]/.test(String(v))) continue;
      pre.push('--env', k + '=' + String(v));
    }
  }
  pre.push('--', String(file));
  const out = Object.assign({}, opts, { cwd: '/', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: (env && env.LANG) || process.env.LANG || 'C.UTF-8' } });
  return { file: SUDO, args: pre.concat(args.map(String)), opts: out, as: who, via: true };
}

/** 한 통로 — child_process 와 같은 모양에 맨 앞 verb 하나만 더 */
function execFile(verb, file, args, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  const p = plan(verb, file, args, opts);
  return cp.execFile(p.file, p.args, p.opts, cb);
}
function execFileSync(verb, file, args, opts) {
  const p = plan(verb, file, args, opts);
  return cp.execFileSync(p.file, p.args, p.opts);
}
function spawn(verb, file, args, opts) {
  const p = plan(verb, file, args, opts);
  return cp.spawn(p.file, p.args, p.opts);
}

module.exports = Object.assign({}, T, { VERBS, build, plan, accountOf, execFile, execFileSync, spawn, passwdOf, PASS_ENV_RE });
