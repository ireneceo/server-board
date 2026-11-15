#!/usr/bin/env bash
# Server Board — can this server run it? (read-only, no root, nothing installed) · 이 서버에서 쓸 수 있나 1분 점검
# Use / 쓰는 법:  bash check-host.sh        (or: curl -fsSL <raw url>/kit/check-host.sh | bash)
# Prints ✔ / ✘ / △ per requirement and a verdict at the end. Exit code = number of ✘.
set -u
K=0; case "${LANG:-}${LC_ALL:-}" in *ko*) K=1;; esac; [ "${1:-}" = "--ko" ] && K=1; [ "${1:-}" = "--en" ] && K=0
t() { [ $K = 1 ] && printf '%s' "$1" || printf '%s' "$2"; }
F=0; W=0
ok()   { echo "✔ $*"; }
bad()  { echo "✘ $*"; F=$((F+1)); }
warn() { echo "△ $*"; W=$((W+1)); }

# 1. Linux (the board reads /proc for memory/CPU)
if [ "$(uname -s)" = Linux ] && [ -r /proc/meminfo ]; then ok "Linux · /proc $(t '읽기 가능' 'readable')"
else bad "$(t '리눅스가 아님(또는 /proc 못 읽음) — 상황판은 리눅스 서버용' 'not Linux (or /proc unreadable) — the board needs a Linux server')"; fi

# 2. Shell user, home writable (no root needed)
[ "$(id -u)" = 0 ] && warn "$(t 'root 로 접속함 — 일반 사용자로 돌리기를 권함(root 는 필요 없음)' 'logged in as root — a normal user is recommended (root is not needed)')" || ok "$(t '일반 사용자' 'normal user'): $(id -un)"
if touch "$HOME/.sb-check.$$" 2>/dev/null; then rm -f "$HOME/.sb-check.$$"; ok "$(t '홈 폴더 쓰기 가능' 'home folder writable')"; else bad "$(t '홈 폴더에 쓸 수 없음' 'cannot write to the home folder')"; fi
fr=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print int($4/1048576)}'); [ "${fr:-0}" -ge 2 ] && ok "$(t '빈 디스크' 'free disk') ${fr}GB" || warn "$(t '빈 디스크가 2GB 미만' 'less than 2 GB free disk') (${fr:-?}GB)"
mem=$(awk '/MemTotal/{print int($2/1048576+0.5)}' /proc/meminfo 2>/dev/null); [ "${mem:-0}" -ge 2 ] && ok "$(t '메모리' 'memory') ${mem}GB" || warn "$(t '메모리 2GB 미만 — 작업방 여러 개·빌드가 어려움' 'memory under 2 GB — several sessions or builds will struggle') (${mem:-?}GB)"

# 3. Node 18+ (user-space install via nvm is fine)
if command -v node >/dev/null; then
  v=$(node -v | sed 's/^v//; s/\..*//'); [ "$v" -ge 18 ] 2>/dev/null && ok "node $(node -v)" || bad "node $(node -v) — $(t '18 이상 필요(nvm 으로 내 계정에 설치 가능, root 불필요)' '18+ needed (nvm installs it in your account, no root)')"
else warn "$(t 'node 없음 — nvm 으로 내 계정에 설치 가능(root 불필요): ' 'node missing — install it in your account with nvm (no root): ')curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 20"; fi

# 4. Can a process keep running after you log out? (shared hosting often kills them)
if command -v loginctl >/dev/null && loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then ok "$(t '로그아웃 뒤에도 프로세스 유지(linger)' 'processes survive logout (linger on)')"
elif ps -eo user,etimes,comm 2>/dev/null | awk -v u="$(id -un)" '$1==u && $2>86400 && $3!~/^(bash|sshd|systemd|sd-pam|\(sd-pam\))$/' | grep -q .; then ok "$(t '내 계정에 하루 넘게 도는 프로세스가 있음 — 상시 실행 가능해 보임' 'a process of yours has run for over a day — long-running processes look allowed')"
else warn "$(t '상시 실행이 되는지 아직 모름 — 아래 «오래 도는지 시험» 을 해 보세요' 'not yet known if long-running processes survive — try the long-run test below')"; fi
lim=$(ulimit -u 2>/dev/null); [ "$lim" = unlimited ] || [ "${lim:-0}" -ge 200 ] 2>/dev/null && ok "$(t '프로세스 수 한도' 'process limit') ${lim}" || bad "$(t '프로세스 수 한도가 너무 낮음' 'process limit too low') (${lim}) — $(t '작업방마다 여러 프로세스를 씀' 'each session uses several processes')"

# 5. Bind 127.0.0.1 (the board listens there only)
if command -v node >/dev/null; then
  node -e 'const s=require("net").createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{s.close();process.exit(0)})' 2>/dev/null && ok "$(t '127.0.0.1 포트 열기 가능' 'can listen on 127.0.0.1')" || bad "$(t '127.0.0.1 포트를 열 수 없음' 'cannot listen on 127.0.0.1')"
fi

# 6. Outbound HTTPS to Anthropic (Claude Code needs it)
if command -v curl >/dev/null; then
  c=$(curl -s -m 8 -o /dev/null -w '%{http_code}' https://api.anthropic.com/ 2>/dev/null); [ -n "$c" ] && [ "$c" != 000 ] && ok "$(t 'Anthropic 연결' 'reach Anthropic') (HTTP $c)" || bad "$(t 'api.anthropic.com 에 닿지 않음 — 바깥 연결이 막힌 서버' 'cannot reach api.anthropic.com — outbound connections are blocked')"
else warn "$(t 'curl 없음' 'curl missing')"; fi

# 7. Tools
command -v git >/dev/null && ok "git" || bad "$(t 'git 없음' 'git missing')"
command -v python3 >/dev/null && ok "python3" || warn "$(t 'python3 없음 — 설치 확인 스크립트가 씀' 'python3 missing — used by the install checks')"
command -v claude >/dev/null && ok "claude $(claude --version 2>/dev/null | head -1)" || warn "$(t 'Claude Code 아직 없음 — npm install -g @anthropic-ai/claude-code (내 계정 npm 이면 root 불필요)' 'Claude Code not installed yet — npm install -g @anthropic-ai/claude-code (no root with a user-space npm)')"
command -v pm2 >/dev/null && ok "pm2" || warn "$(t 'pm2 없음 — npm install -g pm2 (root 불필요한 방법: nvm 의 npm)' 'pm2 missing — npm install -g pm2 (no root with nvm npm)')"

# 8. SSH port forwarding (to open the board from your computer) — can only be confirmed from your computer
if [ -r /etc/ssh/sshd_config ] && grep -qiE '^\s*AllowTcpForwarding\s+no' /etc/ssh/sshd_config 2>/dev/null; then bad "$(t 'SSH 통로(포트 포워딩)가 꺼진 서버 — 상황판을 내 컴퓨터에서 열 수 없음(Tailscale 은 가능할 수 있음)' 'SSH port forwarding is disabled — you cannot open the board from your computer (Tailscale may still work)')"
else warn "$(t 'SSH 통로는 내 컴퓨터에서 확인: ssh -N -L 8800:127.0.0.1:8800 <별명>  (오류 없이 멈춰 있으면 됨)' 'check the SSH tunnel from your computer: ssh -N -L 8800:127.0.0.1:8800 <alias>  (no error = OK)')"; fi

echo "──"
if [ $F = 0 ]; then echo "$(t "✔ 쓸 수 있어 보입니다 (확인할 것 △ ${W}개)" "✔ Looks usable (${W} △ to check)")"
else echo "$(t "✘ ${F}개 — 이 서버에서는 어렵습니다. 작업용 리눅스 서버(VPS)를 따로 두고 이 호스팅으로 배포하는 방법이 있습니다" "✘ ${F} — hard on this server. Option: a separate Linux work server (VPS) that deploys to this hosting")"; fi
echo "$(t '오래 도는지 시험: nohup sleep 7200 >/dev/null 2>&1 &  → 로그아웃 → 2시간 안에 다시 접속해 pgrep -u $USER sleep 이 나오면 상시 실행 가능' 'long-run test: nohup sleep 7200 >/dev/null 2>&1 &  → log out → log back in within 2 h: if pgrep -u $USER sleep prints a number, long-running processes survive')"
exit $F
