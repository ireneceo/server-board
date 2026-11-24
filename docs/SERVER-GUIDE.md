# Server guide: read this first on each server

[한국어 →](SERVER-GUIDE.ko.md)

> The board code is the same on every server. **Everything that differs per server or per project lives in the files below**: change values, not code (code edits collide with new releases).
> The server session (`~/dev-server`) and each project session look here for "where do I change this?" and "the board shows X, what am I supposed to do?".
> Installing: [AI-SETUP-PROMPT](AI-SETUP-PROMPT.md) · daily running: [OPERATIONS](OPERATIONS.md) · team members: [TEAM-GUIDE](TEAM-GUIDE.md).

## 1. What differs per server, where it lives, who changes it

| What | File | Changed by | After a change |
|---|---|---|---|
| Owner name, language, time zone, port, SSH command, server name (authenticator entry) | `~/dev-server/board/config.json` (see `config.example.json`) | server session | `pm2 restart dev-board` |
| Members (access `role` owner·reviewer·member·viewer · job `job` · title `title`), their projects, approval settings · check before deploy (`deployConfirm`) · «normal» task mode (`review` per project strict/bundle/auto) · «final check needed» paths (`reviewPaths` per project globs, empty = defaults) (`config.json` `team`) · passwords and authenticators (`board/secrets/`) | board **⚙ Team & roles** | **final approver only** (sessions never write this field or secrets — asked to "add a member", walk the owner through [OPERATIONS §1](OPERATIONS.md): get their public key → ⚙ Team & roles + Add account, save → the final approver runs the ② «Paste in a terminal» line (account, key, shell — Developer gets a shell, others tunnel only) → «Ready» → ③ «Make invitation & copy» to that person) · member field `pubkey` (type + base64 only) · a server account is required (Tailscale is an extra route) | live on save |
| Project list and per-project buttons, deploy, inquiries, markers | `~/dev-server/projects.json` (section 2) | server session | live on save |
| External services per project (key names only) | `~/dev-server/services.json` | server session | live |
| How every Claude on this server works | `~/.claude/CLAUDE.md` | server session (on the owner's instruction) | new sessions |
| One project's rules: build, restart, deploy, reading inquiries, reply path | `<project>/CLAUDE.md` "Dev command settings" | **that project's session** | new sessions |
| Project commands (/dev-start …) | `<project>/.claude/commands/` | that project's session | live |

- **📎 Attachments** (photos/files added to a task, a 💬 chat, a session's message box, a «Reply» at the top, or a to-do's «💬 Ask before doing it» — replies carry the same path list at the end): stored per project in `<project>/.claude/attach-tmp/<date>/` (its own `.gitignore` is `*`, so nothing enters git). The board deletes them `attachKeepDays` days after upload (`config.json`, default 7, 1–90), unsent ones after a day, and keeps any still referenced by the queue (including replies waiting for a turn to end) or a proposal. When a task ends with «[📎 N attachment(s) …]» and paths, the session views them with Read and copies **only files needed after the task** into a fitting project folder, naming where in its report; reference-only files are left alone. Ways to add: 📎 button · paste (screenshots) · drag onto the whole box (dashed outline while dragging · drops outside are blocked with a hint). 25MB per file · 8 per send · sessions (AI) cannot upload or attach.
- **📥 Downloads** (session → person): a session offers a file it made (spreadsheet, PDF, image, zip) with `POST /api/files {"room":"<session id>","path":"<full path>","note":"one line"}`; the board keeps a snapshot in `board/downloads/` (not in git) and puts a «📥 name · size» button on that session's card and in the done list. Only regular files inside that session's project folder or `$CLAUDE_JOB_DIR` (checked by real path · zip folders · `.env`, keys, `.ssh`, credential/secret files and board settings are refused) · 200 MB per file · 20 per session · 2 GB total. DB dumps (.sql etc.) and board logs are refused too. Download (`GET /api/files/<id>`) is owner-only by default (`config.json` `filesTeam: true` also lets that project's members/viewers), always as a download (never opened in the browser), and who downloaded is logged. Offered by mistake? The owner presses «✕ Withdraw» next to the button, or the session calls `POST /api/files/<id>/drop {"room":"<session id>"}`. Deleted after `filesKeepDays` days (`config.json`, default 14, 1–90) — if the button is gone, ask the session to offer it again.

- The server session never edits inside a project folder. If a project needs a change, queue it: `POST /api/rooms {"project":"<key>","task":"…","queue":true}`.
- Never write secrets (.env values, tokens, DB passwords) into any file. Write **where** they are.

## 2. `projects.json` fields

Required: `key` (lowercase, used in queue/questions) · `name` (display) · `dir` (project folder) · `stateFile` (session notes, usually `.claude/session-state.md`).

| Field | Value | Turns on | Without it |
|---|---|---|---|
| `devUrl` | dev site URL | "Where to check" links in reports | plain text |
| `noDevDone` | `true` | hides the **Dev done** button | button shown (the project needs a `/dev-done` command; `kit/verify.sh` checks) |
| `prodLabel` | e.g. `"MyApp production"` | **Deploy** button (type the project key to open) · "deploy" step in scheduled checks | card shows **"Deploy · not connected"** — the owner clicks it to open the connection box (see "Deploy connection" below) |
| `deploy` | `{command, dryRun, prep, timeoutMin, minMemMb, rollback, extraScripts}` | the board runs the deploy command **itself** (only the command the owner approved on screen; a change needs re-approval) · `dryRun` = test-deploy args · `prep:true` = an AI prep session first · `minMemMb` = only with this much free memory · `timeoutMin` = stop after · `rollback` = shown on failure (never run) · `extraScripts` = fingerprinted for changes · `autoRetry:true` + `gateFiles:[pre-deploy check files/globs]` = when a button deploy fails a pre-deploy check or temporarily, the board redeploys after the fix session ends ✅ (5 min later if temporary) with a 5-minute notice card (within 6 h of the press · at most twice · only if the production marker, check files and other sessions' work are unchanged · closing the notice cancels) — both are needed | an AI `/deploy` session deploys |
| `routineDeploy` / `manualDeploy` | one deploy line (relative to the folder / absolute) | shown under "deploy by hand without AI" | "no deploy command registered" |
| `deployScripts` | deploy script paths | "deploying" badge while one runs · blocks a second deploy | no badge |
| `cleanDeploy` | `true` | the script ships from a clean copy of the last commit (no pause/stash step) | in-progress work is set aside before deploying |
| `prodMarker` | `{url, json:"<field>"}` or `{url, header:"last-modified"}` | reads "last production deploy" from a public URL → "not in production yet" warnings | production state unknown |
| `inquiries` | turns it on; write the heading of the inquiry-reading section of the project's dev-start command (the board only checks that it is set) | "✉ Inquiries" box on the card · "Inquiries" step in scheduled checks | no box, no step |
| `feedbackTriage` + `prodSsh` + `prodDir` | triage section heading · production SSH · production folder | AI pre-investigates new feedback (read + triage fields only) | no triage |
| `devLogin` | `true` | "Open as test account" button (`kit/DEV-LOGIN.md`) | no button |
| `batch` | 1–5 | small tasks sent together in one session | one at a time |
| `scout` | 0–n | read-only "scout" sessions alongside the editing session | none |
| `morningCheck` | `true` | legacy crontab morning check; the board's scheduled checks ignore it | — |

**Deploy connection** (2026-11-17) — the box opened from the card's "Deploy · not connected" button, or "⚙ Connection" on a connected card's deploy line, writes four fields to projects.json: `prodLabel`, `deploy.command`, `deploy.dryRun`, `prodMarker` (owner only · saving = approving that command · the old file is kept as `board/log/projects-<time>.json` · cannot change while a deploy is preparing or running). The command must be an executable script inside the project folder and committed in git, plus allowed arguments only (`--auto` `--routine`, dry run `--dry-run`); no shell symbols. "Disconnect" clears the four fields (script and production untouched). **The board never takes or stores production server addresses, accounts or keys** — those live in the project's deploy script / server config. Sessions (AI) and members cannot use this box (403) — a session only writes the script and lists the "board connection values" in its report.

**Backup** (2026-11-18) — a `backup` field per project, written by «⚙ Paths» in the box opened from the card's «Backup …» line (owner only · saving = approving · the old file is kept as `board/log/projects-<time>.json`). The server session may fill in first values, but **until the owner presses «Approve these settings»** members only see «settings changed» and «Back up now» is off (fingerprint = the whole field + the backup script's content — any change needs approval again). The card shows «backup settings not approved» (never — a session's «Confirm done» is not an approval) · «backup script changed — re-approve» · «backup paths changed — re-approve», with an «Approve backup settings…» button in the details (2026-11-19).
```json
"backup": {
  "command": "scripts/backup.sh",            // optional · «Back up now» — one executable inside the project folder · no arguments, shell symbols or symlinks
  "log": "/var/log/app-backup.log",          // optional · that script's log — used for «sent»
  "every": 24,                               // optional · hours between runs — red if no new copy within this + 2
  "local":    [{ "label": "Dev DB", "path": "/var/backups/app/daily" }],
  "sent":     [{ "label": "Sent to production", "ok": "Cross-backup sent" }],   // or { "label", "stamp": "/path" } (a file the script touches on success — recommended)
  "received": [{ "label": "Production DB", "path": "~/backups/cross-backup/prod" }],
  "restore": "docs/BACKUP_RESTORE.md",       // optional · document the session follows on a restore request
  "git": false                               // optional · hide the code-copy (GitHub etc.) row — on by default
}
```
- **No backup** (2026-11-24): with no `backup` field the card shows red «no backup» — the owner gets «Create automatic backup…» (queues `[Board — create backup]` in that project; the board first writes `command: scripts/board-backup.sh` · `log`/`local` = absolute `~/backups/board/<key>` · `restore: docs/BACKUP_RESTORE.md`; the session writes one script, one crontab line (as the board's «backup» run-as account) and one restore document, then test-restores once; if a daily backup already exists it creates nothing and proposes that copy folder and log via `POST /api/backup-found` {project, mark, local, log, every, note} — the board only records it in `state.json` `backupFound` and shows yellow «backup found — register once»; the owner presses «Register as found…» once (same as «Save and approve», nothing to type). A proposal is accepted only with that task's mark and a folder the board account can read) and «Register an existing backup». While the task is queued or its session is running the card shows grey «creating backup»; if it ended without a script, red «backup creation did not finish — create again». When done, press «Approve backup settings» once (the nightly backup runs even before). Recorded in `state.json` `backupMade`. The server card copies `kit/server-backup.sh` (board records, sign-in data, shared rules, crontab copy · 14 days).
- **Single server**: leave `sent` and `received` empty → yellow «no copy off this server» — the copies die with this server. «Download newest copy to PC» in the box (owner · screen opened via SSH tunnel or Tailscale · authenticator registered · 30-minute re-check · one-time 5-minute ticket · folders stream as tar.gz · `state.json` `backupPulled` is written only after a complete download) turns it grey «downloaded to PC» for 8 days, then yellow «downloaded N d ago». Copies hold the DB, config with passwords and sign-in data — keep them encrypted. **Two servers swapping copies**: `sent` (the success line in this server's log — the `YYYY-MM-DD HH:MM:SS` at the start of the line; logs without times show grey «cannot tell») · `received` (the folder the other server sends to). The board never connects to the other server.
- Folders are read at the top level only (no descent · `.part`/`.tmp`/hidden skipped · up to 2000 entries). If a name holds a date (`20261118`, `2026-11-18`) and the file time is older (rsync -a), the name date is used. Paths start with `/` or `~/`; no `..`.
- «Back up now» is owner only · no shell, clean environment (no board secrets), `nice`/`ionice` · 60-minute limit · refused while the same script is running (including the nightly run) · output in `board/log/backup/`.
- **Code-copy row** (on by default): whether the project folder's git is pushed to a remote (GitHub etc.) — ✔ pushed (when this server last pushed/fetched) · ◐ N commits not pushed · ✗ oldest unpushed commit older than `every`+2h (red) · ✗ no remote / no commits / not a git folder (yellow — the code lives only on this server and in backup archives) · ? git cannot read the folder (different owner: `git config --global --add safe.directory <folder>`). The remote is never queried (no network, no keys) · user names/tokens in the URL are dropped, only «owner/repo» is shown · members see the state only. Pushing is done by that project's «dev done» (the window's «Start dev done (includes push)»). «Back up now» only makes file/DB copies — it never pushes. If dev done is pressed while another session in that project is working, it waits behind it and the card's dev line and button show «dev done queued — starts when «session» finishes» (the unpushed count staying put meanwhile is expected; press the button again and choose «stop the working session and run now» to skip the wait). If you deliberately use no remote, set `"git": false`.
- **Connect to GitHub** (button in the window when there is no remote · owner only): ① the board creates a per-project key `~/.ssh/board-git-<key>` (ed25519 · 600 · never overwritten) and shows only the public key ② on GitHub: an empty **Private** repository + Settings → Deploy keys with that key (**Allow write access**) ③ «Check connection» — **refused if public** (readable over https without auth) · must be readable with that key only (no other ssh config, keys or agent · GitHub host key pinned) → saves `"remote": { "repo": "owner/name", "by", "at", "empty" }` in `projects.json` and queues `[Board — connect remote]` for that project (permission for the first commit and push only · secret filtering · local commit → Fable check → push · never force). The board does not touch the folder. To disconnect: delete the deploy key on GitHub and `~/.ssh/board-git-<key>*`.
- «Restore request» overwrites nothing — it queues `[Board — restore request]` for that project (the copy path is re-resolved by the server inside the registered folder). The session backs up the current state first, asks (⏸) right before overwriting, never writes to production, and for a copy from production first checks that mail/SMS/notifications cannot go out.


**After adding or changing values**: `bash ~/dev-server/kit/verify.sh` (target: 0 ✘). It also checks every enabled button has its command.

## 3. The inquiries box: how a project session fills it

With `inquiries` set, the project's dev-start (and the scheduled "Inquiries" step) runs its inquiry section and posts **every open inquiry**. The board only displays them; the list never opens a session or starts development by itself.

```bash
PORT=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/dev-server/board/config.json"))).get("port",8800))')   # board port — differs per server
curl -s -X POST -H 'Content-Type: application/json' -H "Origin: http://localhost:$PORT" --data-binary @- http://127.0.0.1:$PORT/api/inquiries <<'EOF'
{"project":"<key>","checkedAt":"<ISO time read>","items":[
 {"ref":"fb#12","kind":"inquiry","at":"2026-11-02","who":"signed-in user · <company>",
  "title":"How to edit the date/text of a history line","verdict":"답장만 필요",
  "basis":"existing feature (pencil icon), checked on screen","replied":"아직",
  "next":"reply with draft","needsOwner":true,"link":"https://<prod>/admin/feedback?id=12","draft":"Hello …"}]}
EOF
```

- Each call **replaces** that project's list (closed ones drop off). No open inquiries → `"items":[]`. Could not read production → `{"project":"<key>","ok":false,"note":"why"}`: the previous list stays, marked "could not check". When a «reply + close» job handed over by «Send reply» or auto-send finishes with ✅, that line drops off right away instead of waiting for the next list (if a later list still has it, it shows again). Reply jobs skip the queue's pre-check.
- Max 100 items · `title` 120 chars · `basis` 200 · `next` 120 · `draft` 4,000. `link` must be `https://`.
- `verdict` is one of five fixed words (Korean, shown translated on an English board): `이미 해결` already fixed · `개발 필요` needs development · `결정 필요` needs a decision · `답장만 필요` reply only · `확인 중` checking. Anything else becomes `확인 중`. `needsOwner` is the field name for "needs the owner".

| Field | Write | Don't write |
|---|---|---|
| `title` | **your own one-line summary** of what is asked | the customer's text verbatim · names · emails |
| `basis` | **why this verdict**: commit, deploy, measurement, screen checked | only the ticket status ("received") or internal flags |
| `replied` | what the customer got: not yet · replied (date) · auto-acknowledgement | — |
| `next` | a short session note (shown as "Session note") | — |
| `needsOwner` | `true` **only when the owner must act now**: send a reply (draft ready) or read and decide | `true` on every open item (kills the priority) · items a session/queue already handles |
| `draft` | a **reply draft** (not sent) on owner-facing "reply only"/"already fixed" items. Only facts you verified ("fixed", "refunded") | unverified promises |
| `queueRef` | the queue `ref` if handed to development | — |

The board turns each line into the same plain **"👉 To do"**, so sessions don't need to word it:
- line with a draft = **send a reply**: ① "Send reply" right on the line (owner only: shows the draft in a confirm box; confirming queues "send this exact draft" for that project · the "Close as done after sending" tick next to it is on by default for `이미 해결`/`답장만 필요`) or ② "Copy draft" → "Open admin page", paste, save.
- **Auto-send replies** (top of the inquiry box · owner only · per project · off by default): choose «Already fixed» only, or «Already fixed» + «Reply only», and matching lines (draft + `needsOwner`) are queued like ① as soon as the list arrives (closing included; the task says "the owner did not read this — check every fact against production"). Once per inquiry (a changed draft goes again only by button). Turning it on applies to the current list too. So sessions must set `verdict` strictly from evidence — with auto on, `이미 해결` means "send".
- `needsOwner` line without a draft = **read and decide** in the admin page: go ahead, hold or close. A `확인 중` line shows as «Not judged yet» (it does not mean someone is checking it) and gets **«Ask the session to investigate»** (owner only): it queues an «investigate and recommend only» job for that project (ref `look:<number>` · no pre-check · once per inquiry per 7 days). The session reads the original with the established read-only inquiry query, checks whether it is already fixed and why, re-posts the list through the same inquiry step with that line's `verdict`/`basis` (and a draft) updated, and reports a recommendation. No reply, status/approval change, production write or development.
- A handed-over line (reply or investigation) shows where it is: «#N in the <project> queue» (a session opens only when the one working in that folder finishes — one per project) or «session <id>».
- everything else = nothing to do.

**A session that receives "send this reply" (button or auto)**: the task text is authoritative. In short: only through the project's **established reply path** (`Reply path` in its settings) · dry-run, then apply · if the task says close, close it as done through the same path (no close path → leave the status and report) · otherwise don't change the status · if a fact in the draft is not true in production records, the customer wrote again, or there is no reply path for that kind, **don't send; report ⏸**. The board never queues the same draft twice (a changed draft can be handed over again).

Fill these two lines in the project's "Dev command settings" (new templates have them; add them to older installs):
```
- Read production feedback (read-only): <query command, or none>
- Reply path: <the established command that posts a customer reply, with its dry-run flag; or "none: the owner replies in the admin page">
```

## 4. What sessions post to the board

| Need | Endpoint | Key points |
|---|---|---|
| Ask the owner | `POST /api/asks` | one bold "…?" question · options, outcomes, recommendation |
| An owner action this session's work needs (paste a command, set something in our own admin) | `POST /api/asks` + `"act":true` | `steps`·`links`·`terminal` · when the owner says "done", the same session checks and finishes |
| An owner to-do separate from this session's work (external service screens etc.) | `POST /api/todos` | one of `apart`·`after`·`waitFor` required · write `then` so it can continue without this conversation |
| Independent-review model unavailable (limits) | `POST /api/fable-wait` | the board wakes this session when it frees up |
| Inquiry list | `POST /api/inquiries` | section 3 |
| Hand work to another project / the server session | `POST /api/rooms` `{"queue":true}` | sessions can only queue |
| Hold deploys until this work is done | `POST /api/deploy-hold` | where `deploy` is registered the board deploys; sessions only prepare or hold |

Every write needs the header `Origin: http://localhost:<port>`. Buttons a session may not press (deploy approval, editing schedules, handing a reply to send…) answer 403. Don't work around it; leave it for the owner.

## 5. The board shows… → do this

| You see | Meaning | Do |
|---|---|---|
| Inquiry "send a reply" | the session wrote a draft | "Send reply" on the line → read the draft in the confirm box → OK (no admin page needed) · for routine kinds, "Auto-send replies" at the top of the box |
| Inquiry "read and decide" | needs the owner's call | decide in the admin page · unsure: ask that project's session "recommend what to do with <ref>" |
| Inquiries "could not check" | the session couldn't read production (list below is the previous one) | see that session's report, usually production read access |
| No inquiries box on a card | `inquiries` not set | server session: set `inquiries` (the inquiry section heading, or `true`) |
| "Not in production yet" | the fix is newer than the last production deploy (`prodMarker`) | deploy first, then check in production |
| "Deploy · not connected" | no production server (`prodLabel`/`deploy`) registered for the project | owner clicks it → connection box: have a deploy script → ① enter the one-line command, "Connect and approve this command" · no script → ② "Add to queue" (the project session writes the script and reports the values) |
| top card "<project> deploy failed — <cause>" · deploy button "✗ failed → fix queued / fixing" | the deploy script stopped — the cause is one line read from the log (`board/log/deploy/`): pre-deploy check items · memory · production unreachable · time limit. Production is unchanged (only a time-out is "unknown") | the board puts one "Fix deploy failure" task at the **front** of that project's queue (a repeat failure adds its log to the same task) → when the session ends ✅ the top of the board and your phone say "Deploy failure fixed — press Deploy again" → press Deploy then. Pressing before the fix, the confirm box recommends "Deploy after the fix". Temporary failures (rate limit 429 · memory · connection) first just say "press again in a few minutes"; a second failure in a row queues a fix |
| Mac automatic tunnel installed, but "keep it open" keeps showing | The board recognises the Mac by ① the tunnel type seen on the server (a shell-less `ssh -N` tunnel = automatic, no suggestion · since the 11-19 version) ② the address the installer opened in the *default* browser (`#autotunnel=alias`) — if it still shows, the tunnel was opened together with a shell (terminal-window `ssh -L`) · "drops often (N× in 7 days)" counts outages over 2 minutes while awake that later recovered (sleep is not counted) | "Already installed" in that box → paste the one line into a Mac terminal → if ② says running, open the → address once in this browser · if not, reinstall |
| No "Open as test account" | `devLogin` off or the project has no route | `kit/DEV-LOGIN.md` |
| A member gets «cannot sign in through this route» on the link or sign-in | SSH tunnel opened with an account other than theirs, or Tailscale login field empty/different | [OPERATIONS §1 step 0](OPERATIONS.md) — server account and key need sudo, so give the final approver the commands |
| Several identical entries in the authenticator | `serverName` empty or the same on several servers | give each server its own `serverName` in `config.json` |
| No «🔔 Alerts: default» picker in «New task» and no «Alerts» button on session cards | alerts are set to «everything» (incl. done), so per-task/per-session choice is hidden — `config.json` `notifyKinds` all `true`. With no `notifyKinds` the default is now «only what needs me» (done off); before, it was «everything», so fresh installs never showed the picker | in the board's «Alerts» panel press «Only what needs me» |
| A session stuck at "waiting for permission" | Claude Code permission prompt | approve in `claude attach <id>` · if frequent, `defaultMode: auto` |
| "Waiting for memory" | a build/deploy waits for free memory | wait (don't kill other processes) · if frequent, review `deploy.minMemMb` / server memory |

## 6. Adding a project (server session)

1. In the project folder: `CLAUDE.md` (template `kit/templates/<lang>/solution-CLAUDE.md`) · `.claude/commands/` (only missing ones) · session notes (template `kit/templates/<lang>/solution-session-state.md` — fill `{{NAME}}`, `{{DATE}}`, `{{OWNER}}` and save it at the stateFile path). Never overwrite existing files.
   - A Docker project (no PM2): use the Docker example under «Runtime» in «Dev command settings» — container names, the sudo wrapper command, the test command. projects.json is the same (the board does not look at PM2 for projects).
   - Check that sessions work in the project folder itself: `worktree.bgIsolation` in `~/.claude/settings.json` must be `none` for sessions to see uncommitted changes (`kit/verify.sh` shows it · unset = each session works on its own branch).
2. One entry in `projects.json` (section 2; start with `noDevDone:true`, `prodLabel:null`).
3. Queue for that project's session: "fill the Dev command settings section (build, restart, URL, read inquiries, reply path, deploy)".
4. Turn on only buttons whose command exists, then `kit/verify.sh`.

## 7. Pushing from the dev server to GitHub (deploy key)

Push with a key that works for one project repository only (a deploy key with write access) — never keep a person's account key or token on the server. One key per repository.

1. **Make the key** (server session · per project): `ssh-keygen -t ed25519 -N "" -f ~/.ssh/<name>_deploy -C "<server name>-<repo>"` → fingerprint `ssh-keygen -lf ~/.ssh/<name>_deploy.pub` · public key `cat ~/.ssh/<name>_deploy.pub` (never paste the private key file anywhere)
2. **Ask the repository admin** (the owner does it, or sends this text as is):
   ```
   Repository: <org>/<repo>
   Add a deploy key — Title: <server name>-<repo>
   Public key: ssh-ed25519 AAAA… <server name>-<repo>
   Fingerprint: SHA256:…   (please check the key you add has this fingerprint)
   Allow write access: on (the server pushes)
   Protected branch: keep main protected — the server pushes only to <branch> (e.g. dev); main goes through PRs
   ```
   GitHub screen: repository → Settings → Deploy keys → Add deploy key
3. **Point the project repository at the key** (applies to that repository only · absolute path):
   ```bash
   git -C <project folder> remote set-url origin git@github.com:<org>/<repo>.git
   git -C <project folder> config core.sshCommand "ssh -i $HOME/.ssh/<name>_deploy -o IdentitiesOnly=yes"
   ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts   # once — compare the fingerprint with GitHub's published ones (docs.github.com "GitHub's SSH key fingerprints") · a background session cannot answer the yes/no prompt
   ssh -i ~/.ssh/<name>_deploy -o IdentitiesOnly=yes -T git@github.com   # «Hi <org>/<repo>! …» = key OK (exit code is 1 even then — not a failure)
   git -C <project folder> push --dry-run origin <branch>
   ```
4. **Allow rule for sessions** — Claude Code's auto-mode check may block «connecting to GitHub with a deploy key» (the session stops at push). Put allow rules in that project's `<project folder>/.claude/settings.local.json` (if it exists, add to its `permissions`). First make sure that file is in `.gitignore` (add the line `.claude/settings.local.json` — `/dev-done` runs `git add -A`, so otherwise it gets committed):
   ```json
   {
     "permissions": {
       "allow": [
         "Bash(git push origin <branch>)",
         "Bash(git push --dry-run origin <branch>)",
         "Bash(ssh -i ~/.ssh/<name>_deploy -o IdentitiesOnly=yes -T git@github.com)"
       ],
       "deny": ["Bash(git push --force*)", "Bash(git push -f*)", "Bash(git push * --force*)", "Bash(git push * -f*)", "Bash(git push * +*)", "Bash(git push * main*)", "Bash(git push *:main*)", "Bash(git -C * push*)"]
     }
   }
   ```
   Allow only the agreed branch. The deny rules are only a backstop — what really protects main is the GitHub branch protection asked for in step 2. The owner adds this (a session does not widen its own permissions).
5. **Match the push line in «Dev command settings»**: `- Push: on dev-done yes · command git push origin <branch> · branch <branch> · key: deploy key ~/.ssh/<name>_deploy (core.sshCommand)`. `/dev-done` pushes exactly that; if blocked it does not work around it and reports «push failed — one-line error».
6. When the key changes or the server moves: ask the admin to remove the old key · delete `~/.ssh/<name>_deploy*`.
