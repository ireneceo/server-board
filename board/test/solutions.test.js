'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());
const PJ = path.join(sb.home, 'dev-server', 'projects.json');
const CF = path.join(sb.dir, 'config.json');
const readPJ = () => JSON.parse(fs.readFileSync(PJ, 'utf8'));

function call(method, p, sock, body) {
  return new Promise((ok, no) => {
    const port = board.server.address().port;
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' } },
      (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { let j = {}; try { j = JSON.parse(d || '{}'); } catch (_) {} ok({ code: r.statusCode, j }); }); });
    pr.on('error', no); pr.end(body ? JSON.stringify(body) : undefined);
  });
}
const add = (b) => call('POST', '/api/solutions/add', 'terminal', b);

test('솔루션 넣기·검사·고치기·준비·빼기', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  try {
    // AI 방은 읽기·쓰기 못 함
    assert.equal((await call('GET', '/api/solutions', 'agent')).code, 403);
    assert.equal((await call('POST', '/api/solutions/add', 'agent', { key: 'shop', name: 'Shop', dir: path.join(sb.home, 'shop'), create: true })).code, 403);
    assert.equal(readPJ().length, 1, 'AI 시도 뒤 그대로');

    // 거절 사례
    const realDir = path.join(sb.root, 'real'); fs.mkdirSync(realDir);
    fs.symlinkSync('/etc', path.join(sb.home, 'etclink'));
    fs.mkdirSync(path.join(sb.home, '.ssh'), { recursive: true });
    fs.mkdirSync(path.join(sb.root, 'proj', 'sub'), { recursive: true });
    const bad = [
      ['/', 'root'], ['/etc', 'etc'], ['/etc/nginx', 'inside etc'], [sb.home, 'home'], [path.dirname(sb.home), 'home 위'],
      [path.join(sb.home, '.ssh'), '숨김'], [path.join(sb.home, 'etclink'), '링크→/etc'], [path.join(sb.root, 'proj', 'sub'), '겹침(아래)'],
      [sb.root, '겹침(위)'], [sb.home + '/a/../b', '..'], ['relative/dir', '상대'], [path.join(sb.home, 'has space'), '빈칸'],
      [path.join(sb.home, 'dev-server'), '상황판 폴더'], ['/home/someoneelse/app', '다른 사람 홈'],
    ];
    for (const [d, why] of bad) {
      const r = await add({ key: 'x' + Math.random().toString(36).slice(2, 6), name: 'X ' + why, dir: d, create: true });
      assert.ok(r.code === 400 || r.code === 409 && r.j.code !== 'MISSING', why + ' 거절: ' + r.code + ' ' + JSON.stringify(r.j));
      assert.notEqual(r.j.ok, true, why);
    }
    // 링크를 따라간 실제 이름에 붙여 넣는 줄을 깨는 글자가 있으면 거절(Fable 완료 ①)
    const weird = path.join(sb.home, 'a b;x'); fs.mkdirSync(weird); fs.symlinkSync(weird, path.join(sb.home, 'lnk'));
    for (const d of [path.join(sb.home, 'lnk'), path.join(sb.home, 'lnk', 'new')]) {
      const rr = await add({ key: 'lnk', name: 'Lnk', dir: d, create: true });
      assert.equal(rr.code, 400, d + ' ' + JSON.stringify(rr.j)); assert.equal(rr.j.cmd, undefined, 'sudo 줄 안 줌');
    }
    assert.equal(fs.existsSync(path.join(weird, 'new')), false);
    assert.equal((await add({ key: 'server', name: 'S2', dir: realDir })).code, 400, 'server 키');
    assert.equal((await add({ key: 'Bad Key', name: 'S2', dir: realDir })).code, 400, '키 모양');
    assert.equal((await add({ key: 'okk', name: 'a$b', dir: realDir })).code, 400, '이름 금지 글자');
    assert.equal((await add({ key: 'okk', name: 'ok', dir: realDir, devUrl: 'javascript:alert(1)' })).code, 400, '주소');
    assert.equal(readPJ().length, 1, '거절 뒤 그대로');

    // 없는 폴더 — 먼저 묻고(MISSING) create 면 만듦
    const newDir = path.join(sb.home, 'shop');
    let r = await add({ key: 'shop', name: 'Shop', dir: newDir });
    assert.equal(r.code, 409); assert.equal(r.j.code, 'MISSING');
    r = await add({ key: 'shop', name: 'Shop', dir: newDir, create: true, devUrl: 'https://dev.shop.example', note: 'online store' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.ok(fs.statSync(newDir).isDirectory());
    let all = readPJ();
    assert.deepEqual(all.map((p) => p.key).sort(), ['demo', 'shop']);
    const ent = all.find((p) => p.key === 'shop');
    assert.equal(ent.dir, fs.realpathSync(newDir)); assert.equal(ent.dirReal, ent.dir); assert.equal(ent.addedBy, 'board');
    assert.equal('noDevDone' in ent, false, '계산값은 파일에 안 씀');
    // 개발완료 버튼은 명령 파일이 생기면 저절로
    assert.equal(board.loadProjects().find((p) => p.key === 'shop').noDevDone, true);
    fs.mkdirSync(path.join(newDir, '.claude', 'commands'), { recursive: true }); fs.writeFileSync(path.join(newDir, '.claude', 'commands', '개발완료.md'), 'x');
    assert.equal(board.loadProjects().find((p) => p.key === 'shop').noDevDone, false);
    assert.equal((await add({ key: 'shop', name: 'Shop2', dir: realDir })).code, 400, '같은 키');
    assert.equal((await add({ key: 'shop2', name: 'shop', dir: realDir })).code, 400, '같은 이름');
    assert.equal((await add({ key: 'shopsub', name: 'Sub', dir: path.join(newDir, '.claude') })).code, 400, '넣은 솔루션 안');

    // 목록 · 확정 표시
    r = await call('GET', '/api/solutions', 'terminal');
    assert.equal(r.code, 200);
    const v = r.j.list.find((x) => x.key === 'shop');
    assert.equal(v.viaBoard, true); assert.equal(v.trusted, false); assert.equal(v.exists, true);
    assert.match(board.solConfirmedLine(false), /shop=/);
    assert.equal(r.j.list.find((x) => x.key === 'demo').viaBoard, false, '파일로 넣은 것');

    // 고치기 — 이름·주소·설명만(폴더 칸은 무시)
    r = await call('POST', '/api/solutions/edit', 'terminal', { key: 'shop', name: 'Shop Web', devUrl: '', dir: '/etc' });
    assert.equal(r.code, 200);
    all = readPJ(); assert.equal(all.find((p) => p.key === 'shop').name, 'Shop Web'); assert.equal(all.find((p) => p.key === 'shop').dir, ent.dir);

    // 준비 — 폴더 허락 전엔 거절 · 허락 뒤 대기열(상황판 머리말 · 주인 값은 자료로)
    r = await call('POST', '/api/solutions/prep', 'terminal', { key: 'shop' });
    assert.equal(r.code, 409); assert.equal(r.j.code, 'TRUST');
    // 폴더 허락 — 터미널 없이 단추로(작업방 AI 는 못 함) · 다른 칸은 그대로 · 이 폴더 때문에 못 시작한 일은 다시 시도
    assert.equal((await call('POST', '/api/solutions/trust', 'agent', { key: 'shop' })).code, 403);
    const cjf = path.join(sb.home, '.claude.json');
    const cj0 = JSON.parse(fs.readFileSync(cjf, 'utf8')); cj0.keepMe = 1; fs.writeFileSync(cjf, JSON.stringify(cj0));
    { const s0 = board.loadState(); s0.queue.push({ qid: 'qtrust1', project: 'shop', task: 'x', createdAt: new Date().toISOString(), failedAt: new Date().toISOString(), error: 'not trusted', needTrust: true }); board.saveState(s0); }
    r = await call('POST', '/api/solutions/trust', 'terminal', { key: 'shop' });
    assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.retried, 1);
    const cj = JSON.parse(fs.readFileSync(cjf, 'utf8'));
    assert.equal(cj.projects[ent.dir].hasTrustDialogAccepted, true); assert.equal(cj.keepMe, 1, '다른 칸 그대로');
    assert.equal(fs.statSync(cjf).mode & 0o777, 0o600); assert.ok(!fs.existsSync(cjf + '.lock'), '자물쇠 풀림');
    { const q0 = board.loadState().queue.find((x) => x.qid === 'qtrust1'); assert.ok(q0 && !q0.failedAt && !q0.needTrust); const s0 = board.loadState(); s0.queue = s0.queue.filter((x) => x.qid !== 'qtrust1'); board.saveState(s0); }
    assert.equal((await call('POST', '/api/solutions/trust', 'terminal', { key: 'nope' })).code, 404);
    r = await call('POST', '/api/solutions/prep', 'terminal', { key: 'shop' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const q = board.loadState().queue.find((x) => x.ref === 'solprep:shop');
    assert.ok(q); assert.match(q.task, /^\[상황판 — 솔루션 준비\]/); assert.equal(q.project, 'shop');
    assert.equal((await call('POST', '/api/solutions/prep', 'terminal', { key: 'shop' })).code, 409, '두 번 안 넣음');

    // 빼기 — 대기열이 있으면 거절 · 키를 쳐야 · 폴더는 그대로
    r = await call('POST', '/api/solutions/remove', 'terminal', { key: 'shop', typed: 'shop' });
    assert.equal(r.code, 409, '대기열 있음');
    const st = board.loadState(); st.queue = st.queue.filter((x) => x.ref !== 'solprep:shop'); board.saveState(st);
    assert.equal((await call('POST', '/api/solutions/remove', 'terminal', { key: 'shop', typed: 'nope' })).code, 400);
    r = await call('POST', '/api/solutions/remove', 'terminal', { key: 'shop', typed: 'shop' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.equal(readPJ().some((p) => p.key === 'shop'), false); assert.ok(fs.existsSync(newDir), '폴더 그대로');

    // 링크 바꿔치기 — 등록 뒤 폴더가 링크로 바뀌면 방 시작 막음
    const a = path.join(sb.home, 'app'), b = path.join(sb.home, 'other'); fs.mkdirSync(a); fs.mkdirSync(b);
    assert.equal((await add({ key: 'app', name: 'App', dir: a })).code, 200);
    assert.equal(board.solDrift(a), null);
    fs.renameSync(a, a + '-old'); fs.symlinkSync(b, a);
    assert.match(String(board.solDrift(a)), /달라졌어요/);

    // 주인이 다른 폴더(예: root 소유 /var/www) — 저절로 넣지 않고 한 번 확인(OWNER) → ownerOk 면 넣음 (이 기계에 그런 폴더가 있을 때만)
    let ow = null; try { const s0 = fs.statSync('/var/www'); if (s0.isDirectory() && s0.uid !== process.getuid()) ow = '/var/www'; } catch (_) {}
    if (ow) {
      r = await add({ key: 'www', name: 'WWW', dir: ow });
      assert.equal(r.code, 409); assert.equal(r.j.code, 'OWNER');
      r = await add({ key: 'www', name: 'WWW', dir: ow, ownerOk: true });
      assert.equal(r.code, 200, JSON.stringify(r.j));
    }
    // 깨진 projects.json 에는 쓰지 않음
    fs.writeFileSync(PJ, '{ broken');
    r = await add({ key: 'zz', name: 'ZZ', dir: realDir });
    assert.notEqual(r.code, 200); assert.equal(fs.readFileSync(PJ, 'utf8'), '{ broken', '덮어쓰지 않음');
  } finally { board.server.close(); }
});

test('기본 정보 — 이름·시간대·서버 이름 검사·저장', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await call('POST', '/api/settings', 'agent', { lang: 'ko', owner: 'X' })).code, 403);
    assert.equal((await call('POST', '/api/settings', 'terminal', { lang: 'ko', aiLang: '', timezone: 'Mars/Base' })).code, 400);
    assert.equal((await call('POST', '/api/settings', 'terminal', { lang: 'ko', aiLang: '', owner: '<b>' })).code, 400);
    assert.equal((await call('POST', '/api/settings', 'terminal', { lang: 'ko', aiLang: '', serverName: '' })).code, 400);
    const r = await call('POST', '/api/settings', 'terminal', { lang: 'ko', aiLang: '', owner: '민지', timezone: 'Europe/Berlin', serverName: '고객사 A', basics: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const c = JSON.parse(fs.readFileSync(CF, 'utf8'));
    assert.equal(c.owner, '민지'); assert.equal(c.timezone, 'Europe/Berlin'); assert.equal(c.serverName, '고객사 A'); assert.ok(c.basicsAt);
    const g = await call('GET', '/api/solutions', 'terminal');
    assert.equal(g.j.basics.serverName, '고객사 A');
  } finally { board.server.close(); }
});
