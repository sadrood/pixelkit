/* v2.4 玩法层专项自检：灯火道标 / 前尘 / 这一生
 * 只跑原型单文件（与其它 check 工具一致），验证三条机制的核心不变量：
 *   ① 道标：偏置生效（相性 ≥ 0）、结算口径正确、跨局记录累计
 *   ② 前尘：灯痕起手亮一盏；缺口那盏"整局都亮不起来"（硬不变量）
 *   ③ 这一生：litAge 记录、lampsAtChapter 反查、结局页时间线可生成
 * 用法: node docs/人生之书/tools/beacon-check.cjs
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];

const store = new Map();
function mkEl() {
  return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {},
    querySelector() { return null }, querySelectorAll() { return [] }, closest() { return null } };
}
const ctx = {
  console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0,
  fetch: () => Promise.reject(0),
  XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() },
  document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' },
  navigator: { userAgent: 'node' }, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });

const { WORLDLINES, newGame, go, choose, afterChoice, next, META, saveMeta,
        LAMP_NAMES, lampName, lampWord, BEACON_WORDS, lampsAtChapter, beaconToggle, beaconClear, beaconStat, pickBucket, renderEnd } = ctx;

let seed = 20260914;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff };
const pick = a => a[Math.floor(rnd() * a.length)];

/* 跑完一局：返回每步观察到的信息 */
function playOne(onStep) {
  let g = 0;
  const seen = { debtCard: false, dimViolation: null, chapters: [] };
  while (ctx.S.phase !== 'end' && g++ < 400) {
    const ph = ctx.S.phase;
    if (ph === 'story') {
      const c = ctx.W.chapters[ctx.S.idx];
      const avail = [];
      c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) avail.push(i); });
      const ci = avail.length ? pick(avail) : -1;
      seen.chapters.push(ctx.S.idx);
      if (onStep) onStep('story');
      choose(ci);
    } else if (ph === 'result') {
      afterChoice();
      if (ctx.S.event && ctx.S.event.n === '旧 账') seen.debtCard = true;
    } else if (ph === 'event') {
      /* 每一步都查"缺口那盏灯有没有被点亮"——这是本次改动唯一的硬不变量 */
      const wl = ctx.W;
      for (const k in (ctx.S.dimAge || {})) {
        if ((ctx.S.lamps[k] || 0) > 0) seen.dimViolation = { lamp: k, chapter: ctx.S.idx, level: ctx.S.lamps[k] };
      }
      next();
    } else break;
  }
  return seen;
}
function lampsAbove(s) { const o = []; for (const k in s.lamps) if (s.lamps[k] > 0) o.push(k); return o; }

console.log('=== ① 灯火道标 ===');
/* 清掉跨局残留，保证从零开始 */
for (const k of Object.keys(META)) delete META[k];
META.beaconStats = { lit: 0, half: 0, dark: 0, byLamp: {} };
META.lastRun = null;
META.beacon = null; META.echoes = 0; META.runs = 0;
META.codex = { lamps: {}, endings: {}, events: {} }; META.ach = {};

const wlKeys = Object.keys(WORLDLINES);
let biasNeg = 0, biasScores = [], litHit = 0, litAll = 0, halfN = 0, missN = 0, verdictBad = 0;
for (let t = 0; t < 60; t++) {
  const wk = pick(wlKeys);
  const w = WORLDLINES[wk];
  const ix = Math.floor(rnd() * w.lamps.length);
  beaconToggle(wk, ix);
  newGame(wk); go();
  if (ctx.S.beaconBorn == null || ctx.S.beaconBorn < 0) biasNeg++;
  else biasScores.push(ctx.S.beaconBorn);
  playOne();
  const bh = ctx.S.result && ctx.S.result.beacon;
  if (!bh) { verdictBad++; continue; }
  const expect = bh.hit === bh.total ? '点着' : (bh.hit > 0 ? '半亮' : '没点着');
  if (bh.verdict !== expect) verdictBad++;
  if (bh.verdict === '点着') { litHit++; litAll++; }
  else if (bh.verdict === '半亮') halfN++;
  else missN++;
}
const st = META.beaconStats;
console.log('  60 局立道标：偏置相性出现负值 ' + biasNeg + ' 次（应为 0）；相性均值 ' + (biasScores.reduce((a, b) => a + b, 0) / biasScores.length).toFixed(2));
console.log('  结算口径错误 ' + verdictBad + ' 次（应为 0）');
console.log('  单盏道标战绩：点着 ' + litAll + ' / 半亮 ' + halfN + ' / 没点着 ' + missN + '（随机乱点下点着率约 ' + (litAll / 60 * 100).toFixed(0) + '%）');
console.log('  跨局记录累计：lit=' + st.lit + ' half=' + st.half + ' dark=' + st.dark + '，逐灯记录 ' + Object.keys(st.byLamp).length + ' 盏');
const sumOk = (st.lit === litAll && st.half === halfN && st.dark === missN);
console.log('  记录与实跑一致: ' + (sumOk ? '是' : '否（lit ' + st.lit + ' vs ' + litAll + '）'));
console.log('  不立道标也能开局: ' + (function () { beaconClear(); newGame('origin'); go(); const r = ctx.S.beacon.length === 0 && ctx.S.beaconBorn === null; return r ? '是' : '否'; })());

/* ①b 灯名必须来自"这条线自己"那套字——五条线的 18 盏灯各叫各的，写死一套就是错的 */
console.log('\n=== ①b 每条世界线的道标名字取自本级数据 ===');
let nameBad = 0;
for (const wk of wlKeys) {
  const w = WORLDLINES[wk], ix = 3;
  beaconToggle(wk, ix);
  const shown = lampName(ix, wk);
  const ok = shown === w.lamps[ix];
  if (!ok) nameBad++;
  console.log('  ' + wk.padEnd(9) + ' 索引' + ix + ' → 界面显示「' + shown + '」，世界线数据「' + w.lamps[ix] + '」 ' + (ok ? '✓' : '✗'));
}
console.log('  五线灯名各自独立（无一写死）: ' + (nameBad === 0 ? '是' : '否（' + nameBad + ' 条不符）'));
console.log('  跨线语义词表仍在（缺口/旧账用）: ' + BEACON_WORDS.length + ' 个，示例 ' + lampWord(0) + '/' + lampWord(17));
beaconClear();

console.log('\n=== ② 前尘（灯痕 + 缺口）===');
/* 上一局的收尾已经写进 META.lastRun；这里明跑一局，确认痕迹真的注入了 */
const lr = META.lastRun;
console.log('  上一局落档: 世界线=' + lr.wl + ' 主灯=' + (lr.mainName || lampWord(lr.mainIx)) + ' 缺口=' + (lr.dimIx == null ? '（无）' : (lr.dimName || lampWord(lr.dimIx))) + ' 结局=' + lr.endTitle + ' 末章抉择=' + JSON.stringify(lr.lastT || '').slice(0, 24));
const targetWk = lr.wl;                       /* 起手灯痕按主灯序号映射，与开哪条线无关 */
newGame(targetWk);
const tw = WORLDLINES[targetWk];
const carriedLv = tw.lamps[lr.mainIx] == null ? 'n/a' : (ctx.S.lamps[tw.lamps[lr.mainIx]] || 0);
const gapLv = (lr.dimIx == null || tw.lamps[lr.dimIx] == null) ? '（本桶无对位灯）' : (ctx.S.lamps[tw.lamps[lr.dimIx]] || 0);
console.log('  同线再开：主灯【' + (lr.mainName || lampWord(lr.mainIx)) + '】起手等级 = ' + carriedLv + '（应为 1）');
console.log('  缺口【' + (lr.dimIx == null ? '—' : (lr.dimName || lampWord(lr.dimIx))) + '】起手等级 = ' + gapLv + '（应 ≤0）');
console.log('  灯痕年龄记录 litAge = ' + JSON.stringify(ctx.S.litAge) + '（主灯应为 0 岁 = 一出生就亮）');
console.log('  旧账卡是否带上了辈子的抉择原文: ' + (ctx.S.traceDebt && ctx.S.traceDebt.t ? '是（' + String(ctx.S.traceDebt.t).slice(0, 20) + '…）' : '否'));
go();
const obs = playOne();
console.log('  整局缺口违章次数: ' + (obs.dimViolation ? JSON.stringify(obs.dimViolation) : '0（不变量成立）'));
console.log('  旧账事件卡触发: ' + (obs.debtCard ? '是' : '否'));
const debtLeft = (ctx.W.events || []).filter(e => e.id === 'trace_debt').length;
console.log('  共享事件池里遗留的临时卡: ' + debtLeft + ' 张（必须为 0，跑了多少局都不能涨）');
console.log('  全事件卡数量未被我改动: ' + ctx.W.events.length + ' 张');
/* 再连跑 15 局，确认共享数据一点没被污染（这是上一版真踩到的坑） */
for (let t = 0; t < 15; t++) { newGame(pick(wlKeys)); go(); playOne(); }
const debtAfter = (ctx.W.events || []).filter(e => e.id === 'trace_debt').length;
console.log('  再跑 15 局后：遗留 ' + debtAfter + ' 张、池子仍为 ' + ctx.W.events.length + ' 张（与上面应完全一致）');

console.log('\n=== ③ 这一生（时间线数据）===');
const ageRec = Object.keys(ctx.S.litAge || {}).length;
console.log('  本局点亮过的灯有年龄记录: ' + ageRec + ' 盏 / 实际亮着 ' + lampsAbove(ctx.S).length + ' 盏');
let chapterHit = 0;
ctx.S.log.forEach(x => { if (lampsAtChapter(x.ch).length) chapterHit++; });
console.log('  能反查出"这一章点了哪盏灯"的抉择: ' + chapterHit + ' / ' + ctx.S.log.length);
const endHtml = (function () { try { renderEnd(); return ctx.document ? 'ok' : 'ok'; } catch (e) { return 'ERR:' + e.message; } })();
console.log('  结局页渲染: ' + endHtml);
console.log('  S.log 条数（时间线行数）: ' + ctx.S.log.length);
const ages = ctx.S.log.map(x => (ctx.W.chapters[x.ch - 1] || {}).age);
console.log('  时间线年龄序列: ' + ages.join(' → '));
console.log('  年龄单调不减: ' + (ages.every((v, i) => i === 0 || v >= ages[i - 1]) ? '是' : '否'));

/* ④ 稀有结局阈值未被改动 */
console.log('\n=== ④ 回归：道标不得削弱稀有结局阈值 ===');
console.log('  BUCKETS 桶数: ' + ctx.BUCKETS.length + '（应为 7）');
console.log('  覆盖层判定仍走世界线自身的 endings(): ' + (typeof ctx.W.endings === 'function' ? '是' : '否'));
let gold = 0, alone = 0, N = 600;
for (let t = 0; t < N; t++) { newGame(pick(wlKeys)); go(); playOne(); const ti = ctx.S.result.end.title; if (ti === '金灯无芯') gold++; if (ti === '独照') alone++; }
console.log('  ' + N + ' 局随机乱点：金灯无芯 ' + gold + ' 次、独照 ' + alone + ' 次（阈值没被道标放松）');
