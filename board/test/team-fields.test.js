// 한 사람 = 권한 · 직무 · 직책
//   권한만 버튼을 가른다 · 예전 role:'designer' = 권한 member + 직무 designer · 직무·직책은 권한을 바꾸지 않는다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard({ config: { team: { members: [
  { user: 'park', name: '박', role: 'designer', projects: ['demo'] },                                   // 예전 모양
  { user: 'kim', name: '김', role: 'member', job: 'developer', title: '팀장', projects: ['demo'] },
  { user: 'lee', name: '이', role: 'viewer', job: 'developer', title: '대표', projects: ['demo'] },      // 직무·직책이 높아 보여도 보기만
  { user: 'choi', name: '최', role: 'admin', job: 'hacker', title: '<b>x</b>\u0007', projects: ['demo'] },   // 모르는 값
] } } });
test.after(() => sb.cleanup());

test('예전 디자이너 → 일 제안 + 직무 디자이너 · 모르는 값은 버림', () => {
  const park = board.personOf('park');
  assert.equal(park.role, 'member'); assert.equal(park.job, 'designer');
  const kim = board.personOf('kim');
  assert.equal(kim.role, 'member'); assert.equal(kim.job, 'developer'); assert.equal(kim.title, '팀장');
  const choi = board.personOf('choi');
  assert.equal(choi.role, 'member', '모르는 권한은 일 제안(예전과 같음) — 최종 컨펌자로 올라가지 않음');
  assert.equal(choi.job, ''); assert.equal(choi.title, 'bx/b', '꺾쇠·제어 글자는 빠짐');
  assert.equal(board.personOf('kim').title, '팀장');
});

test('직무·직책은 권한을 바꾸지 않음 — 보기만 개발자 대표는 일을 못 넣음 · 일 제안 디자이너는 제안만', async () => {
  const lee = Object.assign(board.personOf('lee'), { via: 'tunnel' });
  assert.equal(lee.role, 'viewer');
  assert.equal((await board.permit(lee, '/api/rooms', { project: 'demo', task: 'x', queue: true }) || [])[0], 403);
  const park = Object.assign(board.personOf('park'), { via: 'tunnel' });
  assert.equal(await board.permit(park, '/api/rooms', { project: 'demo', task: 'x', queue: true }), null);
  assert.equal((await board.permit(park, '/api/rooms', { project: 'demo', task: 'x' }) || [])[0], 403, '바로 시작은 못 함');
  assert.equal((await board.permit(park, '/api/team', { team: {} }) || [])[0], 403);
});
