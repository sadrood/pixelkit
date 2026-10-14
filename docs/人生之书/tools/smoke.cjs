/* 人生之书 —— 无头冒烟测试
   用法: node tools/smoke.js <index.html> [每线局数]
   校验: ① 脚本无语法/运行错误 ② 每条世界线都能跑完 ③ 结局分布 ④ 数值边界健康度 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2] || path.join(__dirname,'..','index.html');
const N = parseInt(process.argv[3] || '1500', 10);

const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error('未找到 inline <script>'); process.exit(2); }
const code = scripts.sort((a, b) => b.length - a.length)[0];
console.log('[info] 提取脚本 ' + code.length + ' 字节，共 ' + scripts.length + ' 个 script 块');

/* ---------- 环境 stub ---------- */
function mkEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getElementsByClassName() { return []; }, insertBefore() {}, remove() {}
  };
  return el;
}
const store = new Map();
const ctx = {
  console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  fetch: () => Promise.reject(new Error('no network in smoke test')),
  XMLHttpRequest: function () { this.open = () => { }; this.send = () => { }; this.setRequestHeader = () => { }; },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] || null,
    get length() { return store.size; }
  },
  document: {
    getElementById: () => mkEl(),
    createElement: () => mkEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: mkEl(),
    documentElement: mkEl(),
    readyState: 'complete'
  },
  navigator: { userAgent: 'node-smoke', language: 'zh-CN' },
  location: { href: 'http://localhost/', reload() {}, hash: '' },
  alert() {}, prompt: () => null, confirm: () => false
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

try { vm.runInContext(code, ctx, { filename: 'index.html<script>' }); }
catch (e) { console.error('!! 脚本执行出错: ' + e.message + '\n' + e.stack); process.exit(1); }

const { WORLDLINES, newGame, go, choose, afterChoice, next } = ctx;
if (!WORLDLINES) { console.error('!! 未取到 WORLDLINES'); process.exit(1); }

/* ---------- 随机数（可复现） ---------- */
let seed = 20260910;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

function play(wk) {
  newGame(wk);
  go();
  let guard = 0;
  while (ctx.S.phase !== 'end' && guard++ < 300) {
    const ph = ctx.S.phase;
    if (ph === 'story') {
      const c = ctx.W.chapters[ctx.S.idx];
      const avail = [];
      c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) avail.push(i); });
      choose(avail.length ? avail[Math.floor(rnd() * avail.length)] : -1);
    } else if (ph === 'result') { afterChoice(); }
    else if (ph === 'event') { next(); }
    else break;
  }
  const r = ctx.S.result;
  return { title: r ? r.end.title : '(未结束:' + ctx.S.phase + ')', sum: r ? r.ctx.sum : 0, age: ctx.S.age };
}

const keys = Object.keys(WORLDLINES);
console.log('[info] 世界线: ' + keys.join(', ') + '　每线 ' + N + ' 局\n');

let bad = 0;
const allTitles = {};
for (const wk of keys) {
  const tally = {}, sums = [];
  let stuck = 0;
  for (let i = 0; i < N; i++) {
    const r = play(wk);
    tally[r.title] = (tally[r.title] || 0) + 1;
    sums.push(r.sum);
    allTitles[r.title] = 1;
    if (r.title.startsWith('(未结束')) stuck++;
  }
  if (stuck) bad += stuck;
  const uniq = Object.keys(tally).length;
  const avg = (sums.reduce((a, b) => a + b, 0) / sums.length).toFixed(1);
  const mx = Math.max(...sums), mn = Math.min(...sums);
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  console.log('● ' + wk + '　结局种类 ' + uniq + '　平均灯芯 ' + avg + '（' + mn + '~' + mx + '）' + (stuck ? '　⚠ 卡住 ' + stuck : ''));
  top.forEach(([t, n]) => console.log('    ' + (n / N * 100).toFixed(1).padStart(5) + '%  ' + t + '  ×' + n));
  console.log('');
}

console.log('=== 汇总 ===');
console.log('可到达结局总数: ' + Object.keys(allTitles).length);
console.log('未结束(卡住)局数: ' + bad);
if (bad) { console.error('!! 存在未正常结束的对局'); process.exit(1); }
console.log('OK：脚本无错误，所有对局均正常结算。');
