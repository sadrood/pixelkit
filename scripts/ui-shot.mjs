/**
 * 页面截图（用于设计评审）：把某个页面在「深/浅主题 × 桌面/手机」下各拍一张。
 *
 * 用法：
 *   node scripts/ui-shot.mjs --url http://127.0.0.1:3016/ --page agent --out .shots
 *   node scripts/ui-shot.mjs --url http://139.9.176.191:8081/ --page agent --themes dark,light
 *
 * 说明：本仓库没有外网截图服务，直接复用 puppeteer + Edge（与 ui-contrast-check.mjs 同一套启动方式）。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const URL_ = arg('url', 'http://127.0.0.1:3016/');
const PAGE = arg('page', 'agent');
const THEMES = String(arg('themes', 'dark,light')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(repo, arg('out', '.shots'));
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SETTLE = 900;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, dsf: 1 },
  { name: 'mobile', width: 390, height: 844, dsf: 2 },
];

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
try {
  browser = await puppeteer.launch({ executablePath: fs.existsSync(EDGE) ? EDGE : undefined, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Cross-Origin|favicon|Failed to load resource/i.test(m.text())) console.error('  [page error]', m.text().slice(0, 140)); });

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf });
    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(SETTLE);
    // 打开目标页面（点首页卡片，失败则走 SPA 路由）
    await page.evaluate(async (name) => {
      const card = document.querySelector(`[data-page="${name}"]`);
      if (card) { card.click(); return; }
      if (window.App?.showPage) window.App.showPage(name);
    }, PAGE).catch(() => {});
    await sleep(SETTLE);
    for (const theme of THEMES) {
      await page.evaluate((t) => {
        if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
      }, theme);
      await sleep(500);
      const file = path.join(OUT, `${PAGE}-${vp.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`  ✓ ${path.relative(repo, file)}`);
    }
  }
  console.log('截图完成 →', path.relative(repo, OUT));
} catch (e) {
  console.error('截图失败:', e.message);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
}
