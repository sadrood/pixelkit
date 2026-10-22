/* Media Session 封面：原站 lP() —— 512×512 纯色底 + 对角明暗 + 台名 + 右下橙点 */

/** 原站 dN()：去掉括号补充说明，中日韩取 2~4 字，其余取词首字母 */
export function shortName(name: string): string {
  let t = name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(t)) t = name.replace(/[()[\]]/g, " ").trim();
  const cjk = t.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g);
  if (cjk && cjk.length >= 2) return cjk.length <= 4 ? cjk.join("") : cjk.slice(0, 2).join("");
  const words = t
    .split(/[\s/,:;]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const abbr = words
    .slice(0, 4)
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w[0]))
    .join("");
  return (abbr || name).slice(0, 5).toUpperCase();
}

/** 同一台同一流派色只画一次（toDataURL 出来约 300KB，playState 每次变化都会走到这里） */
const artCache = new Map<string, string>();

export function stationArtwork(name: string, color: string): string {
  const key = name + "|" + color;
  const hit = artCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 512;
  const r = cv.getContext("2d");
  if (!r) return "/favicon.svg";
  r.fillStyle = color;
  r.fillRect(0, 0, 512, 512);
  const g = r.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "rgba(255,255,255,.12)");
  g.addColorStop(1, "rgba(0,0,0,.28)");
  r.fillStyle = g;
  r.fillRect(0, 0, 512, 512);

  const label = shortName(name);
  const chars = [...label];
  const allCjk = chars.every((c) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(c));
  const lines = chars.length === 4 && allCjk ? [chars.slice(0, 2).join(""), chars.slice(2).join("")] : [label];

  const gap = 30.72;
  const setFont = (size: number) => {
    r.font = `${size}px 'Instrument Serif','Songti SC',serif`;
    return lines.map((l) => r.measureText(l));
  };
  const hOf = (m: TextMetrics) => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  let size = 256;
  let m = setFont(size);
  while (
    (m.some((x) => x.width > 399.36) ||
      m.reduce((a, x) => a + hOf(x), 0) + gap * (lines.length - 1) > 337.92) &&
    size > 40
  ) {
    size -= 6;
    m = setFont(size);
  }

  r.fillStyle = "#101F1D";
  r.textAlign = "left";
  r.textBaseline = "alphabetic";
  let y = (512 - (m.reduce((a, x) => a + hOf(x), 0) + gap * (lines.length - 1))) / 2;
  lines.forEach((line, i) => {
    const mm = m[i];
    r.fillText(line, 256 - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2, y + mm.actualBoundingBoxAscent);
    y += hOf(mm) + gap;
  });
  r.fillStyle = "#F36B45";
  r.beginPath();
  r.arc(465.92, 465.92, 12.032, 0, Math.PI * 2);
  r.fill();
  const url = cv.toDataURL("image/png");
  if (artCache.size > 60) artCache.clear();
  artCache.set(key, url);
  return url;
}
