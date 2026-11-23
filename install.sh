#!/usr/bin/env bash
# Server Board — one-command install · 서버 상황판 한 줄 설치
#   curl -fsSL https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh | bash
#   (safer: curl -fsSLo install.sh https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh && less install.sh && bash install.sh)
# What it does: checks this server → (asks first) installs missing Node/PM2/Claude Code in YOUR account, no root →
#   puts the board in ~/dev-server → writes default settings → starts it with PM2 → (asks first) Claude login and
#   the two session settings (asked one by one) → (asks first) the terminal menu → prints how to open the board. Safe to run again: it keeps your settings.
# No sudo. No telemetry. Nothing is changed before you answer yes (except the board itself in ~/dev-server).
# Env (optional): SB_LANG=en|ko SB_PORT SB_NAME (server name) SB_OTHER_PORTS ("8800 8801": boards you already open from your computer)
#   SB_TZ SB_OWNER SB_REPO SB_MENU=1 (add the terminal menu without asking)
#   SB_YES=1 (accept defaults, install nothing, never touch settings.json or ~/.bashrc)
#   As root it stops and offers a dedicated account (no password, no sudo), then re-runs as that account. SB_AS_ROOT=1 forces root (not recommended).
# Exit: 0 ok · 2 a required tool missing (and not installed) · 3 ~/dev-server is something else · 4 the board did not start · 5 run as root and no dedicated account
set -u

SB_REPO="${SB_REPO:-https://github.com/ireneceo/server-board}"
DIR="$HOME/dev-server"
YES="${SB_YES:-}"
# curl | bash has no keyboard on stdin — read answers from the terminal
if [ ! -t 0 ] && [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then exec </dev/tty; fi
[ -t 0 ] || YES=1

L="${SB_LANG:-}"; [ -z "$L" ] && case "${LANG:-}${LC_ALL:-}" in ko*|*ko_KR*) L=ko;; *) L=en;; esac; case "$L" in ko|en) ;; *) L=en;; esac
t() { [ "$L" = ko ] && printf '%s' "$1" || printf '%s' "$2"; }
say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '✘ %s\n' "$2"; exit "$1"; }
ask() {  # ask "question" default(y|n) → 0 = yes
  local q="$1" d="$2" a
  if [ -n "$YES" ]; then [ "$d" = y ]; return; fi
  read -r -p "$q $( [ "$d" = y ] && echo '[Y/n]' || echo '[y/N]' ) " a || a=""
  a="${a:-$d}"; case "$a" in y|Y|yes|YES|예|네|ㅇ) return 0;; *) return 1;; esac
}
prompt() {  # prompt "question" default → echo answer
  local q="$1" d="$2" a
  if [ -n "$YES" ]; then printf '%s' "$d"; return; fi
  read -r -p "$q [$d] " a || a=""; printf '%s' "${a:-$d}"
}

step "Server Board — $(t '설치' 'install')"

# 1. hard gates (no changes)
[ "$(uname -s)" = Linux ] && [ -r /proc/meminfo ] || die 2 "$(t '리눅스 서버에서만 됩니다(/proc 필요). 지원 범위: README «어디서 돌아가나»' 'Linux servers only (/proc needed). See README "Where it runs"')"
touch "$HOME/.sb-install.$$" 2>/dev/null && rm -f "$HOME/.sb-install.$$" || die 2 "$(t '홈 폴더에 쓸 수 없습니다' 'cannot write to your home folder')"
# root: the board and its AI sessions should never run as root — stop and offer a dedicated account (2026-11-23)
#   The account gets NO password and is NOT in the sudo group, so the AI running in it cannot become root.
#   Root's SSH keys are copied so you can log in as it right away. Then this installer runs again as that account.
if [ "$(id -u)" = 0 ] && [ -z "${SB_AS_ROOT:-}" ] && [ "${1:-}" != "--as-root" ]; then
  say "△ $(t 'root 로 실행 중 — 상황판과 AI 작업방은 root 가 아닌 전용 계정으로 돌려야 합니다(AI 가 서버 전체 권한을 갖지 않게).' 'running as root — the board and its AI sessions should run in a dedicated account, not root (so the AI does not get full control of the server).')"
  [ -n "$YES" ] && die 5 "$(t '키보드 없이 root 로는 설치하지 않습니다 — 계정을 만들고(adduser dev) 그 계정으로 다시 실행하거나, 꼭 root 로 하려면 SB_AS_ROOT=1' 'not installing as root without a keyboard — create an account (adduser dev) and run again as it, or set SB_AS_ROOT=1 to force root')"
  ACC=$(prompt "$(t '전용 계정 이름' 'Dedicated account name')" dev)
  printf '%s' "$ACC" | grep -qxE '[a-z_][a-z0-9_-]{0,31}' || { die 5 "$(t '계정 이름은 영문 소문자·숫자·-_ 만' 'account name: lowercase letters, digits, - and _ only')"; }
  [ "$ACC" = root ] && die 5 "$(t 'root 말고 다른 이름' 'pick a name other than root')"
  if id "$ACC" >/dev/null 2>&1; then
    { [ "$(id -u "$ACC")" = 0 ] || id -nG "$ACC" | grep -qwE 'sudo|wheel|admin'; } && die 5 "$(t "계정 $ACC 는 root 권한(sudo)이 있어 전용 계정으로 쓰지 않습니다 — 다른 이름을 고르세요" "account $ACC has root/sudo rights — not using it as the dedicated account; pick another name")"
    say "✔ $(t "계정 $ACC 가 이미 있습니다 — 그대로 씁니다" "account $ACC already exists — using it")"
  elif ask "$(t "계정 $ACC 를 만들까요? (비밀번호 없음·sudo 없음 · root 의 SSH 열쇠를 복사해 ssh $ACC@서버 로 바로 접속)" "Create account $ACC? (no password, no sudo · root's SSH keys are copied so ssh $ACC@server works right away)")" y; then
    adduser --disabled-password --gecos "" "$ACC" >/dev/null || die 5 "$(t '계정 만들기 실패' 'could not create the account')"
    say "✔ $(t "계정 $ACC 만듦 (되돌리기: deluser --remove-home $ACC)" "created account $ACC (undo: deluser --remove-home $ACC)")"
  else
    die 5 "$(t '설치하지 않았습니다 — 일반 계정으로 접속해 다시 실행하세요(꼭 root 로: SB_AS_ROOT=1)' 'nothing installed — log in as a normal account and run again (to force root: SB_AS_ROOT=1)')"
  fi
  AH=$(getent passwd "$ACC" | cut -d: -f6)
  if [ -s /root/.ssh/authorized_keys ] && [ -n "$AH" ]; then
    # written AS the account, never as root: root must not follow links inside a folder the account controls
    su - "$ACC" -s /bin/sh -c 'umask 077; mkdir -p "$HOME/.ssh" && touch "$HOME/.ssh/authorized_keys" || exit 1
      while IFS= read -r k; do [ -n "$k" ] && ! grep -qxF "$k" "$HOME/.ssh/authorized_keys" && printf "%s\n" "$k" >> "$HOME/.ssh/authorized_keys"; done
      chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys"' < /root/.ssh/authorized_keys || die 5 "$(t 'SSH 열쇠 복사 실패' 'could not copy the SSH keys')"
    say "✔ $(t "root 의 SSH 열쇠를 $ACC 에 넣음 — 다음부터 ssh $ACC@서버" "copied root's SSH keys to $ACC — from now on: ssh $ACC@server")"
  fi
  step "$(t "이어서 $ACC 계정으로 설치합니다" "Continuing the install as $ACC")"
  exec su - "$ACC" -c "curl -fsSL '${SB_RAW:-https://raw.githubusercontent.com/ireneceo/server-board/main}/install.sh' | SB_LANG='$L' bash"
fi
[ "$(id -u)" = 0 ] && say "△ $(t 'root 로 설치 중(SB_AS_ROOT) — AI 작업방도 root 권한으로 돕니다. 권하지 않습니다.' 'installing as root (SB_AS_ROOT) — AI sessions will also run as root. Not recommended.')"
command -v git >/dev/null || die 2 "$(t 'git 이 없습니다 — 설치: sudo apt-get install -y git (또는 업체에 요청)' 'git is missing — install: sudo apt-get install -y git (or ask your provider)')"
command -v curl >/dev/null || die 2 "$(t 'curl 이 없습니다 — 설치: sudo apt-get install -y curl' 'curl is missing — install: sudo apt-get install -y curl')"

# 2. Node 18+
load_nvm() { export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; }
node_ok() { command -v node >/dev/null && [ "$(node -v | sed 's/^v//; s/\..*//')" -ge 18 ] 2>/dev/null; }
NODE_FROM=system
node_ok || load_nvm
if ! node_ok; then
  say "✘ Node 18+ $(t '가 없습니다' 'not found')$(command -v node >/dev/null && echo " ($(node -v))")"
  if ask "$(t '내 계정에 nvm 으로 Node 20 을 설치할까요? (root 불필요 · https://github.com/nvm-sh/nvm v0.40.1)' 'Install Node 20 in your account with nvm? (no root · https://github.com/nvm-sh/nvm v0.40.1)')" n; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null || die 2 "$(t 'nvm 설치 실패' 'nvm install failed')"
    load_nvm; nvm install 20 >/dev/null && nvm alias default 20 >/dev/null; NODE_FROM=nvm
    node_ok || die 2 "$(t 'Node 설치 뒤에도 node 를 찾지 못했습니다 — 새 창에서 다시 실행해 보세요' 'node still not found after install — open a new terminal and run again')"
  else
    say "$(t '직접 설치(sudo):' 'Install it yourself (sudo):') curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 2
  fi
fi
say "✔ node $(node -v)"

# 3. PM2 (keeps the board running)
if ! command -v pm2 >/dev/null; then
  if ask "$(t 'PM2(상황판을 계속 켜 두는 프로그램)를 설치할까요? npm install -g pm2' 'Install PM2 (keeps the board running)? npm install -g pm2')" n; then
    npm install -g pm2 >/dev/null 2>&1 || die 2 "$(t 'PM2 설치 실패 — 권한 오류면 nvm 의 Node 를 쓰거나 sudo npm install -g pm2' 'PM2 install failed — on a permission error use Node from nvm, or sudo npm install -g pm2')"
    PM2_NEW=installed
  else say "$(t '설치 명령' 'Install with'): npm install -g pm2"; exit 2; fi
fi
PM2_NEW="${PM2_NEW:-present}"; say "✔ pm2 $(pm2 -v 2>/dev/null | tail -1)"

# 4. Claude Code (the board works without it — the board's checklist shows it)
CLAUDE_STATE=present
if ! command -v claude >/dev/null; then
  if ask "$(t 'Claude Code 를 설치할까요? npm install -g @anthropic-ai/claude-code (Anthropic 공식 설치 방법도 있음)' 'Install Claude Code? npm install -g @anthropic-ai/claude-code (Anthropic also offers a native installer)')" n; then
    npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 && CLAUDE_STATE=installed || { say "△ $(t 'Claude Code 설치 실패 — 상황판 «처음 설정» 에서 다시' 'Claude Code install failed — retry from the board checklist')"; CLAUDE_STATE=missing; }
  else CLAUDE_STATE=missing; say "△ $(t 'Claude Code 없이 진행 — 상황판 «처음 설정» 에 안내가 나옵니다' 'continuing without Claude Code — the board checklist will guide you')"; fi
fi
[ "$CLAUDE_STATE" != missing ] && say "✔ claude $(claude --version 2>/dev/null | head -1)"

# 5. the board in ~/dev-server
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo)"
RERUN=0
if [ -e "$DIR" ]; then
  if [ -f "$DIR/board/server.js" ] && [ -d "$DIR/.git" ]; then RERUN=1; say "✔ $(t '이미 설치됨 — 설정은 그대로 두고 다시 켭니다' 'already installed — keeping your settings, restarting it') ($DIR)"
    git -C "$DIR" status --porcelain 2>/dev/null | head -5 | sed 's/^/   /'
  elif [ -d "$DIR" ] && [ -z "$(ls -A "$DIR" 2>/dev/null | grep -v '^\.git$')" ]; then
    die 3 "$(t "$DIR 가 비어 있거나 받다 만 상태입니다 — 지우고 다시: rm -rf $DIR && bash install.sh" "$DIR is empty or a half-finished download — remove it and run again: rm -rf $DIR && bash install.sh")"
  else die 3 "$(t "$DIR 이(가) 이미 있고 서버 상황판이 아닙니다 — 옮기거나 직접 정리하세요(지우지 않았습니다)" "$DIR exists and is not a Server Board checkout — move it or sort it out by hand (nothing was deleted)")"; fi
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/board/server.js" ]; then
  git clone -q "$SCRIPT_DIR" "$DIR" && git -C "$DIR" remote set-url origin "$SB_REPO" || die 3 "clone failed"
else
  git clone -q "$SB_REPO" "$DIR" || die 3 "$(t "받기 실패: $SB_REPO" "download failed: $SB_REPO")"
fi
say "✔ $DIR"

# 6. host check (information)
if [ -f "$DIR/kit/check-host.sh" ]; then
  out=$(bash "$DIR/kit/check-host.sh" $( [ "$L" = ko ] && echo --ko || echo --en ) 2>&1); fails=$?
  printf '%s\n' "$out" | grep -E '^(✘|△)' | sed 's/^/   /'
  if [ "$fails" -gt 0 ] && ! ask "$(t "점검에서 ✘ ${fails}개 — 그래도 계속할까요?" "${fails} ✘ in the host check — continue anyway?")" n; then exit 2; fi
fi

# 7–8. defaults (only when missing — a re-run keeps yours)
# 서버 여러 대: 맥 한 대에서 localhost:<포트> 는 통로 하나에만 붙는다 — 포트가 같으면 다른 서버 상황판이 열린다.
#   그래서 포트는 «이 맥에서 보는 다른 서버 상황판들» 과 겹치지 않게, 서버에서 이미 쓰는 번호도 아니게 고른다. serverName 은 빈 값 금지.
port_busy() { node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(0));s.listen(+process.argv[1],"127.0.0.1",()=>s.close(()=>process.exit(1)))' "$1" 2>/dev/null; }
port_ok() {  # port_ok N "others" → 0 = 쓸 수 있음 (이유는 WHY)
  WHY=""
  case "$1" in ''|*[!0-9]*) WHY=$(t '숫자가 아님' 'not a number'); return 1;; esac
  [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || { WHY=$(t '1024–65535 사이로' 'use 1024–65535'); return 1; }
  for o in $2; do [ "$o" = "$1" ] && { WHY=$(t '이 맥에서 보는 다른 서버 상황판과 같은 포트' 'same port as another board you open from this computer'); return 1; }; done
  port_busy "$1" && { WHY=$(t '이 서버에서 이미 쓰는 포트' 'already in use on this server')$(command -v ss >/dev/null && ss -ltnpH "sport = :$1" 2>/dev/null | head -1 | awk '{print " — "$4" "$6}'); return 1; }
  return 0
}
free_port() { for p in ${SB_PORT:-} 8800 8801 8802 8803 8804 8805 8810 8820 8890; do port_ok "$p" "${1:-}" && { echo "$p"; return; }; done; echo ""; }
ask_server_name() {  # 기본 = 호스트 이름 · 빈 값이면 다시
  local d="${SB_NAME:-$(hostname -s 2>/dev/null || hostname 2>/dev/null)}" n
  say "$(t '서버 이름 — 상황판 머리·탭 제목·인증 앱 항목(«Server Board · 이름»)에 보임. 상황판을 깐 다른 서버와 다르게.' 'Server name — shown in the board header, tab title and authenticator entry («Server Board · name»). Make it different from your other servers.')" >&2
  while :; do
    n=$(prompt "$(t '서버 이름' 'Server name')" "$d" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write([...d.replace(/[:\u0000-\u001f]/g," ").replace(/\s+/g," ").trim()].slice(0,40).join("")))')   # 글자 단위로 40자(한글이 바이트 중간에서 잘리지 않게)
    [ -n "$n" ] && { printf '%s' "$n"; return; }
    say "✘ $(t '빈 값은 안 됩니다' 'cannot be empty')" >&2; [ -n "$YES" ] && { printf '%s' "server-$(hostname 2>/dev/null | cut -c1-20)"; return; }
  done
}
CFG="$DIR/board/config.json"
if [ ! -f "$CFG" ]; then
  [ -z "${SB_LANG:-}" ] && L=$(prompt "$(t '상황판 언어 en/ko' 'Board language en/ko')" "$L"); [ "$L" = ko ] || L=en
  TZ0="${SB_TZ:-$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)}"
  TZ1=$(prompt "$(t '내 시간대(서버가 아니라 내가 사는 곳 · 예 Asia/Seoul)' 'Your timezone (where you live, not the server · e.g. America/New_York)')" "${TZ0:-UTC}")
  node -e 'new Intl.DateTimeFormat("en-US",{timeZone:process.argv[1]})' "$TZ1" 2>/dev/null || { say "△ $(t "알 수 없는 시간대 $TZ1 → UTC" "unknown timezone $TZ1 → UTC")"; TZ1=UTC; }
  OWNER=$(prompt "$(t '상황판에 보일 내 이름' 'Your name on the board')" "${SB_OWNER:-$USER}")
  SNAME=$(ask_server_name)
  say "$(t '상황판 포트 — 내 컴퓨터(맥·휴대폰)는 localhost:<포트> 하나에 통로 하나만 붙어요. 같은 컴퓨터로 다른 서버 상황판도 보면 그 서버들과 다른 번호여야 합니다.' 'Board port — your computer (Mac/phone) maps localhost:<port> to one tunnel only. If you also open other servers'"'"' boards from it, this one needs a different number.')"
  OTHERS=$(prompt "$(t '이 컴퓨터에서 보는 다른 서버 상황판 포트(빈칸 = 없음 · 예: 8800 8801)' 'Ports of other boards you open from this computer (empty = none · e.g. 8800 8801)')" "${SB_OTHER_PORTS:-}" | tr ',' ' ')
  if [ -n "${SB_PORT:-}" ] && ! port_ok "$SB_PORT" "$OTHERS"; then say "✘ SB_PORT $SB_PORT — $WHY"; [ -n "$YES" ] && die 4 "SB_PORT $SB_PORT"; fi
  PORT0=$(free_port "$OTHERS"); [ -n "$PORT0" ] || PORT0=8899
  while :; do
    PORT=$(prompt "$(t '이 서버 상황판 포트' 'Port for this board')" "$PORT0")
    port_ok "$PORT" "$OTHERS" && break
    say "✘ $PORT — $WHY"; [ -n "$YES" ] && die 4 "$(t "포트 $PORT 을(를) 쓸 수 없음 — SB_PORT 로 다른 번호" "cannot use port $PORT — pick another with SB_PORT")"
  done
  # 접속 주소 — 공인 주소 먼저(사설·도커·Tailscale 100.64/10 은 뒤로) · 처음 설정 «서버 창 열기» 의 ssh 줄에 그대로 쓰임
  IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v ':' | grep -v '^$')
  IP=$(printf '%s\n' "$IPS" | grep -Ev '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.)' | head -1)
  [ -n "$IP" ] || IP=$(printf '%s\n' "$IPS" | head -1)
  node - "$DIR/board/config.example.json" "$CFG" "$OWNER" "$L" "$TZ1" "$PORT" "$USER" "${IP:-}" "$SNAME" <<'JS' || die 4 "config.json"
const fs=require('fs');const [ex,out,owner,lang,tz,port,user,ip,serverName]=process.argv.slice(2);
const c=JSON.parse(fs.readFileSync(ex,'utf8'));delete c._comment;
Object.assign(c,{owner,lang,timezone:tz,port:+port,serverName,devSsh:ip?`ssh ${user}@${ip}`:'',hideLinkHosts:ip?[ip.split('.').slice(0,3).join('.')+'.']:[]});
fs.writeFileSync(out+'.tmp',JSON.stringify(c,null,2)+'\n');fs.renameSync(out+'.tmp',out);
JS
  say "✔ board/config.json ($SNAME · $(t '언어' 'lang') $L · $TZ1 · $(t '포트' 'port') $PORT)"
  [ "$PORT" != 8800 ] && say "   $(t "통로·주소도 $PORT — ssh -L $PORT:127.0.0.1:$PORT … · http://localhost:$PORT" "use $PORT in the tunnel and address too — ssh -L $PORT:127.0.0.1:$PORT … · http://localhost:$PORT")"
else
  L=$(node -e 'try{const c=require(process.argv[1]);process.stdout.write(c.lang==="ko"?"ko":"en")}catch(e){process.stdout.write("en")}' "$CFG")
  say "✔ board/config.json $(t '그대로(포트는 바꾸지 않음)' 'kept (port unchanged)')"
  # 이미 깔린 서버 — 서버 이름이 비어 있으면 지금 채움(포트는 그대로 · 바꾸려면 docs/OPERATIONS 의 «포트 바꾸기»)
  if [ -z "$(node -e 'try{process.stdout.write(String(require(process.argv[1]).serverName||"").trim())}catch(e){}' "$CFG")" ]; then
    SNAME=$(ask_server_name)
    node -e 'const fs=require("fs");const [f,n]=process.argv.slice(1);const c=JSON.parse(fs.readFileSync(f,"utf8"));c.serverName=n;fs.writeFileSync(f+".tmp",JSON.stringify(c,null,2)+"\n");fs.renameSync(f+".tmp",f)' "$CFG" "$SNAME" \
      && say "✔ serverName = $SNAME"
  fi
fi
SNAME=$(node -e 'try{process.stdout.write(String(require(process.argv[1]).serverName||""))}catch(e){}' "$CFG")
PORT=$(node -e 'try{process.stdout.write(String(require(process.argv[1]).port||8800))}catch(e){process.stdout.write("8800")}' "$CFG")
if [ ! -f "$DIR/projects.json" ]; then
  node -e 'const fs=require("fs");const [f,d,p]=process.argv.slice(1);fs.writeFileSync(f,JSON.stringify([{key:"server",name:"Server",dir:d,stateFile:"session-state.md",noDevDone:true,devUrl:"http://localhost:"+p}],null,2)+"\n")' "$DIR/projects.json" "$DIR" "$PORT"
  say "✔ projects.json ($(t '서버 방만 — 프로젝트는 «AI 로 설치 마무리» 에서' 'server room only — projects come in «Finish setup with AI»'))"
fi
[ -f "$DIR/session-state.md" ] || cp "$DIR/kit/templates/$L/session-state.md" "$DIR/session-state.md" 2>/dev/null

# 10. start the board
if pm2 jlist 2>/dev/null | grep -q '"name":"dev-board"'; then pm2 restart dev-board --update-env >/dev/null 2>&1
else (cd "$DIR/board" && pm2 start server.js --name dev-board --no-treekill >/dev/null 2>&1); fi
pm2 save >/dev/null 2>&1
okb=""; for i in $(seq 1 20); do [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' -H "Host: localhost:$PORT" "http://127.0.0.1:$PORT/")" = 200 ] && { okb=1; break; }; sleep 0.5; done
[ -n "$okb" ] || die 4 "$(t '상황판이 켜지지 않았습니다 — 확인: pm2 logs dev-board --lines 30 --nostream' 'the board did not start — check: pm2 logs dev-board --lines 30 --nostream')"
say "✔ $(t '상황판 켜짐' 'board running') — 127.0.0.1:$PORT"

# 11. Claude login (you are at the terminal anyway)
LOGIN=unknown
if command -v claude >/dev/null; then
  if claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then LOGIN=yes; say "✔ $(t 'Claude 로그인됨' 'Claude logged in')"
  elif [ -z "$YES" ] && ask "$(t 'Claude 에 지금 로그인할까요? 주소가 나오면 아무 브라우저에서 열고, 받은 코드를 여기 붙여 넣습니다' 'Log in to Claude now? It shows a link to open in any browser, then you paste the code back here')" y; then
    if ask "$(t 'Claude 구독(Pro·Max·Team)으로? (아니오 = API 키·사용량 과금)' 'With a Claude subscription (Pro/Max/Team)? (no = API key, pay per use)')" y; then claude auth login; else claude auth login --console; fi
    claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true' && LOGIN=yes || LOGIN=no
  else LOGIN=no; fi
fi

# 12. room settings — two values in ~/.claude/settings.json, asked one by one with what each means (your choice)
SETTINGS_CHANGED=false
S="$HOME/.claude/settings.json"
cur=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(((d.permissions||{}).defaultMode||"")+"|"+((d.worktree||{}).bgIsolation||""))}catch(e){process.stdout.write("|")}' "$S")
CUR_MODE="${cur%%|*}"; CUR_ISO="${cur#*|}"; SET_MODE=""; SET_ISO=""
if [ "$cur" = "auto|none" ]; then say "✔ $(t '방 설정 됨 (권한 모드 auto · 원본 폴더 작업 none)' 'session settings already set (permission mode auto · bgIsolation none)')"
elif [ -z "${SB_YES:-}" ] && [ -t 0 ]; then
  say "$(t '작업방(백그라운드 Claude) 설정 두 가지 — ~/.claude/settings.json (원본은 settings.json.bak-날짜 로 백업 · 나중에 상황판에서 바꿔도 됨)' 'Two settings for background sessions — ~/.claude/settings.json (backup settings.json.bak-DATE · you can change them later from the board)')"
  if [ "$CUR_MODE" != auto ]; then
    say "  · $(t "권한 모드(permissions.defaultMode) 지금: ${CUR_MODE:-없음}" "Permission mode (permissions.defaultMode) now: ${CUR_MODE:-unset}")"
    say "    $(t 'auto — 방이 허락 창마다 멈추지 않음(위험한 명령은 Claude Code 가 따로 막음 · Claude Code 권한 안내서). 안 넣으면 방이 첫 허락 창에서 멈추고 터미널에서만 답할 수 있음' 'auto — sessions do not stop at every permission prompt (Claude Code still blocks risky actions · see its permission docs). Without it a session stops at its first prompt and only a terminal can answer')"
    ask "    $(t 'auto 로 넣을까요?' 'Set it to auto?')" y && SET_MODE=auto
  fi
  if [ "$CUR_ISO" != none ]; then
    say "  · $(t "원본 폴더 작업(worktree.bgIsolation) 지금: ${CUR_ISO:-없음 — 기본은 worktree}" "Work in the project folder (worktree.bgIsolation) now: ${CUR_ISO:-unset — default is worktree}")"
    say "    $(t 'none — 방이 원본 폴더에서 바로 일함(커밋 안 한 파일도 봄). 한 솔루션에 방 둘이 동시에 고치면 부딪힘 — 상황판이 같은 솔루션은 한 방씩 돌림. 안 넣으면 방마다 .claude/worktrees 의 별도 가지에서 일해 원본의 커밋 안 한 변경을 못 보고, 결과를 따로 합쳐야 함' 'none — sessions work right in the project folder (they see uncommitted files). Two sessions editing one project at once would clash — the board runs one session per project. Without it each session works on its own branch under .claude/worktrees, cannot see uncommitted changes in the folder, and its result must be merged by hand')"
    ask "    $(t 'none 으로 넣을까요?' 'Set it to none?')" y && SET_ISO=none
  fi
  if [ -n "$SET_MODE$SET_ISO" ]; then
    mkdir -p "$HOME/.claude"
    node - "$S" "$SET_MODE" "$SET_ISO" <<'JS' && SETTINGS_CHANGED=true && say "✔ settings.json" || say "△ $(t 'settings.json 을 읽지 못해 그대로 둠' 'could not read settings.json — left untouched')"
const fs=require('fs');const [f,mode,iso]=process.argv.slice(2);let d={};
if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,'utf8'));const day=new Date().toISOString().slice(0,10).replace(/-/g,'');fs.copyFileSync(f,f+'.bak-'+day);}
if(mode)d.permissions=Object.assign({},d.permissions,{defaultMode:mode});if(iso)d.worktree=Object.assign({},d.worktree,{bgIsolation:iso});
fs.writeFileSync(f+'.tmp',JSON.stringify(d,null,2)+'\n');fs.renameSync(f+'.tmp',f);
JS
  fi
fi
cur=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(((d.permissions||{}).defaultMode||"")+"|"+((d.worktree||{}).bgIsolation||""))}catch(e){process.stdout.write("|")}' "$S")
CUR_MODE="${cur%%|*}"; CUR_ISO="${cur#*|}"

# 13. terminal menu — ~/bin/dev + a block at the end of ~/.bashrc (shows the session list when you SSH in)
MENU=no
if [ -x "$HOME/bin/dev" ] && grep -q "dev-menu" "$HOME/.bashrc" 2>/dev/null; then MENU=yes
  if ! cmp -s "$DIR/kit/bin/dev" "$HOME/bin/dev"; then
    cp "$HOME/bin/dev" "$HOME/bin/dev.bak-$(date +%Y%m%d)" && cp "$DIR/kit/bin/dev" "$HOME/bin/dev" && chmod +x "$HOME/bin/dev" \
      && say "   $(t '~/bin/dev 를 새 판으로 바꿈 (이전: ~/bin/dev.bak-날짜)' 'updated ~/bin/dev (previous: ~/bin/dev.bak-DATE)')"
  fi
  say "✔ $(t '터미널 메뉴 (~/bin/dev)' 'terminal menu (~/bin/dev)')"
elif [ -f "$DIR/kit/bin/dev" ] && { [ -n "${SB_MENU:-}" ] || { [ -z "${SB_YES:-}" ] && [ -t 0 ] && ask "$(t '터미널 메뉴를 넣을까요? SSH 로 접속하면 작업방 목록이 뜨고 번호로 들어감 — ~/bin/dev 와 ~/.bashrc 끝 몇 줄(원본은 .bashrc.bak-날짜) · 끄기: touch ~/.dev-menu-off' 'Add the terminal menu? When you SSH in it lists sessions and opens one by number — ~/bin/dev plus a few lines at the end of ~/.bashrc (backup .bashrc.bak-DATE) · turn off: touch ~/.dev-menu-off')" y; }; }; then
  mkdir -p "$HOME/bin" && cp "$DIR/kit/bin/dev" "$HOME/bin/dev" && chmod +x "$HOME/bin/dev"
  if ! grep -q "dev-menu" "$HOME/.bashrc" 2>/dev/null; then
    [ -f "$HOME/.bashrc" ] && cp "$HOME/.bashrc" "$HOME/.bashrc.bak-$(date +%Y%m%d)"
    { printf '\n'; cat "$DIR/kit/templates/bashrc-block.sh"; } >> "$HOME/.bashrc"
  fi
  MENU=yes; say "✔ $(t '터미널 메뉴 (~/bin/dev · ~/.bashrc) — 다음 SSH 접속부터' 'terminal menu (~/bin/dev · ~/.bashrc) — from your next SSH login')"
fi

# 9. install-info.json (the board reads it for the checklist)
VER=$(git -C "$DIR" describe --tags --always 2>/dev/null || echo dev)
PREV=$(node -e 'try{process.stdout.write(String((require(process.argv[1]).rerun||0)+1))}catch(e){process.stdout.write("0")}' "$DIR/install-info.json")
[ "$RERUN" = 1 ] || PREV=0
node -e 'const fs=require("fs");const a=process.argv.slice(1);fs.writeFileSync(a[0],JSON.stringify({at:new Date().toISOString(),version:a[1],by:"install.sh",lang:a[2],port:+a[3],node:a[4],pm2:a[5],claude:a[6],login:a[7],settingsChanged:a[8]==="true",rerun:+a[9],serverName:a[10]},null,2)+"\n")' \
  "$DIR/install-info.json" "$VER" "$L" "$PORT" "$NODE_FROM" "$PM2_NEW" "$CLAUDE_STATE" "$LOGIN" "$SETTINGS_CHANGED" "$PREV" "$SNAME"

# 14. what next
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v ':' | head -1)
step "✅ $(t '설치 끝' 'Installed')"
say "$(t '1) 내 컴퓨터에서 통로 열기(창을 열어 둠):' '1) On your computer, open the tunnel (keep the window open):')"
say "     ssh -L $PORT:127.0.0.1:$PORT $USER@${IP:-<server>}"
say "   $(t '자세히(~/.ssh/config·휴대폰):' 'More (~/.ssh/config, phone):') $DIR/docs/INSTALL$( [ "$L" = ko ] && echo .ko).md"
say "$(t "2) 브라우저: http://localhost:$PORT  → 맨 위 «처음 설정» 칸이 남은 일을 알려 줍니다" "2) Browser: http://localhost:$PORT  → the «First setup» box at the top shows what's left")"
say "$(t '3) 마지막에 «AI 로 설치 마무리 ▶» — 프로젝트·규칙·명령·정기 점검을 AI 가 묻고 설정합니다' '3) Then «Finish setup with AI ▶» — the AI asks about your projects and sets up rules, commands and schedules')"
[ "$LOGIN" = yes ] || say "   △ $(t 'Claude 로그인 아직 — 상황판 안내대로 (claude auth login)' 'Claude not logged in yet — follow the board (claude auth login)')"
[ "$cur" = "auto|none" ] || say "   △ $(t "방 설정 아직(권한 모드 ${CUR_MODE:-없음} · 원본 폴더 작업 ${CUR_ISO:-없음}) — auto·none 권고 · 다시 묻기: bash $DIR/install.sh" "session settings not done (mode ${CUR_MODE:-unset} · bgIsolation ${CUR_ISO:-unset}) — auto and none recommended · ask again: bash $DIR/install.sh")"
[ "$MENU" = yes ] || say "   △ $(t "터미널 메뉴 없음 — 넣기: SB_MENU=1 bash $DIR/install.sh (또는 mkdir -p ~/bin && cp $DIR/kit/bin/dev ~/bin/dev && cat $DIR/kit/templates/bashrc-block.sh >> ~/.bashrc)" "no terminal menu — add it: SB_MENU=1 bash $DIR/install.sh (or mkdir -p ~/bin && cp $DIR/kit/bin/dev ~/bin/dev && cat $DIR/kit/templates/bashrc-block.sh >> ~/.bashrc)")"
say "$(t '재부팅 뒤에도 켜지게: pm2 startup → 나오는 sudo 한 줄 붙여 넣기(선택 · sudo 가 없는 전용 계정이면 그 줄을 root 로 접속한 창에서)' 'To start after a reboot: pm2 startup → paste the sudo line it prints (optional · in a dedicated account without sudo, paste it in a root session)')"
say "$(t '다시 실행해도 됩니다 — 설정은 그대로 둡니다.' 'You can run this again any time — it keeps your settings.')"
exit 0
