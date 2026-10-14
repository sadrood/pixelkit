/* 人生之书 · AI 缓存预热（结果改写 + 另一种可能）
 *
 * 为什么需要：上游 RPM 只有 ~5 次/分钟，而条目是剧本量级的。不预热的话，
 * 前几十个玩家会替你把这些额度吃满，而且他们页面会卡。
 *
 * 两类条目，键都只由「剧本」决定（与玩家无关），所以能被摊薄：
 *   ① 结果改写 kind=book-rewrite   键 = 角度 + 原文        规模 193 × 4 = 772
 *   ② 另一种可能 kind=book-alt     键 = 世界线 + 抉择 + 结局
 *      反事实的键空间约 3150 条（42 抉择 × 15 结局 × 5 线），全量要 10 小时以上，
 *      所以默认**用模拟采样**只取真实出现频率最高的那批（见 --alt-runs / --alt-max）。
 *
 * 幂等且可续跑：已进缓存的会由服务端秒回、不消耗上游额度。
 * 但注意：**续跑仍然要整程走完**（脚本对每条都要 sleep 一次间隔），所以中断后
 * 重跑的成本和首次几乎一样，只是不再烧额度。
 *
 * 目标是谁：缓存活的是 server.js 的**进程内存**，所以必须打**跑着这份代码的那个进程**。
 *
 * 用法：
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs              # 默认：只跑结果改写 772 条
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --alt        # 追加反事实条目（推荐先看 --dry）
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --only-alt   # 只跑反事实
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --dry        # 只统计条目数，不发请求
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --gap 12000  # 自定义间隔毫秒
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --limit 20   # 只跑前 20 条（冒烟/分批）
 *   node docs/人生之书/tools/warm-rewrite-cache.cjs --only-alt --offset 60 --limit 184  # 续跑下一批
 *
 * 反事实相关开关：
 *   --alt-runs N   每条世界线模拟 N 局来采集分岔口（默认 60）
 *   --alt-max K    最多取前 K 条反事实键（默认 260；0 = 不限，那就是 3000+ 条）
 *
 * 环境变量：
 *   BOOK_AI_URL    接口地址，默认 http://127.0.0.1:3001/api/agent/book-ai
 *   BOOK_AI_AUTH   Basic 认证 "用户:密码"；测试环境默认已无登录，通常不需要
 *   BOOK_AI_TIMEOUT_MS  单次请求超时，默认 60000
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const gi = argv.indexOf('--gap');
const GAP = gi >= 0 ? Number(argv[gi + 1]) || 12000 : 12000;
const oi = argv.indexOf('--offset');
const OFFSET = oi >= 0 ? Math.max(0, Number(argv[oi + 1]) || 0) : 0;   /* 跳过队列前 N 条：分批续跑用 */
const li = argv.indexOf('--limit');
const LIMIT = li >= 0 ? Math.max(0, Number(argv[li + 1]) || 0) : 0;   /* 0 = 不限 */
const WITH_ALT = argv.includes('--alt') || argv.includes('--only-alt');
const ONLY_ALT = argv.includes('--only-alt');
const ari = argv.indexOf('--alt-runs');
const ALT_RUNS = ari >= 0 ? Math.max(1, Number(argv[ari + 1]) || 60) : 60;
const ami = argv.indexOf('--alt-max');
const ALT_MAX = ami >= 0 ? Math.max(0, Number(argv[ami + 1]) || 0) : 260;
const ENDPOINT = process.env.BOOK_AI_URL || 'http://127.0.0.1:3001/api/agent/book-ai';
/* 3002（测试环境）默认已无 Basic Auth；若那台机器 .env 里又设了 TEST_AUTH_USER 才需要。 */
const AUTH = process.env.BOOK_AI_AUTH || '';

/* 与客户端 AI_RW_ANGLES 保持一致；改了那边记得同步这里，否则预热全落空 */
const ANGLES = [
  '从一个物件写起：先把那件东西写清楚，再写发生了什么。',
  '从一个声音或气味写起：先给一个感官细节，再落到事情本身。',
  '只写动作，不写心情：让人物做一件小事，把情绪留在事外面。',
  '从一个时间点写起：先写那一刻的天色或时辰，再写人。',
];

/* ---------- 从母本取出所有选项结果原文 ---------- */
const src = fs.readFileSync(path.join(repo, 'docs', '人生之书', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const code = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!code) throw new Error('提取 script 失败');

/* 确定性随机：让「采样哪些抉择」与「引擎内部抽签」都可复现，
   否则每次运行的分岔口标题集会漂，--offset 分批续跑就不可靠。 */
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

/* 客户端送出的 canon 是 tok() 解析过的文本，token 与性别相关，所以两种性别都要覆盖 */
function resolve(bodyArr, female) {
  const g = female;
  return bodyArr.filter((x) => typeof x === 'string' && x.indexOf('p.ann||') !== 0)
    .map((x) => String(x).replace(/\{ta\}/g, g ? '他' : '她').replace(/\{TA\}/g, g ? '她' : '他').replace(/\{子\}/g, g ? '闺女' : '儿子'))
    .join('\n').trim();
}

const canons = new Set();
let skipped = 0, dropped = 0;
for (const key of Object.keys(WORLDLINES)) {
  const w = WORLDLINES[key];
  w.chapters.forEach((c) => {
    (c.choices || []).forEach((ch) => {
      if (typeof ch.body === 'function') { skipped++; return; }   /* 函数体取不到确定文本，跳过 */
      const arr = Array.isArray(ch.body) ? ch.body : [ch.body];
      for (const female of [false, true]) {
        const t = resolve(arr, female);
        if (t.length >= 12) canons.add(t);                        /* 与客户端 aiRwCanon 的下限一致 */
        else dropped++;
      }
    });
  });
}

/* ---------- 反事实条目：用模拟采样找"真实会出现的分岔口" ----------
   客户端的 aiAltPick() = "点灯最多的那一次抉择"（并列取更晚的）。
   这里照抄同一套判定跑若干局，按出现次数排序取前 N 条——只采真实可达的组合，
   比"42 抉择 × 15 结局"的笛卡尔积小一个量级。 */
function collectAlt() {
  let seed = 20260914;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hit = new Map();
  const wlKeys = Object.keys(WORLDLINES);
  for (const wk of wlKeys) {
    for (let t = 0; t < ALT_RUNS; t++) {
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
      const key = wk + '\u0000' + x.t + '\u0000' + ctx.S.result.end.title;
      const cur = hit.get(key) || { n: 0, wk, title: x.t, ending: ctx.S.result.end.title, age: (ctx.W.chapters[x.ch - 1] || {}).age, main: ctx.S.result.ctx.main };
      cur.n++; hit.set(key, cur);
    }
  }
  let list = [...hit.values()].sort((a, b) => b.n - a.n);
  if (ALT_MAX) list = list.slice(0, ALT_MAX);
  return list;
}

/* ---------- 组装条目 ---------- */
const items = [];
if (!ONLY_ALT) {
  for (const canon of canons) for (const angle of ANGLES) {
    items.push({ kind: 'book-rewrite', tag: '结果改写', body: { kind: 'book-rewrite', stream: false, canon, angle } });
  }
}
let altCount = 0;
if (WITH_ALT) {
  for (const a of collectAlt()) {
    altCount++;
    items.push({
      kind: 'book-alt', tag: '另一种可能',
      body: { kind: 'book-alt', stream: false, pickTitle: a.title, worldline: WORLDLINES[a.wk] ? WORLDLINES[a.wk].name : a.wk, ending: a.ending, age: a.age, main: a.main },
    });
  }
}
if (OFFSET) items.splice(0, Math.min(OFFSET, items.length));
if (LIMIT) items.length = Math.min(items.length, LIMIT);

const total = items.length;
console.log(`结果改写原文 ${canons.size} 条（跳过函数体 ${skipped} 条、写不出正文 ${dropped} 条）× ${ANGLES.length} 个角度`);
if (WITH_ALT) console.log(`另一种可能：每条线模拟 ${ALT_RUNS} 局采样 → 取前 ${ALT_MAX || '不限'} 条，实得 ${altCount} 条`);
console.log(`本次待预热 ${total} 条${OFFSET ? `（--offset ${OFFSET} 跳过已暖的）` : ''}${LIMIT ? `（--limit ${LIMIT} 截断）` : ''}`);
console.log(`目标接口 　${ENDPOINT}　${AUTH ? '（带 Basic Auth）' : '（不带 Authorization）'}`);
if (!DRY && !total) { console.log('没有条目可跑，退出。'); return; }
console.log(`间隔 ${GAP}ms + 生成约 1s/条 → 下限 ${Math.ceil((total * (GAP + 1000)) / 60000)} 分钟（真实耗时见进度行 ETA；撞限流会更慢）`);
if (DRY) { console.log('--dry：只统计，不发请求'); return; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rwHead = { 'Content-Type': 'application/json' };
if (AUTH) rwHead.Authorization = 'Basic ' + Buffer.from(AUTH).toString('base64');
const TIMEOUT_MS = Number(process.env.BOOK_AI_TIMEOUT_MS) || 60000;

/* 返回 { ok, status, json, raw, error }。用 text()+手动 JSON.parse 而不是 r.json()：
   401 会返回纯文本「需要密码访问测试环境」，r.json() 直接抛异常，
   就分不清「鉴权没过」和「网络不通」了。 */
async function probeFetch(body) {
  let r;
  try {
    r = await fetch(ENDPOINT, { method: 'POST', headers: rwHead, signal: AbortSignal.timeout(TIMEOUT_MS), body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, status: 0, error: '请求异常: ' + e.message };
  }
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); }
  catch {
    return { ok: false, status: r.status, raw: raw.slice(0, 80).trim(), error: `HTTP ${r.status} 非 JSON 响应: ${raw.slice(0, 60).trim()}` };
  }
  return { ok: !!(json && json.ok && json.text), status: r.status, json };
}

(async () => {
  /* 连通性预检：测试环境默认没密码，但万一 .env 里又把 TEST_AUTH_USER 设回去了，
     401 会让整批全军覆没——宁可开头花一次请求把门问清楚。
     这次预检会生成 1 条无害缓存（原文 "热身预检，可以忽略这一条。"）。 */
  const pre = await probeFetch({ kind: 'book-rewrite', stream: false, canon: '热身预检，可以忽略这一条。', angle: ANGLES[0] });
  if (pre.status === 401 || pre.status === 403) {
    console.error(`\n鉴权失败 HTTP ${pre.status}：该接口现在要 Basic Auth。`);
    console.error('带上凭证再来：BOOK_AI_AUTH=<用户>:<密码> node ' + path.relative(repo, __filename));
    process.exit(2);
  }
  if (pre.ok) console.log('连通性预检 　通过（接口在、能生成）');
  else console.warn(`⚠️  连通性预检异常：${pre.error} —— 先确认接口地址和进程，再放全量。`);

  let done = 0, cached = 0, generated = 0, failed = 0, msSum = 0, msN = 0;
  const t0 = Date.now();
  for (const item of items) {
    done++;
    const t1 = Date.now();
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = await probeFetch(item.body);
      if (res.ok) {
        ok = true;
        if (res.json.cached) cached++; else generated++;
      } else if (res.status === 401 || res.status === 403) {
        console.error(`\n鉴权失败 HTTP ${res.status}：该接口要 Basic Auth。`);
        console.error('带上凭证再来：BOOK_AI_AUTH=<用户>:<密码> node ' + path.relative(repo, __filename));
        process.exit(2);
      } else if (/429|额度|限流/.test(String(res.json && res.json.error))) {
        await sleep(20000);                                    /* 撞限流就多等一会 */
      } else {
        console.error(`  失败[${item.tag}]:`, res.error || (res.json && res.json.error));
        if (res.error) await sleep(5000);
      }
    }
    if (!ok) failed++;
    msSum += Date.now() - t1; msN++;
    if (done % 10 === 0 || done === total) {
      const avg = msSum / msN;                                  /* 每条真实耗时（含重试与限流等待） */
      const etaMin = Math.ceil(((total - done) * avg) / 60000);
      console.log(`  进度 ${done}/${total}　新生成 ${generated}　命中缓存 ${cached}　失败 ${failed}　`
        + `均 ${(avg / 1000).toFixed(1)}s/条　剩余约 ${etaMin} 分钟`);
    }
    await sleep(GAP);
  }
  const mins = (Date.now() - t0) / 60000;
  console.log(`\n完成：新生成 ${generated}，命中缓存 ${cached}，失败 ${failed}，本次耗时 ${mins.toFixed(1)} 分钟（${(msSum / msN / 1000).toFixed(1)}s/条）`);
  console.log('失败的多半是撞限流，直接重跑本脚本即可续上（已缓存的会秒回，但整程仍要走一遍）。');
})();
