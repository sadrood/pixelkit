/* 定向验证：「滚烫的人」桶（序号 9/10 两盏灯）是否真的可达（偏置打法） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
function mkEl() { return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector() { return null }, querySelectorAll() { return [] } }; }
const store = new Map();
const ctx = { console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0, fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; }, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() }, document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' }, navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'p' });
const { WORLDLINES, newGame, go, choose, afterChoice, next } = ctx;
let seed = 909; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

for (const wk of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[wk];
  const target = [w.lamps[9], w.lamps[10]];
  const srcCount = {};
  let hit = 0; const N = 3000;
  for (let i = 0; i < N; i++) {
    newGame(wk); go(); let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 300) {
      const ph = ctx.S.phase;
      if (ph === 'story') {
        const c = ctx.W.chapters[ctx.S.idx];
        const cand = [];
        c.choices.forEach((ch, k) => { if (ch.cond ? ch.cond(ctx.S) : true) { const fx = typeof ch.fx === 'function' ? ch.fx(ctx.S) : ch.fx; cand.push({ k, fx }); } });
        let pickIdx = -1;
        if (cand.length) {
          const aimed = cand.filter((x) => x.fx && x.fx.lamps && target.some((t) => (x.fx.lamps[t] || 0) > 0));
          const pool = (rnd() < 0.75 && aimed.length) ? aimed : cand;
          pickIdx = pool[Math.floor(rnd() * pool.length)].k;
          if (aimed.length) srcCount[ctx.S.idx] = (srcCount[ctx.S.idx] || 0) + 1;
        }
        choose(pickIdx);
      } else if (ph === 'result') afterChoice();
      else if (ph === 'event') next();
      else break;
    }
    if (ctx.S.result && ctx.S.result.end.title === '滚烫的人') hit++;
    // 顺带统计两盏灯最高可到多少
    if (i === 0) {
      const mx = {};
      for (const t of target) mx[t] = ctx.S.lamps[t] || 0;
      srcCount.__sample = JSON.stringify(mx);
    }
  }
  console.log(wk.padEnd(9) + ' 桶灯 ' + target.join('/') + '　偏置 3000 局命中《滚烫的人》= ' + hit +
    '　提供该灯的抉择章=' + Object.keys(srcCount).filter((k) => k !== '__sample').join(',') + '　样本值=' + srcCount.__sample);
}
