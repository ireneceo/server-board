# Guide for members and designers

> For team members and designers who request work on this board. No server knowledge needed.

## Getting in
1. Install an authenticator app on your phone (Google Authenticator or any standard app). It must be **your own phone and app** — never borrow someone else's.
2. Open the **sign-in link** the final approver sent you (24 hours, single use). Follow the screen: app ＋ → scan the QR (on a phone, tap «Add to authenticator») → type the 6 digits of the new **«Server Board · server name»** entry → set a password (10+ characters) → write down the **10 backup codes** (password manager or paper — not photos, chat or an AI chat).
3. Next time, open the board address and sign in with **ID + password + the 6 digits**. ID = your server account name (or your Tailscale login email if you have none).
- **Several servers?** Each server has its own link and registration. The app shows one «Server Board · server name» entry per server — use the one for the server you are signing in to.
- Lost your phone? A backup code (each works once) gets you in. To register a new phone, ask the final approver for a **new sign-in link** (you set the password again too).
- If the final approver turned off «Members also use an authenticator» on a server, its link has no app step — password only.
- **Route in** (the board is not open to the internet — the final approver sets up one of these for you):
  - SSH tunnel: send the final approver your public key (one line of `~/.ssh/id_ed25519.pub` · none yet? `ssh-keygen -t ed25519`), get a server account, then keep `ssh -N -L <port>:127.0.0.1:<port> <your id>@<server>` running and open `http://localhost:<port>`. The tunnel must be opened **with your own account**
  - Tailscale: join the tailnet from the final approver's invite, turn on the Tailscale app and open `https://<server>.ts.net`
  - Any route gives the same ID and role. Open the sign-in link on the address that matches your route (localhost or ts.net).
4. **👤 name · role** at the top: sign out · change password · new backup codes.
- After 48 hours idle or 7 days you sign in again.
- 5 wrong passwords lock you out for 15 minutes. Forgot it? Ask the final approver for a new link.

## What you can do
- You see only your assigned projects.
- **Requests go in as proposals.** The final approver chooses do / edit & do / don't before work starts (depending on settings).
- You can answer questions from sessions started from your own proposals (setting «Sessions members answer»).
- Deploys, settings, deletes and team changes are for the final approver.
- Designers: same as members for now. Direct small UI edits (text, colour, spacing, layout) open in a later stage.

## Writing a good request
- What · why · which screen (address) · what «done» looks like, in one piece.
- Paste screen addresses as they are.

## Don't
- **Never put passwords, keys, customer personal data or production data in a request.** Requests are passed to an AI session as written.
- Don't share your sign-in or authenticator. Everyone gets their own.
