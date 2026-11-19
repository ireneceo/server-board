// 개발완료가 줄 서 있거나 도는 중인지 — 카드·백업 창이 «안 올린 커밋» 옆에 보여 준다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());

const now = Date.parse('2026-11-19T11:00:00Z');
const working = { project: 'demo', kind: 'background', alive: true, turnOpen: true, name: '노트 녹음·녹화 이탈 방지', status: { code: 'working' } };

test('개발완료 — 없음 · 대기 중(기다리는 방) · 도는 중', () => {
  const st = board.loadState();
  st.queue = [];
  assert.equal(board.devdoneState(st, [working], 'demo', now), null);
  st.queue = [{ qid: 'g1', project: 'demo', task: '/' + board.CMD.devdone, gate: 'devdone', createdAt: '2026-11-19T10:57:16Z' }];
  const w = board.devdoneState(st, [working], 'demo', now);
  assert.equal(w.state, 'wait'); assert.deepEqual(w.after, ['노트 녹음·녹화 이탈 방지']); assert.equal(w.at, '2026-11-19T10:57:16Z');
  assert.equal(board.devdoneState(st, [working], 'other', now), null);   // 다른 솔루션 대기는 안 섞임
  const run = { project: 'demo', kind: 'background', alive: true, turnOpen: true, name: '/' + board.CMD.devdone, id: 'r1', startedAt: now - 60000, status: { code: 'working' } };
  const r = board.devdoneState({ queue: [] }, [run], 'demo', now);
  assert.equal(r.state, 'run'); assert.equal(r.id, 'r1'); assert.equal(r.waiting, false);
  assert.equal(board.devdoneState({ queue: [] }, [Object.assign({}, run, { alive: false })], 'demo', now), null);   // 끝난 방은 아님
});
