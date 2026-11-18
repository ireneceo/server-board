// 처음 설정 «서버 창 열기» — 상황판이 스스로 본다
//   ① 지금 열린 서버 창(터미널 붙은 ssh 접속) 수 ② 들어와 있는 ssh 연결이 실제로 쓰는 이 서버 공인 주소·포트를 접속 줄에
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeSandbox } = require('./sandbox');

const sb0 = makeSandbox({});
// 가짜 ps·ss — PATH 앞에
const PS = `#!/bin/sh
cat <<'X'
Tue Nov 17 14:54:49 2026 sshd: owner
Wed Nov 18 02:30:51 2026 sshd: owner@notty
Wed Nov 18 09:10:00 2026 sshd: owner@pts/3
Wed Nov 18 08:00:00 2026 sshd-session: owner@pts/1
Wed Nov 18 09:10:01 2026 -bash
X
`;
const SS = `#!/bin/sh
cat <<'X'
0      0      10.0.0.5:22       180.74.69.88:50499
0      0      203.0.113.9:2222  222.106.47.195:64835
0      36     203.0.113.9:2222  222.106.47.195:64021
0      0      127.0.0.1:8800    127.0.0.1:50000
X
`;
fs.writeFileSync(path.join(sb0.bin, 'ps'), PS, { mode: 0o755 });
fs.writeFileSync(path.join(sb0.bin, 'ss'), SS, { mode: 0o755 });
fs.writeFileSync(path.join(sb0.root, 'sshd_config'), '# x\nPort 22\nPort 2222\n');
process.env.BOARD_SSHD_CONFIG = path.join(sb0.root, 'sshd_config');
process.env.PATH = sb0.bin + ':' + process.env.PATH;
const { loadBoard } = require('./sandbox');
const { board, sb } = loadBoard({});
test.after(() => { sb.cleanup(); sb0.cleanup(); });

test('서버 창 수·실제 접속 주소를 스스로 읽음 — 통로(-N)·notty 는 창이 아님 · 사설·로컬 연결은 주소로 안 씀', async () => {
  board.sshSeenRefresh();
  for (let i = 0; i < 50 && !board.sshSeenNow().wins; i++) await new Promise((r) => setTimeout(r, 50));
  const s = board.sshSeenNow();
  assert.equal(s.wins.length, 2, JSON.stringify(s));
  assert.deepEqual(s.wins.map((w) => w.tty).sort(), ['pts/1', 'pts/3']);
  // 사설(10.0.0.5:22)·로컬(8800) 은 빼고, 가장 많이 쓰인 공인 주소 203.0.113.9 · 포트 2222 → -p
  assert.match(board.sshGuess(), /^ssh -p 2222 \S+@203\.0\.113\.9$/);
  const b = board.setupBoard({ setup: {} }, []);
  assert.equal(b.sshWins.n, 2); assert.equal(b.sshSeen, true);
  assert.equal(b.sshWins.since, Date.parse('Wed Nov 18 08:00:00 2026'));
});
