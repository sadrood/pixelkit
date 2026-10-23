/* 电台数据集：globe_core.json（坐标/流派/国家/语言/码率，列式紧凑）
 * + globe_rest.json（台名/流地址/标签/州/时区索引），两者同序同长（35,699 条）。
 * 与原站 https://roamdial.com/ 使用同一份构建产物（builtAt 2026-10-19T03:43:49.992Z）。 */

export interface StationMeta {
  n: number;
  builtAt: string;
  /** 流派中文名（11 个，索引即 g 字段） */
  genres: string[];
  /** 流派英文名（原站 bundle 内置回退） */
  genresEn: string[];
  /** 流派主题色（原站 PA 数组，索引同上） */
  genreColors: string[];
  /** 语言名 [zh, en] */
  langs: [string, string][];
  /** 国家 [code, zh, en] */
  countries: [string, string, string][];
  /** 时区名 */
  tzs: string[];
}

export interface Station {
  idx: number;
  /** Radio Browser station uuid（分享令牌） */
  id: string;
  name: string;
  /** 流地址（url_resolved） */
  url: string;
  tags: string[];
  state: string;
  lat: number;
  lng: number;
  /** 位置精度：0/1/2 = 国家级/城市级，>=3 = 台级 */
  prec: number;
  /** 流派索引 */
  genre: number;
  /** 语言索引 */
  lang: number;
  /** 国家索引 */
  country: number;
  /** 热度 */
  pop: number;
  /** 码率 kbps，0 = 未知 */
  br: number;
  /** 时区索引 */
  tz: number;
}

/* 原站 index.js 内置的流派英文名与配色（IA/LA/PA） */
const GENRES_EN_FALLBACK = [
  "Pop", "Rock", "Electronic", "Jazz & Blues", "Classical",
  "News & Talk", "Hip-hop", "Country & Folk", "Local & World",
  "Religious", "Mixed",
];
const GENRE_COLORS = [
  "#E8A9A0", "#D99A7E", "#7FC8C0", "#D8B26E", "#EDE3CC", "#9DB4D6",
  "#B7A3D9", "#A9C08A", "#E2C35A", "#C8B49A", "#8FA39C",
];

let cache: { stations: Station[]; meta: StationMeta } | null = null;
let loading: Promise<{ stations: Station[]; meta: StationMeta }> | null = null;

/** 载入并合并两份数据（只跑一次） */
export function loadStations(): Promise<{ stations: Station[]; meta: StationMeta }> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = (async () => {
    const [core, rest] = await Promise.all([
      fetch("/roamdial/globe_core.json").then((r) => r.json()),
      fetch("/roamdial/globe_rest.json").then((r) => r.json()),
    ]);
    const n: number = core.n;
    const stations: Station[] = new Array(n);
    for (let i = 0; i < n; i++) {
      stations[i] = {
        idx: i,
        id: rest.id[i],
        name: rest.name[i] || "",
        url: rest.url[i],
        tags: rest.tags[i] ? rest.tags[i].split(",").filter(Boolean) : [],
        state: rest.state[i] || "",
        lat: core.lat[i] / 100,
        lng: core.lng[i] / 100,
        prec: core.prec[i],
        genre: core.g[i],
        lang: core.l[i],
        country: core.c[i],
        pop: core.pop[i],
        br: core.br[i],
        tz: rest.tz[i],
      };
    }
    const meta: StationMeta = {
      n,
      builtAt: core.builtAt,
      genres: core.genres,
      genresEn: core.genresEn?.length ? core.genresEn : GENRES_EN_FALLBACK,
      genreColors: GENRE_COLORS,
      langs: core.langs.map((zh: string, i: number) => [zh, core.langsEn[i] ?? zh] as [string, string]),
      countries: core.countries,
      tzs: core.tzs,
    };
    cache = { stations, meta };
    return cache;
  })();
  return loading;
}

export function getStations(): Station[] | null {
  return cache?.stations ?? null;
}

export function getMeta(): StationMeta | null {
  return cache?.meta ?? null;
}

/* ------------------------------------------------------------------ */
/*  查询助手                                                           */
/* ------------------------------------------------------------------ */

/** 可播放流（有 url）的电台 */
export function playable(s: Station): boolean {
  return !!s.url;
}

/** 随机取 n 个可播放电台（不重复） */
export function randomStations(stations: Station[], n = 1, exclude?: number): Station[] {
  const out: Station[] = [];
  const seen = new Set<number>();
  if (exclude != null) seen.add(exclude);
  let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const i = Math.floor(Math.random() * stations.length);
    if (seen.has(i) || !playable(stations[i])) continue;
    seen.add(i);
    out.push(stations[i]);
  }
  return out;
}

/** 按 id（分享令牌）找电台 */
export function findById(stations: Station[], id: string): Station | null {
  return stations.find((s) => s.id === id) ?? null;
}

/** 搜索：台名 / 州（城市）/ 国家，三科匹配，大小写不敏感 */
export function searchStations(
  stations: Station[],
  meta: StationMeta,
  q: string,
  limit = 24
): Station[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const out: Station[] = [];
  for (const s of stations) {
    if (!playable(s)) continue;
    const country = meta.countries[s.country];
    if (
      s.name.toLowerCase().includes(query) ||
      (s.state && s.state.toLowerCase().includes(query)) ||
      country[1].includes(query) ||
      country[2].toLowerCase().includes(query) ||
      country[0].toLowerCase() === query
    ) {
      out.push(s);
      if (out.length >= limit * 4) break;
    }
  }
  // 有台名命中的排前面，其余按热度
  out.sort((a, b) => {
    const an = a.name.toLowerCase().includes(query) ? 0 : 1;
    const bn = b.name.toLowerCase().includes(query) ? 0 : 1;
    return an - bn || b.pop - a.pop;
  });
  return out.slice(0, limit);
}

/** 同城换台（↑↓）：精度>=3 的同州台，或经纬度 2° 内的城市级台 */
export function nearbyStations(stations: Station[], s: Station, limit = 40): Station[] {
  const out: Station[] = [];
  for (const a of stations) {
    if (a.idx === s.idx || !playable(a)) continue;
    if (s.prec >= 3) {
      if (a.prec >= 3 && a.country === s.country && a.state === s.state) out.push(a);
    } else if (
      a.prec < 3 &&
      a.country === s.country &&
      Math.abs(a.lat - s.lat) < 2 &&
      Math.abs(a.lng - s.lng) < 2
    ) {
      out.push(a);
    }
    if (out.length >= limit) break;
  }
  out.sort((a, b) => b.pop - a.pop);
  return out;
}

/** 原站 it(e)：唱片视图的翻页列表。精度足够（>=3）就取同国家，否则取 ±2° 框内的低精度台；
 *  按热度降序、截到 300 个，当前台若挤不进前 300 就插到最前——列表里永远有当前台。 */
/** 按用户坐标找最近的可播电台（haversine，单位 km） */
export function nearestByCoord(
  stations: Station[],
  lat: number,
  lon: number,
  limit = 20
): (Station & { distanceKm: number })[] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const out: (Station & { distanceKm: number })[] = [];
  for (const a of stations) {
    if (!playable(a)) continue;
    const dLat = toRad(a.lat - lat);
    const dLon = toRad(a.lng - lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(a.lat)) * Math.sin(dLon / 2) ** 2;
    out.push({ ...a, distanceKm: 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) });
  }
  out.sort((x, y) => x.distanceKm - y.distanceKm);
  return out.slice(0, limit);
}

export function diveList(stations: Station[], cur: Station, limit = 300): Station[] {
  const sameCountry = cur.prec >= 3;
  const out = stations.filter((a) =>
    sameCountry
      ? a.country === cur.country
      : a.prec < 3 && Math.abs(a.lat - cur.lat) < 2 && Math.abs(a.lng - cur.lng) < 2
  );
  out.sort((a, b) => b.pop - a.pop);
  const list = out.length > 1 ? out.slice(0, limit) : [cur];
  if (!list.includes(cur)) list.unshift(cur);
  return list;
}

/** 流派计数（与原站底部 chips 一致） */
export function genreCounts(stations: Station[]): number[] {
  const counts = new Array(11).fill(0);
  for (const s of stations) counts[s.genre]++;
  return counts;
}

/** 当前筛选条件下可见的电台索引集合（流派多选 + 语言过滤 + 搜索词） */
export function visibleFilter(
  stations: Station[],
  opts: { genres?: Set<number>; langs?: Set<number>; query?: string }
): (s: Station) => boolean {
  const { genres, langs, query } = opts;
  const q = query?.trim().toLowerCase() ?? "";
  return (s) => {
    if (genres && genres.size > 0 && !genres.has(s.genre)) return false;
    if (langs && langs.size > 0 && !langs.has(s.lang)) return false;
    if (q) {
      const country = getMeta();
      const cn = country ? country.countries[s.country] : ["", "", ""];
      if (
        !s.name.toLowerCase().includes(q) &&
        !(s.state && s.state.toLowerCase().includes(q)) &&
        !cn[1].includes(q) &&
        !cn[2].toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  };
}
