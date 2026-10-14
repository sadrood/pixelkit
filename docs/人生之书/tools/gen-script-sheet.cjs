/**
 * 生成《人生之书》剧本结构表（docs/人生之书/剧本结构表.md）
 * 数据来源：docs/人生之书/index.html（母本，唯一真相）
 * 用法：node docs/人生之书/tools/gen-script-sheet.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..', '..', '..');
const htmlPath = path.join(repo, 'docs', '人生之书', 'index.html');
const outPath = path.join(repo, 'docs', '人生之书', '剧本结构表.md');

const src = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');
const code = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!code) throw new Error('提取 script 失败');

const store = new Map();
const mkEl = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [] });
const ctx = {
  console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0,
  fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' },
  navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });
const { WORLDLINES } = ctx;

const esc = (s) => String(s).replace(/\|/g, '\\|');
const attrName = { vit: '体魄', men: '心力', arc: '才学', soc: '人情', coin: '积蓄' };

/* 结局数：母本里 w.endings 是函数，数不出来。
   和 split.cjs 用同一个口径——数该线代码里 mkEnd( 的出现次数，
   从切分产物 src/pages/life/book/lines/<key>.js 里取。 */
const linesDir = path.join(repo, 'src', 'pages', 'life', 'book', 'lines');
function endingCount(key) {
  try {
    const f = path.join(linesDir, key + '.js');
    if (!fs.existsSync(f)) return '?';
    return (fs.readFileSync(f, 'utf8').match(/mkEnd\(/g) || []).length;
  } catch (e) { return '?'; }
}

const md = [];

md.push('# 人生之书 · 剧本结构表');
md.push('');
md.push('> 本表由 `tools/gen-script-sheet.cjs` 从母本 `index.html` 自动生成，请勿手改。');
md.push('> 改剧本后重跑该脚本即可更新。');
md.push('');
md.push('用途：调数值、查门槛、核对授灯分布。**不含正文字句**，只看结构与效果。');
md.push('');

/* ---- 总览 ---- */
md.push('## 总览');
md.push('');
md.push('| 世界线 | 章 | 选项 | 有条件 | 授灯次数 | 置 flag | 结局 |');
md.push('|---|---|---|---|---|---|---|');
const lines = Object.keys(WORLDLINES);
for (const key of lines) {
  const w = WORLDLINES[key];
  let ch = 0, cond = 0, lamp = 0, flag = 0;
  w.chapters.forEach((c) => {
    ch += c.choices.length;
    c.choices.forEach((x) => {
      if (x.cond) cond++;
      const fx = x.fx || {};
      if (fx.lamps) lamp += Object.keys(fx.lamps).length;
      if (fx.flags) flag += Object.keys(fx.flags).length;
    });
  });
  md.push(`| ${w.name} | ${w.chapters.length} | ${ch} | ${cond} | ${lamp} | ${flag} | ${endingCount(key)} |`);
}
md.push('');

/* ---- 每线明细 ---- */
for (const key of lines) {
  const w = WORLDLINES[key];
  md.push(`## ${w.name} \`${key}\``);
  md.push('');
  md.push(`- 副题：${w.sub || '—'}`);
  md.push(`- 定位：${w.meta || '—'}`);
  md.push(`- 灯谱（${w.lamps.length}）：${w.lamps.join(' · ')}`);
  md.push('');

  md.push('| 章 | 标题 | 选项 | 条件 | 灯 | 属性 | flag |');
  md.push('|---|---|---|---|---|---|---|');
  w.chapters.forEach((c, i) => {
    c.choices.forEach((x, j) => {
      const fx = x.fx || {};
      const lamp = fx.lamps ? Object.keys(fx.lamps).map((k) => k + '↑').join(' ') : '—';
      const attr = fx.attrs ? Object.entries(fx.attrs).map(([a, v]) => `${attrName[a] || a}${v > 0 ? '+' : ''}${v}`).join(' ') : '—';
      const flag = fx.flags ? Object.keys(fx.flags).map((k) => '`' + k + '`').join(' ') : '—';
      const cond = x.cond ? '是有' : '—';
      const title = typeof x.t === 'function' ? '（条件文案）' : x.t;
      md.push(`| ${j === 0 ? i + 1 : ''} | ${j === 0 ? esc(c.t) : ''} | **${x.k}** ${esc(title)} | ${x.cond ? '**有**' : '—'} | ${lamp} | ${attr} | ${flag} |`);
    });
  });
  md.push('');

  /* 授灯分布 */
  const cnt = {};
  w.chapters.forEach((c) => c.choices.forEach((x) => {
    const L = (x.fx || {}).lamps || {};
    Object.keys(L).forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; });
  }));
  const zero = w.lamps.filter((k) => !cnt[k]);
  const hot = Object.entries(cnt).filter(([, n]) => n >= 3).map(([k, n]) => `${k}×${n}`);
  const cold = Object.entries(cnt).filter(([, n]) => n === 1).map(([k]) => k);
  md.push('**授灯分布**');
  md.push('');
  md.push('| 项 | 内容 |');
  md.push('|---|---|');
  md.push(`| 从未被授予 | ${zero.length ? zero.join(' / ') : '（无，18 盏均可获得）'} |`);
  md.push(`| 高频（≥3 次） | ${hot.join(' / ') || '—'} |`);
  md.push(`| 仅 1 次（藏在单选路线） | ${cold.join(' / ') || '—'} |`);
  md.push('');
}

/* ---- 结尾说明 ---- */
md.push('---');
md.push('');
md.push('## 已知的刻意设计（不要当 bug 改）');
md.push('');
md.push('1. **第 7 章 A 不给任何效果**——五条线完全对称（都是「把遗物收起来」）。');
md.push('   这是「数值上换不到东西的纪念」这一主题设计，与全书的沉默美学一致。');
md.push('2. **第 7 章整章不给属性、末章不给属性**——葬礼章冻结、结算章不再累计。');
md.push('3. **前 3 章无条件门槛**——出身铺陈阶段，讲的是命运强加而非选择；');
md.push('   抉择锁从第 4 章（枢纽章）开始生效。');
md.push('');

fs.writeFileSync(outPath, md.join('\n'), 'utf8');
console.log('已生成 ' + outPath + '（' + md.length + ' 行）');
