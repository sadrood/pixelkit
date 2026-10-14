/* 清理重复事件卡：同一世界线里同一 id 只保留第一张（防止补丁被重复应用）
   用法：node tools/dedupe-events.cjs */
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
let src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file + '.bak', src);
let removedTotal = 0;
for (const v of ['ORIGIN', 'CYBER', 'XIANXIA', 'MINGUO', 'XIAOYUAN']) {
  const at = src.indexOf(`var ${v}={`);
  if (at < 0) continue;
  const end = src.indexOf('\n};', at);
  const seg = src.slice(at, end);
  const evAt = seg.indexOf('events:[');
  if (evAt < 0) continue;
  const open = seg.indexOf('[', evAt);
  const close = matchBracket(seg, open);
  if (close < 0) continue;
  const body = seg.slice(open + 1, close);
  /* 按顶层元素切分 */
  const items = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '{') {
      const c2 = matchBracket(body, i);
      if (c2 < 0) break;
      items.push(body.slice(i, c2 + 1));
      i = c2 + 1;
      continue;
    }
    i++;
  }
  const seen = new Set(); const kept = [];
  for (const it of items) {
    const id = (it.match(/\{id:'([a-z0-9]+)'/) || [])[1] || '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    kept.push(it);
  }
  const removed = items.length - kept.length;
  if (removed > 0) {
    const rebuilt = '\n' + kept.map((k) => ' ' + k).join(',\n') + '\n';
    src = src.slice(0, at + open + 1) + rebuilt + src.slice(at + close);
    console.log(`${v}: 事件卡 ${items.length} → ${kept.length}（删除重复 ${removed} 张）`);
    removedTotal += removed;
  } else {
    console.log(`${v}: 事件卡 ${items.length} 张，无重复`);
  }
}
fs.writeFileSync(file, src);
console.log(`\n共删除重复 ${removedTotal} 张。备份在 index.html.bak`);
