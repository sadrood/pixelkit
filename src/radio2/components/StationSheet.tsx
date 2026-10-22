"use client";

import type { Station, StationMeta } from "../lib/stations";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";
import { placeLine } from "./Intro";

/* 电台详情底部面板（桌面与手机共用 .psheet 形态） */

const HeartGlyph = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true" style={on ? { color: "var(--ink)" } : undefined}>
    <path d="M12 20.3s-7.4-4.6-7.4-9.9a4.4 4.4 0 0 1 7.4-3.2 4.4 4.4 0 0 1 7.4 3.2c0 5.3-7.4 9.9-7.4 9.9z" />
  </svg>
);
const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <line x1="8.3" y1="10.8" x2="15.7" y2="7.3" />
    <line x1="8.3" y1="13.2" x2="15.7" y2="16.7" />
  </svg>
);
const LinkGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M10 14a5 5 0 0 0 7.5.5l2.5-2.5a5 5 0 0 0-7-7l-1.5 1.5" />
    <path d="M14 10a5 5 0 0 0-7.5-.5L4 12a5 5 0 0 0 7 7l1.5-1.5" />
  </svg>
);

export interface StationSheetProps {
  station: Station;
  meta: StationMeta;
  lang: Lang;
  saved: boolean;
  onClose: () => void;
  onToggleSave: () => void;
  onShare: () => void;
}

export function StationSheet({
  station,
  meta,
  lang,
  saved,
  onClose,
  onToggleSave,
  onShare,
}: StationSheetProps) {
  const g = meta.genres[station.genre] ?? "";
  const gEn = meta.genresEn[station.genre] ?? "";
  const l = meta.langs[station.lang];
  const country = meta.countries[station.country];
  const cn = country ? (lang === "zh" ? country[1] : country[2]) : "";
  const cc = country ? country[0] : "";
  const tz = meta.tzs[station.tz] ?? "";

  const rows: [string, string][] = [
    [t(lang, "genre"), lang === "zh" ? g : gEn],
    [t(lang, "language"), l ? (lang === "zh" ? l[0] : l[1]) : "—"],
    [t(lang, "bitrate"), station.br > 0 ? `${station.br} KBPS` : t(lang, "brUnknown")],
    [t(lang, "popularity"), String(station.pop)],
    [t(lang, "phRegion"), `${placeLine(lang, station, meta, "") || cn}${cc ? ` (${cc})` : ""}`],
    [t(lang, "phLocal"), tz.replace(/_/g, " ") || "—"],
  ];

  return (
    <div className="psheetwrap" data-testid="station-sheet">
      <div className="psdim" onClick={onClose} />
      <div className="psheet">
        <div className="psgrab">
          <span className="bar" />
        </div>
        <div className="psbody">
          <div className="pstitle">
            <h2>{station.name || t(lang, "unnamed")}</h2>
            <button className="psdone" onClick={onClose}>
              {t(lang, "phDone")}
            </button>
          </div>
          <div className="peye on">
            <i className="pdot" />
            <span>{cn || t(lang, "phRegion")}</span>
          </div>
          <dl className="pdl">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="prows">
            <button className="prow" onClick={onToggleSave}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <HeartGlyph on={saved} />
                {saved ? t(lang, "savedOn") : t(lang, "save")}
              </span>
            </button>
            <button className="prow" onClick={onShare}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <ShareGlyph />
                {t(lang, "share")}
              </span>
            </button>
            <a className="prow" href={station.url} target="_blank" rel="noopener">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <LinkGlyph />
                {t(lang, "phOpenIn", { s: t(lang, "phMoreSites") })}
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
