/**
 * 小说阅读器 —— 书源抓取代理
 *
 * 为什么必须有这一层（2026-10-19 实测，不是推测）：
 *   浏览器直连小说站会被四件事同时挡死：
 *     ① 跨域：这些站**不返回** Access-Control-Allow-Origin，fetch 直接被浏览器拦在预检，
 *        连请求都发不出去；
 *     ② UA 拦截：curl 裸请求 101kks.com / yaoluku.com 均返回 **403**，
 *        换正常 UA + Referer 后依然 403（Cloudflare 在前面）；
 *     ③ 编码：书源里 GBK 与 UTF-8 混用（御书屋、格格党、四季书屋都声明 charset: gbk），
 *        不解 GBK 拿到的是乱码；
 *     ④ 规则：书源大量使用 `@js:` 规则，依赖 Legado 的 Android Java 运行环境
 *        （Packages.org.jsoup / java.put / cookie.getKey），浏览器没有这套东西。
 *
 *   所以：前端只管排版与翻页，所有跨站请求、编码转换、规则解析都在这里完成。
 *
 * 能力边界（说在前面，别指望）：
 *   - 支持：CSS 选择器规则、JSONPath 规则、POST/GET 搜索、GBK/UTF-8 转码、请求头注入；
 *   - 不支持：`@js:` 规则（依赖 Android Java 环境），这类书源导入时会标记「暂不支持」，
 *     仍可导入、不报错，只是搜不出结果。不做沙箱执行 —— 跑第三方站点的任意 JS
 *     等于把你的服务器变成别人的执行器，这个风险不值得。
 *
 * 无外部依赖：用 Node 内置 TextDecoder 解 GBK，用正则实现所需的 CSS 选择器子集。
 */

import { Router } from 'express';

/* ============================================================
   一、HTTP 抓取（含 UA 伪装、编码转码）
   ============================================================ */

/** 移动端 UA —— 多数小说站对移动 UA 宽容度明显高于桌面 UA。 */
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 按字节内容 + 声明编码解码。
 *
 * 为什么不信任响应头：实测不少小说站的 charset 是错的或干脆没有，
 * 所以顺序是「显式声明 > HTML meta > 默认 UTF-8」。
 */
function normalizeCharset(c) {
  let s = String(c || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (s === 'utf8') s = 'utf-8';
  // gb2312 是 gbk 子集，按 gbk 解更安全（能多解出生僻字）
  if (s === 'gb2312' || s === 'gb18030') s = 'gbk';
  return s;
}

/**
 * 按字节内容 + 多处声明解码。
 *
 * 优先级是「书源显式声明 > HTTP 响应头 > HTML meta > 默认 UTF-8」。
 *
 * 两个实测踩过的坑：
 *  ① 早先版本试图**在 body 字节里**搜 charset 来找"响应头" —— 响应头根本不在
 *     body 里，那段搜索永远匹配不到，等于把「响应头」这一档整个废掉了。
 *     现在 headerCharset 由 fetchPage 从 res.headers 传进来。
 *  ② 乱码自愈：站点的声明经常是错的（声明 gbk 实际发 utf-8 也有，反之更多）。
 *     所以解完之后统一过一道 looksLikeMojibake，判定为乱码就换另一种编码重解。
 */
function decodeBody(buf, declared, headerCharset) {
  // 1) 书源显式声明 —— 作者最清楚自己在抓什么
  let charset = normalizeCharset(declared);

  // 2) HTTP 响应头
  if (!charset) charset = normalizeCharset(headerCharset);

  // 3) HTML meta 标签
  if (!charset) {
    const m = /<meta[^>]+charset=["']?([a-z0-9_-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'));
    if (m) charset = normalizeCharset(m[1]);
  }

  charset = charset || 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf-8');   // 未知编码名，退回 UTF-8 而不是抛异常
  }
}

/**
 * 乱码判定 + 自愈。
 *
 * GBK 与 UTF-8 互相误读时，产出的都是**合法字符**（不是乱码符号），
 * 所以不能靠"看有没有问号"来判断，只能两种都解一遍再比可读性分数。
 */
function decodeSmart(buf, declared, headerCharset) {
  const primary = normalizeCharset(declared) || normalizeCharset(headerCharset) || 'utf-8';
  const alt = primary === 'gbk' ? 'utf-8' : 'gbk';

  const first = decodeBody(buf, declared, headerCharset);
  const firstScore = decodeScore(first);

  // 两种解法都算一遍，分数高的胜出。代价只是多解一遍字符串，很便宜。
  const second = decodeBody(buf, alt === 'gbk' ? 'gbk' : 'utf-8', '');
  const secondScore = decodeScore(second);

  if (secondScore > firstScore + 0.05) return second;
  return first;
}

/**
 * 给一段解码结果打「可读性分数」（越高越像正常中文/英文）。
 *
 * 为什么需要它（2026-10-19 实测踩到）：
 *   猜「哪些字符是乱码字符」行不通。GBK 解 UTF-8 时产生的是**合法汉字**
 *   （「斗破苍穹」→「鏂楃牬鑻嶇┕」），既不是替换字符 0xFFFD，也不在私用区，
 *   早先那套基于码位区间的检测完全判不出来。
 *
 *   换的思路：不解出结果谁对谁错，而是**两种都解一遍，谁更像人话用谁**。
 *   判据用「常用字占比」——UTF-8 被误当 GBK 时，汉字里会混入大量生僻字和扩展区字，
 *   而正常中文里常用字（按出现频率最高的那批）占绝大多数。
 */

// 常用汉字表：用最常用的一批字做基准。刻意不求全，能把"正常中文"和"误码"分开就够。
// 用 Set 而不是正则：汉字里没有需要转义的字符，但正则字符类对 "]" 这类字面量很敏感，
// 早先用正则写过一次，直接踩了 "Invalid regular expression: missing /"。
const COMMON_HAN_SET = new Set(
  '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动'
    .split('')
);
// 明显不该出现在中文页面里的区段：私用区、CJK 扩展区
const isBadRange = (cp) => (cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0x20000 && cp <= 0x3FFFF);
/** 解码质量分：-1（明显坏）到 1（很好）。两种解法比谁分高，谁就是对的。 */
function decodeScore(s) {
  if (!s) return -1;
  const n = Math.min(s.length, 4000);
  const sample = s.slice(0, n);

  let bad = 0, rare = 0, han = 0, common = 0;
  for (let i = 0; i < n; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xFFFD) { bad++; continue; }
    if (isBadRange(c)) { rare++; continue; }
    // 基本汉字区：U+3400–U+9FFF（不含标点）
    if (c >= 0x4E00 && c <= 0x9FFF) {
      han++;
      if (COMMON_HAN_SET.has(sample[i])) common++;
    }
  }

  // 替换字符一票否决
  if (bad / n > 0.005) return -1;

  // 没有汉字的页面（纯代码/纯英文）不参与判定，返回中性
  if (han < 20) return 0.5;

  const commonRatio = common / han;              // 常用字在汉字里的占比
  const rareRatio = rare / Math.max(1, han + rare);

  // 正常中文：常用字占比通常 > 0.35，生僻区字几乎没有
  // 误码：常用字占比掉到 0.1 以下，生僻字明显上升
  return commonRatio * 1.5 - rareRatio * 2;
}

/** 旧接口保留给测试用：判定是否明显乱码（现在基于 decodeScore） */
function looksLikeMojibake(s) {
  return decodeScore(s) < 0.15;
}

/** UTF-8 被误当 GBK 的特征：解出大量生僻字/扩展区字，且常用字稀少。 */
function looksLikeWrongGbk(s) {
  if (!s || s.length < 40) return false;
  return decodeScore(s) < 0.35;
}

/**
 * 抓一个 URL，返回 { html, status, url }。
 * failed：true 表示对方站点拒绝（403/验证码），前端要据此提示「换个书源」而不是报网络错误。
 */
async function fetchPage(url, opts = {}) {
  const {
    method = 'GET', body = null, headers = {},
    charset = '', referer = '', timeout = 15000, ua = 'mobile',
  } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    // HTTP 头只能是 Latin-1；书源里写进的中文（多在 Referer）会让 fetch 直接抛错
    const safe = (v) => String(v).replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
    const merged = {
      'User-Agent': ua === 'desktop' ? DESKTOP_UA : MOBILE_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(referer ? { Referer: referer } : {}),
      ...headers,
    };
    const res = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, safe(v)])),
    });

    const buf = Buffer.from(await res.arrayBuffer());
    // 响应头里的 charset —— 之前完全没用过，导致这一档判据形同虚设
    const headerCharset = (res.headers.get('content-type') || '').match(/charset=["']?([a-z0-9_-]+)/i)?.[1] || '';
    let html = decodeSmart(buf, charset, headerCharset);

    return { html, status: res.status, url: res.url || url, cf: detectCloudflare(html, res.status) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 识别 Cloudflare 拦截/故障页。
 *
 * 为什么要单独识别（2026-10-19 实测踩到）：
 *   用户给的这份书源，逐个探测后发现 101kks.com / yaoluku.com 返回的都是
 *   **521 · Cloudflare**，响应体是 CF 的宕机页 —— 也就是说源站自己挂了，
 *   不是我们的请求被拒。如果只报"403 换个书源"，用户会去反复换源、
 *   怀疑是阅读器的问题，而真实情况是那份书源大面积失效。
 *
 *   521/522/523 = 源站不可达（换源有用）
 *   403 + challenge = 需要过验证（换源有用，但要换能过的源）
 */
function detectCloudflare(html, status) {
  const head = String(html || '').slice(0, 3000);
  if (status === 521 || status === 522 || status === 523) return { kind: 'origin-down', code: status };
  if (/521\s*·\s*Cloudflare|Web server is returning an unknown error/i.test(head)) return { kind: 'origin-down', code: 521 };
  if (status === 403 && /cf-browser-verification|challenge-platform|cf_chl_opt|Just a moment/i.test(head)) return { kind: 'challenge', code: 403 };
  if (status === 403 && /Attention Required!/i.test(head)) return { kind: 'waf', code: 403 };
  return null;
}

/** 把 CF 状态翻译成人话 —— 前端直接显示这句 */
export function describeFetchFailure(cf, status) {
  if (!cf) {
    if (status === 403) return { hint: '对方站点拒绝了服务器请求，通常是加了防火墙或需要登录 Cookie', retryable: false };
    if (status === 404) return { hint: '接口地址不存在，可能是书源规则里的链接改版了', retryable: false };
    if (status === 429) return { hint: '对方限制了访问频率，稍后再试', retryable: true };
    return { hint: `对方返回 ${status}`, retryable: false };
  }
  if (cf.kind === 'origin-down') return { hint: '源站宕机（Cloudflare ' + cf.code + '），这个书源暂时用不了', retryable: true };
  if (cf.kind === 'challenge') return { hint: '需要通过人机验证，服务器抓不到，请换用其它书源', retryable: false };
  if (cf.kind === 'waf') return { hint: '被对方防火墙拦截，换用其它书源', retryable: false };
  return { hint: '请求被拒', retryable: false };
}

/* ============================================================
   二、CSS 选择器子集（够用即可，不追求完整实现）
   ============================================================

   支持：tag / .class / #id / [attr] / [attr="v"] / 后代 / 子代(空格)
        伪类 :first-child :last-child :nth-child(n) :eq(n)
        伪元素 ::text ::html （这两个是 Legado/CSS 惯例，业界小说站规则常用）
        逗号并列
   不支持：> + ~ 相邻、:has()、复杂伪函数
   ============================================================ */

const attrCache = new Map();

/** 解析单个复合选择器，如 `div.book-item a[href^=/book/]:eq(0)` */
function parseCompound(str) {
  const out = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  // 先把伪类摘出来，避免里面的 [ ] 干扰属性解析
  const pseudoRe = /::?(text|html|first-child|last-child|nth-child|eq)\s*(\(([^)]*)\))?/gi;
  let m;
  while ((m = pseudoRe.exec(str))) {
    const name = m[1].toLowerCase();
    const arg = (m[3] || '').trim().replace(/^['"]|['"]$/g, '');
    if (name === 'text') out.pseudos.push({ name: 'text' });
    else if (name === 'html') out.pseudos.push({ name: 'html' });
    else if (name === 'first-child') out.pseudos.push({ name: 'first-child' });
    else if (name === 'last-child') out.pseudos.push({ name: 'last-child' });
    else if (name === 'nth-child' || name === 'eq') out.pseudos.push({ name: 'nth-child', n: parseInt(arg, 10) || 0 });
  }
  const clean = str.replace(pseudoRe, ' ');

  const tagM = /^([a-zA-Z][\w-]*)/.exec(clean.trim());
  if (tagM) out.tag = tagM[1].toLowerCase();
  rest: for (const piece of clean.trim().slice(tagM ? tagM[0].length : 0).match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (piece[0] === '.') out.classes.push(piece.slice(1));
    else if (piece[0] === '#') out.id = piece.slice(1);
    else if (piece[0] === '[') {
      const am = /^\[\s*([\w-]+)\s*(\^=|\$=|\*=|=)?\s*["']?([^\]"']*)["']?\s*\]/.exec(piece);
      if (am) out.attrs.push({ name: am[1], op: am[2] || null, value: am[3] });
    }
  }
  return out;
}

/** 按逗号切分选择器组 */
function splitGroup(sel) {
  const parts = [];
  let depth = 0, buf = '', inBr = false, inQuote = null;
  for (const ch of sel) {
    if (inQuote) { buf += ch; if (ch === inQuote) inQuote = null; continue; }
    if (ch === '"' || ch === "'") { inQuote = ch; buf += ch; continue; }
    if (ch === '[') inBr = true;
    else if (ch === ']') inBr = false;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && !inBr && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

/** 惰性解析选择器并缓存 */
function parseSelector(sel) {
  if (attrCache.has(sel)) return attrCache.get(sel);
  const groups = splitGroup(String(sel || '').trim()).map(g =>
    g.split(/\s+/).filter(Boolean).map(parseCompound)
  ).filter(g => g.length);
  const parsed = groups;
  if (attrCache.size > 3000) attrCache.clear();
  attrCache.set(sel, parsed);
  return parsed;
}

/* ---------------- HTML → DOM ---------------- */

const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const BLOCK_TAGS = new Set(['p','div','br','section','article','h1','h2','h3','h4','h5','h6','li','tr','blockquote','pre','hr','table','ul','ol','dd','dt']);

/** 解析 HTML 为轻量节点树（够做选择器与正文提取，不追求完整性）。 */
export function parseHtml(html) {
  // 先摘掉 script / style / noscript 的**内容**。
  // 否则 JS 里写的 '<div class="item">' 会被当成真节点 —— 选择器会命中假数据
  // （实测：3 个真实 .item 会变成 4 个，多出来的来自 script 字符串）。
  const cleaned = String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '<style></style>')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '<noscript></noscript>');

  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const tagRe = /<!--[\s\S]*?-->|<!\[[\s\S]*?\]>|<![^>]*>|<\/([a-zA-Z][\w-]*)[^>]*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

  let m;
  let last = 0;
  while ((m = tagRe.exec(cleaned))) {
    // 标签之间的文本
    if (m.index > last) {
      const text = cleaned.slice(last, m.index);
      if (text.trim()) cur.children.push({ tag: '#text', text, parent: cur });
    }
    last = tagRe.lastIndex;

    if (m[0].startsWith('<!')) continue;                 // 注释 / doctype
    if (m[1]) {                                            // 闭合标签
      let n = cur;
      while (n && n.tag !== m[1].toLowerCase() && n.parent) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = {};
    const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[3] || ''))) {
      if (!a[1]) continue;
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!VOID_TAGS.has(tag) && !m[4]) cur = node;
  }
  if (last < cleaned.length) {
    const text = cleaned.slice(last);
    if (text.trim()) cur.children.push({ tag: '#text', text, parent: cur });
  }
  return root;
}

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–' };
    return map[g.toLowerCase()] ?? m;
  });
}

/**
 * 规则取到的片段可能是 HTML（Legado 的 `@html` / `::html` 取的就是标签本身，
 * 例如 `.text@html`、`#content@html`），而阅读器按纯文本渲染。
 * 这里把块级标签换成换行、其余标签剥掉，再解实体。
 */
function htmlToText(raw) {
  const s = String(raw == null ? '' : raw);
  if (!/<[a-z!/][^>]*>/i.test(s)) return s.trim();
  return decodeEntities(
    s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|dd|dt|td)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 计算某节点在「它自己的直接父节点下」的排名（1 起，只数元素，不数文本节点）。
 * 用于 :first-child / :last-child —— 这两个是 CSS 标准语义，按元素兄弟算。
 * （:eq() 不走这里，它在 queryAll 的集合层结算，见 idxPosKey 的说明。）
 */
function indexAmongSiblings(node) {
  if (!node.parent) return 1;
  let i = 0;
  for (const c of node.parent.children) {
    if (c.tag === '#text') continue;
    i++;
    if (c === node) return i;
  }
  return 1;
}

function matchesCompound(node, cp) {
  if (node.tag === '#text' || !node.tag) return false;
  if (cp.tag && node.tag !== cp.tag) return false;
  if (cp.id && node.attrs.id !== cp.id) return false;
  for (const c of cp.classes) {
    const cl = (node.attrs.class || '').split(/\s+/);
    if (!cl.includes(c)) return false;
  }
  for (const at of cp.attrs) {
    const v = node.attrs[at.name];
    if (v === undefined) return false;
    if (at.op === '=' && v !== at.value) return false;
    if (at.op === '^=' && !v.startsWith(at.value)) return false;
    if (at.op === '$=' && !v.endsWith(at.value)) return false;
    if (at.op === '*=' && !v.includes(at.value)) return false;
  }
  for (const ps of cp.pseudos) {
    if (ps.name === 'first-child' && indexAmongSiblings(node) !== 1) return false;
    if (ps.name === 'last-child') {
      const sibs = (node.parent?.children || []).filter(c => c.tag !== '#text');
      if (sibs[sibs.length - 1] !== node) return false;
    }
    // :eq(n) / :nth-child(n) 在 queryAll 的集合层结算，这里不参与单节点判定
  }
  return true;
}

/** 后代匹配：从右往左逐段回溯祖先。 */
function matchesSeq(node, seq) {
  if (!matchesCompound(node, seq[seq.length - 1], null)) return false;
  let i = seq.length - 2;
  let p = node.parent;
  while (i >= 0 && p) {
    if (matchesCompound(p, seq[i], null)) i--;
    p = p.parent;
  }
  return i < 0;
}

/**
 * Legado 的 :eq(n) 语义 = 「在整份文档所有匹配该选择器的节点里，取第 n 个」。
 *
 * 注意它**不是** jQuery 的 "eq within parent"：
 *   <div class=w><span/><a>A</a><a>B</a></div>
 *   jQuery 的 $('a:eq(1)') 在每个父节点内取 → 这里恰好也对
 *   但 <div class=i><a>A</a></div><div class=i><a>B</a></div>
 *   同一个父节点里都只有 1 个 a，按"父内排名"永远取不到第 2 个，
 *   而书源作者写 :eq(1) 的意图显然是"第二个搜索结果"—— 结果条目本来就是平铺的。
 * 所以 :eq 必须在**全局匹配集**上结算，不能在匹配单个节点时判定。
 *
 * 实现方式：先收集不含 :eq/:nth-child 的基础匹配，再按出现顺序切。
 */
const INDEX_PSEUDO = new Set(['eq', 'nth-child']);

/**
 * 给「去掉了索引伪类」的选择器序列生成一个稳定 key。
 * 目的是让 .it a:eq(1) 与 .it a:eq(2) 落到同一个池子里 —— 否则两者各自建池，
 * 结果永远是各自的第 0 个，等于索引失效。
 * 同时把序列登记到 keyToSeq，供建池时还原成可匹配的结构选择器。
 */
const keyToSeq = new Map();
function compoundKey(cp) {
  let s = cp.tag || '';
  if (cp.id) s += '#' + cp.id;
  for (const c of cp.classes) s += '.' + c;
  for (const a of cp.attrs) s += `[${a.name}${a.op || ''}"${a.value}"]`;
  for (const p of cp.pseudos) if (!INDEX_PSEUDO.has(p.name)) s += ':' + p.name;
  return s || '*';
}
/**
 * 给「去掉了索引伪类」的选择器序列生成一个稳定 key。
 *
 * 目的是让 .it a:eq(1) 与 .it a:eq(2) 落到同一个池子里 —— 否则两者各自建池，
 * 结果永远是各自的第 0 个，等于索引失效。
 *
 * 注意：只移除索引伪类，tag/class/id/属性一个都不能丢。
 * 早先版本把索引所在的整段替换成 '*'，结果 <div class=w><span>S</span><a>A</a></div>
 * 的候选池变成 [.w 下所有元素]，[span, a, a, a] —— span 挤进池子占了第 0 位，
 * 于是 :eq(0) 返回 'S'、:eq(1) 才返回 'A'，整体错位一位。
 */
function idxPosKey(seq, pi) {
  const key = seq.map((cp, i) => (i === pi ? compoundKey(cp) : compoundKey(cp))).join(' ');
  if (!keyToSeq.has(key)) {
    // 候选池用的序列：结构判定完全忽略索引伪类
    keyToSeq.set(key, seq.map(cp => ({
      tag: cp.tag, id: cp.id, classes: cp.classes, attrs: cp.attrs,
      pseudos: cp.pseudos.filter(p => !INDEX_PSEUDO.has(p.name)),
    })));
  }
  return key;
}

export function queryAll(root, sel) {
  const groups = parseSelector(sel);
  const baseOut = [];
  const idxTasks = [];         // { seq, cpIndex, poolKey }

  // 先算出每个复合选择器里"索引伪类所在的位置"（-1 表示没有）
  const idxPos = groups.map(seq => seq.findIndex(cp => cp.pseudos.some(ps => INDEX_PSEUDO.has(ps.name))));

  const walk = (n) => {
    for (const c of n.children) {
      if (c.tag === '#text') continue;
      for (let gi = 0; gi < groups.length; gi++) {
        const seq = groups[gi];
        const pi = idxPos[gi];
        if (pi < 0) {
          // 纯结构选择器：直接判定
          if (matchesSeq(c, seq)) baseOut.push(c);
        } else {
          // 含 :eq/:nth-child —— 这类选择器是"集合内定位"语义，
          // 不能靠匹配单个节点判断。登记下来，最后按 poolKey 统一结算。
          // poolKey 用「去掉索引伪类后的结构选择器字符串」，
          // 这样 .it a:eq(1) 和 .it a:eq(2) 共用同一个候选池，索引才可比。
          const key = idxPosKey(seq, pi);
          if (key) idxTasks.push({ seq, cpIndex: pi, key });
        }
      }
      walk(c);
    }
  };
  walk(root);

  if (!idxTasks.length) return baseOut;

  // 按 poolKey 分桶：同一个结构选择器共用一个候选池
  const pools = new Map();
  for (const t of idxTasks) {
    if (!pools.has(t.key)) {
      const seqOfKey = keyToSeq.get(t.key) || t.seq;
      const cands = [];
      const w2 = (n) => {
        for (const c of n.children) {
          if (c.tag === '#text') continue;
          if (matchesSeq(c, seqOfKey)) cands.push(c);
          w2(c);
        }
      };
      w2(root);
      pools.set(t.key, cands);
    }
  }

  const out = [];
  const outSet = new Set();
  const push = (n) => { if (n && !outSet.has(n)) { outSet.add(n); out.push(n); } };
  for (const n of baseOut) push(n);
  for (const t of idxTasks) {
    const cp = t.seq[t.cpIndex];
    const ps = cp.pseudos.find(x => INDEX_PSEUDO.has(x.name));
    // 只 push 被索引命中的那个；没命中就是空结果，不回退到全量
    push(pools.get(t.key)?.[ps.n]);
  }
  // 按文档顺序还原
  const order = [];
  const collect = (n) => { for (const c of n.children) { if (c.tag !== '#text') { order.push(c); collect(c); } } };
  collect(root);
  const pos = new Map(order.map((n, i) => [n, i]));
  return out.sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
}

export function queryOne(root, sel) {
  // 复用 queryAll：:eq() 是集合层语义，若在这里自己走 BFS，
  // 就会把"匹配到就返回"的短路逻辑用在索引伪类上，永远返回第 1 个。
  const all = queryAll(root, sel);
  return all.length ? all[0] : null;
}

/* ---------------- 节点 → 文本 / HTML ---------------- */

export function nodeText(node) {
  if (!node) return '';
  if (node.tag === '#text') return decodeEntities(node.text);
  let s = '';
  for (const c of node.children) {
    if (c.tag === '#text') s += decodeEntities(c.text);
    else if (c.tag === 'br') s += '\n';
    else if (c.tag === 'script' || c.tag === 'style') continue;
    else s += nodeText(c);
  }
  return s.replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const NODE_TEXT_PURE = new Set(['script', 'style', 'noscript', 'iframe', 'svg']);

/** 正文提取：块级标签之间补换行，其余压成纯文本。 */
export function nodeContent(node) {
  if (!node) return '';
  let s = '';
  for (const c of node.children) {
    if (c.tag === '#text') { s += decodeEntities(c.text); continue; }
    if (NODE_TEXT_PURE.has(c.tag)) continue;
    if (c.tag === 'br') { s += '\n'; continue; }
    s += nodeContent(c);
    if (BLOCK_TAGS.has(c.tag)) s += '\n\n';
  }
  return s
    .replace(/[ \t 　]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/* ============================================================
   三、书源规则求值
   ============================================================ */

/**
 * Legado 里 URL 之后用 `,{json}` 跟请求参数。
 *
 * 两个坑（都实测踩过）：
 *  ① JSON 参数里常带换行（多行书写习惯），所以不能只找第一个 `,{` 就切，
 *     必须做括号/引号配平，找到**与 URL 同一层**的那个逗号；
 *  ② 参数未必是合法 JSON（老书源经常多逗号），解析失败要退化成"没有参数"，
 *     而不是抛异常把整个搜索带崩。
 */
export function splitUrlRule(raw) {
  const s = String(raw == null ? '' : raw);

  // 扫描找配平的 `,{`。
  // 注意不能写 `s[i+1]==='{'`：书源常写成 "url,\n{json}"（逗号后换行），
  // 实测这种写法会让整个参数被当成 URL 的一部分，导致 method/body 全丢。
  let depth = 0, inStr = null, cut = -1;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      // 逗号后跳过空白，看是不是 `{`
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '{') { cut = i; break; }
    }
  }
  if (cut < 0) return { url: s.trim(), opts: {} };

  const url = s.slice(0, cut).trim();
  const tail = s.slice(cut + 1).trim();
  let opts = {};
  try {
    opts = JSON.parse(tail);
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) opts = {};
  } catch {
    // 容错：部分书源在 } 后多跟了内容，或用了单引号 —— 抠出最外层大括号再试一次
    const start = tail.indexOf('{');
    const end = tail.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const inner = tail.slice(start, end + 1).replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":').replace(/'([^']*)'/g, '"$1"');
        const o = JSON.parse(inner);
        if (o && typeof o === 'object') opts = o;
      } catch { opts = {}; }
    }
  }
  return { url, opts };
}

const isJsRule = (r) => /^\s*@js:/.test(String(r || '')) || /^\s*<js>/.test(String(r || ''));

/**
 * 解析一个取值规则（Legado 的"规则串"）。
 * 支持三种写法，用 `<>` 或换行分隔多值（取第一条命中的）。
 */
/**
 * 求值一个取值规则。
 *
 * @param {object} opts
 * @param {boolean} opts.block  true = 按块级结构提取（块标签之间补换行），
 *                             正文必须用它；标题/作者这类单值用默认的 nodeText 即可。
 */
export function evalRule(rule, root, baseUrl = '', opts = {}) {
  const ruleStr = String(rule == null ? '' : rule).trim();
  if (!ruleStr) return null;
  if (isJsRule(ruleStr)) return null;                     // @js 不执行，返回 null 让上层降级

  for (const one of splitAlternatives(ruleStr)) {
    const sel = one.trim();
    if (!sel) continue;

    // 纯 JS 表达式风格：以 < 或 @ 开头的都不是 CSS 选择器
    if (sel[0] === '<' || sel[0] === '@') continue;

    // JSONPath 风格：$.foo.bar
    if (/^\$\.?[\w[\]*.]+$/.test(sel)) {
      try {
        const v = jsonPath(root, sel);
        if (v !== null && v !== undefined && v !== '') return v;
      } catch { /* 路径不存在就试下一个 */ }
      continue;
    }

    if (/^[a-z]+:/i.test(sel)) continue;                   // 其它协议前缀，忽略

    // 默认取 ::text，其次 ::html
    const hasText = /::text\s*$/.test(sel);
    const hasHtml = /::html\s*$/.test(sel);
    const bare = sel.replace(/::(?:text|html)\s*$/, '').trim();

    /**
     * Legado 的 @attr 后缀：`a@href`、`meta[property="og:image"]@content`。
     * 选择器引擎会忽略 `@…`，所以必须在这里拆出来按属性取值，
     * 否则 a@href 返回的是链接文字（早先章节名被当成 URL 就是这个原因）。
     */
    let attr = '';
    let cssBare = bare;
    const at = bare.match(/@([\w-]+)\s*$/);
    if (at) {
      attr = at[1];
      cssBare = bare.slice(0, at.index).trim();
    }

    let nodes = [];
    try { nodes = queryAll(root, cssBare); } catch { nodes = []; }
    if (!nodes.length) continue;

    if (hasHtml || /^html$/i.test(attr)) return nodes.map(n => outerHtml(n)).join('\n');

    if (attr && !/^(text|textNodes|textContent)$/i.test(attr)) {
      const vals = nodes.map(n => n.attrs?.[attr]).filter(v => v != null && String(v).trim());
      if (vals.length) return vals.map(v => String(v).trim()).join('\n');
      continue;                                              // 属性全空 → 试下一个备选规则
    }

    /**
     * block 模式用 nodeContent 而不是 nodeText：
     * nodeText 只累加子节点文字，**块级标签之间不补换行**，
     * 于是 <p>第一段</p><p>第二段</p> 会拼成「第一段第二段」一整行。
     * 正文按行做广告过滤时，这一整行只要含「上一章」就被整段丢掉 ——
     * E2E 里正文返回空字符串就是这个原因。
     */
    const take = opts.block ? nodeContent : nodeText;
    return nodes.map(take).filter(Boolean).join('\n');
  }
  return null;
}

/** 取第一条：evalRule 的单值版本（找不到回退到 attr 规则）。 */
function evalValue(rule, root, attr) {
  const v = evalRule(rule, root);
  if (v && String(v).trim()) return String(v).trim();
  if (attr) {
    const nodes = queryAll(root, String(rule).replace(/::(?:text|html)\s*$/, '').trim());
    for (const n of nodes) {
      const a = n.attrs?.[attr];
      if (a) return String(a).trim();
    }
  }
  return '';
}

/** `<a|b|c>`、`a || b` 或换行分隔 → 数组 */
function splitAlternatives(s) {
  if (s.includes('<')) {
    const inner = s.slice(s.indexOf('<') + 1, s.lastIndexOf('>'));
    return inner.split('|').map(x => x.trim()).filter(Boolean);
  }
  return s.split(/\|\||\n/).map(x => x.trim()).filter(Boolean);
}

/** 极简 JSONPath：支持 $.a.b[0].c 与 a.b[0] */
function jsonPath(root, path) {
  const clean = path.replace(/^\$\.?/, '');
  if (!clean) return root;
  let cur = root;
  for (const seg of clean.split('.')) {
    if (!seg) continue;
    const m = /^([\w-]+)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return null;
    const keys = Object.keys(cur || {});
    const key = keys.find(k => k.toLowerCase() === m[1].toLowerCase());
    if (key === undefined) return null;
    cur = cur[key];
    if (m[2] !== undefined) cur = Array.isArray(cur) ? cur[Number(m[2])] : null;
    if (cur === null || cur === undefined) return null;
  }
  return cur;
}

export function outerHtml(node) {
  if (node.tag === '#text') return decodeEntities(node.text);
  const attrs = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(outerHtml).join('')}</${node.tag}>`;
}

/* ============================================================
   四、URL 组装
   ============================================================ */

function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => {
    let v = vars;
    for (const seg of k.split('.')) v = v?.[seg];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * bookSourceUrl 常带 #注释（Legado 用户习惯，如 https://a.com#修改）。
 * 它不能直接用来拼路径或当 Referer：中文片段会让 fetch 抛 ByteString 错误。
 */
const siteBase = (src) => String(src?.bookSourceUrl || '').replace(/#.*$/, '').replace(/\/+$/, '');

export function buildUrl(source, template, vars) {
  const { url, opts } = splitUrlRule(template);
  let full = fillTemplate(url, vars);
  // 相对路径补全（书源常写 /search/xxx 不带域名）
  if (/^\/(?!\/)/.test(full) && source?.bookSourceUrl) {
    full = siteBase(source) + full;
  }
  const charset = opts.charset || source?.charset || '';
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = { ...(opts.headers || {}) };
  let body = null;

  if (method !== 'GET' && opts.body != null) {
    const raw = fillTemplate(String(opts.body), vars);
    if (/^\s*[{[]/.test(String(opts.body))) {
      body = raw;
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    } else {
      // 表单体。书源里常是多行书写，例如：
      //   "body": "s={{key}}\n&type=articlename"
      // 去掉换行与缩进、JSON 里残留的花括号和引号，再 URL 编码。
      const flat = raw.replace(/[\r\n\t]+/g, '').replace(/["{}]/g, '').trim();
      body = new URLSearchParams(flat).toString();
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
  }
  return { url: full, method, body, charset, headers };
}

/* ============================================================
   五、三个核心动作：搜索 / 详情 / 目录 / 正文
   ============================================================ */

/**
 * 书源能力自检 —— 决定一个源能不能用，以及为什么不能用。
 *
 * @js 规则依赖 Legado 的 Android Java 运行环境（Packages.org.jsoup / java.put /
 * cookie.getKey），这套东西在 Node 里不存在。这里选择**不执行**而不是用 vm 沙箱
 * 模拟：跑第三方站点书源里的任意 JS，等于把你的服务器变成对方的执行器，
 * 风险远大于收益。代价是这类源搜不出结果，导入时如实标记即可。
 */
export function sourceCapability(src) {
  const r = src?.ruleSearch || {};
  const vals = (v) => (typeof v === 'string' ? [v] : Object.values(v || {}));
  const rules = [
    ...vals(r.bookList), ...vals(r.name), ...vals(r.author),
    ...vals(src?.ruleBookInfo?.intro), ...vals(src?.ruleToc?.chapterList), ...vals(src?.ruleContent?.content),
  ];
  // searchUrl 里可能夹着 <js>…</js> 片段（buildUrl 不执行 JS），整条规则就不能用
  const usesJs = rules.some(isJsRule) || /@js:|<js>/i.test(String(src?.searchUrl || ''));
  const noSearch = !src?.searchUrl;
  return { usesJs, noSearch, usable: !usesJs && !noSearch };
}

async function searchInSource(src, keyword, page = 1) {
  const { url, method, body, charset, headers } = buildUrl(src, src.searchUrl, { key: keyword, page, pageKey: page });
  if (!url) return { error: '该书源没有搜索地址' };

  const { html, status, cf } = await fetchPage(url, {
    method, body, charset, headers,
    referer: siteBase(src),
    ua: /m\.|mobile|\/m\/|3g|wap/i.test(String(url)) ? 'mobile' : 'desktop',
  });

  if (status >= 400) {
    const d = describeFetchFailure(cf, status);
    return { error: d.hint, retryable: d.retryable, cf: cf?.kind || null };
  }
  if (cf) {
    // 状态码正常但内容是 CF 拦截页 —— 当成失败，否则会把挑战页解析成"没有结果"
    const d = describeFetchFailure(cf, status);
    return { error: d.hint, retryable: d.retryable, cf: cf.kind };
  }

  const root = parseHtml(html);
  const rs = src.ruleSearch || {};

  // bookList 规则通常是数组形式 {"0":"..item..","1":".."} 或单条
  const listRaw = rs.bookList;
  let itemSels = [];
  if (Array.isArray(listRaw)) itemSels = listRaw.filter(x => typeof x === 'string');
  else if (typeof listRaw === 'string') {
    if (listRaw.trim().startsWith('{') || listRaw.trim().startsWith('[')) {
      try { const o = JSON.parse(listRaw); itemSels = Array.isArray(o) ? o.filter(x => typeof x === 'string') : Object.values(o).filter(x => typeof x === 'string'); } catch {}
    }
    if (!itemSels.length) itemSels = splitAlternatives(listRaw);
  }
  if (!itemSels.length) return { error: '搜索规则无法解析（可能是 @js 规则，该源暂不支持）' };

  const results = [];
  for (const isel of itemSels) {
    let items = [];
    try { items = queryAll(root, isel.replace(/::(?:text|html)\s*$/, '').trim()); } catch { items = []; }
    // 逐项求值：每个结果项在它自己的节点子树里取值。
    // 不能对整页跑一次 name 规则 —— 那样所有结果都会拿到页面上第一个匹配的标题。
    for (const node of items) {
      const sub = subtreeRoot(node);
      const title = pick(rs.name, sub, node, 'title');
      const author = pick(rs.author, sub, node, 'author');
      const intro = pick(rs.intro, sub, node, 'intro');
      const cover = pick(rs.coverUrl, sub, node, 'src');

      /**
       * 详情页地址：优先按 bookUrl 规则取；没写规则或取不到时，
       * 回退到「条目里第一个可用的链接」。
       * 真实书源里相当一部分只写了 name/author/bookList，靠 a 标签 href 拿地址，
       * 没有回退就会整条结果没有 url、后面抓目录直接失败。
       */
      let href = rs.bookUrl ? attrFrom(rs.bookUrl, node, 'href') : '';
      if (!href) {
        const link = queryOne(node, 'a[href]');
        if (link) href = link.attrs.href;
      }
      if (!href) continue;      // 连地址都没有，这条结果没法继续，跳过
      if (!title) continue;
      results.push({
        title,
        author: author || '',
        intro: htmlToText(intro) || '',
        cover: cover ? absolute(cover, src.bookSourceUrl) : '',
        url: href ? absolute(href, url) : '',
        source: src.bookSourceName,
        sourceUrl: src.bookSourceUrl,
      });
      if (results.length >= 60) break;
    }
    if (results.length) break;
  }
  if (!results.length) return { error: '没有搜到结果（规则可能已失效）' };
  return { results };
}

/** 把节点包成可独立求值的根 */
function subtreeRoot(node) {
  const r = { tag: '#root', attrs: {}, children: [], parent: null };
  const wrap = { ...node, parent: r };
  r.children.push(wrap);
  return r;
}

/** 在子树里取，找不到再回退到属性 */
function pick(rule, sub, node, attr) {
  if (rule) {
    let v = '';
    try { v = evalRule(rule, sub); } catch {}
    if (v && String(v).trim()) return String(v).trim();
    const a = attrFrom(rule, node, attr);
    if (a) return a;
  }
  return attrFrom('', node, attr) || '';
}

/** 从匹配节点上取属性（用规则的选择器部分定位，失败则退回节点自身） */
function attrFrom(rule, node, attr) {
  if (attr && node?.attrs?.[attr]) return node.attrs[attr];
  if (!rule) return '';
  const bare = String(rule).replace(/::(?:text|html)\s*$/, '').trim();
  if (!bare || bare[0] === '<' || bare[0] === '@') return '';
  try {
    const n = queryOne(node, bare);
    if (n?.attrs?.[attr]) return n.attrs[attr];
  } catch {}
  if (node?.attrs?.[attr]) return node.attrs[attr];
  return '';
}

function absolute(u, base) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (!base) return u;
  try { return new URL(u, base).toString(); } catch { return u; }
}

async function bookInfoOf(src, bookUrl) {
  const { url, method, body, charset, headers } = buildUrl(src, src.ruleBookInfo?.url || bookUrl, {});
  const { html, status, cf } = await fetchPage(url, { method, body, charset, headers, referer: siteBase(src) });
  if (status >= 400 || cf) throw new Error(`详情页：${describeFetchFailure(cf, status).hint}`);
  const root = parseHtml(html);
  const bi = src.ruleBookInfo || {};
  const cover = evalValue(bi.coverUrl, root, 'src');

  // 详情页规则常常整段失效（站点删了 og:novel 之类），书名/作者退回页面本身
  const h1 = queryOne(root, 'h1');
  const titleNode = queryOne(root, 'title');
  const pageTitle = titleNode ? nodeText(titleNode).trim() : '';
  const fallbackName = (h1 ? nodeText(h1).trim() : '') || pageTitle.split(/[（(\-–—|｜]/)[0].trim();
  const authorMatch = pageTitle.match(/[（(]([^）)]{2,16})[）)]/);

  return {
    name: evalValue(bi.name, root, 'title') || fallbackName,
    author: evalValue(bi.author, root, '') || (authorMatch ? authorMatch[1].trim() : ''),
    intro: htmlToText(evalValue(bi.intro, root, '')) || '',
    cover: cover ? absolute(cover, url) : '',
    lastChapter: evalValue(bi.lastChapter, root, '') || '',
    url,
    source: src.bookSourceName,
  };
}

async function tocOf(src, bookUrl) {
  const tr = src.ruleToc || {};
  const listRule = Array.isArray(tr.chapterList) ? tr.chapterList[0] : (tr.chapterList || '');
  const tocRule = String(src.ruleBookInfo?.tocUrl || '');
  // tocUrl 可能是 @js（例：从 /book/xxx.html 推出 /chapter/xxx/1.html），不能直接当 URL 用；
  // 也可能是相对路径（例：全本小说网的目录页就是书籍页同级的 list.html），按书籍页补全。
  const tocIsJs = isJsRule(tocRule) || /@js:|<js>/i.test(tocRule);
  let tocUrl = buildUrl(src, (tocRule && !tocIsJs) ? tocRule : bookUrl, {}).url;
  if (tocRule && !tocIsJs && tocUrl && !/^https?:\/\//i.test(tocUrl)) {
    try { tocUrl = new URL(tocUrl, bookUrl).toString(); } catch { tocUrl = bookUrl; }
  }
  const { url, method, body, charset, headers } = buildUrl(src, tocUrl || bookUrl, {});
  const { html, status, cf } = await fetchPage(url, { method, body, charset, headers, referer: siteBase(src) });
  if (status >= 400 || cf) throw new Error(`目录页：${describeFetchFailure(cf, status).hint}`);
  const root = parseHtml(html);

  /**
   * chapterName / chapterUrl 的语义：Legado 里这两个是**相对 chapterList 节点**的取值规则。
   *
   * want 参数是必须的 —— 同一个选择器 "a[href]" 在取名字时要文字、取地址时要 href。
   * 早先版本没区分，取 url 时先拿到 nodeText(inner) 就返回了章节名，
   * 于是 URL 被拼成 http://站点/第一章 陨落的天才，整条目录全部 404。
   */
  const readField = (rule, node, want, fallbackAttr) => {
    const r = String(rule == null ? '' : rule).trim();

    // 规则为空：按 want 就近取
    if (!r) {
      if (want === 'url') {
        const inner = queryOne(node, 'a[href]');
        return node.attrs?.href || inner?.attrs?.href || queryOne(node, '[href]')?.attrs?.href || '';
      }
      return nodeText(node);
    }

    // "##href" / "##data-src"：直接取该属性
    if (r.startsWith('##')) return String(node.attrs?.[r.replace(/^#+\s*/, '')] || '');

    const bare = r.replace(/::(?:text|html)\s*$/, '').trim();
    if (/^(text|name|title)$/i.test(bare)) return want === 'url' ? (node.attrs?.href || '') : nodeText(node);
    if (/^(url|href|link)$/i.test(bare)) return node.attrs?.href || '';
    if (/^[a-z]+:/i.test(bare)) return '';

    try {
      const inner = queryOne(node, bare);
      if (inner) {
        if (want === 'url') return inner.attrs?.href || '';
        return nodeText(inner) || (inner.attrs?.href || '');
      }
    } catch { /* 规则不是合法选择器就退回节点自身 */ }

    if (want === 'url') return node.attrs?.href || '';
    return node.attrs?.[fallbackAttr] || nodeText(node);
  };

  const parseToc = (pageRoot, pageUrl) => {
    const items = [];
    for (const sel of (Array.isArray(listRule) ? listRule : splitAlternatives(String(listRule)))) {
      let nodes = [];
      try { nodes = queryAll(pageRoot, String(sel).replace(/::(?:text|html)\s*$/, '').trim()); } catch { nodes = []; }
      for (const n of nodes) {
        const name = readField(tr.chapterName, n, 'text', 'title');
        const href = readField(tr.chapterUrl, n, 'url', 'href');
        if (!name || !href) continue;
        // href 必须是真链接：章节名被误当 URL 时这里能挡住，不会拼出中文地址
        if (!/^(https?:\/\/|\/|\.\.?\/)/i.test(String(href).trim())) continue;
        // 「查看全部章节 >>」是目录入口，不是章节
        if (isTocNavItem(name)) continue;
        items.push({ name: String(name).trim(), url: absolute(href, pageUrl) });
      }
      if (items.length) break;
    }
    return items;
  };

  const items = parseToc(root, url);

  /**
   * 书页上常带一段「最新章节」预告（三四条），真正的目录在「查看全部章节」后面。
   * 只认非空列表会在这里提前返回，结果打开书只有几条。所以：
   * 列表短（<10）时不管怎样都去找目录入口，抓回来取更长的那份。
   */
  if (items.length < 10) {
    const retryUrl = findTocEntry(root, url);
    if (retryUrl && retryUrl !== url) {
      const page2 = await fetchPage(retryUrl, { charset, headers, referer: siteBase(src) });
      if (page2.status < 400 && !page2.cf) {
        const items2 = parseToc(parseHtml(page2.html), retryUrl);
        if (items2.length > items.length) return { toc: normalizeTocOrder(items2), pageUrl: retryUrl };
      }
    }
  }
  if (items.length) return { toc: normalizeTocOrder(items), pageUrl: url };
  throw new Error(tocIsJs
    ? '目录规则是 JS，书页里也没找到目录入口（可能是站点改版）'
    : '目录解析失败：规则没匹配到章节（可能是站点改版）');
}

function isTocNavItem(name) {
  return /^(查看|展开|显示|更多|全部)[^，。！？“”]{0,6}(章节|目录)/.test(String(name || '').trim());
}

/** 在书页里找目录入口：优先链接文字，其次 URL 形态 */
function findTocEntry(root, baseUrl) {
  let best = '', bestScore = 0;
  for (const a of queryAll(root, 'a[href]')) {
    const href = String(a.attrs?.href || '').trim();
    if (!/^(https?:\/\/|\/|\.\.?\/)/i.test(href)) continue;
    const text = nodeText(a);
    let score = 0;
    // 「查看全部章节」「章节目录」才是入口；「最新章节」也含"章节"二字，得压后
    if (/全部章节|章节目录|查看全部|目录|开始阅读/.test(text)) score = 4;
    else if (/章节/.test(text) && !/最新章节/.test(text)) score = 3;
    else if (/\/(chapter|chapters|list|dir|catalog|booklist)\b/i.test(href)) score = 2;
    if (score > bestScore) { best = href; bestScore = score; }
  }
  return best ? absolute(best, baseUrl) : '';
}

/**
 * 修正目录顺序 + 去重。
 *
 * 真实站点的情况比"倒序"复杂得多。实测验的格格党（qodown.com）详情页是
 * **两段拼在一起**的：
 *   前 9 项 = 「最新章节」倒序（102,101,…,94）
 *   后面   = 「全部章节」正序（1,2,3,…,45）
 * 于是整体既不像正序也不像倒序（递减对 8 / 递增对 45），
 * 早先那套"检测到八成递减就反转"的逻辑完全失效，前 3 章仍然是 102,101,100。
 *
 * 现在改成三步，按可靠性从高到低：
 *   ① 按 URL 去重 —— 最新章节会重复出现在完整目录里；
 *   ② 章节名里的「第 N 章」够多（≥80%）→ **直接按 N 升序排**，比猜方向可靠；
 *   ③ 解析不出章节号 → 退回"相邻对八成递减则反转"的启发式。
 */
function normalizeTocOrder(items) {
  if (items.length < 3) return items;

  // ① 去重（同一个 URL 只留第一次出现）
  const seen = new Set();
  const list = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    list.push(it);
  }

  // ② 章节名里的序号
  const nameNum = (it) => {
    const m = String(it.name).match(/第\s*([0-9一二三四五六七八九十百千零〇两]+)\s*[章节回话]/);
    if (!m) return null;
    const raw = m[1];
    if (/^\d+$/.test(raw)) return Number(raw);
    return cnNum(raw);                       // 「第一百零二章」这类中文数字
  };

  const nums = list.map(nameNum);
  const validCount = nums.filter(n => n !== null).length;

  if (validCount >= list.length * 0.8 && validCount >= 3) {
    /**
     * 先看是不是本来就升序。目录页绝大多数是阅读顺序，直接排反而会打乱：
     * 站点偶尔漏写「章」字（如「第八十七 下杀手」），解析不出序号，
     * 早先一律把 null 塞到最前，结果第 1 章变成第 87 章。
     */
    let prev = null, pairs = 0, inv = 0;
    for (const n of nums) {
      if (n === null) continue;
      if (prev !== null) { pairs++; if (n < prev) inv++; }
      prev = n;
    }
    if (pairs >= 3 && inv <= pairs * 0.1) return list;

    // 稳定排序：有序号的按序号，无序号的（楔子/番外）保持原相对位置排在最前
    return list
      .map((it, i) => ({ it, n: nums[i], i }))
      .sort((a, b) => {
        if (a.n === null && b.n === null) return a.i - b.i;
        if (a.n === null) return -1;          // 楔子/序章通常在最前
        if (b.n === null) return 1;
        return a.n - b.n || a.i - b.i;
      })
      .map(x => x.it);
  }

  // ③ 没有章节号：看 URL 末段数字是否成规模递减
  const urlNum = (it) => {
    const m = String(it.url).match(/(\d+)(?:\.html?)?\s*$/);
    return m ? Number(m[1]) : null;
  };
  const unums = list.map(urlNum);
  let down = 0, up = 0;
  for (let i = 1; i < unums.length; i++) {
    if (unums[i] === null || unums[i - 1] === null) continue;
    if (unums[i] < unums[i - 1]) down++;
    else if (unums[i] > unums[i - 1]) up++;
  }
  const pairs = down + up;
  if (pairs >= 3 && down / pairs > 0.8) return list.slice().reverse();
  return list;
}

/** 中文数字 → 阿拉伯数字（覆盖「一百零二」这类常见的章节写法）。 */
function cnNum(s) {
  const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const U = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, section = 0, num = 0;
  for (const ch of String(s)) {
    if (D[ch] !== undefined) { num = D[ch]; }
    else if (U[ch] !== undefined) {
      section += (num || 1) * U[ch];
      num = 0;
    } else return null;
  }
  return total + section + num;
}

async function contentOf(src, chapterUrl) {
  const { url, method, body, charset, headers } = buildUrl(src, chapterUrl, {});
  const { html, status, cf } = await fetchPage(url, { method, body, charset, headers, referer: siteBase(src) });
  if (status >= 400 || cf) throw new Error(`正文页：${describeFetchFailure(cf, status).hint}`);
  const root = parseHtml(html);
  const cr = src.ruleContent || {};
  let text = '';
  for (const sel of (Array.isArray(cr.content) ? cr.content : splitAlternatives(String(cr.content || '')))) {
    // block: true —— 正文必须按块级结构提取，否则多段会粘成一行，
    // 后面的按行广告过滤会把整段正文误杀（实测 content 返回空字符串）
    const v = evalRule(String(sel), root, url, { block: true });
    if (v && String(v).trim().length > 20) { text = htmlToText(v); break; }
  }
  if (!text) throw new Error('正文解析失败（可能是 @js 规则或规则已变更）');

  /**
   * 清洗正文。
   *
   * 广告行的识别分三类（都是实测验格格党时踩出来的）：
   *   ① 导航类固定词：上一章/下一章/返回目录/加入书签……
   *   ② 站点水印：站点名 + 域名 + 「请记住本站」这类；
   *      实际抓到的原样是「追台湾小说就去看 ????.c??????m????」——
   *      域名被站点做了字符替换，正则匹配不到，所以还要靠第 ③ 条。
   *   ③ **乱码特征**：含连续半角问号的行。站点故意把域名拆成问号防抓取，
   *      正常中文正文里几乎不会出现「??」连写，用它当判据既不误伤也够狠。
   */
  const AD_WORDS = /(上一章|下一章|返回目录|加入书签|推荐本书|请记住本站|手机版阅读|天才一秒记住|一秒记住|首发地址|无弹窗|全文阅读|最新章节|请安装|app下载|本章未完|点击下一页|加入书架)/i;
  const URL_LIKE = /www\.[a-z0-9-]+\.(com|net|org|cn|cc|la|info)|[a-z0-9-]+\.(com|net|org|cc)\b/i;
  const JUNK_Q = /\?{2,}/;                    // 连续问号：站点防抓取的域名占位

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const kept = [];
  let prev = null;
  for (const l of lines) {
    const q = (l.match(/\?/g) || []).length;
    // 问号密度过高 → 判定为被打码的水印行（正文不会这样）
    const qDense = l.length > 6 && q / l.length > 0.12;
    if (AD_WORDS.test(l) || URL_LIKE.test(l) || JUNK_Q.test(l) || qDense) continue;
    if (l.length < 2 && !/[。，！？…、]/.test(l)) continue;
    if (prev && l === prev) continue;
    kept.push(l); prev = l;
  }
  return { content: kept.join('\n\n'), url };
}

/* ============================================================
   六、路由
   ============================================================ */

/** 请求体里的书源：优先传完整对象，否则只传名字+域名去已注册表里找 */
function resolveSource(reg, s) {
  if (s && typeof s === 'object' && s.bookSourceUrl) return s;
  const key = String(s?.bookSourceName || s?.name || '').trim();
  return reg.get(key) || null;
}

export function createNovelRouter(getRegistry) {
  const router = Router();

  /** 书源能力自检：告诉前端哪些源能用 */
  router.post('/api/novel/inspect', (req, res) => {
    const list = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const out = list.map(s => {
      const cap = sourceCapability(s);
      return {
        name: s.bookSourceName || '(未命名)',
        url: s.bookSourceUrl || '',
        usable: cap.usable,
        reason: cap.noSearch ? '没有搜索地址' : (cap.usesJs ? '使用 JS 规则（暂不支持）' : ''),
      };
    });
    res.json({ success: true, total: out.length, usable: out.filter(x => x.usable).length, sources: out });
  });

  /** 搜索：可同时搜多个书源 */
  router.post('/api/novel/search', async (req, res) => {
    const { keyword, sources, page = 1 } = req.body || {};
    if (!keyword || !String(keyword).trim()) return res.status(400).json({ success: false, error: '请输入搜索关键词' });
    const reg = getRegistry();
    const list = (Array.isArray(sources) && sources.length ? sources : [...reg.values()])
      .map(s => resolveSource(reg, s)).filter(Boolean);

    if (!list.length) return res.status(400).json({ success: false, error: '没有可用的书源，请先导入' });

    const usable = list.filter(s => sourceCapability(s).usable);
    if (!usable.length) return res.json({ success: true, results: [], errors: [{ name: list[0]?.bookSourceName, error: '这些书源的搜索规则依赖 JS，当前版本不执行 JS' }] });

    /**
     * 默认书源（未显式指定）分批试：每批 6 个，第一批全空再试下一批，最多 3 批。
     * 默认源里有不少已经失效的源，一批试不完 —— 但只有真的一个结果都没有时才加时，
     * 正常情况仍然只等一批。
     */
    const BATCH = 6;
    const batches = Array.isArray(sources) && sources.length ? 1 : 3;
    const results = [];
    const errors = [];
    const tried = [];
    for (let b = 0; b < batches; b++) {
      const batch = usable.slice(b * BATCH, (b + 1) * BATCH);
      if (!batch.length) break;
      tried.push(...batch.map(s => s.bookSourceName));
      const settled = await Promise.allSettled(batch.map(src => searchInSource(src, String(keyword).trim(), page)));
      settled.forEach((s, i) => {
        const src = batch[i];
        if (s.status === 'fulfilled' && s.value?.results) results.push(...s.value.results);
        else errors.push({ name: src.bookSourceName, error: s.reason?.message || s.value?.error || '请求失败' });
      });
      if (results.length) break;
    }

    const seen = new Set();
    const uniq = results.filter(r => {
      const k = (r.title || '') + '|' + (r.author || '');
      if (seen.has(k)) return false; seen.add(k); return true;
    });

    res.json({ success: true, results: uniq.slice(0, 80), errors, tried });
  });

  /** 目录 */
  router.post('/api/novel/toc', async (req, res) => {
    const { source, bookUrl } = req.body || {};
    const src = resolveSource(getRegistry(), source);
    if (!src) return res.status(400).json({ success: false, error: '找不到该书源' });
    if (!bookUrl) return res.status(400).json({ success: false, error: '缺少书籍地址' });
    try {
      const [info, t] = await Promise.all([
        bookInfoOf(src, bookUrl).catch(() => null),
        tocOf(src, bookUrl),
      ]);
      res.json({ success: true, info, toc: t.toc });
    } catch (e) {
      res.status(502).json({ success: false, error: e.message || '目录抓取失败' });
    }
  });

  /** 正文 */
  router.post('/api/novel/content', async (req, res) => {
    const { source, chapterUrl } = req.body || {};
    const src = resolveSource(getRegistry(), source);
    if (!src) return res.status(400).json({ success: false, error: '找不到该书源' });
    if (!chapterUrl) return res.status(400).json({ success: false, error: '缺少章节地址' });
    try {
      const c = await contentOf(src, chapterUrl);
      res.json({ success: true, content: c.content });
    } catch (e) {
      res.status(502).json({ success: false, error: e.message || '正文抓取失败' });
    }
  });

  return router;
}

export const __test__ = {
  decodeBody, decodeScore, looksLikeMojibake, parseHtml, queryAll, queryOne,
  nodeText, nodeContent, fillTemplate, splitUrlRule, buildUrl, normalizeTocOrder,
};