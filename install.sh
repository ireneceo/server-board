#!/usr/bin/env bash
# Server Board — one-command install · 서버 상황판 한 줄 설치
#   curl -fsSL https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh | bash
#   (safer: curl -fsSLo install.sh https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh && less install.sh && bash install.sh)
# What it does: checks this server → (asks first) installs missing Node/PM2/Claude Code in YOUR account, no root →
#   puts the board in ~/dev-server → writes default settings → starts it with PM2 → (asks first) Claude login and
#   permission settings → prints how to open the board. Safe to run again: it keeps your settings.
# No sudo. No telemetry. Nothing is changed before you answer yes (except the board itself in ~/dev-server).
# Env (optional): SB_LANG=en|ko SB_PORT SB_TZ SB_OWNER SB_REPO SB_YES=1 (accept defaults, install nothing, never touch settings.json)
# Exit: 0 ok · 2 a required tool missing (and not installed) · 3 ~/dev-server is something else · 4 the board did not start
set -u

SB_REPO="${SB_REPO:-https://github.com/ireneceo/server-board}"
DIR="$HOME/dev-server"
YES="${SB_YES:-}"
# curl | bash has no keyboard on stdin — read answers from the terminal
if [ ! -t 0 ] && [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then exec </dev/tty; fi
[ -t 0 ] || YES=1

L="${SB_LANG:-}"; [ -z "$L" ] && case "${LANG:-}${LC_ALL:-}" in ko*|*ko_KR*) L=ko;; *) L=en;; esac
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
[ "$(id -u)" = 0 ] && say "△ $(t 'root 로 실행 중 — 일반 사용자를 권합니다(root 는 필요 없음)' 'running as root — a normal user is recommended (root is not needed)')"
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
free_port() { for p in ${SB_PORT:-} 8800 8801 8802 8810 8820 8890; do node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(1));s.listen(+process.argv[1],"127.0.0.1",()=>s.close(()=>process.exit(0)))' "$p" 2>/dev/null && { echo "$p"; return; }; done; echo 8800; }
CFG="$DIR/board/config.json"
if [ ! -f "$CFG" ]; then
  [ -z "${SB_LANG:-}" ] && L=$(prompt "$(t '상황판 언어 en/ko' 'Board language en/ko')" "$L"); [ "$L" = ko ] || L=en
  TZ0="${SB_TZ:-$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)}"
  TZ1=$(prompt "$(t '내 시간대(서버가 아니라 내가 사는 곳 · 예 Asia/Seoul)' 'Your timezone (where you live, not the server · e.g. America/New_York)')" "${TZ0:-UTC}")
  node -e 'new Intl.DateTimeFormat("en-US",{timeZone:process.argv[1]})' "$TZ1" 2>/dev/null || { say "△ $(t "알 수 없는 시간대 $TZ1 → UTC" "unknown timezone $TZ1 → UTC")"; TZ1=UTC; }
  OWNER=$(prompt "$(t '상황판에 보일 내 이름' 'Your name on the board')" "${SB_OWNER:-$USER}")
  PORT=$(free_port); IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v ':' | head -1)
  node - "$DIR/board/config.example.json" "$CFG" "$OWNER" "$L" "$TZ1" "$PORT" "$USER" "${IP:-}" <<'JS' || die 4 "config.json"
const fs=require('fs');const [ex,out,owner,lang,tz,port,user,ip]=process.argv.slice(2);
const c=JSON.parse(fs.readFileSync(ex,'utf8'));delete c._comment;
Object.assign(c,{owner,lang,timezone:tz,port:+port,devSsh:ip?`ssh ${user}@${ip}`:'',hideLinkHosts:ip?[ip.split('.').slice(0,3).join('.')+'.']:[]});
fs.writeFileSync(out+'.tmp',JSON.stringify(c,null,2)+'\n');fs.renameSync(out+'.tmp',out);
JS
  say "✔ board/config.json ($(t '언어' 'lang') $L · $TZ1 · $(t '포트' 'port') $PORT)"
  [ "$PORT" != 8800 ] && say "△ $(t "8800 이 쓰는 중이라 $PORT 로 — 통로 명령도 $PORT" "8800 is busy, using $PORT — use $PORT in the tunnel line too")"
else
  L=$(node -e 'try{const c=require(process.argv[1]);process.stdout.write(c.lang==="ko"?"ko":"en")}catch(e){process.stdout.write("en")}' "$CFG")
  say "✔ board/config.json $(t '그대로' 'kept')"
fi
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

# 12. permission settings (your choice — background sessions stop at every prompt without it)
SETTINGS_CHANGED=false
S="$HOME/.claude/settings.json"
cur=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(((d.permissions||{}).defaultMode||"")+"|"+((d.worktree||{}).bgIsolation||""))}catch(e){process.stdout.write("|")}' "$S")
if [ "$cur" = "auto|none" ]; then say "✔ $(t '권한 설정 됨' 'permission settings already set')"
elif [ -z "${SB_YES:-}" ] && [ -t 0 ] && ask "$(t "백그라운드 작업방이 허락 창마다 멈추지 않게 할까요? ~/.claude/settings.json 에 permissions.defaultMode=auto · worktree.bgIsolation=none (원본은 settings.json.bak-$(date +%Y%m%d)). auto 가 무엇을 허용하는지는 Claude Code 권한 안내서 참고. 나중에 상황판에서 해도 됩니다" "Let background sessions run without stopping at every permission prompt? Sets permissions.defaultMode=auto and worktree.bgIsolation=none in ~/.claude/settings.json (backup settings.json.bak-$(date +%Y%m%d)). See Claude Code's permission docs for what auto allows. You can also do this later from the board")" n; then
  mkdir -p "$HOME/.claude"
  node - "$S" <<'JS' && SETTINGS_CHANGED=true && say "✔ settings.json" || say "△ $(t 'settings.json 을 읽지 못해 그대로 둠' 'could not read settings.json — left untouched')"
const fs=require('fs');const f=process.argv[2];let d={};
if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,'utf8'));const day=new Date().toISOString().slice(0,10).replace(/-/g,'');fs.copyFileSync(f,f+'.bak-'+day);}
d.permissions=Object.assign({},d.permissions,{defaultMode:'auto'});d.worktree=Object.assign({},d.worktree,{bgIsolation:'none'});
fs.writeFileSync(f+'.tmp',JSON.stringify(d,null,2)+'\n');fs.renameSync(f+'.tmp',f);
JS
fi

# 9. install-info.json (the board reads it for the checklist)
VER=$(git -C "$DIR" describe --tags --always 2>/dev/null || echo dev)
PREV=$(node -e 'try{process.stdout.write(String((require(process.argv[1]).rerun||0)+1))}catch(e){process.stdout.write("0")}' "$DIR/install-info.json")
[ "$RERUN" = 1 ] || PREV=0
node -e 'const fs=require("fs");const a=process.argv.slice(1);fs.writeFileSync(a[0],JSON.stringify({at:new Date().toISOString(),version:a[1],by:"install.sh",lang:a[2],port:+a[3],node:a[4],pm2:a[5],claude:a[6],login:a[7],settingsChanged:a[8]==="true",rerun:+a[9]},null,2)+"\n")' \
  "$DIR/install-info.json" "$VER" "$L" "$PORT" "$NODE_FROM" "$PM2_NEW" "$CLAUDE_STATE" "$LOGIN" "$SETTINGS_CHANGED" "$PREV"

# 14. what next
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v ':' | head -1)
step "✅ $(t '설치 끝' 'Installed')"
say "$(t '1) 내 컴퓨터에서 통로 열기(창을 열어 둠):' '1) On your computer, open the tunnel (keep the window open):')"
say "     ssh -L $PORT:127.0.0.1:$PORT $USER@${IP:-<server>}"
say "   $(t '자세히(~/.ssh/config·휴대폰):' 'More (~/.ssh/config, phone):') $DIR/docs/INSTALL$( [ "$L" = ko ] && echo .ko).md"
say "$(t "2) 브라우저: http://localhost:$PORT  → 맨 위 «처음 설정» 칸이 남은 일을 알려 줍니다" "2) Browser: http://localhost:$PORT  → the «First setup» box at the top shows what's left")"
say "$(t '3) 마지막에 «AI 로 설치 마무리 ▶» — 프로젝트·규칙·명령·정기 점검을 AI 가 묻고 설정합니다' '3) Then «Finish setup with AI ▶» — the AI asks about your projects and sets up rules, commands and schedules')"
[ "$LOGIN" = yes ] || say "   △ $(t 'Claude 로그인 아직 — 상황판 안내대로 (claude auth login)' 'Claude not logged in yet — follow the board (claude auth login)')"
[ "$cur" = "auto|none" ] || [ "$SETTINGS_CHANGED" = true ] || say "   △ $(t '권한 설정 아직 — 상황판 안내대로' 'permission settings not set yet — follow the board')"
say "$(t '재부팅 뒤에도 켜지게: pm2 startup → 나오는 sudo 한 줄 붙여 넣기(선택)' 'To start after a reboot: pm2 startup → paste the sudo line it prints (optional)')"
say "$(t '다시 실행해도 됩니다 — 설정은 그대로 둡니다.' 'You can run this again any time — it keeps your settings.')"
exit 0
