#!/usr/bin/env bash
# mem-slot 자동 시험 — bash bin/mem-slot.test.sh  (실제 자리표 ~/.mem-slot 은 건드리지 않음)
set -u
M=$(cd "$(dirname "$0")" && pwd)/mem-slot
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export MEM_SLOT_DIR=$T MEM_SLOT_STEP=1 MEM_SLOT_SWAP_FREE_MIN=0 MEM_SLOT_PSI_FILE=/dev/null MEM_SLOT_BOX_SWAP=0
TOTAL=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
export MEM_SLOT_RESERVE=$((TOTAL - 1000))   # 나눠 쓸 메모리 1000MB
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ✓ $1"; else fail=$((fail+1)); echo "  ✗ $1 — 기대 [$3] 실제 [$2]"; fi; }
t0() { date +%s; }

echo "1. 순서·나눠 쓰기 (몫 300 → 상자 390: 둘은 함께, 셋째는 줄)"
s=$(t0); O=$T/o1
( $M run A 300 -- bash -c "echo A \$((\$(date +%s)-$s)) >> $O; sleep 3" 2>/dev/null ) & sleep .4
( $M run B 300 -- bash -c "echo B \$((\$(date +%s)-$s)) >> $O; sleep 3" 2>/dev/null ) & sleep .4
( $M run C 300 -- bash -c "echo C \$((\$(date +%s)-$s)) >> $O" 2>/dev/null ) & sleep .4
( $M run D 10 -- bash -c "echo D \$((\$(date +%s)-$s)) >> $O" 2>/dev/null ) &
wait
ok "A·B 같이 시작" "$(awk '$1=="B"{print ($2<=1)}' $O)" 1
ok "C 는 A 끝난 뒤" "$(awk '$1=="C"{print ($2>=3)}' $O)" 1
ok "D(작아도) C 를 새치기 안 함" "$(awk '$1=="C"{c=NR} $1=="D"{d=NR} END{print (d>c)}' $O)" 1

echo "2. 시간 초과 → 75, 실행 안 함"
( $M run H 900 -- sleep 4 2>/dev/null ) & sleep .5
$M run I 900 --wait 2 -- touch $T/never 2>/dev/null; ok "종료 75" $? 75
ok "명령 실행 안 됨" "$([ -e $T/never ] && echo yes || echo no)" no
wait

echo "3. 상자 한도 넘으면 그 작업만 죽음"
$M run boxtest 100 -- python3 -c "x=bytearray(400*1024*1024)" 2>/dev/null; ok "종료 137" $? 137

echo "4. 종료 코드·환경·폴더·입력 그대로"
$M run ec 10 -- bash -c 'exit 7' 2>/dev/null; ok "종료 7" $? 7
ok "환경 변수" "$(FOO=bar $M run env 10 -- bash -c 'echo $FOO' 2>/dev/null)" bar
ok "폴더" "$(cd /tmp && $M run cwd 10 -- pwd 2>/dev/null)" /tmp
ok "입력" "$(echo hi | $M run in 10 -- cat 2>/dev/null)" hi

echo "5. 감싼 프로그램만 죽어도 상자 안 작업이 살아 있으면 자리 유지"
$M run held 700 -- sleep 5 2>/dev/null & W=$!; sleep 1
kill -9 $W 2>/dev/null; sleep .5
ok "자리 남음" "$($M status | grep -c 'held')" 1
$M run next 700 --wait 1 -- true 2>/dev/null; ok "다음 큰 작업은 기다림(75)" $? 75
sleep 5
ok "작업 끝나면 자리 빔" "$($M status | grep -c 'held')" 0

echo "6. 스왑이 거의 다 찼거나 멈칫거리면 기다림 · 스왑을 많이 «쓰고만» 있으면 통과"
MEM_SLOT_SWAP_FREE_MIN=99999999 $M run sw 10 --wait 1 -- true 2>/dev/null; ok "남은 스왑 부족 → 75" $? 75
printf 'some avg10=60.00 avg60=1 avg300=0 total=1\nfull avg10=35.50 avg60=1 avg300=0 total=1\n' > $T/psi
MEM_SLOT_PSI_FILE=$T/psi $M run ps 10 --wait 1 -- true 2>/dev/null; ok "멈칫거림 35% → 75" $? 75
printf 'some avg10=3.00 avg60=1 avg300=0 total=1\nfull avg10=0.40 avg60=0 avg300=0 total=1\n' > $T/psi
MEM_SLOT_PSI_FILE=$T/psi $M run ps2 10 --wait 1 -- true 2>/dev/null; ok "멈칫거림 0.4% → 실행" $? 0
MEM_SLOT_SWAP_FREE_MIN=1024 MEM_SLOT_PSI_FILE=/proc/pressure/memory $M run real 10 --wait 1 -- true 2>/dev/null; ok "지금 서버(스왑 ~2GB 사용·여유 6GB) → 실행" $? 0

echo "7. 순번 파일이 지워져도 새치기 없음"
( $M run L1 900 -- sleep 3 2>/dev/null ) & sleep .4
( $M run L2 900 -- bash -c "echo L2 >> $T/o7" 2>/dev/null ) & sleep .4
rm -f $T/.seq
( $M run L3 10 -- bash -c "echo L3 >> $T/o7" 2>/dev/null ) &
wait
ok "L2 가 L3 보다 먼저" "$(tr '\n' ' ' < $T/o7)" "L2 L3 "

echo "8. 잘못된 입력 → 2"
$M run x 10 --wait abc -- true 2>/dev/null; ok "--wait 숫자 아님" $? 2
$M run x abc -- true 2>/dev/null; ok "MB 숫자 아님" $? 2

echo "9. 몫이 나눠 쓸 메모리보다 크면 상자를 그 크기로 (혼자 들어감)"
$M run big 99999 --wait 1 -- true 2>/dev/null; rc=$?
ok "들어가거나(0) 남은 메모리 부족으로 기다림(75)" "$([ $rc = 0 ] || [ $rc = 75 ] && echo y)" y
ok "상자 기록이 나눠 쓸 메모리 이하" "$(grep -c 'start big need=1000 box=1000' $T/events.log 2>/dev/null || echo 0)" "$([ $rc = 0 ] && echo 1 || echo 0)"

ok "자리표 비어 있음" "$(ls $T | grep -cE '^[0-9]+\.[0-9]+$')" 0
echo "통과 $pass · 실패 $fail"
[ $fail = 0 ]
