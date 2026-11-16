# {{NAME}} — project rules (Claude Code)

> **{{NAME}} = {{ONE_LINE}}** (what it is, who uses it, in one line)
> Attached to every Claude opened in this folder (`{{DIR}}`). The server-wide rules (`~/.claude/CLAUDE.md`) also apply; where they overlap, this file wins.
> When a structural rule is settled, add it below as "## Rule name (fixed on <date>)" so nobody asks again or builds it differently.

## 🔒 Isolation (top priority)
- Edit this project's code and docs **only inside `{{DIR}}`**. Never open or edit other project folders ({{OTHER_DIRS}}).
- DB: `{{DB_NAME}}` only · PM2: restart only `{{PM2_NAMES}}` · ports: {{PORTS}}. Never touch other projects' processes or databases.
- Never connect to the production server ({{PROD_HOST}}) directly. Production changes go only through the board's Deploy button (= `/deploy` session).

## Dev environment
- Dev URL: {{DEV_URL}}
- Folders: (e.g. `backend/` · `frontend/`) · run/build/restart: see "Dev command settings" at the bottom
- **Dev vs production**: all work happens on dev. Writing production data or sending anything outside (email, SMS, announcements) only on {{OWNER}}'s instruction.
- Secrets (.env, DB passwords): write only **where** they are: {{SECRETS_WHERE}}

## Working order
- Start: `/dev-start` (notes, incoming feedback, next task). Scheduled checks use it too.
- Posting inquiries to the board's "✉ Inquiries" box, what each field means, and what to do when handed "send this reply": `~/dev-server/docs/SERVER-GUIDE.md` section 3.
- Large features (3+ new tables, several APIs, role-specific screens, integrations): `/feature-design` first → {{OWNER}} approves.
- After building: `/verify` (run it for real, in numbers: build, API round trips, real browser) → `/dev-done` (notes, commit, backup).
- Working sessions never ask about deploying: one line "Production: goes out with the next deploy". Deploys happen only in a `/deploy` session.
- Notes file: `.claude/session-state.md` (the board reads "Waiting for answer" and "Next up").

## Hard to undo (independent review required)
> Examples for the shared "independent review" rule. Anything here gets `/fable-verify` before it is called done.
- Money: (payments, settlement, refunds — code locations)
- Login and permissions: (auth middleware, role checks)
- Deletes, bulk edits, DB structure changes: (migration scripts)
- Outgoing messages: (where email/SMS/push is sent)
- Protected areas of this project: (e.g. printing, order flow — ask {{OWNER}} before changing)

## Test roles (board "Open as test account" — `~/dev-server/kit/DEV-LOGIN.md`)
| Role key | Test account (where it is written) | What it can see | Scope names |
|---|---|---|---|
| `owner` | (e.g. dev DB seed `scripts/seed.js`) | (screens for that role) | (e.g. `ws=<id>`) |

- End a "Where to check" line that shows a role's screen with `[as=<role key> <scope>=<id>]`.
- Don't delete the test data such a line shows: prefix names with `[check]`; data older than 7 days is removed in `/dev-done` cleanup. Never create it on real users' data.
- Once the dev-login route exists, set `"devLogin": true` for this project in `~/dev-server/projects.json` (server room's job).

## Security
- Auth on everything except public routes · validate user input · never log sensitive data · `npm audit` (or equivalent) after new dependencies.
