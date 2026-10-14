import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
// 本文件位于 <repo>/docs/人生之书/tools/，向上三级即仓库根
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer');
// 用法：先在本机起站点（PORT=3101 node server.js），再 node tools/book-page-e2e.mjs
//      对远端：BOOK_URL=http://139.9.176.191:8081/ node tools/book-page-e2e.mjs
const TARGET = process.env.BOOK_URL || 'http://localhost:3101/';
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

/* 对比度巡检：专抓「功能正常、但字看不见」这类回归。
   来历：2026-09-15 用户报告结果页「继续 →」按钮上的字看不见——外壳的 #app .btn
   是 id 选择器（1-1-0），盖过了书里 .pkb .btn.pri（0-3-0）的橙色底，
   变成白底白字（对比度 1.0），而所有功能测试都是绿的（按钮点得动）。
   这类问题只有量像素才发现，所以在这里按阶段扫一遍。 */
async function scanContrast(page, label) {
  const rows = await page.evaluate(() => {
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
    const out = [];
    document.querySelectorAll('#pkb-root button').forEach((el) => {
      if (el.offsetParent === null) return;                    // 跳过隐藏的
      const s = getComputedStyle(el);
      let bg = s.backgroundColor, p = el;
      while (p && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {  // 透明底往上找实际底色
        p = p.parentElement;
        if (p) bg = getComputedStyle(p).backgroundColor;
      }
      const r = ratio(s.color, bg);
      if (r !== null && r < 3.0) out.push({ text: (el.innerText || '').trim().slice(0, 18), cls: el.className, color: s.color, bg, ratio: r });
    });
    return out;
  });
  if (rows.length) {
    console.error(`!! 对比度过低（${label}）：${rows.length} 个按钮 < 3.0 —— 这类问题功能测试查不出，必须量像素`);
    rows.forEach((r) => console.error(`   ✗ 「${r.text}」class=${r.cls} color=${r.color} bg=${r.bg} 对比=${r.ratio}`));
  }
  return rows;
}

async function run(width, height, label) {
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 140)); });
  await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.evaluate(() => { document.querySelectorAll('.clg-overlay').forEach((e) => e.remove()); });
  /* 入口：首页「成长模拟器」→ 剧本列表里的「人生之书 · 玩法加厚版」（page:'book' 型条目，点击后 dispatch pk-goto） */
  const lifesimCard = await page.$('.home-card[data-page="lifesim"]');
  if (!lifesimCard) throw new Error('首页没有「成长模拟器」卡片');
  await page.evaluate(() => document.querySelector('.home-card[data-page="lifesim"]').click());
  await page.waitForSelector('[data-script]', { timeout: 20000 });
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-script]')].find((c) => /加厚版/.test(c.textContent));
    if (!card) return false;
    card.click(); return true;
  });
  if (!opened) throw new Error('剧本列表里没有「人生之书 · 玩法加厚版」条目');
  await page.waitForFunction(() => document.getElementById('page-book')?.classList.contains('active'), { timeout: 15000 });
  await page.waitForSelector('button.wl', { timeout: 20000 });
  const start = await page.evaluate(() => ({
    wl: [...document.querySelectorAll('button.wl b')].map((x) => x.textContent.trim()),
    bar: [...document.querySelectorAll('#page-book .toolbar-right button')].map((x) => x.textContent.trim()),
    paper: getComputedStyle(document.querySelector('.pkb')).backgroundColor,
    font: getComputedStyle(document.querySelector('.pkb')).fontFamily.slice(0, 30),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  // 开一局（选第一条世界线）
  await page.evaluate(() => document.querySelectorAll('button.wl')[0].click());
  await page.waitForSelector('button.btn.pri', { timeout: 10000 });
  const prologue = await page.evaluate(() => ({
    title: document.querySelector('#pkb-root h2')?.textContent,
    birth: document.querySelector('.epi')?.textContent?.replace(/\s+/g, ' ').slice(0, 60),
  }));
  const contrastPrologue = await scanContrast(page, label + '/prologue');   // 序章：「开始这一生」按钮在这一屏
  // AI 批注（走服务端）
  await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => /AI 写一句/.test(x.textContent)); if (btn) btn.click(); });
  let aiText = '';
  for (let i = 0; i < 40; i++) {
    aiText = await page.evaluate(() => document.querySelector('#aiOut')?.textContent?.replace(/\s+/g, ' ').trim() || '');
    if (aiText && !/正在生成/.test(aiText)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // 玩到结算
  await page.evaluate(() => [...document.querySelectorAll('button.btn.pri')].find((x) => /开始这一生/.test(x.textContent)).click());
  let guard = 0, lockedSeen = 0, litSeen = 0;
  while (guard++ < 200) {
    const st = await page.evaluate(() => ({ end: !!(document.querySelector('.recap') || document.querySelector('.endtitle')), locked: [...document.querySelectorAll('button.ch')].filter((c) => c.disabled).length, lit: document.querySelectorAll('.epi.lit').length }));
    lockedSeen += st.locked; litSeen = Math.max(litSeen, st.lit);
    if (st.end) break;
    const acted = await page.evaluate(() => {
      const chs = [...document.querySelectorAll('button.ch')].filter((c) => !c.disabled);
      if (chs.length) { chs[Math.floor(Math.random() * chs.length)].click(); return 1; }
      const pri = [...document.querySelectorAll('button.btn.pri')].find((x) => /继续|结算|走向终点/.test(x.textContent));
      if (pri) { pri.click(); return 1; }
      return 0;
    });
    if (!acted) break;
    await new Promise((r) => setTimeout(r, 70));
  }
  const end = await page.evaluate(() => ({
    title: document.querySelector('.endtitle')?.textContent || null,
    recap: document.querySelector('.recap')?.textContent?.replace(/\s+/g, ' ').slice(0, 90) || null,
    lamps: document.querySelectorAll('#pkb-root .lamps > *').length,
    attrs: document.querySelectorAll('#pkb-root .att').length,
  }));
  const contrastEnd = await scanContrast(page, label + '/end');   // 结局页：五个按钮都在这一屏
  // 弹窗：图鉴 / 成就 / 玩法
  const modalCheck = {};
  for (const [id, name] of [['bCodex', '图鉴'], ['bAch', '成就'], ['bHelp', '玩法']]) {
    await page.evaluate((i) => document.getElementById(i).click(), id);
    await new Promise((r) => setTimeout(r, 250));
    modalCheck[name] = await page.evaluate(() => ({ masks: document.querySelectorAll('#pkb-root .mask').length, hasModal: !!document.querySelector('#pkb-root .mask .modal') }));
    await page.evaluate(() => document.querySelectorAll('#pkb-root .mask').forEach((m) => m.remove()));
  }
  const geo = await page.evaluate(() => {
    const el = document.querySelector('#pkb-root .mask');
    const hist = document.createElement('div');
    return { overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
  });
  await page.close();
  return { label, start, prologue, aiText: aiText.slice(0, 70), end, modalCheck, lockedSeen, litSeen, geo,
           contrast: { prologue: contrastPrologue, end: contrastEnd }, errs: errs.slice(0, 8) };
}

const desktop = await run(1280, 900, 'desktop');
const mobile = await run(390, 844, 'mobile');
console.log(JSON.stringify({ desktop, mobile }, null, 2));
await b.close();
