# Security

Server Board is a page that **starts AI agents on your server**. Treat access to it like SSH access.

## Design

- Listens on `127.0.0.1` only. Not reachable from the network.
- Every request must have `Host: localhost:<port>` or `127.0.0.1:<port>` (or this server's own Tailscale name, when you turn that on). Write requests must also send a matching `Origin` and `Content-Type: application/json` (blocks DNS-rebinding and cross-site requests). Otherwise: 403 / 415.
- Commands are started with `execFile` (no shell) and fixed arguments.
- When a task is queued, the board makes one small `claude -p --model haiku` call to write a short room title. This uses a little of your Anthropic usage.

## Personal sign-in (server-wide · since 2026-10)

- **Everyone signs in with their own ID and password.** The SSH tunnel and Tailscale are only *routes* into the board — never identity. Coming in as `root`, through Tailscale, or from a server without `/proc` no longer makes anyone the owner.
- **Roles** (set per person in ⚙ Team & roles): *final approver* (owner — every project and button), *member* and *designer* (assigned projects only; tasks go in as proposals), *viewer* (look only). The account that runs the board is always the final approver. Role changes and «off» apply from the next request; removing a person deletes their password and sessions.
- **The final approver also uses an authenticator app** (TOTP, 6 digits, works with any standard app) and gets 10 single-use backup codes. **Members, designers and viewers register their own authenticator too** when they open their sign-in link (setting «Members also use an authenticator», on by default; turning it off never removes an app someone already registered). Each server is registered separately; the app entry is named «Server Board · <server name>». Important buttons (deploy, settings, team, deletes, scheduled checks) ask for the code again when the last check is older than 30 minutes.
- **Stored:** passwords as salted `scrypt` hashes, sessions as hashes of random tokens, in `board/secrets/auth-users.json` and `auth-sessions.json` (mode 600, folder 700, git-ignored). Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS. Sessions end after 12 h idle or 7 days.
- **Limits:** 5 wrong tries lock an account for 15 minutes; 20 wrong tries across all accounts in 10 minutes lock sign-in for 5 minutes (everyone arrives from 127.0.0.1, so addresses can't be told apart).
- **Second checks on the route:** a session is dropped if its cookie shows up on a different person's route (another server account's tunnel, another Tailscale login), or from an AI session.
- **First setup:** while the final approver has no password, only a browser opened through the board account's own SSH tunnel sees the setup screen. After that this path closes for good.
- **Emergency recovery (server terminal only):** `dev recover` signs everyone out, closes sign-in for everyone, and prints a 10-minute single-use link to set the final approver's password and authenticator again. It refuses to run without a typed terminal (TTY) or inside an AI session. It edits the files directly, so it works while the board is stopped.
- **One exception — the server terminal:** a command typed in an SSH shell of the board account (for example the `dev` menu) is treated as the final approver. That shell can already change everything this account owns.

### What this does not stop (be clear about it)

- **AI sessions run as the same OS account as the board** unless you separate accounts (a later setup step). Until then the AI *can* read and edit the board's files — including the sign-in files and the board's own code — and restart it. Sign-in stops people from mixing up and stops the AI from pressing owner buttons *through the board*, and every change leaves a trace in `board/log/` and git; it is **not a wall against the AI itself**. Rule-based checks (refusing recovery inside an AI session, the AI-session detector) are rules, not OS permissions.
- Anyone with this account's SSH key is, in effect, the final approver (they get the terminal exception above).
- The **dev-site sign-in gate** is optional and off until you install it (`kit/board-gate-install.sh`, run by the server admin with sudo) and switch it on per project. Once installed, nginx forwards only `/__gate/*` to the board, and only connections from the nginx user are accepted there. The gate's sign-in page is reachable from the internet **only for projects whose gate is on**. Gate sign-in has its own lockout counters (5 wrong tries → 15 min per account, 20 per 10 min overall), so failed attempts from outside cannot lock you out of the board itself. Use a strong password and the authenticator app. To remove the gate, run `kit/board-gate-uninstall.sh`.

## What is stored

- `board/state.json` and `board/log/` keep queue state and a click log (who did what); `board/secrets/` holds the sign-in files, per-project dev-login signing keys and similar; `board/config.json` holds this server's settings, including the web-push key pair. All stay on the server, git-ignored. Only the account running the board can read them.
- **Login-key guard** (on by default): `~/.claude-cred-guard/credentials.json` (folder 0700, file 0600) keeps a copy of Claude Code's own sign-in file (`~/.claude/.credentials.json`, which holds OAuth access and refresh tokens). It exists because Claude Code's background manager can empty that file after one failed refresh. The guard puts the last good copy back only when the file is empty, the refresh token has not expired, and no restore of the same key happened in the last 10 minutes. It never overwrites a working key, never sends anything over the network, and logs only the expiry time and a short tag, never the key. Turn it off with `touch ~/.claude-cred-guard/OFF`; turn off the related "key window" wait with `touch ~/.claude-cred-guard/KEYWIN-OFF`. After a deliberate `claude auth logout`, the guard does not restore anything, but the copy stays: delete it with `rm -rf ~/.claude-cred-guard` if you want it gone.

## install.sh

- No sudo, no root. It installs only after you answer **yes** (Node via nvm, PM2 and Claude Code via npm, from their official sources, shown before you answer).
- Run as `root`, it stops and offers to create a dedicated account (no password, not in the sudo group, root's SSH keys copied) and continues as that account. Without a keyboard it refuses (exit 5) unless `SB_AS_ROOT=1`.
- It changes `~/.claude/settings.json` (`permissions.defaultMode=auto`, `worktree.bgIsolation=none`) **only on an explicit yes**, after copying it to `settings.json.bak-YYYYMMDD`, and never in `SB_YES=1` / non-interactive mode. Read Claude Code's permission documentation before saying yes.
- It never overwrites `~/dev-server` if that folder holds something else, keeps your settings on a re-run, and sends nothing anywhere (no telemetry).
- Prefer to read it first: `curl -fsSLo install.sh … && less install.sh && bash install.sh`.
- The board's **Finish setup with AI** button only starts a Claude Code session in `~/dev-server` with the setup prompt. It needs Claude logged in and the two permission settings, and it never changes settings itself.

## Do

- Open it only through an SSH tunnel (`ssh -L 8800:127.0.0.1:8800 …`).
- Other local users on the same machine can reach `127.0.0.1` ports — they still have to sign in, and only people you add in ⚙ Team & roles can.
- Run `bash kit/verify.sh` after installing and after Claude Code updates. It checks the Host/Origin refusals, the 127.0.0.1-only binding and the sign-in files' permissions.
- Keep Claude Code's own permission checks on. With `defaultMode: auto`, Claude Code decides which actions run without asking. Read Claude Code's permission documentation and decide whether that fits your server.

## Don't

- Don't proxy the board itself through nginx/Caddy/Cloudflare or bind it to `0.0.0.0`. (The optional dev-site gate forwards only `/__gate/*`, only from the nginx user — that is the one exception, see above.)
- Don't share the tunnel URL, your private SSH key, your password or your backup codes.
- Don't run it as `root`.

## Reporting a vulnerability

Please **don't** open a public issue. Email **help@wor-pro.com** with "Server Board security" in the subject, steps to reproduce and the affected version/commit. We aim to reply within a few business days.
