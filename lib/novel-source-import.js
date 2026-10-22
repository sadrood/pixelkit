/**
 * 从分享链接导入书源（GET /api/novel/fetch-source）
 *
 * 分享站的合集包动辄 5～6MB、下载只有 ~100KB/s，一次要一分钟；站还可能随时挂。
 * 所以这里做两层本地化：
 *   ① lib/novel-sources/ 预置包 —— 随代码部署，命中后零网络；
 *   ② data/novel-sources/ 运行时缓存 —— 抓过一次就落盘，7 天内复用，
 *      站点抓取失败时回退到旧缓存。
 * 传 ?refresh=1 跳过两层缓存，强制重新抓。
 *
 * 安全：只允许 http/https，拒绝内网地址（字面量 + DNS 解析 + 逐跳重定向校验），
 * 限制 20MB / 120s。这里不执行任何站点 JS。
 */
import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESET_DIR = path.join(__dirname, 'novel-sources');
const CACHE_DIR = path.join(__dirname, '..', 'data', 'novel-sources');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_DEADLINE_MS = 120000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 内置默认书源：预置包随代码部署，服务器启动时直接灌进内存 */
export const DEFAULT_SOURCE_URL = 'https://www.yckceo.com/d/2b083d03088349019c892527cc9e25c9';

const normalizeUrl = (raw) => {
  try { return new URL(String(raw)).toString(); } catch { return String(raw || '').trim(); }
};
const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');

async function readBundle(dir, url) {
  try {
    const file = path.join(dir, keyOf(url) + '.json');
    const j = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(j.sources) || !j.sources.length) return null;
    if (j.url && normalizeUrl(j.url) !== url) return null;    // 哈希撞名保护
    return j;
  } catch { return null; }
}

async function writeCache(url, bundle) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, keyOf(url) + '.json');
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(bundle));
    await fs.rename(tmp, file);
  } catch { /* 缓存写失败不影响本次导入 */ }
}

const isPrivateIp = (raw) => {
  const ip = String(raw || '').toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  if (!ip) return true;
  if (ip === '::1' || ip === '::' || /^(fc|fd|fe80)/.test(ip)) return true;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return ip.includes(':');
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};

const assertPublicUrl = async (raw) => {
  let t;
  try { t = new URL(raw); } catch { throw Object.assign(new Error('链接格式不对'), { status: 400 }); }
  if (!/^https?:$/.test(t.protocol)) throw Object.assign(new Error('只支持 http/https 链接'), { status: 400 });
  const host = t.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local')) {
    throw Object.assign(new Error('不允许访问内网地址'), { status: 400 });
  }
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw Object.assign(new Error('不允许访问内网地址'), { status: 400 });
    return;
  }
  // 域名必须解析到公网地址，防止用 nip.io 之类绕过字面量检查
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('域名解析失败'), { status: 502 });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('不允许访问内网地址'), { status: 400 });
  }
};

const pickSources = (text) => {
  try {
    const j = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    const arr = Array.isArray(j) ? j : [j];
    const out = arr.filter((s) => s && typeof s === 'object' && (s.bookSourceUrl || s.bookSourceName));
    return out.length ? out : null;
  } catch { return null; }
};

const parseArray = (text) => {
  try {
    const j = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    return Array.isArray(j) ? j : [j];
  } catch { return null; }
};
const noBookFields = (x) => x && typeof x === 'object' && !x.bookSourceUrl && !x.bookSourceName;
const looksLikeRss = (x) => !!(x.ruleArticles || x.ruleLink || x.ruleTitle || x.sortUrl);

/**
 * YckCeo 的「源仓库订阅」长这样：{ sourceName, sourceUrl, enabled, ... }，
 * 没有 bookSourceUrl / 搜索规则。它只是仓库入口（指向 yckceo.vip 发布页），
 * 不是书源合集，导入进来也没法用 —— 单独识别出来给一句人话。
 */
const isRepoSubscription = (text) => {
  const arr = parseArray(text);
  return !!arr && arr.length > 0
    && arr.every((x) => noBookFields(x) && !looksLikeRss(x) && (x.sourceName || x.sourceUrl));
};

/** RSS 源合集（/yuedu/rsss/json/...）：字段是 ruleArticles/ruleLink/ruleTitle，没有章节规则 */
const isRssCollection = (text) => {
  const arr = parseArray(text);
  return !!arr && arr.some((x) => noBookFields(x) && looksLikeRss(x));
};

async function fetchSources(startUrl) {
  const deadline = Date.now() + FETCH_DEADLINE_MS;

  const fetchText = async (start) => {
    let u = String(start);
    for (let hop = 0; hop <= 4; hop++) {
      await assertPublicUrl(u);
      const left = deadline - Date.now();
      if (left < 2000) throw Object.assign(new Error('抓取超时（超过 120 秒）'), { status: 504 });
      const r = await fetch(u, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, text/html, */*', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        redirect: 'manual', signal: AbortSignal.timeout(Math.min(100000, left)),
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) throw Object.assign(new Error('HTTP ' + r.status), { status: 502 });
        u = new URL(loc, u).toString();
        continue;
      }
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: 502 });
      const declared = Number(r.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) throw Object.assign(new Error('文件太大（超过 20MB）'), { status: 422 });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) throw Object.assign(new Error('文件太大（超过 20MB）'), { status: 422 });
      return buf.toString('utf8');
    }
    throw Object.assign(new Error('重定向次数过多'), { status: 502 });
  };

  const text = await fetchText(startUrl);
  let sources = pickSources(text);
  let via = 'json';
  if (!sources) {
    // HTML 分享页：先找内嵌 JSON（script 里），再找 .json/.txt 下载链接
    const candidates = [];
    for (const m of String(text).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
      const j = m[1].match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (j) candidates.push(j[1]);
    }
    candidates.push(text);
    for (const c of candidates) { const p = pickSources(c); if (p) { sources = p; via = 'html-json'; break; } }
    if (!sources) {
      const links = [...String(text).matchAll(/(?:href|src|data-url)\s*=\s*["']([^"']+\.(?:json|txt)(?:\?[^"']*)?)["']/gi)].map((m) => m[1]);
      for (const link of [...new Set(links)].slice(0, 3)) {
        try {
          const p = pickSources(await fetchText(new URL(link, startUrl).toString()));
          if (p) { sources = p; via = 'link'; break; }
        } catch { /* 试下一个 */ }
      }
    }
  }
  if (!sources || !sources.length) {
    const gone = /地址不存在|页面不存在|已删除|已失效|not found/i.test(String(text).slice(0, 4000));
    const msg = isRssCollection(text)
      ? '这是 RSS 订阅源合集，不是书源；阅读器只能导入带搜索/目录/正文规则的书源'
      : isRepoSubscription(text)
        ? '这是「源仓库」订阅链接（只是仓库入口，不是书源合集），请在源仓库里导出书源 JSON 后再导入'
        : gone ? '这个分享链接已经失效（页面提示地址不存在）' : '页面里没有找到可用的书源 JSON';
    throw Object.assign(new Error(msg), { status: 422 });
  }
  return { sources, via };
}

/**
 * 内置默认书源。
 *
 * 优先读仓库里人工筛过的 defaults.json（每个源都实测过搜索+目录+正文），
 * 没有就退回分享包预置包里的全部书源 —— 网上的公开合集实测几百个源里
 * 只有个位数还能用，默认列表里放一堆死源只会让搜索变慢。
 */
export async function loadDefaultSources() {
  try {
    const j = JSON.parse(await fs.readFile(path.join(PRESET_DIR, 'defaults.json'), 'utf8'));
    const arr = (j.sources || []).filter((s) => s?.bookSourceUrl || s?.bookSourceName);
    if (arr.length) return arr;
  } catch { /* 没有精选列表就退回预置包 */ }
  const b = await readBundle(PRESET_DIR, normalizeUrl(DEFAULT_SOURCE_URL));
  return b?.sources || [];
}

export function createNovelSourceImportRouter() {
  const router = Router();
  router.get('/api/novel/fetch-source', async (req, res) => {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).json({ success: false, error: '缺少链接' });
    const url = normalizeUrl(raw);
    const refresh = /^(1|true)$/i.test(String(req.query.refresh || ''));

    if (!refresh) {
      // 先看运行时缓存：?refresh=1 强制刷新后写入的新包要能盖过预置包
      const hit = await readBundle(CACHE_DIR, url);
      const age = Date.now() - Date.parse(hit?.savedAt || 0);
      if (hit && age >= 0 && age < CACHE_TTL_MS) {
        return res.json({
          success: true, via: hit.via || 'cache', count: hit.sources.length,
          sources: hit.sources, cached: true, savedAt: hit.savedAt,
        });
      }
      const preset = await readBundle(PRESET_DIR, url);
      if (preset) {
        return res.json({
          success: true, via: preset.via || 'preset', count: preset.sources.length,
          sources: preset.sources, cached: true, preset: true, savedAt: preset.savedAt || '',
        });
      }
    }

    try {
      const { sources, via } = await fetchSources(url);
      const savedAt = new Date().toISOString();
      await writeCache(url, { url, savedAt, via, count: sources.length, sources });
      res.json({ success: true, via, count: sources.length, sources, savedAt });
    } catch (e) {
      // 站点挂了/改版了：有旧缓存就先用旧的，别让已经能用的书源包失效
      const stale = await readBundle(CACHE_DIR, url);
      if (stale) {
        return res.json({
          success: true, via: stale.via || 'cache', count: stale.sources.length,
          sources: stale.sources, cached: true, stale: true, savedAt: stale.savedAt || '',
          warning: '源链接抓取失败，已用本地缓存：' + (e.message || e),
        });
      }
      const status = e?.status || 502;
      res.status(status).json({ success: false, error: status === 400 ? e.message : '抓取失败：' + (e.message || e) });
    }
  });

  return router;
}
