/* 针对本轮修复的定向验证（原型 vm 环境）：
   ① 第一章事件池是否非空、第二章池大小
   ② 「滚烫的人」是否可达
   ③ 四条非 origin 线能否解锁原先拿不到的 4 个成就
   ④ 欠 = -1（赎罪后）是否仍能拿到无声结局 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
function mkEl() { return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector() { return null }, querySelectorAll() { return [] } }; }
const store = new Map();
const ctx = {
  console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  setTimeout: () => 0, clearTimeout: () => 0, fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' },
  navigator: { userAgent: 'node' }, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });
const { WORLDLINES, newGame, go, choose, afterChoice, next, META } = ctx;
let seed = 424242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pickI = (n) => Math.floor(rnd() * n);

const out = { eventsPerChapter: {}, buckets: {}, ach: {}, redeem: {} };

/* ① 各章事件池大小（白板态代入章龄） */
for (const wk of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[wk];
  ctx.S = { wl: wk, idx: 0, phase: 'story', age: 6, gender: '男', name: '测试', family: { n: 'x', d: 'y' }, talent: { n: 'z' }, attrs: { vit: 3, men: 3, arc: 3, soc: 3, coin: 3 }, lamps: {}, flags: {}, tough: 0, seen: {}, log: [], peeked: {}, lit: {}, pending: [] };
  ctx.W = w;
  const row = [];
  w.chapters.forEach((c, i) => {
    ctx.S.age = c.age;
    row.push(w.events.filter((ev) => !ev.when || ev.when(ctx.S)).length);
  });
  out.eventsPerChapter[wk] = row.join(',');
}

/* ② 桶可达性 + ③ 成就：每线 1500 局随机通关 */
for (const wk of Object.keys(WORLDLINES)) {
  const titles = {}; const achHit = {}; let stuck = 0;
  for (let i = 0; i < 1500; i++) {
    newGame(wk); go(); let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 300) {
      const ph = ctx.S.phase;
      if (ph === 'story') { const c = ctx.W.chapters[ctx.S.idx]; const a = []; c.choices.forEach((ch, k) => { if (ch.cond ? ch.cond(ctx.S) : true) a.push(k) }); choose(a.length ? a[pickI(a.length)] : -1); }
      else if (ph === 'result') afterChoice();
      else if (ph === 'event') next();
      else break;
    }
    if (ctx.S.phase !== 'end') stuck++;
    if (ctx.S.result) titles[ctx.S.result.end.title] = (titles[ctx.S.result.end.title] || 0) + 1;
  }
  out.buckets[wk] = Object.entries(titles).sort((a, b) => b[1] - a[1]).map(([t, n]) => t + '×' + n).join(' | ') + (stuck ? ' 〔未结束 ' + stuck + '〕' : '');
}

/* ④ 赎罪后（欠 = -1）是否仍拿无声结局 */
for (const wk of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[wk];
  const mk = (欠) => {
    const L = {}; L[w.lamps[16]] = 3; L[w.lamps[4]] = 欠; L[w.lamps[0]] = 1;
    return w.endings({ lamps: L, attrs: { vit: 3, men: 3, arc: 3, soc: 3, coin: 3 }, flags: {}, main: w.lamps[16], bucket: 'dengxue', tough: 0, sum: 0 });
  };
  out.redeem[wk] = '欠=0 → ' + mk(0).title + '　|　欠=-1 → ' + mk(-1).title;
}

/* ⑤ 成就：逐线统计 12 个成就能否解锁 */
for (const wk of Object.keys(WORLDLINES)) {
  const hits = {};
  for (let i = 0; i < 800; i++) {
    ctx.META = { codex: { lamps: {}, endings: {}, events: {} }, ach: {}, echoes: 0, runs: 0, lastEpitaph: '' };
    newGame(wk); go(); let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 300) {
      const ph = ctx.S.phase;
      if (ph === 'story') { const c = ctx.W.chapters[ctx.S.idx]; const a = []; c.choices.forEach((ch, k) => { if (ch.cond ? ch.cond(ctx.S) : true) a.push(k) }); choose(a.length ? a[pickI(a.length)] : -1); }
      else if (ph === 'result') afterChoice();
      else if (ph === 'event') next();
      else break;
    }
    Object.keys(ctx.META.ach).forEach((k) => { hits[k] = (hits[k] || 0) + 1 });
  }
  out.ach[wk] = Object.entries(hits).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ':' + n).join(' ');
}

console.log(JSON.stringify(out, null, 1));
