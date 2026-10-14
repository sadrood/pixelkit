/* 隐藏结局可达性探测：偏置打法（优先给那七盏灯的选项/事件）下，各线能否真的凑齐 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
function mkEl() { return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector() { return null }, querySelectorAll() { return [] } }; }
const store = new Map();
const ctx = { console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0, fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; }, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() }, document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' }, navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });
const { WORLDLINES, newGame, go, choose, afterChoice, next } = ctx;
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const HIDDEN_IX = [0, 1, 3, 6, 16, 17, 15];   // 念 担 孝 路 归 传 暖（按序号）
for (const wk of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[wk];
  const names = HIDDEN_IX.map((i) => w.lamps[i]);
  let hit = 0; const best = {};
  for (let i = 0; i < 4000; i++) {
    newGame(wk); go(); let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 300) {
      const ph = ctx.S.phase;
      if (ph === 'story') {
        const c = ctx.W.chapters[ctx.S.idx];
        const cand = [];
        c.choices.forEach((ch, k) => { if (ch.cond ? ch.cond(ctx.S) : true) { const fx = typeof ch.fx === 'function' ? ch.fx(ctx.S) : ch.fx; cand.push({ k, fx }); } });
        let pickK = -1;
        if (cand.length) {
          const aimed = cand.filter((x) => x.fx && x.fx.lamps && names.some((n2) => (x.fx.lamps[n2] || 0) > 0));
          const pool = (rnd() < 0.85 && aimed.length) ? aimed : cand;
          pickK = pool[Math.floor(rnd() * pool.length)].k;
        }
        choose(pickK);
      } else if (ph === 'result') afterChoice();
      else if (ph === 'event') next();
      else break;
    }
    const t = ctx.S.result ? ctx.S.result.end.title : '';
    if (t === '点亮万盏灯') hit++;
    names.forEach((n2) => { const v = ctx.S.lamps[n2] || 0; best[n2] = Math.max(best[n2] || 0, v); });
  }
  console.log(`● ${wk.padEnd(9)} 偏置 4000 局命中隐藏 ${hit} 次（${(hit / 4000 * 100).toFixed(2)}%）　七盏灯见过的最高档：` + names.map((n2) => n2 + best[n2]).join(' '));
}
