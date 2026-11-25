# Operations — people, sign-in, emergency recovery

> For the people who run this board (final approver, server admin). Written with role names.
> **Server-wide** = once at install, for the whole server · **Per project** = chosen per project in ⚙.
> Marks: ✔ actually walked through · ⚠ not yet walked through (update after trying)

## 1. Add a person (per project — choose their projects)
**Who:** the final approver only (⚙ Team & roles is shown only to them · asks for the 6 digits again if the last authenticator check was over 30 minutes ago). Other people and AI sessions cannot add people or change access. If you ask an AI session to "add a member", it only walks you through this section.

The board is not open to the internet, so **everyone needs a server account** (SSH tunnel · ID = server account name). **Save the board account first; the server account comes after** with the one line in step 3 (you can save before any server account or key exists). **Only job «Developer» gets a shell** — everyone else gets the board tunnel only (no shell, commands or other destinations). Tailscale is an optional extra route for people who already have a server account.

1. Board **⚙ Team & roles** → **+ Add account** → name · ID (lowercase — the server account gets the same name) · job · title · **access** · projects → **Save** = board account. Saving sends them nothing (no email, no link) — that is step 4 (card ③). The card marks the current step «You are here», and its small 1·2·3 sub-steps turn ✔ as you go
2. Key — pick the server account at the top of the card (an existing one or «create new»). Tunnel-only and developer members alike: press **«Let the board make the key»** in step ② (the board makes a key pair; their private half stays in memory only and goes into the ③ invitation once · lost after 24 h or a board restart, then make it again · a new key cancels any sign-in link already sent). A developer (shell) key opens the server shell, so send the invitation 1:1 only and have them delete it after pasting. If they already sent their own public key, paste it under ② «Already have» and save instead (safer — no private key travels). Switching a member between tunnel-only and developer drops a board-made key; make a new one. Picking an existing account means the step 3 line replaces all of its authorized_keys
3. Copy the card's ② **«Paste in a terminal»** line and run it in a server shell (asks for your sudo password · ends with `OK`) → back on the board the row shows **«✔ Ready»** (account + key). The line: creates the account if missing · installs the public key if given (written as that account) · writes a key marker in the account comment (`board-<fingerprint>` — how the board tells the key is installed) · sets the shell by job (Developer `/bin/bash`, others `/usr/sbin/nologin` + key options `restrict,port-forwarding,permitopen="127.0.0.1:<port>"`). Paste again after changing the job or key. Admin (sudo) and system accounts are refused as member accounts
4. Card ③ **Make invitation & copy** → send to that person only. It holds the sign-in link (**single use within 24 hours**) + the SSH tunnel command with their ID (plus the server shell command for developers) + sign-in steps + rules. A new one cancels the previous link. With «Email for the invitation» filled in on the card, the button also opens a new email to that address (you press send in your mail app — the board never sends mail itself · asks again if the invitation carries a key). The card's «This person» line sets which sessions they can answer and whether their tasks need approval, for that person only (it starts with the ② values; anyone matching ② follows when ② changes)
5. They open it, register **their own phone's authenticator app** (QR · 6 digits), set a password (10+ characters) and are signed in — the 10 backup codes are theirs
6. Done when step ④ shows «Registered — password ✔ · authenticator ✔». Details: [member guide](TEAM-GUIDE.md) (the invitation already holds the essentials)
- If opening the link says «This account cannot sign in through this route»: the SSH tunnel was opened with an account other than theirs, or they came via Tailscale and the Tailscale field is empty or a different email
- **Members also use an authenticator** (⚙ Team & roles ①, on by default · server-wide): turn it off and everyone who is not a final approver (Propose, View only) signs in with a password only. Anyone who only set a password (e.g. the setting was turned on later) is told at sign-in to get a new link — send their row's Sign-in link again. Each row shows «authenticator ✔ / ⚠ none»
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
- The board checks every 6 hours (1 hour after a failed check · and right away when you tap the **version chip (v… ↻)** next to the server name in the title) for a newer release tag of the public repository. If it cannot reach the repository, a «The board cannot check for updates» box shows at the top with a line to run in a server terminal. Only `git ls-remote` / `git fetch` of that tag — nothing about your server is sent.
- **Update** (authenticator code if 30 minutes have passed): the new version is unpacked into a temporary folder and its self-tests run there → the board stops, your records (`board/state.json` · `board/config.json` · `projects.json`) are copied to `board/log/update/<time>/` → `git merge --ff-only <tag>` → restart → it must answer for 20 seconds. If not: the previous commit and those records come back and the board restarts (the new version's records stay next to them as `*.after`). Sessions keep working throughout.
- **Commits made on this server** (for example by the server session) no longer block an update: the board re-applies them on top of the new version in a temporary git worktree first (the install is untouched while it tries), tests that result, and keeps the original history in a `board-local-backup-<time>` branch. If they touch the same lines as the new version, the box lists the local commits and conflicting files and offers **Ask the server room AI to sort it out ▶** (backup branch → drop what the release already has → re-apply only what is needed → tests → restart).
- Stuck on 0.6.21 or earlier with «diverged»? Those versions cannot re-apply local commits themselves — once, in a server terminal: `cd ~/dev-server && git status --short --untracked-files=no` (must print nothing), then `git fetch origin --tags && git branch board-local-backup-$(date +%Y%m%d%H%M%S) && git -c user.name="Server Board" -c user.email=board@localhost rebase origin/main && pm2 restart dev-board`. On a conflict: `git rebase --abort` (nothing changes) and give the task to the server session.
- It will not update when tracked board files have uncommitted edits, local commits conflict (above), the download address changed since the first check, the same version tag now points elsewhere, or the board is not running under PM2. The box says which, with a line for a server terminal (`git status` for edits, `git log --oneline <tag>..HEAD` for local commits).
- If an update stops half-way (power loss, out of memory), the board shows **Go back to the previous version** (code only — records written since then are kept; the copies stay in `board/log/update/<time>/`) and **Keep this version**.
- If the board does not come up at all: `pm2 logs dev-board --lines 50 --nostream`, then `cd ~/dev-server && git reset --hard <prev>` (`prev` is in `board/update-result.json`) and `pm2 restart dev-board`.
- Moved the repository on purpose? Remove `update.origin` and `update.tags` from `board/state.json` while the board is stopped, then start it — the next check pins the new address.
- Templates copied out at install (`~/.claude/CLAUDE.md` rules, project `.claude/commands`, project `CLAUDE.md`) are not changed by an update. When a release changes them, **Ask the AI to apply them** queues a server-session task that merges the change and keeps your edits.
- No automatic updates in this version (planned together with signed releases).

## 11. Several servers · Change the board port

Each board you open from one computer needs **its own port** — your computer maps `localhost:<port>` to one tunnel only. If two servers both use 8800, a second `ssh -L 8800:…` only warns "Address already in use" and stays connected without a tunnel, and you end up looking at the other server's board. Using a different number only on your computer does not work either: the board accepts `localhost:<its own port>` only.
Give every server a different `serverName` too — it shows in the board header, the tab title, the sign-in page and the authenticator entry, and `kit/verify.sh` / `scripts/connect-mac.sh` compare it.

To change a board's port (on that server, owner):
1. `board/config.json` → `"port": <new>` (a number nobody uses on the server: `ss -ltn | grep :<new>` prints nothing) → `pm2 restart dev-board --update-env`
2. Docs the kit placed: replace the old number in `~/.claude/CLAUDE.md` and `~/dev-server/CLAUDE.md` (`localhost:<old>` and `127.0.0.1:<old>` → new) — `kit/verify.sh` lists any leftover with file and line
3. Your computer: `~/.ssh/config` → `LocalForward <new> 127.0.0.1:<new>` (both numbers the same) · Mac auto tunnel: install it again from the board's «Mac — always open (automatic tunnel)» box (the alias includes the port, so the new port gets its own tunnel; remove the old one with the «Undo» line the script printed) · phone (Termius): change the forward
4. If used: `sudo tailscale serve --bg <new>` · dev-site gate: re-run `kit/board-gate-install.sh` (the nginx snippet carries the port)
5. Sign in again on the new address (sign-in cookies are per port) · `bash ~/dev-server/kit/verify.sh`

## 12. Backups · back up now · restore request (per project · final approver)
1. The card head sums up in three labelled lines (Dev · Prod · Backup). The «Backup» line says «● all fresh» when everything is fine and shows only what needs a look in colour (missing copy, nothing off-server, unpushed commits, needs approval). Per-copy times are behind «More ▾» at the end of the button row — one line each (✔/✗ copies on this server, sent to another server, received, code copy). Red = something missing (stale, folder gone); yellow = no copy off this server. The browser remembers the open state per project.
   The «Prod» line shows the production deploy time and commits since, plus only what needs a look (command not approved, last run failed, holds) — «Dry run», «⚙ Connection» and «Reset check baseline» sit in the «Deploy» box inside «More».
2. First time: red «no backup» → «Create automatic backup…» (that project's session writes a daily backup script and cron line, test-restores, reports; then press «Approve backup settings» on the card) (if the session finds a daily backup already running it builds nothing and the card shows «backup found — register once» · press «Register as found…») or, if a daily backup already runs, «Register an existing backup» → fill the path boxes (one «name | path» per line) → «Save and approve». On a single server leave «sent» and «received» empty and use «Download newest copy to PC» in the box once a week (the off-server copy). Fields: SERVER-GUIDE section 2 «Backup».
3. «Open» → «Back up now» runs the registered backup script once (same script as the nightly backup · may overwrite today's copy).
4. «Request restore from here…» → pick a copy + what and why → it goes into that project's queue. The board overwrites nothing; the session backs up the current state first and asks right before overwriting.
5. If the settings or the script content change, it shows «needs approval» — press «Approve these settings» in the box.
6. «GitHub …» on the Backup line and in «More» = the code copy. «N commits not pushed» → the window's «Code copy» box → «Start dev done (includes push)»: that project's dev done logs, commits, backs up and pushes. «No code copy» means the code exists only on this server and in backup archives.
7. «No code copy» → the window's «Connect to GitHub…» → «Create a key» → on GitHub create an empty Private repository and paste the key under Settings → Deploy keys (tick Allow write access) → enter owner/name and «Check connection» → that project's session filters secrets and pushes the first time.

## To be added (next stages)
Key and password rotation · incident response (block → stop → revoke/rotate → keep evidence → restore) · backup and restore (code rollback vs database restore, restore drills) · what changes after OS account separation
