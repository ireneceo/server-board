# How it works: the contract between agents and the board

(한국어 값은 표 오른쪽 칸에 함께 적었습니다.)

The board never guesses from code. It reads three things the agents write, plus Claude Code's own room list.

## 1. Report first line

The **last report** of a room starts with a status. The board decides by the **leading emoji**; the words are for people.

| Emoji | English | 한국어 | Board shows |
|---|---|---|---|
| ✅ | `✅ Done` | `✅ 완료` | Done (open it, read, "✓ Confirm done") |
| ⏸ | `⏸ Needs answer` | `⏸ 답 필요` | Red, in "needs you now" |
| ❌ | `❌ Blocked` | `❌ 막힘` | Red, in "needs you now" |
| 🕓 | `🕓 Later` | `🕓 나중에` | Green "later" list: the owner already answered; it waits for a time/condition |

A room that is cut off **without** one of these lines (and started within 48 h, not stopped by a person) gets an automatic "continue" (max 2 times per room).

## 2. Questions to the top: `POST /api/asks`

```bash
curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' --data-binary @- http://127.0.0.1:8800/api/asks <<JSON
{"room":"$(basename "$CLAUDE_JOB_DIR")","title":"One-line title","question":"What to decide · options · result of each","recommend":"Recommendation","terminal":["! command the owner must paste (optional)"]}
JSON
```

- `room`: the background room id (`$CLAUDE_JOB_DIR`'s last folder). From a plain terminal session use `"project":"<key>"` instead.
- It disappears by itself when the owner replies in that room. `expiresAt` (ISO) is optional.
- `terminal` (up to 4 commands) shows a "Do it in the terminal" guide with copy buttons.

## 2-1. Things only the owner can do: `POST /api/todos`

When part of a task needs the owner's hands (a sudo/password command, production access, a setting in an external service's console, issuing a key, a payment, checking on a real phone), the agent splits just that part off and keeps working on the rest — it does not stop with a question.

```bash
curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' --data-binary @- http://127.0.0.1:8800/api/todos <<JSON
{"room":"$(basename "$CLAUDE_JOB_DIR")","title":"One-line what","why":"Why only the owner can do it","steps":["Step 1 exactly as the owner does it","Step 2"],"links":["https://screen-to-open"],"terminal":["! command to paste (optional)"],"then":"What to do after the owner presses Done"}
JSON
```

- Shown in a separate blue "For <owner> to do" box (not the red "needs you now" box), with steps, links and copyable commands. A room may post several.
- It does **not** disappear when the owner talks to the room — only on **Done** (optionally with a note), Later, or Remove.
- On **Done** the board sends `then` (plus the steps and the owner's note) to the same room, delivered after its current turn if it is working; if the room is gone, `then` becomes a new task in that project's queue. Without `then`, Done just removes the item.
- `<Owner> to do` sections in the notes file (below) show in the same box; Done sends "mark it ✔ and continue" to the linked room or a new one.

## 3. Project notes file (`stateFile` in `projects.json`)

Markdown headings (`##` to `####`, case-insensitive) the board reads:

| Meaning | English headings | 한국어 제목 |
|---|---|---|
| Owner must answer (top box) | `Waiting for answer`, `Decision needed`, `<Owner> to do` | `답 기다림`, `결정 대기`, `<주인> 할 일` |
| Work items (shown on the card) | `Next up`, `Next confirmed`, `Next task`, `Top priority`, `In progress` | `다음 확정 작업`, `다음 할 일`, `최우선`, `진행 중인 작업` |
| Green "later" list | headings starting with `Later` | `나중에 …` |
| Ignored | `(previous)`, `previous log`, `done`, `finished`, `ideas`, `backlog`, `on hold` | `(이전)`, `완료`, `후속 후보` … |

Items reading `none` / `nothing to do`, or containing ✅/✔, are skipped. Mark old question sections with `(previous)` / `(이전)` instead of deleting them.

## 4. Tasks the board starts

- `POST /api/rooms {"project":"<key>","task":"…","queue":true}` → queued; started with `claude --bg` in that project's folder when no other room is editing there (max 3 rooms server-wide).
- A shared header is put before the task (owner isn't watching, ask once at the end, no production actions, status first line, "check here" links). The task itself follows a `[Task]` / `[할 일]` marker. Tasks that start with `/` (commands) get no header.
- Room titles: when a task is queued the board makes one small `claude -p --model haiku` call to turn it into a short title (falls back to the first line). It uses a little of your Anthropic usage.
- Everything the board itself sends into a room starts with `[Board …]` / `[상황판 …]`, so it's never mistaken for the owner's words.
- Scheduled checks (`POST /api/schedules {"project":"<key>","steps":["devdone","devstart"],"time":"HH:MM","days":[1,2,3,4,5]}`): any time of day; only the ticked steps run, in one room, in the order dev-done (if needed) → deploy readiness check → dev-start. If "deploy" is ticked and nothing blocks it (dev-done ✅, new commits, checks pass, no Fable wait, no related open question), the room deploys right away; if the permission check blocks the deploy command it posts that one command to the top (expires at midnight in the board time zone). Untick "deploy" to turn this off.
- Buttons open rooms with commands, by `lang`: `/dev-start` `/dev-done` `/deploy` (en) · `/개발시작` `/개발완료` `/배포` (ko). The board shows "last dev-done" from the newest git commit containing `dev-done` / `개발완료`.

## 5. Config (`board/config.json`)

| Key | Default | Notes |
|---|---|---|
| `owner` | `Owner` (en) / `주인` (ko) | Name shown on the board and in task headers |
| `lang` | `en` | `en` or `ko` |
| `timezone` | `UTC` | IANA name (`America/New_York`, `Asia/Seoul`, …), used by schedules and expiry; DST-aware |
| `port` | `8800` | |
| `devSsh` | – | `ssh user@server`, shown in "open this room in a terminal" |
| `linkExample` | – | Example "check here" URL in the task header |
| `hideLinkHosts` | `[]` | Address prefixes never turned into link buttons |
| `linkPaths` | `[]` | Path first words turned into dev-URL links |
| `supportUrl` | `https://care.wor-pro.com/inquiry.php` | Footer help link; `""` hides it |
| `aiLang` | same as `lang` | Language sessions report in (any language) |
| `serverName` | host in `devSsh` | Name in authenticator apps («Server Board · <serverName>») — different per server |
| `docsUrl` | board's own `/docs/INSTALL.md` | Where «First install and full guide» points |
| `pushContact` | placeholder | Contact sent with web-push alerts (`mailto:` or `https:`) |
| `repoUrl` | the public repository | Where update checks and docs point |
| `nginxUser` | `www-data` | Account nginx runs as (dev-site gate) |
| `ntfy` · `team` | – | Set from the board («Alerts», «⚙ Team & roles»); `team.memberTotp` (default true) = members register their own authenticator |

## 6. What Claude Code internals it depends on

`claude --bg`, `claude agents --json --all` (fields `id`, `name`, `cwd`, `sessionId`, `status`, `pid`, `startedAt`), `claude attach`, `claude stop`, `claude --bg --resume <sessionId>`, `~/.claude/jobs/`, and session transcripts under `~/.claude/projects/`. If an update changes them, `kit/verify.sh` fails first and the board shows "unavailable" instead of crashing.

## 7. First setup (`/api/setup/*`)

Shown until setup is marked done (`state.json` → `setup.doneAt`). Boards that already have projects are marked done automatically.

- `GET /api/board` → `setup: { done, doneAt, doneBy, items:[{key:'claude'|'login'|'permissions'|'trust'|'boot', ok:true|false|null, need, title, detail, why, cmds}], verify:{at,fails,out}|null, installer:{at,version,by}|null, ai:{state:'ready'|'blocked'|'running'|'asking'|'continue'|'done', reason?, room?} }`. Items are detected read-only on the server (`claude --version`, `claude auth status`, `~/.claude/settings.json`, `~/.claude.json` trust flag, `systemctl is-enabled pm2-<user>`).
- `POST /api/setup/start` → queues a "Setup" session in the server room with the setup prompt (`docs/AI-SETUP-PROMPT*.md`). 409 codes: `DONE`, `NO_SERVER`, `RUNNING`, `NO_CLAUDE`, `NOT_LOGGED_IN`, `PERMISSIONS`. If a Setup session exists and stopped without ✅, the same call continues it.
- `POST /api/setup/recheck` · `POST /api/setup/verify` (runs `kit/verify.sh`, stores the output) · `POST /api/setup/done {by}` · `POST /api/setup/reopen`.
- The Setup session posts the intake sheet as one `/api/asks` card (up to 10000 characters) and owner actions as `/api/todos` cards; it is done when its report's first line is ✅ (then the board runs `verify.sh` once).
- `install.sh` writes `~/dev-server/install-info.json` (version, language, port, what it installed, whether it changed settings); the board only reads it.

