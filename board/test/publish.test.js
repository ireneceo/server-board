'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ projects: [{ key: 'server', name: 'Server', dir: '/nonexistent-server', stateFile: 'session-state.md' }] });
test.after(() => sb.cleanup());

const G = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
const ago = (min) => { const d = new Date(Date.now() - min * 60000).toISOString(); return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }; };
function commit(dir, file, text, min) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  G(dir, 'add', '-A');
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c'], { env: Object.assign({}, process.env, ago(min)) });
}

test('pubUnreleased · pubNext', () => {
  const u = board.pubUnreleased('# C\n\n## [Unreleased]\n**A**\n- one\n- two\n\n**B**\n- three\n\n## [0.6.2]\n**Old**\n- x\n');
  assert.deepEqual(u, { heads: ['A', 'B'], items: 3 });
  assert.deepEqual(board.pubUnreleased('## [Unreleased]\n\n## [0.1.0]\n- x'), { heads: [], items: 0 });
  assert.equal(board.pubNext('v0.6.2'), '0.6.3');
});

test('원본 서버: 태그 뒤 고침 커밋 → 칸 보임 · 조용하면 자동으로 서버 방 대기열 한 번 · 겹쳐 넣지 않음', async () => {
  const root = sb.root, dist = path.join(root, 'dist', 'server-board');
  // 공개 저장소(bare) ← 묶음(dist) — 태그 v0.6.2 를 push 해 둠
  const bare = path.join(root, 'pub.git'); execFileSync('git', ['init', '-q', '--bare', bare]);
  fs.mkdirSync(dist, { recursive: true }); G(dist, 'init', '-q', '-b', 'main');
  commit(dist, 'board/VERSION', '0.6.2\n', 180); G(dist, 'tag', 'v0.6.2'); G(dist, 'remote', 'add', 'origin', bare); G(dist, 'push', '-q', 'origin', 'main', 'v0.6.2');
  // 원본 저장소 — 태그 뒤 상황판 고침 2개(마지막은 2시간 전)
  G(root, 'init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), 'board/state.json\nboard/log/\nboard/config.json\ndist/\nhome/\nbin/\nproj/\npub.git/\nbg.log\nboard/secrets/\n');
  commit(root, 'public/CHANGELOG.md', '# C\n\n## [Unreleased]\n**Fix A**\n- a\n\n**Fix B**\n- b\n\n## [0.6.2]\n- old\n', 150);
  commit(root, 'board/server.js', fs.readFileSync(path.join(sb.dir, 'server.js'), 'utf8') + '\n// x\n', 120);

  const v = await board.publishScan();
  assert.equal(v.last, '0.6.2'); assert.equal(v.next, '0.6.3'); assert.equal(v.pushed, true);
  assert.equal(v.commits, 2); assert.equal(v.items, 2); assert.deepEqual(v.heads, ['Fix A', 'Fix B']); assert.equal(v.dirty, 0);
  const pv = board.publishView([]);
  assert.equal(pv.next, '0.6.3'); assert.equal(pv.work, null); assert.equal(pv.auto, true);

  await board.publishTick();
  let st = board.loadState();
  const q = st.queue.filter((x) => String(x.ref || '').startsWith('publish:'));
  assert.equal(q.length, 1); assert.equal(q[0].ref, 'publish:0.6.3'); assert.equal(q[0].project, 'server');
  assert.match(q[0].task, /kit\/RELEASE\.md/); assert.match(q[0].task, /VERSION=0\.6\.3/);
  assert.equal(board.needsCheck(q[0]), false, '공개판 내기는 시작 전 선검사 안 함');
  assert.equal(board.publishView([]).work, 'queued');

  await board.publishTick();   // 또 돌아도 하나
  assert.equal(board.loadState().queue.filter((x) => String(x.ref || '').startsWith('publish:')).length, 1);
  assert.equal(board.publishQueue('button').ok, false, '맡긴 것이 있으면 버튼도 겹쳐 넣지 않음');

  // 끝남(대기열에서 빠지고 방도 없음) → 다시 넣을 수 있지만 자동은 20시간 안엔 안 함
  st = board.loadState(); st.queue = st.queue.filter((x) => !String(x.ref || '').startsWith('publish:')); board.saveState(st);
  assert.equal(board.publishView([]).work, null);
  await board.publishTick();
  assert.equal(board.loadState().queue.filter((x) => String(x.ref || '').startsWith('publish:')).length, 0, '자동은 하루 한 번');
  assert.equal(board.publishQueue('button').ok, true, '버튼은 바로');
});

test('지난 내기 방을 «끝난 일» 로 확인(화면에서 숨김)한 뒤에도 버튼이 «이미 맡김» 으로 막히지 않음 (2026-11-19)', () => {
  const st = board.loadState(); st.queue = []; const at = new Date().toISOString();
  st.publish = { qid: 'pubX', ver: '0.6.3', from: '0.6.2', why: 'button', at };
  st.qStarted = Object.assign({}, st.qStarted, { pubX: { id: 'abcd1234', at } });
  st.completed = Object.assign({}, st.completed, { 'abcd1234-0000-0000-0000-000000000000': { sessionId: 'abcd1234-0000-0000-0000-000000000000', id: 'abcd1234', confirmedAt: at } });
  board.saveState(st);
  assert.equal(board.publishView([]).work, null);
  const r = board.publishQueue('button');
  assert.equal(r.ok, true, '끝난 일로 확인된 방은 «내는 중» 아님');
  // 끝난 일 표시가 없어도, 방이 전체 목록에서 «끝남» 이면 내는 중 아님 · 일하는 중이면 막음
  const s2 = board.loadState(); s2.queue = []; s2.completed = {}; s2.publish = { qid: 'pubY', ver: '0.6.3', at }; s2.qStarted.pubY = { id: 'ef567890', at }; board.saveState(s2);
  assert.equal(board.publishView([{ id: 'ef567890', status: { code: 'working' } }]).work, 'working');
  assert.equal(board.publishView([{ id: 'ef567890', status: { code: 'done' } }]).work, null);
  assert.equal(board.publishView([]).work, null, '전체 목록에 없음 = 끝나 사라짐');
  const s3 = board.loadState(); s3.queue = []; s3.publish = {}; board.saveState(s3);
});

test('방금 고친 커밋(1시간 안)·커밋 전 파일이 있으면 자동으로 안 넣음', async () => {
  const root = sb.root;
  let st = board.loadState(); st.queue = []; st.publish = {}; board.saveState(st);
  commit(root, 'board/index.html', 'x', 5);
  await board.publishTick();
  assert.equal(board.loadState().queue.length, 0, '조용해지기 전');
  commit(root, 'board/index.html', 'y', 90);   // 마지막 고침이 90분 전 — 그러나 커밋 전 변경
  fs.writeFileSync(path.join(root, 'board', 'index.html'), 'dirty');
  await board.publishTick();
  assert.equal(board.loadState().queue.length, 0, '다른 방이 고치는 중');
  assert.equal(board.publishView([]).dirty, 1);
});

test('막 묶고 아직 안 올린 판: 30분 안은 «올리기 전 확인 중»(packing) · 지나면 빨간 «안 올라감»', async () => {
  const dist = path.join(sb.root, 'dist', 'server-board');
  commit(dist, 'board/VERSION', '0.6.3\n', 5); G(dist, 'tag', 'v0.6.3');   // 5분 전 묶음 · push 안 함
  let v = await board.publishScan();
  assert.equal(v.last, '0.6.3'); assert.equal(v.pushed, false);
  assert.equal(board.publishView([]).packing, true, '막 묶음 — 오탐 빨강 안 띄움');
  commit(dist, 'board/VERSION', '0.6.4\n', 45); G(dist, 'tag', 'v0.6.4');   // 45분 전 묶음 · push 안 함
  v = await board.publishScan();
  assert.equal(v.last, '0.6.4'); assert.equal(v.pushed, false);
  assert.equal(board.publishView([]).packing, false, '30분 지나도 안 올라감 → 빨강');
});

test('설치본(board/VERSION 있음)에선 꺼짐', async () => {
  fs.writeFileSync(path.join(sb.dir, 'VERSION'), '0.6.2\n');
  assert.equal(await board.publishScan(), null);
  assert.equal(board.publishView([]), null);
  fs.unlinkSync(path.join(sb.dir, 'VERSION'));
});
