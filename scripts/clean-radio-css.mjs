// 清理 main.css 中已失效的旧电台样式：
// 旧电台页已被 Shadow DOM 复刻替代，.radio-* / .rd-* / #page-radio 后代选择器全部失效
// 保留：#page-radio 基础容器、#roamdial-root 挂载层、以及其它页面样式
import fs from 'fs';

const P = 'src/styles/main.css';
const css = fs.readFileSync(P, 'utf8');
const before = css.length;

const KEEP_EXACT = new Set(['#page-radio', '#page-radio.radio-page', '#roamdial-root']);

function isDeadSelector(sel) {
  const s = sel.trim();
  if (!s) return false;
  if (KEEP_EXACT.has(s)) return false;
  if (s.includes('#roamdial-root')) return false;
  if (/\.radio-|\.rd-/.test(s)) return true;
  if (/^#page-radio(\b|[\s.#:])/.test(s)) return true;
  return false;
}

function cleanSelectors(prelude) {
  const parts = prelude.split(',');
  const kept = parts.filter((p) => !isDeadSelector(p));
  return kept.join(',');
}

function walk(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) { out += src.slice(i); break; }
    let prelude = src.slice(i, open).trim();
    let leadComments = '';
    while (prelude.startsWith('/*')) {
      const endC = prelude.indexOf('*/');
      if (endC < 0) break;
      leadComments += prelude.slice(0, endC + 2);
      prelude = prelude.slice(endC + 2).trim();
    }
    if (!prelude) { out += leadComments; i = open + 1; continue; }
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@(font-face|charset|import|page|keyframes|-webkit-keyframes)/i.test(prelude)) {
      out += leadComments + prelude + '{' + body + '}';
    } else if (/^@(media|supports|layer|container)/i.test(prelude)) {
      const inner = walk(body).trim();
      if (inner) out += leadComments + prelude + '{' + inner + '}';
    } else if (prelude.startsWith('@')) {
      out += leadComments + prelude + '{' + body + '}';
    } else {
      const sel = cleanSelectors(prelude);
      if (sel.replace(/[\s,]/g, '')) out += leadComments + sel + '{' + body + '}';
    }
    i = j;
  }
  return out;
}

const cleaned = walk(css);
fs.writeFileSync(P, cleaned);
const after = cleaned.length;
console.log(`main.css: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB（减少 ${((1 - after / before) * 100).toFixed(1)}%）`);
const left = (cleaned.match(/\.radio-|\.rd-/g) || []).length;
console.log('剩余旧类名引用: ' + left);
