/* 内容补丁应用器：把 patches/<line>.json 落到 docs/人生之书/index.html 对应世界线范围内
   用法：node tools/apply-content-patch.cjs [patchesDir]

   支持的补丁段（都可选，同一文件里可混用）：
     titles  [{ch,i,old,new}]                 选项标题整串替换（要求该线内唯一命中）
     bodies  [{ch,i?,old,new}]                正文片段替换（i 仅用于日志标注）
     texts   [{old,new}]                      任意片段替换（lock 文案等）
     events  {replace:[{old,new}], add:[code]} 事件卡：改写文案 / 追加整张卡（code 是完整的对象字面量源码）
     variants[{ch,scenes:[[段,段],[段,段]]}]   给第 ch 章加场景变体：现有正文成为第 0 场，
                                               scenes[0] 是第 1 场、scenes[1] 是第 2 场……自动补 variants:N

   安全策略：所有文本替换要求"在该世界线范围内精确命中 1 次"；结构改动要求章节/数组能唯一定位；改动前自动备份。 */
const fs = require('fs'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const file = path.join(repo, 'docs/人生之书/index.html');
const dir = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'rsz-v2', 'patches');
const VAR = { origin: 'ORIGIN', cyber: 'CYBER', xianxia: 'XIANXIA', minguo: 'MINGUO', xiaoyuan: 'XIAOYUAN' };

function lineRange(src, v) {
  const start = src.indexOf(`var ${v}={`);
  if (start < 0) throw new Error('未找到 ' + v);
  const rest = src.slice(start);
  const m = rest.match(/\n\};/);
  if (!m) throw new Error(v + ' 结束标记缺失');
  return [start, start + m.index + m[0].length];
}

/* 从 open 位置的括号出发，跳过字符串字面量，返回配对括号的下标 */
function matchBracket(seg, open) {
  const openCh = seg[open], closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, i = open, quote = null;
  for (; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* 结构化定位章节：进入 chapters:[ 数组，按深度取第 n 个顶层元素（= 第 n 章）
   不靠 "{t:'" 正则——个别选项对象也写成 {t:'…'，会误命中。 */
function findChapterStart(seg, chIdx) {
  const at = seg.indexOf('chapters:[');
  if (at < 0) return -1;
  const open = seg.indexOf('[', at);
  let i = open + 1, depth = 1, n = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === "'" || c === '"' || c === '`') {              // 跳过字符串
      const q = c; i++;
      while (i < seg.length) { if (seg[i] === '\\') { i += 2; continue; } if (seg[i] === q) break; i++; }
      i++; continue;
    }
    if (c === '{') {
      if (depth === 1) { n++; if (n === chIdx) return i; }
      const close = matchBracket(seg, i);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (c === '[' || c === '(') { depth++; i++; continue; }
    if (c === ']' || c === ')') { depth--; if (depth <= 0) return -1; i++; continue; }
    i++;
  }
  return -1;
}

/* 函数体内"顶层 return"的位置（跳过字符串/括号），用于把变体分支插在兜底 return 之前 */
function topLevelReturns(body) {
  const out = []; let depth = 0, i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < body.length) { if (body[i] === '\\') { i += 2; continue; } if (body[i] === q) break; i++; } i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; i++; continue; }
    if (depth === 0 && body.startsWith('return', i) && !/[\w$]/.test(body[i + 6] || ';')) { out.push(i); i += 6; continue; }
    i++;
  }
  return out;
}

/* 把现有 body 值（数组或函数）包成 function(s){ …… }，并插入若干变体分支。
   关键：分支插在"最后一个顶层 return 之前"——这样按 flags 早返回的正文（如辍学线、未告别线）优先于随机场戏，
   否则随机会把那些分支整段盖掉。 */
function wrapBody(existing, branches) {
  const head = branches.join('');
  const t = existing.trim();
  let inner;
  if (/^function\s*\(/.test(t)) {
    const open = t.indexOf('{');
    const close = t.lastIndexOf('}');
    inner = t.slice(open + 1, close);
  } else {
    inner = `return ${t};`;
  }
  const returns = topLevelReturns(inner);
  const placed = returns.length ? inner.slice(0, returns[returns.length - 1]) + head + inner.slice(returns[returns.length - 1]) : head + inner;
  return `function(s){${placed}}`;
}

if (!fs.existsSync(dir)) { console.error('补丁目录不存在: ' + dir); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
if (!files.length) { console.error('补丁目录里没有 .json'); process.exit(1); }

let src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file + '.bak', src);
let totalOk = 0, totalSkip = 0;

for (const f of files) {
  let patch;
  try { patch = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.log(`✗ ${f} JSON 解析失败: ${e.message}`); totalSkip++; continue; }
  const key = patch.line;
  const v = VAR[key];
  if (!v) { console.log(`✗ ${f} 未知世界线: ${key}`); totalSkip++; continue; }
  const [s, e] = lineRange(src, v);
  let seg = src.slice(s, e);
  const log = [];
  const applyOne = (oldText, newText, tag) => {
    const n = seg.split(oldText).length - 1;
    if (n !== 1) { log.push(`  ✗ ${tag} 命中 ${n} 次（要求 1）→ 跳过: ${String(oldText).slice(0, 30)}`); totalSkip++; return false; }
    seg = seg.replace(oldText, newText);
    log.push(`  ✓ ${tag}: ${String(oldText).slice(0, 22)} → ${String(newText).slice(0, 22)}`);
    totalOk++;
    return true;
  };

  (patch.titles || []).forEach((t) => {
    const oldLabel = t.ch ? `第${t.ch}章选项${(t.i ?? 0) + 1}` : '标题';
    applyOne(`t:'${t.old}'`, `t:'${t.new}'`, oldLabel) || applyOne(`t:"${t.old}"`, `t:"${t.new}"`, oldLabel);
  });
  (patch.bodies || []).forEach((b, i) => {
    const where = `第${b.ch || '?'}章${b.i !== undefined ? `选项${Number(b.i) + 1}结果` : ''}`;
    applyOne(`'${b.old}'`, `'${b.new}'`, `正文替换#${i + 1}（${where}）`) || applyOne(b.old, b.new, `正文片段#${i + 1}（${where}）`);
  });
  (patch.texts || []).forEach((t, i) => { applyOne(t.old, t.new, `文本替换#${i + 1}`); });

  /* ---- 事件卡 ---- */
  if (patch.events) {
    const ev = patch.events;
    (ev.replace || []).forEach((r, i) => {
      applyOne(`'${r.old}'`, `'${r.new}'`, `事件卡改写#${i + 1}`) || applyOne(r.old, r.new, `事件卡片段#${i + 1}`);
    });
    if (ev.add && ev.add.length) {
      const at = seg.indexOf('events:[');
      if (at < 0) { log.push('  ✗ 事件卡：找不到 events:['); totalSkip += ev.add.length; }
      else {
        const open = seg.indexOf('[', at);
        const close = matchBracket(seg, open);
        if (close < 0) { log.push('  ✗ 事件卡：events 数组括号不配对'); totalSkip += ev.add.length; }
        else {
          /* 幂等：把已存在的 id 剔掉，避免同一份补丁跑两次把卡片加两遍 */
          const inner0 = seg.slice(open + 1, close);
          const exists = new Set([...inner0.matchAll(/\{id:'([a-z0-9]+)'/g)].map((m) => m[1]));
          const fresh = ev.add.filter((c) => {
            const id = (String(c).match(/\{id:'([a-z0-9]+)'/) || [])[1];
            if (id && exists.has(id)) { log.push(`  · 事件卡 ${id} 已存在，跳过`); return false; }
            return true;
          });
          if (!fresh.length) { log.push('  · 事件卡：无需新增（都已存在）'); }
          else {
            const block = fresh.map((c) => ' ' + String(c).trim()).join(',\n');
            const inner = seg.slice(open + 1, close).trim();
            /* 追加到数组开头：若数组原本非空，块尾要补逗号，否则会与原有首项粘在一起 */
            seg = seg.slice(0, open + 1) + '\n' + block + (inner ? ',\n' : '\n') + seg.slice(open + 1);
            log.push(`  ✓ 追加事件卡 ${fresh.length} 张`);
            totalOk += fresh.length;
            totalSkip += ev.add.length - fresh.length;
          }
        }
      }
    }
  }

  /* ---- 章节场景变体 ---- */
  (patch.variants || []).forEach((vn, vi) => {
    const chStart = findChapterStart(seg, vn.ch);
    if (chStart < 0) { log.push(`  ✗ 变体#${vi + 1}：找不到第 ${vn.ch} 章`); totalSkip++; return; }
    const choicesAt = seg.indexOf('choices:[', chStart);
    const bodyAt = seg.indexOf('body:', chStart);
    if (bodyAt < 0 || (choicesAt > 0 && bodyAt > choicesAt)) { log.push(`  ✗ 变体#${vi + 1}：第 ${vn.ch} 章里找不到章正文 body:`); totalSkip++; return; }
    const valStart = bodyAt + 'body:'.length;
    let valEnd;
    const first = seg.slice(valStart, valStart + 12).trimStart();
    if (first.startsWith('[')) {
      const open = seg.indexOf('[', valStart);
      const close = matchBracket(seg, open);
      if (close < 0) { log.push(`  ✗ 变体#${vi + 1}：正文数组括号不配对`); totalSkip++; return; }
      valEnd = close + 1;
    } else if (first.startsWith('function')) {
      const open = seg.indexOf('{', valStart);
      const close = matchBracket(seg, open);
      if (close < 0) { log.push(`  ✗ 变体#${vi + 1}：正文函数括号不配对`); totalSkip++; return; }
      valEnd = close + 1;
    } else { log.push(`  ✗ 变体#${vi + 1}：正文不是数组也不是函数`); totalSkip++; return; }
    const existing = seg.slice(valStart, valEnd);
    const branches = (vn.scenes || []).map((scene, i) => `if(s.v===${i + 1})return[${scene.map((x) => `'${String(x).replace(/'/g, "\\'")}'`).join(',')}];`);
    const wrapped = wrapBody(existing, branches);
    seg = seg.slice(0, valStart) + wrapped + seg.slice(valEnd);
    /* 该章对象补上 variants:N（插在对象开头；已存在则跳过） */
    const chStart2 = findChapterStart(seg, vn.ch);
    const head = seg.slice(chStart2, chStart2 + 40);
    if (!/variants:/.test(head)) seg = seg.slice(0, chStart2 + 1) + `variants:${(vn.scenes || []).length + 1},` + seg.slice(chStart2 + 1);
    log.push(`  ✓ 第${vn.ch}章 场景变体：共 ${(vn.scenes || []).length + 1} 场（新增 ${(vn.scenes || []).length} 场）`);
    totalOk++;
  });

  src = src.slice(0, s) + seg + src.slice(e);
  console.log(`● ${f}（${key}）\n${log.join('\n')}`);
}

fs.writeFileSync(file, src);
console.log(`\n完成：成功 ${totalOk} 条，跳过 ${totalSkip} 条。备份在 index.html.bak`);
