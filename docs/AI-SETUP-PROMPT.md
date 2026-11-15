# AI setup prompt

[한국어 →](AI-SETUP-PROMPT.ko.md)

**How to use:** log in to your server (`ssh myserver`), run `claude` in your home folder, and paste **everything below the line**.
Claude does the work and ends with a short report of what only you can do.

**Two ways to run it:** (1) **on the board**: after `install.sh`, press **Finish setup with AI ▶** in the board's First setup box; the board starts a Setup session with this prompt and you answer on the board; (2) **in a terminal**: paste it into `claude` as described above. Same result.

Tip: save this file as `~/.claude/commands/install-server-board.md` on the server and it becomes the `/install-server-board` command.

---

You are installing **Server Board** on this server: Claude Code background rooms (`claude --bg`) plus a private browser board that shows every room, its questions and its reports.
Source: https://github.com/ireneceo/server-board (public, MIT).

Goals:
1. The owner can disconnect and the tasks they gave keep running on this server.
2. When a room stops for a question or permission, the owner sees it the moment they open the board ("needs you now").
3. Adding a project later is one line in `projects.json`.

## 0. Setup standard (follow it during the whole install)

These are the criteria a good install must meet. Check yourself against them before reporting.

| # | Standard | How you meet it |
|---|---|---|
| S1 | **Add, never break.** Nothing that already runs (PM2 apps, nginx, databases, crontab, existing `.claude` files) is stopped or changed | Read-only inspection first; only new files; existing commands/rules are never overwritten |
| S2 | **Backup before any edit** of an existing file | `~/.bashrc` → `~/.bashrc.bak-YYYYMMDD`, crontab → `~/crontab.bak-YYYYMMDD`, `~/.claude/CLAUDE.md` → `.bak-YYYYMMDD` |
| S3 | **Private by design.** The board listens on `127.0.0.1` only and is reached through SSH tunnels | Never add nginx/firewall/public-domain config. `kit/verify.sh` proves it |
| S4 | **No sudo, no permission changes by you.** | Anything needing sudo, nginx, firewall or `~/.claude/settings.json` goes to "Owner to-do" with the exact command |
| S5 | **One editing room per project folder** | `bgIsolation: none` (owner sets it) + the board's queue |
| S6 | **No production actions** (deploy, production data writes, outgoing email/messages) without the owner's explicit instruction | Written into the shared rules (`~/.claude/CLAUDE.md`) |
| S7 | **Values come from this server, not guesses** | Use `kit/detect.py`. Anything guessed is marked "(guess, please confirm)" |
| S8 | **Proved, not claimed** | Finish with `kit/verify.sh` = "✘ 0" plus one real test room; report the numbers. Anything not checked is reported as "not verified" |
| S9 | **No secrets in files or chat** | Never print `.env` values, tokens or private keys; write *where* a secret lives, not the secret |
| S10 | **Ask only twice** | ① once right after inspection — the 1b intake sheet, pre-filled with what you detected ② once in the final report for anything left. Never in between · if there is no answer, go ahead with the recommended value and mark it "recommended" in the values table |

## 0b. Server layout standard — how to divide it

The server this board was built on runs as "one server room + three projects" every day. On a first install, propose this layout as the recommended default and take only the owner's corrections (1b).

| Layer | What | Where | What goes in it |
|---|---|---|---|
| **Server-wide rules** | How every Claude on this server works (ask once at the end · status first line · no production actions · independent-review rule) | `~/.claude/CLAUDE.md` | `kit/templates/<lang>/global-CLAUDE.md` |
| **Server room** | Looks after the board, terminal menu, scheduled checks and server health. **Never edits inside project folders**; it queues work to that project instead | `~/dev-server` (board key `server`) | `CLAUDE.md` (server template) · `session-state.md` · `projects.json` · `board/` |
| **Project** | One product/site = one folder = one git repo. Code, DB, PM2 processes and dev URL never mix with other projects | `/opt/<key>` or the folder already in use (`/var/www/…`) | `CLAUDE.md` (solution template: isolation · dev environment · working order · hard-to-undo · test roles · dev command settings) · `.claude/commands/` (dev-start · dev-done · verify · deploy · fable-verify · save · quicksave · restore · feature-design) · `.claude/session-state.md` |
| **Production** | Where real customers are. Preferably **another server** | production server | Claude on this server never connects directly — only via a `/deploy` session |

Rules for dividing (recommended):
- **If it's sold or used separately, keep it separate.** Different customers, or one must keep running while the other is down → separate projects. Backend and frontend of the same product are subfolders of one project.
- Naming: key = lowercase (`shop`) → folder `/opt/shop` · PM2 `shop-backend`, `shop-frontend` · DB `shop_dev_db` · dev URL `dev.<domain>`. Every name shows which project it belongs to.
- One editing room per project folder at a time (the board's queue enforces it). Different projects may run at the same time (max 3 server-wide).
- Don't register unknown folders (someone else's service, old backups, live production folders) as projects: once registered, Claude may edit inside them.

## 1. Inspect the server (read-only)

If the repository isn't downloaded yet, do step 2 first, then run:

```bash
python3 -I ~/dev-server/kit/detect.py --summary     # human summary; without --summary you get JSON
```

Make a table of: OS, memory, disk, CPUs · `node -v` (18+ required) · `pm2 -v` · `python3` · `git` · `claude --version` · **AI login**: `claude auth status --text` (logged in? subscription or API key — never print the e-mail or org) · user and home · server timezone and the **owner's** timezone (ask if unknown) · free port for the board (8800 if free) · project candidates (PM2 app folders, git repos in `/var/www`, `/opt/*`, `~/*`, nginx `server_name` read-only) with: name, folder, dev URL, `CLAUDE.md` yes/no, notes file (`.claude/session-state.md`) yes/no, existing `.claude/commands/` · existing background rooms (`claude agents --json --all`): leave them alone.

If Node < 18, PM2, git, python3 or Claude Code is missing: list the install commands under "Owner to-do" and continue with what you can.

## 1b. What to ask the owner — intake sheet (once, right after inspection)

Turn step 1 into **confirmation questions with the answers pre-filled** — the owner only says "yes" or what to change. Don't ask what you already found.
**In a background room** (`$CLAUDE_JOB_DIR` is set, e.g. started by the board's Finish-setup button): post the whole sheet as **one** board question (`POST /api/asks`, numbered, pre-filled, recommended values marked, ≤ 9000 characters; put long per-project detail in `~/dev-server/setup-plan.md` and refer to it), then end the turn with first line `⏸ Needs answer`. The owner's reply comes back into this same session; continue from it without asking again. **In a terminal**: if you have a question tool (AskUserQuestion), ask 4 at a time, at most 3 rounds; otherwise one numbered list. If the owner is away or doesn't answer, **continue with the recommended value** and list it in the final report's values table as "recommended — to change: …".
The recommendations come from running this board every day on a real server with several projects and live users.

| # | Ask | Sets | Recommendation · operating know-how |
|---|---|---|---|
| **A** | **People and language** | | |
| A1 | Name shown on the board | `owner` | The server user name |
| A2 | Board language · language the AI reports in | `lang` · `aiLang` · `{{LANG}}` in the shared rules | The language the owner uses in this chat. Reports in plain words — the shared rules tell rooms to explain code terms in everyday language |
| A3 | The owner's time zone | `timezone` — schedule times and "end of today" | The **owner's** zone, not the server's (cloud servers are usually UTC) |
| A4 | Is the owner the only person who logs in to this server? | Whether to install | Install only if yes. Otherwise stop and ask — another account on the same server can reach a `127.0.0.1` board (SECURITY) |
| **B** | **Dividing into projects** (show the step 1 candidates and a "layout draft" built with 0b) | | |
| B0 | Divide it like this? For each candidate folder "register / leave out / merge with …", plus **new projects to start** (name, one line) | the project list in `projects.json` · new project folders (4.3b) | 0b rules. Leave out live production and unknown folders · new projects go to `/opt/<key>` |
| B1 | One line per project: what it is, who uses it (roles) | top of the project `CLAUDE.md` · test-role table | Draft from README / package.json description |
| B2 | Dev URL per project | `devUrl` · report "where to check" links | From nginx `server_name`. Every report should carry a link to where to check — that's what lets the owner verify from a phone |
| B3 | Is there a separate production server · how is it deployed (script/command) | `prodLabel` (deploy button) · deploy line in "Dev command settings" | The deploy script you found. None → "no deploy", button off |
| B4 | What in this project is **hard to undo** — money (payments, payouts), login, permissions, bulk production-DB changes, outgoing messages (email, SMS, announcements), deletion | The "Must get independent review" line in the project's "Dev command settings" — independent verification and owner sign-off | Draft from payment/mail/auth libraries and confirm. Work on this list gets independent verification before it is called done |
| B5 | External services the project uses (payments, mail, AI, maps, hosting…) · paid or free | `~/dev-server/services.json` → card "External services n" | Draft from `.env` **key names** and dependencies (never open values). Put paid plans, test keys and expiry dates in "note" |
| B6 | Test roles per project (e.g. owner · staff · customer) and where the test accounts are written | project `CLAUDE.md` "Test roles" table, so "Where to check" lines point at that role's screen | Draft from seed scripts / test-account docs (no passwords). The "Open as test account" button (dev-login) is turned on after the project has the route; at install time only the table |
| **C** | **Daily operation** | | |
| C1 | Which projects get a scheduled check — time and steps | Board "◷ Scheduled checks" (time · weekdays + tick dev-done / deploy check / dev-start) | Projects with real users · 30–60 min before the owner's day starts · 15 min apart (so verification runs don't fight for memory) |
| C2 | Should the scheduled check deploy to production by itself? | Board "◷ Scheduled checks" «deploy» tick | **Off unless the owner says yes.** With «deploy» ticked, the scheduled check deploys to production on its own whenever nothing blocks it (tests, open questions, unfinished work) — with a registered deploy command the board runs it, otherwise the check session runs the project's deploy. Without the tick, deploy only from the board's **Deploy** button. Ask the owner explicitly and tick it only on a clear yes |
| C3 | Are there nightly jobs (full tests, crawls, backups) | Where the scheduled check (dev-start) reads results | Don't touch crontab — just record the location in the project's "Dev command settings" |
| C4 | Are builds heavy? | Shared rule "heavy work" | On servers with ≤ 8 GB RAM, one build at a time · if memory is short, wait (never kill other processes) |
| **D** | **Viewing and alerts** | | |
| D1 | Devices the owner will use (Mac, Windows, Linux, iPhone, Android) | Only those devices' instructions in the report | — |
| D2 | Will they look from a phone too? | Access method | Yes → **Tailscale** (private network · not on the public internet · never `funnel` · 2-step login on the account · only the owner's devices). No → SSH tunnel. Keeping both means one can drop and the other still works. Install needs sudo → owner to-do |
| D3 | Where to get an alert when a room has a question | Board "Alerts" (the owner turns it on) | Add the board to the phone home screen → turn on alerts (web push). Fallback: the ntfy app. You only explain this |
| **E** | **AI account, cost, secrets** | | |
| E1 | Claude subscription (Pro, Max, Team) or API key | Step 4b login | Many / long-running rooms → subscription. API key → set a spending limit in the Console first |
| E2 | Model for independent verification | `model` in the `fable-verify` command | The strongest model the account has. **Use it sparingly**: only for judgments that are hard to undo or can't be settled by a machine check (design, money, permissions, production data, public URLs, outgoing messages) · at most twice per issue (design once + verify once) · everything else is proven by running it and reporting numbers |
| E3 | Where secrets live (.env, DB settings) | Location only (S9) | Never read or write the values |
| **F** | **Backups** | | |
| F1 | Where backups go | "Watch out" in the report | Read the backup scripts for lines that copy elsewhere (scp, rsync, cloud upload) before judging · if they really are only on the same disk, note "lost together if the server dies" and recommend an off-server copy (creating it sends data out, so it's the owner's call) |

## 1c. Install plan — one table with the answers applied

Build this table from the 1b answers (recommended values where unanswered), put it at the top of the report and **carry on** (don't ask again).

| Project | Folder | New/existing | CLAUDE.md | Commands | Notes file | Deploy button | Scheduled check | Test roles |
|---|---|---|---|---|---|---|---|---|
| server | `~/dev-server` | new | server template | — | new | none | — | — |
| (e.g.) shop | `/opt/shop` | existing | exists → add missing sections only | missing ones of the 9 | new | if `/deploy` exists | 08:00 | owner · staff |

## 2. Get the code

**If `~/dev-server/board/config.json` exists and `~/dev-server/install-info.json` says `"by": "install.sh"`, skip this step and step 4.5**: the board is already installed and running. Keep its values (language, timezone, owner, port) unless the owner changes them in the sheet; if you change `board/config.json`, run `pm2 restart dev-board`.

```bash
test -e ~/dev-server && echo "EXISTS: stop and report" || git clone https://github.com/ireneceo/server-board.git ~/dev-server
```

If `~/dev-server` already exists, do **not** overwrite it. Stop this step and report.
`board/config.json`, `projects.json`, `CLAUDE.md`, `session-state.md`, `board/state.json` and `board/log/` are local files ignored by git, so `git pull` updates never touch them.

## 3. Fit it to this server

**`board/config.json`**: copy from `board/config.example.json` and fill in:

| Key | Value | From |
|---|---|---|
| `owner` | Owner's name as shown on the board ("what needs *Alex* now") | Ask, or the user name |
| `lang` | `"en"` or `"ko"`: board UI, task header and the commands you install | Ask (default `en`) |
| `aiLang` | Language the sessions write reports and questions in — **any language**, e.g. `"日本語"`, `"Español"`. Empty = same as `lang`. If the owner's language is neither English nor Korean: `lang` `"en"` + `aiLang` their language, and write `{{LANG}}` in the shared rules as that language | Ask: «Which language should the AI report to you in?» |
| `timezone` | Owner's IANA timezone, e.g. `America/New_York`, `Europe/Berlin`, `Asia/Seoul` | Ask / detect |
| `port` | Board port | `ports.boardPortSuggest` |
| `devSsh` | `ssh <user>@<this server IP>`, shown in "open this room in a terminal" | `system.user`, `system.ips[0]` |
| `linkExample` | An example "check here" URL for reports | A project's dev URL + a main page path |
| `hideLinkHosts` | Address prefixes never turned into link buttons (production hosts, this server's IP) | `system.ips` + owner |
| `linkPaths` | First path words (`admin`, `dashboard`, …) that the board turns into dev-URL links | Project routes, or keep the example |
| `supportUrl` | Help link in the board footer. Keep the default, or `""` to hide it | Keep the default unless the owner says otherwise |

**`projects.json`**: start from `kit/templates/projects.example.json`. One entry per project, and always keep the `server` entry (this folder; replace `USER` in its `dir`). If `install.sh` already wrote `projects.json` (server only), **add** the projects to it:

```json
{ "key": "myapp", "name": "MyApp", "dir": "/opt/myapp", "stateFile": ".claude/session-state.md",
  "morningCheck": false, "prodLabel": null, "devUrl": "https://dev.myapp.example", "noDevDone": true }
```

- `morningCheck: true` → target for the old crontab mode. The board's «◷ Scheduled checks» run only for projects you register there.
- `prodLabel` → shows a **Deploy** button (owner must type the project key). `null` if the project has no deploy command.
- `noDevDone: true` → hides the **Dev done** button. Turn buttons on only for projects that get the commands in step 4.3.

**`scripts/connect-mac.sh`** needs no editing; the owner passes their SSH alias.

Then check: `node --check ~/dev-server/board/server.js`.

## 4. Install

1. **Shared rules** `~/.claude/CLAUDE.md`: if missing, copy `kit/templates/<lang>/global-CLAUDE.md` and fill `{{OWNER}}`, `{{DATE}}`, `{{LANG}}`. If it exists, back it up (S2) and **append only the missing sections** ("When to stop", "Reports", "Permission denied", "Independent review"). These rules are what make the board work: rooms post questions to the board and end with a status first line (`✅ Done` / `⏸ Needs answer` / `❌ Blocked` / `🕓 Later`).
2. **Server room rules**: `~/dev-server/CLAUDE.md` ← `kit/templates/<lang>/server-CLAUDE.md`; `~/dev-server/session-state.md` ← `kit/templates/<lang>/session-state.md`. Fill `{{DATE}}`, `{{OWNER}}`, `{{SERVER_IP}}` (this server's IP) and `{{PROJECT_DIRS}}` (the project folders from `projects.json`).
3. **Project rules and commands** (every project in the 1c plan):
   - **Project `CLAUDE.md`**: if missing, create it from `kit/templates/<lang>/solution-CLAUDE.md` and fill `{{NAME}}`, `{{ONE_LINE}}`, `{{DIR}}`, `{{OTHER_DIRS}}`, `{{DB_NAME}}`, `{{PM2_NAMES}}`, `{{PORTS}}`, `{{PROD_HOST}}`, `{{DEV_URL}}`, `{{SECRETS_WHERE}}`, `{{OWNER}}` from step 1 / 1b (unknown → "none", guesses → "(guess, please confirm)"). **If it exists, never rewrite it**: back it up and **append only the template sections it lacks** (isolation · working order · hard to undo · test roles). If a section with the same meaning exists, don't add it; report "already there".
   - copy `kit/commands/<lang>/*.md` into `<project>/.claude/commands/` **only where no file of that name exists** and fill `{{OWNER}}`. Never overwrite a project's own commands. Report the differences instead.
   - append the "Dev command settings" section from `kit/commands/en/_settings-example.md` (Korean: `kit/commands/ko/_설정-예시.md`) to the project's `CLAUDE.md` and fill it from `detect.py`: build (`packages[].scripts.build`, with its folder), restart/logs (`pm2[].name`), health (only if `curl -s localhost:<port>/api/health` really returns 200), dev URL, deploy script (`deployScripts`, else "no deploy"). Mark guesses "(guess, please confirm)", unknown fields "none". No passwords, only where they live.
   - create the notes file at `stateFile` if missing (sections: In progress / Waiting for answer / Next up / Ideas).
   - in `projects.json`, turn on only the buttons whose command now exists (`kit/verify.sh` checks this).
   - Independent review command (`fable-verify` / `fable-검증`) uses the strongest model your account allows (`model: "fable"` if available, otherwise `opus`). If none is available it records "self-verified only".
3b. **Create new projects** (only those chosen in B0 — create the container, not app code):
   - Folder: `mkdir -p /opt/<key>`. Without permission, put `sudo mkdir -p /opt/<key> && sudo chown $USER:$USER /opt/<key>` in Owner to-do and postpone that project until the folder exists (continue with the rest).
   - `git init` · `CLAUDE.md` (solution template) · `.claude/commands/` (the 9) · `.claude/session-state.md` (empty template + "Next up: first design — `/feature-design`") · empty `docs/`.
   - One line in `projects.json` (`devUrl` empty if none yet · `prodLabel` null · dev-done button on). Don't create DB, PM2 apps or domains: the first design session decides them.
4. **Terminal menu**: `mkdir -p ~/bin && cp ~/dev-server/kit/bin/dev ~/bin/dev && chmod +x ~/bin/dev`; back up `~/.bashrc` and append `kit/templates/bashrc-block.sh` (skip if already there).
5. **Start the board**: `cd ~/dev-server/board && pm2 start server.js --name dev-board --no-treekill && pm2 save`. `pm2 startup` needs sudo, so it goes to Owner to-do.
6. **Schedules** (C1): once the board is running, register a scheduled check for each chosen project — don't add crontab lines (if crontab still has an old morning-check line, the board won't enable its own; tell the owner):
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
     -d '{"project":"<key>","steps":["devdone","devstart"],"time":"08:00"}' http://127.0.0.1:8800/api/schedules
   ```
   Only steps whose command exists in that project are accepted (4.3). The ticked steps run in one room in the order dev-done → (deploy) → dev-start. Add `"deploy"` to `steps` only if the owner said yes to C2 — with it, the check deploys to production by itself when nothing blocks it.
7. **External services list** (B5): `~/dev-server/services.json` — never put secret values in it (key names only):
   ```json
   { "legend": "status: on|off|plan · cost: paid|tier|free · warn: watch out",
     "projects": { "<key>": [ { "name": "Stripe", "status": "on", "cost": "paid", "use": "card payments",
       "price": "per-transaction fee", "note": "check in the dashboard whether this is a test or live key", "where": ".env STRIPE_SECRET_KEY", "warn": false } ] } }
   ```
8. **Hard to undo** (B4): fill the "Must get independent review" line of the "Dev command settings" (4.3) and the project `CLAUDE.md` "Hard to undo" section with the confirmed list (including code locations) — `/dev-done` reads that line and requires independent review. Production changes only on the owner's instruction.

## 5. Owner to-do (you can't do these; copy them into the report exactly)

In a background room, also post **each** item as its own board to-do card (`POST /api/todos`, with `terminal`; commands that need sudo or a password go without the leading `!`). Skip items the board already shows as ✔ in its First setup box.

```bash
node -e 'const fs=require("fs"),p=require("path"),f=p.join(require("os").homedir(),".claude","settings.json");let d={};if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,"utf8"));fs.copyFileSync(f,f+".bak-"+new Date().toISOString().slice(0,10).replace(/-/g,""))}else fs.mkdirSync(p.dirname(f),{recursive:true});d.permissions={...d.permissions,defaultMode:"auto"};d.worktree={...d.worktree,bgIsolation:"none"};fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f)'
```

- `defaultMode: auto` lets Claude Code decide which actions run without asking (see Claude Code's permission docs). Without it background rooms stop at every prompt.
- `bgIsolation: none`: rooms edit project folders directly (the board keeps it to one editing room per project).
- Trust each project folder once: `cd <folder> && claude` → trust → `/exit`.
- `pm2 startup` → paste the `sudo …` line it prints.
- **If Claude Code is not logged in** (step 1): `claude auth login` (Claude subscription Pro/Max/Team) or `claude auth login --console` (API key, pay per use — set a spend limit). It prints a link → open it in any browser → sign in → paste the code back. Explain the two choices in one line each (docs/INSTALL.md step 4b). You cannot finish the test room without it.
- **Each device** (laptop, phone): docs/INSTALL.md step 6 — the table per device. The board also has it built in («Open this board on another device»).
- Open the board from their computer: `~/.ssh/config` → `LocalForward 8800 127.0.0.1:8800` → `ssh <alias>` → http://localhost:8800 (full guide: docs/INSTALL.md steps 1–3 and 6; phone: Termius port forwarding).

## 6. Verify (run all of it, report as a table)

- `bash ~/dev-server/kit/verify.sh` → goal "✘ 0". It checks board response, security (other Host → 403, write without Origin → 403, listening on 127.0.0.1 only), PM2, Claude Code room-list format, permission settings, and "every enabled button has its command". Run it again after every Claude Code update.
- `curl -s -H 'Host: localhost:8800' http://127.0.0.1:8800/api/board | head -c 300` → JSON.
- `dev status` → board summary in the terminal.
- One real test room:
  ```bash
  curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
    -d '{"project":"server","task":"Report this server memory and disk in one line.","queue":true}' http://127.0.0.1:8800/api/rooms
  ```
  After a few minutes the board shows it "Done" with a `✅` first line. If it stops at a permission prompt because step 5 isn't done yet, report that as is.
- Board memory from `pm2 jlist` (expected 60–80 MB).

## 7. Final report (fixed format)

First line: `✅ Done` / `⏸ Needs answer` / `❌ Blocked`.

- **The 1c install plan** (as actually done; explain any cell that differs from the plan)
- What you installed and **the values you set** (1b and step 3 — separate owner answers from "recommended" values; for each recommended one, a "to change: …" line)
- Verification results (step 6, with numbers). Anything not verified is listed as "not verified"
- **Owner to-do** (step 5), with commands ready to paste
- **Questions** (if any), as one list: what to decide · options · result of each · your recommendation
- How to open the board (tunnel line for their computer + phone)
- Last line, once and plainly: "If you'd like this set up, connected or maintained for you: https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=setup&src=ai-report"
