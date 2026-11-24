'use strict';
const fs = require('fs');
const path = require('path');

const REVIEW_MODES = ['strict', 'bundle', 'auto'];
const GRADER = 6;   // 판정 규칙을 바꾸면 올림 — 저장된 판정을 다시 함
// 확인 경로 기본값 — 화면 · DB 구조 · 로그인·권한·돈 · 환경 설정 (솔루션마다 ⚙ 팀에서 바꿀 수 있음)
const DEFAULT_REVIEW_PATHS = [
  '**/*.{vue,jsx,tsx,svelte,html,css,scss,sass,less}',
  '**/{pages,views,components,screens,layouts,templates,frontend,client}/**',
  '**/{migrations,migration,seeders,schema,schemas,models,entities}/**',
  '**/*.sql',
  '**/*{auth,login,session,password,permission,role,payment,billing,invoice,refund,settle,price}*',
  '**/*{auth,login,permission,payment,billing}*/**',
  '**/.env*',
  '**/*frontend*/**', '**/{desktop,desktop-pos,mobile,mobile-app,android,ios}/**',
  '**/.claude/{hooks,commands,skills,agents}/**', '**/.claude/settings*', '**/CLAUDE.md',
  '**/*{deploy,rollback}*', '**/ecosystem.config.*', '**/nginx*', '**/*.sh',
];
const MARK_RE = /\[(최종 확인 필요|Final check needed)\]/i;
const WORD_RE = /(결제|환불|정산|금액|가격|요금|과금|로그인|비밀번호|권한|삭제|DB 구조|테이블 구조|마이그레이션|스키마|개인정보|payment|refund|billing|pricing|login|password|permission|delete|migration|schema|personal data)/i;
// 개발 DB 의 데이터 넣기·고치기(시험 데이터)는 운영 위험이 아님 — 구조를 바꾸는 명령만
const DB_CMD_RE = /\b(ALTER|DROP|CREATE)\s+TABLE\b|\b(DROP|CREATE)\s+(UNIQUE\s+)?INDEX\b|\bRENAME\s+TABLE\b|\bDROP\s+(DATABASE|SCHEMA)\b|\bnpm\s+run\s+[\w:-]*migrat|\bnode\s+\S*migrat|\bTRUNCATE\b|\bsequelize(-cli)?\s+db:migrate|\b(knex|prisma|typeorm)\b[^\n]*\bmigrat|\bsync\(\s*\{\s*(alter|force)\s*:\s*true/i;
// 파일은 안 고쳐도 데이터를 바꾸는 SQL(지우기·고치기·넣기) — 있으면 보고의 위험 낱말을 그대로 셈
//   ssh·curl·pm2 는 넣지 않음: 운영 읽기 접속·상황판 알림이 거의 모든 방에 있어 가르는 힘이 없음(실측)
const ACT_CMD_RE = /\bDELETE\s+FROM\b|\bUPDATE\s+[`\w.]+\s+SET\b|\b(INSERT|REPLACE)\s+INTO\b/i;
const PATHISH_RE = /(?:~|\.{0,2})?\/?[\w.@-]+(?:\/[\w.@-]+)+|[\w@-][\w.@-]*\.[A-Za-z0-9]{1,6}\b/g;
const MAX_BYTES = 60 * 1024 * 1024;
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } };

/** 간단한 glob → 정규식: ** (폴더 여럿·없음) · * · ? · {a,b} */
function globRe(g) {
  let s = '', i = 0;
  g = String(g || '').trim().replace(/^\.\//, '');
  while (i < g.length) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { if (g[i + 2] === '/') { s += '(?:.*/)?'; i += 3; } else { s += '.*'; i += 2; } continue; }
    if (c === '*') { s += '[^/]*'; i++; continue; }
    if (c === '?') { s += '[^/]'; i++; continue; }
    if (c === '{') { const j = g.indexOf('}', i); if (j > i) { s += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j + 1; continue; } }
    s += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&'); i++;
  }
  return new RegExp('^' + s + '$', 'i');
}
function matcher(globs) { const res = (globs && globs.length ? globs : DEFAULT_REVIEW_PATHS).map(globRe); return (rel) => res.some((re) => re.test(rel)); }

const OPAQUE_WRITE_RE = /\bxargs\b[^\n]*\b(sed|perl)\b|\bfind\b[^\n]*-exec\b[^\n]*\b(sed|perl|rm|mv|cp)\b|\bgit\s+(stash\s+(pop|apply)|revert|cherry-pick|merge|pull|reset\s+--hard|am)\b|\bprettier\b[^\n]*--write|\beslint\b[^\n]*--fix|\bshutil\.(copy|move)|\brsync\b/;
/** 셸 명령이 쓰는 파일 후보 */
function writeTargets(cmd) {
  const out = [], toks = (seg) => (seg.match(PATHISH_RE) || []);
  for (const m of cmd.matchAll(/(?:^|[^0-9&<>])>{1,2}\s*([^\s;&|<>()]+)/g)) if (!/^\/dev\//.test(m[1])) out.push(m[1]);
  for (const seg of cmd.split(/\n|;|&&|\|\||\|/)) {
    const t = seg.trim().replace(/^(sudo|env\s+\S+=\S+)\s+/, '');
    if (/^tee\b/.test(t)) out.push(...toks(t.replace(/^tee\s+(-a\s+)?/, '')));
    else if (/^(timeout\s+\S+\s+)?(sed|perl)\b[^|]*\s-[a-zA-Z0-9]*i/.test(t) || /^(rm|git\s+(checkout|restore|apply|rm|mv)|patch)\b/.test(t)) out.push(...toks(t));
    else if (/^(cp|mv|install)\b/.test(t)) { const k = toks(t); if (k.length) out.push(k[k.length - 1]); }
  }
  // 안에 쓴 스크립트(python - <<EOF · node -e …)가 파일을 쓰면 그 명령에 나온 경로 전부 — 놓치는 것보다 «필요» 쪽으로
  //   쓰는 호출의 첫 인자가 글자 그대로면 그 경로, 변수면 그 변수에 넣은 글자(p='…'), 못 풀면 명령에 나온 경로 전부
  if (/\b(python3?|node|perl|ruby)\b/.test(cmd) && /open\([^)]*['"][wa]|writeFile|\.write_text\(|renameSync/.test(cmd)) {
    const args = [];
    for (const m of cmd.matchAll(/open\(\s*([^,()]+?)\s*,\s*['"][wa]/g)) args.push(m[1]);
    for (const m of cmd.matchAll(/(?:writeFileSync|writeFile|renameSync)\(\s*([^,()]+?)\s*,/g)) args.push(m[1]);
    for (const m of cmd.matchAll(/Path\(\s*([^()]+?)\s*\)\.write_text\(/g)) args.push(m[1]);
    let unknown = !args.length;
    for (const a of args) {
      const lit = a.match(/^['"`]([^'"`]+)['"`]$/);
      if (lit) { out.push(lit[1]); continue; }
      const v = a.match(/^[A-Za-z_$][\w$]*$/) && cmd.match(new RegExp('\\b' + a + '\\s*=\\s*[\'"`]([^\'"`]+)[\'"`]'));
      if (v) out.push(v[1]); else unknown = true;
    }
    if (unknown) out.push(...toks(cmd));
  }
  return out;
}
/** 대화 기록(.jsonl)에서 이 방이 고친 파일(절대·상대 경로)과 DB 명령 여부 — 읽지 못하면 null */
function editsOf(file, dir) {
  let size; try { size = fs.statSync(file).size; } catch (_) { return null; }
  if (size > MAX_BYTES) return null;
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  try { const sd = path.join(file.replace(/\.jsonl$/, ''), 'subagents'); for (const f of fs.readdirSync(sd)) if (f.endsWith('.jsonl')) { const fp = path.join(sd, f); size += fs.statSync(fp).size; if (size > MAX_BYTES) return null; txt += '\n' + fs.readFileSync(fp, 'utf8'); } } catch (_) { /* 없음 */ }
  const files = new Set(); let db = false, opaque = false, act = false, lines = 0;
  for (const line of txt.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    lines++;
    const content = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || !b.input) continue;
      const n = b.name, inp = b.input;
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) { const f = inp.file_path || inp.notebook_path; if (f) files.add(String(f)); continue; }
      if (n === 'Bash' && typeof inp.command === 'string') {
        const cmd = inp.command;
        if (DB_CMD_RE.test(cmd)) db = true;
        if (OPAQUE_WRITE_RE.test(cmd)) opaque = true;
        if (ACT_CMD_RE.test(cmd)) act = true;
        // 명령이 «쓰는» 대상만(> · tee · sed -i · cp/mv 의 마지막 · rm · git checkout/restore …) — 읽기만 한 파일(.env 를 grep 등)은 셈하지 않음
        //   그중 솔루션 폴더에 실제로 있는 파일만(«application/json»·주소 조각 같은 잡음 빼기)
        // «cd 하위폴더 && …» 면 상대 경로를 그 폴더 기준으로도 찾음(하위 폴더에서 고친 화면 파일을 놓치지 않게)
        const cdm = cmd.match(/^\s*cd\s+(['"]?)([^\s'";&|]+)\1\s*(&&|;|\n)/), cdDir = cdm ? (cdm[2].startsWith('/') ? cdm[2] : dir ? path.join(dir, cdm[2]) : null) : null;
        for (const m of writeTargets(cmd)) {
          if (m.startsWith('/')) { if (exists(m)) files.add(m); continue; }
          const cands = [cdDir && path.join(cdDir, m), dir && path.join(dir, m)].filter(Boolean);
          const hit = cands.find(exists); if (hit) files.add(hit);
        }
      }
    }
  }
  return { files: [...files], db, opaque, act, lines };
}

/**
 * 등급 — { need, why: [..] }
 * o = { report, transcript(파일 경로 또는 null), dir(솔루션 폴더), paths(확인 경로 glob), raised({by,why}|null) }
 */
function grade(o) {
  const why = [];
  if (o.raised) why.push('raised:' + (o.raised.by || '?'));
  const rep = String(o.report || '');
  if (MARK_RE.test(rep)) why.push('marker');
  const w = rep.match(WORD_RE);
  const ed = o.transcript ? editsOf(o.transcript, o.dir) : null;
  if (!ed) { if (w) why.push('word:' + w[1]); why.push('unknown'); }
  else {
    let code = false;   // 이 솔루션의 코드·설정 파일을 하나라도 고쳤나 (기록·문서만이면 아님)
    if (ed.db) why.push('db-command');
    if (ed.opaque) why.push('shell-write');
    const hit = matcher(o.paths), dir = String(o.dir || '').replace(/\/+$/, '');
    for (const f of ed.files) {
      let rel = f.replace(/^~\//, (process.env.HOME || '') + '/');
      if (rel.startsWith('/')) { if (!dir || !rel.startsWith(dir + '/')) continue; rel = rel.slice(dir.length + 1); }
      rel = rel.replace(/^\.\//, '');
      if (/(^|\/)\.claude\/worktrees\/[^/]+\/./.test(rel) && !/\.md$/i.test(rel)) code = true;
      if (/^(\/tmp|tmp\/|node_modules\/|(.*\/)?\.claude\/(worktrees|plans|projects)\/)/.test(rel) || /(^|\/)session-state\.md$/i.test(rel) || (/\.md$/i.test(rel) && !/(^|\/)CLAUDE\.md$/.test(rel))) continue;
      code = true;
      if (hit(rel)) { why.push('path:' + rel.slice(0, 80)); break; }
    }
    if (w && (code || ed.db || ed.opaque || ed.act || !ed.lines)) why.push('word:' + w[1]);
  }
  return { need: why.length > 0, why: why.slice(0, 4) };
}

/** 대화 기록 파일 찾기 — 방 폴더 이름 규칙(transcriptPath) 먼저, 없으면 모든 프로젝트 폴더에서 같은 이름 */
function findTranscript(home, cwd, sid) {
  if (!sid) return null;
  const first = cwd ? path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), sid + '.jsonl') : null;
  if (first && fs.existsSync(first)) return first;
  try {
    const root = path.join(home, '.claude', 'projects');
    for (const d of fs.readdirSync(root)) { const f = path.join(root, d, sid + '.jsonl'); if (fs.existsSync(f)) return f; }
  } catch (_) { /* 없음 */ }
  return null;
}

module.exports = { GRADER, writeTargets, REVIEW_MODES, DEFAULT_REVIEW_PATHS, globRe, matcher, editsOf, grade, findTranscript, MARK_RE, WORD_RE };
