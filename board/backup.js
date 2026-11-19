'use strict';
/**
 *   
 *
 * 지키는 선:
 *  - 다른 서버에 접속하지 않는다. «보냄» = 이 서버 백업 기록의 성공 줄 시각(또는 표시 파일 시각), «받음» = 이 서버에 도착한 파일.
 *  - 복원을 직접 하지 않는다 — 그 솔루션 대기열에 «[상황판 — 복원 요청]» 일만 넣는다(server.js).
 *  - «지금 백업» = projects.json «backup.command» 한 줄을 셸 없이(execFile) · 깨끗한 환경 · nice/ionice 로. 인자 없음.
 *  - 승인 지문 = backup 칸 전체 + 스크립트 내용. 다르면 주인 아닌 사람에게는 현황을 감추고, 버튼은 꺼진다(주인이 창에서 «승인»).
 *  - 현황 읽기는 등록 폴더의 맨 위 항목만(안으로 내려가지 않음 · 2000개 상한 · 비동기). 파일 내용은 안 읽음(기록 끝 64KB 만).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

let D = null;   // { home, loadState, peekState(읽기만 · 고치지 말 것), saveState, writeLog, K, onChange }
function init(deps) { D = deps; }

const MAX_ENTRIES = 2000;
const LOG_TAIL = 64 * 1024;
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
const STATUS_MS = 5 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const expand = (p) => String(p || '').replace(/^~(?=\/|$)/, D.home);
const logDir = () => path.join(D.home, 'dev-server', 'board', 'log', 'backup');

/** 경로 하나 검사 — 절대 경로(또는 ~/) · .. 없음 · 제어문자 없음 */
function pathBad(p) {
  const s = String(p || '');
  if (!s) return D.K('경로가 비었음', 'empty path');
  if (/[\u0000-\u001f\u007f]/.test(s)) return D.K('경로에 이상한 글자', 'bad characters in path');
  if (!(s.startsWith('/') || s.startsWith('~/'))) return D.K('경로는 / 또는 ~/ 로 시작: ', 'path must start with / or ~/: ') + s;
  if (s.split('/').includes('..')) return D.K('경로에 .. 은 못 씀: ', 'no .. in path: ') + s;
  return null;
}

/** projects.json «backup» → 정리된 설정(없으면 null) */
function conf(proj) {
  const b = proj && proj.backup;
  if (!b || typeof b !== 'object') return null;
  const list = (a, k) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x === 'object' && x[k]).map((x) => Object.assign({ label: String(x.label || x[k]).slice(0, 40) }, x));
  const c = {
    key: proj.key, dir: proj.dir,
    command: b.command ? String(b.command).trim() : null,
    log: b.log ? String(b.log).trim() : null,
    every: Math.max(1, Math.min(24 * 31, Number(b.every) || 24)),
    local: list(b.local, 'path').map((x) => ({ label: x.label, path: String(x.path) })),
    sent: list(b.sent, 'ok').concat(list(b.sent, 'stamp').filter((x) => !x.ok)).map((x) => (x.stamp ? { label: x.label, stamp: String(x.stamp) } : { label: x.label, ok: String(x.ok) })),
    received: list(b.received, 'path').map((x) => ({ label: x.label, path: String(x.path) })),
    restore: b.restore ? String(b.restore).trim() : null,
    git: b.git !== false,   // 코드 사본(GitHub 등 원격 저장소) 줄 — 일부러 안 쓰는 서버는 "git": false
  };
  c.script = c.command ? path.resolve(proj.dir, c.command) : null;
  return c;
}

/** 설정 문제 — 문자열 배열 (Fable ③: confProblems 수준 · git 커밋 조건은 없음) */
function problems(c) {
  const out = [];
  if (c.command) {
    if (/\s/.test(c.command) || /[;&|`$<>(){}\\'"*?~]/.test(c.command)) out.push(D.K('지금 백업 명령은 스크립트 경로 하나만(인자·셸 기호 없음)', 'Backup command must be one script path (no arguments or shell symbols)'));
    const rel = path.relative(c.dir, c.script);
    if (rel.startsWith('..') || path.isAbsolute(rel)) out.push(D.K('백업 스크립트가 솔루션 폴더 밖에 있음', 'Backup script is outside the project folder'));
    try {
      if (fs.lstatSync(c.script).isSymbolicLink()) out.push(D.K('백업 스크립트가 링크 파일 — 실제 파일 경로를 넣으세요', 'Backup script is a symlink — use the real file'));
      else if (!fs.statSync(c.script).isFile()) out.push(D.K('백업 스크립트가 일반 파일이 아님', 'Backup script is not a regular file'));
      else fs.accessSync(c.script, fs.constants.X_OK);
    } catch (_) { out.push(D.K('백업 스크립트가 없거나 실행 권한 없음: ', 'Backup script missing or not executable: ') + c.script); }
  }
  for (const p of [c.log].concat(c.local.map((x) => x.path), c.received.map((x) => x.path), c.sent.filter((x) => x.stamp).map((x) => x.stamp))) {
    if (p == null) continue;
    const e = pathBad(p); if (e) out.push(e);
  }
  if (c.restore && (/[\u0000-\u001f]/.test(c.restore) || c.restore.split('/').includes('..'))) out.push(D.K('복원 문서 경로가 이상함', 'Bad restore document path'));
  for (const s of c.sent) if (s.ok != null && (!s.ok.trim() || s.ok.length > 80)) out.push(D.K('«보냄» 글귀는 1~80자', '«sent» phrase must be 1–80 characters'));
  if (c.sent.some((s) => s.ok) && !c.log) out.push(D.K('«보냄» 글귀를 쓰려면 기록 파일이 있어야 함', 'A log file is needed for «sent» phrases'));
  return out;
}

/** 승인 지문 — backup 칸 전체 + 스크립트 내용 (Fable ②) */
const bodyMemo = {};   // 스크립트 내용 지문 — 파일 시각·크기·inode 가 같으면 다시 안 읽음(3초 갱신마다 읽지 않게)
function scriptSha(f) {
  let st; try { st = fs.statSync(f); } catch (_) { return '<missing>'; }
  const k = st.ino + ':' + st.size + ':' + st.mtimeMs + ':' + st.ctimeMs;
  if (bodyMemo[f] && bodyMemo[f].k === k) return bodyMemo[f].h;
  let h; try { h = sha(fs.readFileSync(f, 'utf8')); } catch (_) { h = '<unreadable>'; }
  bodyMemo[f] = { k, h }; return h;
}
function fingerprint(proj) {
  const c = conf(proj); if (!c) return null;
  return sha(JSON.stringify([proj.dir, proj.backup]) + '\n\0' + (c.script ? scriptSha(c.script) : '<none>'));
}
function approvedOf(key) { return ((D.peekState().backupApproved || {})[key]) || null; }
function isApproved(proj) { const a = approvedOf(proj.key); const f = fingerprint(proj); return !!(a && f && a.hash === f); }
const cfgSha = (proj) => sha(JSON.stringify([proj.dir, proj.backup]));
/** 왜 승인이 필요한지 — null(승인됨) · { why:'never' } 한 번도 안 함 · { why:'script', at } 백업 스크립트 내용만 바뀜 · { why:'settings' } 경로·명령이 바뀜
 * */
function approvalWhy(proj) {
  if (!conf(proj) || isApproved(proj)) return null;
  const a = approvedOf(proj.key);
  if (!a) return { why: 'never' };
  const c = conf(proj);
  if (a.cfg && a.cfg === cfgSha(proj) && c.script) { let at = null; try { at = fs.statSync(c.script).mtimeMs; } catch (_) {} return { why: 'script', at, since: a.at }; }
  return { why: 'settings', since: a.at };
}
function approve(proj, by) {
  const st = D.loadState(); st.backupApproved = st.backupApproved || {};
  const hash = fingerprint(proj);
  st.backupApproved[proj.key] = { hash, cfg: cfgSha(proj), by, at: new Date().toISOString() };
  D.saveState(st); D.writeLog({ action: 'backup-approve', project: proj.key, by, hash });
  delete statusCache[proj.key];
  return hash;
}

function nameDate(n) {
  const m = String(n).match(/(20\d\d)[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return Number.isFinite(t) ? t : null;
}
/** 등록 폴더의 맨 위 항목만 — [{ name, dir, t, size }] 새것 먼저 (Fable ⑥: 안으로 안 내려감 · 2000 상한 · 링크는 맨 위 한 번만 풂) */
async function listTop(p, now) {
  const root = expand(p);
  let real; try { real = await fs.promises.realpath(root); } catch (_) { return { ok: false, why: 'missing' }; }
  let st; try { st = await fs.promises.stat(real); } catch (_) { return { ok: false, why: 'missing' }; }
  if (!st.isDirectory()) return { ok: false, why: 'notdir' };
  let ents; try { ents = await fs.promises.readdir(real, { withFileTypes: true }); } catch (_) { return { ok: false, why: 'noread' }; }
  // 다른 서버가 정한 이름이 일 글에 들어가므로 제어문자·200자 넘는 이름은 뺀다 (Fable 완료 검증 ②)
  ents = ents.filter((e) => !e.name.startsWith('.') && !/\.(part|tmp)$/.test(e.name) && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(e.name) && e.name.length <= 200 && (e.isFile() || e.isDirectory()));
  // 너무 많으면 최신을 못 가린다 — 자르지 않고 «확인 못 함» (Fable 다음 판 ②)
  if (ents.length > MAX_ENTRIES) return { ok: false, why: 'toomany' };
  const more = false;
  const items = [];
  for (const e of ents) {
    let s; try { s = await fs.promises.lstat(path.join(real, e.name)); } catch (_) { continue; }
    let t = s.mtimeMs; const nd = nameDate(e.name);
    // 시각을 보존해 옮긴 폴더(rsync -a 의 옛 시각) — 이름 날짜가 더 새로우면 그날 끝(지금 넘지 않게)으로 본다
    if (nd != null && t < nd) t = Math.min(nd + 86400000 - 1, now);
    items.push({ name: e.name, dir: e.isDirectory(), t, size: e.isFile() ? s.size : null });
  }
  items.sort((a, b) => b.t - a.t);
  return { ok: true, real, items, more };
}
/** 기록 끝 64KB — 글귀가 든 마지막 줄의 줄머리 시각 (Fable 2절: 실패 글귀를 찾지 않음 · 시각 없는 기록은 «확인 못 함») */
async function sentAt(logPath, phrase) {
  let fh; try { fh = await fs.promises.open(expand(logPath), 'r'); } catch (_) { return { ok: false, why: 'nolog' }; }
  try {
    const { size } = await fh.stat(); const n = Math.min(size, LOG_TAIL); const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, size - n);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.includes(phrase));
    if (!lines.length) return { ok: false, why: 'nophrase' };
    const m = lines[lines.length - 1].match(/^\[?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (!m) return { ok: false, why: 'notime' };
    const t = new Date(m[1] + 'T' + m[2]).getTime();   // 서버 시간 그대로(스크립트가 date 로 씀)
    return Number.isFinite(t) ? { ok: true, t } : { ok: false, why: 'notime' };
  } finally { await fh.close(); }
}
async function logTail(logPath, nLines) {
  let fh; try { fh = await fs.promises.open(expand(logPath), 'r'); } catch (_) { return null; }
  try { const { size } = await fh.stat(); const n = Math.min(size, 16384); const buf = Buffer.alloc(n); await fh.read(buf, 0, n, size - n); return buf.toString('utf8').split('\n').filter(Boolean).slice(-nLines); }
  finally { await fh.close(); }
}

/**
 * 코드 사본 — 그 솔루션 폴더 git 이 원격 저장소(GitHub 등)에 올라가 있는지
 *   읽기만: 네트워크 안 씀(원격에 묻지 않음) — 이 서버가 마지막으로 올리거나 받은 때의 원격 표시(refs/remotes)와 비교.
 *   주소에 든 아이디·토큰은 버리고 «주인/저장소» 이름만.
 */
const gitRun = (dir, args) => new Promise((ok) => execFile('git', ['-C', dir].concat(args), { timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: D.home, LANG: 'C', GIT_OPTIONAL_LOCKS: '0' } },
  (e, out) => ok(e ? null : String(out))));
function repoName(url) {
  const u = String(url || '').trim().replace(/\.git$/, '');
  const m = u.match(/^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i) || u.match(/^(?:[^@]+@)?([^:/]+):(.+)$/);
  if (!m) return null;
  return { host: /github/i.test(m[1]) ? 'GitHub' : /gitlab/i.test(m[1]) ? 'GitLab' : m[1].slice(0, 60), repo: m[2].replace(/^\/+/, '').slice(0, 80) };
}
async function gitStatus(dir, every) {
  const lim = ((every || 24) + 2) * 3600e3, now = Date.now();
  if (!dir || !(await gitRun(dir, ['rev-parse', '--git-dir']))) {
    // .git 이 있는데 git 이 못 읽음(폴더 주인이 달라 safe.directory 필요 등) — «없음» 이 아니라 «확인 못 함»
    let has = false; try { fs.statSync(path.join(dir, '.git')); has = true; } catch (_) {}
    return has ? { state: 'unknown', why: 'unreadable' } : { state: 'none', why: 'nogit' };
  }
  const head = await gitRun(dir, ['rev-parse', '-q', '--verify', 'HEAD']);
  const dirty = ((await gitRun(dir, ['status', '--porcelain'])) || '').split('\n').filter(Boolean).length;
  if (!head) return { state: 'none', why: 'nocommit', dirty };
  const branch = ((await gitRun(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) || '').trim();
  const up = ((await gitRun(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) || '').trim();
  const remotes = ((await gitRun(dir, ['remote'])) || '').split('\n').filter(Boolean);
  const rname = up ? up.split('/')[0] : remotes[0];
  const where = rname ? repoName(await gitRun(dir, ['remote', 'get-url', rname])) : null;
  const lastCommit = Number(await gitRun(dir, ['log', '-1', '--format=%ct'])) * 1000 || null;
  if (!remotes.length) return { state: 'none', why: 'noremote', branch, dirty, lastCommit };
  if (!up) return { state: 'bad', why: 'noupstream', branch, where, dirty, lastCommit };
  const ahead = Number(await gitRun(dir, ['rev-list', '--count', '@{u}..HEAD'])) || 0;
  const behind = Number(await gitRun(dir, ['rev-list', '--count', 'HEAD..@{u}'])) || 0;
  // 마지막으로 원격 표시가 바뀐 때(올림·받음) — 기록이 없으면 원격 쪽 마지막 커밋 시각
  const rl = ((await gitRun(dir, ['reflog', '-1', '--date=unix', '--format=%gd', up])) || '').match(/@\{(\d{9,})\}/);
  const synced = rl ? Number(rl[1]) * 1000 : (Number(await gitRun(dir, ['log', '-1', '--format=%ct', '@{u}'])) * 1000 || null);
  const ts = ahead ? ((await gitRun(dir, ['log', '--format=%ct', '@{u}..HEAD'])) || '').split('\n').map(Number).filter((n) => n > 0) : [];
  const oldest = ts.length ? Math.min.apply(null, ts) * 1000 : null;   // 안 올린 커밋 중 가장 오래된 커밋 시각
  const stale = !!(oldest && now - oldest > lim);
  return { state: stale ? 'bad' : 'ok', why: stale ? 'stale' : ahead ? 'ahead' : null, branch, up, where, ahead, behind, synced, oldest, dirty, lastCommit };
}

/**
 * 원격 저장소 «연결» — BACKUP_STRUCTURE.md 13절
 *   상황판이 하는 것: 솔루션 전용 deploy key 만들기(.pub 만 읽음) · 비공개인지 · 그 열쇠로 읽히는지 확인. 폴더 안 일(init·커밋·push)은 그 솔루션 방.
 *   GitHub 저장소 하나짜리 열쇠라 1절 «열쇠를 갖지 않는다» 의 예외 — 끊기: GitHub 에서 Deploy key 지우기 + ~/.ssh/board-git-<key>* 지우기.
 */
const GITHUB_HOSTKEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const SAFE_PATH = /^[A-Za-z0-9._\/-]+$/;
const keyPath = (key) => path.join(D.home, '.ssh', 'board-git-' + String(key));
const hostsPath = () => path.join(D.home, '.ssh', 'board-github_known_hosts');
function repoClean(r) {
  const v = String(r || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = v.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!m || ['.', '..', '.git'].includes(m[2]) || m[2].includes('..')) return null;
  return m[1] + '/' + m[2];
}
/** 열쇠 상태 — 경로는 항상 key 에서 계산(저장값 안 믿음) · 링크 아님·600·내 것 · .pub 만 읽음 */
function keyInfo(key) {
  if (!/^[a-z0-9_-]+$/.test(String(key))) return { ok: false, why: 'badkey' };
  const f = keyPath(key);
  if (!SAFE_PATH.test(f)) return { ok: false, why: 'badpath', path: f };
  let st; try { st = fs.lstatSync(f); } catch (_) { return { ok: false, why: 'none', path: f }; }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, why: 'notfile', path: f };
  if ((st.mode & 0o077) !== 0) return { ok: false, why: 'perm', path: f };
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return { ok: false, why: 'owner', path: f };
  let pub = ''; try { const ps = fs.lstatSync(f + '.pub'); if (!ps.isSymbolicLink()) pub = fs.readFileSync(f + '.pub', 'utf8').trim(); } catch (_) {}
  if (!/^ssh-ed25519 [A-Za-z0-9+\/=]+( [^\n]*)?$/.test(pub)) return { ok: false, why: 'nopub', path: f };
  return { ok: true, path: f, pub };
}
function makeKey(key, label) {
  const k = keyInfo(key);
  if (k.ok) return Promise.resolve(k);
  if (k.why !== 'none') return Promise.resolve(k);   // 무엇이든 이미 있으면 덮지 않음
  try { fs.mkdirSync(path.join(D.home, '.ssh'), { recursive: true, mode: 0o700 }); } catch (_) {}
  const comment = 'board-git-' + key + '@' + (String(label || 'server').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 40) || 'server');
  return new Promise((ok) => {
    const c = execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', keyPath(key)], { timeout: 20000, env: { PATH: process.env.PATH, HOME: D.home } }, () => ok(keyInfo(key)));
    try { c.stdin.end(); } catch (_) {}   // 덮어쓰기 물음이 나오면 바로 실패로 끝남
  });
}
/** 방이 폴더 git 설정에 넣을 ssh 명령 — 다른 열쇠·ssh 설정·에이전트로 새지 않게 */
function sshCommand(key) {
  const f = keyPath(key), h = hostsPath();
  if (!SAFE_PATH.test(f) || !SAFE_PATH.test(h)) return null;
  return 'ssh -F /dev/null -i ' + f + ' -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o UserKnownHostsFile=' + h + ' -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519';
}
function gitOut(args, env, cwd) {
  return new Promise((ok) => execFile('git', args, { cwd: cwd || require('os').tmpdir(), timeout: 25000, maxBuffer: 4 * 1024 * 1024, env: Object.assign({ PATH: process.env.PATH, HOME: D.home, LANG: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false' }, env || {}) },
    (e, out, err) => ok({ ok: !e, out: String(out || ''), err: String(err || '') })));
}
/** 인증 없이 https 로 읽히면 공개 저장소 → 거절 (Fable ①) — { public: true|false|null(모름) } */
async function isPublic(repo) {
  const r = await gitOut(['-c', 'credential.helper=', 'ls-remote', '--', 'https://github.com/' + repo + '.git']);
  if (r.ok) return { public: true };
  if (/terminal prompts disabled|could not read Username|Authentication failed|Repository not found/i.test(r.err)) return { public: false };   // 그 밖(403·한도·프록시)은 모름 = 거절 (Fable 완료 ①)
  return { public: null, err: r.err.split('\n').filter(Boolean).pop() || '' };
}
/** 연결 확인 — 공개면 거절 · 그 열쇠로만 ssh ls-remote · 빈 저장소인지 */
async function checkRemote(key, repoIn) {
  const repo = repoClean(repoIn);
  if (!repo) return { ok: false, why: 'repo' };
  const k = keyInfo(key); if (!k.ok) return { ok: false, why: 'key:' + k.why };
  const cmd = sshCommand(key); if (!cmd) return { ok: false, why: 'key:badpath' };
  try { fs.writeFileSync(hostsPath(), GITHUB_HOSTKEY + '\n', { mode: 0o644 }); } catch (_) { return { ok: false, why: 'hosts' }; }
  const pv = await isPublic(repo);
  if (pv.public === true) return { ok: false, why: 'public', repo };
  if (pv.public === null) return { ok: false, why: 'net', repo, err: pv.err };
  const r = await gitOut(['ls-remote', '--', 'git@github.com:' + repo + '.git'], { GIT_SSH_COMMAND: cmd });
  if (!r.ok) {
    const e = r.err;
    return { ok: false, repo, why: /Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(e) ? 'hostkey' : /Permission denied|publickey/i.test(e) ? 'denied' : /not found|does not exist|access rights/i.test(e) ? 'notfound' : 'net', err: e.split('\n').filter(Boolean).pop() || '' };
  }
  // 계정 열쇠로 잘못 넣으면 모든 저장소가 열림 — ssh -T 인사가 «Hi 주인/저장소!» 여야 deploy key
  const hi = await new Promise((ok) => execFile('ssh', cmd.split(' ').slice(1).concat(['-T', 'git@github.com']), { timeout: 20000, env: { PATH: process.env.PATH, HOME: D.home } }, (e, o, er) => ok(String(o || '') + String(er || ''))));
  const m = hi.match(/Hi ([^!\s]+)!/);
  if (m && m[1].toLowerCase() !== repo.toLowerCase()) return { ok: false, repo, why: m[1].includes('/') ? 'otherrepo' : 'account' };
  return { ok: true, repo, empty: !r.out.trim() };
}

const statusCache = {};
/** 솔루션 하나의 현황 — { level: ok|warn|bad|none, rows:[…], offsite, problems, approved } */
async function status(proj, force) {
  const c = conf(proj);
  if (!c) return { level: 'none' };
  const now = Date.now();
  const hit = statusCache[proj.key];
  const fp = fingerprint(proj);
  if (!force && hit && hit.fp === fp && now - hit.at < STATUS_MS) return Object.assign({}, hit.v, run0(proj.key));
  const lim = (c.every + 2) * 3600e3;
  const rows = [];
  const folder = async (kind, x) => {
    const r = await listTop(x.path, now);
    if (!r.ok) return rows.push({ kind, label: x.label, path: x.path, state: r.why === 'toomany' ? 'unknown' : 'bad', why: r.why });
    const top = r.items[0] || null;
    rows.push({ kind, label: x.label, path: x.path, state: !top ? 'bad' : now - top.t > lim ? 'bad' : 'ok', why: !top ? 'empty' : now - top.t > lim ? 'stale' : null,
      newest: top ? { name: top.name, t: top.t, size: top.size, dir: top.dir } : null, n: r.items.length, more: r.more || undefined });
  };
  for (const x of c.local) await folder('local', x);
  for (const x of c.sent) {
    let r;
    if (x.stamp) { try { r = { ok: true, t: (await fs.promises.stat(expand(x.stamp))).mtimeMs }; } catch (_) { r = { ok: false, why: 'nostamp' }; } }
    else r = await sentAt(c.log, x.ok);
    // 시각을 알 수 없으면 회색(빨강 아님) · 시각이 있고 오래됐으면 빨강
    rows.push({ kind: 'sent', label: x.label, state: !r.ok ? (r.why === 'notime' ? 'unknown' : 'bad') : now - r.t > lim ? 'bad' : 'ok', why: r.ok ? (now - r.t > lim ? 'stale' : null) : r.why, t: r.ok ? r.t : null });
  }
  for (const x of c.received) await folder('received', x);
  const offsite = c.sent.length + c.received.length > 0;
  const git = c.git ? await gitStatus(c.dir, c.every) : null;
  const pr = problems(c);
  const level = pr.length || rows.some((r) => r.state === 'bad') || (git && git.state === 'bad') ? 'bad' : !offsite || (git && git.state === 'none') ? 'warn' : 'ok';
  const v = { level, rows, git, offsite, problems: pr, every: c.every, command: c.command, log: c.log, restore: c.restore, at: now };
  statusCache[proj.key] = { at: now, fp, v };
  return Object.assign({}, v, run0(proj.key));
}
/** 상황판이 다시 켜진 뒤 남은 «도는 중» — 묶음이 죽었으면 «모름», 살아 있고 60분 넘었으면 묶음째 끝냄 (Fable 완료 검증 ④) */
function reconcile(key) {
  const r = ((D.peekState().backupRuns) || {})[key];
  if (!r || r.result !== 'running' || running.has(key)) return;
  let alive = false; try { if (r.pid) { process.kill(-r.pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
  if (alive && Date.now() - Date.parse(r.at) > RUN_TIMEOUT_MS) { try { process.kill(-r.pid, 'SIGKILL'); } catch (_) {} alive = false; }
  if (alive) return;
  const st = D.loadState(); const x = (st.backupRuns || {})[key];
  if (x && x.result === 'running') { x.result = 'unknown'; x.end = new Date().toISOString(); delete x.pid; D.saveState(st); D.writeLog({ action: 'backup-orphan', project: key }); }
}
function run0(key) {
  reconcile(key);
  const r = ((D.peekState().backupRuns) || {})[key];
  return { run: r ? { at: r.at, end: r.end || null, code: r.code == null ? null : r.code, result: r.result, by: r.by, ms: r.ms || null } : null };
}

/** 다른 프로세스가 이 스크립트를 실행 중인가 — /proc/<pid>/cmdline 인자를 정확히 대조(편집기·tail 은 안 잡음 · Fable ④) */
function otherRunning(script) {
  let real = script; try { real = fs.realpathSync(script); } catch (_) {}
  let ids = []; try { ids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)); } catch (_) { return false; }
  for (const id of ids) {
    let a; try { a = fs.readFileSync('/proc/' + id + '/cmdline', 'utf8').split('\0').filter(Boolean); } catch (_) { continue; }
    if (!a.length) continue;
    const exe = path.basename(a[0]);
    const cand = /^(ba|da|z)?sh$/.test(exe) ? a.slice(1).find((x) => !x.startsWith('-')) : a[0];
    if (cand && (cand === script || cand === real)) return true;
  }
  return false;
}

const running = new Map();   // key → { child, timer }
/** 상황판이 다시 켜졌을 때 «도는 중» 으로 남은 것을 정리 (Fable ④) */
function bootSweep() {
  const st = D.loadState(); const r = st.backupRuns || {}; let ch = false;
  for (const k of Object.keys(r)) if (r[k].result === 'running') {
    let alive = false; try { if (r[k].pid) { process.kill(-r[k].pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
    if (!alive) { r[k].result = 'unknown'; r[k].end = new Date().toISOString(); ch = true; }
  }
  if (ch) D.saveState(st);
}
/** 지금 백업 — { ok, message } */
function runNow(proj, by) {
  const c = conf(proj);
  if (!c || !c.command) return { ok: false, code: 400, message: D.K('지금 백업 명령이 등록되지 않았어요', 'No backup command registered') };
  const pr = problems(c); if (pr.length) return { ok: false, code: 400, message: pr.join(' · ') };
  if (!isApproved(proj)) return { ok: false, code: 409, message: D.K('백업 설정이 승인 뒤 바뀌었어요(또는 아직 승인 전) — 창에서 «이 설정 승인» 먼저', 'Backup settings changed since approval (or never approved) — approve them first') };
  if (running.has(proj.key)) return { ok: false, code: 409, message: D.K('이 솔루션 백업이 이미 도는 중이에요', 'A backup is already running for this project') };
  if (otherRunning(c.script)) return { ok: false, code: 409, message: D.K('같은 백업 스크립트가 지금 돌고 있어요(정기 백업 등) — 끝난 뒤에', 'The same backup script is running now (e.g. the nightly one) — try after it finishes') };
  fs.mkdirSync(logDir(), { recursive: true });
  try { for (const f of fs.readdirSync(logDir())) { const q = path.join(logDir(), f); if (Date.now() - fs.statSync(q).mtimeMs > 30 * 86400e3) fs.unlinkSync(q); } } catch (_) {}   // 30일 넘은 출력 정리
  const at = new Date().toISOString();
  const out = path.join(logDir(), proj.key + '-' + at.replace(/[:.]/g, '-') + '.log');
  const fd = fs.openSync(out, 'a', 0o600);
  // 깨끗한 환경(cron 수준) — 상황판 비밀값·토큰은 넘기지 않는다
  const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: D.home, USER: process.env.USER || '', LOGNAME: process.env.LOGNAME || process.env.USER || '', SHELL: '/bin/sh', LANG: process.env.LANG || 'C.UTF-8', TZ: process.env.TZ || '' };
  if (!env.TZ) delete env.TZ;
  const args = ['-n', '10'].concat(fs.existsSync('/usr/bin/ionice') ? ['ionice', '-c3', c.script] : [c.script]);
  let child;
  try { child = spawn('nice', args, { cwd: c.dir, env, detached: true, stdio: ['ignore', fd, fd] }); }
  catch (e) { fs.closeSync(fd); return { ok: false, code: 500, message: String(e.message || e) }; }
  fs.closeSync(fd);
  const t0 = Date.now();
  const st = D.loadState(); st.backupRuns = st.backupRuns || {};
  st.backupRuns[proj.key] = { at, by, result: 'running', pid: child.pid, out };
  D.saveState(st);
  D.writeLog({ action: 'backup-run', project: proj.key, by, command: c.command, pid: child.pid });
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }, 10000); } catch (_) {} }, RUN_TIMEOUT_MS);
  if (timer.unref) timer.unref();
  running.set(proj.key, { child, timer });
  const finish = (code, sig) => {
    if (!running.has(proj.key)) return;
    clearTimeout(timer); running.delete(proj.key);
    const s = D.loadState(); s.backupRuns = s.backupRuns || {};
    const r = Object.assign({}, s.backupRuns[proj.key], { end: new Date().toISOString(), code: code == null ? null : code, sig: sig || undefined, ms: Date.now() - t0, result: code === 0 ? 'ok' : 'fail' });
    delete r.pid; s.backupRuns[proj.key] = r; D.saveState(s);
    delete statusCache[proj.key];
    D.writeLog({ action: 'backup-done', project: proj.key, code, sig: sig || undefined, ms: r.ms });
    if (D.onChange) D.onChange(proj, r);
  };
  child.on('exit', finish);
  child.on('error', () => finish(null, 'spawn-error'));
  child.unref();
  return { ok: true, message: D.K('백업을 시작했어요 — 끝나면 이 줄이 바뀌어요', 'Backup started — this line updates when it finishes') };
}
/** 마지막 «지금 백업» 출력 끝 — 주인만 */
async function runTail(key) {
  const r = ((D.peekState().backupRuns) || {})[key];
  return r && r.out ? logTail(r.out, 30) : null;
}

/** 복원 요청용 — 등록 폴더 안 실제 항목인지 서버가 다시 확인 (Fable ⑦). 돌려줌: { kind, label, path, name, t, size } | null */
async function pickCopy(proj, kind, idx, name) {
  const c = conf(proj); if (!c) return null;
  const arr = kind === 'local' ? c.local : kind === 'received' ? c.received : null;
  const x = arr && arr[idx | 0]; if (!x) return null;
  const r = await listTop(x.path, Date.now()); if (!r.ok) return null;
  const it = r.items.find((i) => i.name === String(name)); if (!it) return null;
  return { kind, label: x.label, path: path.join(r.real, it.name), name: it.name, t: it.t, size: it.size, dir: it.dir };
}
async function copies(proj, kind, idx) {
  const c = conf(proj); if (!c) return null;
  const arr = kind === 'local' ? c.local : kind === 'received' ? c.received : null;
  const x = arr && arr[idx | 0]; if (!x) return null;
  const r = await listTop(x.path, Date.now()); if (!r.ok) return { label: x.label, items: [] };
  return { label: x.label, items: r.items.slice(0, 60).map((i) => ({ name: i.name, t: i.t, size: i.size, dir: i.dir })) };
}

module.exports = { init, conf, problems, fingerprint, isApproved, approvalWhy, approve, approvedOf, status, runNow, runTail, bootSweep, pickCopy, copies, listTop, sentAt, nameDate, otherRunning, pathBad, gitStatus, repoName, repoClean, keyInfo, makeKey, sshCommand, isPublic, checkRemote, keyPath, GITHUB_HOSTKEY, running, _cache: statusCache };
