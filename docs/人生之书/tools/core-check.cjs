/* 灯火对立 / 回头账 的核心不变量与可达性复测
 *
 * 为什么单独一套：这两条改动都动"灯与属性的流向"，而 smoke 每线只跑 60 局——
 * 60 局的结局分布噪声极大（±8%），看不出到底压死了哪条线。这里跑大样本，
 * 直接回答四个问题：
 *   ① 对立规则有没有被违反（同对两盏同时 ≥2）——曾漏掉反方向，实测 330 次违章
 *   ② 回头账是否只在第七章后兑现一次、基础事件池是否被污染
 *   ③ 稀有/隐藏结局是否仍然打得到（清空 LAMP_FOES 前后做对照）
 *   ④ 《金灯无芯》的专用打法（贪财策略）是否仍能打出
 *
 * 用法: node docs/人生之书/tools/core-check.cjs
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];

function mkEl() {
  return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {},
    querySelector() { return null }, querySelectorAll() { return [] }, closest() { return null } };
}
const store = new Map();
const ctx = {
  console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0,
  fetch: () => Promise.reject(0),
  XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' },
  navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });

const { WORLDLINES, newGame, go, choose, afterChoice, next, LAMP_FOES, CALLBACKS, BUCKETS, chooseEv } = ctx;
const { eventChoiceList, META } = ctx;
const wlKeys = Object.keys(WORLDLINES);
let seed = 20260914;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* 跑一局。aimLamps 给偏置打法用；strategy='greed' 走贪财策略 */
function play(wk, aimLamps, obs, strategy) {
  newGame(wk); go();
  let g = 0;
  const o = obs || {};
  o.cbChapters = o.cbChapters || [];
  o.violations = o.violations || [];
  while (ctx.S.phase !== 'end' && g++ < 400) {
    const ph = ctx.S.phase;
    if (ph === 'story') {
      const c = ctx.W.chapters[ctx.S.idx];
      const cand = [];
      c.choices.forEach((ch, i) => {
        if (ch.cond ? ch.cond(ctx.S) : true) {
          const fx = typeof ch.fx === 'function' ? ch.fx(ctx.S) : ch.fx;
          let coin = 0, lampN = 0;
          if (fx && fx.attrs && fx.attrs.coin) coin += fx.attrs.coin;
          if (fx && fx.lamps) lampN = Object.keys(fx.lamps).length;
          cand.push({ i, fx, coin, lampN });
        }
      });
      let pickI = -1;
      if (cand.length) {
        if (strategy === 'greed') {
          cand.sort((a, b) => (b.coin - a.coin) || (a.lampN - b.lampN));
          pickI = cand[0].i;
        } else if (aimLamps) {
          const aimed = cand.filter((x) => x.fx && x.fx.lamps && Object.keys(x.fx.lamps).some((n) => aimLamps.indexOf(n) >= 0));
          const pool = (rnd() < 0.85 && aimed.length) ? aimed : cand;
          pickI = pool[Math.floor(rnd() * pool.length)].i;
        } else pickI = cand[Math.floor(rnd() * cand.length)].i;
      }
      choose(pickI);
    } else if (ph === 'result') {
      afterChoice();
      if (ctx.S.event && CALLBACKS.some((c) => c.n === ctx.S.event.n)) o.cbChapters.push(ctx.S.idx + 1);
      if (ctx.S.event && ctx.S.event.extra && CALLBACKS.some((c) => c.n === ctx.S.event.extra.n)) o.cbChapters.push(ctx.S.idx + 1);
    } else if (ph === 'event') {
      /* v2.5：事件卡带 choices → 走 chooseEv 这条路径（随机挑一个可用选项） */
      if (ctx.S.ev) {
        o.evPicks = (o.evPicks || 0) + 1;
        const elist = eventChoiceList(ctx.S.ev) || [];
        if (!elist.length) { o.evBroken = (o.evBroken || 0) + 1; break; }
        chooseEv(elist[Math.floor(rnd() * elist.length)].i);
        continue;
      }
      const L = ctx.S.lamps;
      LAMP_FOES.forEach((pair) => {
        const ka = ctx.W.lamps[pair[0]], kb = ctx.W.lamps[pair[1]];
        if ((L[ka] || 0) >= 2 && (L[kb] || 0) >= 2) o.violations.push(ka + '/' + kb + ' 第' + (ctx.S.idx + 1) + '章同时二档');
      });
      next();
    } else break;
  }
  return o;
}

console.log('=== ① 对立规则（' + LAMP_FOES.length + ' 对）===');
console.log('  对位：' + LAMP_FOES.map((p) => '[' + p[0] + ']↔[' + p[1] + ']').join('  '));
let sameBucket = 0;
LAMP_FOES.forEach((p) => {
  const ba = BUCKETS.findIndex((x) => x.ix.indexOf(p[0]) >= 0), bb = BUCKETS.findIndex((x) => x.ix.indexOf(p[1]) >= 0);
  if (ba === bb) sameBucket++;
});
console.log('  跨桶检查：同桶对数 = ' + sameBucket + '（必须 0，同桶互斥会把那条结局线的等级和压死）');
let viol = 0, capRuns = 0;
const N1 = 800;
for (let t = 0; t < N1; t++) {
  const o = play(pick(wlKeys), null, {});
  viol += o.violations.length;
  if (Object.keys(ctx.S.lampCapped || {}).length) capRuns++;
}
console.log('  ' + N1 + ' 局随机乱点：违章 ' + viol + ' 次（必须 0）｜出现封顶的局 ' + capRuns + ' 局');

console.log('\n=== ② 回头账（中局兑现）===');
let cbRuns = 0, cbMulti = 0, cbEarly = 0;
const cbById = {}; const poolSizes = new Set();
for (let t = 0; t < N1; t++) {
  const o = play(pick(wlKeys), null, {});
  if (o.cbChapters.length) {
    cbRuns++;
    if (o.cbChapters.length > 1) cbMulti++;
    if (Math.min.apply(null, o.cbChapters) < 7) cbEarly++;
  }
  if (ctx.S.cbDone) cbById[ctx.S.cbDone] = (cbById[ctx.S.cbDone] || 0) + 1;
  poolSizes.add(ctx.S.evPool.length);
}
console.log('  ' + N1 + ' 局中兑现过回头账: ' + cbRuns + ' 局（' + (cbRuns / N1 * 100).toFixed(0) + '%）');
console.log('  一局超过一次: ' + cbMulti + '（必须 0）｜早于第七章: ' + cbEarly + '（必须 0）');
console.log('  各变体兑现次数: ' + JSON.stringify(cbById));
console.log('  事件池大小取值: ' + [...poolSizes].sort().join(', ') + '（基础 30；旧账 +1，回头账 +1）');
console.log('  基础池是否被污染: ' + (WORLDLINES[wlKeys[0]].events.length === 30 ? '否（仍 30 张）' : '是！'));

console.log('\n=== ③ 稀有/隐藏结局可达性（偏置打法，含/不含对立对照）===');
const HIDDEN_IX = [0, 1, 3, 6, 16, 17, 15];   /* 念 担 孝 路 归 传 暖 */
const RARE = ['点亮万盏灯', '金灯无芯', '独照', '九死未悔'];
function reach(label) {
  const out = {};
  for (const wk of wlKeys) {
    const names = HIDDEN_IX.map((i) => WORLDLINES[wk].lamps[i]);
    const cnt = {}; let hidden = 0;
    for (let i = 0; i < 1200; i++) {
      play(wk, names, {});
      const t = ctx.S.result ? ctx.S.result.end.title : '';
      cnt[t] = (cnt[t] || 0) + 1;
      if (t === '点亮万盏灯') hidden++;
    }
    out[wk] = { hidden, cnt };
  }
  console.log('  ── ' + label + ' ──');
  for (const wk of wlKeys) {
    const e = out[wk];
    console.log('   ' + wk.padEnd(9) + ' 七灯全亮 ' + String(e.hidden).padStart(4) + '/1200   ' + RARE.map((r) => r + ' ' + (e.cnt[r] || 0)).join('｜'));
  }
  return out;
}
const withFoes = reach('有对立（当前）');
ctx.LAMP_FOES.length = 0;
const withoutFoes = reach('无对立（对照组）');
console.log('  对照结论：');
RARE.forEach((r) => {
  const a = wlKeys.reduce((s, k) => s + (withFoes[k].cnt[r] || 0), 0);
  const b = wlKeys.reduce((s, k) => s + (withoutFoes[k].cnt[r] || 0), 0);
  const verdict = (a === 0 && b > 0) ? '   ← 被压死了！' : (a > 0 ? '   ✓ 仍可达' : '   （两组都 0）');
  console.log('   ' + r.padEnd(10) + ' 有对立 ' + String(a).padStart(4) + ' ｜ 无对立 ' + String(b).padStart(4) + verdict);
});
console.log('  七灯全亮合计：有对立 ' + wlKeys.reduce((s, k) => s + withFoes[k].hidden, 0) + ' ｜ 无对立 ' + wlKeys.reduce((s, k) => s + withoutFoes[k].hidden, 0));

console.log('\n=== ④ 金灯无芯专用打法（贪财策略）===');
let goldTotal = 0;
for (const wk of wlKeys) {
  let hit = 0, minSum = 99, maxCoin = 0;
  for (let i = 0; i < 1200; i++) {
    play(wk, null, {}, 'greed');
    if (ctx.S.result && ctx.S.result.end.title === '金灯无芯') hit++;
    if (ctx.S.result && ctx.S.result.ctx.sum < minSum) minSum = ctx.S.result.ctx.sum;
    if (ctx.S.attrs.coin > maxCoin) maxCoin = ctx.S.attrs.coin;
  }
  goldTotal += hit;
  console.log('  ' + wk.padEnd(9) + ' 金灯无芯 ' + String(hit).padStart(3) + '/1200   最低灯芯值 ' + minSum + '   最高积蓄 ' + maxCoin);
}
console.log('  合计 ' + goldTotal + ' 次 → ' + (goldTotal > 0 ? '✓ 仍是「刻意为之才拿得到」的稀有结局' : '✗ 已被压成死结局！'));

console.log(String.fromCharCode(10)+'=== ⑤ 事件卡可选（choices 引擎）===');
{
  let cards = 0, picked = 0, broken = 0;
  const kinds = new Set();
  for (const wk of wlKeys) WORLDLINES[wk].events.forEach((e) => { if (e.choices) { cards++; kinds.add(wk); } });
  console.log('  带 choices 的事件卡: ' + cards + ' 张（覆盖 ' + [...kinds].join('/') + '）');
  for (let t = 0; t < 600; t++) {
    const o = play(pick(wlKeys), null, {});
    picked += o.evPicks || 0;
    broken += o.evBroken || 0;
  }
  console.log('  600 局里玩家做过的「事件选择」次数: ' + picked + '（0 就说明引擎没被触发）');
  console.log('  选项为空导致的异常: ' + broken + '（必须 0）');
  newGame('origin'); go();
  let guard = 0, saw = false;
  const before = Object.keys(META.codex.events).length;
  while (ctx.S.phase !== 'end' && guard++ < 400) {
    const ph = ctx.S.phase;
    if (ph === 'story') {
      const c = ctx.W.chapters[ctx.S.idx]; const av = [];
      c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) av.push(i); });
      choose(av.length ? av[0] : -1);
    } else if (ph === 'result') afterChoice();
    else if (ph === 'event') {
      if (ctx.S.ev) { saw = true; const l = eventChoiceList(ctx.S.ev); chooseEv(l[0].i); }
      else next();
    } else break;
  }
  console.log('  选完能继续走完一局: ' + (ctx.S.phase === 'end' ? '是' : '否（卡住了！）') + '｜本局触发过事件选择: ' + (saw ? '是' : '（随机未抽到）'));
  console.log('  图鉴事件条目: ' + before + ' → ' + Object.keys(META.codex.events).length);
}

console.log(String.fromCharCode(10)+"=== ⑥ 稀有结局不被年龄结局覆盖（v2.5.1 修）===");
{
  /* 事故：年龄结局（灯尽油枯 / 未及白首）曾无条件覆盖一切，把玩家攒出来的稀有结局吞掉。
     修前实测：独照满足条件的 1594 局里 54% 被吞、九死未悔 30%。
     断言两条：① 稀有/隐藏结局不再被年龄结局覆盖；② 年龄结局本身仍可达（没被改死）。 */
  const AGE = ['灯尽油枯', '未及白首'];
  const SPECIAL = ['点亮万盏灯', '九死未悔', '金灯无芯', '独照', '雪落无声', '灰雪无声', '玄霜无声'];
  let qualified = 0, gotSpecial = 0, eaten = 0;
  const ageSeen = {};
  for (let i = 0; i < 3000; i++) {
    play(pick(wlKeys), null, {});
    const S = ctx.S;   /* play() 返回的是观察对象；状态在 ctx.S */
    const t = S.result ? S.result.end.title : '';
    if (AGE.indexOf(t) >= 0) ageSeen[t] = (ageSeen[t] || 0) + 1;
    const L = S.lamps; let core = 0;
    for (const k in L) core += Math.max(0, L[k]);
    const isLonely = (S.attrs.soc <= 1 && core >= 12);          /* 独照条件 */
    const isTough = (S.tough >= 3);                              /* 九死未悔条件 */
    if (!isLonely && !isTough) continue;
    qualified++;
    if (SPECIAL.indexOf(t) >= 0) gotSpecial++;
    else if (AGE.indexOf(t) >= 0) eaten++;                       /* 早夭不算：那是没活到终章 */
  }
  console.log('  满足稀有条件的局: ' + qualified + '　其中有 ' + gotSpecial + ' 局拿到稀有结局，被年龄结局吞 ' + eaten + ' 局');
  console.log('  年龄结局仍可达: 灯尽油枯 ' + (ageSeen['灯尽油枯'] || 0) + ' 局 ｜ 未及白首 ' + (ageSeen['未及白首'] || 0) + ' 局（都必须 > 0）');
  console.log('  结论: ' + (eaten === 0 && (ageSeen['灯尽油枯'] || 0) > 0 ? '✓ 稀有结局受保护，年龄结局未被改死' : '✗ 有问题'));
}

console.log(String.fromCharCode(10)+'=== ⑦ 事后反馈（deltaLine：这一步改变了什么）===');
{
  /* v2.5.1 加：属性变化此前毫无反馈、灯只有 1.4 秒浮动提示。
     断言三条：① 有变化时给出内容；② 无变化时为空（不能编造）；③ 每步重置（不串台）。 */
  const { deltaReset, deltaLine } = ctx;
  newGame("origin"); go();
  let first = null, emptyAfterReset = null, resetOk = null, refBefore = null;
  let guard = 0;
  while (ctx.S.phase !== "end" && guard++ < 400) {
    const ph = ctx.S.phase;
    if (ph === "story") {
      const c = ctx.W.chapters[ctx.S.idx]; const av = [];
      c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) av.push(i); });
      choose(av.length ? av[0] : -1);
      if (first === null) first = deltaLine();
    } else if (ph === "result") {
      refBefore = ctx.S.delta;                 /* 记下这一步的反馈对象 */
      afterChoice();
      /* afterChoice 开头会 deltaReset()：对象应换成新的（旧的不再被写） */
      if (resetOk === null) resetOk = (ctx.S.delta !== refBefore);
    } else if (ph === "event") {
      if (ctx.S.ev) { const l = eventChoiceList(ctx.S.ev); chooseEv(l[0].i); continue; }
      next();
      if (emptyAfterReset === null) {
        /* 事件结算后主动清一次：必须为空——反馈行不能凭空编造变化 */
        deltaReset();
        emptyAfterReset = deltaLine();
      }
    } else break;
  }
  const hasText = !!(first && first.indexOf("delta") >= 0 && first.replace(/<[^>]*>/g, "").trim().length > 0);
  console.log("  有变化时给出反馈: " + (hasText ? "是 → " + first.replace(/<[^>]*>/g, "").trim().slice(0, 46) : "否（应为是）"));
  console.log("  清空后为空（不编造变化）: " + (emptyAfterReset === "" ? "是" : "否 → " + emptyAfterReset));
  console.log("  每步重置（换新对象，不串台）: " + (resetOk ? "是" : "否"));
  console.log("  结论: " + ((hasText && emptyAfterReset === "" && resetOk) ? "✓ 反馈行可用且不会串台" : "✗ 有问题"));
}
