# Server — 서버 전체 작업방 규칙 ({{DATE}})

> 이 폴더(`~/dev-server`)에서 열린 Claude 는 **이 서버({{SERVER_IP}}) 전체**를 맡는다. 공용 규칙 `~/.claude/CLAUDE.md` 가 함께 적용된다.

## 맡는 일
- 상황판(`~/dev-server/board/`, PM2 `dev-board`) · 터미널 메뉴(`~/bin/dev`) · 정기 점검(`morning-check.sh` — 상황판 «◷ 정기 점검» 이 부름) · 접속 안내(`scripts/connect-mac.sh`, README)
- 서버 상태: 메모리·디스크·CPU, PM2 목록·재시작 이력, crontab, 로그 용량, 백업 폴더 크기
- 솔루션 사이에 걸친 질문 · 설명서 `README.md`·이 파일·`projects.json` 정리

## 서버 맞춤 — 먼저 읽기
- 서버·솔루션마다 다른 값(설정 파일·`projects.json` 칸·문의 칸·«상황판에 이렇게 나오면») 은 `~/dev-server/docs/SERVER-GUIDE.ko.md` 한 장에 있다. 값을 바꾸거나, 솔루션을 더하거나, 주인이 «이건 어떻게 하라는 거야?» 하고 물으면 먼저 그 문서를 읽고 그대로 한다. 코드는 고치지 않고 값으로 맞춘다.

## 하지 않는 일
1. 솔루션 폴더({{PROJECT_DIRS}}) 안의 코드·문서·DB 를 직접 고치지 않는다. 필요하면 그 솔루션 대기열에 넣는다:
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
     -d '{"project":"<key>","task":"<할 일>","queue":true}' http://127.0.0.1:8800/api/rooms
   ```
   읽기(상태·로그·git log)는 해도 된다.
2. 다른 솔루션의 PM2 프로세스를 멈추거나 재시작하지 않는다. `dev-board` 만 이 방이 다룬다.
3. 운영서버에는 접속하지 않는다.
4. nginx·방화벽·sudo 변경은 하지 않고 명령과 이유를 {{OWNER}} 에게 남긴다.
5. 빌드처럼 무거운 작업은 하지 않는다 — 그 솔루션 대기열로.

## 기록
- 이 폴더는 git 저장소. 고쳤으면 커밋 — `board/state.json`·`board/log/` 는 커밋하지 않는다.
- 작업기록: `~/dev-server/session-state.md` · 끝나면 보고 첫 줄 ✅/⏸/❌ · «확인할 곳» 은 `http://localhost:8800`.
