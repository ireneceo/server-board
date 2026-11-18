# Install guide

[한국어 →](INSTALL.ko.md)

This takes about 15 minutes. Steps 1–3 happen on **your computer**, steps 4–6 on **the server**.

> Stuck at any step? We can do it with you or for you: **[Request setup →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=setup&src=install-top)**

| Step | Where | What |
|---|---|---|
| [1](#step-1--make-an-ssh-key-on-your-computer) | your computer | Make an SSH key |
| [2](#step-2--put-the-public-key-on-the-server) | your computer → server | Put the public key on the server |
| [3](#step-3--save-a-shortcut-with-the-board-tunnel) | your computer | Save a shortcut that also opens the board tunnel |
| [4](#step-4--prepare-the-server) | server | Node, PM2, git, Claude Code |
| [4b](#step-4b--connect-claude-subscription-or-api-key) | server + any browser | Log Claude Code in (subscription or API key) |
| [5](#step-5--install-the-board) | server | Install the board (let Claude do it, or by hand) |
| [6](#step-6--open-the-board-on-each-device) | each device | Open http://localhost:8800 — Mac, Windows, Linux, iPhone/iPad, Android |

What you need before starting: the server's **IP address** (or hostname) and a **user name** you can log in with. Your hosting provider shows both, often as `root` with a password or a key they gave you.

---

## Step 1 · Make an SSH key on your computer

An SSH key is a pair of files: a **private key** that never leaves your computer, and a **public key** (one line of text) that you give to the server. After this you log in without a password, and the board tunnel can reconnect by itself.

**Mac / Linux** (Terminal):

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"
```

Press Enter to accept the default file. For the passphrase, you can set one (safer) or press Enter twice (no passphrase).
On Mac, if you set a passphrase, also run `ssh-add --apple-use-keychain ~/.ssh/id_ed25519` so you're not asked every time.

**Windows 10 / 11** (PowerShell; OpenSSH is built in):

```powershell
if (!(Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub)) { ssh-keygen -t ed25519 }
```

Show your public key (you'll need it in step 2 only if you add it by hand):

```bash
cat ~/.ssh/id_ed25519.pub                              # Mac / Linux
```
```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub       # Windows
```

It's one line starting with `ssh-ed25519`. **Share only the `.pub` file.** Never send the file without `.pub`.

## Step 2 · Put the public key on the server

Replace `USER` and `SERVER_IP` with yours. You'll type the server password one last time.

**Mac / Linux:**

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub USER@SERVER_IP
```

**Windows (PowerShell):**

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh USER@SERVER_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**No password login on your server?** (common on AWS, GCP and some VPS providers) Paste the `.pub` line into the provider's control panel ("SSH keys"), or log in with the key the provider gave you and append the line to `~/.ssh/authorized_keys`.

Test: `ssh USER@SERVER_IP` should now log in **without** asking for the server password.

<details>
<summary><b>Recommended: don't run the board as root</b></summary>

If you only have `root`, create a normal user once and use it from now on:

```bash
# on the server, as root
adduser dev                      # choose a password, other questions can be blank
usermod -aG sudo dev
mkdir -p /home/dev/.ssh && cp ~/.ssh/authorized_keys /home/dev/.ssh/
chown -R dev:dev /home/dev/.ssh && chmod 700 /home/dev/.ssh && chmod 600 /home/dev/.ssh/authorized_keys
```

Then use `dev` as `USER` below. Claude Code and the board run as this user.
</details>

## Step 3 · Save a shortcut with the board tunnel

Add this to `~/.ssh/config` on your computer (Windows: `C:\Users\<you>\.ssh\config`, a plain text file without extension). Create the file if it doesn't exist:

```
Host myserver
  HostName SERVER_IP
  User USER
  IdentityFile ~/.ssh/id_ed25519
  LocalForward 8800 127.0.0.1:8800
  ExitOnForwardFailure yes
  ServerAliveInterval 30
```
`8800` is the board port. With boards on several servers, each server gets its own port (install asks — e.g. 8800, 8801); use that number on both sides here. `ExitOnForwardFailure yes` makes `ssh` fail instead of logging you in without a tunnel when the port is taken.

Now `ssh myserver` logs you in **and** forwards the board to your computer's http://localhost:8800 for as long as that window is open.
The board itself is never exposed to the internet; only your SSH connection can reach it.

## Step 4 · Install the board (one command)

Log in (`ssh myserver`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh | bash
```

To read it first: `curl -fsSLo install.sh https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh && less install.sh && bash install.sh`.

What it does, in order (it **asks before every install or settings change**; nothing needs root):

1. checks the server (Linux, home writable, git, curl) and runs the one-minute host check (`kit/check-host.sh`);
2. if missing, offers to install **Node 20** (with nvm, in your account), **PM2** and **Claude Code**;
3. downloads the board to `~/dev-server` (stops if that folder already holds something else);
4. writes default settings: language, *your* timezone, your name, a free port;
5. starts the board with PM2;
6. offers the **Claude login** right there (step 4b) and the **two session settings** ("The two settings only you can change" below — asked one by one, with what each value means); then offers the **terminal menu** (`~/bin/dev` + a few lines at the end of `~/.bashrc` — the session list when you SSH in; add it later with `SB_MENU=1 bash ~/dev-server/install.sh`);
7. prints the tunnel line and what's left.

Run it again any time: it keeps your settings and restarts the board. Exit codes: `2` a required tool is missing, `3` `~/dev-server` holds something else (nothing is deleted), `4` the board did not start (`pm2 logs dev-board --lines 30 --nostream`).

<details>
<summary>Install the prerequisites yourself instead (sudo)</summary>

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo apt-get install -y git python3
npm install -g @anthropic-ai/claude-code      # or Anthropic's native installer
```
</details>

On shared web hosting most checks fail; see [Where it runs](../README.md#where-it-runs).

## Step 4b · Connect Claude (subscription or API key)

`install.sh` offers this at the end (say yes). If you skipped it, the board's **First setup** box shows the same command.

The board itself never talks to an AI. It starts Claude Code sessions on the server, and **they use the Claude Code login of the server user**. So you log Claude Code in once, on the server, as the same user that runs the board.

| | Claude subscription (Pro / Max / Team) | API key (Anthropic Console) |
|---|---|---|
| Cost | Flat monthly plan; usage limits reset every few hours | Pay per token, no fixed limit — set a spend limit in the Console |
| Good for | One person, a few projects | Teams, heavy or round-the-clock use |
| Command | `claude auth login` | `claude auth login --console` |

The server has no browser, and that's fine:

1. On the server run the command from the table. It prints a **link**.
2. Open that link in **any** browser (your laptop or phone), sign in and approve.
3. Copy the **code** it shows and paste it back into the server terminal.
4. Check: `claude auth status --text` → shows you are logged in. Then `claude -p "say ok"` should answer.

Alternative for API keys: put `export ANTHROPIC_API_KEY=<your key>` in the server user's `~/.bashrc`, then **restart the board with that environment** (`source ~/.bashrc && pm2 restart dev-board --update-env`) so the sessions it starts can see the key. Never put keys in `board/config.json` or in a project repo.

The board checks the login every 10 minutes: the «AI connection» tile in the server status box at the top shows **«✔ Claude subscription Max»** (or «API key»). If the login expires, a red box appears at the top with the command to run — every session stops working until you log in again.

## Step 4c · Final approver first sign-in setup (server-wide · once)

The board has **personal sign-in — everyone uses their own ID and password**. Right after installing there is no password yet, so the final approver (the owner of the account that runs the board) sets it once.
1. Open `http://localhost:8800` through the SSH tunnel from step 3 → «First setup — final approver»
2. New password (10+ characters), twice
3. Register an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) — on a phone tap «Add to authenticator»; on a computer choose «Enter a setup key» in the app and type the key shown → type the app's 6 digits
4. **10 backup codes** are shown once — keep them in a password manager or on paper
- Phone / Tailscale only: run `dev recover` in a server terminal and use the printed link (10 minutes) for the same setup
- ID = the server account name that runs the board. Adding people and emergency recovery: [Operations](OPERATIONS.md)
- Check: `bash ~/dev-server/kit/verify.sh` shows «✔ final approver has password and authenticator»

## Step 5 · Finish setup on the board

Open the board (step 6 has every device), e.g. `ssh -L 8800:127.0.0.1:8800 you@server` → http://localhost:8800.

1. The **First setup** box at the top lists what's left: Claude Code installed · Claude logged in · permission settings · folder trusted · start at boot (optional). «First — open a server window» at the top has the `ssh` line with this server's address, and each missing item has numbered commands to copy — Copy → paste into the server window → Enter. Login also works with **Log in here (no terminal)**. Items turn ✔ by themselves once done (or press **Recheck**).
2. Press **Finish setup with AI ▶**. A "Setup" session starts in the server room and reads [AI-SETUP-PROMPT.md](AI-SETUP-PROMPT.md). It inspects the server and posts **one question card** at the top of the board: your projects and how to divide them, dev URLs, deploys, what's hard to undo, schedules, devices. The values it found are filled in and recommended ones are marked; reply "OK" or list what to change.
3. It sets up the projects (rules, commands, notes files, schedules), posts anything only you can do as **to-do cards** (with commands to copy), and ends with the `kit/verify.sh` result. **Run checks** in the box runs it again any time.

### Option B · Paste the prompt into Claude (terminal)

```bash
cd ~ && claude
```

Paste the whole prompt from **[AI-SETUP-PROMPT.md](AI-SETUP-PROMPT.md)**. Same result, asked in the terminal instead of on the board. It works with or without `install.sh` (if the board is already installed, it keeps those values).

### Option C · By hand

```bash
git clone https://github.com/ireneceo/server-board.git ~/dev-server
cd ~/dev-server
cp board/config.example.json board/config.json      # edit: owner, lang, timezone, devSsh
cp kit/templates/projects.example.json projects.json # one entry per project folder; keep "server" and replace USER with your user name
python3 -I kit/detect.py --summary                  # shows your projects, ports, PM2 apps
cd board && pm2 start server.js --name dev-board --no-treekill && pm2 save
bash ~/dev-server/kit/verify.sh                     # goal: "✘ 0"
```

Then copy the rules and commands as described in [AI-SETUP-PROMPT.md](AI-SETUP-PROMPT.md) section 4.

### The two settings only you can change

Claude can't change its own permission settings. `install.sh` offers to set them (with a backup); otherwise run this once on the server (it backs up `settings.json` first):

```bash
node -e 'const fs=require("fs"),p=require("path"),f=p.join(require("os").homedir(),".claude","settings.json");let d={};if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,"utf8"));fs.copyFileSync(f,f+".bak-"+new Date().toISOString().slice(0,10).replace(/-/g,""))}else fs.mkdirSync(p.dirname(f),{recursive:true});d.permissions={...d.permissions,defaultMode:"auto"};d.worktree={...d.worktree,bgIsolation:"none"};fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f)'
```

- `defaultMode: auto` lets Claude Code decide which actions run without asking (see Claude Code's permission docs for exactly what it allows). Without it, background agents stop at every permission prompt and wait for you.
- `bgIsolation: none` — background agents edit the project folder directly. The board makes sure only **one** editing agent runs per project. Left unset, each session works on its own branch under `.claude/worktrees/…`, cannot see uncommitted files in the folder (and redoes work), and its result must be merged by hand — the board then warns when you queue a task while the folder has uncommitted changes.

And once per project folder: `cd /path/to/project && claude` → answer "Yes, I trust this folder" → `/exit`.

To start PM2 at boot, run `pm2 startup` and paste the `sudo …` line it prints.

## Step 6 · Open the board on each device

There are two ways to open the board, and neither exposes it to the internet. `localhost:8800` means «this device», so typing it on your laptop or phone does not open the server's board by itself — link your device to the server **one** of these two ways. (The «Open on other devices» button at the top of the board shows the same, with only the steps for the way and device you pick.)

| Way | Cost | Address | Best for |
|---|---|---|---|
| **① SSH tunnel** | **Free** (nothing to install or sign up for) | http://localhost:8800 — only while connected | Viewing on a computer. On phones it drops a few minutes after the app goes to the background |
| **② Tailscale** | **Free personal · paid for teams** — a personal account for yourself is free; a company/team account for several people is billed per user per month ([pricing](https://tailscale.com/pricing)) | `https://<your-server>.ts.net` — always, while the app is on | Phones, home-screen app and alerts |

Not sure? Computer only → ① SSH tunnel (free) · phone too, with alerts → ② Tailscale (free for one person). You can use both. ① is the table below, ② is "Always-on without a tunnel — Tailscale" below.

The **terminal** (server commands, opening a session) goes through SSH either way, so every device you type commands on needs **its own key** (steps 1–2 once per device). Losing a device = delete that one line from `~/.ssh/authorized_keys` on the server. With Tailscale, the phone's Termius is not needed to view the board — only to type server commands on the phone.

| Device | App | Set up once | Every day |
|---|---|---|---|
| **Mac** | Terminal / iTerm | Steps 1–3. Optional always-on tunnel: in the board, «Open on other devices» → «Mac — always open (automatic tunnel)» shows 4 short steps with this server's values (or by hand: `S=$(ssh myserver cat dev-server/scripts/connect-mac.sh) && bash -c "$S" connect-mac myserver` — the script lives on the server · a `post-quantum key exchange` warning on the Mac is harmless) (reconnects after sleep/reboot) | `ssh myserver` → http://localhost:8800 (with the always-on tunnel, just open the bookmark) |
| **Windows 10/11** | PowerShell (OpenSSH built in) · or PuTTY | Steps 1–3 (config file `C:\Users\<you>\.ssh\config`, no extension). PuTTY: Connection → SSH → Tunnels → source `8800`, destination `127.0.0.1:8800` → Add → save the session | `ssh myserver` (or tunnel only: `ssh -N myserver`) → http://localhost:8800 |
| **Linux desktop** | Terminal | Steps 1–3, same as Mac | `ssh myserver` → http://localhost:8800 |
| **iPhone / iPad** | Termius (free) | See below | Open Termius, connect, then the home-screen icon |
| **Android** | Termius (free) | See below | Same as iPhone; Android keeps the tunnel alive in the background longer |

**Phone or tablet with Termius:**

1. Termius → Keychain → **Generate key** (ed25519). Use a **new key for the phone**, not your laptop's key.
2. Copy its public key → on the server, add it as a new line in `~/.ssh/authorized_keys` (from your laptop: `ssh myserver` then `nano ~/.ssh/authorized_keys`).
3. Hosts → add `SERVER_IP`, user `USER`, that key.
4. **Port Forwarding** → New rule → Local · port **`8800`** (it must be 8800 — any other number is refused with 403) → destination `127.0.0.1` port `8800` → turn it on.
5. Open http://localhost:8800 in Safari/Chrome → **"Add to Home Screen"**.
6. Turn on Termius app lock (Settings → Security).

iPhones close the tunnel a few minutes after Termius goes to the background. When the board shows a red "could not reach" banner, open Termius (the rule reconnects) and reload. Sessions keep working on the server the whole time.

**Always-on without a tunnel — Tailscale (optional · free personal, paid for teams · best for phones):**

Tailscale is a **private network only your own devices can see** (free for a personal account · paid for company/team accounts). The board stays closed to the internet, yet your phone and laptop open it any time at `https://<your-server>.ts.net` — no Termius, no SSH — and it stays connected when the phone app is in the background. Everyone uses **their own Tailscale account and their own server**; there is nothing to type into the board — it detects its server's Tailscale name by itself and accepts only that name, and only from devices of the account that added the server to Tailscale.

1. Create an account at tailscale.com → **turn on two-factor login** (this account becomes a key to your server).
2. On the server: `curl -fsSL https://tailscale.com/install.sh | sh` → `sudo tailscale up` (open the printed link to log in) → `sudo tailscale serve --bg 8800` (the first time it prints a link to enable HTTPS — allow it, then run it again). If nginx or another web server on this machine uses 443, run `sudo tailscale serve --bg --https=8443 8800` instead — sharing 443 makes the web server fail with «Address already in use» on its next restart (address becomes `https://<server>.ts.net:8443`; the board reads the port itself).
3. Install the Tailscale app on your phone/laptop → log in with the same account → turn it on.
4. Open the `https://….ts.net` address the last command printed and **"Add to Home Screen"**. Turn alerts on once more at the new address.

Keep it safe: **do not turn on `tailscale funnel`** (public sharing) — while it is on, the board refuses that address. Register only your own devices; if one is lost, remove just that device in the Tailscale admin page. Keep the SSH tunnel method as a fallback.

**Where is this guide later?** The board has it built in: at the bottom of the board, "Open this board on another device" — with your server's address already filled in — and a link to this file served by the board itself (`http://localhost:8800/docs/INSTALL.md`).

## After install: daily use

- Write a task in **"+ New task"** on a project card. It queues and starts by itself.
- The top box shows what needs you. Answer right there.
- Done rooms: open → read the report → **"✓ Confirm done"**.
- Alerts: **"Alerts"** at the top → «This computer — browser» → «Turn on» (arrive while the board tab is open, even in another tab) · for your phone subscribe to the topic in the free **ntfy** app and "Turn on & save" (arrives even when the board is closed — only one line is sent: project · session · question title). If you added the board to your home screen, «Get alerts in this app» is better — alerts show the board icon and tapping opens that app (iOS 16.4+ on iPhone).
- In a terminal: `ssh myserver` shows the menu (`dev`). `claude attach <room id>` joins a room live; `Ctrl+Z` leaves it running.

## Update

```bash
cd ~/dev-server && git pull && pm2 restart dev-board && bash kit/verify.sh
```

Your `board/config.json`, `projects.json`, notes and logs are not in git, so updates don't touch them.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Permission denied (publickey)` | Step 2 didn't land. Check `~/.ssh/authorized_keys` on the server has your `.pub` line; permissions `700 ~/.ssh`, `600 authorized_keys` |
| `bind [127.0.0.1]:8800: Address already in use` | Another tunnel/app already uses 8800 on your computer — usually a second `ssh myserver` window, which is fine (the first one carries the board). Otherwise close that app. Don't switch to another local port: the board only answers `localhost:8800` and refuses other ports with 403. To use another number, set `"port"` in `board/config.json`, restart the board and use that number on both sides |
| Browser: "can't connect" | Is the SSH window open? On the server: `pm2 status dev-board` and `pm2 logs dev-board --lines 30 --nostream` |
| `403` in the browser | Open exactly `http://localhost:8800` (not the server IP). The board refuses other host names on purpose |
| Red box "AI is not connected" / sessions end instantly with an auth error | The Claude Code login expired or was never done: [step 4b](#step-4b--connect-claude-subscription-or-api-key) |
| Rooms stop at "Waiting" with a Yes/No prompt | Do the "two settings only you can change" above; trust each project folder once |
| After a Claude Code update the board shows nothing | `bash ~/dev-server/kit/verify.sh`. If a line fails, open an Issue with that line |

Still stuck? **[Request setup](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=setup&src=install-trouble)**. Tell us your server provider and where it stopped.

## Uninstall

```bash
pm2 delete dev-board && pm2 save
rm -rf ~/dev-server ~/bin/dev            # and remove the "dev menu" block at the end of ~/.bashrc
```
Your projects and `~/.claude` are untouched (remove the shared-rules section from `~/.claude/CLAUDE.md` if you want).
