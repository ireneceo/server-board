// 공개판 묶음 — 새는 글자 검사를 통과하고, 묶인 상황판도 자기 시험을 통과하는가 (원본 저장소에서만 — 공개판엔 묶는 스크립트가 없음)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EXPORT = path.join(__dirname, '..', '..', 'kit', 'export-public.sh');

test('공개판 묶기 · 묶인 판의 시험', { skip: !fs.existsSync(EXPORT) && '공개판 — 묶는 스크립트 없음', timeout: 240000 }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'board-public-'));
  try {
    const log = execFileSync('bash', [EXPORT, out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(log, /만듦:/);
    const tests = fs.readdirSync(path.join(out, 'board', 'test')).filter((f) => f.endsWith('.test.js') && f !== 'public.test.js').map((f) => path.join(out, 'board', 'test', f));
    assert.ok(tests.length >= 3);
    const env = Object.assign({}, process.env); delete env.NODE_TEST_CONTEXT;   // 안쪽 시험이 바깥 시험의 보고 방식을 물려받지 않게
    const r = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], { encoding: 'utf8', cwd: path.join(out, 'board'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(r, /# fail 0/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
