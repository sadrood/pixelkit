/**
 * 构建期生成「陆地点阵」掩膜（RoamSky 星图底图用）
 *
 * 做法：拉 Natural Earth 110m 陆地轮廓（TopoJSON），按 1.5° 经纬网格
 * 做扫描线填充，得到 COLS×ROWS 的陆地位图，位压缩 + base64 存成 ~4KB 的 JSON。
 * 前端解码后把「陆地格」画成暗绿点、「海洋格」画成更暗的点，构成点阵地球。
 *
 * 用法：node scripts/build-land.mjs
 * 输出：public/data/land-mask.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCES = [
  'https://unpkg.com/world-atlas@2/land-110m.json',
  'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json',
];

let topo = null;
let used = '';
for (const url of SOURCES) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'PixelKit/1.0 (land-mask builder)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    topo = await res.json();
    used = url;
    break;
  } catch (e) {
    console.warn(`  ${url} 失败：${e.message}`);
  }
}
if (!topo) throw new Error('所有镜像都拉不到 land-110m.json');

const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
});
const ringOf = (idxs) => {
  const pts = [];
  for (const idx of idxs) {
    const arrow = idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse();
    for (let i = pts.length ? 1 : 0; i < arrow.length; i++) pts.push(arrow[i]);
  }
  return pts;
};
const rings = [];
const geoms = topo.objects.land.type === 'GeometryCollection' ? topo.objects.land.geometries : [topo.objects.land];
for (const g of geoms) {
  const polys = g.type === 'MultiPolygon' ? g.arcs : g.type === 'Polygon' ? [g.arcs] : [];
  for (const poly of polys) for (const ring of poly) rings.push(ringOf(ring));
}

const STEP = 1.5;
const COLS = Math.round(360 / STEP);
const ROWS = Math.round(180 / STEP);
const grid = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  const lat = 90 - (r + 0.5) * STEP;
  const xs = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const c1 = Math.max(0, Math.ceil((xs[k] + 180) / STEP - 0.5));
    const c2 = Math.min(COLS - 1, Math.floor((xs[k + 1] + 180) / STEP - 0.5));
    for (let c = c1; c <= c2; c++) grid[r * COLS + c] = 1;
  }
}
const bits = new Uint8Array(Math.ceil(grid.length / 8));
let landCells = 0;
for (let i = 0; i < grid.length; i++) {
  if (!grid[i]) continue;
  bits[i >> 3] |= 1 << (i & 7);
  landCells += 1;
}
mkdirSync('public/data', { recursive: true });
const out = { cols: COLS, rows: ROWS, step: STEP, landCells, mask: Buffer.from(bits).toString('base64') };
const json = JSON.stringify(out);
writeFileSync('public/data/land-mask.json', json);
console.log(`  来源: ${used}`);
console.log(`  网格 ${COLS}×${ROWS}（${STEP}°），陆地格 ${landCells}，海洋格 ${grid.length - landCells}`);
console.log(`  写入 public/data/land-mask.json：${(json.length / 1024).toFixed(1)}KB`);
