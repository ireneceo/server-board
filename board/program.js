// 설계 문서 → 자동 연속 개발 («개발 계획») — AUTO_DEV_PLAN.md 6절 1단계
//   계획 방이 plan.json 을 만들고 → 주인이 한 번 승인 → 상황판이 단계를 하나씩 대기열에 넣고 →
//   단계 방이 ✅ 로 끝나면 상황판이 읽기만으로 통과를 가른 뒤 다음 단계를 넣는다.
//   상황판은 계획에 적힌 명령을 실행하지 않는다(Fable 꼭 고칠 것 ②) — git 사실·파일·보고 첫 줄만 본다.
//   이 파일은 상태(st)를 받아 고치기만 한다 — 저장·대기열 시작·카드 그리기는 server.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acct = require('./account');   // git 은 계정 통로로(솔루션 폴더 계정) — child_process 를 직접 부르지 않음

const MAX_STEPS = 15;
const DAY_LIMIT_DEFAULT = 4, DAY_LIMIT_MAX = 8;
const GAP_MAX_MS = 6 * 3600 * 1000;          // 단계 사이 유지보수 일을 기다리는 최대 시간
const STOPPED_GRACE_MS = 30 * 60 * 1000;     // 보고 없이 멈춘 방 — 이만큼 지나도 이어 갈 일이 없으면 멈춤
const PROGRESS_MAX_LINES = 400;

function sha(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); } catch (_) { return null; }
}
function progDir(proj, pid) { return path.join(proj.dir, '.claude', 'programs', pid); }
function files(proj, pid) {
  const d = progDir(proj, pid);
  return { dir: d, plan: path.join(d, 'plan.md'), json: path.join(d, 'plan.json'), progress: path.join(d, 'progress.md') };
}
function planHash(proj, pid) { const f = files(proj, pid); const a = sha(f.json), b = sha(f.plan); return a && b ? a + b : null; }
function docPath(proj, prog) { return path.join(proj.dir, prog.doc); }

/** 설계 문서 경로 — 솔루션 폴더 안의 파일만(.. · 절대 경로 · 링크로 밖 나가기 거절) */
function cleanDoc(proj, raw) {
  const rel = String(raw || '').trim().replace(/^\.\//, '');
  if (!rel || rel.length > 300 || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  const abs = path.join(proj.dir, rel);
  try {
    const real = fs.realpathSync(abs), root = fs.realpathSync(proj.dir);
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) return null;
  } catch (_) { return null; }
  return rel;
}

/** 범위 칸 — 솔루션 폴더 기준 경로 앞부분(«src/foo/» · «server/a.js»). 별표·.. ·절대 경로·전체(«.»·«/») 는 안 받음 */
function cleanScope(x) {
  const s = String(x || '').trim().replace(/^\.\//, '');
  if (!s || s.length > 200 || /[*?\[\]\s]/.test(s) || path.isAbsolute(s) || s === '.' || s.split(/[\\/]/).includes('..')) return null;
  return s;
}

/** plan.json 읽기·검사 → { ok, plan } | { ok:false, err } */
function readPlan(proj, pid) {
  let j;
  try { j = JSON.parse(fs.readFileSync(files(proj, pid).json, 'utf8')); } catch (e) { return { ok: false, err: 'plan.json 을 읽지 못함 — ' + String(e.message).slice(0, 120) }; }
  if (!fs.existsSync(files(proj, pid).plan)) return { ok: false, err: 'plan.md 가 없음' };
  if (!j || !Array.isArray(j.steps) || !j.steps.length) return { ok: false, err: 'steps 가 비어 있음' };
  if (j.steps.length > MAX_STEPS) return { ok: false, err: '단계가 ' + j.steps.length + '개 — ' + MAX_STEPS + '개까지(더 크면 계획을 나눠 넣기)' };
  const steps = [];
  const one = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);   // 한 줄로 — 카드·지시에 가짜 줄을 끼우지 못하게 (Fable 완료 검증 ⑦)
  for (let i = 0; i < j.steps.length; i++) {
    const s = j.steps[i] || {};
    const title = one(s.title, 120);
    const scope = (Array.isArray(s.scope) ? s.scope : []).map(cleanScope);
    if (!title) return { ok: false, err: (i + 1) + '단계 title 없음' };
    if (!scope.length || scope.some((x) => !x)) return { ok: false, err: (i + 1) + '단계 scope 가 비었거나 잘못됨(경로 앞부분만 · 별표·.. 안 됨)' };
    if (typeof s.safe !== 'boolean') return { ok: false, err: (i + 1) + '단계 safe(운영에 나가도 안전한가) 가 true/false 가 아님' };
    steps.push({ n: i + 1, title, section: one(s.section, 200), goal: one(s.goal, 1500), scope, pass: one(s.pass, 800), confirm: one(s.confirm, 300), safe: s.safe });
  }
  if (!steps[steps.length - 1].safe) return { ok: false, err: '마지막 단계 safe 가 false — 계획이 끝나면 운영에 나가도 되는 상태여야 함(숨김 스위치로)' };   // Fable 완료 검증 ②
  const decisions = (Array.isArray(j.decisions) ? j.decisions : []).slice(0, 10).map((d) => ({ q: one(d && d.q, 400), recommend: one(d && d.recommend, 300) })).filter((d) => d.q);
  return { ok: true, plan: { title: one(j.title, 120), estimate: one(j.estimate, 200), steps, decisions } };
}

function git(dir, args) { return String(acct.execFileSync('git', 'git', ['-c', 'core.quotepath=false', '-C', dir].concat(args), { timeout: 10000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })); }
function gitHead(dir) { try { return git(dir, ['rev-parse', 'HEAD']).trim(); } catch (_) { return null; } }
function dirtyFiles(dir) {
  try { return git(dir, ['status', '--porcelain', '-uall']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')); } catch (_) { return null; }
}
/** 단계가 늘 고쳐도 되는 곳 — 그 계획 폴더·작업기록 */
function alwaysOk(proj, pid, f) {
  const st = String(proj.stateFile || '.claude/session-state.md');
  return f.startsWith('.claude/programs/' + pid + '/') || f === st || f === '.claude/session-state.md';
}
function inScope(f, scope) { return scope.some((s) => f === s || f.startsWith(s.endsWith('/') ? s : s + '/')); }

const PASS_LINE = (n) => new RegExp('^#*\\s*단계\\s*' + n + '\\s*통과', 'm');
const NOT_CHECKED_RE = /확인\s*못\s*함|not verified/i;

function judgeStep(proj, prog, step, report, openCards) {
  const why = [];
  const head = String(report || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  if (!/^✅/.test(head)) why.push('보고 첫 줄이 ✅ 가 아님');
  if (NOT_CHECKED_RE.test(report || '')) why.push('보고에 «확인 못 함» 이 있음');
  const dir = proj.dir;
  if (!step.startHead) why.push('단계 시작 지점(커밋)을 모름');
  else {
    let commits = 0, changed = [];
    try { commits = Number(git(dir, ['rev-list', '--count', step.startHead + '..HEAD']).trim()) || 0; } catch (_) { why.push('git 기록을 못 읽음'); }
    if (!commits) why.push('단계 시작 뒤 커밋이 없음');
    try { changed = git(dir, ['diff', '--no-renames', '--name-only', step.startHead + '..HEAD']).split('\n').filter(Boolean); } catch (_) {}
    const out = changed.filter((f) => !alwaysOk(proj, prog.pid, f) && !inScope(f, step.scope));
    if (out.length) why.push('단계 범위 밖 파일을 고침: ' + out.slice(0, 5).join(', ') + (out.length > 5 ? ' 외 ' + (out.length - 5) + '개' : ''));
  }
  const dirty = dirtyFiles(dir);
  if (dirty === null) why.push('작업 폴더 상태를 못 읽음');
  else {
    const before = new Set(step.dirtyAtStart || []);
    const fresh = dirty.filter((f) => !before.has(f) && !alwaysOk(proj, prog.pid, f));
    if (fresh.length) why.push('커밋 안 한 파일이 남음: ' + fresh.slice(0, 5).join(', '));
  }
  if (openCards) why.push('이 방이 올린 질문·할 일 카드가 열려 있음');
  let prog_ = '';
  try { prog_ = fs.readFileSync(files(proj, prog.pid).progress, 'utf8'); } catch (_) {}
  if (!PASS_LINE(step.n).test(prog_)) why.push('progress.md 에 «단계 ' + step.n + ' 통과» 줄이 없음');
  return { pass: !why.length, why };
}

/** 계획 세우기 방 첫 지시 */
function planTask(proj, prog) {
  const f = files(proj, prog.pid);
  return [
    '[상황판 — 개발 계획 세우기 · ' + prog.pid + ']',
    '설계 문서: ' + prog.doc + ' (솔루션 폴더 기준) — 이 문서대로 개발을 단계로 나눠 계획만 세운다. 코드는 고치지 않는다.',
    '',
    '할 일:',
    '1. 설계 문서를 끝까지 읽고 지금 코드를 읽어 무엇이 이미 있는지 본다.',
    '2. 공용 «Fable 사용 기준» 의 «설계» 로 Fable 1회 — 단계 나누기·되돌리기 어려운 곳·컨펌 지점을 판정받는다(한도면 Fable 대기 규칙 그대로, 계획 파일은 쓰지 않고 ⏸/🕓).',
    '3. 두 파일을 쓴다(이 폴더는 상황판이 지문으로 고정 — 승인 뒤 고치면 개발이 멈춤):',
    '   - ' + f.plan + ' — 사람이 읽는 계획(단계마다 목표·설계 문서 절·범위·통과 조건·컨펌 여부와 까닭·운영에 나가도 안전한가)',
    '   - ' + f.json + ' — 상황판이 읽는 같은 내용:',
    '     {"title":"한 줄","estimate":"예: 방 5개 · 이틀","steps":[{"title":"…","section":"설계 문서의 절 이름/번호","goal":"이 단계에서 할 것","scope":["고칠 폴더/","파일 경로"],"pass":"통과를 무엇으로 확인하는지(시험 명령·숫자)","confirm":"" 또는 "멈춰 물을 까닭","safe":true}],"decisions":[{"q":"승인 때 __OWNER__ 가 정할 것","recommend":"권고"}]}',
    '4. 단계 나누기 규칙:',
    '   - 한 단계 = 방 하나가 끝낼 크기(대화가 넘치지 않게). 최대 ' + MAX_STEPS + '단계 · 더 크면 앞부분만 계획하고 plan.md 끝에 «다음 계획» 으로.',
    '   - scope 는 그 단계가 고칠 경로 앞부분만(별표 안 됨). 밖을 고치면 통과 안 됨 — 넉넉하되 솔루션 전체는 안 됨.',
    '   - safe=false: 그 단계가 끝난 코드가 운영에 나가면 안 되는 상태(반쯤 된 기능). 새 기능은 완성 전까지 숨김 스위치 뒤에 두도록 단계를 짜서 safe=true 를 늘린다. safe=false 구간에는 상황판이 운영 배포를 막는다.',
    '   - confirm(멈춰 묻기)은 이것만: 돈·로그인/권한·외부 발송·공개 주소·삭제/데이터 옮기기·승인된 DB 구조에서 벗어남·문서에 답이 없는 갈림길. 새 화면 첫 완성은 멈추지 않는다(«확인할 곳» 으로).',
    '   - DB 구조·권한 설계·문서의 빈 곳·모순은 단계 중간에 묻지 말고 decisions 에 모은다 — 승인 카드에서 한 번에 받는다.',
    '5. 보고 첫 줄 ✅ «계획 N단계» — 상황판이 plan.json 을 검사해 승인 카드를 올린다(⏸ 로 따로 묻지 않는다). 운영 배포 안 함.',
  ].join('\n');
}

/** 단계 방 첫 지시 — 규칙은 상황판이 넣는 첫 지시에(Fable 꼭 고칠 것 ⑦) */
function stepTask(proj, prog, step, fix) {
  const f = files(proj, prog.pid), N = prog.steps.length;
  return [
    '[상황판 — 개발 계획 «' + (prog.title || prog.doc) + '» 단계 ' + step.n + '/' + N + (fix ? ' 고치기' : '') + ' · ' + prog.pid + ']',
    '이 단계: ' + step.title,
    step.goal ? '할 것: ' + step.goal : '',
    '설계 문서: ' + prog.doc + (step.section ? ' — «' + step.section + '» 절을 원문으로 직접 읽는다(요약에 기대지 않음)' : ''),
    '계획: ' + f.plan + ' · ' + f.json + ' — 읽기만(고치면 개발이 멈춤). 앞 단계 메모: ' + f.progress,
    '범위(이 경로만 고친다): ' + step.scope.join(', ') + ' — 밖을 고쳐야 하면 고치지 말고 progress.md 에 적고 보고에 한 줄.',
    step.pass ? '통과 조건: ' + step.pass : '',
    step.safe ? '' : '이 단계는 운영에 나가면 안 되는 구간 — 상황판이 운영 배포를 막아 둠. 새 기능은 계획대로 숨김 스위치 뒤에.',
    '',
    '규칙:',
    '- 되돌리기 어려운 것(돈·로그인/권한·외부 발송·공개 주소·삭제/데이터 옮기기·승인된 DB 구조에서 벗어남)이 계획에 없던 모양으로 필요하면 하지 말고 ⏸ 로 묻는다. 설계 문서에 답이 없는 갈림길도 ⏸.',
    '- 끝나면: 시험을 실제로 돌리고 → 커밋(작업 폴더에 이 단계가 만든 미커밋 파일이 남지 않게) → progress.md 맨 끝에 «## 단계 ' + step.n + ' 통과» 절(한 일 · 돌린 시험 명령과 숫자 · 다음 단계가 알아야 할 것 · 남은 빚). progress.md 가 ' + PROGRESS_MAX_LINES + '줄을 넘으면 앞 단계 절을 간추린다.',
    '- 보고 첫 줄 ✅ 는 통과 조건을 실제로 확인했을 때만. 확인 못 한 것이 있으면 ✅ 를 쓰지 말고 ⏸ 또는 ❌.',
    '- 운영 배포 안 함 · 다음 단계는 상황판이 넣는다(직접 시작하지 않음). 공용 머리글의 «끝났을 때 /개발완료 이어서 실행» 은 이 방에서 하지 않는다(범위 밖 파일이 섞임).',
    fix ? '\n앞 시도가 통과하지 못한 까닭(상황판 판정): ' + fix.join(' · ') + ' — 이것을 고쳐 다시 끝낸다.' : '',
  ].filter((x) => x !== '').join('\n');
}

function today(now, tz) { try { return new Date(now).toLocaleDateString('sv-SE', { timeZone: tz || 'Asia/Seoul' }); } catch (_) { return new Date(now).toISOString().slice(0, 10); } }
function dayLeft(prog, now, tz) { const d = today(now, tz); if (!prog.day || prog.day.d !== d) prog.day = { d, n: 0 }; return (prog.limit || DAY_LIMIT_DEFAULT) - prog.day.n; }

/** 배포 막기 — deploy-runner 의 막음 표식과 같은 자리(st.deployHold)에 직접(runner.hold 는 상태를 따로 읽고 써서 틱의 st 와 엇갈림) */
function setHold(st, prog, reason) {
  st.deployHold = st.deployHold || {}; const m = st.deployHold[prog.project] = st.deployHold[prog.project] || {};
  const hid = 'p' + prog.pid;
  if (!m[hid]) m[hid] = { hid, at: new Date().toISOString(), room: null, roomName: '개발 계획 ' + prog.pid, reason: reason.slice(0, 300), by: 'board' };
  return hid;
}
function clearHold(st, prog) { const m = (st.deployHold || {})[prog.project]; if (m && m['p' + prog.pid]) { delete m['p' + prog.pid]; return true; } return false; }

/** 눈여겨볼 범위 — 규칙·배포·설정·DB 옮기기 파일 (승인 카드에 ⚠) */
const SENSITIVE_RE = /(^|\/)(\.claude\/|CLAUDE\.md$|\.github\/|\.env|ecosystem|nginx|deploy|배포|migrations?\/|scripts?\/)/i;
function sensitive(scope) { return scope.filter((x) => SENSITIVE_RE.test(x)); }

module.exports = { sensitive, MAX_STEPS, DAY_LIMIT_DEFAULT, DAY_LIMIT_MAX, GAP_MAX_MS, STOPPED_GRACE_MS, sha, files, planHash, docPath, cleanDoc, cleanScope, readPlan, gitHead, dirtyFiles, judgeStep, planTask, stepTask, today, dayLeft, setHold, clearHold, inScope, alwaysOk };
