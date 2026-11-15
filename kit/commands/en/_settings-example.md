<!-- Append this section to the end of each project's CLAUDE.md (the installer fills it in). The commands below (/dev-start, /dev-done, /verify, …) all read their values from here. Unknown fields: "none". -->
## Dev command settings (read by the kit commands)
- Owner: {{OWNER}}
- Notes file: .claude/session-state.md
- Must-read docs: CLAUDE.md · DEVELOPMENT_PLAN.md · (design docs)
- Structure overview: (e.g. `ls backend/models backend/routes frontend/src/pages`)
- Build: (e.g. `cd frontend && npm run build`) · Memory gate: (command, if any)
- Restart: (e.g. `pm2 restart myapp-backend`) · Logs: (e.g. `pm2 logs myapp-backend --lines 30 --nostream`)
- Health check: (e.g. `curl -s localhost:3000/api/health`)
- Automated checks: (e.g. `npm test` / `node scripts/verify-all.js` — or none)
- Dev URL: https://dev.example.com · Test accounts: (only WHERE they are written — never passwords here)
- Key screens (check in a real browser): /, /login, …
- Read production feedback (read-only): (e.g. a read-only query script — or none)
- Backup: (e.g. tar into `backups/dev-daily/`, keep 7 days) · DB backup command: (if any)
- Push: on dev-done yes / no (default: no)
- Deploy: script (e.g. `scripts/deploy.sh`) · production health URL · or "no deploy"
- Must get independent review: money/orders/payments · production DB changes · auth/permission boundaries · new structures · (this project's protected files)
