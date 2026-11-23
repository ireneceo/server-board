'use strict';
/**
 *
 * 상황판이 /proc 의 fd·environ 을 읽어 «이 접속이 사람(SSH)인지 작업방 AI(claude 아래)인지», «방이 남긴 명령» 을 가린다.
 * fd·environ 은 같은 계정만 읽을 수 있다 — 상황판이 board 계정으로 옮기면 owner 의 프로그램을 못 읽는다.
 * 그래서 같은 판정을 이 파일 하나에 모으고:
 *   같은 계정(지금) → server.js 가 그대로 불러 씀(전과 같은 코드)
 *   다른 계정 → run-as 의 «peer» 일로 주인 계정이 이 파일(root 소유 사본 /usr/local/lib/server-board/proc-peek.js)을 돌려 결과만 돌려줌
 *
 * 명령 줄: node proc-peek.js sock <inode>          → terminal | agent | tunnel
 *          node proc-peek.js procs                 → [[sessionId, [{pid,ppid,owner,ticks,ageMs,cmd,wrap}]], …]
 *          node proc-peek.js kill TERM|KILL <pid>… → 실제로 신호를 보낸 pid 목록(지금도 «방이 띄운 명령» 인 것만)
 */
const fs = require('fs');

/** 접속을 쥔 프로그램 번호 — 못 찾으면 null. sealedSsh = 들여다볼 수 없는 sshd(주인 계정 SSH 접속·통로)가 있음
 */
function pidOfInode(inode, uid) {
  const want = 'socket:[' + inode + ']';
  let sealedSsh = false;
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    try { if (fs.statSync('/proc/' + p).uid !== uid) continue; } catch (_) { continue; }
    let fds; try { fds = fs.readdirSync('/proc/' + p + '/fd'); } catch (_) { try { if (/^sshd/.test(fs.readFileSync('/proc/' + p + '/comm', 'utf8'))) sealedSsh = true; } catch (_) {} continue; }
    for (const d of fds) { try { if (fs.readlinkSync('/proc/' + p + '/fd/' + d) === want) return { pid: Number(p) }; } catch (_) {} }
  }
  return { pid: null, sealedSsh };
}
/** 주인 계정 프로그램이 사람(SSH 터미널·통로)인지 작업방 AI(claude 아래)인지 — claude 를 먼저 본다(터미널에서 띄운 claude 도 AI) */
function ownerKind(pid, selfPid) {
  if (pid === selfPid) return 'system';
  let ssh = false;
  for (let p = pid, i = 0; p > 1 && i < 40; i++) {
    let argv0 = '', comm = '', ppid = 0;
    try { argv0 = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\0')[0]; } catch (_) {}
    try { comm = fs.readFileSync('/proc/' + p + '/comm', 'utf8').trim(); } catch (_) {}
    try { ppid = Number(fs.readFileSync('/proc/' + p + '/stat', 'utf8').replace(/^.*\)\s+/, '').split(' ')[1]); } catch (_) {}
    if (/(^|\/)claude$/.test(argv0)) return 'agent';
    try { if (/(^|\0)CLAUDECODE=1(\0|$)/.test(fs.readFileSync('/proc/' + p + '/environ', 'utf8'))) return 'agent'; } catch (_) {}
    if (/^sshd/.test(comm) || /^sshd:/.test(argv0)) ssh = true;
    p = ppid;
  }
  return ssh ? 'owner' : 'agent';   // 모르는 주인 계정 프로그램(cron 등)은 AI 와 같게 — 넣기만
}
/** 소켓 하나의 길 — terminal(주인 SSH 셸의 명령) · agent · tunnel(들여다볼 수 없는 sshd = SSH 통로) · system(상황판 자신) */
function sockKind(inode, uid, selfPid) {
  const po = pidOfInode(inode, uid);
  if (po.pid) { const k = ownerKind(po.pid, selfPid); return k === 'owner' ? 'terminal' : k; }
  return po.sealedSsh ? 'tunnel' : 'agent';
}

/** 작업방이 띄운 명령(셸·그 아래 프로그램) — 환경 변수 CLAUDE_CODE_SESSION_ID 로 어느 방 것인지, CLAUDE_PID 로 지금 방 프로세스가 띄운 것인지 안다 */
function sessionProcs() {
  const out = new Map();
  let pids = []; try { pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)); } catch (_) { return out; }
  const hz = 100, upSec = (() => { try { return parseFloat(fs.readFileSync('/proc/uptime', 'utf8')); } catch (_) { return 0; } })();
  for (const p of pids) {
    let env; try { env = fs.readFileSync('/proc/' + p + '/environ', 'latin1'); } catch (_) { continue; }
    if (/(?:^|\0)(pm_id|PM2_HOME|PM2_USAGE)=/.test(env)) continue;   // PM2 가 돌리는 서버(솔루션 백엔드) — 방이 pm2 restart 하면 방 번호가 묻어 온다. 절대 건드리지 않음
    const m = env.match(/(?:^|\0)CLAUDE_CODE_SESSION_ID=([0-9a-f-]{36})(?:\0|$)/); if (!m) continue;
    let f; try { const t = fs.readFileSync('/proc/' + p + '/stat', 'utf8'); f = t.slice(t.lastIndexOf(')') + 2).split(' '); } catch (_) { continue; }
    let cmd = ''; try { cmd = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').replace(/\0/g, ' ').trim(); } catch (_) { /* 없어짐 */ }
    if (/\/claude(\s|$)|\/versions\/[\d.]+(\s|$)/.test(cmd.split(' ')[0] || '')) continue;   // Claude 자신(방 프로세스·하위 claude)은 명령이 아님
    const ev = cmd.match(/eval '([\s\S]*)'(?: < \/dev\/null)? && pwd -P/);   // Bash 도구가 감싼 셸 → 실제 명령만
    const x = { pid: +p, ppid: +f[1], owner: +((env.match(/(?:^|\0)CLAUDE_PID=(\d+)/) || [])[1] || 0), ticks: (+f[11]) + (+f[12]),
      ageMs: upSec ? Math.max(0, (upSec - (+f[19]) / hz) * 1000) : null, cmd: (ev ? ev[1] : cmd).replace(/\s+/g, ' ').slice(0, 300), wrap: !!ev };
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(x);
  }
  for (const [sid, list] of out) {
    const by = new Map(list.map((x) => [x.pid, x]));
    const under = (x) => { for (let y = x, n = 0; y && n < 50; y = by.get(y.ppid), n++) if (y.wrap) return true; return false; };
    const keep = list.filter(under);
    if (keep.length) out.set(sid, keep); else out.delete(sid);
  }
  return out;
}
/** 신호 보내기 — 지금도 «방이 띄운 명령» 인 pid 에만(통로 너머에서 아무 프로그램이나 끄지 못하게) */
function killSession(sig, pids) {
  const ok = new Set();
  for (const list of sessionProcs().values()) for (const x of list) ok.add(x.pid);
  const done = [];
  for (const pid of pids) {
    if (!ok.has(pid)) continue;
    try { process.kill(pid, sig); done.push(pid); } catch (_) { /* 이미 끝남 */ }
  }
  return done;
}

module.exports = { pidOfInode, ownerKind, sockKind, sessionProcs, killSession };

if (require.main === module) {
  const [mode, ...rest] = process.argv.slice(2);
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  if (mode === 'sock' && /^\d{1,20}$/.test(rest[0] || '')) {
    process.stdout.write(sockKind(rest[0], uid, -1) + '\n');
  } else if (mode === 'procs' && !rest.length) {
    process.stdout.write(JSON.stringify(Array.from(sessionProcs())) + '\n');
  } else if (mode === 'kill' && /^(TERM|KILL)$/.test(rest[0] || '') && rest.slice(1).every((x) => /^\d{1,10}$/.test(x))) {
    process.stdout.write(JSON.stringify(killSession('SIG' + rest[0], rest.slice(1).map(Number))) + '\n');
  } else {
    process.stderr.write('usage: proc-peek.js sock <inode> | procs | kill TERM|KILL <pid>…\n');
    process.exit(2);
  }
}
