/* 生成物一致性校验：确认 src/pages 下的站点产物 == 由母本切分出来的结果
   用途：防止"直接改生成物"后被下一次切分静默覆盖（PRE-COMMIT / 发版前跑一遍）
   行为：先对现有产物取指纹 → 重跑 split.cjs → 再取指纹；不一致说明产物原本是旧的（已顺手刷新），退出码 1。
   用法：node tools/check-generated.cjs */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '..', '..', '..');
const targets = [
  'src/pages/LifeBookPage.js',
  'src/pages/life/book/data.js',
  'src/styles/life-book.css',
];
const linesDir = path.join(repo, 'src/pages/life/book/lines');
if (fs.existsSync(linesDir)) {
  for (const f of fs.readdirSync(linesDir).filter((x) => x.endsWith('.js'))) targets.push('src/pages/life/book/lines/' + f);
}
const hashOf = (rel) => {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) return '(缺失)';
  // 换行符不参与比较：Windows 检出（core.autocrlf）会把 LF 变成 CRLF，
  // 若按原始字节比对，本脚本会误报"产物与母本不一致"并顺手重写生成物
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
};
const before = {};
targets.forEach((t) => { before[t] = hashOf(t); });

console.log('重跑切分脚本…');
execFileSync(process.execPath, [path.join(__dirname, 'split.cjs')], { stdio: 'pipe' });

let stale = [], missing = [];
for (const t of targets) {
  const after = hashOf(t);
  if (after === '(缺失)') missing.push(t);
  else if (after !== before[t]) stale.push(`${t}（${before[t]} → ${after}）`);
}
if (missing.length) {
  console.log('✗ 缺少产物：\n  ' + missing.join('\n  '));
  process.exit(1);
}
if (stale.length) {
  console.log('✗ 以下产物与母本不一致（已在本次校验中刷新，请把它们一起提交）：\n  ' + stale.join('\n  '));
  process.exit(1);
}
console.log(`✓ 生成物与母本一致（${targets.length} 个文件）`);

/* ---------- 句柄定义核对（2026-09-14 加） ----------
   背景：v2.6 的 aiAlt 只在母本里定义，而 split 会把母本 AI 段整段替换掉，
   于是生成页出现 window.__pkBook = { ..., aiAlt } 而函数不存在——模块直接加载失败、
   整页白屏。原型自动全绿，浏览器才发现。这里静态断言"每个句柄都有定义"。 */
{
  const out = fs.readFileSync(path.join(repo, "src", "pages", "LifeBookPage.js"), "utf8");
  const m = out.match(/window.__pkBook = {([^}]*)}/);
  if (!m) { console.log("✗ 句柄定义核对：找不到 window.__pkBook"); process.exitCode = 1; }
  else {
    const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    const missing = names.filter((n) => !new RegExp("function " + n + "\\b\\s*[(:]").test(out));
    if (missing.length) {
      console.log("✗ 句柄定义核对：这些句柄没有对应函数 → " + missing.join(", "));
      console.log("  （行内 onclick 会调到它们；缺定义会让整页模块加载失败）");
      process.exitCode = 1;
    } else {
      console.log("✓ 句柄定义核对：" + names.length + " 个句柄全部有定义");
    }
  }
}
