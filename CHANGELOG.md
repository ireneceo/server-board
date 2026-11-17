# Changelog

## [0.3.0]
**Board**
- **📎 Attachments** in "New task" and "💬 Ask the AI": add photos and files with the button, paste a screenshot, or drag and drop (25MB per file, up to 8 per send; only an allow-list of photo, document, text, archive and video types — programs such as .exe are refused). Files are stored per project in `<project>/.claude/attach-tmp/<date>/` (its own `.gitignore` is `*`, so nothing enters git). Only the owner or a member assigned to that project can upload; AI sessions and viewers cannot
- A task with attachments ends with their paths and a note: the session copies only files still needed after the task into a fitting project folder and says where in its report; reference-only files are left alone
- In 💬 chats, real images (checked by their first bytes, ≤3.5MB, 12MB per message) go straight to the model; other files are read by path, small text files are fenced as data
- Hourly cleanup: attachments are deleted `attachKeepDays` days after upload (`board/config.json`, default 7, 1–90), unsent ones after a day; files still referenced by the queue, a proposal or an open chat are kept
- "New task": attachments and "notify me about this task" share one line

## [0.2.0]
**Board**
- **Inquiries box tells you what to do:** each line gets a plain "👉 To do" (send a reply · read and decide · nothing to do) and the header counts them separately. Lines with a draft get **Copy draft** and an owner-only **Have the session send it**: it queues "send this exact draft" for that project's session, which must use the project's established reply path (dry-run first), leave the status alone, and stop and ask if a fact in the draft is not true, the customer wrote again, or no reply path exists. The same draft is never queued twice; a changed draft can be handed over again
- **Team members use their own authenticator app** (⚙ Team, on by default): sign-in link → password + own app (QR, 6 digits) + 10 backup codes; members who only have a password are asked to get a new link; lost phone = new link (old key, codes and sessions stop working)
- `serverName` in `board/config.json`: authenticator entries read "Server Board · <serverName>", so several servers no longer show identical entries
- "Already done" queue cards compare the fix time with the last production deploy (`prodMarker`): if the fix is newer, the card says it is not in production yet and to deploy first
- Owner action cards (`"act":true`) label link buttons with the site name; a to-do posted by the same session for the same work replaces its in-room action card
- Memory slots: slotted jobs run with `oom_score_adj` 500 so an out-of-memory killer picks the build, not system services

**Docs**
- New **[docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md)** (EN/KO): what differs per server and where it lives, every `projects.json` field, how sessions fill the inquiries box, what to post to the board, and a "the board shows X → do Y" table. Server and project `CLAUDE.md` templates and the dev-start command point to it
- Project settings template: new `Reply path` line (used by "Have the session send it")

## [0.1.0] — first public release
**Board**
- Rooms per project, "needs you now" box, chat view with replies, queue (one editing room per project), auto-resume, schedules, pause, deploy/dev-done buttons with confirmation
- Owner to-dos split from questions: `POST /api/todos` (steps · links · commands · `then`, optional `after` date / `waitFor` card) → "For <owner> to do" box; **Done** sends `then` to the same room (or a new queued task); stale or duplicate cards are re-checked
- Queue: add a note to a waiting task · pre-start check that skips work already done (evidence times shown in your timezone) · hand-pressed «Run now» starts even while the Claude usage limit is active
- Sessions opened in a terminal with `claude --resume` are recognised — the board never opens the same conversation again in the background
- AI login status on the board (subscription or API key); when it expires, sessions stopped by it are marked, you can log in again from the board (paste the code), and they resume by themselves once connected
- **Claude Code self-check:** whenever the Claude Code version changes, the board re-checks the Claude Code formats it relies on (commands, session list fields, session state and conversation files, `auth status`) and runs its self-tests; a failure shows a red box at the top and sends one phone alert
- Personal sign-in: password + authenticator app (TOTP) + one-time backup codes, lockouts, sessions; team roles (owner · member · viewer) with a permission table — AI sessions can only post questions, to-dos and queued tasks
- "Open as test role" for "Where to check" links: `[as=<role> <scope>=<id>]` tag → board button → signed 90-second single-use code → the project's dev-only `POST /api/auth/dev-login` (contract and reference verifier in `kit/DEV-LOGIN.md`, `kit/dev-login/verify.js`)
- English and Korean UI (`lang` in `board/config.json`), configurable timezone · AI sessions report in any language (`aiLang`, e.g. 日本語 · Español · Deutsch)
- Built-in "Open this board on another device" guide (Mac · Windows · Linux · iPhone · Android) filled with your server address; the board serves the install guide at `/docs/INSTALL.md`
- Compressed board updates, paused while the tab is hidden (less phone data)

- **Safe deploys:** with a registered deploy command, sessions only prepare or block and the board runs that command (with dry run and rollback line) from the deploy button or the scheduled check · "reviewed finished work" step before a deploy · other projects step aside during a deploy · scheduled checks deploy only if you tick «deploy» (off by default in the setup guide)
- Designer role · team member proposal cards · per-project access for members
- **Dev-site sign-in gate** (optional): nginx `auth_request` to the board, per-project on/off and exceptions, in-server test header — `kit/board-gate-install.sh <site file>:<domain>` (backs up, reloads only if `nginx -t` passes) and `kit/board-gate-uninstall.sh`
- **Login-key guard:** if Claude Code's background manager empties the login key after one failed refresh, the board restores the previous key
- **Memory slots** (optional): `kit/bin/mem-slot run <name> <MB> -- <cmd>` queues heavy jobs first-come-first-served and runs each in its own cgroup box; `kit/bin/mem-slot-guard` (a Claude Code PreToolUse hook) blocks un-slotted builds — docs/OPERATIONS.md section 8
- docs/OPERATIONS.md section 9: everything that needs the server admin (sudo) in one table
- **Updates from the board** (owner): once a day the board looks for a newer release tag (`git ls-remote` only — nothing about your server is sent). A new version shows at the top with what changed; **Update** tests the new version in a temporary folder first, then restarts the board and checks it answers — if it does not, it goes back to the previous version and your records by itself. Local edits, a changed download address or a moved tag stop it. Rule and command templates copied at install are never overwritten — **Ask the AI to apply them** queues that for the server session. No automatic updates in this version — docs/OPERATIONS.md section 10

**Install and tools**
- One-command `install.sh` (asks before installing Node/PM2/Claude Code in your account, no root; offers Claude login and permission settings; safe to re-run)
- Board **First setup** box: what's missing with commands to copy, ✔ when detected; **Finish setup with AI ▶** runs the setup prompt as a session and asks its questions as one board card
- `kit/check-host.sh` one-minute host check · "Where it runs" (shared web hosting → separate work server)
- Terminal menu (`dev`), installer prompt (EN/KO), `kit/detect.py`, `kit/verify.sh` (now also runs the self-tests and shows the Claude Code check)
- Self-tests: `cd board && node --test test/*.test.js` — no extra packages; a throwaway copy with a fake `claude`, never your real sessions
- Project `CLAUDE.md` template, server layout standard, new-project scaffold in the setup prompt · project commands in English and Korean

Tested with Claude Code 2.1.314, Node 20, Ubuntu 22.04/24.04.
