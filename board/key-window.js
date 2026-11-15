'use strict';
// AI 열쇠 갱신 창 지킴이
//
//
// 그래서: 만료 OPEN_MS(6분) 전부터 갱신이 끝날 때까지 상황판은 짧은 claude 명령을 미루고(방 목록은 직전 결과로),
//   갱신은 «끝까지 기다리는» 명령 하나(가벼운 모델 한 마디 `claude -p ping` — 대답을 받으려면 갱신을 끝내고 저장해야 함)만 REFRESH_MS(4.5분) 전에 띄운다.
//   `claude -p`(실제 대답을 받는 명령)은 갱신을 끝까지 하므로 미루지 않는다. 열쇠 내용은 안 읽어 내보내지 않는다(만료 시각·갱신 열쇠 있음만).
//   1년 열쇠(CLAUDE_CODE_OAUTH_TOKEN)를 쓰는 중이면 갱신이 없으니 아무것도 안 함. 끄기: ~/.claude-cred-guard/KEYWIN-OFF
const fs = require('fs');
const path = require('path');

function create(opts) {
  const o = Object.assign({ openMs: 6 * 60e3, refreshMs: 4.5 * 60e3, retryMs: 60e3, maxTries: 3, slowRetryMs: 5 * 60e3, maxClosedMs: 30 * 60e3, waitMaxMs: 90e3, tickMs: 5e3,
    now: () => Date.now(), longKey: () => !!process.env.CLAUDE_CODE_OAUTH_TOKEN, log: () => {} }, opts || {});
  const credFile = o.credFile, offFile = o.offFile || path.join(path.dirname(credFile), '..', '.claude-cred-guard', 'KEYWIN-OFF');
  let waiting = [], refreshing = false, tries = 0, lastTry = 0, closedSince = 0, gaveUpExp = null, timer = null, lastExp = null;

  function read() {
    try {
      const a = (JSON.parse(fs.readFileSync(credFile, 'utf8')) || {}).claudeAiOauth || {};
      return { exp: Number(a.expiresAt) || 0, refresh: typeof a.refreshToken === 'string' && a.refreshToken.length > 20 };
    } catch (_) { return { exp: 0, refresh: false }; }
  }
  /** 지금 짧은 claude 명령을 미뤄야 하나 */
  function closed() {
    if (o.longKey() || fs.existsSync(offFile)) return false;
    const r = read();
    if (!r.refresh || !r.exp) return false;              // 로그인 없음·빈 파일 — 지킬 갱신 열쇠가 없다
    if (gaveUpExp === r.exp) return false;               // 이 열쇠로 몇 번 해도 안 됨 — 더 막지 않는다(상황판 «다시 로그인» 으로)
    return r.exp - o.now() <= o.openMs;
  }
  function flush() { const w = waiting; waiting = []; for (const e of w) { try { e.fn(); } catch (_) {} } }
  function expire(t) { const late = waiting.filter((e) => t - e.at > o.waitMaxMs); if (!late.length) return; waiting = waiting.filter((e) => !late.includes(e)); for (const e of late) { try { e.onLate && e.onLate(); } catch (_) {} } }
  /** fn 을 창이 열려 있으면 바로, 닫혀 있으면 갱신이 끝난 뒤(waitMaxMs 넘으면 onLate) */
  function wait(fn, onLate) { if (!closed()) return fn(); waiting.push({ fn, onLate, at: o.now() }); ensureTick(); }

  function tick() {
    const r = read(), t = o.now();
    if (lastExp !== null && r.exp !== lastExp) { tries = 0; if (gaveUpExp !== null && gaveUpExp !== r.exp) gaveUpExp = null; }
    lastExp = r.exp;
    if (!closed()) { if (closedSince) { o.log({ action: 'key-window-open', waited: waiting.length, ms: t - closedSince, expiresAt: r.exp ? new Date(r.exp).toISOString() : null }); closedSince = 0; } flush(); return; }
    expire(t);
    if (!closedSince) { closedSince = t; o.log({ action: 'key-window-closed', expiresAt: new Date(r.exp).toISOString() }); }
    if (t - closedSince > o.maxClosedMs) { gaveUpExp = r.exp; o.log({ action: 'key-window-giveup', why: 'closed too long', tries }); closedSince = 0; flush(); return; }
    if (refreshing || r.exp - t > o.refreshMs || t - lastTry < (tries >= o.maxTries ? o.slowRetryMs : o.retryMs)) return;   // 3번 안 되면 5분마다(포기는 30분 닫힘 뒤에만 — 만료 직전에 한꺼번에 풀면 같은 고장)
    refreshing = true; lastTry = t; tries++;
    const before = r.exp, t0 = o.now();
    o.refresh(tries, (err) => {
      refreshing = false;
      const a = read();
      o.log({ action: 'key-refresh', try: tries, ok: a.exp > before, wiped: !a.refresh, ms: o.now() - t0, err: err ? String(err).slice(0, 120) : null, expiresAt: a.exp ? new Date(a.exp).toISOString() : null });
      tick();
    });
  }
  function ensureTick() { if (!timer) { timer = setInterval(tick, o.tickMs); if (timer.unref) timer.unref(); } }
  return { closed, wait, tick, read, start() { ensureTick(); return this; }, stop() { if (timer) clearInterval(timer); timer = null; }, pending: () => waiting.length };
}

module.exports = { create };
