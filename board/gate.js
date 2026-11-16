'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let H = null;   // init 으로 받는 상황판 쪽 함수들
// 페이지 하나가 그림·스크립트 수십 개를 부르고 그때마다 판정한다 — 파일은 2초 동안 다시 안 읽음(고친 설정은 2초 안에 적용)
const memo = new Map();
function cached(k, fn) { const m = memo.get(k); if (m && Date.now() - m.at < 2000) return m.v; const v = fn(); memo.set(k, { at: Date.now(), v }); return v; }
const SECRETS = () => H.secretsDir;
const COOKIE = 'sb_gate';
const MAX_AGE = 30 * 86400;
const ALWAYS = ['/.well-known/acme-challenge/'];   // 인증서 갱신 — 끄지 못함
// 링크 미리보기 봇 예외(ua:)는 화면 주소만 — 이름(User-Agent)은 누구나 꾸밀 수 있어서 자료 주소는 절대 안 엶
const DATA_PATHS = ['/api/', '/socket.io/', '/agent/', '/uploads/', '/audio/', '/__gate/'];
const SHARE_BOTS = 'facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|SkypeUriPreview|TelegramBot|WhatsApp|Kakaotalk-scrap|Discordbot|Pinterest|Embedly|Applebot|Mastodon|redditbot';
const DEFAULT_EXCEPT = {};

function secretFile(name, bytes) {
  const f = path.join(SECRETS(), name);
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (v.length >= 32) return v; } catch (_) {}
  fs.mkdirSync(SECRETS(), { recursive: true, mode: 0o700 });
  const v = crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(f, v + '\n', { mode: 0o600 });
  return v;
}
const key = () => cached('key', () => secretFile('gate-key', 32));
/** 서버 안 자동 시험(e2e) 표식 — 머리글 X-Board-Gate-Test 에 이 값. 파일은 상황판 실행 계정만 읽음 */
const testToken = () => cached('test', () => secretFile('gate-test-token', 24));

// ── 설정 (config.json «gate») — 솔루션마다 { on, except:[...] }
function cfgPath() { return path.join(H.boardDir, 'config.json'); }
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch (_) { return {}; } }
function normProj(key, g) {
  g = g && typeof g === 'object' ? g : {};
  const ex = Array.isArray(g.except) ? g.except : DEFAULT_EXCEPT[key] || [];
  return { on: g.on === true, except: ex.map((x) => String(x).trim()).filter((x) => x && x.length < 400 && (x.startsWith('/') || /^ua:/.test(x))).slice(0, 60) };
}
function settings() { return cached('settings', settings0); }
function settings0() {
  const g = readCfg().gate || {};
  const out = {};
  for (const p of H.loadProjects()) if (p.devUrl && /^https:\/\//.test(p.devUrl)) out[p.key] = normProj(p.key, (g.projects || {})[p.key]);
  return out;
}
function saveSettings(projects) {
  const cur = readCfg();
  const keys = new Set(H.loadProjects().filter((p) => p.devUrl && /^https:\/\//.test(p.devUrl)).map((p) => p.key));
  const next = {};
  for (const [k, v] of Object.entries(projects || {})) if (keys.has(k)) next[k] = normProj(k, v);
  cur.gate = { projects: next };
  memo.clear();
  const f = cfgPath();
  fs.writeFileSync(f + '.tmp', JSON.stringify(cur, null, 2) + '\n'); fs.renameSync(f + '.tmp', f);
  return next;
}
function projectOfHost(host) {
  host = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return cached('projects', H.loadProjects).find((p) => { try { return p.devUrl && new URL(p.devUrl).hostname.toLowerCase() === host; } catch (_) { return false; } }) || null;
}

// ── 쿠키 — 아이디·도메인·끝나는 때·세대(접속 끊기·끄기·빼기 때 올림)
function genState() { return cached('gen', genState0); }
function genState0() { try { return JSON.parse(fs.readFileSync(path.join(SECRETS(), 'gate-gen.json'), 'utf8')); } catch (_) { return {}; } }
function gen(id) { return Number(genState()[id] || 0); }
/** 이 사람의 관문 쿠키를 모두 무효로 */
function bump(id) {
  const s = genState(); s[id] = Number(s[id] || 0) + 1;
  const f = path.join(SECRETS(), 'gate-gen.json');
  fs.mkdirSync(SECRETS(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f + '.tmp', JSON.stringify(s) + '\n', { mode: 0o600 }); fs.renameSync(f + '.tmp', f);
  memo.delete('gen');
}
const b64 = (s) => Buffer.from(s).toString('base64url');
function sign(id, host) {
  const body = b64(JSON.stringify({ u: id, h: host, e: Date.now() + MAX_AGE * 1000, g: gen(id) }));
  return body + '.' + crypto.createHmac('sha256', key()).update(body).digest('base64url');
}
function verify(tok, host) {
  const [body, mac] = String(tok || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let o; try { o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!o || o.h !== host || !(o.e > Date.now()) || o.g !== gen(o.u)) return null;
  return o.u;
}
function cookieOf(req) { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)sb_gate=([^;]+)/); return m ? m[1] : ''; }

/**
 * 판정 — 순수 함수(시험이 따로 부름). 돌려줌 { ok, why }
 *   why: off(관문 끔) · always · except · bot · test · user:<아이디> · login(로그인 필요) · scope(맡은 솔루션 아님) · unknown-host
 */
function decide({ host, uri, ua, testHdr, cookie }) {
  const proj = projectOfHost(host);
  if (!proj) return { ok: false, why: 'unknown-host' };
  const s = settings()[proj.key];
  if (!s || !s.on) return { ok: true, why: 'off', proj };
  const p = String(uri || '/').split('?')[0];
  if (ALWAYS.some((x) => p.startsWith(x))) return { ok: true, why: 'always', proj };
  for (const x of s.except) {
    if (x.startsWith('/') && p.startsWith(x)) return { ok: true, why: 'except', proj };
    if (x.startsWith('ua:') && ua && !DATA_PATHS.some((d) => p.startsWith(d))) { try { if (new RegExp(x.slice(3), 'i').test(ua)) return { ok: true, why: 'bot', proj }; } catch (_) {} }
  }
  if (testHdr) { const t = testToken(); if (testHdr.length === t.length && crypto.timingSafeEqual(Buffer.from(testHdr), Buffer.from(t))) return { ok: true, why: 'test', proj }; }
  const id = verify(cookie, String(host).toLowerCase().replace(/:\d+$/, ''));
  if (!id) return { ok: false, why: 'login', proj };
  const who = H.personOf(id);
  if (!who) return { ok: false, why: 'login', proj };
  if (!H.canSee(who, proj.key)) return { ok: false, why: 'scope', proj };
  return { ok: true, why: 'user:' + id, proj };
}

// ── /__gate/* — nginx 가 넘겨 준 것만
const isNginx = (sock) => sock.kind === 'other' && sock.user === H.nginxUser;
const LOGIN_WHY = () => ({
  bad: H.K('아이디나 비밀번호가 맞지 않아요', 'Wrong ID or password'), totp: H.K('인증 앱 코드가 맞지 않아요', 'The authenticator code is wrong'),
  locked: H.K('여러 번 틀려 잠시 막혔어요 — 15분 뒤 다시', 'Too many tries — try again in 15 minutes'), off: H.K('비상 복구 중이라 로그인이 막혀 있어요', 'Sign-in is closed during emergency recovery'),
  scope: H.K('이 계정은 이 솔루션을 맡지 않았어요 — 최종 컨펌자에게 물어보세요', 'This account is not assigned to this project — ask the final approver'),
  'totp-missing': H.K('인증 앱이 등록되지 않았어요 — 상황판 최종 컨펌자에게 새 로그인 링크를 받으세요', 'No authenticator registered — ask the board\'s final approver for a new sign-in link'),
});
function safeNext(n) { n = String(n || '/'); return /^\/(?!\/)[^\s\\]*$/.test(n) && !n.startsWith('/__gate/') && n.length < 2000 ? n : '/'; }
async function handle(req, res, url, sock, body) {
  const send = (code, obj, head) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, head || {})); res.end(JSON.stringify(obj)); };
  if (!isNginx(sock)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('gate: nginx only'); }
  const host = String(req.headers['x-gate-host'] || '').toLowerCase();
  if (url === '/__gate/check') {
    const r = decide({ host, uri: req.headers['x-gate-uri'], ua: req.headers['user-agent'], testHdr: String(req.headers['x-board-gate-test'] || ''), cookie: cookieOf(req) });
    res.writeHead(r.ok ? 204 : r.why === 'scope' ? 403 : 401, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  const proj = projectOfHost(host);
  if (!proj) { res.writeHead(404); return res.end(); }
  const gs = settings()[proj.key];
  if (!gs || !gs.on) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
  if (url === '/__gate/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    return res.end(loginPage(proj));
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  // 쓰기는 그 개발 사이트 화면에서 보낸 것만(Origin = https://<그 도메인>) + JSON
  if (String(req.headers.origin || '') !== 'https://' + host) return send(403, { ok: false, message: 'bad origin' });
  if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) return send(415, { ok: false });
  if (url === '/__gate/logout') { H.writeLog({ action: 'gate-logout', project: proj.key }); return send(200, { ok: true }, { 'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }); }
  if (url === '/__gate/login') {
    const id = String(body.id || '').trim().toLowerCase();
    const p = H.personOf(id);
    const r = await H.auth.checkLogin(p ? id : '\u0000' + id, String(body.password || ''), body.code, H.needTotpFor ? H.needTotpFor(p) : !!p && p.role === 'owner', 'gate');   // 잠금은 따로 셈(상황판 로그인을 못 잠그게)
    if (!r.ok) { H.writeLog({ action: 'gate-login-fail', project: proj.key, user: id.slice(0, 60), why: r.why }); return send(r.why === 'locked' ? 429 : 401, { ok: false, message: LOGIN_WHY()[r.why] || LOGIN_WHY().bad }); }
    if (!H.canSee(p, proj.key)) { H.writeLog({ action: 'gate-login-fail', project: proj.key, user: id, why: 'scope' }); return send(403, { ok: false, message: LOGIN_WHY().scope }); }
    H.writeLog({ action: 'gate-login', project: proj.key, by: p.role + ':' + id, totp: r.totp });
    return send(200, { ok: true, next: safeNext(body.next) }, { 'Set-Cookie': COOKIE + '=' + sign(id, host) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + MAX_AGE });
  }
  res.writeHead(404); return res.end();
}
function loginPage(proj) {
  const K = H.K, T = (ko, en) => JSON.stringify(K(ko, en));
  return '<!doctype html><html lang="' + K('ko', 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>' + K('개발 사이트 로그인', 'Dev site sign-in') + '</title>'
    + '<style>:root{--bg:#f6f6fb;--card:#fff;--fg:#1a1a1a;--mut:#666;--acc:#635BFF;--bad:#c62828;--line:#ddd}@media(prefers-color-scheme:dark){:root{--bg:#111;--card:#1c1c22;--fg:#eee;--mut:#aaa;--acc:#9b95ff;--bad:#ff8a80;--line:#333}}'
    + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,system-ui,"Apple SD Gothic Neo",sans-serif;padding:24px 16px}main{max-width:420px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}'
    + 'h1{font-size:20px;margin:0 0 4px}label{display:block;margin:14px 0 4px;font-weight:600;font-size:14px}input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}'
    + 'button{width:100%;margin-top:18px;font:inherit;font-weight:700;padding:11px;border:0;border-radius:8px;background:var(--acc);color:#fff;cursor:pointer}button:disabled{opacity:.5}.mut{color:var(--mut);font-size:14px}.err{color:var(--bad);font-weight:600;min-height:1.4em}</style></head><body><main>'
    + '<h1>' + K('개발 사이트 — 로그인', 'Development site — sign in') + '</h1><p class="mut">' + String(proj.name || proj.key).replace(/[<>&"]/g, '') + K(' 개발 사이트는 팀만 볼 수 있어요. 상황판 아이디·비밀번호로 한 번 로그인하면 이 기기에서 30일 동안 열려요.', ' development site is for the team only. Sign in once with your board ID and password; this device stays signed in for 30 days.') + '</p>'
    + '<form id=f><label for=i>' + K('아이디', 'ID') + '</label><input id=i autocomplete=username autocapitalize=none required>'
    + '<label for=p>' + K('비밀번호', 'Password') + '</label><input id=p type=password autocomplete=current-password required>'
    + '<label for=c>' + K('인증 앱 6자리 (등록한 사람) — 휴대폰이 없으면 예비 코드 하나', 'Authenticator 6 digits (if registered) — no phone? one backup code') + '</label><input id=c autocomplete=one-time-code autocapitalize=none spellcheck=false>'
    + '<p class=err id=e></p><button id=b>' + K('로그인', 'Sign in') + '</button></form></main><script>'
    + '(function(){var f=document.getElementById("f"),e=document.getElementById("e"),b=document.getElementById("b"),n=new URLSearchParams(location.search).get("next")||"/";'
    + 'f.onsubmit=function(ev){ev.preventDefault();b.disabled=true;e.textContent="";fetch("/__gate/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:document.getElementById("i").value,password:document.getElementById("p").value,code:document.getElementById("c").value,next:n})})'
    + '.then(function(r){return r.json();}).then(function(j){if(j.ok){location.replace(j.next||"/");return;}b.disabled=false;e.textContent=j.message||' + T('실패', 'Failed') + ';},function(){b.disabled=false;e.textContent="network";});};})();</script></body></html>';
}

function nginxSnippet(port) {
  return [
    '# 상황판 개발 사이트 로그인 관문 — 각 개발 사이트 server { } 안에서 include (서버 단위 · 한 번)',
    '# 켬/끔·예외는 상황판 ⚙ 에서. 상황판이 꺼지면 막힘. 비상 우회: 이 include 줄을 주석 처리하고 nginx -t && systemctl reload nginx',
    'auth_request /__gate/check;',
    'error_page 401 = @board_gate_login;',
    'location = /__gate/check {',
    '    internal;',
    '    proxy_pass http://127.0.0.1:' + port + '/__gate/check;',
    '    proxy_pass_request_body off;',
    '    proxy_set_header Content-Length "";',
    '    proxy_set_header Host localhost:' + port + ';',
    '    proxy_set_header X-Gate-Host $host;',
    '    proxy_set_header X-Gate-Uri $request_uri;',
    '}',
    'location ^~ /__gate/ {',
    '    auth_request off;',
    '    proxy_pass http://127.0.0.1:' + port + ';',
    '    proxy_set_header Host localhost:' + port + ';',
    '    proxy_set_header X-Gate-Host $host;',
    '}',
    'location @board_gate_login {',
    '    return 302 /__gate/login?next=$request_uri;',
    '}',
  ].join('\n') + '\n';
}

function init(h) { H = h; try { key(); testToken(); } catch (_) {} }   // 켜질 때 열쇠·시험 표식 파일을 만들어 둔다(솔루션 시험이 읽음)
module.exports = { init, handle, decide, settings, saveSettings, bump, testToken, nginxSnippet, verify, sign, DEFAULT_EXCEPT, ALWAYS, DATA_PATHS, COOKIE };
