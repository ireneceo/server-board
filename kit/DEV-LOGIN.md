# dev-login — open a "Where to check" link already logged in as a test role

> 한 줄 요약(ko): 작업방 보고의 «확인할 곳» 줄 끝에 `[as=owner ws=6]` 를 붙이면, 상황판이 그 링크 옆에 «시험 계정으로 열기» 버튼을 붙인다. 누르면 그 역할 **시험 계정으로 로그인된 채 같은 주소**가 열린다. 상황판이 90초·1회용 코드를 서명하고, 솔루션 개발 backend 는 그 코드를 검증하는 라우트 하나만 둔다. 운영에서는 라우트가 등록되지 않는다.

## Why

A session finishes work and reports `https://dev.myapp/tasks/12 — check the 3 tasks`. The owner clicks it and sees a login form, or sees the page as *their own* account, in a different workspace, with no data. The point of the link is to show **the same page, as the same role, with the same data** the session checked.

## How it works

```
report line   - https://dev.myapp/tasks/12 — 3 tasks listed [as=owner ws=6]
                                                            └ tag: role key + scope
board         link + button «Open as test owner · ws=6»
click         GET /api/open-as?project=myapp&as=owner&scope=ws%3D6&next=%2Ftasks%2F12   (board, same-origin only)
board         signs code = v1.<payload>.<hmac>   (90 s, single use)
              302 → https://dev.myapp/dev-login#code=v1....   (fragment: never in server logs / Referer)
project page  /dev-login reads the fragment → POST /api/auth/dev-login {code}
project API   verifies → issues the SAME tokens as a normal /login → {..., dev_login:{as, scope, next}}
project page  stores them like a normal login → location.replace(next)
```

The board never calls the project's server. The project needs one route and one page.

## 1. Report tag (rule for sessions)

- At the **end** of a "Where to check" line: `[as=<role key> <name>=<value> ...]`. ASCII brackets. `as` is required; other pairs are the *scope* (workspace, store, …) and are passed through as strings — the project decides what they mean.
- Parser: `/\s*\[((?:\w+=[\w:.\-@]+\s*)+)\]\s*$/`. Values: letters, digits, `_ : . - @`.
- Role keys and scope names are listed in the project's `CLAUDE.md` under **"Test roles"** (table: key → test account → what it can see → scope names).
- Test data shown by such a line is **not deleted** at the end of the session. Name it with `[check]` (`[확인용]`). The project's own cleanup removes `[check]` data older than 7 days. Never create it on real customer data.
- Without the tag the link works as before. With the tag but dev-login off, the board shows "Test account: owner" as text.

## 2. Board side (this kit — already done)

- `projects.json`: `"devLogin": true` on the project. That is the only setting. Turn it on **after** the project route below is live.
- Secret: the board creates `board/secrets/dev-login.<project key>` (mode 600, 64 hex chars) at start-up for every project with a dev URL. Copy the value into the project's **dev** `.env` as `DEV_LOGIN_SECRET`. Never into production. `board/secrets/` is git-ignored and not packed.
- `GET /api/open-as` answers only requests made from the board screen (`Sec-Fetch-Site: same-origin`, or a Referer on the board's own host when the header is missing) — another site can't silently switch your browser to a test account. Each issue is logged (`open-as` · project · role · scope · next).
- 400 when the project is unknown / `devLogin` off / `as` invalid / `next` not a path.

### Code format

```
code    = "v1." + b64url(payloadJSON) + "." + b64url(HMAC_SHA256(key = secret as UTF-8 text, data = the b64url payload string))
payload = {"as":"owner","scope":{"ws":"6"},"next":"/tasks/12","exp":<epoch ms, issue + 90000>,"n":"<32 hex nonce>"}
```

b64url = base64 with `-` `_` and no `=` padding.

## 3. Project side (each project implements)

### Backend — `POST /api/auth/dev-login` body `{"code":"v1...."}`

Register the route **only if** all of these hold (reference: `kit/dev-login/verify.js` → `devLoginEnabled()`):
1. `NODE_ENV === 'development'` (strict).
2. `DEV_LOGIN_SECRET` is at least 32 characters.
3. Otherwise do not register (404 = off). If production has a secret, log a warning at start-up; do not crash. Add a deploy-guard check: production `.env` must not contain `DEV_LOGIN_SECRET`.

Verify (reference `verifyDevLoginCode(code)`): format → HMAC constant-time compare → `exp` → nonce not seen before (kept 10 min) → `next` matches `^/(?!/)`, ≤ 1024 chars. Then:

- **Role → account**: a fixed map in code, e.g. `{owner:'owner@test.myapp', member:'member1@test.myapp'}`. Unknown key → `unknown_role`. Never accept an email from the code.
- **Second gate**: the account must be flagged as a test account (`is_test` / `is_demo`, or a test-only e-mail domain) **and** must not reach real customer data. Fail → `not_test_account`.
- **Scope**: check the account really belongs to the requested workspace/store, then make it the active one the same way the normal app does. Fail → `scope_not_allowed`.
- **Issue the same tokens as the normal `/login`** (same body; same refresh cookie if the app uses one). Not an impersonation token.

| status | body |
|---|---|
| 200 | the normal login response + `"dev_login":{"as":"owner","scope":{"ws":"6"},"next":"/tasks/12"}` |
| 400 | `{"error":"invalid_code"}` (format · signature · expired) · `unknown_role` · `bad_next` |
| 409 | `{"error":"code_used"}` |
| 403 | `{"error":"not_test_account"}` · `{"error":"scope_not_allowed"}` |
| 404 | route not registered = dev-login off |

```js
// Express example (dev backend)
const { devLoginEnabled, verifyDevLoginCode } = require('./devLogin/verify');   // copy of kit/dev-login/verify.js
const ROLE_ACCOUNTS = { owner: 'owner@test.myapp', member: 'member1@test.myapp' };
if (devLoginEnabled()) {
  router.post('/auth/dev-login', async (req, res) => {
    const v = verifyDevLoginCode(req.body && req.body.code);
    if (!v.ok) return res.status(v.status).json({ error: v.error });
    const email = ROLE_ACCOUNTS[v.as];
    if (!email) return res.status(400).json({ error: 'unknown_role' });
    const user = await User.findOne({ where: { email } });
    if (!user || !user.is_test) return res.status(403).json({ error: 'not_test_account' });
    if (v.scope.ws && !(await canUseWorkspace(user, v.scope.ws))) return res.status(403).json({ error: 'scope_not_allowed' });
    if (v.scope.ws) await setActiveWorkspace(user, v.scope.ws);
    const body = await issueNormalLogin(user, res);        // the same function /login uses (sets refresh cookie if any)
    res.json({ ...body, dev_login: { as: v.as, scope: v.scope, next: v.next } });
  });
}
```

### Frontend — page `/dev-login`

Only on the dev host (otherwise 404 / redirect to `/`). Use `next` from the **response**, never from the URL.

```js
// /dev-login
const code = new URLSearchParams(location.hash.slice(1)).get('code');
history.replaceState(null, '', location.pathname);               // drop the code from the address bar
show(`Signing in as the test account — your own login on this site will be replaced`);
const r = await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
const j = await r.json().catch(() => ({}));
if (!r.ok) return show(`Could not sign in (${j.error || r.status}) — <a href="/login">normal login</a>`);
saveLoginLikeNormal(j);                                          // same storage as the normal login flow
location.replace(j.dev_login.next);
```

A small "viewing as test owner" strip at the top of the app is nice to have, not required.

## 4. Turning it on for a project — checklist

1. Project `CLAUDE.md`: add the **"Test roles"** table (key → account → sees → scope names) and the `[check]` 7-day cleanup in the project's existing cleanup routine.
2. Test accounts exist for every role key, flagged as test, attached only to demo data.
3. Dev `.env`: `DEV_LOGIN_SECRET=<board/secrets/dev-login.<key>>`. Production `.env`: none — add the deploy-guard check.
4. Route + page as above. Test: valid code → logged in at `next` · same code again → 409 · expired / tampered → 400 · unknown role → 400 · production build/env → 404.
5. Then set `"devLogin": true` in `projects.json` (ask the server session) — the button appears.
