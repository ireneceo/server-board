#!/bin/bash
# Server Board — always-on tunnel for macOS (run on your Mac, once).
# Usage:  bash scripts/connect-mac.sh <ssh-alias> [port]
#   <ssh-alias>  the Host name from ~/.ssh/config (docs/INSTALL.md step 3), e.g. myserver
#   [port]       board port on the server (default 8800)
# What it does: a LaunchAgent that keeps `ssh -N` open (starts at login, reconnects 15 s after a drop),
#               then checks http://localhost:<port>.
# Undo:  launchctl bootout gui/$(id -u)/com.serverboard.tunnel.<alias>; rm ~/Library/LaunchAgents/com.serverboard.tunnel.<alias>.plist
set -u
ALIAS="${1:-}"; PORT="${2:-8800}"
if [ "$(uname)" != "Darwin" ]; then echo "✋ Run this on your Mac, not on the server."; exit 1; fi
if [ -z "$ALIAS" ]; then echo "Usage: bash scripts/connect-mac.sh <ssh-alias> [port]   (alias = Host in ~/.ssh/config)"; exit 1; fi
if ! ssh -G "$ALIAS" >/dev/null 2>&1; then echo "✋ ssh doesn't know «$ALIAS». Add it to ~/.ssh/config first (docs/INSTALL.md step 3)."; exit 1; fi
echo "① Key login check"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true 2>/dev/null; then
  echo "✋ «ssh $ALIAS» needs a password or passphrase. The background tunnel can't type it."
  echo "   Do docs/INSTALL.md steps 1–2 (key), and for a passphrase: ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
  exit 1
fi
LABEL="com.serverboard.tunnel.$ALIAS"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/serverboard-tunnel-$ALIAS.log"
# If ~/.ssh/config already has LocalForward for this port, don't add a second one (it would fail).
FWD=""
ssh -G "$ALIAS" 2>/dev/null | grep -qiE "^localforward ($PORT|127\.0\.0\.1:$PORT|localhost:$PORT) " || FWD="<string>-L</string><string>$PORT:127.0.0.1:$PORT</string>"
echo "② Register the tunnel ($LABEL)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string><string>-N</string>
    <string>-o</string><string>BatchMode=yes</string>
    <string>-o</string><string>ConnectTimeout=10</string>
    <string>-o</string><string>ServerAliveInterval=15</string>
    <string>-o</string><string>ServerAliveCountMax=2</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    $FWD
    <string>$ALIAS</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StandardOutPath</key><string>$LOG</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null
echo "③ Check (up to 20 s)"
for i in $(seq 1 10); do
  if curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/ping" | grep -q 200; then
    echo; echo "✅ Done — bookmark http://localhost:$PORT . It stays connected after closing Terminal and after a reboot."; exit 0
  fi
  sleep 2
done
echo; echo "❌ The board doesn't open yet. Common causes:"
echo "   · another app/window already uses port $PORT on this Mac (close it, or use a different port)"
echo "   · the board isn't running on the server: ssh $ALIAS 'pm2 status dev-board'"
echo "--- last tunnel log ---"; tail -5 "$LOG" 2>/dev/null
exit 1
