/* 唱片态（dive）的 3D 点云：原站 de / Se / me..xe 的直译
 * - 9 种形态各生成 65,536 点，字段为 aFrom/aTo（含亮度）与 aBand（FFT 取样行列）
 * - 形态间靠 uProg + aSeed 错峰交叉淡入，几何只算一次后缓存
 * - genre/random 的解析沿用原站 gA()：按画质档选池，genre 查两张 11 项表
 */

export type DiveForm =
  | "genre"
  | "random"
  | "disc"
  | "orb"
  | "field"
  | "radar"
  | "galaxy"
  | "waves"
  | "pulsar"
  | "ring";

export type ResolvedForm = Exclude<DiveForm, "genre" | "random">;
export type DiveKey = ResolvedForm | "point";

export const DIVE_N = 65536;

/** 原站 de[]：mode 0=径向生长，1=沿 Y 轴；gain 是频带推力，spin 是自转速率 */
export const DIVE_CFG: Record<
  string,
  { mode: number; gain: number; spin: number; cam: [number, number, number]; look: [number, number, number] }
> = {
  point: { mode: 0, gain: 0, spin: 0, cam: [0, 0, 6.2], look: [0, 0, 0] },
  disc: { mode: 1, gain: 0.34, spin: 0.32, cam: [0, 3.4, 6], look: [0, -0.45, 0] },
  orb: { mode: 0, gain: 0.42, spin: 0.08, cam: [0, 0.3, 7.2], look: [0, 0, 0] },
  field: { mode: 1, gain: 0.9, spin: 0, cam: [0, 2.6, 6.2], look: [0, 0.15, -0.3] },
  radar: { mode: 1, gain: 0.5, spin: 0.9, cam: [0, 4.6, 3.4], look: [0, -0.2, 0] },
  galaxy: { mode: 0, gain: 0.32, spin: 0.16, cam: [0, 3.2, 5.4], look: [0, -0.2, 0] },
  waves: { mode: 1, gain: 0.9, spin: 0.05, cam: [0, 3, 6], look: [0, 0.2, 0] },
  pulsar: { mode: 1, gain: 0.75, spin: 0, cam: [0, 2, 5.6], look: [0, 0.1, 0] },
  ring: { mode: 0, gain: 0.85, spin: 0.04, cam: [0, 0, 6.4], look: [0, 0, 0] },
};

const LIGHT_FORMS: ResolvedForm[] = ["disc", "orb", "field"];
const HEAVY_FORMS: ResolvedForm[] = ["radar", "galaxy", "waves", "pulsar", "ring"];
const GENRE_LIGHT: ResolvedForm[] = [
  "field", "field", "field", "disc", "disc", "orb", "field", "disc", "field", "disc", "disc",
];
const GENRE_HEAVY: ResolvedForm[] = [
  "field", "radar", "ring", "disc", "pulsar", "waves", "field", "disc", "galaxy", "disc", "orb",
];

export function resolveForm(
  form: DiveForm,
  genre: number,
  pro = true,
  prev?: ResolvedForm | null
): ResolvedForm {
  const pool = pro ? [...LIGHT_FORMS, ...HEAVY_FORMS] : LIGHT_FORMS;
  if (form === "random") {
    const cand = pool.filter((f) => f !== prev);
    return cand[Math.floor(Math.random() * cand.length)] as ResolvedForm;
  }
  if (pool.includes(form as ResolvedForm)) return form as ResolvedForm;
  return ((pro ? GENRE_HEAVY : GENRE_LIGHT)[genre] ?? "disc") as ResolvedForm;
}

/* ---------- 原站 $N / eP：确定性随机 + 高斯 ---------- */

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let e = t;
    e = Math.imul(e ^ (e >>> 15), e | 1);
    e ^= e + Math.imul(e ^ (e >>> 7), e | 61);
    return ((e ^ (e >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box-Muller */
function gauss(n: () => number): number {
  const a = n() || 1e-6;
  const b = n();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

export interface DiveGeo {
  pos: Float32Array;
  band: Float32Array;
}

/* ---------- 9 种形态 ---------- */

function disc(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(23);
  const r = 0.62;
  for (let i = 0; i < N; i++) {
    const a = n();
    const o = n() * Math.PI * 2;
    let s: number;
    let c = 0;
    let l: number;
    if (a < 0.08) {
      s = 0.18 + Math.sqrt(n()) * 0.36;
      l = 0.55 + n() * 0.3;
      c = 0.01;
      t[i * 2] = 0.02 + n() * 0.05;
    } else if (a < 0.11) {
      s = 2.38 + n() * 0.01;
      l = 1.1;
      t[i * 2] = 0.9 + n() * 0.1;
    } else {
      const k = Math.floor(Math.pow(n(), 0.85) * 100);
      s = r + ((k + 0.5 + (n() - 0.5) * 0.35) / 100) * 1.73;
      l = 0.35 + 0.45 * (k % 7 === 0 ? 1 : n() * 0.5);
      t[i * 2] = Math.pow((s - r) / 1.73, 1.15);
    }
    e.set([s * Math.cos(o), c + (n() - 0.5) * 0.004, s * Math.sin(o), l], i * 4);
  }
  return { pos: e, band: t };
}

function orb(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(37);
  const r = (N * 0.78) | 0;
  const inc = Math.PI * (3 - Math.sqrt(5));
  for (let a = 0; a < r; a++) {
    const o = 1 - ((a + 0.5) / r) * 2;
    const s = Math.sqrt(1 - o * o);
    const c = a * inc;
    const l = 1.42;
    e.set([Math.cos(c) * s * l, o * l, Math.sin(c) * s * l, 0.38 + n() * 0.3], a * 4);
    t[a * 2] = 0.06 + n() * 0.5;
  }
  const rings = [
    [2.05, 0.55, 0.2],
    [2.45, -0.95, 1.1],
    [2.8, 1.25, 2.2],
  ];
  for (let i = r; i < N; i++) {
    const R = rings[(n() * 3) | 0];
    const o = n() * Math.PI * 2;
    const s = R[0] + (n() - 0.5) * 0.03;
    const c = Math.cos(o) * s;
    let l = Math.sin(o) * s;
    const u = Math.cos(R[1]);
    const d = Math.sin(R[1]);
    const f = -l * d;
    l *= u;
    const p = Math.cos(R[2]);
    const m = Math.sin(R[2]);
    const h = c * p - l * m;
    const g = c * m + l * p;
    e.set([h, f, g, 0.2 + n() * 0.25], i * 4);
    t[i * 2] = 0.5 + n() * 0.5;
  }
  return { pos: e, band: t };
}

function field(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(51);
  const r = N / 320;
  // mountain：起伏地形（多组正弦叠加山脊/山谷），配合 FFT 垂直律动
  const hAt = (x: number, z: number) => {
    const a = Math.sin(x * 1.55 + 0.7) * 0.42 + Math.sin(z * 1.9 - 0.4) * 0.3;
    const b = Math.sin((x + z) * 2.7 + 1.9) * 0.16 + Math.sin((x - z) * 3.9 - 0.8) * 0.1;
    const ridge = Math.pow(Math.abs(Math.sin(x * 1.05 + z * 0.55 + 0.9)), 1.6) * 0.28;
    return a + b + ridge;
  };
  for (let i = 0; i < N; i++) {
    const a = i % 320;
    const o = (i / 320) | 0;
    const sx = (a + n() * 0.7) / 320;
    const sz = (o + n() * 0.7) / r;
    const x = (sx - 0.5) * 6.6;
    const z = (sz - 0.5) * 4.8;
    const h = hAt(x, z);
    e.set([x, h, z, 0.42 + Math.max(0, h) * 0.9], i * 4);
    t[i * 2] = sx * 0.95 + 0.02;
    t[i * 2 + 1] = Math.max(0, Math.min(1, (h + 0.6) / 1.6));
  }
  return { pos: e, band: t };
}

function radar(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(61);
  for (let r = 0; r < N; r++) {
    const i = n();
    let a: number;
    let o: number;
    let s: number;
    if (i < 0.42) {
      const k = 1 + ((n() * 7) | 0);
      a = k * 0.32 + (n() - 0.5) * 0.012;
      o = n() * Math.PI * 2;
      s = 0.35 + (k % 2 ? 0 : 0.25);
    } else if (i < 0.56) {
      o = ((n() * 24) | 0) / 24 * Math.PI * 2 + (n() - 0.5) * 0.004;
      a = 0.2 + n() * 2.1;
      s = 0.18;
    } else if (i < 0.93) {
      const k = Math.pow(n(), 1.8);
      o = -k * 0.9;
      a = 0.12 + Math.sqrt(n()) * 2.2;
      s = 1.15 * (1 - k) + 0.08;
    } else {
      const k = rng(((n() * 9) | 0) * 31 + 5);
      o = k() * Math.PI * 2 + gauss(n) * 0.012;
      a = 0.5 + k() * 1.7 + gauss(n) * 0.025;
      s = 1.25;
    }
    e.set([a * Math.cos(o), 0, a * Math.sin(o), s], r * 4);
    t[r * 2] = Math.min(0.98, a / 2.4);
  }
  return { pos: e, band: t };
}

function galaxy(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(67);
  for (let r = 0; r < N; r++) {
    let i: number;
    let a: number;
    let o: number;
    let s: number;
    if (n() < 0.12) {
      const k = Math.abs(gauss(n)) * 0.22;
      const th = n() * Math.PI * 2;
      i = k * Math.cos(th);
      o = k * Math.sin(th);
      a = gauss(n) * 0.06;
      s = 1;
    } else {
      const th = n() < 0.5 ? 0 : Math.PI;
      const k = Math.pow(n(), 0.8);
      const rr = 0.25 + k * 2.3;
      const c = th + Math.log(rr / 0.25) * 2.2 + gauss(n) * (0.18 + 0.1 * k);
      i = rr * Math.cos(c) + gauss(n) * 0.05;
      o = rr * Math.sin(c) + gauss(n) * 0.05;
      a = gauss(n) * 0.03;
      s = 0.32 + 0.4 * (1 - k);
    }
    e.set([i, a, o, s], r * 4);
    t[r * 2] = Math.min(0.97, 0.03 + Math.sqrt(i * i + o * o) / 2.6);
  }
  return { pos: e, band: t };
}

function waves(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(71);
  for (let r = 0; r < N; r++) {
    const i = n();
    if (i < 0.04) {
      e.set([gauss(n) * 0.05, Math.abs(gauss(n)) * 0.1, gauss(n) * 0.05, 1.5], r * 4);
      t[r * 2] = 0.04;
      t[r * 2 + 1] = 0;
      continue;
    }
    const a = (n() * 14) | 0;
    const o = 0.3 + a * 0.19;
    const s = n() * Math.PI * 2;
    if (i < 0.8) {
      const rr = o + gauss(n) * 0.008;
      e.set([rr * Math.cos(s), 0, rr * Math.sin(s), 0.85 - (a / 14) * 0.55], r * 4);
      t[r * 2] = 0.05 + n() * 0.3;
    } else {
      const ph = Math.asin(n());
      e.set(
        [
          o * Math.cos(ph) * Math.cos(s),
          o * Math.sin(ph),
          o * Math.cos(ph) * Math.sin(s),
          (0.4 - (a / 14) * 0.28) * (0.4 + 0.6 * Math.sin(ph)),
        ],
        r * 4
      );
      t[r * 2] = 0.1 + (1 - Math.sin(ph)) * 0.6;
    }
    t[r * 2 + 1] = 0.002 + (a / 14) * 0.9;
  }
  return { pos: e, band: t };
}

function pulsar(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(73);
  for (let r = 0; r < N; r++) {
    const i = (n() * 22) | 0;
    const a = n() * 2 - 1;
    e.set(
      [
        a * 1.9,
        0,
        (0.5 - i / 22) * 3.6,
        (0.55 + 0.45 * (1 - Math.abs(a))) * (0.45 + 0.55 * (1 - i / 22)),
      ],
      r * 4
    );
    t[r * 2] = 0.03 + Math.pow(Math.abs(a), 0.7) * 0.95;
    t[r * 2 + 1] = 0.002 + (i / 22) * 0.9;
  }
  return { pos: e, band: t };
}

function ring(N = DIVE_N): DiveGeo {
  const e = new Float32Array(N * 4);
  const t = new Float32Array(N * 2);
  const n = rng(79);
  for (let r = 0; r < N; r++) {
    const i = n();
    const a = n() * Math.PI * 2;
    let o: number;
    let s = gauss(n) * 0.02;
    let c: number;
    if (i < 0.7) {
      o = 1.45 + Math.abs(gauss(n)) * 0.03;
      c = 0.6;
    } else if (i < 0.88) {
      o = 1.25 + gauss(n) * 0.008;
      c = 0.25;
    } else {
      o = Math.sqrt(n()) * 0.5;
      c = 0.35;
      s = gauss(n) * 0.05;
    }
    e.set([o * Math.cos(a), o * Math.sin(a), s, c], r * 4);
    t[r * 2] = i < 0.88 ? 0.03 + Math.abs(((a / Math.PI + 0.5) % 2) - 1) * 0.92 : 0.05;
  }
  return { pos: e, band: t };
}

const GEN: Record<ResolvedForm, (n?: number) => DiveGeo> = {
  disc, orb, field, radar, galaxy, waves, pulsar, ring,
};

const cache = new Map<string, DiveGeo>();

/** 几何只生成一次；点数按画质档（高画质 65,536 / 省电 32,768，原站同款） */
export function diveGeo(form: ResolvedForm, n = DIVE_N): DiveGeo {
  const key = form + ':' + n;
  let g = cache.get(key);
  if (!g) {
    g = GEN[form](n);
    cache.set(key, g);
  }
  return g;
}

/** 原站 Ce()：进/出唱片态时先把所有点收成一团，从这个位置散开 */
export function originCloud(x: number, y: number, z: number, r: number, N = DIVE_N): DiveGeo {
  const pos = new Float32Array(N * 4);
  const band = new Float32Array(N * 2);
  const n = rng(91);
  for (let i = 0; i < N; i++) {
    pos.set([x + gauss(n) * r, y + gauss(n) * r, z + gauss(n) * r, 0.9], i * 4);
    band[i * 2] = n();
  }
  return { pos, band };
}

/** 原站 $N(99)：aSeed 四维随机（x 错峰、y/z 抖动、w 亮度权重） */
export function diveSeeds(N = DIVE_N): Float32Array {
  const a = new Float32Array(N * 4);
  const n = rng(99);
  for (let i = 0; i < N * 4; i++) a[i] = n();
  return a;
}
