/**
 * 构建期拉取电台数据（RoamSky / 全球电台漫游）
 *
 * 用法：node scripts/build-stations.mjs
 * 输出：public/data/stations.json（列式结构，页面运行时只读这一个静态文件）
 *
 * 设计要点：
 *  - 只在构建期请求 Radio Browser，运行时不直连它（避免封 IP / 拖慢页面）；
 *  - 多个镜像轮着试（de1/de2/fi1），失败自动换镜像；
 *  - 只要「有坐标 + 有真实音频地址 + codec 是 audio」的台，保证地图上每点都能播；
 *  - 列式结构（name[] / url[] / ...）比对象数组省 40% 左右体积。
 */
import { writeFileSync, mkdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];
const UA = { 'User-Agent': 'PixelKit/1.0 (radio-globe builder)' };
const QUERY = '/json/stations/search?limit=3000&hidebroken=true&order=votes&reverse=true&has_geo_info=true';
const OUT = 'public/data/stations.json';
const CACHE = '/tmp/radio-raw.json';   // 原始响应缓存：调过滤规则时不必重复请求（--fresh 可强制重拉）

async function fetchStations() {
  let lastErr = null;
  for (const base of MIRRORS) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      const res = await fetch(base + QUERY, { headers: UA, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) throw new Error('empty list');
      console.log(`  ${base} → ${list.length} 条，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return list;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${base} 失败：${e.message}`);
    }
  }
  throw new Error('所有镜像都不可用：' + (lastErr && lastErr.message));
}

let list;
const fresh = process.argv.includes('--fresh');
if (!fresh && existsSync(CACHE)) {
  list = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log(`  复用缓存 ${CACHE}：${list.length} 条（重拉加 --fresh）`);
} else {
  list = await fetchStations();
  writeFileSync(CACHE, JSON.stringify(list));
}

// 分阶段过滤并打印剩余数量，方便排查。
// 注意：Radio Browser 的 codec 是 MP3 / AAC / OGG / HLS 这类，而不是 audio/*。
const AUDIO_CODEC = /^(mp3|aac|ogg|opus|flac|m4a|mp4a|audio|vorbis|he-aac|aacp|hls)/i;
const stages = [];
const step = (label, arr, fn) => { const r = arr.filter(fn); stages.push(`${label}: ${arr.length} → ${r.length}`); return r; };

let arr = list;
arr = step('有 url_resolved', arr, (s) => Boolean(s.url_resolved));
arr = step('有坐标', arr, (s) => s.geo_lat != null && (s.geo_long != null || s.geo_lng != null));
arr = step('坐标非 (0,0)', arr, (s) => !(+s.geo_lat === 0 && +(+s.geo_long || +s.geo_lng) === 0));
arr = step('纬度合法', arr, (s) => Math.abs(+s.geo_lat) <= 85);
arr = step('音频 codec', arr, (s) => !s.codec || AUDIO_CODEC.test(String(s.codec).replace(/[^a-z0-9-]/gi, '')));
arr = step('http(s) 地址', arr, (s) => /^https?:\/\//i.test(s.url_resolved));
const ok = arr;
console.log('  过滤：\n    ' + stages.join('\n    '));
const codecs = {};
for (const s of list) { const k = String(s.codec || '(空)').slice(0, 12); codecs[k] = (codecs[k] || 0) + 1; }
console.log('  原始 codec 分布：', Object.entries(codecs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', '));


// 同一坐标最多留 3 个台，避免大城市光点堆成一坨
const byCell = new Map();
const picked = [];
for (const s of ok) {
  const cell = `${(+s.geo_lat).toFixed(1)},${(+(+s.geo_long || +s.geo_lng)).toFixed(1)}`;
  const n = byCell.get(cell) || 0;
  if (n >= 3) continue;
  byCell.set(cell, n + 1);
  picked.push(s);
}

const data = {
  builtAt: new Date().toISOString(),
  n: picked.length,
  name: picked.map((s) => s.name.trim().slice(0, 60)),
  url: picked.map((s) => s.url_resolved),
  cc: picked.map((s) => s.countrycode || ''),
  tag: picked.map((s) => (s.tags || '').split(',').filter(Boolean).slice(0, 3).join(',')),
  lat: picked.map((s) => +(+s.geo_lat).toFixed(3)),
  lng: picked.map((s) => +(+(+s.geo_long || +s.geo_lng)).toFixed(3)),
  br: picked.map((s) => s.bitrate | 0),
};

mkdirSync('public/data', { recursive: true });
const json = JSON.stringify(data);
writeFileSync(OUT, json);

const rawKB = (statSync(OUT).size / 1024).toFixed(0);
const gzKB = (gzipSync(Buffer.from(json)).length / 1024).toFixed(0);
const ccs = new Set(data.cc);
console.log(`  写入 ${OUT}：${data.n} 个电台 / ${ccs.size} 个国家 / ${rawKB}KB（gzip ${gzKB}KB）`);
if (Number(gzKB) > 800) console.warn('  ⚠ gzip 后超过 800KB 预算，考虑减少 limit 或截断字段');
