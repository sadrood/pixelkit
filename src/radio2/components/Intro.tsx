"use client";

import { useEffect, useState } from "react";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";
import type { Station, StationMeta } from "../lib/stations";

/* 品牌标（与原站 home.html 同一个 path） */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M52.28 27.56A21 21 0 1 1 37.44 12.72"
        fill="none"
        stroke="currentColor"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d="M25.5 40.5L34.5 31.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <circle cx="47.9" cy="17.1" r="4.8" fill="var(--signal)" />
    </svg>
  );
}

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic f" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);

export interface IntroProps {
  lang: Lang;
  meta: StationMeta | null;
  loaded: boolean;
  loadError: string | null;
  /** 回访：上次收听的电台 */
  lastStation: Station | null;
  /** 当地时 HH:MM（按上次电台时区） */
  lastLocalTime: string;
  /** 进工作区并随机开始收听 */
  onStart: () => void;
  /** 进工作区，不播放 */
  onExplore: () => void;
  /** 继续收听上次那一站 */
  onListenLast: () => void;
  /** 随机听一站（回访卡片的次级按钮） */
  onRandomLast: () => void;
  /** 进入后调用，用于淡出动画结束清理 */
  onExited: () => void;
}

export function Intro({
  lang,
  meta,
  loaded,
  loadError,
  lastStation,
  lastLocalTime,
  onStart,
  onExplore,
  onListenLast,
  onRandomLast,
  onExited,
}: IntroProps) {
  const [gone, setGone] = useState(false);
  const returning = !!lastStation;

  // 退场：加 .gone，过渡结束后通知卸载
  useEffect(() => {
    if (!gone) return;
    const iv = setTimeout(onExited, 260);
    return () => clearTimeout(iv);
  }, [gone, onExited]);

  const leave = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    setGone(true);
  };

  const countryCount = meta ? new Set(meta.countries.map((c) => c[0])).size : 0;

  return (
    <div
      className={`intro night${returning ? "" : " land"}${gone ? " gone" : ""}`}
      onClick={returning && !gone ? leave(onListenLast) : undefined}
    >
      <div className="ibrand">
        <div className="logo">
          <BrandMark />
          RoamDial
        </div>
        <div className="islog">{t(lang, "slogan")}</div>
        <div className="isrc">— {t(lang, "sloganSrc")}</div>
      </div>

      <div className="inow">
        {returning ? (
          <>
            <div className="ik">
              <i />
              <span>{t(lang, "introLast")}</span>
            </div>
            <h1 className="inm">{lastStation!.name || t(lang, "unnamed")}</h1>
            <p className="ipl">
              <span className="t">{placeLine(lang, lastStation!, meta, lastLocalTime)}</span>
            </p>
            <div className="imeta">{metaLine(lang, lastStation!, meta)}</div>
            <div className="iacts">
              <button className="btn primary big" onClick={leave(onListenLast)}>
                <PlayGlyph />
                <span>{t(lang, "listenAgain")}</span>
              </button>
              <button className="lnk" onClick={leave(onRandomLast)}>
                {t(lang, "introRandom")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ik">
              <i />
              <span>
                {loadError
                  ? t(lang, "loadFail", { e: loadError })
                  : loaded && meta
                    ? t(lang, "landEyebrow", { c: countryCount })
                    : t(lang, "loading")}
              </span>
            </div>
            <h1 className="inm">{t(lang, "landTitle")}</h1>
            <p className="isub">{t(lang, "landSub")}</p>
            <div className="iacts">
              <button
                className="btn primary big"
                disabled={!loaded || !!loadError}
                onClick={leave(onStart)}
              >
                <PlayGlyph />
                <span>{loaded ? t(lang, "startListening") : t(lang, "loading")}</span>
              </button>
              <button className="lnk" disabled={!loaded} onClick={leave(onExplore)}>
                {t(lang, "explore")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="credit mono dim">
        <span>{t(lang, "credits")}</span>
        {" · "}
        <a href="/about" data-zh="关于">
          {lang === "zh" ? "关于" : "About"}
        </a>
        {" · "}
        <a href="/privacy" data-zh="隐私">
          {lang === "zh" ? "隐私" : "Privacy"}
        </a>
        {" · "}
        <a href="https://x.com/RoamDial" target="_blank" rel="noopener">
          X
        </a>
      </div>
    </div>
  );
}

/* 地点行：Maturin, Monagas. · 委内瑞拉 · 当地 22:02 */
export function placeLine(
  lang: Lang,
  s: Station,
  meta: StationMeta | null,
  localTime: string
): string {
  const parts: string[] = [];
  const country = meta?.countries[s.country];
  const cn = country ? (lang === "zh" ? country[1] : country[2]) : "";
  if (s.state) parts.push(s.state.replace(/\s+\w{2}$/, "").trim() || s.state);
  if (cn) parts.push(cn);
  let line = parts.join(" · ");
  if (localTime) line += (line ? " · " : "") + t(lang, "localShort", { t: localTime });
  return line || cn;
}

/* 元信息行：综合 · 西班牙语 · 128 KBPS */
export function metaLine(lang: Lang, s: Station, meta: StationMeta | null): string {
  const parts: string[] = [];
  const g = meta?.genres[s.genre] ?? "";
  const gEn = meta?.genresEn[s.genre] ?? "";
  parts.push(lang === "zh" ? g : gEn);
  const l = meta?.langs[s.lang];
  if (l) parts.push(lang === "zh" ? l[0] : l[1]);
  parts.push(s.br > 0 ? `${s.br} KBPS` : t(lang, "brUnknown"));
  return parts.join(" · ");
}
