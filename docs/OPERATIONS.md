# Operations — people, sign-in, emergency recovery

> For the people who run this board (final approver, server admin). Written with role names.
> **Server-wide** = once at install, for the whole server · **Per project** = chosen per project in ⚙.
> Marks: ✔ actually walked through · ⚠ not yet walked through (update after trying)

## 1. Add a person (per project — choose their projects)
1. Board **⚙ Team & roles** → **+ Add account**
2. ID: pick their server account if they have one; otherwise «(Tailscale only)» plus their Tailscale login (e.g. name@example.com)
3. Name · role (member / designer / viewer / final approver) · tick their projects → **Save**
4. On their row, **Sign-in link** → send them the address. **Single use within 24 hours.** Use the address for their route (SSH tunnel: `http://localhost:<port>/…`; Tailscale: `https://…ts.net…/…`)
5. They open it, register **their own phone's authenticator app** (QR · 6 digits), set a password (10+ characters) and are signed in — the 10 backup codes are theirs
- **Members also use an authenticator** (⚙ Team & roles ①, on by default · server-wide): turn it off and members, designers and viewers sign in with a password only. Anyone who only set a password (e.g. the setting was turned on later) is told at sign-in to get a new link — send their row's Sign-in link again. Each row shows «authenticator ✔ / ⚠ none»
- The app entry is named «Server Board · <server name>» (config.json `serverName`, else the host in `devSsh`). With boards on several servers, give each a different name so entries are easy to tell apart

✔ Link → password → sign-in → role shown: tested on a test board (2026-10-29) · ⚠ not yet with a real member

## 2. Change a role · pause · remove
- Change the role and save → applies **from their next request**
- Untick «On» and save → they are **signed out at once** and cannot sign in until re-enabled (password kept)
- **Remove** and save → password and sessions are deleted (re-adding starts over with a new link)
- **Sign out** on their row → signs out all their devices (account unchanged)

✔ Immediate role change, off and remove: tested on a test board (2026-10-29)

## 3. Off-boarding — revoke everything together
1. Board: ⚙ Team & roles → **Remove → Save**
2. Server admin: remove their SSH key on the server (their account's `~/.ssh/authorized_keys`, or lock the account) — server-wide
3. Tailscale admin: remove their devices from the tailnet (admin console → Machines)
4. Add any shared secret they knew to the rotation list

⚠ Steps 2–4 not yet walked through

## 4. Change my password
Top of the board **👤 name · role** → «Change password». Other devices are signed out. Anyone with an authenticator also enters its code.

## 5. Final approver emergency recovery (server-wide · server terminal only)
When: forgot the password · lost the phone with the authenticator (and no backup codes) · someone may have used your account.
1. In a **terminal logged in over SSH as the account that runs the board**: `dev recover`
2. At once: everyone is signed out and **nobody (members included) can sign in until you finish**
3. Open the link for your route (10 minutes, single use), set a new password and register the authenticator again → write down the 10 backup codes
4. Sign-in opens again. Members sign in with their existing passwords
- After 10 minutes, run `dev recover` again
- Refused inside an AI session or without a typed terminal (a rule — not an OS permission until accounts are separated)
- Works while the board is stopped (it edits the files directly)
- Just look: `dev auth-status` (who has a password / authenticator, session counts — no secret values)

✔ Both refusals tested · ✔ the effect (sign-out, sign-in closed, reset by link, old password dead) tested on a test board
⚠ `dev recover` end to end in a real server terminal is not yet verified — rehearse once after stage 3 (OS account separation), which changes its conditions

## 6. Lost phone (authenticator)
- Final approver — with backup codes: type one in the authenticator field (each works once) → then run 5 to register the authenticator on the new phone · without: 5
- Member — the final approver sends a new **Sign-in link** from their row → they register the new phone and set the password again (old authenticator, backup codes and sessions stop working). If urgent, «Sign out» first

## 7. Right after installing (server-wide)
✔ First setup through the SSH tunnel · phone sign-in over Tailscale with the authenticator — done on a real server (2026-10-29)
While the final approver has no password, the first-setup screen appears only in a browser opened through **the board account's SSH tunnel** (`ssh -L <port>:127.0.0.1:<port> …`). If you will only use a phone or Tailscale, do the first setup with the link from `dev recover` in a server terminal.

## 8. Memory slots (server-wide · optional — keep builds from piling up and freezing the server)
When several sessions run builds, emulators or browser tests at once, memory and swap can run out and freeze the whole server. Memory slots make heavy jobs state the memory they need and go **first come, first served**, and run each job in a box (cgroup) so only that job stops if it overflows.
1. Wrap heavy commands: `~/dev-server/kit/bin/mem-slot run <name> <MB> -- <command>` (MB = the job's measured peak + 15%) · status: `~/dev-server/kit/bin/mem-slot status`
   - Wrap the build script in the project's `package.json` and `npm run build` keeps working as is
2. (Recommended) block un-slotted builds — in `~/.claude/settings.json`:
   ```json
   "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "python3 -I ~/dev-server/kit/bin/mem-slot-guard", "timeout": 10 } ] } ] }
   ```
   A blocked session is shown the exact command to run instead. If the check itself errors, it lets the command through.
3. Tests: `bash ~/dev-server/kit/bin/mem-slot.test.sh` · `bash ~/dev-server/kit/bin/mem-slot-guard.test.sh`
- Boxes need user systemd (`systemd-run --user`). Without it a job enters only when free memory covers its whole share.
- Settings: `MEM_SLOT_RESERVE` (MB always kept free, default 2400) · `MEM_SLOT_SWAP_FREE_MIN` (swap MB that must stay free, default 1024) · `MEM_SLOT_PSI_MAX` (memory-stall ceiling %, default 10). On servers with 4 GB or less, set RESERVE around 1200.

## 9. Things only the server admin (sudo) can do — in one place
The board and sessions run without root. These are one-time steps for the server admin (the board works without them).
| Task | Command (example) | Without it |
|---|---|---|
| Start the board after reboot | the `sudo …` line printed by `pm2 startup` · `pm2 save` | crontab `@reboot pm2 resurrect` instead |
| Tailscale (phone access) | `curl -fsSL https://tailscale.com/install.sh \| sh` → `sudo tailscale up` → `sudo tailscale serve --bg 8800` (`--https=8443` if a web server uses 443) | SSH tunnel only |
| Keep user systemd running (memory-slot boxes) | `sudo loginctl enable-linger <board account>` | slots run without boxes (section 8) |
| Firewall — block all but 22·80·443 | `sudo ufw allow 22,80,443/tcp && sudo ufw enable` (or your cloud firewall screen) | dev backend ports may be reachable from outside |
| Dev-site sign-in gate (optional) | `sudo bash ~/dev-server/kit/board-gate-install.sh /etc/nginx/sites-enabled/<site file>:<domain>` (add more sites as more arguments · backs up, reloads only if `nginx -t` passes, else restores · remove with `board-gate-uninstall.sh`) — then turn it on per project under ⚙ on the board. Before turning it on, list exceptions (webhooks, app-link files, in-server automated tests). If the board port is not 8800, change 8800 in `kit/nginx-board-gate.conf` · once included, dev sites are blocked while the board is down | dev sites rely on their own login |
| Team SSH accounts and keys | `sudo adduser <name>` · that account's `~/.ssh/authorized_keys` | team uses the board over Tailscale only |

## 10. Updating the board (owner)
- The board checks once a day (and with **Check for updates** under 🌐 Language) for a newer release tag of the public repository. Only `git ls-remote` / `git fetch` of that tag — nothing about your server is sent.
- **Update** (authenticator code if 30 minutes have passed): the new version is unpacked into a temporary folder and its self-tests run there → the board stops, your records (`board/state.json` · `board/config.json` · `projects.json`) are copied to `board/log/update/<time>/` → `git merge --ff-only <tag>` → restart → it must answer for 20 seconds. If not: the previous commit and those records come back and the board restarts (the new version's records stay next to them as `*.after`). Sessions keep working throughout.
- It will not update when board files were edited on this server, the history has diverged, the download address changed since the first check, the same version tag now points elsewhere, or the board is not running under PM2. The box says which, with the manual line: `cd ~/dev-server && git pull --ff-only && pm2 restart dev-board`.
- If an update stops half-way (power loss, out of memory), the board shows **Go back to the previous version** (code only — records written since then are kept; the copies stay in `board/log/update/<time>/`) and **Keep this version**.
- If the board does not come up at all: `pm2 logs dev-board --lines 50 --nostream`, then `cd ~/dev-server && git reset --hard <prev>` (`prev` is in `board/update-result.json`) and `pm2 restart dev-board`.
- Moved the repository on purpose? Remove `update.origin` and `update.tags` from `board/state.json` while the board is stopped, then start it — the next check pins the new address.
- Templates copied out at install (`~/.claude/CLAUDE.md` rules, project `.claude/commands`, project `CLAUDE.md`) are not changed by an update. When a release changes them, **Ask the AI to apply them** queues a server-session task that merges the change and keeps your edits.
- No automatic updates in this version (planned together with signed releases).

## To be added (next stages)
Key and password rotation · incident response (block → stop → revoke/rotate → keep evidence → restore) · backup and restore (code rollback vs database restore, restore drills) · what changes after OS account separation
