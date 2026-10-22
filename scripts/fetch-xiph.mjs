// 第二目录源：Xiph/Icecast 公共目录 (dir.xiph.org/yp.xml)
// 无地理坐标 → 作为「Icecast 目录」补充，仅用于搜索/浏览，不放到地球/星图（避免伪造位置）
import fs from 'fs';

const URL = 'https://dir.xiph.org/yp.xml';
const OUT = 'public/data/extra-stations.json';

async function get() {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(URL, { headers: { 'User-Agent': 'PixelKitRadio/2.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
}

const xml = await get();
console.log('yp.xml 大小：' + (xml.length / 1048576).toFixed(1) + 'MB');

const dec = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();

const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
console.log('目录条目：' + entries.length);

const seen = new Set();
const out = [];
for (const e of entries) {
  const get = (tag) => { const m = e.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>')); return m ? dec(m[1]) : ''; };
  const name = get('server_name');
  const url = get('listen_url');
  if (!name || !url) continue;
  const key = url.replace(/\/+$/, '').toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  out.push({
    id: 'xiph-' + (out.length + 1),
    name: name.slice(0, 120),
    url,
    genre: get('genre').slice(0, 60),
    bitrate: Number(get('bitrate')) || 0,
    type: get('server_type'),
  });
  if (out.length >= 6000) break;
}

const payload = {
  builtAt: new Date().toISOString(),
  source: 'dir.xiph.org (Icecast YP directory)',
  note: '无地理坐标，仅用于搜索与播放，不参与地球/星图定位',
  total: out.length,
  stations: out,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log(`完成：去重后 ${out.length} 台，文件 ${(fs.statSync(OUT).size / 1048576).toFixed(2)}MB`);
