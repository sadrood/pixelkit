/* 变体顺序修正器：把 `if(s.v===N)return[...];` 分支从正文函数开头挪到"最后一个顶层 return 之前"。
   为什么：正文函数里常有按 flags 分叉的早返回（如辍学线第四章、未告别线第七章），
   若把变体分支放在最前面，会把那些分支整段盖掉，约一半对局读到与路线矛盾的场戏。
   改后语义：flags 分支优先 → 否则按 s.v 选场戏 → 最后是兜底正文。
   用法：node tools/normalize-variants.cjs  （就地改 docs/人生之书/index.html，自动备份） */
const fs = require('fs'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const file = path.join(repo, 'docs/人生之书/index.html');

function matchBracket(seg, open) {
  const openCh = seg[open], closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, i = open, quote = null;
  for (; i < seg.length; i++) {
    const c = seg[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
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
/* 从正文函数体开头收集连续的 if(s.v===N)return[...]; 分支 */
function takeLeadingVariantBranches(body) {
  let i = 0, branches = [];
  for (;;) {
    const rest = body.slice(i);
    const m = rest.match(/^\s*if\(s\.v===(\d+)\)return\[/);
    if (!m) break;
    const start = i + m[0].length - 1;          // '[' 的位置
    const close = matchBracket(body, start);
    if (close < 0) break;
    let j = close + 1;
    while (j < body.length && /[\s;]/.test(body[j])) j++;
    branches.push(body.slice(i, j));
    i = j;
  }
  return { branches, rest: body.slice(i) };
}

let src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file + '.bak', src);
const VAR = { origin: 'ORIGIN', cyber: 'CYBER', xianxia: 'XIANXIA', minguo: 'MINGUO', xiaoyuan: 'XIAOYUAN' };
let fixed = 0, scanned = 0;

for (const [key, v] of Object.entries(VAR)) {
  const start = src.indexOf(`var ${v}={`);
  if (start < 0) continue;
  const rest = src.slice(start);
  const endM = rest.match(/\n\};/);
  let seg = rest.slice(0, endM.index + endM[0].length);
  let pos = 0;
  for (;;) {
    const at = seg.indexOf('body:function(s){', pos);
    if (at < 0) break;
    const open = seg.indexOf('{', at);
    const close = matchBracket(seg, open);
    if (close < 0) break;
    pos = close + 1;
    const inner = seg.slice(open + 1, close);
    scanned++;
    if (!/^\s*if\(s\.v===/.test(inner)) continue;      // 不是"变体分支在最前"的形态，跳过
    const { branches, rest: body } = takeLeadingVariantBranches(inner);
    if (!branches.length) continue;
    const returns = topLevelReturns(body);
    let rebuilt;
    if (returns.length) {
      const last = returns[returns.length - 1];
      rebuilt = body.slice(0, last) + branches.join('') + body.slice(last);
    } else {
      rebuilt = branches.join('') + body;
    }
    seg = seg.slice(0, open + 1) + rebuilt + seg.slice(close);
    fixed++;
  }
  src = src.slice(0, start) + seg + src.slice(start + seg.length);
}
fs.writeFileSync(file, src);
console.log(`扫描正文函数 ${scanned} 个，重排变体分支 ${fixed} 处。备份在 index.html.bak`);
