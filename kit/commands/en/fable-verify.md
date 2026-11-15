# /fable-verify — independent review by a different, stronger model (kit command)

So the model that built it doesn't declare its own work "done", **start a separate review with the strongest model available** and have it actually run things.

1. Scope: `git status --porcelain` + `git diff` (code changes, excluding docs/notes).
2. Start an Agent sub-task with `model: "fable"` (if your plan doesn't have it: `model: "opus"`). Pass **facts only**: {{OWNER}}'s original request · changed files · design doc paths · measured results. Prompt skeleton:
   > You are an independent verifier. Don't judge by reading code; run and call things to check. When in doubt: FAIL.
   > ① Is the change within the agreed design (0 out-of-scope changes)? ② Automated checks and build: 0 failures ③ Real calls: log in → create/update/delete → reload matches · unauthorized user 403 · one old-shape production record · temp files cleaned ④ Deploy safety: DB changes give the same result when run twice · a rollback path exists.
   > PASS/FAIL + evidence per item. Any FAIL → overall FAIL. **The last line is exactly `VERDICT: PASS` or `VERDICT: FAIL`.**
3. Save the result unchanged to `.claude/review-verdict-<date>-<topic>.md` and copy it into the report.
4. PASS → `.claude/.review-gate.json` = `{"commit":"<HEAD>","files":"<sha256 of changed-file list>","ts":"…","by":"<model>"}`. FAIL → write no gate; fix and run again.
5. If the review can't start (limits, usage, overload): run self-verification for real, report numbers and "not independently reviewed (self-verified)". It doesn't count as a pass, and production deploy waits. Put it on the board's review-wait list (`/api/fable-wait`, kind `gate`; see `~/.claude/CLAUDE.md`) so the board wakes this room when limits reset. Report first line `🕓 Later — waiting for review: …`.

When to use it: only for "decisions that are hard to undo if wrong, or can't be checked by a machine". At most 2 per topic (design 1 + verification 1).
When asking {{OWNER}} a big decision, attach the reviewer's recommendation.
