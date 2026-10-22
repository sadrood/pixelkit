// 抽样探活：对一批电台流做 HEAD / GET Range 探测，生成 public/data/health-probe.json
// 结果：{ builtAt, source, sample, ok, dead, results: { id: [ok, status, ms] } }
import fs from 'fs';

const SRC = 'public/data/stations-lite.json';
const OUT = 'public/data/health-probe.json';
const SAMPLE = Number(process.argv[2] || 5000);
const CONCURRENCY = 24;
const TIMEOUT = 6000;

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
// 列式数据：id/url 平行数组
const ids = data.id || [];
const urls = data.url || [];
const stations = [];
for (let i = 0; i < ids.length; i++) if (urls[i]) stations.push({ id: ids[i], url: urls[i] });
console.log('候选电台：' + stations.length);
let health = null;
try { health = JSON.parse(fs.readFileSync('public/data/station-health.json', 'utf8')); } catch { /* ignore */ }
const deadSet = new Set((health && health.deadIds || []).map(String));
const pool = stations.filter((s) => s && s.url && !deadSet.has(String(s.id)));
const rest = stations.filter((s) => s && s.url && deadSet.has(String(s.id)));
const picked = [...pool.slice(0, SAMPLE)];
for (let i = 0; picked.length < SAMPLE && i < rest.length; i++) picked.push(rest[i]);

async function probe(url) {
  const t0 = Date.now();
  const attempt = async (method, headers) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { method, headers, redirect: 'follow', signal: ctl.signal });
      return { status: res.status, ok: res.status >= 200 && res.status < 400 };
    } finally { clearTimeout(timer); }
  };
  try {
    let r = await attempt('HEAD', { 'User-Agent': 'PixelKitRadio/2.0 (probe)' });
    if (!r.ok) {
      r = await attempt('GET', { 'User-Agent': 'PixelKitRadio/2.0 (probe)', Range: 'bytes=0-1023' });
    }
    return [r.ok ? 1 : 0, r.status, Date.now() - t0];
  } catch {
    return [0, 0, Date.now() - t0];
  }
}

const results = {};
let idx = 0, ok = 0, dead = 0;
async function worker() {
  while (idx < picked.length) {
    const s = picked[idx++];
    const r = await probe(s.url);
    results[String(s.id)] = r;
    if (r[0]) ok += 1; else dead += 1;
    if ((ok + dead) % 100 === 0) process.stdout.write(`\r探测 ${ok + dead}/${picked.length}（ok ${ok} / dead ${dead}）`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const out = {
  builtAt: new Date().toISOString(),
  source: 'pixelkit-local-probe (HEAD/Range, 6s timeout)',
  sample: picked.length, ok, dead, results,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n完成：抽样 ${picked.length}，可连 ${ok}（${((ok / picked.length) * 100).toFixed(1)}%），不可连 ${dead}，文件 ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
