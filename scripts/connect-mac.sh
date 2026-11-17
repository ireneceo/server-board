#!/bin/bash
# Server Board — always-on tunnel for macOS (run on your Mac, once).
# Usage:  bash scripts/connect-mac.sh <ssh-alias> [port]
#   <ssh-alias>  the Host name from ~/.ssh/config (docs/INSTALL.md step 3), e.g. myserver
#   [port]       board port on the server (default: read from the server's board/config.json)
# What it does: a LaunchAgent that keeps `ssh -N` open (starts at login, reconnects 15 s after a drop),
#               then checks http://localhost:<port> really is THIS server's board (serverName from /api/ping).
# Several servers: each board needs its own port. The Mac uses the same number as the server (no Mac-only remap —
#   the board only accepts localhost:<its port>), so if another board already holds the port on this Mac, this stops.
# Undo:  launchctl bootout gui/$(id -u)/com.serverboard.tunnel.<alias>; rm ~/Library/LaunchAgents/com.serverboard.tunnel.<alias>.plist
set -u
ALIAS="${1:-}"; PORT="${2:-}"
if [ "$(uname)" != "Darwin" ]; then echo "✋ Run this on your Mac, not on the server."; exit 1; fi
if [ -z "$ALIAS" ]; then echo "Usage: bash scripts/connect-mac.sh <ssh-alias> [port]   (alias = Host in ~/.ssh/config)"; exit 1; fi
if ! ssh -G "$ALIAS" >/dev/null 2>&1; then echo "✋ ssh doesn't know «$ALIAS». Add it to ~/.ssh/config first (docs/INSTALL.md step 3)."; exit 1; fi
echo "① Key login check"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true 2>/dev/null; then
  echo "✋ «ssh $ALIAS» needs a password or passphrase. The background tunnel can't type it."
  echo "   Do docs/INSTALL.md steps 1–2 (key), and for a passphrase: ssh-add --apple-use-keychain ~/.ssh/id_ed25519"
  exit 1
fi
echo "② Board port and name on the server"
# the name is cleaned the way the board shows it (":" and control characters → space, spaces collapsed, 40 characters)
INFO=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" "PYTHONIOENCODING=utf-8 python3 -c 'import json,os,re
try: c=json.load(open(os.path.expanduser(\"~/dev-server/board/config.json\")))
except Exception: print(\"NOCONFIG\"); raise SystemExit
n=re.sub(r\"\\s+\",\" \",re.sub(r\"[:\\x00-\\x1f]\",\" \",str(c.get(\"serverName\") or \"\"))).strip()[:40]
print(int(c.get(\"port\") or 8800), n)'" 2>/dev/null)
SPORT="${INFO%% *}"; SNAME="${INFO#* }"; [ "$SNAME" = "$INFO" ] && SNAME=""
[ "$INFO" = NOCONFIG ] && { echo "✋ «$ALIAS» has no ~/dev-server/board/config.json — install the board there first (install.sh)."; exit 1; }
case "$SPORT" in ''|*[!0-9]*) echo "✋ Could not read ~/dev-server/board/config.json on «$ALIAS» — is the board installed there?"; exit 1;; esac
if [ -n "$PORT" ] && [ "$PORT" != "$SPORT" ]; then
  echo "✋ The board on «$ALIAS» uses port $SPORT, not $PORT. Use the same number on the Mac — a different Mac port is refused by the board."
  echo "   If $SPORT is taken by another server's board on this Mac, change THIS server's port: docs/OPERATIONS.md «Change the board port»."
  exit 1
fi
PORT="$SPORT"
[ -n "$SNAME" ] || echo "△ serverName is empty on «$ALIAS» — set it (board/config.json \"serverName\") so you can tell the boards apart."
echo "   port $PORT · server «${SNAME:-?}»"
ping_name() { curl -s -m 5 "http://localhost:$1/api/ping" 2>/dev/null | sed -n 's/.*"serverName":"\([^"]*\)".*/\1/p'; }   # no python needed on the Mac
LABEL="com.serverboard.tunnel.$ALIAS"
# Is the port already taken on this Mac? Our own earlier tunnel for this alias is fine (re-run); anything else stops.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  OWN=$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -c "state = running")
  NOW=$(ping_name "$PORT")
  if [ "$OWN" = 0 ] && [ -n "$NOW" ] && [ "$NOW" = "$SNAME" ]; then
    echo "✋ Port $PORT is held by an ssh tunnel you opened by hand to this same server («$NOW»). Close that ssh window (or its ssh -L) and run this again."
    exit 1
  fi
  if [ "$OWN" = 0 ] || { [ -n "$NOW" ] && [ -n "$SNAME" ] && [ "$NOW" != "$SNAME" ]; }; then
    echo "✋ Port $PORT is already used on this Mac${NOW:+ — by the board of «$NOW»}:"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print "   "$1" pid "$2}' | head -3
    echo "   Give this server's board a different port (docs/OPERATIONS.md «Change the board port»), then run this again."
    exit 1
  fi
fi
# Another Host in ~/.ssh/config already forwarding this port → the second «ssh» would only warn and open no tunnel.
for H in $(awk 'tolower($1)=="host"{for(i=2;i<=NF;i++) if($i !~ /[*?!]/) print $i}' "$HOME/.ssh/config" 2>/dev/null | sort -u); do
  [ "$H" = "$ALIAS" ] && continue
  [ "$(ssh -G "$H" 2>/dev/null | grep -iE '^(hostname|user|port) ' | sort)" = "$(ssh -G "$ALIAS" 2>/dev/null | grep -iE '^(hostname|user|port) ' | sort)" ] && continue   # another alias for the same server
  if ssh -G "$H" 2>/dev/null | grep -qiE "^localforward ($PORT|127\.0\.0\.1:$PORT|localhost:$PORT) "; then
    echo "✋ ~/.ssh/config «$H» already forwards port $PORT — the boards would collide. Give this server's board a different port."; exit 1
  fi
done
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/serverboard-tunnel-$ALIAS.log"
# If ~/.ssh/config already has LocalForward for this port, don't add a second one (it would fail).
FWD=""
ssh -G "$ALIAS" 2>/dev/null | grep -qiE "^localforward ($PORT|127\.0\.0\.1:$PORT|localhost:$PORT) " || FWD="<string>-L</string><string>$PORT:127.0.0.1:$PORT</string>"
echo "③ Register the tunnel ($LABEL)"
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
echo "④ Check (up to 20 s)"
for i in $(seq 1 10); do
  if curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/ping" | grep -q 200; then
    NOW=$(ping_name "$PORT")
    [ -z "$NOW" ] && echo "△ Could not read the board's name to confirm it is «${SNAME:-$ALIAS}» — check the name in the board header."
    if [ -n "$SNAME" ] && [ -n "$NOW" ] && [ "$NOW" != "$SNAME" ]; then
      echo; echo "✘ A different server's board opened on localhost:$PORT («${NOW:-?}», expected «$SNAME»)."
      echo "   Close the other tunnel or give this server's board a different port."; exit 1
    fi
    echo; echo "✅ Done — «${NOW:-$ALIAS}» at http://localhost:$PORT (bookmark it). It stays connected after closing Terminal and after a reboot."; exit 0
  fi
  sleep 2
done
echo; echo "❌ The board doesn't open yet. Common causes:"
echo "   · another app/window already uses port $PORT on this Mac (close it, or use a different port)"
echo "   · the board isn't running on the server: ssh $ALIAS 'pm2 status dev-board'"
echo "--- last tunnel log ---"; tail -5 "$LOG" 2>/dev/null
exit 1
