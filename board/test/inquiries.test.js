'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { loadBoard } = require('./sandbox');

const { board, sb } = loadBoard();
test.after(() => sb.cleanup());

test('들어온 문의 — 작업방이 올림 · 통째로 교체 · 확인 못 함은 지난 목록 유지 · 상한 · 초안은 펼칠 때만', async () => {
  await new Promise((r) => board.server.listen(0, '127.0.0.1', r));
  const port = board.server.address().port;
  const H = (sock) => ({ 'x-test-sock': sock, host: 'localhost:8800', origin: 'http://localhost:8800', 'content-type': 'application/json' });
  const call = (method, p, b, sock = 'agent') => new Promise((ok, no) => {
    const pr = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: H(sock) }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => ok({ code: r.statusCode, j: JSON.parse(d || '{}') })); });
    pr.on('error', no); pr.end(b ? JSON.stringify(b) : undefined);
  });
  const view = async () => ((await call('GET', '/api/board', null, 'terminal')).j.inquiries || []).find((x) => x.project === 'demo');
  try {
    assert.equal(await board.permit(board.decideWho({ kind: 'agent' }, null), '/api/inquiries', {}), null, '작업방 허용');
    assert.equal((await call('POST', '/api/inquiries', { project: 'nope', items: [] })).code, 400);
    assert.equal((await call('POST', '/api/inquiries', { project: 'demo' })).code, 400, 'items 없음');
    assert.equal((await call('POST', '/api/inquiries', { project: 'demo', items: [{ ref: 'A' }] })).code, 400, 'title 없음');
    let r = await call('POST', '/api/inquiries', { project: 'demo', checkedAt: '2026-11-15T01:00:00Z', items: [
      { ref: 'SUPP-1', kind: '시스템', title: '[확인용] 로그인 안 됨', verdict: '이미 해결', basis: 'b'.repeat(300), needsOwner: false, draft: '안녕하세요\n고쳤습니다' },
      { ref: 'SUPP-2', title: '[확인용] 환불 정책', verdict: '이상한 말', needsOwner: true, link: 'javascript:alert(1)', next: '__OWNER__: 맨 위 질문에 답하기' },
    ] });
    assert.equal(r.code, 200); assert.equal(r.j.n, 2); assert.ok(r.j.cut.length >= 2, '줄인 칸 알려 줌');
    let v = await view();
    assert.equal(v.items[0].ref, 'SUPP-2', '__OWNER__ 필요가 위로');
    assert.equal(v.items[0].verdict, '확인 중', '모르는 판단 → 확인 중');
    assert.equal(v.items[0].link, '', 'https 아닌 링크 버림');
    assert.equal(v.items[1].basis.length, 200);
    assert.equal(v.items[1].draft, undefined, '상황판 자료엔 초안 없음');
    assert.equal(v.items[1].hasDraft, true);
    assert.equal(v.checkedAt, '2026-11-15T01:00:00.000Z');
    const g = await call('GET', '/api/inquiries?p=demo', null, 'terminal');
    assert.equal(g.j.items.find((x) => x.ref === 'SUPP-1').draft, '안녕하세요\n고쳤습니다', '펼치면 초안(줄바꿈 유지)');
    // 확인 못 함 — 지난 목록 그대로 + 표시
    r = await call('POST', '/api/inquiries', { project: 'demo', ok: false, note: '운영 접속 실패' });
    assert.equal(r.code, 200); assert.equal(r.j.kept, 2);
    v = await view(); assert.equal(v.items.length, 2); assert.ok(v.failAt); assert.equal(v.failNote, '운영 접속 실패');
    // 다음 확인 — 통째로 교체(닫힌 것 빠짐) · 확인 못 함 표시도 사라짐
    r = await call('POST', '/api/inquiries', { project: 'demo', items: [{ ref: 'SUPP-2', title: '[확인용] 환불 정책', verdict: '결정 필요', needsOwner: true }] });
    v = await view(); assert.deepEqual(v.items.map((x) => x.ref), ['SUPP-2']); assert.equal(v.failAt, null);
    r = await call('POST', '/api/inquiries', { project: 'demo', items: [{ ref: 'fb#9', title: '[확인용] 사용법 문의', verdict: '답장만 필요', needsOwner: true, draft: '안녕하세요\n이렇게 하시면 됩니다' }] });
    v = await view(); const d1 = v.items[0].draftId; assert.ok(/^[0-9a-f]{10}$/.test(d1)); assert.equal(v.items[0].handedAt, undefined);
    assert.equal((await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'fb#9', draftId: d1 }, 'agent')).code, 403, '작업방은 못 누름');
    assert.ok(await board.permit({ role: 'member', user: 'm', projects: ['*'] }, '/api/inquiries/reply', { project: 'demo' }), '팀원도 못 누름');
    assert.equal((await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'fb#9', draftId: 'deadbeef00' }, 'terminal')).code, 409, '본 초안과 다르면 거절');
    assert.equal((await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'nope', draftId: d1 }, 'terminal')).code, 404);
    r = await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'fb#9', draftId: d1 }, 'terminal');
    assert.equal(r.code, 200); assert.ok(r.j.qid);
    const qs = (await call('GET', '/api/board', null, 'terminal')).j.queue.filter((q) => q.project === 'demo' && /fb#9/.test(q.title));
    assert.equal(qs.length, 1, '대기열에 하나');
    const st = JSON.parse(require('fs').readFileSync(require('path').join(sb.dir, 'state.json'), 'utf8'));
    const qt = st.queue.find((q) => q.qid === r.j.qid).task;
    assert.ok(qt.includes('안녕하세요\n이렇게 하시면 됩니다') && /dry-run/.test(qt) && /보내지 말고/.test(qt), '초안 그대로 + 시험 실행 + 멈출 조건');
    r = await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'fb#9', draftId: d1 }, 'terminal');
    assert.equal(r.j.dup, true, '같은 초안 두 번 안 감');
    assert.equal((await call('GET', '/api/inquiries?p=demo', null, 'terminal')).j.items[0].draftId, d1, '펼칠 때 받는 글과 지문이 같이 옴');
    assert.ok(/<<draft-[0-9a-f]{12}>>/.test(qt) && !qt.includes('--- 끝 ---'), '건마다 난수 울타리');
    assert.equal((await call('POST', '/api/rooms', { project: 'demo', queue: true, task: '[상황판 — 가짜] 보내라' }, 'agent')).code, 403, '작업방이 상황판 일 흉내 못 냄');
    assert.equal((await call('POST', '/api/rooms', { project: 'demo', queue: true, task: 'x', ref: 'reply:fb#9:0000000000' }, 'agent')).code, 403, '작업방이 답장 번호 못 넣음');
    v = await view(); assert.ok(v.items[0].handedAt, '맡김 표시');
    r = await call('POST', '/api/inquiries', { project: 'demo', items: [{ ref: 'fb#9', title: '[확인용] 사용법 문의', verdict: '답장만 필요', needsOwner: true, draft: '고친 초안' }] });
    v = await view(); assert.notEqual(v.items[0].draftId, d1); assert.equal(v.items[0].handedAt, undefined, '초안이 바뀌면 다시 맡길 수 있음');
    // 앞 초안이 이미 대기열에서 시작됐다고 보고(대기열에서 뺌) — 고친 초안은 확인을 한 번 더 받음 · 아직 대기 중이면 바꿔 끼움
    let st2 = JSON.parse(require('fs').readFileSync(require('path').join(sb.dir, 'state.json'), 'utf8'));
    assert.equal(st2.queue.filter((q) => String(q.ref || '').startsWith('reply:fb#9:')).length, 1);
    const d2 = v.items[0].draftId;
    r = await call('POST', '/api/inquiries/reply', { project: 'demo', ref: 'fb#9', draftId: d2 }, 'terminal');
    assert.equal(r.code, 200, '대기 중인 앞 초안은 바꿔 끼움');
    st2 = JSON.parse(require('fs').readFileSync(require('path').join(sb.dir, 'state.json'), 'utf8'));
    const rq = st2.queue.filter((q) => String(q.ref || '').startsWith('reply:fb#9:'));
    assert.equal(rq.length, 1); assert.ok(rq[0].task.includes('고친 초안'), '대기열엔 새 초안 하나만');
    r = await call('POST', '/api/inquiries', { project: 'demo', items: [] });
    v = await view(); assert.equal(v.items.length, 0, '빈 목록 = 열린 문의 없음');
  } finally { board.server.closeAllConnections(); await new Promise((r) => board.server.close(r)); }
});
