# Server guide: read this first on each server

[한국어 →](SERVER-GUIDE.ko.md)

> The board code is the same on every server. **Everything that differs per server or per project lives in the files below**: change values, not code (code edits collide with new releases).
> The server session (`~/dev-server`) and each project session look here for "where do I change this?" and "the board shows X, what am I supposed to do?".
> Installing: [AI-SETUP-PROMPT](AI-SETUP-PROMPT.md) · daily running: [OPERATIONS](OPERATIONS.md) · team members: [TEAM-GUIDE](TEAM-GUIDE.md).

## 1. What differs per server, where it lives, who changes it

| What | File | Changed by | After a change |
|---|---|---|---|
| Owner name, language, time zone, port, SSH command, server name (authenticator entry) | `~/dev-server/board/config.json` (see `config.example.json`) | server session | `pm2 restart dev-board` |
| Project list and per-project buttons, deploy, inquiries, markers | `~/dev-server/projects.json` (section 2) | server session | live on save |
| External services per project (key names only) | `~/dev-server/services.json` | server session | live |
| How every Claude on this server works | `~/.claude/CLAUDE.md` | server session (on the owner's instruction) | new sessions |
| One project's rules: build, restart, deploy, reading inquiries, reply path | `<project>/CLAUDE.md` "Dev command settings" | **that project's session** | new sessions |
| Project commands (/dev-start …) | `<project>/.claude/commands/` | that project's session | live |

- The server session never edits inside a project folder. If a project needs a change, queue it: `POST /api/rooms {"project":"<key>","task":"…","queue":true}`.
- Never write secrets (.env values, tokens, DB passwords) into any file. Write **where** they are.

## 2. `projects.json` fields

Required: `key` (lowercase, used in queue/questions) · `name` (display) · `dir` (project folder) · `stateFile` (session notes, usually `.claude/session-state.md`).

| Field | Value | Turns on | Without it |
|---|---|---|---|
| `devUrl` | dev site URL | "Where to check" links in reports | plain text |
| `noDevDone` | `true` | hides the **Dev done** button | button shown (the project needs a `/dev-done` command; `kit/verify.sh` checks) |
| `prodLabel` | e.g. `"MyApp production"` | **Deploy** button (type the project key to open) · "deploy" step in scheduled checks | no deploy button |
| `deploy` | `{command, dryRun, prep, timeoutMin, minMemMb, rollback, extraScripts}` | the board runs the deploy command **itself** (only the command the owner approved on screen; a change needs re-approval) · `dryRun` = test-deploy args · `prep:true` = an AI prep session first · `minMemMb` = only with this much free memory · `timeoutMin` = stop after · `rollback` = shown on failure (never run) · `extraScripts` = fingerprinted for changes | an AI `/deploy` session deploys |
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

**After adding or changing values**: `bash ~/dev-server/kit/verify.sh` (target: 0 ✘). It also checks every enabled button has its command.

## 3. The inquiries box: how a project session fills it

With `inquiries` set, the project's dev-start (and the scheduled "Inquiries" step) runs its inquiry section and posts **every open inquiry**. The board only displays them; the list never opens a session or starts development by itself.

```bash
curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' --data-binary @- http://127.0.0.1:8800/api/inquiries <<'EOF'
{"project":"<key>","checkedAt":"<ISO time read>","items":[
 {"ref":"fb#12","kind":"inquiry","at":"2026-11-02","who":"signed-in user · <company>",
  "title":"How to edit the date/text of a history line","verdict":"답장만 필요",
  "basis":"existing feature (pencil icon), checked on screen","replied":"아직",
  "next":"reply with draft","needsOwner":true,"link":"https://<prod>/admin/feedback?id=12","draft":"Hello …"}]}
EOF
```

- Each call **replaces** that project's list (closed ones drop off). No open inquiries → `"items":[]`. Could not read production → `{"project":"<key>","ok":false,"note":"why"}`: the previous list stays, marked "could not check".
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
- line with a draft = **send a reply**: ① "Have the session send it" (owner-only button: queues "send this exact draft" for that project) or ② "Copy draft" → "Open admin page", paste, save.
- `needsOwner` line without a draft = **read and decide** in the admin page: go ahead, hold or close.
- everything else = nothing to do.

**A session that receives "send this reply"**: the task text is authoritative. In short: only through the project's **established reply path** (`Reply path` in its settings) · dry-run, then apply · don't change the status · if a fact in the draft is not true in production records, the customer wrote again, or there is no reply path for that kind, **don't send; report ⏸**. The board never queues the same draft twice (a changed draft can be handed over again).

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
| Inquiry "send a reply" | the session wrote a draft | read it → "Have the session send it" or "Copy draft" → admin page |
| Inquiry "read and decide" | needs the owner's call | decide in the admin page · unsure: ask that project's session "recommend what to do with <ref>" |
| Inquiries "could not check" | the session couldn't read production (list below is the previous one) | see that session's report, usually production read access |
| No inquiries box on a card | `inquiries` not set | server session: set `inquiries` (the inquiry section heading, or `true`) |
| "Not in production yet" | the fix is newer than the last production deploy (`prodMarker`) | deploy first, then check in production |
| No deploy button | no `prodLabel` or no `/deploy` command | server session: section 2 · `kit/verify.sh` |
| No "Open as test account" | `devLogin` off or the project has no route | `kit/DEV-LOGIN.md` |
| Several identical entries in the authenticator | `serverName` empty or the same on several servers | give each server its own `serverName` in `config.json` |
| A session stuck at "waiting for permission" | Claude Code permission prompt | approve in `claude attach <id>` · if frequent, `defaultMode: auto` |
| "Waiting for memory" | a build/deploy waits for free memory | wait (don't kill other processes) · if frequent, review `deploy.minMemMb` / server memory |

## 6. Adding a project (server session)

1. In the project folder: `CLAUDE.md` (template `kit/templates/<lang>/solution-CLAUDE.md`) · `.claude/commands/` (only missing ones) · session notes. Never overwrite existing files.
2. One entry in `projects.json` (section 2; start with `noDevDone:true`, `prodLabel:null`).
3. Queue for that project's session: "fill the Dev command settings section (build, restart, URL, read inquiries, reply path, deploy)".
4. Turn on only buttons whose command exists, then `kit/verify.sh`.
