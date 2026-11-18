#!/bin/bash
# Server Board — always-on tunnel for macOS (run on your Mac, once per server).
# The Mac needs no copy of this repository — the board's «Open on other devices» panel shows this line filled in:
#   S=$(ssh user@server cat dev-server/scripts/connect-mac.sh) && bash -c "$S" connect-mac <alias> user@server[:sshport]
# or, from a copy of this repository:  bash scripts/connect-mac.sh <alias> [user@server[:sshport]] [port]
# Piping also works:  ssh user@server 'cat dev-server/scripts/connect-mac.sh' | bash -s <alias> user@server
#   (the whole script sits in main() and runs only after bash has read it all; every ssh that connects uses -n)
#   <alias>        Host name for this server in ~/.ssh/config — one per server (the board suggests sb-<name>-<port>)
#   user@server    used only to add <alias> to ~/.ssh/config when it is missing (the old file is backed up first)
#   [port]         board port on the server (default: read from the server's board/config.json)
# What it does: a LaunchAgent that keeps `ssh -N` open (starts at login, reconnects 15 s after a drop),
#               checks http://localhost:<port> really is THIS server's board (serverName from /api/ping),
#               then opens http://localhost:<port>/#autotunnel=<alias> so the board knows this Mac's browser has the tunnel.
# Several servers: each board needs its own port. The Mac uses the same number as the server (no Mac-only remap —
#   the board only accepts localhost:<its port>), so if another board already holds the port on this Mac, this stops.
# Undo:  launchctl bootout gui/$(id -u)/com.serverboard.tunnel.<alias>; rm ~/Library/LaunchAgents/com.serverboard.tunnel.<alias>.plist
set -u
STEP="start"; FIN=""
# 말없이 끝나지 않게 — 끝(✅)까지 못 가고 끝나면 어디서 멈췄는지 한 줄 (✋ 줄이 있으면 그 줄이 까닭)
on_exit() {
  rc=$?
  [ -n "$FIN" ] && return
  type t >/dev/null 2>&1 || t() { printf '%s' "$2"; }
  if [ "$rc" = 0 ]; then
    printf '%s\n' "■ $(t "«$STEP» 단계에서 말없이 끝났어요(끝 ✅ 전). 파이프로 돌렸다면 이렇게 다시: ssh <별명> 'cat dev-server/scripts/connect-mac.sh' > ~/connect-mac.sh && bash ~/connect-mac.sh <별명>" "Ended silently at step «$STEP» (before ✅). If you piped it, run it this way instead: ssh <alias> 'cat dev-server/scripts/connect-mac.sh' > ~/connect-mac.sh && bash ~/connect-mac.sh <alias>")"
  else
    printf '%s\n' "■ $(t "«$STEP» 단계에서 멈춤(종료 코드 $rc) — 바로 위 줄이 까닭이에요." "Stopped at step «$STEP» (exit $rc) — the line above says why.")"
  fi
}
trap on_exit EXIT
main() {
L=en
case "${LC_ALL:-}${LANG:-}" in ko*|*ko_KR*) L=ko;; esac
[ "$L" = en ] && defaults read -g AppleLocale 2>/dev/null | grep -q '^ko' && L=ko
t() { [ "$L" = ko ] && printf '%s' "$1" || printf '%s' "$2"; }
say() { printf '%s\n' "$*"; }

ALIAS=""; TARGET=""; PORT=""
for a in ${1+"$@"}; do   # bash 3.2 + set -u: 빈 "$@" 도 안전하게
  case "$a" in
    *@*) TARGET="$a";;
    ''|*[!0-9]*) [ -z "$ALIAS" ] && ALIAS="$a";;
    *) PORT="$a";;
  esac
done
if [ "$(uname)" != "Darwin" ]; then say "✋ $(t '맥에서 실행하세요 — 지금 창은 맥이 아닙니다(서버 안일 수 있음).' 'Run this on your Mac, not on the server.')"; exit 1; fi
if [ -z "$ALIAS" ]; then say "$(t '사용법' 'Usage'): bash scripts/connect-mac.sh <alias> [user@server] [port]"; exit 1; fi
case "$ALIAS" in *[!A-Za-z0-9._-]*|-*) say "✋ $(t "별명은 영문·숫자·. _ - 만: «$ALIAS»" "The alias may use letters, digits and . _ - only: «$ALIAS»")"; exit 1;; esac

# ⓪ ~/.ssh/config 에 별명이 없으면 넣는다 (user@server 를 받았을 때만 · 원래 파일은 백업)
CFG="$HOME/.ssh/config"
has_alias() { awk -v a="$ALIAS" 'tolower($1)=="host"{for(i=2;i<=NF;i++) if($i==a) f=1} END{exit !f}' "$CFG" 2>/dev/null; }
if [ -n "$TARGET" ]; then
  TU="${TARGET%@*}"; THP="${TARGET#*@}"; TH="${THP%%:*}"; TP=""
  [ "$THP" != "$TH" ] && TP="${THP##*:}"
  case "$TU" in ''|*[!A-Za-z0-9._-]*) TH="";; esac
  case "$TH" in ''|*[!A-Za-z0-9._-]*) say "✋ $(t "서버 주소가 이상합니다: «$TARGET»" "Odd server address: «$TARGET»")"; exit 1;; esac
  case "$TP" in *[!0-9]*) say "✋ $(t "SSH 포트가 이상합니다: «$TP»" "Odd SSH port: «$TP»")"; exit 1;; esac
fi
STEP="⓪"; say "⓪ $(t "ssh 별명 «$ALIAS»" "ssh alias «$ALIAS»")"
if has_alias; then
  if [ -n "$TARGET" ]; then
    NOWH=$(ssh -G "$ALIAS" 2>/dev/null | awk '$1=="hostname"{print $2; exit}')
    if [ -n "$NOWH" ] && [ "$NOWH" != "$TH" ]; then
      say "✋ $(t "~/.ssh/config 의 «$ALIAS» 는 다른 서버($NOWH)를 가리켜요 — 다른 별명을 쓰거나 그 줄을 고친 뒤 다시." "«$ALIAS» in ~/.ssh/config points to another server ($NOWH) — use another alias or fix that entry, then run again.")"
      exit 1
    fi
  fi
  say "   $(t '이미 있음 — 그대로 둠' 'already there — left as is')"
elif [ -z "$TARGET" ]; then
  say "✋ $(t "~/.ssh/config 에 «$ALIAS» 가 없어요. 상황판 «다른 기기에서 열기» 의 한 줄(user@server 가 들어 있음)을 쓰세요." "«$ALIAS» is not in ~/.ssh/config. Use the line from the board's «Open on other devices» panel (it includes user@server).")"
  exit 1
else
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  [ -f "$CFG" ] && cp -p "$CFG" "$CFG.bak-serverboard"
  { printf '\n# Server Board — %s (connect-mac.sh)\nHost %s\n  HostName %s\n  User %s\n' "$ALIAS" "$ALIAS" "$TH" "$TU"
    [ -n "$TP" ] && printf '  Port %s\n' "$TP"
    printf '  ServerAliveInterval 15\n'; } >> "$CFG"
  chmod 600 "$CFG"
  # 앞쪽 «Host *» 같은 덩어리가 User·HostName 을 먼저 정하면(ssh 는 처음 것이 이김) 넣은 값이 안 먹음 — 알림
  GOTH=$(ssh -G "$ALIAS" 2>/dev/null | awk '$1=="hostname"{print $2; exit}'); GOTU=$(ssh -G "$ALIAS" 2>/dev/null | awk '$1=="user"{print $2; exit}')
  [ "$GOTH" = "$TH" ] && [ "$GOTU" = "$TU" ] || say "△ $(t "~/.ssh/config 앞쪽 설정이 이 별명의 주소·사용자를 덮어써요(지금 $GOTU@$GOTH) — 앞쪽 «Host *» 덩어리를 확인하세요." "An earlier entry in ~/.ssh/config overrides this alias (now $GOTU@$GOTH) — check the «Host *» block above it.")"
  say "   $(t "넣음 (이제 «ssh $ALIAS» 로 접속$([ -f "$CFG.bak-serverboard" ] && echo " · 원래 파일: ~/.ssh/config.bak-serverboard"))" "added (now «ssh $ALIAS» works$([ -f "$CFG.bak-serverboard" ] && echo " · old file: ~/.ssh/config.bak-serverboard"))")"
fi

STEP="①"; say "① $(t '비밀번호 없이 접속되는지' 'Key login check')"
if ! ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true 2>/dev/null; then
  say "✋ $(t "«ssh $ALIAS» 가 비밀번호나 열쇠 암호를 물어요 — 뒤에서 도는 통로는 그걸 넣을 수 없어요." "«ssh $ALIAS» needs a password or passphrase. The background tunnel can't type it.")"
  say "   $(t "열쇠가 없으면 ssh-keygen -t ed25519 → cat ~/.ssh/id_ed25519.pub 한 줄을 서버 ~/.ssh/authorized_keys 끝에 · 열쇠에 암호가 있으면 ssh-add --apple-use-keychain ~/.ssh/id_ed25519" "No key? ssh-keygen -t ed25519 → append the line from cat ~/.ssh/id_ed25519.pub to the server's ~/.ssh/authorized_keys · key with a passphrase: ssh-add --apple-use-keychain ~/.ssh/id_ed25519")"
  exit 1
fi
say "   $(t "됨 · «post-quantum key exchange» 경고가 보이면 무시해도 돼요(서버 ssh 가 오래된 것 · 동작엔 상관없음)" "ok · a «post-quantum key exchange» warning is harmless — the server's ssh is older; it changes nothing")"
STEP="②"; say "② $(t '서버의 상황판 포트·이름' 'Board port and name on the server')"
# the name is cleaned the way the board shows it (":" and control characters → space, spaces collapsed, 40 characters)
INFO=$(ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" "PYTHONIOENCODING=utf-8 python3 -c 'import json,os,re
try: c=json.load(open(os.path.expanduser(\"~/dev-server/board/config.json\")))
except Exception: print(\"NOCONFIG\"); raise SystemExit
n=re.sub(r\"\\s+\",\" \",re.sub(r\"[:\\x00-\\x1f]\",\" \",str(c.get(\"serverName\") or \"\"))).strip()[:40]
print(int(c.get(\"port\") or 8800), \"ko\" if c.get(\"lang\")==\"ko\" else \"en\", n)'" 2>/dev/null)
[ "$INFO" = NOCONFIG ] && { say "✋ $(t "«$ALIAS» 에 ~/dev-server/board/config.json 이 없어요 — 거기에 상황판을 먼저 설치(install.sh)." "«$ALIAS» has no ~/dev-server/board/config.json — install the board there first (install.sh).")"; exit 1; }
SPORT="${INFO%% *}"; REST="${INFO#* }"; SLANG="${REST%% *}"; SNAME="${REST#* }"
[ "$REST" = "$INFO" ] && REST=""
[ "$SNAME" = "$REST" ] && SNAME=""
case "$SLANG" in ko|en) L="$SLANG";; esac
case "$SPORT" in ''|*[!0-9]*) say "✋ $(t "«$ALIAS» 의 ~/dev-server/board/config.json 을 읽지 못했어요 — 상황판이 설치돼 있나요?" "Could not read ~/dev-server/board/config.json on «$ALIAS» — is the board installed there?")"; exit 1;; esac
if [ -n "$PORT" ] && [ "$PORT" != "$SPORT" ]; then
  say "✋ $(t "«$ALIAS» 의 상황판은 $PORT 가 아니라 $SPORT 번이에요. 맥에서도 같은 번호를 써야 해요(다른 번호는 상황판이 거절)." "The board on «$ALIAS» uses port $SPORT, not $PORT. Use the same number on the Mac — a different Mac port is refused by the board.")"
  say "   $(t "$SPORT 번을 이 맥의 다른 서버 상황판이 쓰고 있으면 이 서버 상황판 포트를 바꾸세요: docs/OPERATIONS.md «상황판 포트 바꾸기»." "If $SPORT is taken by another server's board on this Mac, change THIS server's port: docs/OPERATIONS.md «Change the board port».")"
  exit 1
fi
PORT="$SPORT"
[ -n "$SNAME" ] || say "△ $(t "«$ALIAS» 의 서버 이름(serverName)이 비어 있어요 — 정해 두면(board/config.json) 상황판끼리 구별돼요." "serverName is empty on «$ALIAS» — set it (board/config.json \"serverName\") so you can tell the boards apart.")"
say "   $(t "포트 $PORT · 서버 «${SNAME:-?}»" "port $PORT · server «${SNAME:-?}»")"
ping_name() { curl -s -m 5 "http://localhost:$1/api/ping" 2>/dev/null | sed -n 's/.*"serverName":"\([^"]*\)".*/\1/p'; }   # no python needed on the Mac
LABEL="com.serverboard.tunnel.$ALIAS"
# Is the port already taken on this Mac? Our own earlier tunnel for this alias is fine (re-run); anything else stops.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  OWN=$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -c "state = running")
  NOW=$(ping_name "$PORT")
  if [ "$OWN" = 0 ] && [ -n "$NOW" ] && [ "$NOW" = "$SNAME" ]; then
    say "✋ $(t "$PORT 번을 손으로 연 ssh 통로(같은 서버 «$NOW»)가 쥐고 있어요. 그 터미널 창(ssh -L …)을 닫고 이 줄을 다시 붙여 넣으세요." "Port $PORT is held by an ssh tunnel you opened by hand to this same server («$NOW»). Close that ssh window (or its ssh -L) and run this again.")"
    exit 1
  fi
  if [ "$OWN" = 0 ] || { [ -n "$NOW" ] && [ -n "$SNAME" ] && [ "$NOW" != "$SNAME" ]; }; then
    say "✋ $(t "이 맥에서 $PORT 번을 이미 쓰고 있어요${NOW:+ — «$NOW» 상황판}:" "Port $PORT is already used on this Mac${NOW:+ — by the board of «$NOW»}:")"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print "   "$1" pid "$2}' | head -3
    say "   $(t "이 서버 상황판 포트를 다른 번호로 바꾼 뒤 다시(docs/OPERATIONS.md «상황판 포트 바꾸기»)." "Give this server's board a different port (docs/OPERATIONS.md «Change the board port»), then run this again.")"
    exit 1
  fi
fi
# Another Host in ~/.ssh/config already forwarding this port → the second «ssh» would only warn and open no tunnel.
for H in $(awk 'tolower($1)=="host"{for(i=2;i<=NF;i++) if($i !~ /[*?!]/) print $i}' "$CFG" 2>/dev/null | sort -u); do
  [ "$H" = "$ALIAS" ] && continue
  [ "$(ssh -G "$H" 2>/dev/null | grep -iE '^(hostname|user|port) ' | sort)" = "$(ssh -G "$ALIAS" 2>/dev/null | grep -iE '^(hostname|user|port) ' | sort)" ] && continue   # another alias for the same server
  if ssh -G "$H" 2>/dev/null | grep -qiE "^localforward ($PORT|127\.0\.0\.1:$PORT|localhost:$PORT) "; then
    say "✋ $(t "~/.ssh/config 의 «$H» 가 이미 $PORT 번을 넘겨요 — 상황판끼리 겹쳐요. 이 서버 상황판 포트를 바꾸세요." "~/.ssh/config «$H» already forwards port $PORT — the boards would collide. Give this server's board a different port.")"; exit 1
  fi
done
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/serverboard-tunnel-$ALIAS.log"
# If ~/.ssh/config already has LocalForward for this port, don't add a second one (it would fail).
FWD=""
ssh -G "$ALIAS" 2>/dev/null | grep -qiE "^localforward ($PORT|127\.0\.0\.1:$PORT|localhost:$PORT) " || FWD="<string>-L</string><string>$PORT:127.0.0.1:$PORT</string>"
STEP="③"; say "③ $(t "자동 통로 등록 ($LABEL)" "Register the tunnel ($LABEL)")"
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
STEP="④"; say "④ $(t '확인 (최대 20초)' 'Check (up to 20 s)')"
for i in $(seq 1 10); do
  if curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/ping" | grep -q 200; then
    NOW=$(ping_name "$PORT")
    [ -z "$NOW" ] && say "△ $(t "열린 상황판 이름을 읽지 못해 «${SNAME:-$ALIAS}» 인지 확인 못 했어요 — 상황판 머리의 이름을 보세요." "Could not read the board's name to confirm it is «${SNAME:-$ALIAS}» — check the name in the board header.")"
    if [ -n "$SNAME" ] && [ -n "$NOW" ] && [ "$NOW" != "$SNAME" ]; then
      say; say "✘ $(t "localhost:$PORT 에 다른 서버 상황판이 열렸어요(«$NOW», 기대 «$SNAME»). 다른 통로를 닫거나 이 서버 상황판 포트를 바꾸세요." "A different server's board opened on localhost:$PORT («$NOW», expected «$SNAME»). Close the other tunnel or give this server's board a different port.")"; exit 1
    fi
    say; say "✅ Done — $(t "«${NOW:-$ALIAS}» http://localhost:$PORT (즐겨찾기). 터미널을 닫아도, 맥을 다시 켜도 열려요. 끊겨도 15초 뒤 다시 붙어요." "«${NOW:-$ALIAS}» at http://localhost:$PORT (bookmark it). It stays connected after closing Terminal and after a reboot, and reconnects 15 s after a drop.")"
    say "   $(t "되돌리기: launchctl bootout gui/\$(id -u)/$LABEL; rm $PLIST" "Undo: launchctl bootout gui/\$(id -u)/$LABEL; rm $PLIST")"
    # 이 맥 브라우저에 «자동 통로 있음» 표시 — 상황판이 «늘 열어 두기» 권하기를 멈춤
    open "http://localhost:$PORT/#autotunnel=$ALIAS" 2>/dev/null
    FIN=1; exit 0
  fi
  sleep 2
done
say; say "❌ $(t '상황판이 아직 안 열려요. 흔한 까닭:' "The board doesn't open yet. Common causes:")"
say "   · $(t "이 맥의 다른 앱·창이 $PORT 번을 쓰는 중(닫거나 다른 번호로)" "another app/window already uses port $PORT on this Mac (close it, or use a different port)")"
say "   · $(t "서버에서 상황판이 안 돌고 있음: ssh $ALIAS 'pm2 status dev-board'" "the board isn't running on the server: ssh $ALIAS 'pm2 status dev-board'")"
say "--- $(t '통로 기록 끝부분' 'last tunnel log') ---"; tail -5 "$LOG" 2>/dev/null
exit 1
}
main ${1+"$@"}
