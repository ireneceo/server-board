'use strict';
// AI 로그인 열쇠 지킴이
//
//

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function create(opts) {
  const o = Object.assign({ settleMs: 3000, pollMs: 15000, giveUpMs: 10 * 60e3, sigWindowMs: 120e3 }, opts || {});
  const credFile = o.credFile;
  const dir = o.backupDir;
  const bakFile = path.join(dir, 'credentials.json');
  const doneFile = path.join(dir, 'restored.json');
  const log = o.log || (() => {});
  let timer = null, poller = null, watcher = null, checking = false, lastSeen = null;

  const tag = (a) => crypto.createHash('sha256').update(String(a.refreshToken) + '|' + String(a.accessToken)).digest('hex').slice(0, 12);   // 같은 열쇠인지 가리는 표식(열쇠 자체는 안 남김)
  const off = () => fs.existsSync(path.join(dir, 'OFF'));
  function readJson(f) { try { return { ok: true, v: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { ok: false, missing: e.code === 'ENOENT' }; } }
  const usable = (d) => !!(d && d.claudeAiOauth && typeof d.claudeAiOauth.refreshToken === 'string' && d.claudeAiOauth.refreshToken.length > 20);
  function writeSecure(f, obj) {
    const tmp = f + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, f);
  }

  /** 지금 파일을 한 번 본다 — 쓸 수 있으면 보관, 비었으면 «빈 것 같음» 을 알린다 */
  function look() {
    const r = readJson(credFile);
    if (r.ok && usable(r.v)) {
      const t = tag(r.v.claudeAiOauth);
      if (t !== lastSeen) {
        const b = readJson(bakFile);
        if (!(b.ok && usable(b.v) && tag(b.v.claudeAiOauth) === t)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          writeSecure(bakFile, { savedAt: new Date().toISOString(), claudeAiOauth: r.v.claudeAiOauth });
          log({ action: 'cred-backup', expiresAt: r.v.claudeAiOauth.expiresAt ? new Date(r.v.claudeAiOauth.expiresAt).toISOString() : null });
        }
        lastSeen = t;
      }
      return 'ok';
    }
    return r.ok || r.missing ? 'empty' : 'unreadable';   // unreadable = 쓰는 도중일 수 있음
  }

  /** 비었다고 본 뒤 settleMs 기다려 다시 보고, 그래도 비었으면 되돌린다 */
  function check() {
    if (checking) return;
    checking = true;
    let first;
    try { first = look(); } catch (e) { log({ action: 'cred-guard-error', err: String(e.message || e).slice(0, 200) }); checking = false; return; }
    if (first === 'ok') { checking = false; return; }
    setTimeout(() => {
      try {
        if (look() === 'ok') return;
        restore();
      } catch (e) { log({ action: 'cred-guard-error', err: String(e.message || e).slice(0, 200) }); }
      finally { checking = false; }
    }, o.settleMs);
  }

  /** 관측된 고장 서명 — daemon.log 끝에 최근 «signalling re-auth required» (daemonLog 를 안 주면 검사 안 함: 시험용) */
  function daemonSignalled() {
    if (!o.daemonLog) return true;
    try {
      const st = fs.statSync(o.daemonLog), len = Math.min(st.size, 64 * 1024), buf = Buffer.alloc(len);
      const fd = fs.openSync(o.daemonLog, 'r'); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
      const lines = buf.toString('utf8').split('\n').filter((l) => l.includes('signalling re-auth required'));
      const m = lines.length && lines[lines.length - 1].match(/^\[([^\]]+)\]/);
      return !!(m && Date.now() - Date.parse(m[1]) < o.sigWindowMs);
    } catch (_) { return false; }
  }

  function restore() {
    if (off()) return log({ action: 'cred-restore-skip', why: 'OFF' });
    if (!daemonSignalled()) return log({ action: 'cred-restore-skip', why: 'no-daemon-signal' });
    const b = readJson(bakFile);
    if (!(b.ok && usable(b.v))) return log({ action: 'cred-restore-skip', why: 'no-backup' });
    const a = b.v.claudeAiOauth;
    if (a.refreshTokenExpiresAt && Number(a.refreshTokenExpiresAt) < Date.now()) return log({ action: 'cred-restore-skip', why: 'refresh-expired' });
    const t = tag(a);
    const done = readJson(doneFile);
    if (done.ok && done.v && done.v.tag === t && Date.now() - Date.parse(done.v.at) < o.giveUpMs) {
      if (!done.v.gaveUp) { writeSecure(doneFile, Object.assign({}, done.v, { gaveUp: new Date().toISOString() })); log({ action: 'cred-restore-gaveup', why: 'same key was restored and wiped again — needs a real login' }); }
      return;
    }
    const cur = readJson(credFile);
    if (cur.ok && usable(cur.v)) return;   // 그 사이 다른 프로그램이 새 열쇠를 씀 — 덮지 않음
    const obj = Object.assign({}, cur.ok && cur.v && typeof cur.v === 'object' ? cur.v : {}, { claudeAiOauth: a });   // 다른 칸(있으면)은 그대로 두고 열쇠만
    writeSecure(credFile, obj);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeSecure(doneFile, { tag: t, at: new Date().toISOString() });
    lastSeen = t;
    log({ action: 'cred-restore', expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null, savedAt: b.v.savedAt || null });
    if (o.onRestore) { try { o.onRestore(); } catch (_) {} }
  }

  function kick() { clearTimeout(timer); timer = setTimeout(check, 200); }

  function start() {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); } catch (_) {}
    // 파일은 «새로 쓰고 이름 바꾸기» 로 바뀌어 파일 감시가 끊길 수 있다 → 폴더를 보고 이름으로 거른다 + 15초마다 한 번
    try {
      watcher = fs.watch(path.dirname(credFile), (ev, name) => { if (!name || name === path.basename(credFile)) kick(); });
      watcher.on('error', () => {});
    } catch (_) {}
    poller = setInterval(check, o.pollMs);
    check();
    return api;
  }
  function stop() { clearTimeout(timer); clearInterval(poller); if (watcher) try { watcher.close(); } catch (_) {} }
  const api = { start, stop, check, look, restore };
  return api;
}

module.exports = { create };
