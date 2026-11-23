'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const B = path.join(__dirname, '..');
const acct = require(path.join(B, 'account.js'));
const RUN_AS = path.join(B, '..', 'kit', 'account-split', 'run-as');

test('통로 밖에서 child_process 를 부르는 곳 0', () => {
  const allow = new Set(['account.js', 'update-runner.js']);
  const hits = [];
  for (const f of fs.readdirSync(B).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(B, f), 'utf8');
    if (/require\(\s*['"](node:)?child_process['"]\s*\)/.test(src) && !allow.has(f)) hits.push(f);
    // update-runner.js 는 «self» 만 — 다른 계정 일(claude·git -C 솔루션·배포)을 부르면 안 됨
    if (f === 'update-runner.js') assert.doesNotMatch(src, /claudeBin|['"]claude['"]|deploy-runner|ssh['"]/, 'update-runner 는 상황판 자기 일만');
  }
  assert.deepStrictEqual(hits, []);
  // server.js 에 맨 execFile(/spawn( 이 남지 않음 — 모두 execFileAs·acct.*
  const s = fs.readFileSync(path.join(B, 'server.js'), 'utf8').split('\n')
    .filter((l) => /(^|[^.\w])(execFile|execFileSync|spawn|rawExecFile)\s*\(/.test(l) && !/function execFileAs|execFileAs\(|acct\.(execFile|execFileSync|spawn)\(/.test(l));
  assert.deepStrictEqual(s, []);
});

test('같은 계정이면 그대로 — 지금 서버(통로 대상 = 자기 자신)', () => {
  const t = acct.build({}, {}, 'owner');
  assert.strictEqual(t.SPLIT, false);
  for (const v of acct.VERBS) assert.strictEqual(t.runAs[v], 'owner');
  const p = acct.plan('git', 'git', ['status'], { cwd: '/x', env: { A: '1' } }, t);
  assert.deepStrictEqual(p, { file: 'git', args: ['status'], opts: { cwd: '/x', env: { A: '1' } }, as: 'owner', via: false });
  assert.strictEqual(acct.plan('self', 'ss', [], {}, t).via, false);
});

test('다른 계정이면 sudo → run-as · 비밀 환경은 안 넘김 · 모르는 일은 거절', () => {
  const t = acct.build({ ownerAccount: 'owner', runAs: { claude: 'ai' } }, { SB_WORK_HOME: '/home/owner' }, 'board');
  assert.strictEqual(t.SPLIT, true);
  assert.strictEqual(t.OWNER_ACCOUNT, 'owner');
  assert.strictEqual(t.runAs.git, 'owner');
  assert.strictEqual(t.runAs.claude, 'ai');   // 2단계 — 값만 바꿈
  assert.strictEqual(t.runAs.self, 'board');
  assert.strictEqual(t.WORK_HOME, '/home/owner');
  const p = acct.plan('git', 'git', ['-C', '/opt/x', 'log'], { cwd: '/opt/x', timeout: 5, env: { PATH: '/p', GIT_TERMINAL_PROMPT: '0', CLAUDE_CODE_OAUTH_TOKEN: 'sk-secret', MY_API_KEY: 'k', HOME: '/h', ONLY: 'a\nb' } }, t);
  assert.strictEqual(p.file, '/usr/bin/sudo');
  assert.deepStrictEqual(p.args, ['-n', '-u', 'owner', '/usr/local/lib/server-board/run-as', 'git', '--cwd', '/opt/x',
    '--env', 'GIT_TERMINAL_PROMPT=0', '--env', 'PATH=/p', '--', 'git', '-C', '/opt/x', 'log']);
  assert.strictEqual(p.opts.cwd, '/');
  assert.strictEqual(p.opts.timeout, 5);
  assert.ok(!JSON.stringify(p).includes('sk-secret'));
  assert.ok(!JSON.stringify(p.opts.env).includes('/h'));
  assert.strictEqual(acct.plan('self', 'node', ['--test'], {}, t).via, false);
  assert.throws(() => acct.plan('rm', 'rm', ['-rf', '/'], {}, t), /unknown verb/);
  // 이상한 계정 이름은 무시 → 주인 계정
  assert.strictEqual(acct.build({ ownerAccount: 'Bad Name;', runAs: { git: '../x' } }, {}, 'board').runAs.git, 'board');
});

const ra = (args, env) => cp.spawnSync('bash', [RUN_AS].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, { RUN_AS_LIB: B }, env || {}), cwd: '/' });

test('run-as — 허락된 것만 실행', { skip: !fs.existsSync(RUN_AS) && 'kit/account-split 없음(공개판)' }, () => {
  let r = ra(['git', '--', 'git', '--version']); assert.strictEqual(r.status, 0, r.stderr); assert.match(r.stdout, /git version/);
  r = ra(['git', '--cwd', B, '--env', 'GIT_TERMINAL_PROMPT=0', '--', 'git', 'rev-parse', '--is-inside-work-tree']); assert.strictEqual(r.status, 0, r.stderr); assert.match(r.stdout, /true/);
  r = ra(['deploy', '--', '/bin/sh', '-c', 'echo $HOME; echo ${CLAUDE_CODE_OAUTH_TOKEN:-none}']); assert.strictEqual(r.status, 0, r.stderr);
  r = ra(['peer', '--', 'proc-peek', 'procs']); assert.strictEqual(r.status, 0, r.stderr); assert.ok(Array.isArray(JSON.parse(r.stdout)));
  for (const bad of [
    ['nope', '--', 'id'], ['git', '--', 'rm', '-rf', '/x'], ['crontab', '--', 'crontab', '-r'], ['deploy', '--', '/bin/bash', '-c', 'id'],
    ['tailscale', '--', 'tailscale', 'up'], ['tailscale', '--', 'tailscale', 'serve', 'reset'], ['check', '--', '/tmp/morning-check.sh'],
    ['peer', '--', 'proc-peek', 'sock;id'], ['peer', '--', 'node', '-e', '1'],
    ['git', '--env', 'CLAUDE_CODE_OAUTH_TOKEN=x', '--', 'git', '--version'], ['git', '--env', 'LD_PRELOAD=/x.so', '--', 'git', '--version'],
    ['git', '--env', 'GIT_SECRET_KEY=1', '--', 'git', '--version'], ['git', '--bogus', '--', 'git'], ['git', '--cwd', '/nonexistent-dir', '--', 'git', '--version'],
  ]) { r = ra(bad); assert.strictEqual(r.status, 126, 'should refuse: ' + bad.join(' ') + ' → ' + r.stdout + r.stderr); }
});

test('run-as — 환경은 새로(HOME·PATH 는 그 계정 것, 넘긴 PATH 는 뒤에만)', { skip: !fs.existsSync(RUN_AS) && 'kit/account-split 없음(공개판)' }, () => {
  const r = ra(['deploy', '--env', 'PATH=/evil', '--env', 'DEPLOY_BY=t', '--', '/bin/sh', '-c', 'echo "$HOME|$PATH|$DEPLOY_BY|${SECRET_X:-none}"'], { SECRET_X: 'leak' });
  assert.strictEqual(r.status, 0, r.stderr);
  const [home, p, by, sec] = r.stdout.trim().split('|');
  assert.strictEqual(home, require('os').userInfo().homedir);
  assert.ok(p.endsWith(':/evil') && !p.startsWith('/evil'), p);
  assert.strictEqual(by, 't');
  assert.strictEqual(sec, 'none');   // 부른 쪽 환경은 안 샘
});

test('통로로 실제 실행 — 같은 계정(지금 서버)', async () => {
  const out = await new Promise((res) => acct.execFile('git', 'git', ['--version'], { timeout: 10000 }, (e, o) => res(e ? 'ERR ' + e.message : String(o))));
  assert.match(out, /git version/);
  assert.match(String(acct.execFileSync('self', process.execPath, ['-e', 'process.stdout.write("ok")'])), /^ok$/);
  const ch = acct.spawn('self', process.execPath, ['-e', 'process.stdout.write("sp")']);
  const got = await new Promise((res) => { let s = ''; ch.stdout.on('data', (d) => { s += d; }); ch.on('close', () => res(s)); });
  assert.strictEqual(got, 'sp');
});

test('proc-peek — 명령 줄 인자 검사', () => {
  const pk = path.join(B, 'proc-peek.js');
  let r = cp.spawnSync(process.execPath, [pk, 'sock', '1'], { encoding: 'utf8' }); assert.strictEqual(r.status, 0); assert.match(r.stdout, /^(terminal|agent|tunnel)\n$/);
  r = cp.spawnSync(process.execPath, [pk, 'kill', 'TERM', String(process.pid)], { encoding: 'utf8' }); assert.strictEqual(r.status, 0); assert.deepStrictEqual(JSON.parse(r.stdout), []);   // 방이 띄운 명령이 아니면 안 끔
  r = cp.spawnSync(process.execPath, [pk, 'kill', 'HUP', '1'], { encoding: 'utf8' }); assert.strictEqual(r.status, 2);
  r = cp.spawnSync(process.execPath, [pk, 'sock', 'x'], { encoding: 'utf8' }); assert.strictEqual(r.status, 2);
});
