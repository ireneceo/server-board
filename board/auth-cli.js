#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('./auth');

const CONF = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) { return {}; } })();
const KO = CONF.lang === 'ko';
const L = (ko, en) => (KO ? ko : en);
const PORT = Number(CONF.port) || 8800;
const OWNER_ID = os.userInfo().username.toLowerCase();

/** 이 명령이 작업방(claude) 아래에서 돌고 있나 */
function underAi() {
  if (process.env.CLAUDECODE) return true;
  for (let p = process.ppid, i = 0; p > 1 && i < 40; i++) {
    try {
      if (/(^|\/)claude$/.test(fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\0')[0])) return true;
      if (/(^|\0)CLAUDECODE=1(\0|$)/.test(fs.readFileSync('/proc/' + p + '/environ', 'utf8'))) return true;
      p = Number(fs.readFileSync('/proc/' + p + '/stat', 'utf8').replace(/^.*\)\s+/, '').split(' ')[1]);
    } catch (_) { break; }
  }
  return false;
}
function log(entry) {
  try {
    const d = new Date(), dir = path.join(__dirname, 'log');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, d.toISOString().slice(0, 10) + '.log'), JSON.stringify({ at: d.toISOString(), by: 'terminal:' + OWNER_ID, ...entry }) + '\n');
  } catch (_) {}
}
function tsUrl() {
  try {
    const st = JSON.parse(require('child_process').execFileSync('tailscale', ['status', '--json'], { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    const h = String(st.Self.DNSName || '').replace(/\.$/, '').toLowerCase();
    const sv = JSON.parse(require('child_process').execFileSync('tailscale', ['serve', 'status', '--json'], { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString() || '{}');
    const k = Object.keys(sv.Web || {}).find((w) => w.toLowerCase().startsWith(h + ':') && JSON.stringify(sv.Web[w]).includes(':' + PORT + '"'));
    if (!k) return null;
    const port = k.slice(h.length + 1);
    return 'https://' + h + (port === '443' ? '' : ':' + port);
  } catch (_) { return null; }
}

const cmd = process.argv[2] || '';
if (cmd === 'recover') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error(L('✘ 사람이 친 서버 터미널에서만 됩니다(TTY).', '✘ Only from a server terminal typed by a person (TTY).')); process.exit(2); }
  if (underAi()) { console.error(L('✘ 작업방(AI) 안에서는 비상 복구를 할 수 없습니다.', '✘ Emergency recovery cannot run inside an AI session.')); log({ action: 'recover-refused', why: 'ai' }); process.exit(3); }
  const n = auth.dropUserSessions();
  auth.setRecovering(true);
  const tok = auth.makeReset(OWNER_ID, 'recover', 10 * 60e3);
  log({ action: 'recover', tty: (() => { try { return fs.readlinkSync('/proc/self/fd/0'); } catch (_) { return '?'; } })(), sessions: n });
  const q = '/?reset=' + tok;
  const ts = tsUrl();
  console.log(L('✔ 비상 복구 — 접속 ' + n + '개를 끊었고, 다시 설정할 때까지 아무도 로그인할 수 없습니다.', '✔ Emergency recovery — signed out ' + n + ' session(s); nobody can sign in until you finish.'));
  console.log(L('  아래 링크 중 하나를 10분 안에 열어 비밀번호와 인증 앱을 다시 정하세요(한 번만 쓸 수 있음):', '  Open one of these within 10 minutes to set your password and authenticator again (single use):'));
  console.log('  · ' + L('SSH 통로', 'SSH tunnel') + ': http://localhost:' + PORT + q);
  if (ts) console.log('  · Tailscale: ' + ts + q);
  console.log(L('  10분이 지나면 dev recover 를 다시 실행하세요.', '  After 10 minutes, run dev recover again.'));
  process.exit(0);
}
if (cmd === 'status') {
  const ids = [OWNER_ID].concat(((CONF.team && CONF.team.members) || []).map((m) => String(m.user || m.tailscale || '').toLowerCase()).filter(Boolean));
  const ss = auth.listSessions();
  console.log(L('상황판 로그인 상태', 'Board sign-in state') + (auth.recovering() ? L(' — ⚠ 비상 복구 중(로그인 막힘)', ' — ⚠ recovery in progress (sign-in closed)') : ''));
  for (const id of ids) {
    const u = auth.userInfo(id);
    console.log('  ' + id.padEnd(24) + (u && u.pwAt ? L('비밀번호 ✔', 'password ✔') : L('비밀번호 없음', 'no password')) + (id === OWNER_ID ? ' · ' + (u && u.totp ? L('인증 앱 ✔ (예비 코드 ' + u.backupLeft + '개)', 'authenticator ✔ (' + u.backupLeft + ' backup codes)') : L('인증 앱 없음', 'no authenticator')) : '')
      + (u && u.locked ? L(' · 잠김', ' · locked') : '') + ' · ' + L('접속 ', 'sessions ') + ss.filter((s) => s.id === id).length);
  }
  process.exit(0);
}
console.log(L('사용: dev recover (비상 복구) · dev auth-status (로그인 상태)', 'Usage: dev recover (emergency recovery) · dev auth-status (sign-in state)'));
process.exit(1);
