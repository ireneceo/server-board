// 운영 배포 연결 설정 — «연결 안 됨» 솔루션에 배포 스크립트 한 줄을 주인만 연결·끊기
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const proj = path.join(sb.root, 'proj');
const PJ = path.join(sb.home, 'dev-server', 'projects.json');
const g = (...a) => execFileSync('git', ['-C', proj, ...a], { stdio: 'pipe' });
fs.mkdirSync(path.join(proj, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(proj, 'scripts', 'deploy.sh'), '#!/bin/sh\necho deploy "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(proj, 'loose-deploy.sh'), '#!/bin/sh\necho x\n', { mode: 0o755 });
g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'scripts/deploy.sh'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');

function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const port = board.server.address().port;
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { let j = {}; try { j = JSON.parse(d || '{}'); } catch (_) {} ok({ code: r.statusCode, j }); }); });
    pr.on('error', no); pr.end(body ? JSON.stringify(body) : undefined);
  });
}

test('연결 설정 — 주인만 · 검사 · 연결하면 승인 · 끊기 · 배포 중엔 못 바꿈', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  try {
    const U = '/api/projects/demo/deploy-setup';
    // 작업방(AI)은 읽기·쓰기 모두 못 함
    assert.equal((await call('POST', U, 'agent', { command: './scripts/deploy.sh --auto' })).code, 403, 'AI 방 쓰기 403');
    assert.equal((await call('GET', '/api/deploy-setup?p=demo', 'agent')).code, 403, 'AI 방 읽기 403');
    assert.equal(JSON.parse(fs.readFileSync(PJ, 'utf8'))[0].deploy, undefined, 'AI 시도 뒤에도 그대로');
    // 주인 읽기 — 연결 안 됨 · 후보(git 에 있는 것만)
    let r = await call('GET', '/api/deploy-setup?p=demo', 'terminal');
    assert.equal(r.code, 200); assert.equal(r.j.connected, false);
    assert.deepEqual(r.j.candidates.map((c) => c.path), ['./scripts/deploy.sh'], 'git 에 없는 loose-deploy.sh 는 후보 아님');
    // 화면 묶음: 연결 안 됨이면 prodLabel 없음·runner 없음
    let bp = (await board.buildBoard()).projects.find((p) => p.key === 'demo');
    assert.equal(bp.prodLabel, null); assert.equal(bp.runner, null);
    // 검사
    assert.equal((await call('POST', U, 'terminal', { command: '' })).code, 400, '빈 명령');
    assert.equal((await call('POST', U, 'terminal', { command: './scripts/deploy.sh --force' })).code, 400, '허용 안 된 인자');
    assert.equal((await call('POST', U, 'terminal', { command: './scripts/deploy.sh --auto; rm -rf /' })).code, 400, '셸 기호');
    assert.equal((await call('POST', U, 'terminal', { command: '../outside.sh' })).code, 400, '폴더 밖');
    r = await call('POST', U, 'terminal', { command: './loose-deploy.sh' });
    assert.equal(r.code, 400); assert.match(r.j.message, /커밋/, '커밋 안 된 스크립트');
    assert.equal((await call('POST', U, 'terminal', { command: './scripts/deploy.sh --auto', markerUrl: 'http://x.example/v.json' })).code, 400, 'https 아닌 확인 주소');
    assert.equal((await call('POST', U, 'terminal', { command: './scripts/deploy.sh --auto', dryRun: '--auto' })).code, 400, '시험 인자에 --dry-run 없음');
    // 연결
    r = await call('POST', U, 'terminal', { prodLabel: 'Demo 운영', command: './scripts/deploy.sh  --auto', dryRun: '--auto --dry-run', markerUrl: 'https://demo.example/version.json', markerJson: 'built_at' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const p1 = JSON.parse(fs.readFileSync(PJ, 'utf8'))[0];
    assert.equal(p1.prodLabel, 'Demo 운영');
    assert.deepEqual(p1.deploy, { command: './scripts/deploy.sh --auto', dryRun: '--auto --dry-run' });
    assert.deepEqual(p1.prodMarker, { url: 'https://demo.example/version.json', json: 'built_at' });
    assert.equal(board.runner.summary(p1).approved, true, '넣은 명령이 승인됨');
    const logs = fs.readdirSync(path.join(sb.dir, 'log')).filter((f) => /\.log$/.test(f)).map((f) => fs.readFileSync(path.join(sb.dir, 'log', f), 'utf8')).join('\n');
    assert.match(logs, /"deploy-setup"/); assert.match(logs, /"deploy-approve"/);
    assert.ok(fs.readdirSync(path.join(sb.dir, 'log')).some((f) => /^projects-.*\.json$/.test(f)), '옛 projects.json 을 남김');
    board.resetAgentsCache();
    bp = (await board.buildBoard()).projects.find((p) => p.key === 'demo');
    assert.equal(bp.prodLabel, 'Demo 운영'); assert.equal(bp.runner.approved, true);
    // 손으로 명령을 바꾸면 다시 승인 전엔 안 돔(기존 규칙 그대로)
    const pj = JSON.parse(fs.readFileSync(PJ, 'utf8')); pj[0].deploy.command = './scripts/deploy.sh --routine'; fs.writeFileSync(PJ, JSON.stringify(pj));
    assert.equal(board.runner.summary(pj[0]).approved, false);
    // 준비 방·메모리 기다림(일시정지에 runnerPending)도 못 바꿈 (Fable ①)
    const sp = board.loadState(); sp.paused.demo = { gate: 'deploy', runnerPending: true, at: new Date().toISOString() }; board.saveState(sp);
    assert.equal((await call('POST', U, 'terminal', { command: './scripts/deploy.sh --auto' })).code, 409, '준비 중');
    const sp2 = board.loadState(); delete sp2.paused.demo; board.saveState(sp2);
    // 명령이 바뀌면 «첫 실행은 버튼» 다시 (Fable ②)
    const sh = board.loadState(); sh.deployScriptHash = { demo: 'x' }; board.saveState(sh);
    assert.equal((await call('POST', U, 'terminal', { prodLabel: 'Demo 운영', command: './scripts/deploy.sh --routine' })).code, 200);
    assert.equal((board.loadState().deployScriptHash || {}).demo, undefined, '명령 바뀌면 정기 점검 준비 지움');
    // 배포 중이면 못 바꿈
    const st = board.loadState(); st.deployRuns = { demo: { result: 'running', at: new Date().toISOString() } }; board.saveState(st);
    assert.equal((await call('POST', U, 'terminal', { off: true })).code, 409);
    const st2 = board.loadState(); delete st2.deployRuns.demo; board.saveState(st2);
    // 끊기
    r = await call('POST', U, 'terminal', { off: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const p2 = JSON.parse(fs.readFileSync(PJ, 'utf8'))[0];
    assert.equal(p2.prodLabel, null); assert.equal(p2.deploy, undefined); assert.equal(p2.prodMarker, undefined);
    assert.equal(p2.dir, proj, '다른 칸은 그대로');
    // 끊으면 승인도 거둠 — 같은 칸이 손으로 돌아와도 승인 안 된 것 (Fable ③)
    assert.equal((board.loadState().deployApproved || {}).demo, undefined);
    const back = Object.assign({}, p2, { prodLabel: 'Demo 운영', deploy: { command: './scripts/deploy.sh --routine' } });
    assert.equal(board.runner.summary(back).approved, false, '끊은 뒤 같은 명령도 승인 전');
    const ch = await board.runner.check(back, { via: 'button' });
    assert.equal(ch.find((x) => x.code === 'approved').ok, false, '기록 줄로도 승인 안 됨');
    // 폴더 밖을 가리키는 링크 · stage 만 한 스크립트 거절
    fs.writeFileSync(path.join(sb.root, 'outside.sh'), '#!/bin/sh\n', { mode: 0o755 });
    fs.symlinkSync(path.join(sb.root, 'outside.sh'), path.join(proj, 'link-deploy.sh'));
    fs.writeFileSync(path.join(proj, 'staged-deploy.sh'), '#!/bin/sh\n', { mode: 0o755 });
    g('add', 'link-deploy.sh', 'staged-deploy.sh');
    r = await call('POST', U, 'terminal', { command: './link-deploy.sh' }); assert.equal(r.code, 400); assert.match(r.j.message, /링크/);
    r = await call('POST', U, 'terminal', { command: './staged-deploy.sh' }); assert.equal(r.code, 400); assert.match(r.j.message, /커밋/);
    // 폴더 안 링크(커밋된 링크 → 커밋 안 된 파일)도 거절 — 가리키는 파일이 커밋 없이 바뀔 수 있음
    fs.writeFileSync(path.join(proj, 'untracked.sh'), '#!/bin/sh\n', { mode: 0o755 });
    fs.symlinkSync('untracked.sh', path.join(proj, 'inlink-deploy.sh'));
    g('add', 'inlink-deploy.sh'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'link');
    r = await call('POST', U, 'terminal', { command: './inlink-deploy.sh' }); assert.equal(r.code, 400); assert.match(r.j.message, /링크/);
    // 팀원은 못 씀
    const pm = await board.permit({ role: 'member', user: 'mem', name: '팀원', projects: ['demo'] }, U, { command: './scripts/deploy.sh --auto' });
    assert.equal(pm && pm[0], 403, '팀원 403');
    // server 항목은 연결 대상 아님
    assert.equal((await call('GET', '/api/deploy-setup?p=server', 'terminal')).code, 404);
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});
