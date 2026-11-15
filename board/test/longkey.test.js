'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBoard } = require('./sandbox');

delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const dir = path.join(sb.home, '.claude-cred-guard'), f = path.join(dir, 'longkey');
const KEY = 'x'.repeat(30) + 'Ab_-9'.repeat(10);

test('열쇠 없음 → 안 넘김 · 생기면 넘김 · 없어지면 거둠 · 이상한 글은 무시', () => {
  board.longKeySync();
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, KEY + '\n', { mode: 0o600 });
  board.longKeySync();
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, KEY);
  fs.unlinkSync(f);
  board.longKeySync();
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  fs.writeFileSync(f, 'not a key; rm -rf /', { mode: 0o600 });
  board.longKeySync();
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('밖에서 준 열쇠(상황판이 넣지 않은 것)는 파일이 없어도 건드리지 않음', () => {
  try { fs.unlinkSync(f); } catch (_) {}
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'outside';
  board.longKeySync();
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, 'outside');
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

test('기록에는 켜짐/꺼짐만 — 열쇠 글자 없음', () => {
  const logDir = path.join(sb.dir, 'log');
  const all = fs.existsSync(logDir) ? fs.readdirSync(logDir).map((n) => { try { return fs.readFileSync(path.join(logDir, n), 'utf8'); } catch (_) { return ''; } }).join('') : '';
  assert.ok(/ai-longkey/.test(all), 'log ai-longkey 있음');
  assert.ok(!all.includes(KEY), '열쇠 안 남김');
});
