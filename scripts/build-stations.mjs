/**
 * 构建期拉取电台数据（RoamSky）—— v2：高密度版本
 *
 * 参考 roamdial 的数据模型（逆向所得）：
 *   core: { n, genres[], langs[], countries[], lat[](×100), lng[](×100), g, l, c, br, pop }
 *   rest: { id[], name[], url[], tags[], state[], tz[] }
 * 共享数组 + 整数压缩，比对象数组小很多。
 *
 * 用法：node scripts/build-stations.mjs [--fresh]
 * 输出：public/data/stations.json
 */
import { writeFileSync, mkdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
const UA = { 'User-Agent': 'PixelKit/1.0 (radio-globe builder)' };
const OUT = 'public/data/stations.json';
const CACHE = '/tmp/radio-raw.json';
const TARGET = Number(process.env.RADIO_TARGET || 12000);

/** 11 个分类（中文 / 英文），和 roamdial 的分类维度一致 */
const GENRES = [
  { zh: '综合', en: 'General', tags: [] },
  { zh: '流行', en: 'Pop', tags: ['pop', 'top 40', 'chart', 'hits'] },
  { zh: '摇滚', en: 'Rock', tags: ['rock', 'alternative', 'indie', 'metal', 'punk', 'hardcore'] },
  { zh: '电子', en: 'Electronic', tags: ['electronic', 'house', 'techno', 'trance', 'dance', 'edm', 'ambient', 'chillout'] },
  { zh: '新闻谈话', en: 'News & Talk', tags: ['news', 'talk', 'information', 'current affairs', 'politics'] },
  { zh: '爵士与古典', en: 'Jazz & Classical', tags: ['jazz', 'classical', 'blues', 'swing', 'opera', 'soul'] },
  { zh: '地方与世界', en: 'Local & World', tags: ['world', 'folk', 'ethnic', 'local', 'latin', 'country', 'reggae'] },
  { zh: '嘻哈节奏', en: 'Hip-Hop & R&B', tags: ['hip hop', 'hip-hop', 'rap', 'r&b', 'rnb', 'funk', 'urban'] },
  { zh: '宗教', en: 'Religious', tags: ['religious', 'christian', 'gospel', 'islam', 'catholic', 'spiritual'] },
  { zh: '运动与娱乐', en: 'Sports & Entertainment', tags: ['sport', 'sports', 'comedy', 'entertainment', 'game'] },
  { zh: '轻松背景', en: 'Easy Listening', tags: ['easy listening', 'lounge', 'relax', 'sleep', 'meditation', 'soundtrack', 'oldies'] },
];
const LANGS = ['未标注', '英语', '法语', '西班牙语', '德语', '中文', '葡萄牙语', '意大利语', '俄语', '阿拉伯语', '日语', '韩语', '荷兰语', '波兰语', '土耳其语', '印地语', '其他'];
const LANG_KEYS = [
  [], ['english', '英语'], ['french', '法语'], ['spanish', '西班牙语'], ['german', '德语'], ['chinese', '中文', 'mandarin', 'cantonese'],
  ['portuguese', '葡萄牙语'], ['italian', '意大利语'], ['russian', '俄语'], ['arabic', '阿拉伯语'], ['japanese', '日语'],
  ['korean', '韩语'], ['dutch', '荷兰语'], ['polish', '波兰语'], ['turkish', '土耳其语'], ['hindi', '印地语'],
];

async function fetchStations() {
  let lastErr = null;
  for (const base of MIRRORS) {
    const t0 = Date.now();
    try {
      const pages = Math.ceil(TARGET / 3000);
      const all = [];
      for (let page = 0; page < pages; page++) {
        const q = `/json/stations/search?limit=3000&offset=${page * 3000}&hidebroken=true&order=votes&reverse=true`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 240000);
        const res = await fetch(base + q, { headers: UA, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = await res.json();
        if (!Array.isArray(list) || !list.length) throw new Error('empty page');
        all.push(...list);
        console.log(`    ${base} 第 ${page + 1}/${pages} 页 → ${list.length} 条（累计 ${all.length}）`);
        if (list.length < 3000) break;
      }
      console.log(`  ${base} 合计 ${all.length} 条，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return all;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${base} 失败：${e.message}`);
    }
  }
  throw new Error('所有镜像都不可用：' + (lastErr && lastErr.message));
}

let list;
if (!process.argv.includes('--fresh') && existsSync(CACHE)) {
  list = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log(`  复用缓存 ${CACHE}：${list.length} 条（重拉加 --fresh）`);
} else {
  list = await fetchStations();
  writeFileSync(CACHE, JSON.stringify(list));
}

/* ---------- 清洗 ---------- */
const ok = list.filter((s) => s.url_resolved && /^https?:\/\//i.test(s.url_resolved) && s.name);
console.log(`  可用（有 url）: ${list.length} → ${ok.length}`);

/* ---------- 国家中心点：用有坐标的台算出每个国家的大致中心 ---------- */
const acc = new Map();
for (const s of ok) {
  if (s.geo_lat == null || s.geo_long == null) continue;
  const lat = +s.geo_lat, lng = +s.geo_long;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
  const k = s.countrycode || '??';
  const a = acc.get(k) || { lat: 0, lng: 0, n: 0 };
  a.lat += lat; a.lng += lng; a.n += 1;
  acc.set(k, a);
}
const centroid = new Map();
for (const [k, a] of acc) centroid.set(k, { lat: a.lat / a.n, lng: a.lng / a.n });

/* ---------- 分类 / 语言映射 ---------- */
const norm = (s) => String(s || '').toLowerCase();
function genreOf(tags) {
  const t = norm(tags);
  if (!t) return 0;
  for (let i = 1; i < GENRES.length; i++) {
    if (GENRES[i].tags.some((g) => t.includes(g))) return i;
  }
  return 0;
}
function langOf(s) {
  const t = norm((s.language || '') + ',' + (s.tags || ''));
  for (let i = 1; i < LANG_KEYS.length; i++) {
    if (LANG_KEYS[i][0] && t.includes(LANG_KEYS[i][0])) return i;
  }
  return 0;
}

/* ---------- 列式数据 ---------- */
const countriesOrder = [];
const countryIndex = new Map();
const rows = [];
let usedFallback = 0;
for (const s of ok) {
  const cc = s.countrycode || '??';
  let lat = s.geo_lat == null ? null : +s.geo_lat;
  let lng = s.geo_long == null ? null : +s.geo_long;
  let prec = 0;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    prec = 2;
  } else {
    const c = centroid.get(cc);
    if (!c) continue;
    lat = c.lat; lng = c.lng; prec = 0; usedFallback += 1;
    // 同国家同中心会重叠：用台名哈希做微扰，避免完全叠在一起
    let h = 0; for (let i = 0; i < s.name.length; i++) h = (h * 31 + s.name.charCodeAt(i)) >>> 0;
    const jitter = 1.2;
    lat += ((h % 1000) / 1000 - 0.5) * jitter;
    lng += (((h >> 10) % 1000) / 1000 - 0.5) * jitter * 2;
  }
  let ci = countryIndex.get(cc);
  if (ci == null) { ci = countriesOrder.length; countryIndex.set(cc, ci); countriesOrder.push(cc); }
  rows.push({
    id: String(s.stationuuid || '').replace(/-/g, '').slice(0, 12),
    name: s.name.trim().slice(0, 60),
    url: s.url_resolved,
    tags: String(s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4).join(','),
    state: (s.state || '').slice(0, 30),
    lat: Math.round(lat * 100),
    lng: Math.round(lng * 100),
    br: s.bitrate | 0,
    g: genreOf(s.tags + ',' + (s.name || '')),
    l: langOf(s),
    c: ci,
    prec,
    pop: Math.min(9, Math.round(Math.log10((s.votes | 0) + 1) * 2)),
  });
}
console.log(`  坐标兜底（落到国家中心）: ${usedFallback} 个`);

const data = {
  v: 2,
  builtAt: new Date().toISOString(),
  n: rows.length,
  genres: GENRES.map((g) => g.zh),
  genresEn: GENRES.map((g) => g.en),
  langs: LANGS,
  cc: countriesOrder,
  lat: rows.map((r) => r.lat),
  lng: rows.map((r) => r.lng),
  g: rows.map((r) => r.g),
  l: rows.map((r) => r.l),
  c: rows.map((r) => r.c),
  br: rows.map((r) => r.br),
  prec: rows.map((r) => r.prec),
  pop: rows.map((r) => r.pop),
  id: rows.map((r) => r.id),
  name: rows.map((r) => r.name),
  url: rows.map((r) => r.url),
  tags: rows.map((r) => r.tags),
};
mkdirSync('public/data', { recursive: true });
const json = JSON.stringify(data);
writeFileSync(OUT, json);
const rawKB = (statSync(OUT).size / 1024).toFixed(0);
const gzKB = (gzipSync(Buffer.from(json)).length / 1024).toFixed(0);
console.log(`  写入 ${OUT}：${data.n} 个电台 / ${countriesOrder.length} 个国家 / ${rawKB}KB（gzip ${gzKB}KB）`);

// 核心包：按原顺序（票数降序）取前 4000 台，先出图用（约 500KB）
const LITE = Math.min(4000, data.n);
const part = (arr) => arr.slice(0, LITE);
const lite = {
  v: 2, builtAt: data.builtAt, n: LITE,
  genres: data.genres, genresEn: data.genresEn, langs: data.langs, cc: data.cc,
  lat: part(data.lat), lng: part(data.lng), g: part(data.g), l: part(data.l),
  c: part(data.c), br: part(data.br), prec: part(data.prec), pop: part(data.pop),
  id: part(data.id), name: part(data.name), url: part(data.url), tags: part(data.tags),
};
const liteJson = JSON.stringify(lite);
writeFileSync('public/data/stations-lite.json', liteJson);
console.log(`  写入 public/data/stations-lite.json：${LITE} 个电台 / ${(liteJson.length / 1024).toFixed(0)}KB（核心包，首屏用）`);
