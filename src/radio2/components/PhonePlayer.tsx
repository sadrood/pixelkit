"use client";

import { useEffect, useRef, useState } from "react";
import type { Station, StationMeta } from "../lib/stations";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";
import { nearbyStations } from "../lib/stations";
import { placeLine } from "./Intro";

/* ------------------------------------------------------------------ */
/*  手机播放器：调频刻度盘                                                */
/*  附近电台台名横排成刻度，指针居中；左右拨动换台，松手调谐。              */
/* ------------------------------------------------------------------ */

const ITEM_W = 128;

const HeartGlyph = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true" style={on ? { color: "var(--ink)" } : undefined}>
    <path d="M12 20.3s-7.4-4.6-7.4-9.9a4.4 4.4 0 0 1 7.4-3.2 4.4 4.4 0 0 1 7.4 3.2c0 5.3-7.4 9.9-7.4 9.9z" />
  </svg>
);
const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
const PrevGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M17.2 5.6v12.8L8.4 12l8.8-6.4z" />
    <path d="M6.4 5.6v12.8" />
  </svg>
);
const NextGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M6.8 5.6v12.8L15.6 12 6.8 5.6z" />
    <path d="M17.6 5.6v12.8" />
  </svg>
);
const ShuffleGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M16 4h4v4" />
    <path d="M20 4 9 15" />
    <path d="M16 20h4v-4" />
    <path d="M14.5 14.5 20 20" />
    <path d="M4 4l5 5" />
    <path d="M4 20l5-5" />
  </svg>
);
const MoreGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);

export interface PhonePlayerProps {
  station: Station | null;
  stations: Station[];
  meta: StationMeta;
  lang: Lang;
  playing: boolean;
  loading: boolean;
  saved: boolean;
  onTune: (s: Station) => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onToggleSave: () => void;
  onOpenSheet: () => void;
}

export function PhonePlayer({
  station,
  stations,
  meta,
  lang,
  playing,
  loading,
  saved,
  onTune,
  onTogglePlay,
  onPrev,
  onNext,
  onShuffle,
  onToggleSave,
  onOpenSheet,
}: PhonePlayerProps) {
  /* 刻度盘列表：当前台的附近台；没有当前台时用随机抽样 */
  const [list, setList] = useState<Station[]>([]);
  const [offset, setOffset] = useState(0);
  const [dialing, setDialing] = useState(false);
  const dialingRef = useRef(false);
  const offsetRef = useRef(0);
  const dragRef = useRef({ x: 0, o: 0, moved: 0 });
  const dialRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (station) {
      const near = nearbyStations(stations, station, 30);
      setList([station, ...near]);
    } else {
      const pool = stations.filter((s) => s.url);
      const sample: Station[] = [];
      for (let i = 0; i < 24 && pool.length; i++) {
        sample.push(pool[Math.floor(Math.random() * pool.length)]);
      }
      setList(sample);
    }
    offsetRef.current = 0;
    setOffset(0);
  }, [station, stations]);

  /* 松手：吸附到最近的刻度并调谐（偏移量走 ref，避免闭包读到旧值） */
  const snap = () => {
    const idx = Math.max(
      0,
      Math.min(list.length - 1, Math.round(-offsetRef.current / ITEM_W))
    );
    offsetRef.current = -idx * ITEM_W;
    setOffset(offsetRef.current);
    const target = list[idx];
    if (target && (!station || target.id !== station.id)) onTune(target);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, o: offsetRef.current, moved: 0 };
    dialingRef.current = true;
    setDialing(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件的指针可能无法捕获 */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dialingRef.current) return;
    const d = e.clientX - dragRef.current.x;
    dragRef.current.moved += Math.abs(d);
    offsetRef.current = dragRef.current.o + d;
    setOffset(offsetRef.current);
  };
  const onPointerUp = () => {
    if (!dialingRef.current) return;
    dialingRef.current = false;
    setDialing(false);
    if (dragRef.current.moved > 4) snap();
  };

  const activeIdx = Math.max(0, Math.min(list.length - 1, Math.round(-offset / ITEM_W)));
  const status = !station
    ? t(lang, "idle")
    : playing
      ? t(lang, "playing")
      : loading
        ? t(lang, "connecting")
        : dialing
          ? t(lang, "phDialing")
          : t(lang, "phRelease");

  return (
    <div className={`pnow pe${playing ? " live" : ""}`} data-testid="phone-player">
      <div className="peye">
        <div className="l">
          <i className="pdot" />
          <span className="tx">{status}</span>
        </div>
        <div className="r">
          <button
            className={`pib s${saved ? " on" : ""}`}
            onClick={onToggleSave}
            aria-label={t(lang, "save")}
          >
            <HeartGlyph on={saved} />
          </button>
        </div>
      </div>

      <div className="pname" onClick={onOpenSheet} role="button" tabIndex={0}>
        <h1 className={station && station.name.length > 18 ? "wrap" : ""}>
          {station ? station.name || t(lang, "unnamed") : t(lang, "tagline")}
        </h1>
      </div>

      <div className="psong">
        <span className="k">{t(lang, "phRegion")}</span>
        <span className="t">
          {station ? placeLine(lang, station, meta, "") || t(lang, "phRegion") : "—"}
        </span>
      </div>

      {/* 调频刻度盘：刻度与台名同层平移，指针固定居中 */}
      <div
        className="pdial"
        ref={dialRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="pdial-in"
          style={{ transform: `translateX(calc(50% + ${offset}px))` }}
        >
          {list.map((s, i) => {
            const major = i % 5 === 0;
            return (
              <div key={s.id}>
                <span
                  className={`tk${major ? " mj" : ""}`}
                  style={{ left: i * ITEM_W + ITEM_W / 2 }}
                />
                <span
                  className={`nm${i === activeIdx ? " on" : ""}`}
                  style={{ left: i * ITEM_W + ITEM_W / 2 }}
                >
                  {s.name || t(lang, "unnamed")}
                </span>
              </div>
            );
          })}
        </div>
        <div className="needle" />
      </div>

      <div className={`pctl${station ? "" : " one"}`}>
        <button className="pib" onClick={onShuffle} aria-label={t(lang, "phShuffle")}>
          <ShuffleGlyph />
        </button>
        <button className="pib" onClick={onPrev} aria-label={t(lang, "prevStation")}>
          <PrevGlyph />
        </button>
        <button
          className="pplay"
          onClick={onTogglePlay}
          aria-label={playing ? t(lang, "pause") : t(lang, "play")}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <button className="pib" onClick={onNext} aria-label={t(lang, "next")}>
          <NextGlyph />
        </button>
        <button className="pib s" onClick={onOpenSheet} aria-label={t(lang, "phMore")}>
          <MoreGlyph />
        </button>
      </div>
    </div>
  );
}
