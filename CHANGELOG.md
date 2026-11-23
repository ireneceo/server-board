# Changelog

## [Unreleased]

## [0.6.12]

- **install.sh as root now stops and offers a dedicated account** — creates it with no password and no sudo (so the AI sessions cannot become root), copies root's SSH keys to it and continues the install as that account. Without a keyboard it refuses (exit 5) unless `SB_AS_ROOT=1`. INSTALL: the dedicated-account section is no longer hidden. Root's SSH keys are written by the account itself (never by root following links in the account's home); an existing account with uid 0 or sudo/wheel/admin membership is refused; `SB_LANG` is limited to en/ko.
- **Groundwork for running the board under its own account** (no behaviour change on a normal install): every external program the board starts now goes through one gate (`board/account.js`) keyed by job — claude, git, deploy, backup, pm2, crontab, tailscale, ssh, check — and runs as the same account, as before. New optional `config.json` keys `ownerAccount` / `runAs` / `boardDir` / `workHome` let a later setup run the board as a separate system account that can only reach the owner account through a fixed list of commands. Telling an AI session from your SSH shell moved to `board/proc-peek.js` (same rules).

## [0.6.11]

- README: Claude Code version the board is checked with is now 2.1.330 (was 2.1.326)

## [0.6.10]

**⚙ Team — access, job and title are separate**
- Each person now has three fields: **access** (Final approver / Propose / View only — the only thing that decides buttons), **job** (developer, designer, planner, QA, marketer, operations, other) and **title** (free text such as lead or member). Job and title are labels: shown next to your name, in the invitation and in the session header («proposed by designer Park»)
- The old «designer» role is read as access Propose + job Designer — nothing to redo; saving ⚙ Team stores the new shape. Unknown roles still fall back to Propose, never to final approver

## [0.6.9]
**Packaging**
- `board/downloads/` (file snapshots handed over by sessions) and `board/fbtriage/` are now in `.gitignore`, so a «dev done» / quick-save commit on the install folder never picks them up.

**📥 Downloads from sessions**
- A session can now hand you a file it made (spreadsheet, PDF, image, zip…): it calls `POST /api/files` and a «📥 name · size» download button appears on its card and in the done list. Snapshot copy, project folder / session folder only, secrets and DB dumps refused, owner only by default (`filesTeam: true` adds that project's people), «✕ Withdraw», always downloaded (never opened in the browser), kept `filesKeepDays` (default 14) days.

**Deploy**
- The deploy-prep session now runs the project's pre-deploy data checks first (checks that read the dev database / dev server, if the project's deploy procedure lists them). A failure caused by test/demo data is fixed on the dev database before the deploy starts; code or real-data problems hold the deploy. Checks are never turned off or skipped.

## [0.6.8]
**Dev done**
- Pressing «Dev done» while another session in that project is working queued it silently — the card kept showing «N unpushed commits» and nothing else, so it looked like dev done had failed. The card now shows «dev done queued — starts when «session» finishes» (or «dev done running · N min») next to the dev line, the button reads «Dev done queued», the backup line says «→ dev done pushes», and the backup window explains that «Back up now» makes file/DB copies only and never pushes to GitHub

## [0.6.7]
**Deploy**
- Auto redeploy after a fixed failure (`deploy.autoRetry` + `deploy.gateFiles`, off by default): when a deploy you started fails a pre-deploy check, the fix session queued at the front ends ✅ and the board redeploys by itself after a 5-minute notice card (close it to stop). Temporary failures (rate limit, memory, connection) retry once 5 minutes later without a fix. Only within 6 h of your press, at most twice, and only if production is untouched, the deploy/check files did not change and no other session's work slipped in — otherwise the card says why and waits for your button
- A deploy that finished while the board was restarting is no longer «result unknown»: the runner records the script's exit code next to the log and judges it the same way (exit code + production marker) when it comes back
- The failure title no longer shows a «=====» divider line as the cause
**Backup**
- «needs approval» now says what and why: «backup settings not approved» (never approved — a session's «Confirm done» is not an approval) · «backup script changed — re-approve» (with when) · «backup paths changed — re-approve», and that scheduled backups keep running. An «Approve backup settings…» button sits right in the card's backup details. Deploy-side wording now reads «deploy command not approved» so the two approvals are not confused
**Connection**
- «Keep it open» suggestion on a Mac: the server now checks the tunnel itself — a shell-less tunnel (`ssh -N`, what the automatic tunnel uses) no longer gets the suggestion even when this browser lacks the «automatic tunnel» mark
- «This device drops often (N× in 7 days)» no longer counts a Mac waking from sleep (or a paused tab) as a drop — only outages over 2 minutes while the page was awake, counted once when they recover

## [0.6.6]
**Backups**
- «Connect to GitHub…» for a project with no remote: the board creates a per-project deploy key, shows the steps, refuses public repositories, checks the connection with that key only (pinned GitHub host key), then queues the first commit and push for that project's session (secret filtering and a review before pushing; never force)

**Project cards**
- The card head is tidier: three labelled summary lines (Dev · Prod · Backup) that show only what needs a look in colour; the deploy-runner line, per-copy backup lines and their small buttons move into one «More ▾» box (closed by default, remembered per project in this browser)

**Releasing (source server only)**
- «Release vX» no longer gets stuck answering «a release is already queued or running» after the previous release session was marked done (it looked for that session in the on-screen list, which hides finished sessions)

## [0.6.5]
**Backups**
- New «Backup» line on each project card: newest copy on this server, «sent to another server» (from this server's backup log) and copies received from another server — red when stale or missing, yellow when nothing is kept off this server. Works for a single server (leave sent/received empty) and for two servers that swap copies; the board never connects to the other server
- «⚙ Paths» registers the folders, log and backup script per project (`projects.json` `backup` — SERVER-GUIDE §2); saving approves them, and any change to the settings or the script needs approval again before «Back up now» runs or members see it
- The backup line also shows the code copy: whether the project's git is pushed to GitHub (or another remote) — pushed time, commits not pushed (red after the backup interval + 2h), or yellow «no code copy» when there is no remote or no commits. Read-only from this server (the remote is not queried); «Start dev done (includes push)» in the window. `"git": false` hides it
- «Back up now» (owner) runs the registered script once without a shell, in a clean environment; «Request restore» queues a restore task for that project's session — the board itself overwrites nothing

## [0.6.4]
**Updates**
- The board version and «check for updates» moved from the bottom of 🌐 Language to a chip next to the server name in the title (v… ↻ — tap to check now; shows «check failed» when the repository cannot be reached)

**Releasing (source server only)**
- Right after a release is packed (tests and review still running) the box says «packed — checking before push» instead of a red «not pushed»; it turns red only if the push is still missing 30 minutes after packing.

## [0.6.3]
**Releasing (source server only)**
- The board that publishes Server Board now counts board changes not yet released (commits since the last tag, [Unreleased] lines) and shows «Release vX» at the top; about an hour after the last change it queues the release in the server room once a day (`config.json` `"publish": {"auto": false}` turns that off). Installed boards are unaffected — they keep getting the «new version» notice within 6 hours of a release

**⚙ Team — adding a person, step by step**
- Each person is a card with four steps: ① route in (SSH account + the admin command to add their public key, or Tailscale invite) ② save ③ invitation ④ they register — each shows ✔ or what to do next
- «Make invitation & copy»: one message to send that person — sign-in link for their route, the SSH tunnel command filled with their ID (or the Tailscale address), sign-in steps and rules. Replaces the bare link pop-up · the card shows until when the link is open
- Intro shortened to the four steps; role and sign-in details folded under «Roles and sign-in rules»

**Inquiries — icon**
- The «Inquiries» row icon is now the same line icon as «Scheduled checks» (before, ✉ was left as a text character and showed as a different color emoji per device/browser)

**Status row — setup**
- After first setup is done, «Setup ✔ time / Show setup checklist» is now one line under the status row (it used to drop to a fourth cell on its own row, stacked in three lines)

**Alerts — default**
- A board that never set «Alerts to receive» now defaults to «only what needs me» (questions, needs reply, blocked; done off). Before, the default was «everything», which hides the per-task «🔔 Alerts: default / incl. done / off» picker in «New task» and the per-session «Alerts» button — so fresh installs never showed them. Boards that already chose a setting keep it; to get «done» alerts for everything again, press «Everything incl. done» in the Alerts panel (or «incl. done» for one task)

**Attachments**
- Drag and drop now works anywhere on the «New task» box and the 💬 chat box (not just the small text field). While a file is dragged over the board, the boxes that accept it get a dashed outline; dropping elsewhere no longer opens the file in the tab (and hides the board) — a short note says where to drop instead

**Deploy failures**
- A failed deploy now says why in one line, read from the deploy log: which pre-deploy check items failed, out of memory, production unreachable, or time limit — on the top card, the deploy button and the confirm box (before, the card only had the last 25 lines of output)
- The «Fix deploy failure» task goes to the front of that project's queue, and only once: a repeat failure adds its log to the same task instead of queuing another
- When the fix session ends ✅, the top of the board (and your phone) says «Deploy failure fixed — press Deploy again»
- Pressing Deploy again while the fix is still queued or working: the confirm box recommends «Deploy after the fix» — before, it recommended deploying again, which failed the same check
- Temporary failures (rate limit 429, memory, connection) first just say «press again in a few minutes» with no fix task; a second failure in a row queues one. A successful deploy drops fix tasks that have not started

**Adding people (docs)**
- OPERATIONS §1 now starts with who adds people (final approver only) and step 0 «a route in»: their own server account + SSH key (server admin, sudo) or a Tailscale invite + the Tailscale login field. Before, it began at ⚙ Team & roles, so a new member got a link they could not open
- TEAM-GUIDE gives the member the actual tunnel command and Tailscale steps (it only said «use the route you were given»); SERVER-GUIDE lists the `team` setting as final-approver-only and adds a «cannot sign in through this route» row; ⚙ Team & roles intro says a route is needed first

**Mac automatic tunnel — «keep it open» kept showing after install**
- The board only knows a Mac has the automatic tunnel from a one-time mark that the install script leaves by opening the board in the Mac's *default* browser. Using the board in another browser (or an install that stopped before that last step) meant the suggestion never went away, and «✕ Hide» came back after Mac sleep drops
- The suggestion now has «Already installed»: a one-line Mac check that lists the installed tunnels with their state and, for a running one, the address to paste into this browser once — after that it no longer shows
- `connect-mac.sh` prints that address at the end for people who use another browser

## [0.6.2]
**Inquiries**
- «Send reply» sits right on each inquiry line that has a draft — it shows the draft in a confirm box and hands it to the project session; no need to open the draft first or go to the admin page. A «Close as done after sending» tick sits next to it (on by default for «Already fixed» / «Reply only»)
- New per-project «Auto-send replies» setting at the top of the inquiry box (owner only, off by default): «Already fixed» only, or «Already fixed» + «Reply only». Matching drafts are handed to the session as soon as the list arrives — once per inquiry; the session still checks every fact against production before sending
- A line disappears from the inquiry box as soon as its «reply + close» session finishes with ✅ (it used to stay until the next inquiry check). If a later list still has it open, it shows again
- Lines nobody has judged (`확인 중`) now read «Not judged yet» instead of «Checking», and get «Ask the session to investigate»: the project session checks whether it is already fixed and why, updates the line and reports a recommendation (no reply, status change or development)
- Handed-over lines show where the job is: «#N in the queue» (waits until the session working in that folder finishes) or the session id
- Fix: reply hand-offs no longer go through the queue's «is this still needed?» pre-check — it read «the fix is done» as «the reply is done» and dropped replies unsent. Replies dropped that way are handed over again automatically when the same draft is still in the list
**First setup**
- «Open a server window» now checks for itself: when a terminal is already logged in to this server (an ssh login with a terminal — not a tunnel), the step folds into «✔ Server window — open». If the board cannot see it (other tools), «Already open — skip» folds it and is remembered in that browser; «Show the login line» opens it again
- The `ssh` line now uses the address (and port, `-p`) that current logins to this server actually use, before guessing from network cards
- Fix (0.6.0–0.6.1): «Finish setup with AI» always stopped with «Not logged in to Claude yet», even when the list showed «Log in to Claude ✔». It now reads the same login check as the list

## [0.6.1]
**Update notices**
- The board now checks for a new version every 6 hours (was once a day), and 1 hour after a failed check — a new release used to stay invisible until the next day
- When the check itself fails (cannot reach the public repository · no `git origin` in the board folder), the top of the board says so with a line to run in a server terminal, and «Check for updates» no longer answers «You are up to date» — before, a failed check looked the same as «no new version»

**Mac automatic tunnel**
- `scripts/connect-mac.sh` no longer ends silently when piped (`ssh <alias> 'cat dev-server/scripts/connect-mac.sh' | bash -s <alias>`): the whole script is read before it runs, so nothing later in it can swallow the rest of the script. 0.5.0 stopped right after «① Key login check» this way (0.6.0 already added `ssh -n`)
- If the script ends before ✅, its last line now says at which step (⓪–④) it stopped
- After the key check it says the «post-quantum key exchange» warning from older servers is harmless; the board's install step says so too

## [0.6.0]
**Mac: keep the board open without a terminal window**
- «Open on other devices» → **Mac — always open (automatic tunnel)** is now one box with the four steps in order — key, login without a password, alias, install — each with a check line, how to read it, and a copy button. The install line fetches the script from the server, so the Mac needs no copy of this repository: `S=$(ssh user@server cat dev-server/scripts/connect-mac.sh) && bash -c "$S" connect-mac <alias> user@server`
- The alias is per server (`sb-<server name>-<port>`, e.g. `sb-office-8801`), so two servers' boards no longer share `Host myserver`, the LaunchAgent name or the log file. The SSH-tunnel steps, `~/.ssh/config` sample and the reconnect checks use the same alias
- `scripts/connect-mac.sh` adds the alias to `~/.ssh/config` when it is missing (old file backed up as `~/.ssh/config.bak-serverboard`), stops if the alias already points to another server, speaks the board's language, works when piped from the server, and at the end opens the board with a marker so the board knows this Mac has the tunnel
- Right after first setup through an SSH tunnel, the board shows a card: the board is visible only while that terminal window is open → **keep it open (automatic tunnel)** / **phone too? Tailscale**. On later visits through a hand-opened tunnel it shows a one-line hint (hide it once; it comes back if this device drops twice in 7 days)
- «Could not reach the board server» on a Mac now shows, right there, one line to paste into Terminal that says what is wrong (no tunnel · stuck tunnel · automatic tunnel failing · key login), plus the install line
- The SSH instructions show the board's own port even when the page is opened through Tailscale (they used the Tailscale port)

**Also**
- A newer board version shows a **Update x.y.z** badge next to the server name; tapping it scrolls to the update box
- First setup asks for a server name first when `serverName` is empty — otherwise the authenticator entry would be «Server Board · <IP address>» (you can continue without one)
- First setup box (the «Claude Code» checklist): opens with a one-line `ssh` command for this server, numbered steps with copy buttons, sign-in without a terminal, the exact `sudo` line for start-on-reboot; the AI sign-in check no longer shows «?» when `claude auth status` prints extra lines
- First setup box: Claude Code install now uses the native installer (`curl -fsSL https://claude.ai/install.sh | bash`) instead of `npm install -g`; start-on-reboot also counts a `@reboot pm2 resurrect` crontab line as done, and its fallback line sets PATH; a private address in the `ssh` line gets a note
- `install.sh` suggests the public address first

## [0.5.0]
**New**
- Deploy connection: a project with no production server registered shows a **"Deploy · not connected"** button. The owner can connect a deploy script that is already in the project (one-line command, saving = approving it), change or disconnect it later (**⚙ Connection** on the deploy line), or — with no script yet — queue "write a deploy script" for that project's session. The board never takes or stores production addresses, accounts or keys. See [SERVER-GUIDE](docs/SERVER-GUIDE.md) section 2

**Fixes**
- An open board tab could stay on a page showing the raw `__SERVER_NAME__` placeholder after an update; the auto-reload check now compares the page as actually served
- Some session instructions and the "stopped by" label lost words in the public build (e.g. " stopped with" with no name); the release build now refuses to package text that would be cut
- First setup box: the **Copy** button no longer squeezes into a vertical column next to a long command
- `kit/verify.sh`: the terminal menu (`~/bin/dev`) is optional, so a missing menu is now △ instead of ✘
- `kit/check-host.sh`: the SSH tunnel hint uses `SB_PORT` when set
- Deploy connection refuses a script path that is a symlink (the link may be committed while the file it points to is not)
- Docs: a blank line split the `projects.json` table in the Korean server guide; the English `prodLabel` row now describes the "not connected" button

Tested with Claude Code 2.1.326 (fresh install from the README on Ubuntu, self-tests pass).

## [0.4.0]
Fixes found while installing on another server (RHEL 8 · Claude Code 2.1.311 · a Docker project).

**Fixes**
- Room list: terminal (`interactive`) entries from `claude agents --json` may have no `id` — the board and `kit/verify.sh` now read them by `sessionId` and require `id` only on background entries (verify used to fail twice with "missing field: id" and "could not read claude agents --json")
- Self-tests no longer hang where `/bin/sh` is bash (RHEL, Fedora…): the update test's fake PM2 kept the test's output pipe open; every process a test starts is now stopped by pid and its temp folder removed
- The update runner left a `/tmp/board-update-*` folder behind on every blocked or finished update — now removed
- `kit/verify.sh`: self-tests have a time limit (180s, `VERIFY_TEST_TIMEOUT`) — on timeout one ✘ line "self-tests hung" instead of a check that never ends

**Several servers**
- Boards on several servers no longer get mixed up on one computer: `install.sh` asks for a **server name** (required, default the host name; different per server) and a **board port** — it asks which ports the boards you already open from this computer use, suggests a free one and refuses ports already in use on the server. Both go to `board/config.json` and `install-info.json`. An already-installed server keeps its port; a re-run only fills an empty server name
- Sign-in cookies are per port (`sb_sess_<port>`), so signing in to one board no longer signs you out of another; the old `sb_sess` cookie is moved over once if it belongs to this board (updating keeps you signed in)
- The server name shows in the board header, the tab title and the sign-in page; `/api/ping` returns it
- No more fixed `8800`: room instructions, scheduled checks and the kit templates (`{{PORT}}`) use the configured port
- `scripts/connect-mac.sh` reads the port and name from the server, refuses a Mac-only port change, stops if the port on the Mac or a `LocalForward` in `~/.ssh/config` already belongs to another board, and checks the opened board's name. The `~/.ssh/config` sample adds `ExitOnForwardFailure yes`
- `kit/verify.sh`: ✘ when `serverName` is empty or the board answers with another name · ✘ with file:line when placed docs/commands still point to another port · △ hint on the default 8800. How to change a port: [OPERATIONS](docs/OPERATIONS.md) section 11

**Install**
- `install.sh` asks the two session settings one by one and says what each means: `permissions.defaultMode=auto` (sessions do not stop at every permission prompt) and `worktree.bgIsolation=none` (sessions work in the project folder itself; unset = each session works on its own branch and cannot see uncommitted changes). `verify.sh` shows the same explanation
- When `bgIsolation` is not `none` and the project folder has uncommitted changes, queuing or starting a task shows a warning
- `install.sh` offers the terminal menu (`~/bin/dev` + `.bashrc` block, with backup); `SB_MENU=1` adds it without asking
- New session-notes template for projects: `kit/templates/<lang>/solution-session-state.md`

**Docs / templates**
- Project rules and "Dev command settings" cover Docker projects handled only through a sudo wrapper command (no PM2: container names, wrapper commands, test command)
- [SERVER-GUIDE](docs/SERVER-GUIDE.md) section 7: pushing from the dev server to GitHub with a deploy key — the request to send the repository admin, `core.sshCommand`, allow rules for sessions, and the matching `push:` line; `/dev-done` pushes exactly that line and never works around a refusal

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
