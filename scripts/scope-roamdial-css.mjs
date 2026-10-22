// 把 RoamDial 原始全局 CSS 作用域化到 #page-radio，避免污染 PixelKit 站点样式
import fs from 'fs';

const IN = 'src/radio2/styles/roamdial-raw.css';
const OUT = 'src/radio2/styles/roamdial.css';
const css = fs.readFileSync(IN, 'utf8');

const SCOPE = '#roamdial-root';

function prefixSelectors(sel) {
  return sel.split(',').map((raw) => {
    const s = raw.trim();
    if (!s) return raw;
    if (s === ':root' || s === 'html' || s === 'body' || s === ':root body') return SCOPE;
    if (s.startsWith(':root ')) return SCOPE + ' ' + s.slice(6);
    if (s.startsWith('html ')) return SCOPE + ' ' + s.slice(5);
    if (s.startsWith('body ')) return SCOPE + ' ' + s.slice(5);
    if (s.startsWith('*')) return SCOPE + ' ' + s;
    return SCOPE + ' ' + s;
  }).join(',');
}

function walk(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) { out += src.slice(i); break; }
    let prelude = src.slice(i, open).trim();
    // 剥离前置注释，避免注释开头的规则被当成注释整体保留
    while (prelude.startsWith('/*')) {
      const endC = prelude.indexOf('*/');
      if (endC < 0) break;
      out += prelude.slice(0, endC + 2);
      prelude = prelude.slice(endC + 2).trim();
    }
    if (!prelude) { i = open + 1; continue; }
    // 找到匹配的 }
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
    } else if (prelude.startsWith('/*') || prelude === '') {
      out += src.slice(i, j); // 注释或异常片段原样保留
    } else if (prelude.startsWith('@')) {
      out += prelude + '{' + body + '}';
    } else {
      out += prefixSelectors(prelude) + '{' + body + '}';
    }
    i = j;
  }
  return out;
}

const scoped = '/* RoamDial 复刻样式（作用域化到 #page-radio，自动生成，勿手改） */\n' + walk(css);
fs.writeFileSync(OUT, scoped);
console.log('作用域 CSS 生成：' + (scoped.length / 1024).toFixed(0) + 'KB');
