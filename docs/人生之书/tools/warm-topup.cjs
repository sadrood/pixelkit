/* 人生之书 · 预热补漏（warm-topup）
 *
 * 为什么需要它：全量预热跑完后，总有少数条目因为撞限流（429）没暖上——
 * 2026-09-15 那次全量 1087 条里失败了 11 条。而 warm-rewrite-cache.cjs 是"整程走一遍"的，
 * 用它补漏要重走 1087 条（每条照样睡间隔，约 5 小时），代价完全不成比例。
 *
 * 这个脚本只做一件事：**按确定性采样重算"应该有的键"，与服务器缓存做差，只补缺失的那几条**。
 * 因为预热脚本的随机源已固定（种子 20260914），重算出的键集与当初预热的那套完全一致，
 * 所以差集就是真正的漏网条目——通常个位数，几分钟补完。
 *
 * 兼容两类条目：
 *   ① 结果改写  键 = 角度 + \0 + 原文
 *   ② 另一种可能 键 = 'book-alt' + \0 + 世界线 + \0 + 抉择 + \0 + 结局
 *
 * 用法（在服务器上跑，指向跑着这份代码的那个进程）：
 *   BOOK_REPO=/opt/pixelkit-test BOOK_AI_URL=http://127.0.0.1:3002/api/agent/book-ai \
 *     node docs/人生之书/tools/warm-topup.cjs --dry        # 只看缺几条，不发请求
 *   BOOK_REPO=/opt/pixelkit-test BOOK_AI_URL=http://127.0.0.1:3002/api/agent/book-ai \
 *     node docs/人生之书/tools/warm-topup.cjs --gap 15000  # 补漏（间隔给宽一点，避开限流）
 *
 * 环境变量：
 *   BOOK_REPO      仓库根目录（缓存与母本都在它下面）。默认按脚本位置推断。
 *   BOOK_AI_URL    接口地址，默认 http://127.0.0.1:3001/api/agent/book-ai
 *   BOOK_AI_AUTH   Basic 认证 "用户:密码"，默认不发送
 *
 * 注意：采样参数（--alt-runs / --alt-max）必须与 warm-rewrite-cache.cjs 一致，
 * 否则重算出的键集与当初预热的那套对不上，差集就会虚高。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const gi = argv.indexOf('--gap');
const GAP = gi >= 0 ? Number(argv[gi + 1]) || 12000 : 12000;
const ari = argv.indexOf('--alt-runs');
const ALT_RUNS = ari >= 0 ? Math.max(1, Number(argv[ari + 1]) || 60) : 60;
const ami = argv.indexOf('--alt-max');
const ALT_MAX = ami >= 0 ? Math.max(0, Number(argv[ami + 1]) || 0) : 260;
const ALT_RUNS_PER_LINE = ALT_RUNS;

const repo = process.env.BOOK_REPO || path.resolve(__dirname, '..', '..', '..');
const ENDPOINT = process.env.BOOK_AI_URL || 'http://127.0.0.1:3001/api/agent/book-ai';
const AUTH = process.env.BOOK_AI_AUTH || '';
const CACHE_FILE = process.env.BOOK_RW_CACHE_FILE || path.join(repo, 'data', 'book-rewrite-cache.json');

if (!fs.existsSync(CACHE_FILE)) {
  console.error('找不到缓存文件：' + CACHE_FILE);
  console.error('（它由 server.js 落盘；确认 BOOK_REPO 指向跑着这份代码的部署目录）');
  process.exit(1);
}

/* ---------- 读母本建 VM：与 warm-rewrite-cache.cjs 同一套配置（含固定随机源） ---------- */
const src = fs.readFileSync(path.join(repo, 'docs', '人生之书', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const code = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!code) throw new Error('提取 script 失败');

const SEEDED_MATH = Object.create(Math);
let __seed = 20260914;
SEEDED_MATH.random = function () { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff; };

const store = new Map();
const mkEl = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false, className: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null });
const ctx = {
  console, Math: SEEDED_MATH, JSON, Date, RegExp, String, Number, Array, Object, Boolean, Error, parseInt, parseFloat, isNaN,
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

/* ---------- ① 结果改写的键：canon（去重）× 角度 ---------- */
const ANGLES = [
  '从一个物件写起：先把那件东西写清楚，再写发生了什么。',
  '从一个声音或气味写起：先给一个感官细节，再落到事情本身。',
  '只写动作，不写心情：让人物做一件小事，把情绪留在事外面。',
  '从一个时间点写起：先写那一刻的天色或时辰，再写人。',
];
function resolve(bodyArr, female) {
  const g = female;
  return bodyArr.filter((x) => typeof x === 'string' && x.indexOf('p.ann||') !== 0)
    .map((x) => String(x).replace(/\{ta\}/g, g ? '他' : '她').replace(/\{TA\}/g, g ? '她' : '他').replace(/\{子\}/g, g ? '闺女' : '儿子'))
    .join('\n').trim();
}
const canons = new Set();
for (const key of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[key];
  w.chapters.forEach((c) => (c.choices || []).forEach((ch) => {
    if (typeof ch.body === 'function') return;              /* 与预热脚本一致：函数体取不到确定文本 */
    const arr = Array.isArray(ch.body) ? ch.body : [ch.body];
    for (const female of [false, true]) {
      const t = resolve(arr, female);
      if (t.length >= 12) canons.add(t);
    }
  }));
}
const rewriteKeys = [];
for (const canon of canons) for (const angle of ANGLES) rewriteKeys.push(angle + '\u0000' + canon);

/* ---------- ② 另一种可能的键：确定性采样（与预热脚本同一逻辑） ---------- */
let seed2 = 20260914;
const rnd = () => { seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff; return seed2 / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const hit = new Map();
for (const wk of Object.keys(WORLDLINES)) {
  for (let t = 0; t < ALT_RUNS_PER_LINE; t++) {
    ctx.newGame(wk); ctx.go();
    let g = 0;
    while (ctx.S.phase !== 'end' && g++ < 400) {
      const ph = ctx.S.phase;
      if (ph === 'story') {
        const c = ctx.W.chapters[ctx.S.idx], av = [];
        c.choices.forEach((ch, i) => { if (ch.cond ? ch.cond(ctx.S) : true) av.push(i); });
        ctx.choose(av.length ? pick(av) : -1);
      } else if (ph === 'result') ctx.afterChoice();
      else if (ph === 'event') {
        if (ctx.S.ev) { const l = ctx.eventChoiceList(ctx.S.ev); ctx.chooseEv(l[0].i); continue; }
        ctx.next();
      } else break;
    }
    if (!ctx.S.result) continue;
    const p = ctx.aiAltPick();
    if (!p) continue;
    const x = ctx.S.log[p.i];
    if (!x) continue;
    const key = 'book-alt\u0000' + ctx.W.name + '\u0000' + x.t + '\u0000' + ctx.S.result.end.title;
    hit.set(key, (hit.get(key) || 0) + 1);
  }
}
let altKeys = [...hit.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
if (ALT_MAX) altKeys = altKeys.slice(0, ALT_MAX);

/* ---------- ③ 与缓存做差 ---------- */
const cached = new Set(Object.keys(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))));
const program = [...rewriteKeys, ...altKeys];
const missing = program.filter((k) => !cached.has(k));

console.log(`程序化键 ${program.length} 条（结果改写 ${rewriteKeys.length} + 另一种可能 ${altKeys.length}）`);
console.log(`缓存已有 ${cached.size} 条　→　缺失 ${missing.length} 条`);
if (!missing.length) { console.log('全部命中，无需补漏。'); process.exit(0); }
if (DRY) {
  console.log('--dry：只列缺失，不发请求。前 10 条：');
  missing.slice(0, 10).forEach((k) => {
    const p = k.split('\u0000');
    console.log('  ' + (p[0] === 'book-alt' ? `另一种可能[${p[2]} → ${p[3]}]` : `结果改写[${String(p[1]).slice(0, 18)}… / ${String(p[0]).slice(0, 10)}…]`));
  });
  process.exit(0);   /* 用 process.exit 而不是顶层 return：node - 从 stdin 执行时不允许 return */
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const head = { 'Content-Type': 'application/json' };
if (AUTH) head.Authorization = 'Basic ' + Buffer.from(AUTH).toString('base64');

(async () => {
  let ok = 0, cachedHit = 0, fail = 0;
  for (const key of missing) {
    const p = key.split('\u0000');
    const isAlt = p[0] === 'book-alt';
    const body = isAlt
      ? { kind: 'book-alt', stream: false, pickTitle: p[2], worldline: p[1], ending: p[3], age: 20, main: '灯' }
      : { kind: 'book-rewrite', stream: false, canon: p[1], angle: p[0] };
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const r = await fetch(ENDPOINT, { method: 'POST', headers: head, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        const j = await r.json();
        if (j && j.ok && j.text) {
          done = true; ok++;
          if (j.cached) cachedHit++;
          console.log(`  ✓ ${isAlt ? '另一种可能[' + p[2] + ']' : '结果改写'} ${j.cached ? '(缓存)' : '(新生成)'}`);
        } else if (/429|额度|限流/.test(String(j && j.error))) {
          console.log(`  … 撞限流，等 25s 重试（${isAlt ? p[2] : '改写'}）`);
          await sleep(25000);
        } else {
          console.log(`  ✗ ${isAlt ? p[2] : '改写'}：${j && j.error}`);
          break;
        }
      } catch (e) {
        console.log('  ✗ 请求异常：' + e.message);
        await sleep(5000);
      }
    }
    if (!done) fail++;
    await sleep(GAP);
  }
  console.log(`\n补漏完成：成功 ${ok}（其中命中缓存 ${cachedHit}），失败 ${fail}`);
  console.log('仍失败的多半还是限流——隔一段时间再跑本脚本即可，已补上的会显示为"(缓存)"。');
})();
