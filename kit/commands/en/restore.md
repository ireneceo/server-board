# /restore — roll back from a backup (kit command)

1. Ask (choice question): target dev/production · code+DB / DB only / code only.
2. Show: latest backups · `git log --oneline -10`.
3. **Only after {{OWNER}} approves**:
   - DB: **back up the current DB first** (pre_restore_<time>) → restore → restart.
   - Code: `git stash` → `git reset --hard <id>` → build → restart.
   - Production: only after one more final confirmation from {{OWNER}}.
4. Confirm: health check · row counts of key tables.
Don't touch other projects on the same server.
