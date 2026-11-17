# /dev-done — wrap up with notes, commit and backup (kit command)

The board finds the last **commit containing "dev-done"** in git and shows it as "last dev-done". Always put that word in the commit title.

0. **Gate**: `/verify` fully passes. If the change is in "Must get independent review", `.claude/.review-gate.json` must hold a PASS matching the current change (otherwise run `/fable-verify` first). "Nothing changed" ≠ "verified".
1. **Separate changes**: `git status` · `git diff --stat`. Mark changes from other rooms/tools separately; don't describe them as yours. If the board shows another "working" room in this folder, stop and ask.
2. **DEVELOPMENT_PLAN.md** (if present): `## ✅ Done: title (date)` + changed files.
3. **Docs**: actually read the docs related to what changed and fix what's out of date (or write "reviewed, nothing to fix"). Claiming a fix you didn't make is a false report.
4. **CHANGELOG.md** (if present): under `[Unreleased]` add `### date` + one user-level line per change.
5. **Rewrite the notes file** (rewrite, don't append): In progress · Waiting for answer · Done (this time) · Next up (only what {{OWNER}} asked for; otherwise "none — waiting for instructions") · Ideas. Don't bump the version (that's /deploy).
6. Re-read the files you changed.
7. **Commit**: `git add -A && git commit -m "chore: dev-done YYYY-MM-DD — <one-line summary>"`. Push only if the setting says yes — exactly the setting's push command and branch (never force). If a key or permission error blocks it, do not work around it; report «push failed — one-line error» (SERVER-GUIDE section 7).
8. **Backup** per the "Backup" setting (exclude node_modules and build output) · delete backups older than 7 days.
9. **Report** (first line ✅/⏸/❌): what was done · docs · commit id · backup location · next up · "Where to check" links.
Never deploy to production.
