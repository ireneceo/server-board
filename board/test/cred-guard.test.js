'use strict';
// node board/test/cred-guard.test.js — 가짜 폴더에서만 (진짜 ~/.claude 는 안 건드림)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { create } = require('../cred-guard');

const root = fs.mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'credguard-'));
const credDir = path.join(root, 'claude'); fs.mkdirSync(credDir);
const credFile = path.join(credDir, '.credentials.json');
const backupDir = path.join(root, 'bak');
const logs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (n) => ({ claudeAiOauth: { accessToken: 'a'.repeat(100) + n, refreshToken: 'r'.repeat(100) + n, expiresAt: Date.now() + 8 * 3600e3, refreshTokenExpiresAt: Date.now() + 30 * 86400e3, subscriptionType: 'max' } });
const write = (o) => fs.writeFileSync(credFile, typeof o === 'string' ? o : JSON.stringify(o));
const read = () => JSON.parse(fs.readFileSync(credFile, 'utf8'));
let n = 0;
const ok = (name, fn) => fn().then(() => { n++; console.log('ok', n, name); });

(async () => {
  write(key(1));
  let restored = 0;
  const g = create({ credFile, backupDir, settleMs: 300, pollMs: 60000, log: (e) => logs.push(e), onRestore: () => restored++ }).start();
  await sleep(500);

  await ok('처음 열쇠를 보관(권한 600 · 폴더 700 · 기록에 열쇠 없음)', async () => {
    const b = JSON.parse(fs.readFileSync(path.join(backupDir, 'credentials.json'), 'utf8'));
    assert.strictEqual(b.claudeAiOauth.refreshToken, key(1).claudeAiOauth.refreshToken);
    assert.strictEqual(fs.statSync(path.join(backupDir, 'credentials.json')).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(backupDir).mode & 0o777, 0o700);
    assert.ok(!JSON.stringify(logs).includes('rrrr'));
  });

  await ok('갱신(새 열쇠로 바뀜)되면 새 것을 보관', async () => {
    write(key(2)); await sleep(700);
    const b = JSON.parse(fs.readFileSync(path.join(backupDir, 'credentials.json'), 'utf8'));
    assert.strictEqual(b.claudeAiOauth.refreshToken, key(2).claudeAiOauth.refreshToken);
  });

  await ok('파일이 비면(빈 열쇠) 기다렸다 최근 열쇠로 되돌림', async () => {
    write({ claudeAiOauth: null }); await sleep(1200);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(2).claudeAiOauth.refreshToken);
    assert.strictEqual(restored, 1);
    assert.strictEqual(fs.statSync(credFile).mode & 0o777, 0o600);
  });

  await ok('같은 열쇠가 또 지워지면 다시 안 되돌림(진짜 죽은 열쇠) · gaveup 한 번만 기록', async () => {
    fs.unlinkSync(credFile); await sleep(1200);
    assert.ok(!fs.existsSync(credFile));
    g.check(); await sleep(800);
    assert.strictEqual(logs.filter((e) => e.action === 'cred-restore-gaveup').length, 1);
    assert.strictEqual(restored, 1);
  });

  await ok('사람이 다시 로그인하면(새 열쇠) 보관 · 그 열쇠가 지워지면 다시 되돌림', async () => {
    write(key(3)); await sleep(700);
    write('{}'); await sleep(1200);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(3).claudeAiOauth.refreshToken);
    assert.strictEqual(restored, 2);
  });

  await ok('쓰는 도중(잠깐 깨진 글)은 되돌리지 않음 — 다시 보니 정상', async () => {
    write('{"claudeAi'); setTimeout(() => write(key(4)), 100); await sleep(1200);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(4).claudeAiOauth.refreshToken);
    assert.strictEqual(restored, 2);
  });

  await ok('OFF 파일이 있으면 아무것도 안 함(일부러 로그아웃)', async () => {
    fs.writeFileSync(path.join(backupDir, 'OFF'), '');
    fs.unlinkSync(credFile); await sleep(1200);
    assert.ok(!fs.existsSync(credFile));
    assert.ok(logs.some((e) => e.action === 'cred-restore-skip' && e.why === 'OFF'));
    fs.unlinkSync(path.join(backupDir, 'OFF'));
  });

  await ok('다른 칸이 있는 파일은 그 칸을 그대로 두고 열쇠만 되돌림', async () => {
    write(Object.assign({ other: { x: 1 } }, key(5))); await sleep(700);
    write({ other: { x: 1 } }); await sleep(1200);
    const d = read();
    assert.deepStrictEqual(d.other, { x: 1 });
    assert.strictEqual(d.claudeAiOauth.refreshToken, key(5).claudeAiOauth.refreshToken);
  });

  g.stop();   // 아래는 따로 만든 지킴이로만
  await ok('같은 열쇠라도 되돌린 지 10분(시험 0.5초) 지나 또 지워지면 다시 되돌림', async () => {
    const g2 = create({ credFile, backupDir, settleMs: 200, pollMs: 60000, giveUpMs: 500, log: (e) => logs.push(e) }).start();
    write(key(6)); await sleep(600);
    write('{}'); await sleep(800);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(6).claudeAiOauth.refreshToken);
    await sleep(600);
    write('{}'); await sleep(800);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(6).claudeAiOauth.refreshToken);
    g2.stop();
  });

  await ok('daemon.log 에 최근 «signalling re-auth required» 가 없으면(사람 로그아웃) 안 되돌림 · 있으면 되돌림', async () => {
    const dlog = path.join(root, 'daemon.log');
    fs.writeFileSync(dlog, `[${new Date(Date.now() - 3600e3).toISOString()}] [supervisor] auth: proactive refresh failed, signalling re-auth required\n`);
    const g3 = create({ credFile, backupDir, daemonLog: dlog, settleMs: 200, pollMs: 60000, log: (e) => logs.push(e) }).start();
    write(key(7)); await sleep(600);
    fs.unlinkSync(credFile); await sleep(800);
    assert.ok(!fs.existsSync(credFile));
    assert.ok(logs.some((e) => e.why === 'no-daemon-signal'));
    fs.appendFileSync(dlog, `[${new Date().toISOString()}] [supervisor] auth: proactive refresh failed, signalling re-auth required\n`);
    g3.check(); await sleep(800);
    assert.strictEqual(read().claudeAiOauth.refreshToken, key(7).claudeAiOauth.refreshToken);
    g3.stop();
  });

  g.stop();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`cred-guard: ${n}/10 통과`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
