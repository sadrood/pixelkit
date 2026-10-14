/* 人生之书 · 内容多样性体检
   统计：每条线章节/选项/事件规模；跨线重复率（章节正文按句、选项标题、选项结果）；
        每条线内部的"变体丰富度"。并列出最该重写的重复片段。
   用法：node tools/diversity-check.cjs [topN] */
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
function mkEl() { return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector() { return null }, querySelectorAll() { return [] } }; }
const store = new Map();
const ctx = { console, Math, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => 0, fetch: () => Promise.reject(0), XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; }, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() }, document: { getElementById: () => mkEl(), createElement: () => mkEl(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl(), documentElement: mkEl(), readyState: 'complete' }, navigator: {}, location: { href: 'http://x/', reload() {}, hash: '' }, alert() {}, prompt: () => null, confirm: () => false };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'proto' });
const { WORLDLINES } = ctx;
const keys = Object.keys(WORLDLINES);

// 取文本：body/choice 可能是字符串、数组或函数（函数用白板状态求值）
function flat(v, S) {
  let x = typeof v === 'function' ? v(S) : v;
  if (x == null) return [];
  if (!Array.isArray(x)) x = [x];
  return x.filter((s) => typeof s === 'string');
}
function blankState(w) {
  const attrs = {}; Object.keys(w.attrs).forEach((k) => { attrs[k] = 3; });
  return { wl: w.key, idx: 3, phase: 'story', age: 30, gender: '男', name: '某', family: { n: 'x', d: 'y' }, talent: { n: 'z' }, attrs, lamps: {}, flags: {}, tough: 0, seen: {}, log: [], peeked: {}, lit: {}, pending: [], status: new Set() };
}
const sentenceSplit = (s) => s.split(/[。！？；\n]/).map((x) => x.trim()).filter((x) => x.length >= 6);

const data = {};
for (const k of keys) {
  const w = WORLDLINES[k];
  const S = blankState(w);
  const bodies = [], titles = [], results = [];
  w.chapters.forEach((c) => {
    flat(c.body, S).forEach((b) => bodies.push(b));
    (c.choices || []).forEach((ch) => {
      titles.push(String(ch.t));
      flat(ch.body, S).forEach((b) => results.push(b));
    });
  });
  data[k] = { name: w.name, chapters: w.chapters.length, choices: titles.length, events: w.events.length, bodies, titles, results, lamps: w.lamps.length, families: (w.families || []).length, talents: (w.talents || []).length };
}

console.log('=== 规模 ===');
console.log('线'.padEnd(22) + '章  选项  事件  章节段  结果段  出身/天赋');
for (const k of keys) {
  const d = data[k];
  console.log(`${(k + ' ' + d.name).padEnd(22)}${String(d.chapters).padStart(2)}  ${String(d.choices).padStart(3)}  ${String(d.events).padStart(4)}  ${String(d.bodies.length).padStart(5)}  ${String(d.results.length).padStart(5)}   ${d.families}/${d.talents}`);
}

// 基准线取 origin；统计其它线与 origin 的逐字重复率
const base = data.origin;
const dupRate = (a, b) => { const B = new Set(b); const hit = a.filter((x) => B.has(x)).length; return { hit, total: a.length, pct: a.length ? (hit / a.length * 100) : 0 }; };
console.log('\n=== 跨线重复率（与 origin 逐字相同）===');
console.log('线'.padEnd(22) + '选项标题        选项结果        章节正文（按句）');
for (const k of keys) {
  if (k === 'origin') continue;
  const d = data[k];
  const t = dupRate(d.titles, base.titles);
  const r = dupRate(d.results, base.results);
  const bs = data[k].bodies.flatMap(sentenceSplit);
  const baseBs = base.bodies.flatMap(sentenceSplit);
  const bb = dupRate(bs, baseBs);
  console.log(`${(k + ' ' + d.name).padEnd(22)}${String(t.hit + '/' + t.total).padStart(7)} (${t.pct.toFixed(0)}%)  ${String(r.hit + '/' + r.total).padStart(7)} (${r.pct.toFixed(0)}%)  ${String(bb.hit + '/' + bb.total).padStart(7)} (${bb.pct.toFixed(0)}%)`);
}

// 每条线内部：同一"功能位"（第 N 章 / 第 N 个选项）是否与其它线共用同一文案
console.log('\n=== 逐章交叉重复（选项标题，只要 5 条线中有 ≥3 条完全相同就算"模板位"）===');
const perChapterTitles = {};
for (const k of keys) {
  const w = WORLDLINES[k]; const S = blankState(w);
  w.chapters.forEach((c, ci) => {
    (c.choices || []).forEach((ch) => {
      perChapterTitles[ci] = perChapterTitles[ci] || {};
      perChapterTitles[ci][k] = perChapterTitles[ci][k] || [];
      perChapterTitles[ci][k].push(String(ch.t));
    });
  });
}
let templateSlots = 0, totalSlots = 0;
Object.keys(perChapterTitles).sort((a, b) => a - b).forEach((ci) => {
  const byLine = perChapterTitles[ci];
  const idxs = new Set(Object.values(byLine).map((a) => a.length));
  const maxLen = Math.max(...Object.values(byLine).map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    const texts = keys.map((k) => (byLine[k] || [])[i]).filter(Boolean);
    if (texts.length < 3) continue;
    totalSlots++;
    const counts = {};
    texts.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    const worst = Math.max(...Object.values(counts));
    if (worst >= 3) { templateSlots++; console.log(`  第 ${Number(ci) + 1} 章 选项${i + 1}：${worst}/${texts.length} 条线共用「${Object.keys(counts).find((t) => counts[t] === worst).slice(0, 28)}」`); }
  }
});
console.log(`\n模板位：${templateSlots} / ${totalSlots} 个选项位存在 ≥3 条线共用同一标题`);

// 变体丰富度：章节正文里带条件分叉（函数）的比例
console.log('\n=== 线内变体（同一章正文在不同状态下是否不同）===');
for (const k of keys) {
  const w = WORLDLINES[k];
  let fnBodies = 0, plain = 0;
  w.chapters.forEach((c) => { if (typeof c.body === 'function') fnBodies++; else plain++; });
  let fnChoices = 0, plainC = 0;
  w.chapters.forEach((c) => (c.choices || []).forEach((ch) => { if (typeof ch.body === 'function') fnChoices++; else plainC++; }));
  console.log(`  ${k.padEnd(9)} 章正文：分叉 ${fnBodies} / 固定 ${plain}　选项结果：分叉 ${fnChoices} / 固定 ${plainC}`);
}

const topN = parseInt(process.argv[2] || '8', 10);
console.log(`\n=== 最该重写的重复片段（跨线出现 ≥3 次，前 ${topN} 条）===`);
const seen = {};
for (const k of keys) data[k].bodies.flatMap(sentenceSplit).forEach((s) => { seen[s] = (seen[s] || 0) + 1; });
Object.entries(seen).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, topN).forEach(([s, n]) => console.log(`  ×${n} ${s.slice(0, 60)}`));

/* ---------- 同线重玩差异：跑 N 局，看同一章是否读到不同场戏 ---------- */
let seed = 20260911;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function playOnce(wk) {
  ctx.newGame(wk); ctx.go();
  const texts = {};
  let g = 0;
  while (ctx.S.phase !== 'end' && g++ < 300) {
    const ph = ctx.S.phase;
    if (ph === 'story') {
      const w = ctx.W, c = w.chapters[ctx.S.idx];
      const t = [].concat(typeof c.body === 'function' ? c.body(ctx.S) : c.body).join('');
      (texts[ctx.S.idx] = texts[ctx.S.idx] || new Set()).add(t.slice(0, 40));
      const a = [];
      c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) a.push(i); });
      ctx.choose(a.length ? a[Math.floor(rnd() * a.length)] : -1);
    } else if (ph === 'result') ctx.afterChoice();
    else if (ph === 'event') ctx.next();
    else break;
  }
  return texts;
}
console.log('\n=== 同线重玩差异（每线 40 局随机通关）===');
console.log('线'.padEnd(22) + '章节有 ≥2 种场戏  最多变体数  不同整局数');
for (const k of keys) {
  const perChapter = {};
  const runs = new Set();
  for (let i = 0; i < 40; i++) {
    const t = playOnce(k);
    Object.entries(t).forEach(([ci, set]) => { perChapter[ci] = perChapter[ci] || new Set(); set.forEach((v) => perChapter[ci].add(v)); });
    runs.add(Object.values(t).map((s) => [...s].join('|')).join('||'));
  }
  const chaptersWithVariants = Object.values(perChapter).filter((s) => s.size >= 2).length;
  const maxVariants = Math.max(...Object.values(perChapter).map((s) => s.size));
  console.log(`${(k + ' ' + data[k].name).padEnd(22)}${String(chaptersWithVariants + ' / ' + Object.keys(perChapter).length).padStart(10)}      ${String(maxVariants).padStart(6)}      ${String(runs.size).padStart(6)} / 40`);
}

/* ---------- 单线用词口头禅 ----------
   上面的跨线重复率只能查出「几条线都在用同一句」，
   查不出「同一条线里把一个词用了十几遍」——那是另一类问题（笔法单调），
   所以这里按线统计一批高频虚词/回避式词，并按字数归一化，便于跨线比较。 */
const TICS = ['很久', '没说', '没提', '没问', '谁也没', '一个字', '沉默', '一声不吭', '说不出口', '再也没'];

const fullText = {};
for (const k of keys) {
  const w = WORLDLINES[k];
  const S = blankState(w);
  const parts = [];
  flat(w.prologue, S).forEach((p) => parts.push(String(p)));
  w.chapters.forEach((c) => {
    flat(c.body, S).forEach((b) => parts.push(String(b)));
    (c.choices || []).forEach((ch) => {
      parts.push(String(ch.t));
      flat(ch.body, S).forEach((b) => parts.push(String(b)));
    });
  });
  (w.events || []).forEach((ev) => {
    parts.push(String(ev.text || ''));
    (ev.out || []).forEach((o) => parts.push(String(o.t || '')));
  });
  fullText[k] = parts.join('\n');
}

console.log('\n=== 单线用词口头禅（同一条线内部的重复，跨线比较看不出来）===');
for (const k of keys) {
  const txt = fullText[k];
  const counts = TICS.map((t) => [t, txt.split(t).length - 1]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((a, b) => a + b[1], 0);
  const per = Math.round((total / (txt.length / 10000)) * 10) / 10;
  const top = counts.slice(0, 5).map(([t, n]) => `${t}×${n}`).join('  ');
  console.log(`${(k + ' ' + data[k].name).padEnd(22)}${String(txt.length).padStart(6)} 字   共 ${String(total).padStart(3)} 处（${per}/万字）   ${top}`);
}
console.log('（判读：这些词多数本身没问题，重点看是不是「同一个收尾动作反复用」。');
console.log('  真正该改的是「沉默之后没接任何具体动作」的句子——那才是偷懒的省略号；');
console.log('  沉默后面跟了物证/动作的，是留白，不要动。）');
