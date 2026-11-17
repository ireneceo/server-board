#!/usr/bin/env bash
# 설치 확인 (읽기만) — 설치가 끝난 뒤, 그리고 Claude Code 를 업데이트한 뒤 돌린다.
# 사용: bash ~/dev-server/kit/verify.sh   → 줄마다 ✔ / ✘ / △(권고) · 끝에 ✘ 개수 (0 이면 정상)
# 쓰기 시험은 하지 않는다(방을 새로 열지 않음). 시험 방은 docs/AI-SETUP-PROMPT.md 6단계에서 따로.
set -u
D="$HOME/dev-server"
VLANG=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/dev-server/board/config.json"))).get("lang","en"))' 2>/dev/null || echo en)
if [ "$VLANG" != ko ] && [ -z "${VERIFY_RAW:-}" ]; then
  VERIFY_RAW=1 bash "$0" "$@" 2>&1 | python3 -I -c '
import re,sys
T=[(r"AI 로그인됨 \(([^)]*)\)",r"AI logged in (\1)"),(r"AI 로그인 안 됨 — 서버에서 claude auth login \(구독\) 또는 claude auth login --console \(API 키\)","AI not logged in — on the server run: claude auth login (subscription) or claude auth login --console (API key)"),(r"AI 로그인 상태를 읽지 못함","could not read the AI login state"),
(r"원본 폴더 작업 없음\(기본 worktree\)","bgIsolation unset (default worktree)"),(r"(권한 모드|원본 폴더 작업) 없음",r"\1 not-set"),(r"config\.json 있음 \(포트 (\d+)\)",r"config.json found (port \1)"),(r"board/config\.json 없음 — 기본값\(주인·8800\)으로 돈다","board/config.json missing — running with defaults (Owner · 8800)"),
(r"상황판 /api/board 200","board /api/board 200"),(r"상황판 응답 (\S+) — pm2 logs dev-board 확인",r"board answered \1 — check: pm2 logs dev-board"),
(r"다른 Host 거절\(403\)","other Host refused (403)"),(r"다른 Host 가 (\S+) — 바깥 사이트가 상황판을 읽을 수 있음",r"other Host got \1 — outside sites could read the board"),
(r"Origin 없는 쓰기 거절\(403\)","write without Origin refused (403)"),(r"Origin 없는 쓰기가 (\S+)",r"write without Origin got \1"),
(r"127\.0\.0\.1 에만 열림","listening on 127.0.0.1 only"),(r"포트 (\d+) 에서 듣는 곳 없음",r"nothing listening on port \1"),(r"바깥에도 열려 있음:",r"also open to the outside:"),
(r"PM2 에 dev-board 없음","dev-board not in PM2"),(r"메모리 (\d+)MB · 재시작 (\d+)회",r"memory \1MB · restarts \2"),
(r"pm2 save 됨","pm2 save done"),(r"pm2 save 안 됨 — 재부팅 뒤 상황판이 안 뜰 수 있음","pm2 save not done — the board may not come back after a reboot"),
(r"claude 명령 없음","claude command not found"),(r"방 목록에 빠진 칸:","room list is missing fields:"),(r"방 목록 JSON \((\d+)개\)",r"room list JSON (\1 rooms)"),
(r"claude agents --json 을 읽지 못함 — 상황판이 방을 못 봄","could not read claude agents --json — the board cannot see rooms"),
(r"~/\.claude/jobs 있음","~/.claude/jobs exists"),(r"~/\.claude/jobs 없음\(방을 한 번도 안 열었으면 정상\)","~/.claude/jobs missing (normal if no room was ever opened)"),
(r"(?:권한 모드|permission mode) (\S+) — auto 권고: .*",r"permission mode \1 — auto recommended: background sessions do not stop at every permission prompt (~/.claude/settings.json permissions.defaultMode · to set it: run bash ~/dev-server/install.sh again)"),
(r"(?:원본 폴더 작업|bgIsolation) (.+?) — none 권고: .*",r"bgIsolation \1 — none recommended: sessions work right in the project folder and see uncommitted files (two sessions editing one project at once will clash). Unset = each session works on its own branch under .claude/worktrees → uncommitted changes in the folder are invisible and results must be merged by hand (worktree.bgIsolation)"),(r"없음\(기본 worktree\)","unset (default worktree)"),
(r"자동 시험 멈춤 \((\d+)초 넘음\) — (.*) 로 보기",r"self-tests hung (over \1s) — see \2"),(r"방 목록에 sessionId 없는 줄 (\d+)개 — 상황판은 건너뜀",r"\1 room-list entries without sessionId — the board skips them"),(r"방 목록 JSON \((\d+)개 · 작업방 (\d+)\)",r"room list JSON (\1 entries · \2 background)"),(r"없음","none"),
(r"projects\.json 을 읽지 못함:","could not read projects.json:"),(r"폴더 없음","folder missing"),
(r" \((정기 점검 켰는데|개발완료 버튼 보이는데|배포 버튼 보이는데) 명령 none\)",""),(r"작업기록 (\S+) none",r"notes file \1 missing"),
(r"폴더·작업기록·켠 버튼의 명령 맞음","folder, notes file and button commands OK"),(r"CLAUDE\.md 없음 — 솔루션 규칙 틀\(kit/templates/<lang>/solution-CLAUDE\.md\)로 만들기 권고","CLAUDE.md missing — create it from kit/templates/<lang>/solution-CLAUDE.md"),
(r"터미널 메뉴 ~/bin/dev","terminal menu ~/bin/dev"),(r"~/bin/dev none","~/bin/dev missing"),(r"missing\(선택\)","missing (optional)"),(r" — 넣기: SB_MENU=1"," — add it: SB_MENU=1"),(r" · 넣기: SB_MENU=1"," · add it: SB_MENU=1"),(r"\(틀: ","(template: "),
(r"✔ 권한 모드 auto$","✔ permission mode auto"),(r"✔ 원본 폴더 작업 none$","✔ bgIsolation none"),(r"\.bashrc 접속 메뉴 블록",".bashrc menu block"),(r"\.bashrc 블록 none — 접속해도 메뉴가 안 뜸",".bashrc block missing — no menu on login"),
(r"정기 점검 켜짐 \(scheduled check on\)","scheduled check on"),(r"정기 점검 crontab","scheduled check in crontab"),
(r"morningCheck 를 켠 솔루션이 있는데 정기 점검이 none — 상황판 카드 «◷ 정기 점검» 에서 추가 \(no scheduled check yet\)","morningCheck is on but no scheduled check — add one in the card «◷ Scheduled checks»"),
(r"(auth-\S+\.json) 권한 600",r"\1 mode 600"),(r"(auth-\S+\.json) 권한 (\d+) — chmod 600 필요",r"\1 mode \2 — needs chmod 600"),(r"board/secrets 권한 700","board/secrets mode 700"),(r"자동 시험 (\d+)개 통과",r"self-tests: \1 passed"),(r"자동 시험 (\S+)개 실패 — (.*) 로 보기",r"self-tests: \1 failed — see \2"),(r"Claude Code 점검 아직 — 상황판이 켜지고 3분 뒤 저절로","Claude Code check not run yet — runs 3 min after the board starts"),(r"Claude Code (\S+) 점검 통과",r"Claude Code \1 check passed"),(r"Claude Code (\S+) 점검 실패: ",r"Claude Code \1 check failed: "),(r"board/secrets 권한 (\d+) — chmod 700 필요",r"board/secrets mode \1 — needs chmod 700"),
(r"최종 컨펌자 비밀번호·인증 앱 있음","final approver has password and authenticator"),(r"최종 컨펌자 인증 앱 none — 비상 복구\(dev recover\)로 다시 설정","final approver has no authenticator — run dev recover"),(r"최종 컨펌자 비밀번호 아직 none — SSH 통로로 상황판을 열어 처음 설정하거나 dev recover","no final-approver password yet — open the board through the SSH tunnel for first setup, or run dev recover"),
(r"비상 복구 중 — 복구 링크로 다시 설정할 때까지 아무도 로그인 못 함","recovery in progress — nobody can sign in until the recovery link is used"),(r"로그인 설정 전 — SSH 통로\(ssh -L\)로 상황판을 열면 최종 컨펌자 처음 설정 화면이 나옴 \(또는 서버 터미널에서 dev recover\)","sign-in not set up — open the board through the SSH tunnel (ssh -L) for the final approver first setup (or run dev recover in a server terminal)"),
(r"serverName 이 비어 있음 — board/config\.json 에 이 서버 이름\(다른 서버와 다르게\) · 그다음 pm2 restart dev-board \(docs/OPERATIONS 11절\)","serverName missing — put the name of this server (different from your other servers) in board/config.json, then pm2 restart dev-board (docs/OPERATIONS section 11)"),
(r"서버 이름 «(.*)» · 포트 (\d+) — 상황판이 같은 이름으로 답함",r"server name «\1» · port \2 — the board answers with the same name"),
(r"상황판이 서버 이름을 돌려주지 않음\(옛 판이거나 꺼짐\) — 받기·pm2 restart dev-board 뒤 다시","the board does not report its server name (old version or down) — update / pm2 restart dev-board, then run again"),
(r"상황판이 다른 이름으로 답함\((.*) · 포트 (.*)\) — .*",r"the board answers with another name (\1 · port \2) — config.json changed without pm2 restart dev-board, or another board holds this port"),
(r"포트 8800\(기본값\) — .*","port 8800 (default) — if you also open boards of other servers from the same computer, each server needs its own port (same port = the other board opens) · how: docs/OPERATIONS section 11"),
(r"문서·명령에 이 상황판과 다른 포트\(지금 (\d+)\) (\d+)곳 — 고칠 곳: ",r"docs/commands point to a different board port (this board: \1) in \2 places — fix: "),
(r"\{\{PORT\}\} 안 채움","{{PORT}} not filled"),(r"문서·명령의 상황판 주소 포트 (\d+) 로 맞음",r"docs/commands use board port \1"),
(r"✘ 0개 — 정상","✘ 0 — all good"),(r"✘ (\d+)개 — 위 ✘ 줄을 고친 뒤 다시",r"✘ \1 — fix the ✘ lines above and run again")]
for ln in sys.stdin:
    for a,b in T: ln=re.sub(a,b,ln)
    sys.stdout.write(ln)
'
  exit "${PIPESTATUS[0]}"
fi
FAIL=0
ok()   { echo "✔ $*"; }
bad()  { echo "✘ $*"; FAIL=$((FAIL+1)); }
warn() { echo "△ $*"; }

PORT=$(python3 -c 'import json,os;print(int(json.load(open(os.path.expanduser("~/dev-server/board/config.json"))).get("port",8800)))' 2>/dev/null || echo 8800)
[ -f "$D/board/config.json" ] && ok "config.json 있음 (포트 $PORT)" || warn "board/config.json 없음 — 기본값(주인·8800)으로 돈다"

# 1. 상황판 서버
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H "Host: localhost:$PORT" "http://127.0.0.1:$PORT/api/board")
[ "$code" = 200 ] && ok "상황판 /api/board 200" || bad "상황판 응답 $code — pm2 logs dev-board 확인"
SNAME=$(PYTHONIOENCODING=utf-8 python3 -c 'import json,os,re;n=str(json.load(open(os.path.expanduser("~/dev-server/board/config.json"))).get("serverName") or "");print(re.sub(r"\s+"," ",re.sub(r"[:\x00-\x1f]"," ",n)).strip()[:40])' 2>/dev/null)   # 상황판이 보이는 모양(serverLabel)과 같게
if [ -z "$SNAME" ]; then bad "serverName 이 비어 있음 — board/config.json 에 이 서버 이름(다른 서버와 다르게) · 그다음 pm2 restart dev-board (docs/OPERATIONS 11절)"
else
  PN=$(curl -s -m 8 -H "Host: localhost:$PORT" "http://127.0.0.1:$PORT/api/ping" | python3 -c 'import json,sys
try: d=json.load(sys.stdin); print(str(d.get("serverName") or "")+"|"+str(d.get("port") or ""))
except Exception: print("|")' 2>/dev/null)
  case "$PN" in
    "$SNAME|$PORT") ok "서버 이름 «$SNAME» · 포트 $PORT — 상황판이 같은 이름으로 답함";;
    "|") warn "상황판이 서버 이름을 돌려주지 않음(옛 판이거나 꺼짐) — 받기·pm2 restart dev-board 뒤 다시";;
    *) bad "상황판이 다른 이름으로 답함(${PN%%|*} · 포트 ${PN#*|}) — config.json 을 바꾼 뒤 pm2 restart dev-board 를 안 했거나 이 포트에 다른 상황판";;
  esac
  [ "$PORT" = 8800 ] && warn "포트 8800(기본값) — 같은 컴퓨터로 다른 서버 상황판도 열면 서버마다 포트가 달라야 함(겹치면 다른 서버 상황판이 열림) · 바꾸는 법 docs/OPERATIONS 11절"
fi
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H "Host: evil.example:$PORT" "http://127.0.0.1:$PORT/api/board")
[ "$code" = 403 ] && ok "다른 Host 거절(403)" || bad "다른 Host 가 $code — 바깥 사이트가 상황판을 읽을 수 있음"
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST -H "Host: localhost:$PORT" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/asks")
[ "$code" = 403 ] && ok "Origin 없는 쓰기 거절(403)" || bad "Origin 없는 쓰기가 $code"
if command -v ss >/dev/null; then
  b=$(ss -ltnH "sport = :$PORT" 2>/dev/null | awk '{print $4}' | sort -u | tr '\n' ' ')
  case "$b" in "127.0.0.1:$PORT ") ok "127.0.0.1 에만 열림";; "") bad "포트 $PORT 에서 듣는 곳 없음";; *) bad "바깥에도 열려 있음: $b";; esac
fi
pm2 jlist 2>/dev/null | python3 -c '
import json,sys
a=[p for p in json.load(sys.stdin) if p["name"]=="dev-board"]
if not a: print("✘ PM2 에 dev-board 없음"); sys.exit(1)
p=a[0]; m=(p["monit"]["memory"] or 0)//1048576; r=p["pm2_env"].get("restart_time",0); st=p["pm2_env"]["status"]
print(("✔" if st=="online" else "✘")+f" dev-board {st} · 메모리 {m}MB · 재시작 {r}회")
sys.exit(0 if st=="online" else 1)' || FAIL=$((FAIL+1))
[ -f "$HOME/.pm2/dump.pm2" ] && ok "pm2 save 됨" || warn "pm2 save 안 됨 — 재부팅 뒤 상황판이 안 뜰 수 있음"

# 2. 상황판이 기대는 Claude Code 기능 (업데이트로 바뀌면 여기서 걸림)
command -v claude >/dev/null && ok "claude $(claude --version 2>/dev/null | head -1)" || bad "claude 명령 없음"
[ -x "$HOME/dev-server/kit/bin/ai-key-wait" ] && "$HOME/dev-server/kit/bin/ai-key-wait"
au=$(timeout 30 claude auth status --json 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(("ok " if d.get("loggedIn") else "no ")+" ".join(str(x) for x in (d.get("authMethod"),d.get("subscriptionType")) if x))' 2>/dev/null)
case "$au" in ok*) ok "AI 로그인됨 (${au#ok })";; no*) bad "AI 로그인 안 됨 — 서버에서 claude auth login (구독) 또는 claude auth login --console (API 키)";; *) warn "AI 로그인 상태를 읽지 못함 (claude auth status)";; esac
AJ=$(timeout 30 claude agents --json --all 2>/dev/null)
printf '%s' "$AJ" | python3 -c '
import json,sys
try:
    a=json.load(sys.stdin); assert isinstance(a,list)
except Exception:
    print("✘ claude agents --json 을 읽지 못함 — 상황판이 방을 못 봄"); sys.exit(1)
B=[x for x in a if isinstance(x,dict) and x.get("kind")=="background"]; O=[x for x in a if isinstance(x,dict) and x.get("kind")!="background"]
miss=sorted({"background."+k for x in B for k in ("id","sessionId","cwd","name") if not x.get(k)})
skip=sum(1 for x in O if not x.get("sessionId"))
if miss: print("✘ 방 목록에 빠진 칸: "+",".join(miss)); sys.exit(1)
print(f"✔ 방 목록 JSON ({len(a)}개 · 작업방 {len(B)})")
if skip: print(f"△ 방 목록에 sessionId 없는 줄 {skip}개 — 상황판은 건너뜀")' || FAIL=$((FAIL+1))
[ -d "$HOME/.claude/jobs" ] && ok "~/.claude/jobs 있음" || warn "~/.claude/jobs 없음(방을 한 번도 안 열었으면 정상)"
python3 - <<'PY'
import json,os
p=os.path.expanduser('~/.claude/settings.json')
try: d=json.load(open(p))
except Exception: d={}
m=(d.get('permissions') or {}).get('defaultMode'); b=(d.get('worktree') or {}).get('bgIsolation')
print(f"✔ 권한 모드 auto") if m=='auto' else print(f"△ 권한 모드 {m or '없음'} — auto 권고: 방이 허락 창마다 멈추지 않음 (~/.claude/settings.json permissions.defaultMode · 넣기: bash ~/dev-server/install.sh 다시)")
print(f"✔ 원본 폴더 작업 none") if b=='none' else print(f"△ 원본 폴더 작업 {b or '없음(기본 worktree)'} — none 권고: 방이 원본 폴더에서 바로 일함(커밋 안 한 파일도 봄 · 한 솔루션에 방 둘이 동시에 고치면 부딪힘). 비우면 방마다 .claude/worktrees 별도 가지 → 원본의 커밋 안 한 변경이 안 보이고 결과를 따로 합쳐야 함 (worktree.bgIsolation)")
PY

# 3. 솔루션 목록 ↔ 폴더·명령 (켠 버튼에 맞는 명령이 있는지)
python3 - <<'PY'
import json,os,sys
H=os.path.expanduser('~')
try: P=json.load(open(os.path.join(H,'dev-server','projects.json')))
except Exception as e: print('✘ projects.json 을 읽지 못함:',e); sys.exit(1)
fail=0
for p in P:
    d=p.get('dir') or ''
    if not os.path.isdir(d): print(f"✘ {p['key']}: 폴더 없음 {d}"); fail+=1; continue
    cmds={os.path.splitext(f)[0] for f in os.listdir(os.path.join(d,'.claude','commands'))} if os.path.isdir(os.path.join(d,'.claude','commands')) else set()
    gcmds={os.path.splitext(f)[0] for f in os.listdir(os.path.join(H,'.claude','commands'))} if os.path.isdir(os.path.join(H,'.claude','commands')) else set()
    have=cmds|gcmds; msgs=[]
    # 상황판이 여는 명령 이름은 config lang 에 따라 다름(ko: 개발시작·개발완료·배포 / en: dev-start·dev-done·deploy)
    try: lang=json.load(open(os.path.join(H,'dev-server','board','config.json'))).get('lang','en')
    except Exception: lang='en'
    n={'start':'개발시작','done':'개발완료','deploy':'배포'} if lang=='ko' else {'start':'dev-start','done':'dev-done','deploy':'deploy'}
    if p.get('morningCheck') and n['start'] not in have: msgs.append(f"morningCheck on but /{n['start']} missing (정기 점검 켰는데 명령 없음)")
    if not p.get('noDevDone') and n['done'] not in have: msgs.append(f"dev-done button shown but /{n['done']} missing (개발완료 버튼 보이는데 명령 없음)")
    if p.get('prodLabel') and n['deploy'] not in have: msgs.append(f"deploy button shown but /{n['deploy']} missing (배포 버튼 보이는데 명령 없음)")
    if p.get('key')!='server' and not os.path.exists(os.path.join(d,'CLAUDE.md')): print(f"△ {p['key']}: CLAUDE.md 없음 — 솔루션 규칙 틀(kit/templates/<lang>/solution-CLAUDE.md)로 만들기 권고")
    sf=p.get('stateFile')
    if sf and not os.path.exists(os.path.join(d,sf)): msgs.append(f'작업기록 {sf} 없음 (틀: kit/templates/<lang>/solution-session-state.md)')
    if msgs: print(f"✘ {p['key']}: "+' · '.join(msgs)); fail+=1
    else: print(f"✔ {p['key']}: 폴더·작업기록·켠 버튼의 명령 맞음 ({d})")
sys.exit(1 if fail else 0)
PY
[ $? -eq 0 ] || FAIL=$((FAIL+1))

# 3b. kit 이 놓은 문서·명령에 이 상황판과 다른 포트가 남았나 — 방이 엉뚱한 상황판(다른 서버·꺼진 포트)에 질문·일을 보냄
python3 - "$PORT" <<'PY' || FAIL=$((FAIL+1))
import glob,json,os,re,sys
port=sys.argv[1]; H=os.path.expanduser('~')
files=[os.path.join(H,'.claude','CLAUDE.md'),os.path.join(H,'dev-server','CLAUDE.md')]+glob.glob(os.path.join(H,'.claude','commands','*.md'))
try: P=json.load(open(os.path.join(H,'dev-server','projects.json')))
except Exception: P=[]
for p in P:
    d=p.get('dir') or ''
    if d and os.path.isdir(d): files+= [os.path.join(d,'CLAUDE.md')]+glob.glob(os.path.join(d,'.claude','commands','*.md'))
API=r'/api/(?:asks|rooms|todos|fable-wait|deploy-hold|inquiries|inquiry-refs|ping|board|queue)\b'
RE=re.compile(r'(?:localhost|127\.0\.0\.1):(\d+)(?='+API+r')|(?:상황판|\bboard\b)\s*\(?(?:http://)?localhost:(\d+)',re.I)
ORIG=re.compile(r'Origin: http://localhost:(\d+)'); APIL=re.compile(API)
bad=[]
for f in sorted(set(files)):
    try: lines=open(f,encoding='utf-8',errors='replace').read().split('\n')
    except Exception: continue
    for i,l in enumerate(lines,1):
        if '{{PORT}}' in l:
            x=f"{f.replace(H,'~')}:{i} ({{{{PORT}}}} 안 채움)"
            if x not in bad: bad.append(x)
        ms=list(RE.finditer(l))+(list(ORIG.finditer(l)) if APIL.search(l) else [])   # Origin 은 상황판 /api 와 같은 줄일 때만(솔루션 자체 API 예시는 뺌)
        for m in ms:
            n=next(g for g in m.groups() if g)
            x=f"{f.replace(H,'~')}:{i} ({n})"
            if n!=port and x not in bad: bad.append(x)
if bad:
    print(f"✘ 문서·명령에 이 상황판과 다른 포트(지금 {port}) {len(bad)}곳 — 고칠 곳: "+" · ".join(bad[:8])+(" …" if len(bad)>8 else "")); sys.exit(1)
print(f"✔ 문서·명령의 상황판 주소 포트 {port} 로 맞음")
PY

# 4. 터미널 메뉴·정기 점검
[ -x "$HOME/bin/dev" ] && ok "터미널 메뉴 ~/bin/dev" || warn "~/bin/dev 없음(선택) — 넣기: SB_MENU=1 bash ~/dev-server/install.sh"   # 설치가 «넣을까요?» 로 묻는 선택 항목 — 안 넣었다고 실패로 세지 않음
grep -q "dev-menu" "$HOME/.bashrc" 2>/dev/null && ok ".bashrc 접속 메뉴 블록" || warn ".bashrc 블록 없음 — 접속해도 메뉴가 안 뜸 · 넣기: SB_MENU=1 bash ~/dev-server/install.sh"
if python3 -c 'import json,os,sys;sys.exit(0 if any(p.get("morningCheck") for p in json.load(open(os.path.expanduser("~/dev-server/projects.json")))) else 1)' 2>/dev/null; then
  if python3 -c 'import json,os,sys;s=json.load(open(os.path.expanduser("~/dev-server/board/state.json"))).get("schedules") or {};sys.exit(0 if any(x.get("on") for x in s.values()) else 1)' 2>/dev/null; then ok "정기 점검 켜짐 (scheduled check on)"
  elif crontab -l 2>/dev/null | grep -q morning-check.sh; then ok "정기 점검 crontab"
  else warn "morningCheck 를 켠 솔루션이 있는데 정기 점검이 없음 — 상황판 카드 «◷ 정기 점검» 에서 추가 (no scheduled check yet)"; fi
fi

AU="$D/board/secrets/auth-users.json"; AS="$D/board/secrets/auth-sessions.json"
if [ -f "$AU" ]; then
  for f in "$AU" "$AS"; do [ -f "$f" ] || continue; m=$(stat -c %a "$f"); [ "$m" = 600 ] && ok "$(basename "$f") 권한 600" || bad "$(basename "$f") 권한 $m — chmod 600 필요"; done
  m=$(stat -c %a "$D/board/secrets"); [ "$m" = 700 ] && ok "board/secrets 권한 700" || bad "board/secrets 권한 $m — chmod 700 필요"
  python3 - "$AU" "$(id -un)" <<'PY'
import json,sys
u=json.load(open(sys.argv[1])); me=(u.get("users") or {}).get(sys.argv[2].lower()) or {}
print(("✔ 최종 컨펌자 비밀번호·인증 앱 있음" if me.get("hash") and me.get("totp") else "△ 최종 컨펌자 인증 앱 없음 — 비상 복구(dev recover)로 다시 설정") if me.get("hash") else "△ 최종 컨펌자 비밀번호 아직 없음 — SSH 통로로 상황판을 열어 처음 설정하거나 dev recover")
if u.get("recovering"): print("△ 비상 복구 중 — 복구 링크로 다시 설정할 때까지 아무도 로그인 못 함")
PY
else
  warn "로그인 설정 전 — SSH 통로(ssh -L)로 상황판을 열면 최종 컨펌자 처음 설정 화면이 나옴 (또는 서버 터미널에서 dev recover)"
fi

if [ -d "$D/board/test" ]; then
  TLIM="${VERIFY_TEST_TIMEOUT:-180}"
  TOUT=$(cd "$D/board" && timeout -k 10 "$TLIM" node --test --test-reporter=tap $(ls test/*.test.js | grep -v public.test.js) 2>&1); TRC=$?
  TP=$(echo "$TOUT" | sed -n 's/^# pass //p' | tail -1); TF=$(echo "$TOUT" | sed -n 's/^# fail //p' | tail -1)
  if [ "$TRC" = 124 ] || [ "$TRC" = 137 ]; then bad "자동 시험 멈춤 (${TLIM}초 넘음) — cd ~/dev-server/board && node --test test/*.test.js 로 보기"
  elif [ "${TF:-1}" = 0 ]; then ok "자동 시험 ${TP}개 통과"
  else bad "자동 시험 ${TF:-?}개 실패 — cd ~/dev-server/board && node --test test/*.test.js 로 보기"; fi
fi
python3 - <<'PY' || FAIL=$((FAIL+1))
import json,os,sys
try: c=json.load(open(os.path.expanduser("~/dev-server/board/state.json"))).get("claudeCheck")
except Exception: c=None
if not c: print("△ Claude Code 점검 아직 — 상황판이 켜지고 3분 뒤 저절로")
elif c.get("ok"): print("✔ Claude Code %s 점검 통과" % c.get("version"))
else: print("✘ Claude Code %s 점검 실패: %s" % (c.get("version"), " · ".join(f.get("name","") for f in c.get("fails") or []))); sys.exit(1)
PY

echo "──"
[ $FAIL -eq 0 ] && echo "✘ 0개 — 정상" || echo "✘ ${FAIL}개 — 위 ✘ 줄을 고친 뒤 다시"
exit $FAIL
