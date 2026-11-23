'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..');
const FILES = ['server.js', 'index.html', 'auth.js', 'auth-cli.js', 'gate.js', 'deploy-runner.js', 'backup.js', 'key-window.js', 'updater.js', 'update-runner.js', 'account.js', 'proc-peek.js', 'config.example.json'];

// 가짜 claude — 시험이 부르는 명령만 흉내 낸다
const FAKE_CLAUDE = `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (a[0] === '--help') { console.log(process.env.FAKE_HELP === 'old' ? 'Usage: claude [options]\\n  -r, --resume  Resume\\n  agents\\n  auth' : 'Usage: claude [options]\\n  --bg, --background\\n  -r, --resume [value]\\n  agents\\n  attach <id>\\n  stop|kill <id>\\n  auth'); process.exit(0); }
if (a[0] === 'agents') { console.log(process.env.FAKE_AGENTS || '[]'); process.exit(0); }   // FAKE_AGENTS — 시험이 방 목록 모양을 정함
if (a[0] === 'auth' && a[1] === 'status') { console.log(JSON.stringify({ loggedIn: process.env.FAKE_LOGGED_IN !== '0', authMethod: 'claude.ai' })); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'login') {
  console.log('Opening browser to sign in…');
  console.log('If the browser didn\\'t open, visit: https://claude.ai/oauth/authorize?code=true&state=STATE123&x=1');
  process.stdout.write('Paste code here if prompted > ');
  process.stdin.once('data', (d) => { const c = String(d).trim(); if (c === 'GOOD#STATE123') { console.log('Login successful.'); process.exit(0); } console.log('OAuth error: Invalid code'); process.exit(1); });
  return;
}
if (a[0] === '--bg') { require('fs').appendFileSync(process.env.FAKE_BG_LOG || '/dev/null', JSON.stringify(a) + '\\n'); console.log('backgrounded · deadbeef'); process.exit(0); }
console.log('fake claude: ' + a.join(' '));
`;

function makeSandbox({ lang = 'ko', config = {}, projects } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-test-'));
  const dir = path.join(root, 'board'), home = path.join(root, 'home'), bin = path.join(root, 'bin');
  for (const d of [dir, home, bin, path.join(home, 'dev-server'), path.join(home, '.claude', 'jobs'), path.join(root, 'proj')]) fs.mkdirSync(d, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(Object.assign({ lang, timezone: 'Asia/Seoul', port: 0 }, config)));
  fs.writeFileSync(path.join(home, 'dev-server', 'projects.json'), JSON.stringify(projects || [
    { key: 'demo', name: 'Demo', dir: path.join(root, 'proj'), stateFile: 'session-state.md' },
  ]));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [path.join(root, 'proj')]: { hasTrustDialogAccepted: true } } }));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  process.once('exit', () => { try { cleanup(); } catch (_) {} });   // 시험 파일이 cleanup 을 안 불러도 /tmp/board-test-* 가 남지 않게
  return { root, dir, home, bin, cleanup };
}

/** 복사본 server.js 를 불러온다 — 이 프로세스의 HOME·CLAUDE_BIN 을 바꾼 뒤 (node --test 는 파일마다 따로 프로세스) */
function loadBoard(opts) {
  const sb = makeSandbox(opts);
  process.env.HOME = sb.home;
  process.env.CLAUDE_BIN = path.join(sb.bin, 'claude');
  process.env.BOARD_AUTH_DIR = path.join(sb.dir, 'secrets');
  process.env.FAKE_BG_LOG = path.join(sb.root, 'bg.log');
  process.env.BOARD_TEST_SOCK = '1';   // 접속한 쪽을 머리글 x-test-sock 으로 정함(시험 전용 — 상황판 자신은 이 값 없이 돈다)
  // 상황판이 불러올 때 거는 주기 작업(setInterval)이 시험 프로세스를 붙잡지 않게
  const si = global.setInterval;
  global.setInterval = (...a) => { const t = si(...a); if (t && t.unref) t.unref(); return t; };
  const board = require(path.join(sb.dir, 'server.js'));
  global.setInterval = si;
  // 10초 넘는 안전 타이머(로그인 창 10분 뒤 접기 등)도 시험이 끝난 프로세스를 붙잡지 않게
  const st = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => { const t = st(fn, ms, ...a); if (ms >= 10000 && t && t.unref) t.unref(); return t; };
  return { board, sb };
}

module.exports = { makeSandbox, loadBoard, SRC };
