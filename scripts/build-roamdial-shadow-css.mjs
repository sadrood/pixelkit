// 生成 Shadow DOM 用的 RoamDial CSS：:root/body/html 映射到 :host，其余保持原样
// 输出 src/radio2/styles/roamdial-shadow.css
import fs from 'fs';

const raw = fs.readFileSync('src/radio2/styles/roamdial-raw.css', 'utf8');
const OUT = 'src/radio2/styles/roamdial-shadow.css';

function mapSelector(sel) {
  return sel
    .split(',')
    .map((s) => {
      let t = s.trim();
      if (!t) return s;
      t = t.replace(/:root\b/g, ':host');
      t = t.replace(/(^|[\s>+~(])html\b/g, '$1:host');
      t = t.replace(/(^|[\s>+~(])body\b/g, '$1:host');
      return t;
    })
    .join(',');
}

function walk(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) { out += src.slice(i); break; }
    let prelude = src.slice(i, open).trim();
    while (prelude.startsWith('/*')) {
      const endC = prelude.indexOf('*/');
      if (endC < 0) break;
      out += prelude.slice(0, endC + 2);
      prelude = prelude.slice(endC + 2).trim();
    }
    if (!prelude) { i = open + 1; continue; }
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@(font-face|charset|import|page)/i.test(prelude) || /^@keyframes/i.test(prelude) || /^@-webkit-keyframes/i.test(prelude)) {
      out += prelude + '{' + body + '}';
    } else if (/^@(media|supports|layer|container)/i.test(prelude)) {
      out += prelude + '{' + walk(body) + '}';
    } else if (prelude.startsWith('@')) {
      out += prelude + '{' + body + '}';
    } else {
      out += mapSelector(prelude) + '{' + body + '}';
    }
    i = j;
  }
  return out;
}

const css = '/* Shadow DOM 版 RoamDial 样式（:root/body → :host，自动生成） */\n:host{display:block;position:absolute;inset:0;}\n' + walk(raw);
fs.writeFileSync(OUT, css);
console.log('shadow css: ' + (css.length / 1024).toFixed(0) + 'KB');
