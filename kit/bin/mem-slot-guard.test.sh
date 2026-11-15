#!/usr/bin/env bash
# mem-slot-guard 자동 시험 — bash bin/mem-slot-guard.test.sh
set -u
G=$(cd "$(dirname "$0")" && pwd)/mem-slot-guard
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/wrapped $T/plain
echo '{"scripts":{"build":"'"$(dirname "$G")"'/mem-slot run x 100 -- vite build"}}' > $T/wrapped/package.json
echo '{"scripts":{"build":"vite build","build:dev":"vite build"}}' > $T/plain/package.json
pass=0; fail=0
chk() {  # 기대(0 통과 · 2 막음) 폴더 명령
  local want=$1 cwd=$2 cmd=$3 got
  python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","cwd":sys.argv[1],"tool_input":{"command":sys.argv[2]}}))' "$cwd" "$cmd" | python3 -I "$G" 2>/dev/null
  got=$?
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "  ✓ [$want] $cmd"; else fail=$((fail+1)); echo "  ✗ 기대 $want 실제 $got : $cmd (in $cwd)"; fi
}
echo "막아야 함"
chk 2 $T/plain "npm run build"
chk 2 $T/plain "npm run build:dev 2>&1 | tail -20"
chk 2 /tmp "cd $T/plain && npm run build"
chk 2 /tmp "npm --prefix $T/plain run build"
chk 2 /tmp "npx tsc -b"
chk 2 /tmp "NODE_OPTIONS=--max-old-space-size=4096 tsc -b && vite build"
chk 2 /tmp "node_modules/.bin/tsc --build"
chk 2 /tmp "npx vite build"
chk 2 /tmp "react-scripts build"
chk 2 /tmp "yarn build"
chk 2 /tmp "timeout 600 npm run build"
chk 2 /tmp "emulator -avd Pixel_7 -no-window &"
chk 2 /tmp "~/Android/Sdk/emulator/emulator @pixel"
chk 2 /tmp "npx playwright test"
chk 2 /tmp "echo start; npm run build"
echo "통과해야 함"
chk 0 $T/wrapped "npm run build"
chk 0 /tmp "cd $T/wrapped && npm run build 2>&1 | tail"
chk 0 /tmp "$(dirname "$G")/mem-slot run app-build 5000 -- npm run build"
chk 0 /tmp "mem-slot run x 10 -- bash -c 'tsc -b'"
chk 0 /tmp "grep -n \"vite build\" package.json"
chk 0 /tmp "git commit -m 'npm run build 고침'"
chk 0 /tmp "tsc --noEmit -p ."
chk 0 /tmp "npm run build-storybook-docs-check"
chk 0 /tmp "npm run test"
chk 0 /tmp "cat build.log; ls build"
chk 0 /tmp "vite --port 5173"
chk 0 /tmp "pgrep -af emulator"
chk 0 /tmp "$(printf "python3 - <<'EOF'\nprint('npm run build')\nEOF\necho done")"
chk 0 /tmp "$(printf "cat > a.sh <<EOF\ntsc -b\nEOF")"
chk 2 /tmp "$(printf "cat > a.sh <<'EOF'\nx\nEOF\nnpx vite build")"
echo "검사 오류면 통과"
r=$(echo 'not json' | python3 -I "$G" 2>/dev/null; echo $?); [ "$r" = 0 ] && { pass=$((pass+1)); echo "  ✓ 잘못된 입력 → 통과"; } || { fail=$((fail+1)); echo "  ✗ 잘못된 입력 $r"; }
echo "통과 $pass · 실패 $fail"
[ $fail = 0 ]
