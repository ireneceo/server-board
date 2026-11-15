#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-}"                       # 시험 때만 다른 뿌리 폴더
HERE="$(cd "$(dirname "$0")" && pwd)"
# 대상 사이트: 인자 «<nginx 사이트 파일>:<server_name>» 여러 개, 없으면 kit/gate-sites.local 의 줄들
SITES=()
if [ $# -gt 0 ]; then for a in "$@"; do SITES+=("$ROOT$a"); done
elif [ -f "$HERE/gate-sites.local" ]; then while IFS= read -r a; do case "$a" in ''|'#'*) continue;; esac; SITES+=("$ROOT$a"); done < "$HERE/gate-sites.local"
fi
[ ${#SITES[@]} -gt 0 ] || { echo "사용: sudo bash $0 /etc/nginx/sites-enabled/<사이트파일>:<server_name> [...]  (또는 kit/gate-sites.local 에 한 줄씩)"; exit 2; }
LINE="    include /etc/nginx/board-gate/gate.conf;"
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "$ROOT/etc/nginx/backups"
for s in "${SITES[@]}"; do f="${s%%:*}"; [ -f "$f" ] || { echo "✘ 없음: $f"; exit 1; }; cp -a "$f" "$ROOT/etc/nginx/backups/$(basename "$f").bak-gate-$TS"; done
install -D -m 644 "$HERE/nginx-board-gate.conf" "$ROOT/etc/nginx/board-gate/gate.conf"
for s in "${SITES[@]}"; do
  f="${s%%:*}"; name="${s#*:}"
  if grep -q 'board-gate/gate.conf' "$f"; then echo "· 이미 있음: $f"; continue; fi
  awk -v n="$name" -v l="$LINE" '{print} $0 ~ "^[[:space:]]*server_name[[:space:]]+" n ";" {print l}' "$f" > "$f.gatetmp" && cat "$f.gatetmp" > "$f" && rm -f "$f.gatetmp"
  n=$(grep -c 'board-gate/gate.conf' "$f" || true)
  if [ "$n" -eq 0 ]; then
    echo "✘ 못 넣음: $f — «server_name $name;» 꼴의 줄을 찾지 못했습니다(이름이 여럿이면 그 줄에 맞춰 직접 넣으세요: $LINE). 바꾼 사이트 파일을 모두 되돌립니다"
    for s2 in "${SITES[@]}"; do f2="${s2%%:*}"; cp -a "$ROOT/etc/nginx/backups/$(basename "$f2").bak-gate-$TS" "$f2"; done
    exit 1
  fi
  echo "✔ 넣음: $f (${n}곳)"
done
if [ -n "$ROOT" ]; then echo "(시험 — nginx -t/reload 건너뜀)"; exit 0; fi
if nginx -t; then systemctl reload nginx; echo "✔ 끝 — 상황판 ⚙ 팀·권한 ④ 에서 솔루션마다 켜면 적용됩니다"
else
  echo "✘ nginx 설정 검사 실패 — 방금 바꾼 것을 되돌립니다"
  for s in "${SITES[@]}"; do f="${s%%:*}"; cat "$ROOT/etc/nginx/backups/$(basename "$f").bak-gate-$TS" > "$f"; done
  nginx -t && echo "↩ 되돌림 끝(nginx 는 다시 읽지 않았으니 사이트는 그대로)"; exit 1
fi
