// 抓取 Radio Browser 全量健康字段，生成 public/data/station-health.json
// 结构：{ builtAt, source, total, alive, dead, items: { <stationuuid>: [ok, lastcheckHours, clicks, votes] } }
import fs from 'fs';

const API = 'https://de1.api.radio-browser.info';
const FIELDS = 'stationuuid,lastcheckok,lastchecktime,clickcount,votes';

async function fetchPage(offset, limit) {
  const url = `${API}/json/stations/search?fields=${FIELDS}&limit=${limit}&offset=${offset}&hidebroken=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'PixelKitRadio/2.0 (health-merge)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const limit = 1000;
let offset = 0;
const items = {};
let total = 0, alive = 0, dead = 0;
const now = Date.now();

while (true) {
  let rows;
  let attempts = 0;
  while (true) {
    try { rows = await fetchPage(offset, limit); break; }
    catch (e) { attempts += 1; if (attempts >= 4) throw e; await new Promise((r) => setTimeout(r, 2500)); }
  }
  if (!Array.isArray(rows) || rows.length === 0) break;
  for (const r of rows) {
    const id = String(r.stationuuid || '').toLowerCase();
    if (!id) continue;
    const ok = r.lastcheckok ? 1 : 0;
    let hours = -1;
    if (r.lastchecktime) {
      const t = Date.parse(r.lastchecktime);
      if (Number.isFinite(t)) hours = Math.max(0, Math.round((now - t) / 3600000));
    }
    items[id] = [ok, hours, r.clickcount || 0, r.votes || 0];
    total += 1;
    if (ok) alive += 1; else dead += 1;
  }
  offset += rows.length;
  process.stdout.write(`\r已抓取 ${total} 台（alive ${alive} / dead ${dead}）`);
  if (rows.length < limit) break;
}

const out = {
  builtAt: new Date(now).toISOString(),
  source: 'radio-browser.info (lastcheckok/lastchecktime/clickcount/votes)',
  total, alive, dead,
  items,
};
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/station-health.json', JSON.stringify(out));
const mb = (fs.statSync('public/data/station-health.json').size / 1048576).toFixed(2);
console.log(`\n完成：${total} 台，alive=${alive} (${((alive / total) * 100).toFixed(1)}%)，dead=${dead}，文件 ${mb}MB`);
