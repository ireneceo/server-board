#!/usr/bin/env bash
#
# 솔루션 백업에 안 들어가는 «서버 공용» 것들을 하루 한 번 묶는다:
#   상황판 폴더(기록 state.json·log·로그인 정보 secrets·설정 config.json 포함) · 터미널 메뉴(~/bin)
#   · Claude 공용 규칙·설정·에이전트·스킬·명령·기억 · PM2 목록 · crontab · nginx 사이트 설정(읽히면) · 셸 설정 · ssh 설정·공개 열쇠
# 넣지 않는 것: ssh 개인 열쇠 · node_modules·.venv·브라우저 · 상황판 git 이력(.git) · 내려받기 칸 · Claude 대화 기록
#
# 사본: ~/backups/board/server/YYYYMMDD/server.tar.gz (+ manifest.txt) · 14일 보관 · 폴더 700 · 파일 600
# ⚠ 사본에 로그인 정보·비밀이 들어 있다 — 다른 곳으로 옮길 때는 암호 걸린 곳에.
# 상황판 «⚙ 백업 → 자동 백업 만들기» 를 누르면 서버 방이 이 파일을 scripts/board-backup.sh 로 복사해 매일 돌게 한다.
set -euo pipefail
umask 077

BOARD_HOME="${BOARD_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"   # 상황판 폴더(보통 ~/dev-server)
ROOT="${BACKUP_ROOT:-$HOME/backups/board/server}"
KEEP_DAYS=14
DAY="$(date -u +%Y%m%d)"
OUT="$ROOT/$DAY"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"; rm -f "$OUT/server.tar.gz.part"' EXIT
fail() { echo "❌ board-backup failed $(date -u '+%Y-%m-%dT%H:%M:%SZ'): $*"; exit 1; }

mkdir -p "$ROOT" || fail "사본 폴더를 못 만듦: $ROOT"
chmod 700 "$ROOT"
exec 9>"$ROOT/.lock"
flock -n 9 || fail "다른 백업이 도는 중"
mkdir -p "$OUT" && chmod 700 "$OUT"

# 디스크 여유 — 10% 미만이거나 지난 사본 크기×2 보다 적으면 만들지 않는다(디스크를 채워 서비스를 멈추지 않게)
avail_kb="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
used_pct="$(df -Pk "$ROOT" | awk 'NR==2{gsub("%","",$5); print $5}')"
last_kb="$(find "$ROOT" -mindepth 2 -maxdepth 2 -name server.tar.gz -printf '%s\n' 2>/dev/null | sort -n | tail -1 || true)"
last_kb=$(( ${last_kb:-0} / 1024 ))
[ "${used_pct:-100}" -lt 90 ] || fail "디스크 여유 10% 미만(${used_pct}% 사용)"
[ "${avail_kb:-0}" -ge $(( last_kb * 2 )) ] || fail "디스크 여유(${avail_kb}KB)가 지난 사본×2(${last_kb}KB×2)보다 적음"

# 파일로만 있는 상태값을 꺼내 둔다
mkdir -p "$STAGE/snapshot/nginx"
crontab -l > "$STAGE/snapshot/crontab.txt" 2>/dev/null || echo "(crontab 없음)" > "$STAGE/snapshot/crontab.txt"
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try {
      for (const p of JSON.parse(s)) console.log([p.name, p.pm2_env.status, p.pm2_env.pm_cwd, p.pm2_env.pm_exec_path].join("\t"));
    } catch (_) { console.log("(pm2 목록을 읽지 못함)"); } });' > "$STAGE/snapshot/pm2-list.tsv" 2>/dev/null || true
fi
cp -a /etc/nginx/sites-available/. "$STAGE/snapshot/nginx/" 2>/dev/null || echo "(nginx 설정 없음·못 읽음)" > "$STAGE/snapshot/nginx/README"

# 있는 것만 담는다 — $HOME 기준 상대 경로
cd "$HOME" || fail "집 폴더로 못 감"
rel_board="${BOARD_HOME#$HOME/}"
LIST=()
for p in "$rel_board" bin \
         .claude/CLAUDE.md .claude/settings.json .claude/settings.local.json .claude/agents .claude/skills .claude/commands \
         .claude.json .pm2/dump.pm2 \
         .bashrc .bash_aliases .profile .gitconfig \
         .ssh/config .ssh/authorized_keys; do
  if [ -e "$p" ]; then LIST+=("$p"); fi
done
for p in .ssh/*.pub .claude/projects/*/memory; do if [ -e "$p" ]; then LIST+=("$p"); fi; done

# tar 종료 1 = «읽는 중 바뀐 파일 있음»(도는 상황판의 state.json·log) — 경고로 두고 아래 사본 확인으로 가른다. 2 이상이면 실패.
rc=0
tar -czf "$OUT/server.tar.gz.part" \
  --exclude='node_modules' --exclude='.venv' --exclude='ms-playwright' --exclude='__pycache__' \
  --exclude="$rel_board/.git" --exclude="$rel_board/board/downloads" --exclude='*.tmp' \
  --warning=no-file-changed "${LIST[@]}" -C "$STAGE" snapshot 2>"$STAGE/tar.err" || rc=$?
[ "$rc" -le 1 ] || { tail -5 "$STAGE/tar.err"; fail "tar 실패($rc)"; }
gzip -t "$OUT/server.tar.gz.part" && tar -tzf "$OUT/server.tar.gz.part" >/dev/null || fail "만든 사본이 깨짐"
mv "$OUT/server.tar.gz.part" "$OUT/server.tar.gz" || fail "이름 바꾸기 실패"
chmod 600 "$OUT/server.tar.gz"

{
  echo "서버 백업 $(date -u '+%Y-%m-%d %H:%M UTC') · $(du -h "$OUT/server.tar.gz" | cut -f1)"
  echo "--- 담은 것"
  tar -tzf "$OUT/server.tar.gz" | awk -F/ '{print ($1=="snapshot" || $1==".claude" ? $1"/"$2 : $1)}' | sort -u
} > "$OUT/manifest.txt"
chmod 600 "$OUT/manifest.txt"

# 보관 — 오늘 사본을 확인한 뒤에만 · 이 사본 폴더 안 «날짜 이름» 폴더만 · 최신 3개는 날짜와 상관없이 남김(다른 경로는 건드리지 않음)
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][01][0-9][0-3][0-9]' -printf '%f\n' | sort -r | tail -n +4 | while read -r d; do
  if [ -n "$(find "$ROOT/$d" -maxdepth 0 -mtime +"$KEEP_DAYS")" ]; then rm -rf -- "${ROOT:?}/$d"; fi
done

echo "✅ board-backup ok $(date -u '+%Y-%m-%dT%H:%M:%SZ') $OUT/server.tar.gz ($(du -h "$OUT/server.tar.gz" | cut -f1))"
