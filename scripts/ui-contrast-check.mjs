#!/usr/bin/env node
/**
 * PixelKit · 全站 UI 对比度巡检（WCAG 2.1）
 * =====================================================================
 * 来历：docs/人生之书/tools/book-page-e2e.mjs 里的 scanContrast() 是在一次真实事故后加的
 * —— 「继续 →」按钮变成了白底白字（对比度 1.0，字完全看不见），而所有功能测试都是绿的
 * （按钮点得动、事件照常触发）。这类回归只有量像素才能发现，所以单独抽成一个可复用的脚本，
 * 任何页面都能扫。亮度 / 对比度算法与浏览器启动方式沿用那个脚本，保持一致。
 *
 * 用法：
 *   node scripts/ui-contrast-check.mjs
 *   node scripts/ui-contrast-check.mjs --url http://139.9.176.191:8081/ --page agent --themes dark,light
 *   node scripts/ui-contrast-check.mjs --url https://example.com/ --basic user:pass --json
 *   node scripts/ui-contrast-check.mjs --theme dark --viewport 1440x900 --min 4.5
 *   node scripts/ui-contrast-check.mjs --mobile --page agent
 *
 * 退出码：0 = 所选主题全部通过；1 = 至少一个 FAIL / CRITICAL；2 = 脚本自身出错（打不开浏览器/页面等）
 *
 * 这个脚本不能验证什么（详见最后的 caveat）：渐变 / 背景图上的文字只能标成 unverifiable，
 * 没法算出真实对比度。
 */

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// 本文件位于 <repo>/scripts/，向上两级即仓库根
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));

// ---------------------------------------------------------------------------
// CLI（手写解析，不引依赖）
// ---------------------------------------------------------------------------

const USAGE = `PixelKit UI 对比度巡检（WCAG 2.1）

用法: node scripts/ui-contrast-check.mjs [选项]

选项:
  --url <url>       目标页面                (默认 http://127.0.0.1:3101/)
  --basic <u:p>     可选 HTTP Basic 认证    (走 page.authenticate)
  --page <name>     要打开的 SPA 页面名     (默认 agent)
                    先点首页卡片 [data-page="<name>"]，失败则退回 window.App.showPage('<name>')
  --themes <list>   要巡检的主题，逗号分隔  (默认 dark,light)
                    dark = 去掉 <html data-theme>；light = 设为 "light"
  --theme <name>    --themes 的单数写法（可重复）
  --viewport <WxH>  视口尺寸                (默认 1280x900)
  --mobile          = --viewport 390x844
  --min <ratio>     自定义通过阈值，覆盖 WCAG 规则（大字号也用它）
  --json            输出机器可读 JSON，不打印表格
  -h, --help        显示本帮助
`;

function parseArgs(argv) {
  const o = {
    url: 'http://127.0.0.1:3101/',
    basic: '',
    page: 'agent',
    themes: [],
    viewport: null,
    mobile: false,
    min: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`选项 ${a} 缺少参数值`);
      return v;
    };
    if (a === '--url') o.url = val();
    else if (a.startsWith('--url=')) o.url = a.slice(6);
    else if (a === '--basic') o.basic = val();
    else if (a.startsWith('--basic=')) o.basic = a.slice(8);
    else if (a === '--page') o.page = val();
    else if (a.startsWith('--page=')) o.page = a.slice(7);
    else if (a === '--themes') o.themes.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith('--themes=')) o.themes.push(...a.slice(9).split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--theme') o.themes.push(val());
    else if (a.startsWith('--theme=')) o.themes.push(a.slice(8));
    else if (a === '--viewport') o.viewport = val();
    else if (a.startsWith('--viewport=')) o.viewport = a.slice(11);
    else if (a === '--mobile') o.mobile = true;
    else if (a === '--min') o.min = Number(val());
    else if (a.startsWith('--min=')) o.min = Number(a.slice(6));
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`未知选项: ${a}（用 --help 看用法）`);
  }

  if (!o.themes.length) o.themes = ['dark', 'light'];
  o.themes = [...new Set(o.themes.map((t) => t.toLowerCase()))];
  for (const t of o.themes) {
    if (t !== 'dark' && t !== 'light') throw new Error(`--themes 只支持 dark / light，收到: ${t}`);
  }

  if (o.mobile) o.viewport = '390x844';
  const vp = String(o.viewport || '1280x900').toLowerCase().split('x');
  const width = Number(vp[0]);
  const height = Number(vp[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`--viewport 格式应为 WxH，例如 1280x900，收到: ${o.viewport}`);
  }
  o.width = Math.round(width);
  o.height = Math.round(height);

  if (o.min !== null && (!Number.isFinite(o.min) || o.min < 1 || o.min > 21)) {
    throw new Error(`--min 应为 1~21 之间的数字，收到: ${o.min}`);
  }

  if (!/^https?:\/\//i.test(o.url)) throw new Error(`--url 必须是 http(s) 地址，收到: ${o.url}`);

  return o;
}

// ---------------------------------------------------------------------------
// 浏览器可执行文件探测（Edge 优先，其次其他 Chromium 系）
// ---------------------------------------------------------------------------

function detectBrowser() {
  const isWin = process.platform === 'win32';
  const candidates = [];
  // EDGE / CHROME / PUPPETEER_EXECUTABLE_PATH 环境变量优先（沿用 book-page-e2e.mjs 的 EDGE 约定）；
  // 路径不存在就当作没设，继续往下试常见路径，避免一个坏环境变量把整轮巡检卡死。
  const env = process.env.EDGE || process.env.CHROME || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env) candidates.push({ p: env, why: '环境变量 EDGE/CHROME/PUPPETEER_EXECUTABLE_PATH' });
  if (isWin) {
    const roots = [
      process.env['ProgramFiles'] || 'C:/Program Files',
      process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    ].filter(Boolean);
    for (const r of roots) {
      candidates.push({ p: path.join(r, 'Microsoft/Edge/Application/msedge.exe'), why: 'Edge' });
      candidates.push({ p: path.join(r, 'Google/Chrome/Application/chrome.exe'), why: 'Chrome' });
      candidates.push({ p: path.join(r, 'BraveSoftware/Brave-Browser/Application/brave.exe'), why: 'Brave' });
    }
  } else if (process.platform === 'darwin') {
    candidates.push({ p: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', why: 'Edge' });
    candidates.push({ p: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', why: 'Chrome' });
  } else {
    candidates.push({ p: '/usr/bin/microsoft-edge', why: 'Edge' });
    candidates.push({ p: '/usr/bin/google-chrome', why: 'Chrome' });
    candidates.push({ p: '/usr/bin/chromium', why: 'Chromium' });
  }
  for (const c of candidates) {
    try {
      if (c.p && fs.existsSync(c.p)) return { execPath: c.p, note: `${c.why} @ ${c.p}` };
    } catch { /* 忽略 */ }
  }
  return {
    execPath: null,
    note: `没找到 Edge/Chrome 可执行文件（试过 ${candidates.length} 个常见路径）；改用 puppeteer 自带的 Chromium`,
  };
}

// ---------------------------------------------------------------------------
// 页面内执行的巡检代码（原样序列化进浏览器）
// 返回 { findings, unverifiable, total, sendBtn }
// ---------------------------------------------------------------------------

function inPageAudit(opts) {
  const MIN_OVERRIDE = opts.minOverride;
  const SEND_SELECTOR = opts.sendSelector;

  /* ---------- 颜色 / 亮度 / 对比度（沿用 book-page-e2e.mjs 的算法） ---------- */
  const lum = (c) => {
    const m = String(c || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const [r, g, bl] = m.slice(0, 3).map((x) => Number(x) / 255);
    const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    if (L1 === null || L2 === null) return null;
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const isTransparent = (c) => {
    const s = String(c || '').trim();
    if (!s || s === 'transparent') return true;
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return false;
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 4) return false;
    return Number(parts[3]) === 0;
  };
  const alphaOf = (c) => {
    const m = String(c || '').match(/rgba?\(([^)]+)\)/i);
    if (!m) return 1;
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    return parts.length >= 4 ? Number(parts[3]) : 1;
  };

  /* 稳定标识的计数器：给没有 id/class 链的重复兄弟节点编号。
     注意：不能依赖 CSS.escape 后的选择器去 querySelector 计数——class 里带冒号时
     CSS.escape 会把它转义成 '\\:'，再拼进选择器就查不到了。 */
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function childIndex(el) {
    const parent = el.parentElement;
    if (!parent) return 0;
    const same = [...parent.children].filter((s) => s.tagName === el.tagName);
    return same.length > 1 ? same.indexOf(el) + 1 : 0;
  }

  /* 稳定的 CSS 路径标识：从最近的 id 祖先往下拼 id / class 链 + nth-of-type 兜底 */
  function cssPath(el) {
    const parts = [];
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 12) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      let seg = node.tagName.toLowerCase();
      if (typeof node.className === 'string' && node.className.trim()) {
        const cls = node.className.trim().split(/\s+/).filter((c) => c && !/^(ng|css)-/.test(c)).slice(0, 3);
        if (cls.length) seg += '.' + cls.join('.');
      }
      const idx = childIndex(node);
      if (idx) seg += ':nth-of-type(' + idx + ')';
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  /* 有效背景色：从元素自身往上走，把沿途的 background-color 按 alpha 从下往上合成，
     直到撞到底色（不透明层）为止。
     - 半透明层（例如 rgba(255,255,255,0.04)）会和它下面的颜色合成，而不是被当成底色，
       否则深色页面上一个 4% 白色的按钮会被算成「白底」。
     - 途中若遇到非 none 的 background-image（渐变 / 背景图）→ sawImage，调用方标 unverifiable。 */
  function effectiveBackground(el) {
    const layers = [];
    let node = el, guard = 0, sawImage = false;
    let base = 'rgb(255, 255, 255)';
    let srcEl = document.documentElement;
    let found = false;
    while (node && node.nodeType === 1 && guard++ < 30) {
      const s = getComputedStyle(node);
      const bgImg = s.backgroundImage;
      if (bgImg && bgImg !== 'none') sawImage = true;
      const bc = s.backgroundColor;
      if (isTransparent(bc)) { node = node.parentElement; continue; }
      const a = alphaOf(bc);
      if (a >= 0.999) {
        base = norm(bc); srcEl = node; found = true;
        break;
      }
      layers.push({ col: parseRGB(bc), a });
      if (Math.abs(a) < 1e-6) { node = node.parentElement; continue; }
      node = node.parentElement;
    }
    if (!found) {
      const bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : null;
      const htmlBg = document.documentElement ? getComputedStyle(document.documentElement).backgroundColor : null;
      if (bodyBg && !isTransparent(bodyBg) && alphaOf(bodyBg) >= 0.999) { base = norm(bodyBg); srcEl = document.body; }
      else if (htmlBg && !isTransparent(htmlBg) && alphaOf(htmlBg) >= 0.999) { base = norm(htmlBg); srcEl = document.documentElement; }
      else base = 'rgb(255, 255, 255)';
    }
    // layers 是从靠近元素的一侧收集的，合成要从底色开始，所以倒序
    let composed = base;
    for (let i = layers.length - 1; i >= 0; i--) composed = blend(layers[i].col, layers[i].a, composed);
    return { bg: composed, source: cssPath(srcEl), fromSelf: false, sawImage, found, node: srcEl, stackDepth: layers.length };
  }
  function parseRGB(c) {
    const m = String(c || '').match(/rgba?\(([^)]+)\)/i);
    if (!m) return [0, 0, 0];
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  }
  function blend(top, alpha, bottom) {
    const b = parseRGB(bottom);
    const r = Math.round(top[0] * alpha + b[0] * (1 - alpha));
    const g = Math.round(top[1] * alpha + b[1] * (1 - alpha));
    const bl = Math.round(top[2] * alpha + b[2] * (1 - alpha));
    return `rgb(${r}, ${g}, ${bl})`;
  }
  /* 统一成 rgb()/rgba() 写法，方便阅读和去重 */
  function norm(c) {
    const s = String(c || '').trim();
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      const [r, g, b] = p;
      const a = p.length >= 4 ? p[3] : 1;
      return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    // 兜底：hex / color(srgb ...) 之类，交给浏览器再算一次
    try {
      const probe = document.createElement('span');
      probe.style.color = s;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb || s;
    } catch { return s; }
  }

  /* ---------- 单元素检查 ---------- */
  function checkElement(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return null;
    if (Number(cs.opacity) < 0.15) return null;
    if (!visible(el)) return null;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const fontSize = parseFloat(cs.fontSize) || 0;
    const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const threshold = MIN_OVERRIDE !== null ? MIN_OVERRIDE : (large ? 3.0 : 4.5);

    const ownBg = cs.backgroundColor;
    const ownImg = !!cs.backgroundImage && cs.backgroundImage !== 'none';
    // 自身背景色不透明 → 就是它；透明或半透明 → 往上逐层合成
    let bgInfo;
    if (!isTransparent(ownBg) && alphaOf(ownBg) >= 0.999) {
      bgInfo = { bg: norm(ownBg), source: cssPath(el), fromSelf: true, sawImage: ownImg, found: true, stackDepth: 0 };
    } else {
      bgInfo = effectiveBackground(el);
      if (ownImg) bgInfo = { ...bgInfo, sawImage: true };
    }
    const rawOwnBg = norm(ownBg);
    const color = norm(cs.color);
    const r = ratio(color, bgInfo.bg);

    const base = {
      path: cssPath(el),
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.trim() : '',
      id: el.id || '',
      text: text.slice(0, 24),
      color,
      bg: bgInfo.bg,
      rawBg: rawOwnBg,
      bgSource: bgInfo.source,
      bgFromSelf: bgInfo.fromSelf,
      ratio: r,
      threshold,
      large,
      fontSize: Math.round(fontSize * 10) / 10,
      fontWeight: weight,
    };

    // 背景图/渐变：没法算真实对比度，单独上报，不算失败。
    // 例外：元素自身有「不透明」的 background-color —— 说明层叠里已有实色覆盖，
    // 这时按实色算（记个 note），比整块跳过更有价值。
    if (bgInfo.sawImage && !(bgInfo.fromSelf && alphaOf(ownBg) >= 0.999)) {
      return { ...base, verdict: 'UNVERIFIABLE', reason: '背景含 gradient/background-image，无法计算真实对比度' };
    }
    // 注意：这里刻意不引入局部变量——被 page.evaluate 序列化到页面里执行时，
    // 该位置出现过 "gradNote is not defined"（不同页面/执行上下文下偶发），
    // 直接把文案内联进返回值最稳。
    if (r === null) {
      return { ...base, verdict: 'UNVERIFIABLE', reason: '颜色无法解析' };
    }
    const note = bgInfo.sawImage
      ? '背景另有 gradient/background-image，但自身不透明 background-color 已覆盖，按实色计算'
      : undefined;
    if (r >= threshold) return { ...base, note, verdict: 'PASS' };
    if (r < 1.6) return { ...base, note, verdict: 'CRITICAL', reason: '基本看不见' };
    return { ...base, note, verdict: 'FAIL' };
  }

  /* ---------- 全页扫描 ---------- */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BR', 'HR', 'CANVAS', 'SVG', 'PATH', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'INPUT', 'SELECT', 'TEXTAREA']);
  const findings = [];
  let total = 0;
  let scanned = 0;
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest('.theme-panel')) continue; // 主题面板本身是调色 UI，扫它没意义
    scanned++;
    const row = checkElement(el);
    if (!row) continue;
    total++;
    if (row.verdict !== 'PASS') findings.push(row);
  }

  /* ---------- 重点：聊天发送按钮 #agent-send-btn ---------- */
  const sendEl = document.querySelector(SEND_SELECTOR);
  let sendBtn = null;
  if (sendEl) {
    sendBtn = checkElement(sendEl);
    if (!sendBtn) {
      const cs = getComputedStyle(sendEl);
      sendBtn = { path: cssPath(sendEl), tag: 'button', text: (sendEl.textContent || '').trim().slice(0, 24),
        color: norm(cs.color), bg: norm(cs.backgroundColor), bgSource: cssPath(sendEl),
        ratio: ratio(norm(cs.color), norm(cs.backgroundColor)), threshold: 3.0,
        verdict: 'UNVERIFIABLE', reason: '元素当前不可见（offset 为 0），无法测量' };
    }
  }

  return {
    findings,
    total,
    scanned,
    sendBtn,
    rootTheme: document.documentElement.getAttribute('data-theme') || '(none = dark)',
    pageActive: (document.querySelector('.page.active') || {}).id || null,
  };
}

// ---------------------------------------------------------------------------
// 结果整理
// ---------------------------------------------------------------------------

const DEDUP_KEYS = ['tag', 'cls', 'color', 'bg', 'ratio'];

function dedupe(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = DEDUP_KEYS.map((k) => String(r[k])).join('|');
    if (!map.has(key)) map.set(key, { ...r, paths: [r.path], count: 1 });
    else {
      const e = map.get(key);
      e.count++;
      if (e.paths.length < 4 && !e.paths.includes(r.path)) e.paths.push(r.path);
    }
  }
  return [...map.values()];
}

function rank(v) {
  return v === 'CRITICAL' ? 0 : v === 'FAIL' ? 1 : v === 'UNVERIFIABLE' ? 2 : 3;
}

function summarize(theme, raw, opts) {
  const findings = dedupe(raw.findings);
  findings.sort((a, b) => rank(a.verdict) - rank(b.verdict) || (a.ratio ?? 99) - (b.ratio ?? 99));

  const fails = findings.filter((f) => f.verdict === 'FAIL');
  const criticals = findings.filter((f) => f.verdict === 'CRITICAL');
  const unverifiable = findings.filter((f) => f.verdict === 'UNVERIFIABLE');

  const send = raw.sendBtn;
  const sendFailed = !!send && (
    send.verdict === 'FAIL' || send.verdict === 'CRITICAL'
    ? true
    : (send.ratio !== null && send.ratio !== undefined && send.ratio < 3.0)
  );

  return {
    theme,
    url: opts.url,
    page: opts.page,
    viewport: `${opts.width}x${opts.height}`,
    minOverride: opts.min,
    rootThemeAttribute: raw.rootTheme,
    activePageElement: raw.pageActive,
    scannedElements: raw.scanned,
    checkedTextElements: raw.total,
    counts: {
      fail: fails.length,
      critical: criticals.length,
      failElements: fails.reduce((n, f) => n + f.count, 0) + criticals.reduce((n, f) => n + f.count, 0),
      unverifiable: unverifiable.length,
    },
    sendBtn: send,
    sendBtnFailed: sendFailed,
    findings,
    unverifiable,
    failed: fails.length + criticals.length > 0 || sendFailed,
  };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

const C = process.stdout.isTTY
  ? { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', cyan: '\x1b[36m', mag: '\x1b[35m' }
  : { r: '', b: '', dim: '', red: '', yel: '', grn: '', cyan: '', mag: '' };

function pad(s, n) {
  const str = String(s);
  // 粗略按显示宽度补空格（CJK 按 2 列算）
  let w = 0;
  for (const ch of str) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, n - w));
}

function printTheme(sum, quiet) {
  const L = [];
  const head = `${C.b}主题 ${sum.theme}${C.r}  ${C.dim}(${sum.rootThemeAttribute}) 视口 ${sum.viewport} 页 ${sum.page}${C.r}`;
  L.push('');
  L.push('='.repeat(76));
  L.push(head);
  L.push('='.repeat(76));
  L.push(`扫描元素 ${sum.scannedElements} 个，其中有文字需检查 ${sum.checkedTextElements} 个` +
    `  →  ${C.red}FAIL ${sum.counts.fail}${C.r} / ${C.mag}CRITICAL ${sum.counts.critical}${C.r}` +
    `  / 未验证 ${sum.counts.unverifiable}`);

  // 重点行：#agent-send-btn
  L.push('');
  if (!sum.sendBtn) {
    L.push(`${C.cyan}▸ #agent-send-btn${C.r} ${C.dim}本页不存在${C.r}`);
  } else {
    const s = sum.sendBtn;
    const tagTxt = s.verdict === 'PASS' ? `${C.grn}OK${C.r}`
      : s.verdict === 'UNVERIFIABLE' ? `${C.yel}UNVERIFIABLE${C.r}`
      : `${C.red}${s.verdict}${C.r}`;
    L.push(`${C.b}${C.cyan}▸ 重点检查 #agent-send-btn${C.r}  ${tagTxt}`);
    L.push(`    color(computed)=${s.color}  background-color(computed)=${s.rawBg || s.bg}`);
    if (s.bg && s.bg !== s.rawBg) {
      L.push(`    有效底色（逐层合成后）=${s.bg}  ${C.dim}来自 ${s.bgSource}${C.r}`);
    }
    L.push(`    对比度=${s.ratio === null || s.ratio === undefined ? 'n/a' : s.ratio}  (阈值 3.0，发送按钮必须 >= 3.0)`);
    L.push(`    文本=${JSON.stringify(s.text)}  字号=${s.fontSize}px  字重=${s.fontWeight}`);
    L.push(`    路径=${s.path}`);
    if (s.reason) L.push(`    ${C.dim}${s.reason}${C.r}`);
    if (s.note) L.push(`    ${C.dim}注: ${s.note}${C.r}`);
    if (sum.sendBtnFailed) L.push(`    ${C.red}${C.b}!! 发送按钮对比度不足，白字白底这类事故就是从这里开始${C.r}`);
  }

  // 明细
  const shown = sum.findings.filter((f) => f.verdict !== 'UNVERIFIABLE');
  if (shown.length) {
    L.push('');
    L.push(`${C.b}问题明细（已按 标签+class+颜色+背景+比值 去重）${C.r}`);
    for (const g of shown) {
      const color = g.verdict === 'CRITICAL' ? `${C.mag}${C.b}CRITICAL (基本看不见)${C.r}` : `${C.red}FAIL${C.r}`;
      const cnt = g.count > 1 ? ` ${C.dim}x${g.count}${C.r}` : '';
      L.push(`  ${color}${cnt}  ${g.path}`);
      if (g.paths && g.paths.length > 1) {
        for (const p of g.paths.slice(1)) L.push(`      ${C.dim}同款: ${p}${C.r}`);
      }
      L.push(`      文本=${JSON.stringify(g.text)}  color=${g.color}  bg=${g.bg}  对比=${g.ratio} < ${g.threshold}` +
        `  ${C.dim}(${g.fontSize}px/${g.fontWeight}${g.large ? ' 大字' : ''})${C.r}`);
      if (g.rawBg && g.rawBg !== g.bg) L.push(`      ${C.dim}元素自身 background-color=${g.rawBg}（半透明，已与下方合成为 ${g.bg}）${C.r}`);
      if (g.note) L.push(`      ${C.dim}注: ${g.note}${C.r}`);
      if (g.bgSource && g.bgSource !== g.path) L.push(`      ${C.dim}底色来自: ${g.bgSource}${C.r}`);
    }
  } else {
    L.push('');
    L.push(`${C.grn}没有发现对比度问题。${C.r}`);
  }

  if (sum.unverifiable.length) {
    L.push('');
    L.push(`${C.yel}无法验证（背景是渐变 / 背景图，脚本算不出真实对比度）共 ${sum.unverifiable.length} 类：${C.r}`);
    for (const g of sum.unverifiable.slice(0, quiet ? 6 : 30)) {
      L.push(`  ${C.yel}?${C.r} ${g.path}  文本=${JSON.stringify(g.text)}  color=${g.color}  bg=${g.bg}` +
        (g.count > 1 ? ` ${C.dim}x${g.count}${C.r}` : ''));
    }
    if (sum.unverifiable.length > (quiet ? 6 : 30)) {
      L.push(`  ${C.dim}...还有 ${sum.unverifiable.length - (quiet ? 6 : 30)} 类，见 --json 输出${C.r}`);
    }
  }

  L.push('');
  L.push(sum.failed
    ? `${C.red}${C.b}主题 ${sum.theme}: 不通过${C.r}  (FAIL ${sum.counts.fail} + CRITICAL ${sum.counts.critical}${sum.sendBtnFailed ? '，且 #agent-send-btn 对比度 < 3.0' : ''})`
    : `${C.grn}${C.b}主题 ${sum.theme}: 通过${C.r}  (无 FAIL/CRITICAL)`);
  console.log(L.join('\n'));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const SETTLE_MS = 600;

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${C.red}参数错误: ${e.message}${C.r}`);
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help) { console.log(USAGE); process.exit(0); }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error(`${C.red}加载 puppeteer 失败: ${e.message}${C.r}`);
    console.error(`提示: 先在 ${repo} 里执行 npm install（puppeteer 已在 package.json 中）。`);
    process.exit(2);
  }

  const picked = detectBrowser();
  const launchOpts = { headless: 'new', args: ['--no-sandbox', '--disable-gpu'] };
  if (picked.execPath) launchOpts.executablePath = picked.execPath;
  if (!opts.json) console.error(`${C.dim}[i] 浏览器: ${picked.note}${C.r}`);

  const launchHint = () => {
    console.error(`${C.yel}启动浏览器失败。请确认 Edge/Chrome 已安装，或用环境变量指定路径，例如：${C.r}`);
    console.error(`  $env:EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'; node scripts/ui-contrast-check.mjs ...`);
    console.error(`  # 或者装一个 puppeteer 自带的 Chromium: npx puppeteer browsers install chrome`);
    console.error(`${C.dim}本次探测结果: ${picked.note}${C.r}`);
  };

  let browser = null;
  try {
    try {
      browser = await puppeteer.launch(launchOpts);
    } catch (e1) {
      if (picked.execPath) {
        // 探测到了浏览器但它起不来：先说清楚，再退回 puppeteer 自带的 Chromium 试一次
        console.error(`${C.yel}用 ${picked.execPath} 启动失败: ${String(e1.message || e1).split('\n')[0]}${C.r}`);
        console.error(`${C.yel}改试 puppeteer 自带的 Chromium...${C.r}`);
        delete launchOpts.executablePath;
        try {
          browser = await puppeteer.launch(launchOpts);
        } catch (e2) {
          console.error(`${C.red}puppeteer 自带 Chromium 也起不来: ${String(e2.message || e2).split('\n')[0]}${C.r}`);
          launchHint();
          throw e2;
        }
      } else {
        console.error(`${C.red}启动浏览器失败: ${String(e1.message || e1).split('\n')[0]}${C.r}`);
        launchHint();
        throw e1;
      }
    }

    const page = await browser.newPage();
    if (opts.basic) {
      const idx = opts.basic.indexOf(':');
      const user = idx >= 0 ? opts.basic.slice(0, idx) : opts.basic;
      const pass = idx >= 0 ? opts.basic.slice(idx + 1) : '';
      await page.authenticate({ username: user, password: pass });
    } else {
      await page.authenticate(null);
    }
    await page.setViewport({
      width: opts.width,
      height: opts.height,
      isMobile: opts.width < 500,
      hasTouch: opts.width < 500,
      deviceScaleFactor: 1,
    });

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) pageErrors.push(('console: ' + m.text()).slice(0, 160)); });

    // ---- 打开目标页 ----
    try {
      await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: 90000 });
    } catch (e) {
      const msg = String(e.message || e);
      console.error(`${C.red}打不开 ${opts.url}${C.r}`);
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(msg)) {
        console.error('连接被拒绝：本地站点没在跑。先启动站点（例如 PORT=3101 node server.js 或 npm run dev），');
        console.error('或者用线上地址，例如：');
        console.error(`  node scripts/ui-contrast-check.mjs --url http://139.9.176.191:8081/ --page agent --themes dark,light`);
      } else if (/ERR_NAME_NOT_RESOLVED/i.test(msg)) {
        console.error('域名解析失败，检查 --url 拼写。');
      } else if (/ERR_INVALID_AUTH_CREDENTIALS|401/i.test(msg)) {
        console.error('HTTP Basic 认证失败：用 --basic 用户名:密码 传正确的凭据。');
      } else if (/Timeout|timeout/i.test(msg)) {
        console.error('加载超时（networkidle2 90s）。页面可能一直在发请求，可稍后重试。');
      } else {
        console.error(`原因: ${msg.split('\n')[0]}`);
      }
      console.error(`${C.dim}提示: Edge/Chrome 需存在且可执行；当前探测结果 —— ${picked.note}${C.r}`);
      e.pkAlreadyReported = true;
      throw e;
    }

    // 等 SPA 引导完成（App 是 DOMContentLoaded 后才 new 的）
    await page.waitForFunction(() => !!document.querySelector('.page, #page-home'), { timeout: 30000 }).catch(() => {});
    await sleep(SETTLE_MS);

    // ---- 打开指定 SPA 页面 ----
    const openResult = await page.evaluate(async (name, settle) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const activeId = () => (document.querySelector('.page.active') || {}).id || null;
      const want = 'page-' + name;
      const out = { method: null, error: null };

      const card = document.querySelector(`.home-card[data-page="${name}"]`);
      if (card) {
        card.click();
        for (let i = 0; i < 40; i++) {           // 最多约 8s
          if (activeId() === want) { out.method = 'home-card-click'; break; }
          await sleep(200);
        }
        if (!out.method && activeId() === want) out.method = 'home-card-click';
      }

      if (!out.method) {
        try {
          if (window.App && typeof window.App.showPage === 'function') {
            window.App.showPage(name);
            await sleep(settle + 300);
            out.method = 'window.App.showPage';
          } else {
            out.error = 'window.App 不存在';
          }
        } catch (e) {
          out.error = String((e && e.message) || e);
        }
      }

      // 目标页里可能还要动态 import，再等一会儿（元素可能此刻还不存在，每轮重新查）
      for (let i = 0; i < 30; i++) {
        const target = document.getElementById(want);
        if (target && target.querySelector('button, input, textarea, .card, canvas')) break;
        await sleep(200);
      }
      await sleep(settle);
      out.active = activeId();
      out.ok = out.active === want;
      out.hasApp = !!(window.App && typeof window.App.showPage === 'function');
      return out;
    }, opts.page, SETTLE_MS);

    if (!opts.json) {
      if (openResult.ok) {
        console.error(`${C.dim}[i] 已打开页面 #page-${opts.page}（方式: ${openResult.method}）${C.r}`);
      } else {
        console.error(`${C.yel}[!] 没能确认 #page-${opts.page} 进入 active 状态` +
          `（当前 active=${openResult.active}，方式=${openResult.method || '无'}${openResult.error ? '，' + openResult.error : ''}）。` +
          `继续扫描当前可见内容。${C.r}`);
      }
    }

    // ---- 逐主题巡检 ----
    const results = [];
    for (const theme of opts.themes) {
      const applied = await page.evaluate((t) => {
        if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
        return document.documentElement.getAttribute('data-theme') || '(none = dark)';
      }, theme);
      await sleep(SETTLE_MS);

      const raw = await page.evaluate(inPageAudit, { minOverride: opts.min, sendSelector: '#agent-send-btn' });
      const sum = summarize(theme, raw, opts);
      sum.appliedThemeAttribute = applied;
      results.push(sum);
      if (!opts.json) printTheme(sum);
    }

    if (pageErrors.length && !opts.json) {
      console.error(`${C.dim}[i] 页面运行时报错（${pageErrors.length} 条，不影响对比度结论）: ${pageErrors.slice(0, 3).join(' | ')}${C.r}`);
    }

    // ---- 总结 ----
    const anyFail = results.some((r) => r.failed);
    if (opts.json) {
      const out = {
        tool: 'ui-contrast-check',
        version: 1,
        url: opts.url,
        page: opts.page,
        viewport: `${opts.width}x${opts.height}`,
        themes: opts.themes,
        minOverride: opts.min,
        browser: picked.note,
        generatedAt: new Date().toISOString(),
        passed: !anyFail,
        exitCode: anyFail ? 1 : 0,
        results,
        pageErrors: pageErrors.slice(0, 10),
      };
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log('');
      console.log('='.repeat(76));
      for (const r of results) {
        console.log(`  ${r.failed ? C.red + '✗ 不通过' + C.r : C.grn + '✓ 通过  ' + C.r}  主题 ${pad(r.theme, 6)} ` +
          `FAIL ${pad(r.counts.fail, 4)} CRITICAL ${pad(r.counts.critical, 4)} 未验证 ${pad(r.counts.unverifiable, 4)}` +
          (r.sendBtnFailed ? `  ${C.red}#agent-send-btn 对比度 < 3.0${C.r}` : ''));
      }
      console.log('='.repeat(76));
      console.log(anyFail
        ? `${C.red}${C.b}结论: 存在对比度不达标元素，退出码 1${C.r}`
        : `${C.grn}${C.b}结论: 全部通过，退出码 0${C.r}`);
      if (results.some((r) => r.counts.unverifiable > 0)) {
        console.log(`${C.yel}注意: 存在渐变/背景图上的文字，本脚本无法验证其对比度（见上面 UNVERIFIABLE 段）。${C.r}`);
      }
    }
    return anyFail ? 1 : 0;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* 已经在关了 */ }
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let code = 2;
try {
  code = await main();
} catch (e) {
  // 打不开页面时上面已经给过可读的原因了，这里只补一句，不再甩栈
  if (e && e.pkAlreadyReported) {
    console.error(`${C.red}巡检中止（退出码 2）${C.r}`);
  } else {
    console.error(`${C.red}巡检失败: ${(e && e.message) || e}${C.r}`);
    if (e && e.stack) console.error(`${C.dim}${String(e.stack).split('\n').slice(1, 4).join('\n')}${C.r}`);
  }
  code = 2;
}
process.exit(code);
