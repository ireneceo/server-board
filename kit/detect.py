#!/usr/bin/env python3
"""서버 살펴보기 (읽기만) — 설치 전에 이 서버 환경을 한 번에 조사해 JSON 으로 낸다.

쓰는 곳: docs/AI-SETUP-PROMPT.md 1단계. 설치하는 Claude 가 이 결과로
  board/config.json · projects.json · 각 솔루션 «개발 명령 설정» 절의 초안을 만든다.
사용: python3 -I ~/dev-server/kit/detect.py            → JSON (stdout)
      python3 -I ~/dev-server/kit/detect.py --summary  → 사람이 읽는 요약
아무것도 고치지 않는다 · sudo 를 쓰지 않는다 · 바깥 인터넷에 묻지 않는다.
"""
import glob, json, os, re, shutil, socket, subprocess, sys

HOME = os.path.expanduser('~')


def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def ver(cmd):
    out = run(cmd)
    return out.splitlines()[0].strip() if out else None


def read(p, limit=200000):
    try:
        with open(p, encoding='utf-8', errors='replace') as f:
            return f.read(limit)
    except Exception:
        return None


def system():
    mem = read('/proc/meminfo') or ''
    m = re.search(r'MemTotal:\s+(\d+)', mem)
    du = shutil.disk_usage(HOME)
    tz = run(['timedatectl', 'show', '-p', 'Timezone', '--value']) or (read('/etc/timezone') or '').strip() or None
    ips = (run(['hostname', '-I']) or '').split()
    return {
        'hostname': socket.gethostname(), 'user': os.environ.get('USER') or run(['whoami']), 'home': HOME,
        'os': (re.search(r'PRETTY_NAME="([^"]+)"', read('/etc/os-release') or '') or [None, None])[1],
        'cpus': os.cpu_count(), 'memGB': round(int(m.group(1)) / 1048576, 1) if m else None,
        'diskFreeGB': round(du.free / 1e9, 1), 'serverTimezone': tz,
        'ips': [i for i in ips if ':' not in i],
    }


def tools():
    t = {
        'node': ver(['node', '-v']), 'npm': ver(['npm', '-v']), 'pm2': ver(['pm2', '-v']),
        'python3': ver(['python3', '--version']), 'git': ver(['git', '--version']), 'claude': ver(['claude', '--version']),
        'curl': bool(shutil.which('curl')), 'ss': bool(shutil.which('ss')),
    }
    n = re.match(r'v(\d+)', t['node'] or '')
    t['nodeOk'] = bool(n and int(n.group(1)) >= 18)
    # 상황판이 기대는 Claude Code 기능 — 업데이트로 바뀌면 여기서 먼저 걸린다
    agents = run(['claude', 'agents', '--json', '--all'], timeout=30)
    c = {'agentsJson': False, 'agentsFields': None, 'jobsDir': os.path.isdir(os.path.join(HOME, '.claude', 'jobs')),
         'transcriptsDir': os.path.isdir(os.path.join(HOME, '.claude', 'projects')), 'loggedIn': None}
    try:
        arr = json.loads(agents) if agents else None
        if isinstance(arr, list):
            c['agentsJson'] = True
            c['agentCount'] = len(arr)
            if arr:
                need = ['id', 'cwd', 'sessionId', 'status', 'name']
                c['agentsFields'] = {k: any(k in a for a in arr) for k in need}
    except Exception:
        pass
    creds = os.path.join(HOME, '.claude', '.credentials.json')
    c['loggedIn'] = os.path.exists(creds) or bool(os.environ.get('ANTHROPIC_API_KEY')) or None
    s = read(os.path.join(HOME, '.claude', 'settings.json'))
    try:
        sj = json.loads(s) if s else {}
    except Exception:
        sj = {}
    c['defaultMode'] = (sj.get('permissions') or {}).get('defaultMode')
    c['bgIsolation'] = (sj.get('worktree') or {}).get('bgIsolation')
    c['globalClaudeMd'] = os.path.exists(os.path.join(HOME, '.claude', 'CLAUDE.md'))
    t['claudeCode'] = c
    return t


def ports():
    out = run(['ss', '-ltnH']) or ''
    used = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4:
            m = re.search(r':(\d+)$', parts[3])
            if m:
                used.add(int(m.group(1)))
    board = next((p for p in [8800, 8801, 8802, 8810, 8820, 8890] if p not in used), None)
    return {'listening': sorted(used), 'boardPortSuggest': board, 'port8800Free': 8800 not in used}


def pm2():
    out = run(['pm2', 'jlist'], timeout=20)
    try:
        arr = json.loads(out) if out else []
    except Exception:
        arr = []
    res = []
    for p in arr:
        env = p.get('pm2_env') or {}
        res.append({'name': p.get('name'), 'cwd': env.get('pm_cwd'), 'script': env.get('pm_exec_path'),
                    'status': env.get('status'), 'port': (env.get('env') or {}).get('PORT') or env.get('PORT'),
                    'memMB': ((p.get('monit') or {}).get('memory') or 0) // 1048576})
    return res


def nginx_sites():
    """nginx 설정을 읽을 수 있으면 server_name ↔ root/proxy 포트 (읽기만, 못 읽으면 빈 목록)"""
    sites = []
    for f in glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf'):
        txt = read(f)
        if not txt:
            continue
        for block in re.split(r'\n\s*server\s*\{', txt):
            names = re.findall(r'server_name\s+([^;]+);', block)
            if not names:
                continue
            ssl = bool(re.search(r'listen\s+[^;]*443', block))
            sites.append({'file': f, 'names': [n for n in names[0].split() if n != '_'],
                          'roots': re.findall(r'\broot\s+([^;]+);', block),
                          'proxyPorts': sorted({int(x) for x in re.findall(r'proxy_pass\s+https?://(?:127\.0\.0\.1|localhost):(\d+)', block)}),
                          'https': ssl})
    return sites


FRAMEWORKS = [('next', 'Next.js'), ('vite', 'Vite'), ('react-scripts', 'CRA'), ('@nestjs/core', 'NestJS'),
              ('express', 'Express'), ('fastify', 'Fastify'), ('nuxt', 'Nuxt'), ('vue', 'Vue'), ('@angular/core', 'Angular'),
              ('sequelize', 'Sequelize'), ('prisma', 'Prisma'), ('mongoose', 'Mongoose'), ('expo', 'Expo'), ('react-native', 'React Native')]


def pkg_info(d):
    """폴더와 바로 아래 한 단계(frontend/ backend/ 등)의 package.json — 빌드·시작 명령 후보"""
    out = []
    for pj in [os.path.join(d, 'package.json')] + sorted(glob.glob(os.path.join(d, '*', 'package.json'))):
        if '/node_modules/' in pj:
            continue
        try:
            j = json.loads(read(pj) or '{}')
        except Exception:
            continue
        deps = {**(j.get('dependencies') or {}), **(j.get('devDependencies') or {})}
        sc = j.get('scripts') or {}
        out.append({'dir': os.path.relpath(os.path.dirname(pj), d), 'name': j.get('name'),
                    'frameworks': [label for k, label in FRAMEWORKS if k in deps],
                    'scripts': {k: sc[k] for k in ['build', 'start', 'dev', 'test', 'lint'] if k in sc}})
    return out


def candidates(pm2list, sites):
    roots = ['/var/www', '/srv'] + sorted(glob.glob('/opt/*')) + sorted(glob.glob(os.path.join(HOME, '*')))
    seen, res = set(), []
    for r in roots:
        if not os.path.isdir(r) or os.path.basename(r).startswith('.'):
            continue
        for d in [r] + sorted(glob.glob(os.path.join(r, '*'))):
            d = os.path.realpath(d)
            if d in seen or not os.path.isdir(d) or '/node_modules' in d:
                continue
            is_git = os.path.isdir(os.path.join(d, '.git'))
            has_pkg = os.path.exists(os.path.join(d, 'package.json'))
            others = [f for f in ['composer.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Gemfile'] if os.path.exists(os.path.join(d, f))]
            if not (is_git or has_pkg or others):
                continue
            # 상위 폴더가 이미 후보면 그 안의 하위 폴더는 건너뜀(frontend/backend 는 pkg_info 가 본다)
            if any(d.startswith(x + '/') for x in seen):
                continue
            seen.add(d)
            cmds_dir = os.path.join(d, '.claude', 'commands')
            states = [p for p in ['.claude/session-state.md', 'session-state.md', 'SESSION_STATE.md'] if os.path.exists(os.path.join(d, p))]
            procs = [p for p in pm2list if p.get('cwd') and (p['cwd'] == d or p['cwd'].startswith(d + '/'))]
            pports = {int(p['port']) for p in procs if str(p.get('port') or '').isdigit()}
            urls = []
            for s in sites:
                if any(rt == d or rt.startswith(d + '/') for rt in s['roots']) or (pports & set(s['proxyPorts'])):
                    urls += [('https://' if s['https'] else 'http://') + n for n in s['names']]
            branch = run(['git', '-C', d, 'rev-parse', '--abbrev-ref', 'HEAD']) if is_git else None
            res.append({
                'dir': d, 'suggestKey': re.sub(r'[^a-z0-9]+', '-', os.path.basename(d).lower()).strip('-') or 'app',
                'git': is_git, 'branch': branch,
                'claudeMd': os.path.exists(os.path.join(d, 'CLAUDE.md')), 'stateFiles': states,
                'commands': sorted(os.path.splitext(os.path.basename(f))[0] for f in glob.glob(os.path.join(cmds_dir, '*.md'))),
                'packages': pkg_info(d), 'otherStacks': others,
                'pm2': [{'name': p['name'], 'status': p['status'], 'port': p.get('port')} for p in procs],
                'urls': sorted(set(urls)),
                'deployScripts': sorted(os.path.relpath(f, d) for f in glob.glob(os.path.join(d, 'scripts', '*deploy*')) + glob.glob(os.path.join(d, 'deploy*.sh'))),
            })
    return res


def crontab():
    out = run(['crontab', '-l']) or ''
    return [l for l in out.splitlines() if l.strip() and not l.lstrip().startswith('#')]


def main():
    pm = pm2()
    sites = nginx_sites()
    data = {'system': system(), 'tools': tools(), 'ports': ports(), 'pm2': pm, 'nginx': {'readable': bool(sites), 'sites': sites},
            'solutions': candidates(pm, sites), 'crontab': crontab(),
            'existing': {'devServer': os.path.isdir(os.path.join(HOME, 'dev-server')), 'binDev': os.path.exists(os.path.join(HOME, 'bin', 'dev')),
                         'boardConfig': os.path.exists(os.path.join(HOME, 'dev-server', 'board', 'config.json'))}}
    if '--summary' not in sys.argv:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    s, t, c = data['system'], data['tools'], data['tools']['claudeCode']
    ok = lambda b: '✔' if b else '✘'
    try: K = json.load(open(os.path.join(HOME, 'dev-server', 'board', 'config.json'))).get('lang') == 'ko'
    except Exception: K = False
    if not K:
        x0 = data['solutions']
        print(f"Server {s['hostname']} · {s['user']} · {s['os']} · CPU {s['cpus']} · memory {s['memGB']}GB · free disk {s['diskFreeGB']}GB · server timezone {s['serverTimezone']} · IP {', '.join(s['ips'])}")
        print(f"Tools: node {t['node']} {ok(t['nodeOk'])} · pm2 {t['pm2'] or '✘ missing'} · python3 {ok(t['python3'])} · git {ok(t['git'])} · claude {t['claude'] or '✘ missing'}")
        print(f"Claude Code: room list JSON {ok(c['agentsJson'])} · jobs folder {ok(c['jobsDir'])} · transcripts folder {ok(c['transcriptsDir'])} · permission mode {c['defaultMode'] or '(not set — owner sets auto)'} · bgIsolation {c['bgIsolation'] or '(not set — owner sets none)'}")
        print(f"Suggested board port {data['ports']['boardPortSuggest']} (8800 free {ok(data['ports']['port8800Free'])}) · nginx readable {ok(data['nginx']['readable'])}")
        print('Project candidates:')
        for x in x0:
            fw = sorted({f for p in x['packages'] for f in p['frameworks']} | set(x['otherStacks']))
            print(f"  - {x['dir']}  key={x['suggestKey']} · git {ok(x['git'])} · CLAUDE.md {ok(x['claudeMd'])} · notes {x['stateFiles'] or 'none'}"
                  f" · commands {x['commands'] or 'none'} · {'/'.join(fw) or 'stack unknown'} · PM2 {[p['name'] for p in x['pm2']] or 'none'} · URLs {x['urls'] or 'unknown'}")
        return
    print(f"서버 {s['hostname']} · {s['user']} · {s['os']} · CPU {s['cpus']} · 메모리 {s['memGB']}GB · 빈 디스크 {s['diskFreeGB']}GB · 서버 시간대 {s['serverTimezone']} · IP {', '.join(s['ips'])}")
    print(f"도구: node {t['node']} {ok(t['nodeOk'])} · pm2 {t['pm2'] or '✘ 없음'} · python3 {ok(t['python3'])} · git {ok(t['git'])} · claude {t['claude'] or '✘ 없음'}")
    print(f"Claude Code: 방 목록 JSON {ok(c['agentsJson'])} · jobs 폴더 {ok(c['jobsDir'])} · 대화 기록 폴더 {ok(c['transcriptsDir'])} · 권한 모드 {c['defaultMode'] or '(없음 — 주인이 auto 로)'} · 원본 폴더 작업 {c['bgIsolation'] or '(없음 — 주인이 none 으로)'}")
    print(f"상황판 포트 권고 {data['ports']['boardPortSuggest']} (8800 비어 있음 {ok(data['ports']['port8800Free'])}) · nginx 읽기 {ok(data['nginx']['readable'])}")
    print('솔루션 후보:')
    for x in data['solutions']:
        fw = sorted({f for p in x['packages'] for f in p['frameworks']} | set(x['otherStacks']))
        print(f"  - {x['dir']}  key={x['suggestKey']} · git {ok(x['git'])} · CLAUDE.md {ok(x['claudeMd'])} · 작업기록 {x['stateFiles'] or '없음'}"
              f" · 명령 {x['commands'] or '없음'} · {'/'.join(fw) or '스택 모름'} · PM2 {[p['name'] for p in x['pm2']] or '없음'} · 주소 {x['urls'] or '모름'}")


if __name__ == '__main__':
    main()
