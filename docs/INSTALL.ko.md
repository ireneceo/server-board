# 설치 안내

[English →](INSTALL.md)

약 15분 걸립니다. 1~3단계는 **내 컴퓨터**에서, 4~6단계는 **서버**에서 합니다.

> 중간에 막히면 같이 하거나 대신 해 드립니다: **[설치·구축 의뢰 →](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=ko&plan=setup&src=install-top)**

| 단계 | 어디서 | 무엇 |
|---|---|---|
| [1](#1단계--내-컴퓨터에서-ssh-열쇠-만들기) | 내 컴퓨터 | SSH 열쇠 만들기 |
| [2](#2단계--공개-열쇠를-서버에-넣기) | 내 컴퓨터 → 서버 | 공개 열쇠를 서버에 넣기 |
| [3](#3단계--접속-별명과-상황판-통로-저장) | 내 컴퓨터 | 접속 별명 + 상황판 통로 저장 |
| [4](#4단계--서버-준비) | 서버 | Node·PM2·git·Claude Code |
| [4b](#4b단계--ai-연결구독-또는-api-키) | 서버 + 아무 브라우저 | Claude Code 로그인(구독 또는 API 키) |
| [5](#5단계--상황판-설치) | 서버 | 상황판 설치(Claude 에게 맡기거나 직접) |
| [6](#6단계--기기별로-상황판-열기) | 기기마다 | http://localhost:8800 열기 — 맥·윈도우·리눅스·아이폰/아이패드·안드로이드 |

시작 전에 필요한 것: 서버 **IP 주소**(또는 주소)와 접속할 **사용자 이름**. 호스팅 업체 관리 화면에 나옵니다(보통 `root` + 비밀번호, 또는 업체가 준 열쇠).

---

## 1단계 · 내 컴퓨터에서 SSH 열쇠 만들기

SSH 열쇠는 파일 두 개입니다. 내 컴퓨터를 절대 떠나지 않는 **개인 열쇠**, 서버에 주는 **공개 열쇠**(글 한 줄). 이걸 해 두면 비밀번호 없이 접속되고, 상황판 통로도 끊기면 저절로 다시 붙습니다.

**맥·리눅스** (터미널):

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"
```

파일 위치는 Enter(기본값). 암호(passphrase)는 걸어도 되고(더 안전) Enter 두 번으로 비워도 됩니다.
맥에서 암호를 걸었다면 `ssh-add --apple-use-keychain ~/.ssh/id_ed25519` 를 한 번 해 두면 매번 묻지 않습니다.

**윈도우 10·11** (PowerShell, OpenSSH 기본 내장):

```powershell
if (!(Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub)) { ssh-keygen -t ed25519 }
```

공개 열쇠 보기(2단계에서 손으로 넣을 때만 필요):

```bash
cat ~/.ssh/id_ed25519.pub                              # 맥·리눅스
```
```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub       # 윈도우
```

`ssh-ed25519` 로 시작하는 한 줄입니다. **`.pub` 파일만 주세요.** `.pub` 가 없는 파일은 누구에게도 보내면 안 됩니다.

## 2단계 · 공개 열쇠를 서버에 넣기

`USER`·`SERVER_IP` 를 내 값으로 바꿉니다. 서버 비밀번호를 마지막으로 한 번 칩니다.

**맥·리눅스:**

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub USER@SERVER_IP
```

**윈도우 (PowerShell):**

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh USER@SERVER_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**비밀번호 접속이 막힌 서버**(AWS·GCP·일부 VPS): 업체 관리 화면의 «SSH 키» 에 `.pub` 한 줄을 붙여 넣거나, 업체가 준 열쇠로 접속해서 `~/.ssh/authorized_keys` 끝에 그 줄을 더합니다.

확인: `ssh USER@SERVER_IP` 가 이제 서버 비밀번호를 **묻지 않고** 접속되면 성공.

<details>
<summary><b>권장: 상황판을 root 로 돌리지 않기</b></summary>

`root` 밖에 없으면 일반 사용자를 한 번 만들고 앞으로 그걸 씁니다:

```bash
# 서버에서 root 로
adduser dev                      # 비밀번호 정하기, 나머지 질문은 비워도 됨
usermod -aG sudo dev
mkdir -p /home/dev/.ssh && cp ~/.ssh/authorized_keys /home/dev/.ssh/
chown -R dev:dev /home/dev/.ssh && chmod 700 /home/dev/.ssh && chmod 600 /home/dev/.ssh/authorized_keys
```

아래 `USER` 는 `dev`. Claude Code 와 상황판이 이 사용자로 돕니다.
</details>

## 3단계 · 접속 별명과 상황판 통로 저장

내 컴퓨터의 `~/.ssh/config`(윈도우: `C:\Users\<나>\.ssh\config`, 확장자 없는 글 파일)에 더합니다. 파일이 없으면 만듭니다:

```
Host myserver
  HostName SERVER_IP
  User USER
  IdentityFile ~/.ssh/id_ed25519
  LocalForward 8800 127.0.0.1:8800
  ExitOnForwardFailure yes
  ServerAliveInterval 30
```
`8800` 은 상황판 포트입니다. 서버 여러 대에 깔면 서버마다 다른 포트(설치가 물어봄 — 예: 8800, 8801)를 쓰고, 여기 두 숫자도 그 번호로. `ExitOnForwardFailure yes` 는 포트가 이미 쓰이면 통로 없이 접속하지 않고 실패하게 합니다.

이제 `ssh myserver` 한 번이면 접속되고, 그 창이 열려 있는 동안 서버 상황판이 내 컴퓨터의 http://localhost:8800 으로 이어집니다.
상황판은 인터넷에 열리지 않습니다. 내 SSH 접속만 닿습니다.

## 4단계 · 상황판 설치 (명령 한 줄)

`ssh myserver` 로 접속해서:

```bash
curl -fsSL https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh | bash
```

먼저 읽어 보려면: `curl -fsSLo install.sh https://raw.githubusercontent.com/ireneceo/server-board/main/install.sh && less install.sh && bash install.sh`

하는 일(설치·설정 변경 전마다 **먼저 묻습니다** · root 필요 없음):

1. 서버 점검(리눅스·홈 쓰기·git·curl) + 1분 점검(`kit/check-host.sh`)
2. 없으면 **Node 20**(nvm 으로 내 계정에)·**PM2**·**Claude Code** 설치를 제안
3. 상황판을 `~/dev-server` 로 받기(그 폴더에 다른 것이 있으면 멈춤)
4. 기본 설정: 언어·*내* 시간대·내 이름·빈 포트
5. PM2 로 상황판 켜기
6. 그 자리에서 **Claude 로그인**(4b단계)과 **방 설정 두 가지**(아래 «나만 바꿀 수 있는 설정 두 개» — 값마다 뜻을 보여 주고 하나씩 물음)를 제안
6b. **터미널 메뉴**(`~/bin/dev` + `~/.bashrc` 끝 몇 줄 — SSH 로 들어오면 방 목록) 를 넣을지 물음 · 나중에 넣기: `SB_MENU=1 bash ~/dev-server/install.sh`
7. 통로 명령과 남은 일 안내

다시 실행해도 됩니다 — 설정은 그대로 두고 상황판만 다시 켭니다. 끝 번호: `2` 꼭 필요한 도구 없음 · `3` `~/dev-server` 에 다른 것이 있음(아무것도 지우지 않음) · `4` 상황판이 안 켜짐(`pm2 logs dev-board --lines 30 --nostream`).

<details>
<summary>필요한 도구를 직접 설치하려면(sudo)</summary>

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo apt-get install -y git python3
npm install -g @anthropic-ai/claude-code      # 또는 Anthropic 공식 설치기
```
</details>

공유 웹호스팅이면 대부분 안 됩니다 → [어디서 돌아가나](../README.ko.md#어디서-돌아가나)

## 4b단계 · AI 연결(구독 또는 API 키)

`install.sh` 가 마지막에 물어봅니다(예). 건너뛰었으면 상황판 **처음 설정** 칸에 같은 명령이 나옵니다.

상황판은 AI 와 직접 이야기하지 않습니다. 서버에서 Claude Code 작업방을 띄울 뿐이고, **작업방은 서버 사용자의 Claude Code 로그인으로 일합니다.** 그래서 상황판을 돌리는 그 사용자로 서버에서 한 번만 로그인하면 됩니다.

| | Claude 구독(Pro · Max · Team) | API 키(Anthropic Console) |
|---|---|---|
| 비용 | 월 정액 · 몇 시간마다 사용 한도가 다시 참 | 쓴 만큼(토큰) · 고정 한도 없음 — Console 에서 지출 한도를 꼭 걸기 |
| 맞는 경우 | 1인 · 프로젝트 몇 개 | 팀 · 많이 · 밤낮없이 |
| 명령 | `claude auth login` | `claude auth login --console` |

서버에 브라우저가 없어도 됩니다:

1. 서버에서 표의 명령을 실행 → **주소**가 나옵니다.
2. 그 주소를 **아무 기기 브라우저**(노트북·휴대폰)에서 열어 로그인·승인.
3. 화면의 **코드**를 복사해 서버 터미널에 붙여 넣기.
4. 확인: `claude auth status --text` → 로그인됨. `claude -p "say ok"` 가 답하면 끝.

API 키를 환경변수로 쓰려면: 서버 사용자 `~/.bashrc` 에 `export ANTHROPIC_API_KEY=<내 키>` → **상황판을 그 환경으로 다시 켜기**(`source ~/.bashrc && pm2 restart dev-board --update-env`) — 상황판이 띄우는 작업방이 키를 볼 수 있게. 키는 `board/config.json` 이나 프로젝트 저장소에 절대 넣지 않습니다.

상황판이 10분마다 로그인을 확인합니다: 맨 위 서버 상태 칸의 «AI 연결» 칸에 **«✔ Claude 구독 Max»**(또는 «API 키»). 로그인이 끊기면 맨 위에 빨간 칸과 실행할 명령이 뜹니다 — 다시 로그인할 때까지 모든 작업방이 일을 못 합니다.

## 4c단계 · 최종 컨펌자 처음 로그인 설정 (서버 단위 · 한 번)

상황판은 **사람마다 자기 아이디·비밀번호로 로그인**합니다. 설치 직후에는 아직 비밀번호가 없어서, 처음 한 번 최종 컨펌자(상황판을 돌리는 계정의 주인)가 정합니다.
1. 3단계의 SSH 통로로 `http://localhost:8800` 을 엽니다 → «처음 설정 — 최종 컨펌자» 화면
2. 새 비밀번호(10자 이상) 두 번
3. 휴대폰 인증 앱(Google Authenticator·Microsoft Authenticator·1Password 등)에 등록 — 휴대폰이면 «인증 앱에 추가» 를 누르고, 컴퓨터면 앱에서 «설정 키 입력» 으로 화면의 키를 넣음 → 앱의 6자리를 입력
4. **예비 코드 10개**가 한 번만 보입니다 — 비밀번호 관리 앱이나 종이에 적어 두기
- 휴대폰·Tailscale 로만 쓸 거면: 서버 터미널에서 `dev recover` → 나온 링크(10분)로 같은 설정
- 아이디 = 상황판을 돌리는 서버 계정 이름. 팀원 추가·비상 복구는 [운영 절차서](OPERATIONS.ko.md)
- 확인: `bash ~/dev-server/kit/verify.sh` 에 «✔ 최종 컨펌자 비밀번호·인증 앱 있음»

## 5단계 · 상황판에서 설치 마무리

상황판을 엽니다(기기별은 6단계). 예: `ssh -L 8800:127.0.0.1:8800 사용자@서버` → http://localhost:8800

1. 맨 위 **처음 설정** 칸이 남은 일을 보여 줍니다: Claude Code 설치 · Claude 로그인 · 권한 설정 · 폴더 허락 · 재부팅 때 자동 시작(선택). 맨 위 «먼저 — 서버 창 열기» 에 이 서버 주소가 든 `ssh` 한 줄이 있고, 빠진 것마다 번호 순서대로 복사할 명령이 있습니다 — 복사 → 서버 창에 붙여 넣기 → Enter. 로그인은 **여기서 로그인(터미널 없이)** 버튼으로도 됩니다. 하고 나면 저절로 ✔ 가 됩니다(또는 **다시 확인**).
2. **AI 로 설치 마무리 ▶** 를 누릅니다. 서버 방에 «처음 설정» 방이 열려 [AI-SETUP-PROMPT.ko.md](AI-SETUP-PROMPT.ko.md) 를 읽고, 서버를 살펴본 뒤 상황판 맨 위에 **질문 카드 하나**를 올립니다: 프로젝트와 나누는 법·개발 주소·배포·되돌리기 어려운 것·정기 점검·기기. 찾은 값이 채워져 있고 권고값에 표시가 있습니다 — «좋아요» 또는 바꿀 번호만 답하면 됩니다.
3. 프로젝트마다 규칙·명령·작업기록·정기 점검을 설정하고, 내가 직접 해야 할 일은 **할 일 카드**(복사할 명령 포함)로 올리고, `kit/verify.sh` 결과로 끝냅니다. 칸의 **점검 돌리기** 로 언제든 다시 확인합니다.

### 방법 B · Claude 에 프롬프트 붙여 넣기(터미널)

```bash
cd ~ && claude
```

**[AI-SETUP-PROMPT.ko.md](AI-SETUP-PROMPT.ko.md)** 의 프롬프트 전체를 붙여 넣습니다. 결과는 같고 질문이 상황판 대신 터미널에 나옵니다. `install.sh` 를 했든 안 했든 됩니다(이미 설치돼 있으면 그 값을 씀).

### 방법 C · 직접

```bash
git clone https://github.com/ireneceo/server-board.git ~/dev-server
cd ~/dev-server
cp board/config.example.json board/config.json      # 고치기: owner, lang("ko"), timezone, devSsh
cp kit/templates/projects.example.json projects.json # 프로젝트 폴더마다 한 줄 · "server" 는 남기고 USER 를 내 사용자 이름으로
python3 -I kit/detect.py --summary                  # 프로젝트·포트·PM2 를 보여 줌
cd board && pm2 start server.js --name dev-board --no-treekill && pm2 save
bash ~/dev-server/kit/verify.sh                     # 목표: «✘ 0개»
```

규칙·명령 넣기는 [AI-SETUP-PROMPT.ko.md](AI-SETUP-PROMPT.ko.md) 4절대로.

### 나만 바꿀 수 있는 설정 두 개

Claude 는 자기 권한 설정을 스스로 못 바꿉니다. `install.sh` 가 (백업하고) 바꿀지 물어봅니다. 건너뛰었으면 서버에서 한 번(먼저 `settings.json` 을 백업함):

```bash
node -e 'const fs=require("fs"),p=require("path"),f=p.join(require("os").homedir(),".claude","settings.json");let d={};if(fs.existsSync(f)){d=JSON.parse(fs.readFileSync(f,"utf8"));fs.copyFileSync(f,f+".bak-"+new Date().toISOString().slice(0,10).replace(/-/g,""))}else fs.mkdirSync(p.dirname(f),{recursive:true});d.permissions={...d.permissions,defaultMode:"auto"};d.worktree={...d.worktree,bgIsolation:"none"};fs.writeFileSync(f+".tmp",JSON.stringify(d,null,2));fs.renameSync(f+".tmp",f)'
```

- `defaultMode: auto`: 묻지 않고 해도 되는 일을 Claude Code 가 스스로 가립니다(무엇을 허용하는지는 Claude Code 권한 안내서 참고). 없으면 백그라운드 방이 허락 창마다 멈춰 기다립니다.
- `bgIsolation: none`: 백그라운드 방이 프로젝트 폴더에서 바로 고칩니다. 상황판이 프로젝트마다 고치는 방을 **하나만** 돌립니다. 비워 두면 방마다 `.claude/worktrees/…` 의 별도 가지에서 일해 원본의 커밋 안 한 파일을 못 보고(같은 일을 다시 함) 결과를 따로 합쳐야 합니다 — 이때 상황판은 일을 넣을 때 커밋 안 한 변경이 있으면 경고합니다.

그리고 프로젝트 폴더마다 한 번: `cd /프로젝트/폴더 && claude` → «이 폴더를 믿겠습니까» 허락 → `/exit`.

재부팅 때 PM2 가 저절로 켜지게: `pm2 startup` → 나오는 `sudo …` 한 줄을 붙여 넣기.

## 6단계 · 기기별로 상황판 열기

상황판을 여는 길은 두 가지이고, 둘 다 인터넷에는 열리지 않습니다. `localhost:8800` 은 «지금 이 기기» 라는 뜻이라 내 노트북·휴대폰에서 그냥 치면 열리지 않습니다 — 아래 둘 중 **하나**로 내 기기와 서버를 이어야 합니다. (상황판 맨 위 «다른 기기에서 열기» 버튼도 같은 내용을 길·기기를 골라 그 순서만 보여 줍니다.)

| 길 | 비용 | 주소 | 맞는 경우 |
|---|---|---|---|
| **① SSH 통로** | **무료** (설치·가입 없음) | http://localhost:8800 — 접속해 있는 동안만 | 컴퓨터에서 볼 때. 휴대폰은 앱을 뒤로 보내면 몇 분 뒤 끊김 |
| **② Tailscale** | **개인 무료 · 팀은 유료** — 혼자 쓰는 개인 계정은 무료, 회사·팀 계정으로 여러 사람이 쓰면 1명당 월 요금([요금](https://tailscale.com/pricing)) | `https://<내 서버>.ts.net` — 앱을 켜 두면 늘 | 휴대폰으로 보고 홈 화면 앱·알림까지 |

고르기 어려우면: 컴퓨터에서만 → ① SSH 통로(무료) · 휴대폰으로도 보고 알림까지 → ② Tailscale(혼자면 무료). 둘 다 써도 됩니다. ① 은 아래 표, ② 는 아래 «통로 없이 늘 열기 — Tailscale».

서버 명령·작업방 열기 같은 **터미널**은 어느 쪽이든 SSH 로 하므로, 터미널을 쓰는 기기는 **기기마다 자기 열쇠**(1~2단계를 기기마다 한 번)가 필요합니다. 기기를 잃어버리면 서버 `~/.ssh/authorized_keys` 에서 그 한 줄만 지우면 됩니다. Tailscale 을 쓰면 휴대폰의 Termius 는 상황판 보기에는 필요 없고, 휴대폰에서 서버 명령을 칠 때만 씁니다.

| 기기 | 앱 | 처음 한 번 | 매일 |
|---|---|---|---|
| **맥** | 터미널 / iTerm | 1~3단계. 선택: 항상 켜진 통로 — 상황판 «다른 기기에서 열기» → «맥 — 늘 열어 두기(자동 통로)» 에 이 서버 값이 든 4단계가 나옴(손으로: `S=$(ssh myserver cat dev-server/scripts/connect-mac.sh) && bash -c "$S" connect-mac myserver` — 스크립트는 서버에 있음 · 맥에서 `post-quantum key exchange` 경고가 떠도 무시해도 됨)(잠자기·재부팅 뒤 다시 붙음) | `ssh myserver` → http://localhost:8800 (항상 켜진 통로면 즐겨찾기만 열기) |
| **윈도우 10/11** | PowerShell(OpenSSH 기본) · 또는 PuTTY | 1~3단계(설정 파일 `C:\Users\<이름>\.ssh\config`, 확장자 없음). PuTTY: Connection → SSH → Tunnels → Source `8800`, Destination `127.0.0.1:8800` → Add → 세션 저장 | `ssh myserver`(통로만: `ssh -N myserver`) → http://localhost:8800 |
| **리눅스 데스크톱** | 터미널 | 1~3단계(맥과 같음) | `ssh myserver` → http://localhost:8800 |
| **아이폰·아이패드** | Termius(무료) | 아래 | Termius 열어 접속 → 홈 화면 아이콘 |
| **안드로이드** | Termius(무료) | 아래 | 아이폰과 같음 · 뒤로 보내도 더 오래 유지됨 |

**휴대폰·태블릿 (Termius):**

1. Termius → Keychain → **Generate key**(ed25519). 노트북 열쇠가 아니라 **휴대폰용 새 열쇠**.
2. 공개 열쇠 복사 → 서버 `~/.ssh/authorized_keys` 에 새 줄로 추가(노트북에서 `ssh myserver` → `nano ~/.ssh/authorized_keys`).
3. Hosts → `SERVER_IP`, 사용자 `USER`, 그 열쇠.
4. **Port Forwarding** → 새 규칙 → Local · 포트 **`8800`**(꼭 8800 — 다른 번호는 403 으로 거절) → 목적지 `127.0.0.1` 포트 `8800` → 켜기.
5. Safari/Chrome 에서 http://localhost:8800 → **«홈 화면에 추가»**.
6. Termius 앱 잠금 켜기(Settings → Security).

아이폰은 Termius 가 뒤로 가고 몇 분 지나면 통로가 닫힙니다. 상황판에 빨간 «연결하지 못했습니다» 띠가 뜨면 Termius 를 열고(규칙이 다시 붙음) 새로고침. 그동안에도 작업방은 서버에서 계속 일합니다.

**통로 없이 늘 열기 — Tailscale (선택 · 개인 무료 · 팀은 유료 · 휴대폰에 알맞음):**

Tailscale 은 **내 기기끼리만 보이는 사설망**입니다(혼자 쓰는 개인 계정 무료 · 회사·팀 계정은 유료). 상황판이 인터넷에 열리지 않은 채로, 내 휴대폰·노트북에서는 Termius·SSH 없이 `https://<내 서버>.ts.net` 으로 언제든 열립니다. 휴대폰에서 앱을 뒤로 보내도 끊기지 않습니다. 각자 **자기 Tailscale 계정·자기 서버**로 하며, 상황판에 넣을 값은 없습니다 — 상황판이 그 서버의 Tailscale 이름을 스스로 알아내 그 이름 하나만, 그리고 서버를 Tailscale 에 올린 계정의 기기에서 온 요청만 받습니다.

1. tailscale.com 에서 계정 만들기 → **2단계 인증 켜기**(이 계정이 서버로 가는 열쇠가 됩니다).
2. 서버에서: `curl -fsSL https://tailscale.com/install.sh | sh` → `sudo tailscale up`(나온 주소를 브라우저로 열어 로그인) → `sudo tailscale serve --bg 8800`(처음이면 HTTPS 를 켜라는 주소가 나옴 — 열어서 허용한 뒤 다시 실행). 이 서버에 nginx 같은 웹서버가 443 을 쓰고 있으면 `sudo tailscale serve --bg --https=8443 8800` 으로 — 443 을 같이 쓰면 웹서버가 다시 켜질 때 «Address already in use» 로 못 켜진다(주소는 `https://<서버>.ts.net:8443`, 상황판이 포트를 스스로 읽음).
3. 휴대폰·노트북에 Tailscale 앱 → 같은 계정으로 로그인 → 켜기.
4. 마지막 명령이 보여 준 `https://….ts.net` 주소를 열고 **«홈 화면에 추가»**. 알림은 새 주소에서 한 번 다시 켭니다.

지키기: 바깥에 공개하는 **`tailscale funnel` 은 켜지 마세요** — 켜져 있으면 상황판이 그 주소를 거절합니다. 기기는 내 것만 등록하고, 잃어버리면 Tailscale 관리 화면에서 그 기기만 지웁니다. SSH 통로 방법은 예비로 그대로 둡니다.

**나중에 이 안내는 어디서?** 상황판 안에 있습니다: 화면 아래 «다른 기기에서 이 화면 열기»(내 서버 주소가 채워져 있음)와, 상황판이 직접 내주는 이 문서 링크(`http://localhost:8800/docs/INSTALL.ko.md`).

## 설치 뒤: 매일 쓰는 법

- 프로젝트 카드의 **«＋ 새 일 시키기»** 에 할 일을 적습니다. 대기열에 들어가 저절로 시작합니다.
- 맨 위 칸이 내가 볼 것입니다. 거기서 바로 답합니다.
- 끝난 방: 열기 → 보고 읽기 → **«✓ 확인 완료»**.
- 알림: 맨 위 **«알림»** → «이 컴퓨터 — 브라우저» 칸의 «켜기»(상황판 탭이 열려 있으면 다른 탭을 보고 있어도 옴) · 휴대폰은 무료 **ntfy** 앱으로 주소 이름을 구독하고 «켜고 저장»(상황판을 안 열어 둬도 옴 — 보내는 글은 솔루션·방 이름·질문 제목 한 줄뿐). 홈 화면에 추가한 상황판 앱이면 «이 앱으로 받기» 가 더 낫습니다 — 상황판 아이콘으로 뜨고, 누르면 그 앱이 열립니다(아이폰 iOS 16.4 이상).
- 터미널: `ssh myserver` 하면 메뉴(`dev`)가 뜹니다. `claude attach <방 번호>` 로 방에 들어가 실시간 대화, `Ctrl+Z` 로 나와도 방은 계속 일합니다.

## 새 판 받기

```bash
cd ~/dev-server && git pull && pm2 restart dev-board && bash kit/verify.sh
```

`board/config.json`·`projects.json`·작업기록·로그는 git 밖이라 새 판을 받아도 그대로입니다.

## 막힐 때

| 증상 | 해결 |
|---|---|
| `Permission denied (publickey)` | 2단계가 안 됨. 서버 `~/.ssh/authorized_keys` 에 내 `.pub` 줄이 있는지, 권한 `~/.ssh` 700 · `authorized_keys` 600 |
| `bind [127.0.0.1]:8800: Address already in use` | 내 컴퓨터에서 8800 을 이미 씀 — 보통 `ssh myserver` 창을 두 번째로 연 것이라 괜찮음(첫 창이 통로를 맡음). 아니면 그 앱을 닫기. 다른 번호로 바꾸지 마세요: 상황판은 `localhost:8800` 만 받고 다른 번호는 403. 바꾸려면 `board/config.json` 의 `"port"` 를 바꾸고 상황판을 다시 켠 뒤 양쪽에 같은 번호 |
| 브라우저 «연결할 수 없음» | SSH 창이 열려 있나? 서버에서 `pm2 status dev-board` · `pm2 logs dev-board --lines 30 --nostream` |
| 브라우저 `403` | 꼭 `http://localhost:8800` 으로(서버 IP 로 열면 일부러 거절) |
| 맨 위 빨강 «AI 연결이 끊겼습니다» / 작업방이 인증 오류로 바로 끝남 | Claude Code 로그인이 만료됐거나 안 됨: [4b단계](#4b단계--ai-연결구독-또는-api-키) |
| 방이 «예/아니오» 창에서 멈춤 | 위 «나만 바꿀 수 있는 설정» · 프로젝트 폴더 «믿겠습니까» 허락 |
| Claude Code 업데이트 뒤 상황판이 비어 보임 | `bash ~/dev-server/kit/verify.sh`. ✘ 줄을 Issue 로 알려 주세요 |

그래도 막히면 **[설치 의뢰](https://care.wor-pro.com/inquiry.php?utm_source=github&utm_medium=docs&utm_campaign=server-board&lang=ko&plan=setup&src=install-trouble)**: 호스팅 업체와 막힌 단계를 적어 주세요.

## 지우기

```bash
pm2 delete dev-board && pm2 save
rm -rf ~/dev-server ~/bin/dev            # ~/.bashrc 끝의 «dev 메뉴» 블록도 지우기
```
프로젝트와 `~/.claude` 는 그대로입니다(원하면 `~/.claude/CLAUDE.md` 의 공용 규칙 절을 지웁니다).
