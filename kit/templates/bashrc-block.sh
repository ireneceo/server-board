# ── Claude Code 작업방 메뉴 — 설명서 ~/dev-server/README.md ──
# SSH 로 사람이 직접 접속했을 때만 뜬다(스크립트·scp·Claude 안의 셸에서는 안 뜸).
# 끄려면: touch ~/.dev-menu-off
export PATH="$HOME/bin:$PATH"
if [[ $- == *i* ]] && [ -n "${SSH_TTY:-}" ] && [ -z "${TMUX:-}" ] && [ -z "${CLAUDECODE:-}" ] \
   && [ -z "${DEV_MENU_SHOWN:-}" ] && [ ! -f "$HOME/.dev-menu-off" ] && [ -x "$HOME/bin/dev" ]; then
  export DEV_MENU_SHOWN=1
  "$HOME/bin/dev"
fi
