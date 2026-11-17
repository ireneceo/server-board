# Shared rules for every Claude Code session on this server ({{DATE}} · set by {{OWNER}})

> This file is attached to every Claude Code session opened on this server.
> Each project's own `CLAUDE.md` takes priority. This file only covers *how we work on this server*.
> Manual: `~/dev-server/README.md`. If you change the structure, update that and this file together.

## Working environment
- Sessions usually run as **background rooms** (`claude --bg`). Assume {{OWNER}} is not watching the screen.
- {{OWNER}} checks the room states (working / waiting for answer / done / off) in the `dev` menu and on the board (http://localhost:{{PORT}}).
- Projects never share code, databases or processes. Don't touch anything outside your project folder.
- Server memory is shared. If a heavy job (e.g. a build) is blocked for memory, **wait** (no bypassing, no killing other processes). If memory slots are on, run heavy jobs as `~/dev-server/kit/bin/mem-slot run <name> <MB> -- <command>` — an un-slotted build is blocked with the exact command to run instead; run that.
- Only one room edits files in a project at a time.

## When to stop (questions and approvals)
1. **First finish everything that question doesn't block.** Don't hold the whole task for one question.
2. Collect questions into one, left at the end: what must be decided, the options, the result of each, and your recommendation, so {{OWNER}} only has to pick.
3. Write "Waiting for answer: what · why · what to do once answered" into the project's notes file (`stateFile` in `projects.json`).
4. No production deploys, production data writes or outgoing messages/emails without {{OWNER}}'s instruction, even in the background.
   - **Working sessions never ask about deploying.** Do not post «Deploy now?» / «+ deploy» questions or waiting items — finish on the dev server and add one line to the report: «Production: goes out with the next deploy». Checking all finished work and deploying happens only in a **manual deploy (the board's deploy button = /deploy session)** or a **scheduled check** (deploy-time terminal commands and version questions are asked there). Exception: this task itself is /deploy or a deploy check, or {{OWNER}} explicitly ordered a deploy in this task.
5. **Post the question to the top of the board.** {{OWNER}} only looks at "needs you now". Do it once, right before a ⏸ report (it gets this room's link and a reply box; it disappears when {{OWNER}} replies in this room):
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:{{PORT}}' --data-binary @- http://127.0.0.1:{{PORT}}/api/asks <<JSON
   {"room":"$(basename "$CLAUDE_JOB_DIR")","title":"one-line title","question":"what to decide · options · result of each","recommend":"recommendation"}
   JSON
   ```
   (In a terminal window without a room id, use `"project":"<project key>"` instead of `"room"`.) If a person must **run a command in a terminal**, add `"terminal":["! command to paste, exactly"]`. The board shows a "Do it in the terminal" guide with copy buttons. A command that asks for a password (sudo) cannot run inside the session with `!` — write it without `!` (`"terminal":["sudo …"]`) and the board tells the person to paste it at the server command line. The posted question and your last report must give the same command and the same place to run it.

6. **Split off what only {{OWNER}} can do as an "{{OWNER}} to do" card and keep working on the rest.** Actions, not decisions: sudo/password commands, production access, settings in an outside service's dashboard, issuing keys or accounts, payments. Don't stop with a question (⏸) for these. If everything else is done, report ✅ with one line "{{OWNER}} to do: <title> — posted to the board":
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:{{PORT}}' --data-binary @- http://127.0.0.1:{{PORT}}/api/todos <<JSON
   {"room":"$(basename "$CLAUDE_JOB_DIR")","title":"one action line for {{OWNER}} (\"Do …\")","why":"why only {{OWNER}} can do it","steps":["step 1 exactly as to follow (screen, menu, value)","step 2"],"links":["https://… screen to open"],"terminal":["! command to paste"],"then":"what to do after \"Done\""}
   JSON
   ```
   The board shows steps, links and copy buttons under "For {{OWNER}} to do". When {{OWNER}} presses "✓ Done" (or "Done + this note"), the board sends `then` to this session (or a new session in that project if this one is off), so write `then` so it can continue without this conversation. If {{OWNER}} sends a message with "💬 Ask before doing", the card leaves the list until the session decides again. Before reporting, do one of: ① no longer needed → `POST /api/todos/drop` {tid, reason} ② steps changed → post again with the same tid ③ unchanged → nothing (the card comes back with your report's first line). The session that picks it up first checks (read-only) that {{OWNER}}'s action really worked; if not, post what's missing as a new to-do. Post several to-dos separately. A "### {{OWNER}} to do" section in the notes file shows in the same place. **If the command starts with "!" (runs inside this session), {{OWNER}} only pastes it into the session.** The session continues as soon as the output arrives and the card clears itself, so don't write "press Done when you see the output". **Do not post checks/tests ("see whether it works", "verify on a real device") as to-dos** — {{OWNER}} looks at "Where to check" on the finished task and marks it "Checked"; a to-do for the same check is a second, duplicate instruction. Put one line in "Where to check" (URL — what to look at, "on a phone" if needed) and do any follow-up now or note it under "Next" in the session log. If {{OWNER}} must first do an action (setting, install, sudo), post only that action — the board refuses check cards. **Keep cards short**: at most 4 steps, 120 characters per step, `why` 200 characters; only screen, button and value, no background (the board refuses longer cards). Don't put "write the result as a note" or "press Done" in steps.

## Reports
- The last report's first line starts with the status: `✅ Done` / `⏸ Needs answer` / `❌ Blocked` / `🕓 Later`. Use "🕓 Later" only when {{OWNER}} already answered and it's waiting for its time (an outside outage, "let's do it tomorrow", …). The board shows it in green under "later", not red. In the notes file write "### Later — what · when/under what condition · what to do then" instead of "Waiting for answer". **The board reads this first line and the "Waiting for answer" headings in the notes file.** Add "(previous)" to the heading of old "Waiting for answer" sections.
- A ✅ Done report includes a **"Where to check"** section: full dev URLs and, for each, one line on what to check there.
  - If the screen must be seen as a specific role, end the line with `[as=<role key> <scope>=<id>]` (e.g. `- https://dev.x/tasks/12 — 3 tasks listed [as=owner ws=6]`). Role keys and scope names are in the project CLAUDE.md "Test roles" table. If the project has dev-login on, the board adds an "Open as test account" button (`kit/DEV-LOGIN.md`).
  - Do not delete the test data such a line shows — name it with `[check]`; `[check]` data older than 7 days is removed by the project's own cleanup. Never create it on real customer data.
- Never call unfinished work done. Write "not verified" for anything you didn't check.
- Talk to {{OWNER}} in {{LANG}}, with code terms in plain words.

## Permission denied
- If a permission is denied, don't get the same result another way. Record it, continue with other unblocked work, and list it under "{{OWNER}} to do" in the report.

## Independent review (use sparingly)
- **Use the strongest model available (Fable if your plan has it, otherwise Opus) only for "decisions that are hard to undo if wrong, or that a machine check can't settle".** Research, measuring, building and machine-checkable verification stay with the working model.
- Use it for: ① **design** of new features, DB structure, rules shared by several screens, forked structural choices ② **completion check of hard-to-undo changes**: money, production DB structure/bulk edits, login, permissions, public URLs, outgoing messages, deletes, protected areas ③ **calculations**: new or changed formulas for amounts, tax, stock, settlement, statistics ④ **UI/UX quality**: one design pass + one finished-screen pass for new screens and core flows (first run, order, payment, sign-up) ⑤ **verification design** when it's unclear what to prove ⑥ **root cause** after two failed fixes or several possible causes, plus a recommendation when asking {{OWNER}} a hard-to-undo choice.
- Don't use it for: implementing an agreed design · spacing/colors/wording/simple bugs (measure in a real browser) · fixes checked against a known answer · small doc/internal-tool edits. If unsure, don't call it and write "no independent review — reason". Self-verification is run for real, in numbers, labelled "self-verified".
- Budget: at most 2 per topic (design 1 + verification 1), bundle questions, pass facts briefly and copy the result unchanged.
- **If limits block it**: don't skip silently. If design is blocked, don't start building. If verification is blocked, leave self-verification numbers and postpone production deploy. Add it to the board's wait list:
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:{{PORT}}' --data-binary @- http://127.0.0.1:{{PORT}}/api/fable-wait <<JSON
   {"room":"$(basename "$CLAUDE_JOB_DIR")","kind":"design|gate|calc|ux|verify|cause|decision","title":"one-line title","need":"what the reviewer must see: doc paths, changed files, self-check numbers","resetAt":"ISO time from the limit error, if any"}
   JSON
   ```
   In the notes file "### Later — waiting for review: what · when limits reset · what to do then", report first line `🕓 Later — waiting for review: …`. The board wakes this room at the reset time (or 3 hours later) to try again. When you get the verdict, post `{"room":"<room id>","done":true}` to the same URL.
