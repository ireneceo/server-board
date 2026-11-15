# Services: free, or done for you

[한국어 →](SERVICES.ko.md)

Server Board is **free and stays free**. No paid features are locked away and there's no trial.
If you'd rather spend your time on your product than on SSH keys, permissions and cron jobs, the WOR-PRO Lab team can do the server side for you.

**[Request setup or a quote →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&src=services-top)**

---

## What's inside (the same program, free or set up by us)

| Area | What you get |
|---|---|
| At a glance | "Needs you now" at the top · per project: session status (working / waiting for you / done / stopped), last report, links to check |
| Talk and reply | Read a session's conversation like a chat and reply from the browser · "Ask the AI" |
| Your to-dos, separated | Steps only the owner can do (sudo, outside service settings) arrive as cards with steps, links and copyable commands · press Done and the AI carries on |
| Runs by itself | One editing session per project (queue) · auto-resume · scheduled checks |
| Safe deploys | Sessions only prepare or block a deploy; the board runs the registered deploy command · "reviewed finished work" before deploying · other work steps aside during a deploy |
| Open as test role | "Where to check" links open signed in as that role's test account |
| Team and security | Personal sign-in (authenticator + backup codes) · roles (final approver, member, designer, viewer) · re-confirm important buttons every 30 min · terminal emergency recovery · optional dev-site sign-in gate |
| Server guards | Memory slots (builds can't pile up and freeze the server) · re-login to Claude from the board · login-key guard · self-check whenever Claude Code updates |
| Access | Never on the open internet — Tailscale private network or SSH tunnel · phone home-screen app · terminal menu (`dev`) |

## The four options

### 1 · Free: the base program

You install it yourself on your server and use it as long as you like.

- Everything in this repository: board, terminal menu, queue, auto-resume, schedules, setup prompt, verify script
- Community support through GitHub Issues (bugs in the code)
- **Best for:** developers comfortable with Linux, SSH and Claude Code

[Install guide →](INSTALL.md)

### 2 · Paid setup: installed and connected on your server

We install it on **your** server and configure the parts that usually take the longest:

- Server Board installed, running under PM2, survives reboots
- **AI connection:** Claude Code installed; *you* log in to your own Anthropic account during the session (we never take your Claude credentials); permission mode set, project folders trusted
- **Access:** SSH keys for you (and your team), a non-root user, the board tunnel on your laptop **and phone**
- **Automation:** your projects registered, shared working rules, dev commands (dev-start / dev-done / verify / deploy) filled in with your real build, restart and health values, scheduled checks
- **Server-admin (sudo) steps:** start on reboot, Tailscale, firewall, keep user systemd — done with you from [Operations section 9](OPERATIONS.md#9-things-only-the-server-admin-sudo-can-do--in-one-place) (or by us if you grant sudo)
- **Memory slots:** build and test commands wrapped, and the guard that blocks un-slotted builds turned on, sized for your server
- A handover session and a written report: what was set, how to use it, how to undo it
- **Best for:** founders and teams who want it working this week without learning the plumbing

[Request setup →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=setup&src=services-setup)

### 3 · Paid custom work: deploy, backup and incident response for your service

On top of setup, we add routines built for **your** stack:

- Deploy script with gates: build check, backup first, migrate safely, health check, one-command rollback
- Backups (code + database) with retention, and a tested restore
- Incident response: what the agents check first when something breaks, alerts, a runbook
- **Open as test role:** one dev-only sign-in route per project (`kit/DEV-LOGIN.md` contract) and test accounts per role
- **Dev-site sign-in gate:** list each project's exceptions (payment and carrier webhooks, app-link files, in-server automated tests) → connect nginx → turn on and confirm "blocked without sign-in / opens after sign-in / opens on phone"
- **Board deploy button:** register the deploy, dry-run and rollback commands and run them once for real
- Extra project commands and checks specific to your product (payments, multi-tenant data, protected files)
- **Best for:** services with real users where a bad deploy or lost data costs money

[Request custom work →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=custom&src=services-custom)

### 4 · Monthly maintenance: checked and improved every month

- Monthly check that the board, schedules and agents are working: failed runs, stuck rooms, disk/memory, log size, backups
- Claude Code updates: run `verify.sh`, fix anything that moved
- Small improvements to rules and commands based on how your team actually uses it
- A short monthly report
- **Best for:** anyone who set it up (themselves or with us) and wants it to keep working

[Request maintenance →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&plan=maintenance&src=services-maintenance)

---

## Which one do I need?

| Your situation | Start with |
|---|---|
| I know Linux and just want the tool | **Free** |
| I tried the free install and got stuck (keys, permissions, PM2) | **Setup**: tell us where it stopped |
| I want it running on my server this week, phone access included | **Setup** |
| We have paying users; deploys and backups must be safe | **Setup + Custom work** |
| It's running and I don't want to babysit Claude Code updates | **Maintenance** |

## How a request works

1. **Send a request** at [care.wor-pro.com](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&src=services-how), with the checklist below if you can.
2. **Short reply with questions or a call**, so we agree the scope.
3. **Quote** for the scope (fixed price for setup and custom work, monthly for maintenance).
4. **Temporary access:** you add *our* public SSH key to a user on your server. We never ask for passwords or private keys.
5. **Work + verification:** `verify.sh` "✘ 0", a real test room, your phone tunnel tested.
6. **Handover report**, then **we remove our key** (unless you're on maintenance).

### Helpful to include in your request

- Server provider and OS (e.g. "Hetzner, Ubuntu 24.04"), memory size
- Number of projects and their stack (e.g. "Node API + React, Laravel site")
- Do you already use Claude Code? Which plan?
- What you want agents to do (feature work, bug fixing, scheduled checks, deploy prep…)
- Who needs access (just you / team of N) and devices (Mac, Windows, iPhone, Android)
- Language for the board and reports (English / Korean) and your timezone

## Our promises on access

- Your Claude Code runs on **your** Anthropic account; we don't resell or share accounts.
- We read only what the work needs, never print secrets, and leave a list of every file we changed.
- The board stays private (`127.0.0.1` + Tailscale private network or SSH tunnel). We don't expose it to the internet.
- Nothing is deployed to production, and no production data is changed, without your explicit go-ahead.

## FAQ

**Is the free version limited?** No. It's the same program we install for clients.
**Do I need a Claude subscription?** Yes. Claude Code needs your own Anthropic account/plan.
**Windows or macOS servers?** The board runs on Linux servers. Your *computer* can be Mac, Windows or Linux, and your phone iPhone or Android.
**My site is on shared web hosting (no root, no Node).** The board can't run there, but we can set up a small Linux work server where Claude builds and tests, with `/deploy` publishing to your hosting. Root is never required; see [Where it runs](../README.md#where-it-runs).
**Can you install it on a server that already runs production apps?** Yes. Setup only adds files and never restarts your apps (the setup standard in [AI-SETUP-PROMPT.md](AI-SETUP-PROMPT.md#0-setup-standard-follow-it-during-the-whole-install) is the same one we follow).
**Prices?** It depends on the number of projects and what's automated. Send a request and we'll reply with a quote.

**[Request setup or a quote →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=en&src=services-bottom)**
