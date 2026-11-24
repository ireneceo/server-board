# AI 설치 프롬프트

[English →](AI-SETUP-PROMPT.md)

**쓰는 법:** 서버에 접속(`ssh myserver`) → 홈 폴더에서 `claude` → **아래 줄 밑의 글 전체**를 붙여 넣습니다.
Claude 가 설치를 하고, 마지막에 «주인이 할 일» 만 짧게 알려 줍니다.

**두 가지로 돌릴 수 있습니다:** (1) **상황판에서** — `install.sh` 뒤 상황판 «처음 설정» 칸의 **AI 로 설치 마무리 ▶** 를 누르면 상황판이 이 프롬프트로 «처음 설정» 방을 열고, 답은 상황판에서 합니다 (2) **터미널에서** — 위처럼 `claude` 에 붙여 넣기. 결과는 같습니다.

팁: 이 파일을 서버의 `~/.claude/commands/서버상황판-설치.md` 로 저장해 두면 `/서버상황판-설치` 명령이 됩니다.

---

너는 이 서버에 **서버 상황판(Server Board)** 을 설치한다. Claude Code 백그라운드 작업방(`claude --bg`) + 모든 방의 진행·질문·보고를 보여 주는 비공개 브라우저 상황판이다.
원본: https://github.com/ireneceo/server-board (공개, MIT)

목표:
1. 주인이 접속을 끊어도 맡긴 일은 이 서버에서 계속 돈다.
2. 방이 질문·허락 때문에 멈추면 주인이 상황판을 여는 순간 맨 위에서 본다(«지금 볼 것»).
3. 나중에 프로젝트를 더할 때 `projects.json` 한 줄이면 된다.

## 0. 설치 기준 (설치 내내 지킨다)

좋은 설치의 기준이다. 보고 전에 스스로 이 표로 점검한다.

| # | 기준 | 지키는 방법 |
|---|---|---|
| S1 | **더하기만, 깨지 않기.** 이미 도는 것(PM2·nginx·DB·crontab·기존 `.claude` 파일)은 멈추거나 바꾸지 않는다 | 먼저 읽기만으로 조사 · 새 파일만 · 기존 명령·규칙은 절대 덮어쓰지 않음 |
| S2 | **고치기 전에 백업** | `~/.bashrc` → `~/.bashrc.bak-날짜` · crontab → `~/crontab.bak-날짜` · `~/.claude/CLAUDE.md` → `.bak-날짜` |
| S3 | **처음부터 비공개.** 상황판은 `127.0.0.1` 에만 열고 SSH 통로로만 본다 | nginx·방화벽·공개 도메인 설정을 더하지 않는다 · `kit/verify.sh` 로 증명 |
| S4 | **sudo·권한 설정은 내가 하지 않는다** | sudo·nginx·방화벽·`~/.claude/settings.json` 이 필요한 일은 정확한 명령과 함께 «주인이 할 일» 로 |
| S5 | **한 프로젝트 폴더에 고치는 방은 하나** | `bgIsolation: none`(주인이 설정) + 상황판 대기열 |
| S6 | **운영 작업 금지**(배포·운영 데이터 쓰기·메일/메시지 발송) — 주인의 분명한 지시가 있을 때만 | 공용 규칙(`~/.claude/CLAUDE.md`)에 들어감 |
| S7 | **값은 추측이 아니라 이 서버에서** | `kit/detect.py` 를 쓴다 · 추측한 값은 «(추측 — 확인 필요)» |
| S8 | **말이 아니라 증명** | `kit/verify.sh` «✘ 0개» + 실제 시험 방 1개 · 숫자로 보고 · 확인 못 한 것은 «확인 못 함» |
| S9 | **비밀값은 파일·대화에 쓰지 않는다** | `.env` 값·토큰·개인 열쇠를 출력하지 않음 · 비밀이 *어디 있는지* 만 적음 |
| S10 | **질문은 두 번만** | ① 조사 직후 1b 질문지 한 번(감지한 값을 미리 채운 확인 질문) ② 마지막 보고에 남은 것 하나로. 그 사이에 묻지 않는다 · 답이 없으면 권고값으로 진행하고 «정한 값» 표에 «권고값» 이라고 적는다 |

## 0b. 서버 구성 기준 — 이렇게 나눈다

이 상황판을 만든 쪽 서버는 «서버 방 1개 + 솔루션 3개» 로 나뉘어 매일 돈다. 처음 설치할 때 이 모양을 권고값으로 제안하고, 주인이 고칠 것만 받는다(1b).

| 층 | 무엇 | 어디 | 그 안에 두는 것 |
|---|---|---|---|
| **서버 전체 규칙** | 이 서버의 모든 Claude 가 지키는 일하는 방식(질문은 마지막에 하나로 · 보고 첫 줄 · 운영 작업 금지 · 독립 검증 기준) | `~/.claude/CLAUDE.md` | `kit/templates/<lang>/global-CLAUDE.md` |
| **서버 방** | 상황판·터미널 메뉴·정기 점검·서버 상태를 맡는 방. **솔루션 폴더 안은 고치지 않고** 그 솔루션 대기열에 넣는다 | `~/dev-server` (상황판 키 `server`) | `CLAUDE.md`(server 틀) · `session-state.md` · `projects.json` · `board/` |
| **솔루션** | 제품·사이트 하나 = 폴더 하나 = git 저장소 하나. 코드·DB·PM2 프로세스·개발 주소를 다른 솔루션과 섞지 않는다 | `/opt/<키>` 또는 이미 쓰는 폴더(`/var/www/…`) | `CLAUDE.md`(solution 틀 — 격리·개발 환경·일하는 순서·되돌리기 어려운 것·시험 역할·개발 명령 설정) · `.claude/commands/`(개발시작·개발완료·검증·배포·fable-검증·저장·임시저장·복원·기능설계) · `.claude/session-state.md` |
| **운영** | 실제 손님이 쓰는 곳. 가능하면 **다른 서버** | 운영 서버 | 이 서버의 Claude 는 직접 접속하지 않고 `/배포` 방으로만 |

나누는 기준(권고):
- **따로 팔거나 따로 쓰는 것이면 따로 둔다.** 고객이 다르거나, 하나가 멈춰도 다른 것은 돌아야 하면 다른 솔루션. 같은 제품의 백엔드·프론트는 한 솔루션 안 하위 폴더.
- 이름 규칙: 키 = 영문 소문자(`shop`) → 폴더 `/opt/shop` · PM2 `shop-backend`·`shop-frontend` · DB `shop_dev_db` · 개발 주소 `dev.<도메인>`. 이름만 봐도 어느 솔루션 것인지 보이게.
- 한 솔루션 폴더를 동시에 고치는 방은 하나(상황판 대기열이 지킴). 솔루션끼리는 동시에 돌아도 된다(서버 전체 최대 3개).
- 모르는 폴더(남의 서비스·옛 백업·실서비스 운영 폴더)는 솔루션으로 올리지 않는다 — 올리면 Claude 가 그 안을 고칠 수 있게 된다.

## 1. 서버 살펴보기 (읽기만)

저장소를 아직 안 받았으면 2단계를 먼저 하고:

```bash
python3 -I ~/dev-server/kit/detect.py --summary     # 사람이 읽는 요약 · --summary 없으면 JSON
```

표로 정리: OS·메모리·디스크·CPU · `node -v`(18 이상) · `pm2 -v` · `python3` · `git` · `claude --version` · **AI 로그인**: `claude auth status --text`(로그인됨? 구독인지 API 키인지 — 메일·조직 이름은 출력하지 않음) · 사용자·홈 · 서버 시간대와 **주인** 시간대(모르면 질문) · 상황판 빈 포트(8800 이 비면 8800) · 프로젝트 후보(PM2 앱 폴더, `/var/www`·`/opt/*`·`~/*` 의 git 저장소, nginx `server_name` 읽기만): 이름·폴더·개발 주소·`CLAUDE.md` 유무·작업기록(`.claude/session-state.md`) 유무·기존 `.claude/commands/` · 이미 있는 백그라운드 방(`claude agents --json --all`)은 그대로 둔다.

Node 18 미만이거나 PM2·git·python3·Claude Code 가 없으면 설치 명령을 «주인이 할 일» 에 적고, 할 수 있는 일은 계속한다.

## 1b. 주인에게 물을 것 — 질문지 (조사 직후 한 번에)

1단계 결과로 **답을 미리 채운 확인 질문**을 만든다 — 주인은 «맞아요» 또는 고칠 것만 말하면 된다. 이미 알아낸 것은 묻지 않는다.
**백그라운드 방이면**(`$CLAUDE_JOB_DIR` 있음 — 상황판 «AI 로 설치 마무리» 로 시작한 경우 등): 질문지 전체를 상황판 질문 **하나**로 올린다(`POST /api/asks` · 번호·답 미리 채움·권고값 표시 · 9000자 이하 · 프로젝트별 긴 내용은 `~/dev-server/setup-plan.md` 에 두고 가리킴) → 첫 줄 `⏸ 답 필요` 로 차례를 끝낸다. 주인 답은 같은 방으로 들어오니 다시 묻지 않고 이어서 한다. **터미널이면**: 질문 도구(AskUserQuestion)가 있으면 한 번에 4개씩 최대 3번, 없으면 아래를 번호 목록으로 한 번에. 주인이 자리에 없거나 답이 없으면 **권고값으로 진행**하고 마지막 보고 «정한 값» 표에 «권고값 — 바꾸려면 …» 으로 남긴다.
권고값은 이 상황판을 만든 쪽이 실제 서버(프로젝트 여러 개·실사용자 있음)를 매일 운영하며 정한 것이다.

| # | 묻는 것 | 정해지는 것 | 권고값 · 운영 노하우 |
|---|---|---|---|
| **A** | **사람과 언어** | | |
| A1 | 상황판에 보일 이름 | `owner` | 서버 사용자 이름 |
| A2 | 화면 언어 · AI 가 보고할 언어 | `lang`·`aiLang`·공용 규칙 `{{LANG}}` | 주인이 이 대화에 쓴 언어. 보고는 쉬운 말로 — 코드 용어는 일상어로 풀어 쓰게 공용 규칙에 둔다 |
| A3 | 주인이 사는 곳의 시간대 | `timezone` — 정기 실행 시각·«오늘 자정» 기준 | 서버 시간대가 아니라 **주인 시간대** (클라우드 서버는 대개 UTC) |
| A4 | 이 서버에 로그인하는 사람이 주인 혼자인가 | 설치 여부 | 혼자일 때만 설치. 아니면 멈추고 질문 — 같은 서버의 다른 계정은 `127.0.0.1` 상황판에 닿을 수 있다(SECURITY) |
| **B** | **솔루션 나누기** (1단계 후보 표 + 0b 기준으로 만든 «구성 초안» 을 보여 주고) | | |
| B0 | 이 구성으로 나눌까요? — 후보 폴더마다 «솔루션으로 올림 / 뺌 / 다른 것과 합침», 그리고 **새로 시작할 솔루션**(이름·한 줄 설명) | `projects.json` 의 솔루션 목록 · 새 솔루션 폴더(4.3b) | 0b 기준. 실서비스 운영 폴더·모르는 폴더는 뺌 · 새 솔루션은 `/opt/<키>` |
| B1 | 솔루션마다 한 줄 설명·쓰는 사람(역할) | 솔루션 `CLAUDE.md` 머리 · 시험 역할 표 | README·package.json 설명으로 초안 |
| B2 | 프로젝트마다 개발 주소 | `devUrl` · 보고 «확인할 곳» 링크 | nginx `server_name` 에서 찾은 값. 보고마다 «어디서 무엇을 확인할지» 링크가 붙어야 주인이 휴대폰에서도 확인한다 |
| B3 | 운영 서버가 따로 있나 · 배포는 무엇으로(스크립트·명령) | `prodLabel`(배포 버튼) · «개발 명령 설정» 배포 칸 | 찾은 배포 스크립트. 없으면 «배포 없음» — 버튼 끔 |
| B4 | 그 프로젝트에서 **되돌리기 어려운 것** — 돈(결제·정산)·로그인·권한·운영 DB 대량 수정·외부 발송(메일·문자·공지)·삭제 | 프로젝트 «개발 명령 설정» 의 «Fable 검증 대상(반드시)» 줄 — 독립 검증·주인 확인 대상 | 결제·메일·인증 라이브러리로 초안을 만들어 확인받기. 이 목록에 든 일은 «끝났다» 전에 독립 검증 |
| B5 | 그 프로젝트가 쓰는 외부 서비스(결제·메일·AI·지도·호스팅…) · 유료인지 | `~/dev-server/services.json` → 카드 «외부 서비스 n» | `.env` **키 이름**·의존성으로 초안(값은 열지 않음). 유료·시험 열쇠·만료일은 «알아 둘 것» 에 |
| B6 | 솔루션마다 시험 역할(예: 사장·직원·손님) 과 시험 계정이 적힌 곳 | 솔루션 `CLAUDE.md` «시험 역할» 표 — 보고 «확인할 곳» 이 그 역할 화면을 가리키게 | 시드 스크립트·테스트 계정 문서에서 초안(비밀번호는 쓰지 않음). «시험 계정으로 열기» 버튼(dev-login)은 그 솔루션에 라우트가 생긴 뒤 켬 — 설치 때는 표만 |
| **C** | **하루 운영** | | |
| C1 | 정기 점검을 켤 프로젝트·시각·할 일 | 상황판 «◷ 정기 점검»(시각·요일 + 개발완료·배포 확인·개발시작 체크) | 실사용자가 있는 프로젝트 · 주인이 하루를 시작하기 30~60분 전 · 프로젝트 사이 15분 차(검사가 겹쳐 메모리에 막히지 않게) |
| C2 | 정기 점검이 운영 배포까지 저절로 할까 | 상황판 «◷ 정기 점검» «배포» 체크 | **주인이 «예» 할 때만 켠다.** «배포» 를 체크하면 정기 점검이 막는 것(시험·열린 질문·하다 만 일)이 없을 때 운영 배포까지 혼자 한다 — 배포 명령을 등록했으면 상황판이 실행, 아니면 점검 방이 그 프로젝트 배포를 한다. 체크하지 않으면 상황판 **배포** 버튼으로만. 주인에게 분명히 묻고 «예» 일 때만 체크 |
| C3 | 밤에 도는 검사(전체 시험·순찰·백업)가 있나 | 정기 점검(개발시작)이 결과를 읽을 위치 | 있으면 crontab 은 건드리지 않고 위치만 프로젝트 «개발 명령 설정» 에 |
| C4 | 빌드가 무거운가 | 공용 규칙 «무거운 작업» | 메모리 8GB 이하 서버면 빌드는 한 번에 하나 · 메모리가 모자라면 기다리기(다른 프로세스를 끄지 않음) |
| **D** | **보기와 알림** | | |
| D1 | 상황판을 볼 기기(맥·윈도우·리눅스·아이폰·안드로이드) | 보고에 그 기기 안내만 | — |
| D2 | 휴대폰에서도 볼 건가 | 접속 방식 | 예 → **Tailscale**(사설망 · 바깥 인터넷엔 안 열림 · `funnel` 금지 · 계정 2단계 인증 · 기기는 주인 것만). 아니오 → SSH 통로. 둘 다 켜 두면 하나가 끊겨도 본다. 설치 명령은 sudo 라 «주인이 할 일» |
| D3 | 질문이 생기면 알림 받을 곳 | 상황판 «알림» (주인이 화면에서 켬) | 휴대폰 홈 화면에 상황판 추가 → 알림 켜기(웹 푸시). 안 되면 ntfy 앱. 설치 AI 는 안내만 |
| **E** | **AI 계정·비용·비밀** | | |
| E1 | Claude 구독(Pro·Max·Team)인가 API 키인가 | 4b 로그인 | 방을 여럿·오래 돌리면 구독. API 키면 콘솔에서 지출 한도부터 |
| E2 | 독립 검증에 쓸 모델 | `fable-검증` 명령의 `model` | 계정에서 쓸 수 있는 가장 강한 모델. **아껴 쓰는 기준**: 틀리면 되돌리기 어렵거나 기계 검사로 가를 수 없는 판단(설계·돈·권한·운영 데이터·공개 주소·외부 발송)에만 · 한 사안 최대 2번(설계 1 + 검증 1) · 나머지는 실제로 돌려 숫자로 |
| E3 | 비밀값이 있는 곳(.env·DB 설정) | 위치만 기록(S9) | 값은 읽지도 쓰지도 않는다 |
| **F** | **백업** | | |
| F1 | 백업이 어디에 쌓이나 | 보고 «주의» · `projects.json` `backup` | 백업 스크립트 안의 다른 서버로 보내는 줄(scp·rsync·클라우드 업로드)까지 읽고 판단 · 매일 도는 백업이 있으면 그 스크립트·기록·사본 폴더를 `backup` 칸 값으로 보고(주인이 카드에서 승인) · **백업이 아예 없으면 만들지 말고** 보고에 «카드 빨강 «백업 없음» → «자동 백업 만들기» 를 누르세요» (서버 카드 포함) · 같은 디스크뿐이면 «서버가 고장 나면 같이 사라짐» 과 창의 «PC 로 받기»·바깥 사본을 권고(외부 전송은 주인 결정) |

## 1c. 설치 계획표 — 답을 반영해 한 장으로

1b 답(없으면 권고값)으로 아래 표를 만들어 보고 맨 위에 남기고 **바로 진행한다**(다시 묻지 않는다).

| 솔루션 | 폴더 | 새로 만듦/있음 | CLAUDE.md | 명령 | 작업기록 | 배포 버튼 | 정기 점검 | 시험 역할 |
|---|---|---|---|---|---|---|---|---|
| server | `~/dev-server` | 새로 | server 틀 | — | 새로 | 없음 | — | — |
| (예) shop | `/opt/shop` | 있음 | 있음 → 빠진 절만 더함 | 없는 것만 9개 | 새로 | `/배포` 있으면 | 08:00 | owner·staff |

## 2. 코드 받기

**`~/dev-server/board/config.json` 이 있고 `~/dev-server/install-info.json` 이 `"by": "install.sh"` 이면 이 단계와 4.5 를 건너뛴다** — 상황판이 이미 설치돼 돌고 있다. 그 값(언어·시간대·주인·포트)은 주인이 질문지에서 바꾸지 않는 한 그대로. `board/config.json` 을 바꿨으면 `pm2 restart dev-board`.

```bash
test -e ~/dev-server && echo "이미 있음 — 멈추고 보고" || git clone https://github.com/ireneceo/server-board.git ~/dev-server
```

`~/dev-server` 가 이미 있으면 **덮어쓰지 않는다.** 이 단계를 멈추고 보고.
`board/config.json`·`projects.json`·`CLAUDE.md`·`session-state.md`·`board/state.json`·`board/log/` 는 git 밖의 이 서버 파일이라 `git pull` 로 새 판을 받아도 그대로다.

## 3. 이 서버에 맞추기

**`board/config.json`**: `board/config.example.json` 을 복사해 채운다:

| 칸 | 값 | 어디서 |
|---|---|---|
| `owner` | 상황판에 보이는 주인 이름(«지금 ○○ 님이 볼 것») | 묻거나 사용자 이름 |
| `lang` | `"ko"` 또는 `"en"`: 상황판 화면·새 일 머리글·설치할 명령 언어 | 묻기(한국어 사용자면 `ko`) |
| `aiLang` | 작업방이 보고·질문을 쓰는 언어 — **어느 언어든**(예 `"日本語"`, `"Español"`). 비우면 `lang` 과 같음. 주인 언어가 한국어·영어가 아니면 `lang` `"en"` + `aiLang` 그 언어, 공용 규칙의 `{{LANG}}` 도 그 언어 | 묻기: «AI 가 어느 언어로 보고할까요?» |
| `timezone` | 주인 시간대(IANA) 예: `Asia/Seoul`, `America/Los_Angeles` | 묻기 / 조사 |
| `port` | 상황판 포트 | `ports.boardPortSuggest` |
| `devSsh` | `ssh <사용자>@<이 서버 IP>`: «터미널에서 이 방 열기» 에 보임 | `system.user`·`system.ips[0]` |
| `serverName` | 이 서버를 부를 짧은 이름(예: 개발서버·고객사A) — 인증 앱에 «Server Board · 이름» 으로 보임. 서버마다 다르게 | 사람에게 물음(없으면 비움 = devSsh 주소) |
| `linkExample` | 보고 «확인할 곳» 예시 주소 | 프로젝트 개발 주소 + 대표 화면 경로 |
| `hideLinkHosts` | 링크 버튼으로 만들지 않을 주소 앞부분(운영 주소·이 서버 IP) | `system.ips` + 주인 |
| `linkPaths` | 보고 속 경로(`admin`·`dashboard` …)를 개발 주소 링크로 바꿀 첫 단어 | 프로젝트 경로, 모르면 예시 그대로 |
| `supportUrl` | 상황판 아래 도움 링크. 기본값 그대로 두거나 `""` 로 숨김 | 주인이 따로 말하지 않으면 기본값 |

**`projects.json`**: `kit/templates/projects.example.json` 에서 시작. 프로젝트마다 한 줄, `server`(이 폴더 · `dir` 의 `USER` 를 바꿈) 항목은 꼭 남긴다. `install.sh` 가 이미 `projects.json`(서버 방만)을 썼으면 거기에 프로젝트를 **더한다**:

```json
{ "key": "myapp", "name": "MyApp", "dir": "/opt/myapp", "stateFile": ".claude/session-state.md",
  "morningCheck": false, "prodLabel": null, "devUrl": "https://dev.myapp.example", "noDevDone": true }
```

- `morningCheck: true` → (옛 crontab 방식에서) 정기 점검 대상. 상황판 «◷ 정기 점검» 은 이 값과 상관없이 등록한 프로젝트만.
- `prodLabel` → **배포** 버튼(프로젝트 키를 쳐야 열림). 배포 명령이 없으면 `null`.
- `noDevDone: true` → **개발완료** 버튼 숨김. 4.3 에서 명령을 넣은 프로젝트만 버튼을 켠다.
- 그 밖의 칸(배포 실행 `deploy` · 운영 표식 `prodMarker` · 문의 칸 `inquiries` · 시험 계정 `devLogin` …)과 뜻: [SERVER-GUIDE.ko.md](SERVER-GUIDE.ko.md) 2절. 설치 때는 위 기본 칸만 — 나머지는 그 솔루션에 해당 절차가 생긴 뒤.

그다음: `node --check ~/dev-server/board/server.js`.

## 4. 설치

1. **공용 규칙** `~/.claude/CLAUDE.md`: 없으면 `kit/templates/<lang>/global-CLAUDE.md` 를 복사해 `{{OWNER}}`·`{{DATE}}`·`{{LANG}}`·`{{PORT}}`(상황판 포트 — `board/config.json` 의 `port`, 8800 이라고 가정하지 않는다)를 채운다. 있으면 백업(S2) 뒤 **빠진 절만 끝에 더한다**(«멈춰야 할 때»·«보고»·«권한 거부»·«독립 검증»). 이 규칙이 상황판을 움직인다: 방이 질문을 상황판에 올리고, 보고를 상태 첫 줄(`✅ 완료` / `⏸ 답 필요` / `❌ 막힘` / `🕓 나중에`)로 끝낸다.
2. **서버 작업방 규칙**: `~/dev-server/CLAUDE.md` ← `kit/templates/<lang>/server-CLAUDE.md` · `~/dev-server/session-state.md` ← `kit/templates/<lang>/session-state.md`. `{{DATE}}`·`{{OWNER}}`·`{{SERVER_IP}}`(이 서버 IP)·`{{PORT}}`(`board/config.json` 의 상황판 포트)·`{{PROJECT_DIRS}}`(projects.json 의 프로젝트 폴더들)를 채운다.
3. **솔루션 규칙·명령**(1c 계획표의 솔루션마다):
   - **솔루션 `CLAUDE.md`**: 없으면 `kit/templates/<lang>/solution-CLAUDE.md` 로 만들고 `{{NAME}}`·`{{ONE_LINE}}`·`{{DIR}}`·`{{OTHER_DIRS}}`·`{{DB_NAME}}`·`{{PM2_NAMES}}`·`{{PORTS}}`·`{{PROD_HOST}}`·`{{DEV_URL}}`·`{{SECRETS_WHERE}}`·`{{OWNER}}` 를 1단계·1b 값으로 채운다(모르면 «없음», 추측은 «(추측 — 확인 필요)»). **있으면 고쳐 쓰지 않고**, 백업 뒤 그 틀에서 **빠진 절만 끝에 더한다**(격리 규칙·일하는 순서·되돌리기 어려운 것·시험 역할 — 같은 뜻의 절이 이미 있으면 더하지 않고 보고에 «이미 있음»).
   - `kit/commands/<lang>/*.md` 를 `<프로젝트>/.claude/commands/` 에 **같은 이름 파일이 없을 때만** 복사하고 `{{OWNER}}` 채우기. 그 프로젝트가 키운 명령은 절대 덮지 않는다(다른 점만 보고).
   - `kit/commands/ko/_설정-예시.md`(영어: `kit/commands/en/_settings-example.md`)의 «개발 명령 설정» 절을 그 솔루션 `CLAUDE.md` 끝에 붙이고 `detect.py` 값으로 채운다: 빌드(`packages[].scripts.build`, 폴더 포함) · 재시작/로그(`pm2[].name` · PM2 가 없고 Docker 를 sudo 묶음 명령으로 다루면 Docker 예시 — 컨테이너 이름·묶음 명령·시험 명령, `{{PM2_NAMES}}` 에는 컨테이너·서비스 이름) · health(`curl -s localhost:<포트>/api/health` 가 실제로 200 일 때만) · 개발 주소 · 배포 스크립트(`deployScripts`, 없으면 «배포 없음») · 운영 문의 읽기·답글 길(찾은 것만 — 없으면 «없음»). 문의 읽기 절이 생긴 솔루션은 `projects.json` «inquiries» 에 그 절 제목(SERVER-GUIDE 3절). 추측은 «(추측 — 확인 필요)», 모르면 «없음». 비밀번호는 쓰지 않고 위치만.
   - `stateFile` 경로에 작업기록이 없으면 `kit/templates/<lang>/solution-session-state.md` 로 만든다(`{{NAME}}`·`{{DATE}}`·`{{OWNER}}` 채움).
   - `projects.json` 에서 명령이 생긴 버튼만 켠다(`kit/verify.sh` 가 맞춰 본다).
   - 독립 검증 명령(`fable-검증`)은 계정에서 쓸 수 있는 가장 강한 모델(`model: "fable"`, 없으면 `opus`)을 쓴다. 못 쓰면 «자체 검증만» 으로 기록.
3b. **새 솔루션 만들기**(B0 에서 새로 시작하기로 한 것만 — 앱 코드는 만들지 않는다, 그릇만):
   - 폴더: `mkdir -p /opt/<키>` — 권한이 없으면 «주인이 할 일» 에 `sudo mkdir -p /opt/<키> && sudo chown $USER:$USER /opt/<키>` 를 남기고 그 솔루션은 폴더가 생긴 뒤로 미룬다(나머지는 계속).
   - `git init` · `CLAUDE.md`(solution 틀) · `.claude/commands/`(9개) · `.claude/session-state.md`(빈 틀 + «다음 확정 작업: 첫 설계 — `/기능설계`») · `docs/` 빈 폴더.
   - `projects.json` 에 한 줄(`devUrl` 은 아직 없으면 빈 값 · `prodLabel` null · 개발완료 버튼 켬). DB·PM2·도메인은 만들지 않는다 — 첫 설계 방이 정한다.
4. **터미널 메뉴**(`install.sh` 가 이미 넣었으면 건너뜀 — `kit/verify.sh` 의 «터미널 메뉴 ~/bin/dev»): `mkdir -p ~/bin && cp ~/dev-server/kit/bin/dev ~/bin/dev && chmod +x ~/bin/dev` · `~/.bashrc` 백업 뒤 `kit/templates/bashrc-block.sh` 를 끝에 더하기(이미 있으면 건너뜀).
5. **상황판 켜기**: `cd ~/dev-server/board && pm2 start server.js --name dev-board --no-treekill && pm2 save` · `pm2 startup` 은 sudo 라 «주인이 할 일» 로.
6. **정기 점검**(C1): 상황판이 켜진 뒤 고른 프로젝트마다 정기 점검을 등록한다 — crontab 줄을 더하지 않는다(crontab 에 옛 morning-check.sh 줄이 있으면 상황판이 켜지 않는다 → 주인에게 알림):
   ```bash
   curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
     -d '{"project":"<키>","steps":["devdone","devstart"],"time":"08:00"}' http://127.0.0.1:8800/api/schedules
   ```
   steps 는 그 프로젝트에 명령이 있는 것만(4.3) — 없는 것을 넣으면 거절된다. 체크한 것만 한 방에서 개발완료 → (배포) → 개발시작 순서로. `"deploy"` 는 C2 에 주인이 «예» 했을 때만 넣는다 — 넣으면 막는 것이 없을 때 점검이 운영 배포까지 혼자 한다.
7. **외부 서비스 목록**(B5): `~/dev-server/services.json` — 비밀값은 절대 넣지 않는다(키 이름만):
   ```json
   { "legend": "status: on|off|plan · cost: paid|tier|free · warn: 주의",
     "projects": { "<키>": [ { "name": "Stripe", "status": "on", "cost": "paid", "use": "카드 결제",
       "price": "건당 수수료", "note": "시험 열쇠인지 실제 열쇠인지 관리 화면에서 확인", "where": ".env STRIPE_SECRET_KEY", "warn": false } ] } }
   ```
8. **되돌리기 어려운 것**(B4): 4.3 에서 붙인 «개발 명령 설정» 의 «Fable 검증 대상(반드시)» 줄과 솔루션 `CLAUDE.md` «되돌리기 어려운 것» 절을 확인받은 목록(코드 위치까지)으로 채운다 — `/개발완료` 가 이 줄을 보고 독립 검증을 요구한다. 운영 반영은 주인 지시로만.

## 5. 주인이 할 일 (내가 못 함 — 보고에 그대로)

백그라운드 방이면 항목마다 상황판 할 일 카드로도 따로 올린다(`POST /api/todos`, `terminal` 포함 · sudo·비밀번호가 필요한 명령은 앞의 `!` 없이). 상황판 «처음 설정» 칸에 이미 ✔ 인 항목은 빼고.

```bash
node -e 'const fs=require("fs"),p=require("path"),f=p.join(require("os").homedir(),".claude","settings.json");let d={};if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,"utf8"));fs.copyFileSync(f,f+".bak-"+new Date().toISOString().slice(0,10).replace(/-/g,""))}else fs.mkdirSync(p.dirname(f),{recursive:true});d.permissions={...d.permissions,defaultMode:"auto"};d.worktree={...d.worktree,bgIsolation:"none"};fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f)'
```

- `defaultMode: auto`: 묻지 않고 해도 되는 일을 Claude Code 가 스스로 가린다(Claude Code 권한 안내서 참고). 없으면 백그라운드 방이 허락 창마다 멈춘다.
- `bgIsolation: none`: 방이 프로젝트 폴더에서 바로 고친다(상황판이 프로젝트마다 고치는 방을 하나로 지킨다).
- 프로젝트 폴더마다 한 번 «믿겠습니까» 허락: `cd <폴더> && claude` → 허락 → `/exit`
- `pm2 startup` → 나오는 `sudo …` 한 줄 붙여 넣기
- **Claude Code 로그인이 안 돼 있으면**(1단계): `claude auth login`(Claude 구독 Pro·Max·Team) 또는 `claude auth login --console`(API 키·사용량 과금 — 지출 한도 걸기). 주소가 나옴 → 아무 브라우저에서 열어 로그인 → 코드를 붙여 넣기. 두 방식을 한 줄씩 설명(docs/INSTALL.ko.md 4b단계). 이게 없으면 시험 방을 끝낼 수 없음.
- **기기마다**(노트북·휴대폰): docs/INSTALL.ko.md 6단계 기기별 표. 상황판 안에도 있음(«다른 기기에서 이 화면 열기»).
- 내 컴퓨터에서 상황판 열기: `~/.ssh/config` 에 `LocalForward 8800 127.0.0.1:8800` → `ssh <별명>` → http://localhost:8800 (자세히: docs/INSTALL.ko.md 1~3·6단계 · 휴대폰은 Termius 포트 포워딩)

## 6. 확인 (전부 해 보고 표로)

- `bash ~/dev-server/kit/verify.sh` → 목표 «✘ 0개». 상황판 응답·보안(다른 Host 403 · Origin 없는 쓰기 403 · 127.0.0.1 에만)·PM2·Claude Code 방 목록 형식·권한 설정·«켠 버튼마다 명령 있음» 을 본다. Claude Code 를 업데이트할 때마다 다시.
- `curl -s -H 'Host: localhost:8800' http://127.0.0.1:8800/api/board | head -c 300` → JSON
- `dev status` → 터미널 상황판 요약
- 실제 시험 방 1개:
  ```bash
  curl -s -X POST -H 'Content-Type: application/json' -H 'Origin: http://localhost:8800' \
    -d '{"project":"server","task":"이 서버 메모리·디스크를 한 줄로 보고해 줘","queue":true}' http://127.0.0.1:8800/api/rooms
  ```
  몇 분 뒤 상황판에 «끝남» + 첫 줄 `✅`. 5단계 설정 전이라 허락 창에서 멈추면 그대로 보고.
- `pm2 jlist` 의 상황판 메모리(보통 60~80MB)

## 7. 마지막 보고 (형식 고정)

첫 줄: `✅ 완료` / `⏸ 답 필요` / `❌ 막힘`

- **1c 설치 계획표**(실제로 한 대로 — 계획과 다르게 된 칸은 이유)
- 설치한 것과 **정한 값**(1b·3단계 — 주인이 답한 값 / «권고값» 을 구분, 권고값은 «바꾸려면 …» 한 줄)
- 확인 결과(6단계, 숫자로) · 확인 못 한 것은 «확인 못 함»
- **주인이 할 일**(5단계, 붙여 넣을 명령 그대로)
- **질문**(있으면 하나로): 무엇을 정할지 · 선택지 · 각 결과 · 권고
- 상황판 여는 법(내 컴퓨터 통로 한 줄 + 휴대폰)
- 마지막 한 줄(한 번만, 담백하게): «설치·AI 연결·유지관리를 맡기고 싶으면: https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=ko&plan=setup&src=ai-report»
