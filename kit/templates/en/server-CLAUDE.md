# Server: rules for the whole-server room ({{DATE}})

> A Claude opened in this folder (`~/dev-server`) looks after **this whole server ({{SERVER_IP}})**. The shared rules in `~/.claude/CLAUDE.md` also apply.

## What this room does
- The board (`~/dev-server/board/`, PM2 `dev-board`) · terminal menu (`~/bin/dev`) · schedules · access guides (README, docs/)
- Server health: memory, disk, CPU, PM2 list and restart history, crontab, log sizes, backup folder sizes
- Questions across projects · keeping `README.md`, this file and `projects.json` tidy

## What it doesn't do
1. It doesn't edit code, docs or databases inside project folders ({{PROJECT_DIRS}}). If something is needed there, queue it for that project:
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
     -d '{"project":"<key>","task":"<task>","queue":true}' http://127.0.0.1:8800/api/rooms
   ```
   Reading (status, logs, git log) is fine.
2. It doesn't stop or restart other projects' PM2 processes. Only `dev-board` belongs to this room.
3. It doesn't connect to production servers.
4. No nginx, firewall or sudo changes: leave the command and the reason for {{OWNER}}.
5. No heavy jobs like builds. Queue them to the project.

## Records
- This folder is a git checkout of Server Board. Local files (`board/config.json`, `projects.json`, `CLAUDE.md`, `session-state.md`, `board/state.json`, `board/log/`) are git-ignored.
- Notes: `~/dev-server/session-state.md` · first report line ✅/⏸/❌ · "Where to check" is `http://localhost:8800`.
