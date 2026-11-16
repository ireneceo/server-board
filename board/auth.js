'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.BOARD_AUTH_DIR || path.join(__dirname, 'secrets');
const USERS = path.join(DIR, 'auth-users.json');
const SESS = path.join(DIR, 'auth-sessions.json');

const IDLE_MS = 48 * 3600e3;
const ABS_MS = 7 * 86400e3;           // 처음 로그인부터 7일
const FRESH_MS = 30 * 60e3;           // 최종 컨펌자 중요한 버튼 — 마지막 인증 앱 확인 30분 안
const LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;              // 한 계정 5번 틀리면 15분
const GLOBAL_FAILS = 20, GLOBAL_WIN = 10 * 60e3, GLOBAL_LOCK = 5 * 60e3;   // 모든 계정 합쳐 10분에 20번 → 5분 (통로 때문에 IP 로는 못 가름)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.chmodSync(DIR, 0o700); } catch (_) {} }
function readJson(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('auth: ' + path.basename(f) + ' 을 읽지 못함 —', e.message); return def; }
}
function writeJson(f, obj) {
  ensureDir();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, f);
}
// 파일이 밖에서(비상 복구 명령) 바뀌면 다시 읽는다
const cache = { u: null, uKey: '', s: null, sKey: '' };
const fkey = (f) => { try { const s = fs.statSync(f); return s.ino + ':' + s.mtimeMs + ':' + s.size; } catch (_) { return ''; } };
function users() {
  const k = fkey(USERS);
  if (!cache.u || k !== cache.uKey) { cache.u = readJson(USERS, {}); cache.uKey = k; }
  const u = cache.u; u.users = u.users || {}; u.resets = u.resets || {}; u.global = u.global || [];
  return u;
}
function saveUsers() { writeJson(USERS, cache.u); cache.uKey = fkey(USERS); }
function sessions() {
  const k = fkey(SESS);
  if (!cache.s || k !== cache.sKey) { cache.s = readJson(SESS, {}); cache.sKey = k; }
  cache.s.sessions = cache.s.sessions || {};
  return cache.s;
}
let sessDirtyAt = 0;
function saveSessions(force) {
  if (!force && now() - sessDirtyAt < 5 * 60e3) return;   // «마지막 사용» 만 바뀐 것은 5분에 한 번
  sessDirtyAt = now(); writeJson(SESS, cache.s); cache.sKey = fkey(SESS);
}

// ── 비밀번호
function hashPw(pw, salt) {
  return new Promise((ok, no) => crypto.scrypt(String(pw), salt, 32, SCRYPT, (e, k) => (e ? no(e) : ok(k.toString('hex')))));
}
function pwProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'short';
  if (pw.length > 200) return 'long';
  return null;
}
async function setPassword(id, pw) {
  const u = users();
  const salt = crypto.randomBytes(16).toString('hex');
  const rec = u.users[id] || { id, createdAt: new Date().toISOString() };
  Object.assign(rec, { salt, hash: await hashPw(pw, salt), pwAt: new Date().toISOString(), fails: 0, lockUntil: 0 });
  u.users[id] = rec; saveUsers();
  return rec;
}

// ── 인증 앱 (RFC 6238 · 30초 · 6자리 · SHA1 — 모든 인증 앱이 읽는 기본값)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(s) { let bits = 0, val = 0; const out = []; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(key, counter) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const totpNow = (secret, t) => hotp(b32dec(secret), Math.floor((t || now()) / 30000));
/** 맞으면 쓴 칸 번호 · 틀리면 -1 (앞뒤 한 칸 = ±30초 허용, 같은 칸 다시 쓰기 금지) */
function totpCheck(secret, code, lastStep) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  const key = b32dec(secret), step = Math.floor(now() / 30000);
  for (const d of [0, -1, 1]) {
    const s = step + d;
    if (s <= (lastStep || 0)) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) return s;
  }
  return -1;
}
function newTotpSecret() { return b32enc(crypto.randomBytes(20)); }
function otpauthUri(secret, id, issuer) {
  const lab = encodeURIComponent(issuer + ':' + id);
  return 'otpauth://totp/' + lab + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';
}
function newBackupCodes() {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  return { codes, hashes: codes.map((c) => sha(c.replace(/-/g, ''))) };
}
/** 인증 앱 등록 — 이미 확인된 비밀 키를 사용자에 붙이고 예비 코드를 새로 만든다(한 번만 보여 줌) */
function setTotp(id, secret, step) {
  const u = users(); const rec = u.users[id]; if (!rec) return null;
  const b = newBackupCodes();
  Object.assign(rec, { totp: secret, lastStep: step || 0, backup: b.hashes, totpAt: new Date().toISOString() });
  saveUsers();
  return b.codes;
}

// ── 잠금
// 잠금 칸 — 기본(상황판) · 'gate'(인터넷에 열린 개발 사이트 관문 로그인). 따로 세어, 바깥에서 틀린 시도가 상황판 로그인을 잠그지 못하게
const BK = (b, name) => (b ? b + '_' + name : name);
function globalLocked(b) {
  const u = users(); const t = now();
  u[BK(b, 'global')] = (u[BK(b, 'global')] || []).filter((x) => t - x < GLOBAL_WIN);
  if (u[BK(b, 'globalLockUntil')] && u[BK(b, 'globalLockUntil')] > t) return u[BK(b, 'globalLockUntil')];
  return 0;
}
function noteFail(id, b) {
  const u = users(); const t = now();
  const g = (u[BK(b, 'global')] || []).concat(t).filter((x) => t - x < GLOBAL_WIN);
  u[BK(b, 'global')] = g;
  if (g.length >= GLOBAL_FAILS) { u[BK(b, 'globalLockUntil')] = t + GLOBAL_LOCK; u[BK(b, 'global')] = []; }
  const rec = u.users[id];
  if (rec) { rec[BK(b, 'fails')] = (rec[BK(b, 'fails')] || 0) + 1; if (rec[BK(b, 'fails')] >= LOCK_FAILS) { rec[BK(b, 'lockUntil')] = t + LOCK_MS; rec[BK(b, 'fails')] = 0; } }
  saveUsers();
}

/**
 * 로그인 확인 — { ok, id, totp:true(인증 앱으로 확인함) } 또는 { ok:false, why: 'locked'|'bad'|'totp'|'off', until }
 * needTotp(id) 가 true 인 계정은 인증 앱 코드(또는 예비 코드)도 맞아야 한다.
 */
async function checkLogin(id, pw, code, needTotp, bucket) {
  id = String(id || '').trim().toLowerCase().slice(0, 120);
  const b = bucket === 'gate' ? 'gate' : '';
  const gl = globalLocked(b); if (gl) return { ok: false, why: 'locked', until: gl };
  const u = users(); const rec = u.users[id];
  if (u.recovering) return { ok: false, why: 'off' };   // 비상 복구 중 — 최종 컨펌자가 복구 링크로 다시 설정할 때까지 아무도 못 들어옴
  if (rec && rec[BK(b, 'lockUntil')] > now()) return { ok: false, why: 'locked', until: rec[BK(b, 'lockUntil')] };
  // 없는 계정도 같은 시간이 걸리게(계정 이름 알아내기 막기)
  const h = await hashPw(pw, rec ? rec.salt : 'x'.repeat(32));
  if (!rec || !rec.hash || !crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(rec.hash, 'hex'))) { noteFail(id, b); return { ok: false, why: 'bad' }; }
  let usedTotp = false;
  if (needTotp || rec.totp) {
    if (!rec.totp) return { ok: false, why: 'totp-missing' };
    const r = useSecondFactor(rec, code);
    if (!r) { noteFail(id, b); return { ok: false, why: 'totp' }; }
    usedTotp = true;
  }
  rec[BK(b, 'fails')] = 0; rec[BK(b, 'lockUntil')] = 0; rec.lastLogin = new Date().toISOString(); saveUsers();
  return { ok: true, id, totp: usedTotp };
}
/** 인증 앱 코드 또는 예비 코드 하나 — 맞으면 true (예비 코드는 한 번 쓰면 없어짐) */
function useSecondFactor(rec, code) {
  const c = String(code || '').trim();
  const s = totpCheck(rec.totp, c, rec.lastStep);
  if (s >= 0) { rec.lastStep = s; return true; }
  const bh = sha(c.replace(/[-\s]/g, '').toLowerCase());
  const i = (rec.backup || []).indexOf(bh);
  if (i >= 0) { rec.backup.splice(i, 1); rec.backupUsedAt = new Date().toISOString(); return true; }
  return false;
}
/** 예비 코드 새로 받기 — 지금 인증 앱 숫자(예비 코드는 안 됨)가 맞으면 옛 예비 코드를 모두 없애고 새 10개(한 번만 보여 줌) · 틀리면 null */
function renewBackup(id, code) {
  const u = users(); const rec = u.users[id]; if (!rec || !rec.totp) return null;
  if (globalLocked() || rec.lockUntil > now()) return null;   // 틀린 숫자 맞혀 보기 막기 — reverify 와 같은 잠금
  const s = totpCheck(rec.totp, code, rec.lastStep); if (s < 0) { noteFail(id); return null; }
  const b = newBackupCodes(); rec.lastStep = s; rec.backup = b.hashes; rec.backupAt = new Date().toISOString(); saveUsers();
  return b.codes;
}
/** 이미 로그인한 사람의 인증 앱 다시 확인 (중요한 버튼 전) */
function reverify(sessToken, code) {
  const s = getSession(sessToken); if (!s) return { ok: false, why: 'login' };
  const u = users(); const rec = u.users[s.id];
  if (!rec || !rec.totp) return { ok: false, why: 'totp-missing' };
  if (globalLocked() || rec.lockUntil > now()) return { ok: false, why: 'locked' };
  if (!useSecondFactor(rec, code)) { noteFail(s.id); return { ok: false, why: 'totp' }; }
  saveUsers();
  const live = sessions().sessions[s.key]; if (live) live.totpAt = now();   // getSession 은 사본을 준다 — 저장된 쪽을 고친다
  saveSessions(true);
  return { ok: true };
}

// ── 세션
function createSession(id, via, totp, ua) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  sessions().sessions[sha(token)] = { id, via: String(via || ''), created: t, last: t, totpAt: totp ? t : 0, ua: String(ua || '').slice(0, 120) };
  saveSessions(true);
  return token;
}
/** 살아 있는 세션 { id, via, created, last, totpAt, key } · 없거나 만료면 null */
function getSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const k = sha(token), all = sessions().sessions, s = all[k];
  if (!s) return null;
  const t = now();
  if (t - s.last > IDLE_MS || t - s.created > ABS_MS) { delete all[k]; saveSessions(true); return null; }
  if (t - s.last > 60e3) { s.last = t; saveSessions(false); }
  return Object.assign({ key: k }, s);
}
function dropSession(token) { const all = sessions().sessions, k = sha(token); if (all[k]) { delete all[k]; saveSessions(true); return true; } return false; }
function dropSessionKey(k) { const all = sessions().sessions; if (all[k]) { delete all[k]; saveSessions(true); return true; } return false; }
/** 한 사람(id 없으면 모두)의 세션 모두 끊기 — 끊은 수 */
function dropUserSessions(id) {
  const all = sessions().sessions; let n = 0;
  for (const [k, s] of Object.entries(all)) if (!id || s.id === id) { delete all[k]; n++; }
  if (n) saveSessions(true);
  return n;
}
function listSessions() {
  const t = now(); const out = [];
  for (const [k, s] of Object.entries(sessions().sessions)) if (!(t - s.last > IDLE_MS || t - s.created > ABS_MS)) out.push({ key: k.slice(0, 12), id: s.id, via: s.via, created: new Date(s.created).toISOString(), last: new Date(s.last).toISOString(), ua: s.ua });
  return out;
}
const isFresh = (s) => !!s && now() - (s.totpAt || 0) < FRESH_MS;

// ── 1회용 링크 (팀원 처음 비밀번호 · 최종 컨펌자 비상 복구)
function makeReset(id, kind, ttlMs) {
  const u = users();
  const token = crypto.randomBytes(24).toString('base64url');
  for (const [k, r] of Object.entries(u.resets)) if (r.id === id || r.exp < now()) delete u.resets[k];   // 같은 사람 옛 링크는 무효
  u.resets[sha(token)] = { id, kind, exp: now() + ttlMs };
  saveUsers();
  return token;
}
function peekReset(token) {
  if (!token || typeof token !== 'string' || token.length > 80) return null;
  const r = users().resets[sha(token)];
  return r && r.exp > now() ? r : null;
}
function useReset(token) {
  const u = users(); const k = sha(token); const r = u.resets[k];
  if (!r || r.exp < now()) return null;
  delete u.resets[k]; saveUsers();
  return r;
}

// ── 상태
const hasUser = (id) => !!(users().users[id] && users().users[id].hash);
const hasTotp = (id) => !!(users().users[id] && users().users[id].totp);
function userInfo(id) { const r = users().users[id]; return r ? { id, pwAt: r.pwAt || null, totp: !!r.totp, backupLeft: (r.backup || []).length, lastLogin: r.lastLogin || null, locked: r.lockUntil > now() } : null; }
function recovering() { return !!users().recovering; }
function setRecovering(on) { const u = users(); if (on) u.recovering = new Date().toISOString(); else delete u.recovering; saveUsers(); }
/** 사용자 지우기(팀에서 뺐을 때) — 비밀번호·인증 앱·세션 모두 */
function removeUser(id) { const u = users(); delete u.users[id]; for (const [k, r] of Object.entries(u.resets)) if (r.id === id) delete u.resets[k]; saveUsers(); return dropUserSessions(id); }
/** 인증 앱 빼기(팀원 인증 앱을 끈 서버에서 링크로 다시 설정할 때) — 옛 키·예비 코드가 남아 로그인을 막지 않게 */
function clearTotp(id) { const u = users(); const r = u.users[id]; if (r && (r.totp || r.backup)) { delete r.totp; delete r.backup; delete r.lastStep; saveUsers(); } }
function resetOwnerFactors(id) { const u = users(); const r = u.users[id]; if (r) { delete r.hash; delete r.salt; delete r.totp; delete r.backup; saveUsers(); } }

module.exports = {
  DIR, USERS, SESS, IDLE_MS, ABS_MS, FRESH_MS, LOCK_FAILS, LOCK_MS,
  pwProblem, setPassword, checkLogin, reverify, newTotpSecret, otpauthUri, totpCheck, totpNow, setTotp, renewBackup,
  createSession, getSession, dropSession, dropSessionKey, dropUserSessions, listSessions, isFresh,
  makeReset, peekReset, useReset, hasUser, hasTotp, clearTotp, userInfo, recovering, setRecovering, removeUser, resetOwnerFactors,
  b32enc, b32dec, hotp, sha,
};
