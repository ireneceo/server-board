#!/usr/bin/env bash
set -euo pipefail
ROOT="${ROOT:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FILES=()
if [ $# -gt 0 ]; then for a in "$@"; do FILES+=("$ROOT${a%%:*}"); done
elif [ -f "$HERE/gate-sites.local" ]; then while IFS= read -r a; do case "$a" in ''|'#'*) continue;; esac; FILES+=("$ROOT${a%%:*}"); done < "$HERE/gate-sites.local"
fi
[ ${#FILES[@]} -gt 0 ] || { echo "사용: sudo bash $0 /etc/nginx/sites-enabled/<사이트파일>[:<server_name>] [...]  (또는 kit/gate-sites.local)"; exit 2; }
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  grep -v 'include /etc/nginx/board-gate/gate.conf;' "$f" > "$f.gatetmp" || true
  cat "$f.gatetmp" > "$f"; rm -f "$f.gatetmp"; echo "✔ 뺌: $f"
done
if [ -n "$ROOT" ]; then exit 0; fi
nginx -t && systemctl reload nginx && echo "✔ 끝 — 개발 사이트는 관문 없이 열림"
