"use client";

import { useEffect, useState } from "react";
import type { Station, StationMeta } from "../lib/stations";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";

/* 闲置挂机画面：省电模式下 1 分钟无操作进入，轻点唤醒 */

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic f" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic f" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export interface StandbyProps {
  station: Station;
  meta: StationMeta;
  lang: Lang;
  playing: boolean;
  onWake: () => void;
  onTogglePlay: () => void;
}

export function Standby({ station, meta, lang, playing, onWake, onTogglePlay }: StandbyProps) {
  const [clock, setClock] = useState("--:--");

  useEffect(() => {
    const update = () => {
      let tz: string | undefined;
      try {
        tz = meta.tzs[station.tz];
      } catch {
        tz = undefined;
      }
      try {
        setClock(
          new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: tz,
          }).format(new Date())
        );
      } catch {
        const n = new Date();
        setClock(
          `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
        );
      }
    };
    update();
    const iv = setInterval(update, 10000);
    return () => clearInterval(iv);
  }, [station, meta]);

  const country = meta.countries[station.country];
  const place = [
    station.state ? station.state.replace(/\s+\w{2}$/, "").trim() || station.state : "",
    country ? (lang === "zh" ? country[1] : country[2]) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="standby" onClick={onWake} data-testid="standby">
      <div className="sbtop">
        <span>{t(lang, "eco")}</span>
        <span>{t(lang, "tapWake")}</span>
      </div>
      <div className="sbbody">
        <div className="sbk">
          <i className={`sbdot${playing ? " on" : ""}`} />
          {t(lang, "phNow")}
        </div>
        <div className="sbclock">{clock}</div>
        <div className="sbline" />
        <div className="sbname">{station.name || t(lang, "unnamed")}</div>
        <div className="sbsong">{place || t(lang, "phRegion")}</div>
      </div>
      <button
        className="sbpp"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        aria-label={playing ? t(lang, "pause") : t(lang, "play")}
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
    </div>
  );
}
