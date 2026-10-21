/**
 * PixelKit 二维码「物理尺寸」黑盒验收脚本
 *
 * 用法：node lib/qr-size-check.mjs
 *   自带静态服务器（端口 0 自动分配）服务 dist/，不依赖外部已启动的服务；
 *   用系统 Chrome/Edge + puppeteer headless 走真实浏览器链路。
 *
 * 覆盖用例（task-2）：
 *   1) 首页 → 二维码页，默认口径 px、px 控件可见、phys 组隐藏
 *   2) phys / module / 10 mil / 600 DPI → PNG 174×174、hint 含 7.3 或 174、模块 ≈0.254mm
 *   3) 取回 PNG dataURL，sharp + jsQR 真实解码，断言原文
 *   4) 20 mil → 348×348，并再次解码
 *   5) PNG pHYs 元数据 DPI ≈ 600
 *   6) whole / 20 / mm / 300 DPI → 232×232
 *   7) SVG 物理模式：width/height 为 mm ≈7.36、存在 viewBox
 *   8) 无 pageerror；除 /api/* 外无 404 资源
 *
 * 覆盖用例（task-5「显示大小」补充）：
 *   9) 默认显示大小 256px，且不影响输出像素
 *  10) 选 320px：预览 320，输出 naturalWidth 仍按 #qr-size（显示 ≠ 输出）
 *  11) 自定义 480：预览 480，并传播到 #sl-qr / #qr-file-img
 *  12) 刷新后 localStorage 持久化恢复 custom/480
 *  13) 390px 窄屏下 480 预览被 max-width 收窄，不横向溢出
 *  14) px 256/512/1024 回归，显示宽度保持当前设置
 *  15) 整个流程（含刷新）仍无 pageerror / 非 API 404
 *
 * 退出码：全部通过 0，存在失败 1。
 * 截图输出：.tmp/qr-size/（phys 10mil、phys 20mil、SVG、display-480、display-narrow-390）
 *
 * 约束：只读 dist/ 与页面；除 .tmp/qr-size/ 外不写任何文件。
 */
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import jsQR from 'jsqr';

// ==================== 常量 ====================

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const SHOT_DIR = join(ROOT, '.tmp', 'qr-size');

/** 短文本：ECC M 下是 version 1（21 模块），total = 21 + 4×2 = 29 模块。
 *  10 mil / 600 DPI → 每模块 6px → 29×6 = 174px；20 mil → 348px；
 *  whole 20mm / 300 DPI → 236.2px，取 29 的整数倍 → 232px。 */
const TEST_TEXT = 'https://a.co';
const MODULES = 29;
const TIMEOUT = 15000;

/** Chrome / Edge 可执行文件（参考 lib/novel-shots.mjs） */
const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

// ==================== 断言 / 汇总 ====================

let assertIndex = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

function check(ok, desc, detail) {
  const n = ++assertIndex;
  if (ok) {
    passCount++;
    console.log(`PASS ${n}: ${desc}`);
  } else {
    failCount++;
    const line = `${desc}${detail ? ` — ${detail}` : ''}`;
    failures.push(line);
    console.log(`FAIL ${n}: ${line}`);
  }
  return !!ok;
}

async function runCase(title, fn) {
  console.log(`\n--- ${title} ---`);
  try {
    await fn();
  } catch (e) {
    check(false, `${title} 执行异常`, e && e.message ? e.message : String(e));
  }
}

// ==================== 静态服务器（dist + SPA fallback） ====================

function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    try {
      const method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('405 method not allowed');
        return;
      }

      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = url.pathname;
      try {
        pathname = decodeURIComponent(pathname);
      } catch { /* 保留原样 */ }

      // 测试环境没有后端：/api/* 一律 404（验收脚本会忽略 api 的 404）
      if (pathname.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'static test server: no backend' }));
        return;
      }

      const rel = pathname.replace(/^\/+/, '');
      let filePath = normalize(join(rootDir, rel));
      if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('403 forbidden');
        return;
      }

      let stat = safeStat(filePath);
      if (stat && stat.isDirectory()) {
        filePath = join(filePath, 'index.html');
        stat = safeStat(filePath);
      }

      // 不存在的路径：无扩展名 → SPA fallback 到 index.html；有扩展名 → 真 404
      if (!stat || !stat.isFile()) {
        if (!extname(pathname)) {
          filePath = join(rootDir, 'index.html');
          stat = safeStat(filePath);
        }
        if (!stat || !stat.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`404 ${pathname}`);
          return;
        }
      }

      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type,
        'content-length': stat.size,
        'cache-control': 'no-store',
      });
      if (method === 'HEAD') { res.end(); return; }
      createReadStream(filePath).pipe(res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 ' + (e && e.message ? e.message : 'server error'));
    }
  });

  return new Promise((resolveP, rejectP) => {
    server.once('error', rejectP);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectP);
      resolveP(server);
    });
  });
}

function safeStat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

// ==================== 浏览器页面小工具 ====================

function pickBrowser() {
  const found = BROWSER_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error('未找到系统 Chrome/Edge：' + BROWSER_CANDIDATES.join(' | '));
  }
  return found;
}

/** 元素是否存在且可见（父级 display:none 时 rect 为 0） */
async function getVisibility(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false, visible: false };
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      found: true,
      visible: rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
    };
  }, selector);
}

/** 等元素可见（超时 15s） */
async function waitVisible(page, selector, timeout = TIMEOUT) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  }, { timeout, polling: 100 }, selector);
}

async function clickEl(page, selector) {
  await page.$eval(selector, (el) => {
    try { el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
    el.click();
  });
}

async function setText(page, selector, text) {
  const ok = await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, text });
  if (!ok) throw new Error(`设置文本失败：找不到 ${selector}`);
}

/**
 * 设置表单控件（select / input 都支持），并回读确认值生效。
 * select 找不到 value 时会抛错并列出候选项，便于定位实现/脚本不一致。
 */
async function setControl(page, selector, value) {
  const result = await page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: `找不到元素 ${sel}` };
    const want = String(value);
    if (el.tagName === 'SELECT') {
      const opts = Array.from(el.options || []).map((o) => o.value);
      if (!opts.includes(want)) {
        return { ok: false, reason: `${sel} 没有 value="${want}" 选项（现有：${opts.join(', ')}）` };
      }
      el.value = want;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = want;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, actual: el.value };
  }, { sel: selector, value });

  if (!result.ok) throw new Error(result.reason);
  if (String(result.actual) !== String(value)) {
    throw new Error(`${selector} 设置后回读不一致：期望 "${value}"，实际 "${result.actual}"`);
  }
}

/** 读取 #qr-img 的状态（src / naturalWidth / naturalHeight / 是否加载完） */
async function readQrImg(page) {
  return page.evaluate(() => {
    const img = document.querySelector('#qr-img');
    if (!img) return null;
    return {
      src: img.getAttribute('src') || '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  });
}

/** 等 PNG 结果图达到期望边长（宽高相等） */
async function waitPngSize(page, expected, timeout = TIMEOUT) {
  await page.waitForSelector('#qr-img[src^="data:image/png"]', { timeout });
  await page.waitForFunction((w) => {
    const img = document.querySelector('#qr-img');
    if (!img) return false;
    const src = img.getAttribute('src') || '';
    return src.startsWith('data:image/png')
      && img.complete
      && img.naturalWidth === w
      && img.naturalHeight === w;
  }, { timeout, polling: 100 }, expected);
}

/** 读取元素 CSS 显示宽度（getBoundingClientRect，含 border-box） */
async function readRectWidth(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().width : null;
  }, selector);
}

/** 读取元素 inline style.width（显示大小由脚本直接写在 style 上） */
async function readInlineWidth(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.style.width : null;
  }, selector);
}

/** 等元素显示宽度达到期望值（±tol） */
async function waitRectWidth(page, selector, expected, tol = 1, timeout = TIMEOUT) {
  await page.waitForFunction(({ sel, expected, tol }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return Math.abs(el.getBoundingClientRect().width - expected) <= tol;
  }, { timeout, polling: 50 }, { sel: selector, expected, tol });
}

/** 读取 localStorage 中保存的显示大小设置（key: pixelkit_qr_display_size） */
async function readDisplayStore(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('pixelkit_qr_display_size') || 'null');
    } catch {
      return null;
    }
  });
}

/** dataURL → sharp raw → jsQR 解码。返回 { text, width, height, channels, buf } */
async function decodePngDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/is.exec(dataUrl || '');
  if (!m) throw new Error('不是 PNG base64 dataURL：' + String(dataUrl).slice(0, 60));
  const buf = Buffer.from(m[1], 'base64');
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('sharp 输出通道数异常：' + info.channels);
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const decoded = jsQR(rgba, info.width, info.height);
  return {
    text: decoded ? decoded.data : null,
    width: info.width,
    height: info.height,
    channels: info.channels,
    buf,
  };
}

/** 解析 PNG 第一段 pHYs（像素/米 → DPI）。返回 null 表示没有 pHYs */
function readPngPhys(buf) {
  if (!buf || buf.length < 8) return null;
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(SIG)) return null;

  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (dataStart + len + 4 > buf.length) break;
    if (type === 'pHYs') {
      if (len < 9) return null;
      const ppuX = buf.readUInt32BE(dataStart);
      const ppuY = buf.readUInt32BE(dataStart + 4);
      const unit = buf[dataStart + 8];
      return {
        ppuX,
        ppuY,
        unit, // 1 = 米
        dpiX: ppuX * 0.0254,
        dpiY: ppuY * 0.0254,
      };
    }
    if (type === 'IEND') break;
    off = dataStart + len + 4;
  }
  return null;
}

/** 从 SVG dataURL 取根节点属性 */
function readSvgRoot(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const raw = dataUrl.slice(comma + 1);
  let svg;
  try {
    svg = decodeURIComponent(raw);
  } catch {
    svg = raw;
  }
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return { attrs: null, svg };
  const tag = m[0];
  const attr = (name) => {
    const a = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    return a ? a[1] : null;
  };
  return {
    attrs: {
      width: attr('width'),
      height: attr('height'),
      viewBox: attr('viewBox'),
    },
    svg,
  };
}

/** "7.36mm" → { value: 7.36, unit: 'mm' } */
function parseLength(str) {
  if (str == null) return null;
  const m = /^\s*([\d.]+)\s*([a-z%]*)\s*$/i.exec(String(str));
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: (m[2] || '').toLowerCase() };
}

function isApiUrl(url) {
  try {
    return new URL(url).pathname.startsWith('/api/');
  } catch {
    return /\/api\//.test(String(url));
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('=== PixelKit 二维码物理尺寸黑盒验收 ===');
  console.log(`项目根目录: ${ROOT}`);
  console.log(`dist: ${DIST}`);
  console.log(`截图目录: ${SHOT_DIR}`);

  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`dist/index.html 不存在（请先构建）：${join(DIST, 'index.html')}`);
  }
  mkdirSync(SHOT_DIR, { recursive: true });

  const executablePath = pickBrowser();
  console.log(`浏览器: ${executablePath}`);

  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`静态服务器: ${baseUrl}`);

  let browser = null;
  const state = {};

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

    // ---- 页面错误 / 资源 404 收集（用例 8 汇总）----
    const pageErrors = [];
    const consoleErrors = [];
    const badResponses = [];
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (!res) return;
      if (res.status() === 404) badResponses.push({ url: res.url(), status: 404 });
    });

    // ---------- 用例 1：首页入口 + 默认 px 口径 ----------
    await runCase('用例 1：首页 → 二维码页，默认 px 口径', async () => {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.home-card[data-page="qr"]', { timeout: TIMEOUT });
      await clickEl(page, '.home-card[data-page="qr"]');

      await page.waitForSelector('#qr-size-mode', { timeout: TIMEOUT }); // 找不到即 FAIL（旧构建属预期）
      await page.waitForSelector('#qr-root', { timeout: TIMEOUT });
      // 2026-10-21：留白改成可调且默认 0；这里显式用标准 4，保持 174/348/232 的既有断言
      await setControl(page, '#qr-margin', '4');

      const mode = await page.$eval('#qr-size-mode', (el) => el.value);
      check(mode === 'px', '默认为 px 口径', `实际 #qr-size-mode value="${mode}"`);

      const pxSelect = await getVisibility(page, '#qr-size');
      check(pxSelect.visible, 'px 口径下 #qr-size（像素）可见', JSON.stringify(pxSelect));

      const pxDefault = await page.$eval('#qr-size', (el) => el.value).catch(() => null);
      check(pxDefault === '512', 'px 默认尺寸 = 512（行为不变）', `实际 #qr-size value="${pxDefault}"`);

      const physWrap = await getVisibility(page, '#qr-size-phys-wrap');
      check(physWrap.found && !physWrap.visible, 'px 口径下 phys 组隐藏', JSON.stringify(physWrap));

      const pxWrap = await getVisibility(page, '#qr-size-px-wrap');
      check(pxWrap.found && pxWrap.visible, 'px 组 #qr-size-px-wrap 可见', JSON.stringify(pxWrap));
    });

    // ---------- 用例 2：phys / module / 10 mil / 600 DPI → 174px ----------
    await runCase('用例 2：phys 10 mil / module / 600 DPI → 174×174', async () => {
      await setControl(page, '#qr-size-mode', 'phys');
      await waitVisible(page, '#qr-size-phys-wrap');

      // 补充：phys 控件默认值（规格：10 / mil / module / 600）
      const defaults = await page.evaluate(() => {
        const val = (sel) => {
          const el = document.querySelector(sel);
          return el ? el.value : null;
        };
        return {
          value: val('#qr-phys-value'),
          unit: val('#qr-phys-unit'),
          basis: val('#qr-phys-basis'),
          dpi: val('#qr-phys-dpi'),
        };
      });
      check(defaults.value === '10', 'phys 默认值 = 10', `实际 "${defaults.value}"`);
      check(defaults.unit === 'mil', 'phys 默认单位 = mil', `实际 "${defaults.unit}"`);
      check(defaults.basis === 'module', 'phys 默认基准 = module', `实际 "${defaults.basis}"`);
      check(defaults.dpi === '600', 'phys 默认 DPI = 600', `实际 "${defaults.dpi}"`);

      await setControl(page, '#qr-phys-basis', 'module');
      await setControl(page, '#qr-phys-value', '10');
      await setControl(page, '#qr-phys-unit', 'mil');
      await setControl(page, '#qr-phys-dpi', '600');

      const physWrap = await getVisibility(page, '#qr-size-phys-wrap');
      check(physWrap.visible, 'phys 口径下 phys 组可见');
      const pxWrap = await getVisibility(page, '#qr-size-px-wrap');
      check(pxWrap.found && !pxWrap.visible, 'phys 口径下 px 组隐藏', JSON.stringify(pxWrap));

      await setText(page, '#qr-text', TEST_TEXT);
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 174);
      await waitVisible(page, '#qr-gen-result');

      const img = await readQrImg(page);
      state.png10 = img.src;

      check(
        img.naturalWidth === 174 && img.naturalHeight === 174,
        '10 mil / 600 DPI → 174×174',
        `实际 ${img.naturalWidth}×${img.naturalHeight}`,
      );
      check(
        img.naturalWidth === MODULES * 6,
        '29 模块 × 6px = 174px（整数像素/模块）',
        `naturalWidth=${img.naturalWidth}`,
      );

      const hint = await page.evaluate(() => {
        const el = document.querySelector('#qr-phys-hint');
        return el ? el.textContent : null;
      });
      check(
        hint != null && (hint.includes('7.3') || hint.includes('174')),
        '#qr-phys-hint 含 "7.3"(mm) 或 "174"',
        `hint=${JSON.stringify(hint)}`,
      );

      // 模块物理尺寸 ≈ 0.254mm：优先从 hint 的 mm 数值推导，否则用 像素/DPI 换算
      const mmVals = [];
      if (hint) {
        for (const m of hint.matchAll(/([\d.]+)\s*mm/gi)) mmVals.push(parseFloat(m[1]));
      }
      let moduleMm = null;
      for (const v of mmVals) {
        if (Math.abs(v - 0.254) < 0.02) { moduleMm = v; break; }
        if (Math.abs(v / MODULES - 0.254) < 0.02) { moduleMm = v / MODULES; break; }
      }
      if (moduleMm == null && img.naturalWidth > 0) {
        moduleMm = (img.naturalWidth / MODULES) / 600 * 25.4; // 6px @600dpi
      }
      check(
        moduleMm != null && Math.abs(moduleMm - 0.254) <= 0.01,
        '模块物理尺寸 ≈ 0.254mm（10 mil）',
        `推算 moduleMm=${moduleMm == null ? 'null' : moduleMm.toFixed(4)}`,
      );

      await page.screenshot({ path: join(SHOT_DIR, 'phys-10mil.png'), fullPage: true });
      console.log(`  截图: ${join(SHOT_DIR, 'phys-10mil.png')}`);
    });

    // ---------- 用例 2b：留白 0（默认无白边）→ 126×126 且可真实解码 ----------
    await runCase('用例 2b：留白 0（默认无白边）→ 10mil/600 = 126×126', async () => {
      await setControl(page, '#qr-margin', '0');
      await setControl(page, '#qr-size-mode', 'phys');
      await setControl(page, '#qr-phys-basis', 'module');
      await setControl(page, '#qr-phys-value', '10');
      await setControl(page, '#qr-phys-unit', 'mil');
      await setControl(page, '#qr-phys-dpi', '600');
      await setControl(page, '#qr-format', 'png');
      await setText(page, '#qr-text', TEST_TEXT);
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 126);
      await waitVisible(page, '#qr-gen-result');

      const img = await readQrImg(page);
      check(
        img.naturalWidth === 126 && img.naturalHeight === 126,
        '留白 0 → 21 模块 × 6px = 126px（无白边）',
        `实际 ${img.naturalWidth}×${img.naturalHeight}`,
      );
      const dec = await decodePngDataUrl(img.src);
      check(dec.text === TEST_TEXT, '留白 0 的 PNG 真实解码通过', `decoded=${JSON.stringify(dec.text)}`);
      await page.screenshot({ path: join(SHOT_DIR, 'margin-0-126.png'), fullPage: true });

      // 恢复标准留白，后续用例继续沿用 174/348/232 / 7.366mm
      await setControl(page, '#qr-margin', '4');
    });

    // ---------- 用例 3：sharp + jsQR 真实解码 174px PNG ----------
    await runCase('用例 3：174px PNG 真实解码', async () => {
      if (!state.png10) throw new Error('用例 2 未取到 174px PNG dataURL，无法解码');
      const decoded = await decodePngDataUrl(state.png10);
      check(
        decoded.text === TEST_TEXT,
        `sharp+jsQR 解出原文 "${TEST_TEXT}"`,
        `实际 text=${JSON.stringify(decoded.text)}，图像 ${decoded.width}×${decoded.height}`,
      );
    });

    // ---------- 用例 4：20 mil → 348×348 + 解码 ----------
    await runCase('用例 4：20 mil → 348×348 且可解码', async () => {
      await setControl(page, '#qr-phys-value', '20');
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 348);

      const img = await readQrImg(page);
      state.png20 = img.src;

      check(
        img.naturalWidth === 348 && img.naturalHeight === 348,
        '20 mil / 600 DPI → 348×348',
        `实际 ${img.naturalWidth}×${img.naturalHeight}`,
      );
      check(
        img.naturalWidth === MODULES * 12,
        '29 模块 × 12px = 348px（整数像素/模块）',
        `naturalWidth=${img.naturalWidth}`,
      );

      const decoded = await decodePngDataUrl(img.src);
      check(
        decoded.text === TEST_TEXT,
        '348px PNG 真实解码通过',
        `实际 text=${JSON.stringify(decoded.text)}，图像 ${decoded.width}×${decoded.height}`,
      );

      await page.screenshot({ path: join(SHOT_DIR, 'phys-20mil.png'), fullPage: true });
      console.log(`  截图: ${join(SHOT_DIR, 'phys-20mil.png')}`);
    });

    // ---------- 用例 5：PNG pHYs DPI ≈ 600 ----------
    await runCase('用例 5：PNG pHYs 元数据 DPI ≈ 600', async () => {
      if (!state.png20) throw new Error('用例 4 未取到 348px PNG dataURL');
      const buf = Buffer.from(state.png20.slice(state.png20.indexOf(',') + 1), 'base64');
      const phys = readPngPhys(buf);

      check(!!phys, 'PNG 中存在 pHYs chunk', phys ? '' : '未找到 pHYs');
      if (phys) {
        check(phys.unit === 1, 'pHYs 单位 = 1（米）', `unit=${phys.unit}`);
        check(
          Math.abs(phys.dpiX - 600) <= 1 && Math.abs(phys.dpiY - 600) <= 1,
          'pHYs DPI ≈ 600（±1）',
          `dpiX=${phys.dpiX.toFixed(3)}, dpiY=${phys.dpiY.toFixed(3)}（ppuX=${phys.ppuX}, ppuY=${phys.ppuY}）`,
        );
      }

      const meta = await sharp(buf).metadata();
      check(
        typeof meta.density === 'number' && Math.abs(meta.density - 600) <= 1,
        'sharp 读取 density ≈ 600（外部门具交叉验证）',
        `density=${meta.density}`,
      );
    });

    // ---------- 用例 6：whole / 20mm / 300 DPI → 232×232 ----------
    await runCase('用例 6：whole 20mm / 300 DPI → 232×232', async () => {
      await setControl(page, '#qr-phys-basis', 'whole');
      await setControl(page, '#qr-phys-unit', 'mm');
      await setControl(page, '#qr-phys-value', '20');
      await setControl(page, '#qr-phys-dpi', '300');

      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 232);

      const img = await readQrImg(page);
      check(
        img.naturalWidth === 232 && img.naturalHeight === 232,
        'whole 20mm / 300 DPI → 232×232（≈236.2 向下取 29 的整数倍）',
        `实际 ${img.naturalWidth}×${img.naturalHeight}`,
      );
      check(
        img.naturalWidth === MODULES * 8,
        '29 模块 × 8px = 232px（整数像素/模块）',
        `naturalWidth=${img.naturalWidth}`,
      );
    });

    // ---------- 用例 7：SVG 物理模式 width/height = mm ≈7.36 ----------
    await runCase('用例 7：SVG 物理模式（10 mil / module）', async () => {
      await setControl(page, '#qr-phys-basis', 'module');
      await setControl(page, '#qr-phys-value', '10');
      await setControl(page, '#qr-phys-unit', 'mil');
      await setControl(page, '#qr-phys-dpi', '600');
      await setControl(page, '#qr-format', 'svg');

      await clickEl(page, '#qr-gen-btn');
      await page.waitForFunction(() => {
        const img = document.querySelector('#qr-img');
        return !!img && (img.getAttribute('src') || '').startsWith('data:image/svg+xml');
      }, { timeout: TIMEOUT, polling: 100 });

      const img = await readQrImg(page);
      state.svg = img.src;
      check(
        img.src.startsWith('data:image/svg+xml'),
        '结果 dataURL 是 SVG（svg+xml）',
        `src 前缀=${img.src.slice(0, 40)}`,
      );

      const root = readSvgRoot(img.src);
      check(!!root && !!root.attrs, 'SVG 根节点可解析');
      if (root && root.attrs) {
        const w = parseLength(root.attrs.width);
        const h = parseLength(root.attrs.height);
        check(
          !!w && w.unit === 'mm' && Math.abs(w.value - 7.366) <= 0.02,
          'SVG width 为 mm 且 ≈7.36mm（10 mil 模块 × 29）',
          `width=${JSON.stringify(root.attrs.width)}`,
        );
        check(
          !!h && h.unit === 'mm' && Math.abs(h.value - 7.366) <= 0.02,
          'SVG height 为 mm 且 ≈7.36mm',
          `height=${JSON.stringify(root.attrs.height)}`,
        );
        check(
          typeof root.attrs.viewBox === 'string' && root.attrs.viewBox.trim() !== '',
          'SVG 存在 viewBox',
          `viewBox=${JSON.stringify(root.attrs.viewBox)}`,
        );
      }

      await page.screenshot({ path: join(SHOT_DIR, 'svg.png'), fullPage: true });
      console.log(`  截图: ${join(SHOT_DIR, 'svg.png')}`);
    });

    // ---------- 用例 8：无 pageerror；除 /api/* 外无 404 ----------
    await runCase('用例 8：页面无异常、无资源 404', async () => {
      const real404 = badResponses.filter((r) => !isApiUrl(r.url));
      const api404 = badResponses.filter((r) => isApiUrl(r.url));

      check(
        pageErrors.length === 0,
        '页面无 pageerror',
        pageErrors.length ? pageErrors.join(' | ') : '',
      );
      check(
        real404.length === 0,
        '除 /api/* 外无 404 资源',
        real404.length
          ? real404.slice(0, 8).map((r) => `${r.status} ${r.url}`).join(' | ')
          : '',
      );

      if (consoleErrors.length) {
        console.log(`  备注：console.error × ${consoleErrors.length}（不计失败）：`);
        consoleErrors.slice(0, 8).forEach((t) => console.log(`    - ${t.slice(0, 300)}`));
      }
      if (api404.length) {
        console.log(`  备注：/api/* 404 × ${api404.length}（静态测试服务器无后端，已忽略）`);
      }
    });

    /* ==================== task-5：显示大小补验 ====================
       显示大小只改页面上 <img> 的 CSS 尺寸，不能改变下载/输出像素；
       选择存 localStorage（pixelkit_qr_display_size），刷新后恢复。 */

    // ---------- 用例 9：默认显示大小 256px ----------
    await runCase('用例 9：默认显示大小 = 256px（不影响输出像素）', async () => {
      const defaultMode = await page.$eval('#qr-display-size', (el) => el.value);
      check(defaultMode === '256', '默认 #qr-display-size = 256', `实际 "${defaultMode}"`);

      const wrap = await getVisibility(page, '#qr-display-custom-wrap');
      check(wrap.found && !wrap.visible, '默认自定义输入框隐藏', JSON.stringify(wrap));

      const inline = await readInlineWidth(page, '#qr-img');
      check(inline === '256px', '默认 #qr-img inline width = 256px', `实际 "${inline}"`);

      // 切回 px / PNG / 256：显示宽 256，输出像素也 256（显示大小未影响输出）
      await setControl(page, '#qr-size-mode', 'px');
      await setControl(page, '#qr-format', 'png');
      await setControl(page, '#qr-size', '256');
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 256);

      const img = await readQrImg(page);
      const rect = await readRectWidth(page, '#qr-img');
      check(img.naturalWidth === 256, 'px 256 输出 naturalWidth = 256', `实际 ${img.naturalWidth}`);
      check(Math.abs(rect - 256) <= 1, '默认显示宽度 = 256px（getBoundingClientRect）', `实际 ${rect}`);
    });

    // ---------- 用例 10：显示 320px，输出像素不变 ----------
    await runCase('用例 10：预览 320px，输出像素仍按 #qr-size（显示≠输出）', async () => {
      await setControl(page, '#qr-display-size', '320');
      await waitRectWidth(page, '#qr-img', 320);
      const inline = await readInlineWidth(page, '#qr-img');
      check(inline === '320px', '#qr-img inline width = 320px', `实际 "${inline}"`);

      await clickEl(page, '#qr-gen-btn');   // #qr-size 仍是 256
      await waitPngSize(page, 256);
      const img = await readQrImg(page);
      const rect = await readRectWidth(page, '#qr-img');
      check(img.naturalWidth === 256, '显示 320px 时输出 naturalWidth 仍为 256', `实际 ${img.naturalWidth}`);
      check(Math.abs(rect - 320) <= 1, '此时预览显示宽度 = 320px', `实际 ${rect}`);

      const store = await readDisplayStore(page);
      check(store && store.mode === '320', 'localStorage 记录 mode=320', `store=${JSON.stringify(store)}`);
    });

    // ---------- 用例 11：自定义 480px 并传播到 sl-qr / file-img ----------
    await runCase('用例 11：自定义 480px，传播到 #sl-qr / #qr-file-img', async () => {
      await setControl(page, '#qr-display-size', 'custom');
      const wrap = await getVisibility(page, '#qr-display-custom-wrap');
      check(wrap.visible, '选「自定义…」后 #qr-display-custom-wrap 可见', JSON.stringify(wrap));

      await setControl(page, '#qr-display-custom', '480');
      await waitRectWidth(page, '#qr-img', 480);

      const imgInline = await readInlineWidth(page, '#qr-img');
      const imgRect = await readRectWidth(page, '#qr-img');
      check(imgInline === '480px', '#qr-img inline width = 480px', `实际 "${imgInline}"`);
      check(Math.abs(imgRect - 480) <= 1, '预览显示宽度 = 480px', `实际 ${imgRect}`);

      const slInline = await readInlineWidth(page, '#sl-qr');
      const fileInline = await readInlineWidth(page, '#qr-file-img');
      check(slInline === '480px', '#sl-qr inline width = 480px（活码同尺寸传播）', `实际 "${slInline}"`);
      check(fileInline === '480px', '#qr-file-img inline width = 480px（文件码同尺寸传播）', `实际 "${fileInline}"`);

      const store = await readDisplayStore(page);
      check(
        !!store && store.mode === 'custom' && String(store.custom) === '480',
        'localStorage 记录 {mode:"custom", custom:"480"}',
        `store=${JSON.stringify(store)}`,
      );

      await page.screenshot({ path: join(SHOT_DIR, 'display-480.png'), fullPage: true });
      console.log(`  截图: ${join(SHOT_DIR, 'display-480.png')}`);
    });

    // ---------- 用例 12：刷新后 localStorage 持久化恢复 ----------
    await runCase('用例 12：刷新后持久化恢复 custom / 480px', async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.home-card[data-page="qr"]', { timeout: TIMEOUT });
      await clickEl(page, '.home-card[data-page="qr"]');
      await page.waitForSelector('#qr-display-size', { timeout: TIMEOUT });

      await page.waitForFunction(() => {
        const sel = document.querySelector('#qr-display-size');
        const img = document.querySelector('#qr-img');
        return !!sel && sel.value === 'custom' && !!img && img.style.width === '480px';
      }, { timeout: TIMEOUT, polling: 100 });

      const restored = await page.evaluate(() => ({
        mode: document.querySelector('#qr-display-size')?.value,
        custom: document.querySelector('#qr-display-custom')?.value,
        sizeMode: document.querySelector('#qr-size-mode')?.value,
        imgInline: document.querySelector('#qr-img')?.style.width || '',
      }));
      check(restored.mode === 'custom', '刷新后 #qr-display-size = custom', `实际 "${restored.mode}"`);
      check(restored.custom === '480', '刷新后 #qr-display-custom = 480', `实际 "${restored.custom}"`);
      check(restored.imgInline === '480px', '刷新后 #qr-img inline width = 480px', `实际 "${restored.imgInline}"`);
      check(restored.sizeMode === 'px', '刷新后尺寸口径回到默认 px', `实际 "${restored.sizeMode}"`);

      // 在持久化的显示 480 下生成 px 512：输出像素 512，显示仍 480
      await setText(page, '#qr-text', TEST_TEXT);
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 512);
      // 刷新后刚切页时 .page 入场动画可能带 transform 缩放，等布局稳定到 480px 再量
      await waitRectWidth(page, '#qr-img', 480);
      const img = await readQrImg(page);
      const rect = await readRectWidth(page, '#qr-img');
      check(img.naturalWidth === 512, '持久化后生成输出 naturalWidth = 512', `实际 ${img.naturalWidth}`);
      check(Math.abs(rect - 480) <= 1, '持久化后预览显示宽度 = 480px', `实际 ${rect}`);
    });

    // ---------- 用例 13：390px 窄屏不横向溢出 ----------
    await runCase('用例 13：390px 窄屏下 480px 预览被收窄、不溢出', async () => {
      try {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        // 收窄后布局需要重排；超时不直接抛，交给下面的断言输出实际值
        await page.waitForFunction(() => {
          const img = document.querySelector('#qr-img');
          return !!img && img.getBoundingClientRect().width < 480;
        }, { timeout: TIMEOUT, polling: 100 }).catch(() => {});

        const m = await page.evaluate(() => {
          const img = document.querySelector('#qr-img');
          const box = img ? img.closest('.qr-result') : null;
          const ir = img ? img.getBoundingClientRect() : { width: 0, height: 0 };
          const br = box ? box.getBoundingClientRect() : { width: 0 };
          return {
            imgW: ir.width,
            imgH: ir.height,
            boxW: br.width,
            scrollW: document.documentElement.scrollWidth,
            innerW: window.innerWidth,
          };
        });
        check(m.imgW > 0 && m.imgW < 480, '480px 预览在窄屏被 max-width 收窄', `imgW=${m.imgW}`);
        check(m.imgW <= m.boxW + 1, '预览宽度不超过 .qr-result 容器宽度', `imgW=${m.imgW}, boxW=${m.boxW}`);
        check(m.scrollW <= m.innerW + 1, '页面无横向溢出', `scrollWidth=${m.scrollW}, innerWidth=${m.innerW}`);

        await page.screenshot({ path: join(SHOT_DIR, 'display-narrow-390.png'), fullPage: true });
        console.log(`  截图: ${join(SHOT_DIR, 'display-narrow-390.png')}`);
      } finally {
        await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
      }
    });

    // ---------- 用例 14：px 256/512/1024 回归（显示宽保持 480） ----------
    await runCase('用例 14：px 256/512/1024 回归，display 480 保持', async () => {
      await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
      await setControl(page, '#qr-size-mode', 'px');
      await setControl(page, '#qr-format', 'png');
      for (const size of [256, 512, 1024]) {
        await setControl(page, '#qr-size', String(size));
        await clickEl(page, '#qr-gen-btn');
        await waitPngSize(page, size);
        const img = await readQrImg(page);
        const rect = await readRectWidth(page, '#qr-img');
        check(img.naturalWidth === size, `px ${size} 生成 naturalWidth = ${size}`, `实际 ${img.naturalWidth}`);
        check(Math.abs(rect - 480) <= 1, `px ${size} 时显示宽度仍为 480px`, `实际 ${rect}`);
      }
    });

    // ---------- 用例 15b：输出尺寸自定义 60px（下载文件就是 60×60） ----------
    await runCase('用例 15b：输出尺寸自定义 60px', async () => {
      await setControl(page, '#qr-size-mode', 'px');
      await setControl(page, '#qr-format', 'png');
      await setControl(page, '#qr-size', 'custom');
      await setControl(page, '#qr-size-custom', '60');
      await setText(page, '#qr-text', TEST_TEXT);
      await clickEl(page, '#qr-gen-btn');
      await waitPngSize(page, 60);
      const img = await readQrImg(page);
      check(
        img.naturalWidth === 60 && img.naturalHeight === 60,
        '输出自定义 60 → 图片 60×60',
        `${img.naturalWidth}×${img.naturalHeight}`,
      );
      await setControl(page, '#qr-size', '512');
    });

    // ---------- 用例 15：整个流程（含刷新）仍无异常 ----------
    await runCase('用例 15：显示大小补验后仍无页面异常', async () => {
      const real404 = badResponses.filter((r) => !isApiUrl(r.url));
      check(pageErrors.length === 0, '整个流程（含刷新）无 pageerror', pageErrors.join(' | '));
      check(
        real404.length === 0,
        '整个流程除 /api/* 外无 404 资源',
        real404.length ? real404.slice(0, 8).map((r) => `${r.status} ${r.url}`).join(' | ') : '',
      );
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    await new Promise((r) => server.close(() => r()));
  }

  // ---------- 汇总 ----------
  console.log('\n================ 汇总 ================');
  console.log(`PASS ${passCount} / FAIL ${failCount}（共 ${passCount + failCount} 条断言）`);
  if (failCount > 0) {
    console.log('失败明细：');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('退出码: 1');
    process.exitCode = 1;
  } else {
    console.log('全部通过。退出码: 0');
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
