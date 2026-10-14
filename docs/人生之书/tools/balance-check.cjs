/* 结局平衡体检：大样本压测，给出每线各结局命中率 + 关键覆盖率指标
 *
 * 用法：
 *   node tools/balance-check.cjs [每线局数，默认 3000]
 *   node tools/balance-check.cjs 3000 --strategy=health        # 养生流：优先加体魄、避免灯灭
 *   node tools/balance-check.cjs 3000 --strategy=selfdestruct  # 自毁流：优先减体魄、拿命换钱、主动灯灭
 *
 * v2.4⑥ 年龄层上线后，这里同时报告终局年龄分布与三个年龄带命中率——
 * 阈值（未及白首 ≤74 / 灯尽油枯 ≥81）就是按这份实测分位数定的，别再拍脑袋改。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const N = parseInt(process.argv[2] || '3000', 10);
const stratArg = (process.argv.find((a) => a.startsWith('--strategy=')) || '').split('=')[1] || 'random';
if (!['random', 'health', 'selfdestruct'].includes(stratArg)) {
  console.error('未知策略：' + stratArg + '（可选 random / health / selfdestruct）');
  process.exit(1);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
function mkEl() { return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector() { return null }, querySelectorAll() { return [] } }; }
const store = new Map();
const ctx = { console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0, fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; }, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() }, document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' }, navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });
const { WORLDLINES, newGame, go, choose, afterChoice, next } = ctx;
let seed = 20260912;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const HIDDEN = '点亮万盏灯', SPECIAL = ['金灯无芯', '独照', '九死未悔'];
const AGE_BANDS = ['灯没熬过那个冬天', '未及白首', '灯尽油枯'];
/* 策略打分：只影响"挑哪个选项"，不改任何判定规则——引擎怎么说就怎么算 */
function pickIndex(S, ch) {
  const list = [];
  ch.choices.forEach((c, k) => { if (c.cond ? c.cond(S) : true) list.push(k); });
  if (!list.length) return -1;
  if (stratArg === 'random') return list[Math.floor(rnd() * list.length)];
  const score = (k) => {
    const fx = ch.choices[k].fx;
    const a = (fx && typeof fx === 'object' && fx.attrs) || {};
    const L = (fx && typeof fx === 'object' && fx.lamps) || {};
    const deaths = Object.values(L).filter((v) => v < 0).length;
    const y = ch.choices[k].years || 0;
    return stratArg === 'health'
      ? (a.vit || 0) * 3 + y * 3 - deaths * 2 - (a.coin || 0)
      : (a.vit || 0) * -3 - y * 3 + deaths * 3 + (a.coin || 0) * 1.5;
  };
  return list.slice().sort((x, y) => score(y) - score(x))[0];
}
const all = {};
console.log(`策略：${stratArg}　每线 ${N} 局\n`);
for (const wk of Object.keys(WORLDLINES)) {
  const tally = {}; let hidden = 0, spec = 0, stuck = 0; let coreSum = 0, toughMax = 0;
  const ages = []; let early = 0, white = 0, dry = 0;
  for (let i = 0; i < N; i++) {
    newGame(wk); go(); let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 300) {
      const ph = ctx.S.phase;
      if (ph === 'story') choose(pickIndex(ctx.S, ctx.W.chapters[ctx.S.idx]));
      else if (ph === 'result') afterChoice();
      else if (ph === 'event') next();
      else break;
    }
    if (ctx.S.phase !== 'end') { stuck++; continue; }
    const t = ctx.S.result.end.title;
    tally[t] = (tally[t] || 0) + 1;
    if (t === HIDDEN) hidden++;
    if (SPECIAL.includes(t)) spec++;
    coreSum += ctx.S.result.ctx.sum;
    toughMax = Math.max(toughMax, ctx.S.tough || 0);
    all[t] = (all[t] || 0) + 1;
    const fa = ctx.S.endAge != null ? ctx.S.endAge : ctx.S.age;
    ages.push(fa);
    if (t === '灯没熬过那个冬天') early++;
    else if (t === '未及白首') white++;
    else if (t === '灯尽油枯') dry++;
  }
  ages.sort((a, b) => a - b);
  const q = (p) => (ages.length ? ages[Math.floor(ages.length * p)] : 0);
  const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${(n / N * 100).toFixed(2)}%`).join(' | ');
  console.log(`● ${wk.padEnd(9)} 隐藏《点亮万盏灯》${(hidden / N * 100).toFixed(2)}%　特殊合计 ${(spec / N * 100).toFixed(2)}%　平均灯芯 ${(coreSum / N).toFixed(1)}　最高韧度 ${toughMax}${stuck ? '　⚠卡住 ' + stuck : ''}`);
  console.log(`    年龄 中位 ${q(.5)}（p10 ${q(.1)} / p90 ${q(.9)}）　早夭 ${(early / N * 100).toFixed(2)}%　未及白首 ${(white / N * 100).toFixed(2)}%　灯尽油枯 ${(dry / N * 100).toFixed(2)}%`);
  console.log('    ' + rows);
}
console.log('\n全局出现的结局：' + Object.keys(all).sort().join(' / '));
const ageHits = AGE_BANDS.filter((b) => all[b]);
console.log('年龄带命中：' + (ageHits.length ? ageHits.map((b) => `${b} ${all[b]}`).join('　') : '（本策略下未出现）'));
