import { createRequire } from 'module';
import path from 'path';
const repo = 'D:/aaa/work/work/workbuddy/new pinxlkite/pixelkit-source';
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await b.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 140)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://localhost:3101/', { waitUntil: 'networkidle2', timeout: 90000 });
await page.evaluate(() => { document.querySelectorAll('.clg-overlay').forEach((e) => e.remove()); });
const click = async (sel) => { await page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('missing ' + s); el.click(); }, sel); await new Promise((r) => setTimeout(r, 100)); };
// 进入人生之书（成长模拟器 → 加厚版条目）
await click('.home-card[data-page="lifesim"]');
await page.waitForSelector('[data-script]', { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll('[data-script]')].find((c) => /加厚版/.test(c.textContent)).click());
await page.waitForFunction(() => document.getElementById('page-book')?.classList.contains('active'), { timeout: 15000 });
await page.waitForSelector('button.wl', { timeout: 20000 });
await page.evaluate(() => document.querySelectorAll('button.wl')[0].click());
await page.waitForSelector('button.btn.pri', { timeout: 10000 });
// 玩到结算（随机）
await page.evaluate(() => [...document.querySelectorAll('button.btn.pri')].find((x) => /开始这一生/.test(x.textContent)).click());
let guard = 0;
while (guard++ < 200) {
  const done = await page.evaluate(() => !!(document.querySelector('.recap') || document.querySelector('.endtitle')));
  if (done) break;
  const acted = await page.evaluate(() => {
    const chs = [...document.querySelectorAll('button.ch')].filter((c) => !c.disabled);
    if (chs.length) { chs[Math.floor(Math.random() * chs.length)].click(); return 1; }
    const pri = [...document.querySelectorAll('button.btn.pri')].find((x) => /继续|结算|走向终点/.test(x.textContent));
    if (pri) { pri.click(); return 1; }
    return 0;
  });
  if (!acted) break;
  await new Promise((r) => setTimeout(r, 60));
}
// 点「AI 扩写这一生」，按秒采样 aiOut 字数，验证是"逐字增长"而不是一次蹦出来
await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find((x) => /AI 扩写这一生/.test(x.textContent)); if (btn) btn.click(); });
const samples = [];
for (let i = 0; i < 45; i++) {
  const len = await page.evaluate(() => (document.getElementById('aiOut')?.textContent || '').replace(/\s+/g, '').length);
  samples.push(len);
  if (len > 60 && samples.slice(-3).every((v) => v === len)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const finalText = await page.evaluate(() => (document.getElementById('aiOut')?.textContent || '').replace(/\s+/g, ' ').slice(0, 120));
const grew = samples.filter((v, i) => i > 0 && v > samples[i - 1]).length;
console.log(JSON.stringify({ samples: samples.slice(0, 24), 增长次数: grew, 最终字数: samples[samples.length - 1], finalText, errs: errs.slice(0, 5) }, null, 2));
await b.close();
