# /deploy — release to production (kit command)

**Only when {{OWNER}} explicitly ran `/deploy`.** A finished build is not a reason to deploy. If the setting is "no deploy", report that and stop.
(The board's Deploy button opens a room with this command. The owner must type the project key, and it's blocked if a deploy room is already running.)

0. **Ask about the version first** (choice question): "Bump the version? (now x.y.z → x.y.z+1)". Bumping after deploy shifts the records by one.
1. **Pre-checks**: dev health passes · `git status` clean · nothing changed since the last `/dev-done` · if the deploy script has a dry-run, run it first.
2. **Run the deploy script** ("Deploy" setting). What it should do: production backup → build (memory gate) → copy files (protect .env) → dependencies and DB changes (safe to run twice) → restart → health check and smoke test → deploy record (commit, time). Gate-skipping options only when {{OWNER}} says "emergency".
3. **Confirm**: production health URL · home page 200 · process status.
4. **Record**: CHANGELOG `[Unreleased]` → `## [vX] — date deployed` · a user-facing update note (only changes users can see).
5. On failure report the output as is. Rollback (restore backup) only after {{OWNER}} approves.
Don't touch other projects on the same server. Never write .env values into the chat.
