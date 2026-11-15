# /dev-start — start the day (kit command)

Values come from the "Dev command settings" section of this project's `CLAUDE.md`. Missing value → report "none" and skip.

1. **Other work in progress**: `git status --short` · `git diff --stat`. Never overwrite changes another room/tool left. If they overlap with your task, stop and report.
2. **Read the notes file** in full.
3. **Incoming feedback** (only if "Read production feedback" is set; read-only): read the originals yourself, don't trust summaries. For each item first check whether it's already fixed (code, data, deploy log) → sort into "already solved / to do / needs a decision". Write the checked IDs and time into the notes file. If production access is blocked, don't work around it. Report it.
4. **Docs and structure**: all "must-read docs" · "structure overview".
5. **Report**: first line status (✅ Done / ⏸ Needs answer / ❌ Blocked). Feedback table first (id · summary · verdict · evidence), then:
   - work in progress → summary + what continues next
   - "Next up" exists → that task + references
   - neither → "Waiting for instructions". **Don't invent new work** (quote "Ideas" as notes only).

Rules: no open questions like "what should I do?" (give options + a recommendation). No customer replies or production writes without {{OWNER}}'s instruction (drafts only).
