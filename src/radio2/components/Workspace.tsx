"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneCanvas } from "./SceneCanvas";
import { Intro, BrandMark, placeLine, metaLine } from "./Intro";
import type { DiveForm } from "../lib/dive";
import { Standby } from "./Standby";
import { PhonePlayer } from "./PhonePlayer";
import { StationSheet } from "./StationSheet";
import { InstallPrompt } from "./InstallPrompt";
import { useDragSort } from "./dragSort";
import {
  loadStations,
  findById,
  randomStations,
  searchStations,
  nearbyStations,
  getStations,
  nearestByCoord,
  diveList,
  genreCounts,
  type Station,
  type StationMeta,
} from "../lib/stations";
import { detectLang, t, type Lang } from "../lib/i18n";
import { storage } from "../lib/storage";
import { stationArtwork } from "../lib/mediaArtwork";
import {
  loadAndPlay,
  resumePlay,
  pauseAudio,
  setVolume as audioSetVolume,
  setMuted as audioSetMuted,
  setFx as audioSetFx,
  setNorm as audioSetNorm,
  playTuningFx,
  preload,
  onPlayState,
} from "../lib/audio";

/* ------------------------------------------------------------------ */
/*  图标（24×24，.ic 统一样式）                                          */
/* ------------------------------------------------------------------ */

const I = ({ children, fill }: { children: React.ReactNode; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" className={fill ? "ic f" : "ic"} aria-hidden="true">
    {children}
  </svg>
);

const SearchIcon = () => (
  <I>
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </I>
);
const SaveIcon = () => (
  <I>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
  </I>
);
const HeartIcon = () => (
  <I>
    <path d="M12 20.3s-7.4-4.6-7.4-9.9a4.4 4.4 0 0 1 7.4-3.2 4.4 4.4 0 0 1 7.4 3.2c0 5.3-7.4 9.9-7.4 9.9z" />
  </I>
);
const ShareIcon = () => (
  <I>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <line x1="8.3" y1="10.8" x2="15.7" y2="7.3" />
    <line x1="8.3" y1="13.2" x2="15.7" y2="16.7" />
  </I>
);
const PinIcon = () => (
  <I>
    <path d="M12 21.2s-6.2-5.4-6.2-10.2a6.2 6.2 0 1 1 12.4 0c0 4.8-6.2 10.2-6.2 10.2z" />
    <circle cx="12" cy="10.8" r="2.2" />
  </I>
);
const GearIcon = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </I>
);
const PrevIcon = () => (
  <I>
    <path d="M17.2 5.6v12.8L8.4 12l8.8-6.4z" />
    <path d="M6.4 5.6v12.8" />
  </I>
);
const PlayIcon = () => (
  <I fill>
    <path d="M8 5.5v13l10.5-6.5z" />
  </I>
);
const PauseIcon = () => (
  <I fill>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </I>
);
const VolIcon = () => (
  <I>
    <path d="M4 9.2v5.6h3.6L12 18.6V5.4L7.6 9.2H4z" />
    <path d="M15.6 8.6a4.8 4.8 0 0 1 0 6.8" />
  </I>
);
const MuteIcon = () => (
  <I>
    <path d="M4 9.2v5.6h3.6L12 18.6V5.4L7.6 9.2H4z" />
    <path d="M15.8 9.4l5 5.2M20.8 9.4l-5 5.2" />
  </I>
);
const CloseIcon = () => (
  <I>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
);
const FilterIcon = () => (
  <I>
    <path d="M4 6h9M17.5 6H20M4 12h3.5M12.5 12H20M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </I>
);
const ChevronIcon = () => (
  <I>
    <path d="M6 9.5l6 6 6-6" />
  </I>
);

type PlayState = "idle" | "loading" | "playing" | "paused" | "error" | "blocked";

const EMPTY_META: StationMeta = {
  n: 0,
  builtAt: "",
  genres: [],
  genresEn: [],
  genreColors: [],
  langs: [],
  countries: [],
  tzs: [],
};

/** 国旗：用本地 SVG（public/roamdial/flags），避免 Windows 无旗帜 emoji 字体 */
function FlagIcon({ cc }: { cc?: string }) {
  const code = String(cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return <span className="flag-fb">🌐</span>;
  return (
    <img
      className="flag-img"
      src={`/roamdial/flags/${code.toLowerCase()}.svg`}
      alt={code}
      loading="lazy"
      onError={(e) => {
        const el = e.currentTarget as HTMLImageElement;
        el.style.display = "none";
        el.insertAdjacentText("afterend", code);
      }}
    />
  );
}

/** 大时间下方的地点行：MATURIN, MONAGAS. · 委内瑞拉 · 当地时间 */
function timePlace(lang: Lang, s: Station, meta: StationMeta | null): string {
  const country = meta?.countries[s.country];
  const cn = country ? (lang === "zh" ? country[1] : country[2]) : "";
  const st = s.state ? s.state.replace(/\s+\w{2}$/, "").trim() || s.state : "";
  return [st, cn].filter(Boolean).join(", ");
}

/* ------------------------------------------------------------------ */
/*  工作区                                                              */
/* ------------------------------------------------------------------ */

export default function Workspace() {
  const [lang, setLang] = useState<Lang>("en");
  const [data, setData] = useState<{ stations: Station[]; meta: StationMeta } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [view, setView] = useState<"globe" | "sky">("globe");
  const [station, setStation] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [nearest, setNearest] = useState<{
    s: Station;
    d: number;
    locked: boolean;
    km?: number;
    settled: boolean;
  } | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Station[]>([]);
  const [hl, setHl] = useState(0);
  const [favOpen, setFavOpen] = useState(false);
  const [favTab, setFavTab] = useState<"st" | "recent">("st");
  const [setOpen, setSetOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeGenres, setActiveGenres] = useState<Set<number>>(new Set());
  const [activeLangs, setActiveLangs] = useState<Set<number>>(new Set());
  const [bitrateMin, setBitrateMin] = useState(0);
  const [hintOn, setHintOn] = useState(true);
  const [sleepMin, setSleepMin] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [localTime, setLocalTime] = useState("--:--");
  const [introDone, setIntroDone] = useState(false);
  const [introMounted, setIntroMounted] = useState(true);
  const [idleHide, setIdleHide] = useState(false);

  /* 升级新增状态 */
  const [fxOn, setFxOn] = useState(false);
  const [normOn, setNormOn] = useState(false);
  const [autoRecOn, setAutoRecOn] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const [myCity, setMyCity] = useState("");
  const [ecoOn, setEcoOn] = useState(false);
  const [diveForm, setDiveForm] = useState<DiveForm>("genre");
  const [isPhone, setIsPhone] = useState(false);
  const [recordView, setRecordView] = useState(false);
  const [standbyOn, setStandbyOn] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [langDDOpen, setLangDDOpen] = useState(false);
  const [langDDQuery, setLangDDQuery] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idxMap = useRef(new Map<string, number>());
  const prevStack = useRef<string[]>([]);
  const nearbyRef = useRef<{ list: Station[]; i: number }>({ list: [], i: -1 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const dwellRef = useRef<{ idx: number; at: number } | null>(null);
  const dwellGrace = useRef(0); // 停留调谐宽限期截止（显式调谐后短暂免打扰）
  const draggedRef = useRef(false); // 原站 Un：自上次调谐后有没有抓过球面，没抓过就不许自动切台
  const autoEntered = useRef(false); // 原站 ot：这次唱片视图是不是自动进来的
  const [switchZoom, setSwitchZoom] = useState(true); // 这次换台推不推近镜头（原站只有列表/pager 入口推）
  /* 原站 qe / Je：唱片视图里的同城翻页列表与游标 */
  const [dive, setDive] = useState<{ list: Station[]; i: number }>({ list: [], i: -1 });
  const diveRef = useRef(dive);
  diveRef.current = dive;
  const skipOnError = useRef(true);
  const skipCount = useRef(0);
  // 每个电台只尝试一次代理线路重试
  const proxyRetriedRef = useRef<Set<string>>(new Set());
  const nearestRef = useRef<{ idx: number; d: number; locked: boolean; settled: boolean } | null>(
    null
  );
  const preIdRef = useRef<string>("");
  const autoRecordAt = useRef(0); // 最近一次换台时间（自动进入唱片用）
  const stationRef = useRef<Station | null>(null);
  stationRef.current = station;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const bottomRef = useRef<HTMLDivElement>(null);

  /* 原站 --fbx：筛选面板变高时把 .now / .hint 整体上移，避免被面板盖住 */
  useEffect(() => {
    const el = bottomRef.current;
    const gx = el?.closest(".gx") as HTMLElement | null;
    const tog = el?.querySelector(".ftog") as HTMLElement | null;
    if (!el || !gx || !tog) return;
    const ro = new ResizeObserver(() => {
      gx.style.setProperty("--fbx", Math.max(0, el.offsetHeight - tog.offsetHeight - 4) + "px");
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      gx.style.removeProperty("--fbx");
    };
  }, []);

  // 语言切换后，早期 useCallback 里捕获的 T 会拿到旧语言；用 ref 保证永远取最新
  const langRef = useRef(lang);
  langRef.current = lang;
  const T = useCallback(
    (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t(langRef.current, key, vars),
    []
  );

  const showToast = useCallback((text: string) => {
    toastId.current += 1;
    setToast({ text, id: toastId.current });
  }, []);

  /* ---------- 初始化 ---------- */
  useEffect(() => {
    setLang(detectLang());
    setHintOn(storage.getHint());
    setVolume(storage.getVolume());
    setMuted(storage.getMuted());
    setSavedIds(storage.getSaved());
    recentRef.current = storage.getRecent();
    setRecent(recentRef.current);
    /* 升级：音频与自动化偏好 */
    const fx = storage.getBool("fx", false);
    const norm = storage.getBool("norm", false);
    const autoRec = storage.getBool("autoDive", true);
    const favOnly = storage.getBool("favOnly", false);
    // 低端设备（窄屏/少核/低内存）默认开省电模式
    let lowEndDevice = false;
    try {
      const cores = navigator.hardwareConcurrency || 8;
      const mem = (navigator as any).deviceMemory || 8;
      lowEndDevice = window.innerWidth <= 560 || cores <= 4 || mem <= 4;
    } catch { /* ignore */ }
    const eco = storage.getBool("eco", lowEndDevice);
    const df = storage.getDiveForm() as DiveForm;
    setFxOn(fx);
    setNormOn(norm);
    setAutoRecOn(autoRec);
    setFavOnly(favOnly);
    setEcoOn(eco);
    setDiveForm(df);
    audioSetFx(fx);
    audioSetNorm(norm);
    audioSetVolume(storage.getVolume());
    audioSetMuted(storage.getMuted());
    let cancelled = false;
    loadStations()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        idxMap.current = new Map(d.stations.map((s, i) => [s.id, i]));
        const q = new URLSearchParams(location.search).get("s");
        if (q) {
          const st = findById(d.stations, q);
          setIntroMounted(false);
          setIntroDone(true);
          storage.setSeen();
          if (st) {
            setStation(st);
            setView("globe");
            showToast(T("sharedStation"));
          } else {
            showToast(T("toastShareGone"));
          }
        } else if (storage.getSeen()) {
          const last = storage.getLast();
          const st = last ? findById(d.stations, last) : null;
          if (st) setStation(st); // 入口页回访卡片；不自动播放
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  /* toast 用当前语言 */
  useEffect(() => {
    if (!toast) return;
    const iv = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(iv);
  }, [toast]);

  /* ---------- 当地 ---------- */
  useEffect(() => {
    const update = () => {
      const tz = station && data ? data.meta.tzs[station.tz] : undefined;
      try {
        setLocalTime(
          new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: tz,
          }).format(new Date())
        );
      } catch {
        const n = new Date();
        setLocalTime(
          `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
        );
      }
    };
    update();
    const iv = setInterval(update, 20000);
    return () => clearInterval(iv);
  }, [station, data]);

  /* ---------- 手机竖屏 class + 手机播放器分支 ---------- */
  useEffect(() => {
    const check = () => setIsPhone(window.innerWidth <= 560);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /* ---------- 闲置：隐藏 UI / 自动进入唱片 / 挂机画面 ----------
     计时器只依赖开关项；播放状态等用 ref 读取，避免流抖动反复重置计时 */
  const playStateRef = useRef(playState);
  playStateRef.current = playState;
  const recordViewRef = useRef(recordView);
  recordViewRef.current = recordView;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const viewRef = useRef(view);
  viewRef.current = view;
  const standbyRef = useRef(standbyOn);
  standbyRef.current = standbyOn;
  const autoRecRef = useRef(autoRecOn);
  autoRecRef.current = autoRecOn;
  const ecoRef = useRef(ecoOn);
  ecoRef.current = ecoOn;
  const introRef = useRef(introDone);
  introRef.current = introDone;
  const favOnlyRef = useRef(favOnly);
  favOnlyRef.current = favOnly;
  const savedIdsRef = useRef(savedIds);
  savedIdsRef.current = savedIds;
  const lastFocusAt = useRef(0); // 原站 di：重新拿到窗口焦点后，10 秒从这一刻重数

  /* 原站 IF()：30 秒没有任何输入才算闲置（pointermove 也算），面板或输入框还开着就再等一轮；
     进入闲置的同一刻按 autoDive 开关决定要不要顺手进唱片（$?.idleDive()）——两件事共用一个计时器。
     挂机画面只在省电模式里开（ON = eco && started && playing>=0），60 秒。 */
  useEffect(() => {
    let idleTimer = 0;
    let sbTimer = 0;
    const panelOpen = () =>
      !!document.querySelector(".favpanel, .setpanel, .dd.open, .ig, .psheet") ||
      ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName || "");
    const armIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (panelOpen()) return armIdle();
        setIdleHide(true);
        /* 原站 st()：We||!ei||hn<0||l.paused||l.blocked 才不进。注意 l.paused 是引擎的「用户按了暂停」，
           不是 audio.paused——所以流还在连接中也算，这条正好补上出声慢于 30 秒时 10 秒那条进不了的空档。
           只有这一条会置 ot，也就是设置文案里的「碰一下回到原处」；10 秒那条是常驻的。 */
        const ps = playStateRef.current;
        if (
          autoRecRef.current &&
          !ecoRef.current &&
          !recordViewRef.current &&
          introRef.current &&
          !!stationRef.current &&
          ps !== "paused" &&
          ps !== "blocked" &&
          ps !== "error"
        ) {
          autoEntered.current = true; // 原站 ot=We
          setRecordView(true);
        }
      }, 30000);
    };
    const armStandby = () => {
      window.clearTimeout(sbTimer);
      sbTimer = window.setTimeout(() => {
        if (panelOpen()) return armStandby();
        if (ecoRef.current && introRef.current && playStateRef.current !== "idle")
          setStandbyOn(true);
      }, 60000);
    };
    const wake = () => {
      setIdleHide(false);
      setStandbyOn(false);
      armIdle();
      armStandby();
    };
    const onBlur = () => {
      lastFocusAt.current = performance.now();
    };
    const moveEv = ["pointermove", "pointerdown", "wheel", "touchstart"] as const;
    const capEv = ["keydown", "focusin", "click"] as const;
    for (const e of moveEv) window.addEventListener(e, wake, { passive: true });
    for (const e of capEv) window.addEventListener(e, wake, { capture: true, passive: true });
    window.addEventListener("blur", onBlur);
    armIdle();
    armStandby();
    return () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(sbTimer);
      for (const e of moveEv) window.removeEventListener(e, wake);
      for (const e of capEv) window.removeEventListener(e, wake, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* 原站这条不是 setTimeout，而是渲染循环里逐帧判的条件（bi()）：
     autoDive 开 · 不在唱片态 · 有当前台 · 真的出声了（status==='live'）· 镜头停稳 · 没固定 · 球面视图 · 没挂机
     —— 全部成立之后数满 10 秒才进唱片，中途任一条件破了就归零。
     走的是 rt()，不碰 ot，所以这是「常驻」的唱片态：只有 Esc / ← / 换台能出去，碰一下不会回。
     之前挂在输入事件上的 setTimeout 有个真 bug：流比最后一次操作连得慢，就永远不会自动进唱片。 */
  useEffect(() => {
    if (!introDone) return;
    let since = 0;
    const iv = window.setInterval(() => {
      const ok =
        autoRecRef.current &&
        !recordViewRef.current &&
        !!stationRef.current &&
        playStateRef.current === "playing" &&
        !pinnedRef.current &&
        viewRef.current === "globe" &&
        !standbyRef.current &&
        (!nearestRef.current || nearestRef.current.settled);
      if (!ok) {
        since = 0;
        return;
      }
      if (!since) since = performance.now();
      if (performance.now() - Math.max(since, lastFocusAt.current) > 10000) {
        since = 0;
        setRecordView(true); // 原站 rt()：不设 ot，这次进入不靠「碰一下」退出
      }
    }, 250);
    return () => window.clearInterval(iv);
  }, [introDone]);

  /* 原站 ct(){ot&&lt()}，由 IF() 的 wake 在 idle 为真时调用：设置文案「30 秒不操作自动进入，碰一下回到原处」
     说的就是这条——闲置 30 秒进来的那次，任何一次输入都算「碰一下」；
     手动点进来的和出声 10 秒自动进来的（rt()，不置 ot）都要靠 Esc / ← 返回 / 换台退出，
     否则 diveNav 的按钮一按就整块消失 */
  useEffect(() => {
    if (!recordView) {
      autoEntered.current = false;
      return;
    }
    if (!autoEntered.current) return;
    const back = () => {
      autoEntered.current = false;
      setRecordView(false);
    };
    const moveEv = ["pointermove", "pointerdown", "wheel", "touchstart"] as const;
    const capEv = ["keydown", "focusin", "click"] as const;
    for (const e of moveEv) window.addEventListener(e, back, { passive: true });
    for (const e of capEv) window.addEventListener(e, back, { capture: true, passive: true });
    return () => {
      for (const e of moveEv) window.removeEventListener(e, back);
      for (const e of capEv) window.removeEventListener(e, back, { capture: true });
    };
  }, [recordView]);

  /* ---------- 语言 ---------- */
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    storage.setLang(l);
  }, []);

  /* ---------- 音频（统一走 lib/audio 引擎） ---------- */
  const ensureAudio = useCallback(() => {
    // 引擎内部单例；这里仅为兼容旧调用点
    return audioRef.current;
  }, []);

  useEffect(() => {
    audioSetVolume(volume);
    audioSetMuted(muted);
    storage.setVolume(volume);
    storage.setMuted(muted);
  }, [volume, muted]);

  /* ---------- 调谐 / 播放 ---------- */
  /** 历史列表：state 与 localStorage 一起提交 */
  const commitRecent = useCallback((next: string[]) => {
    recentRef.current = next;
    setRecent(next);
    storage.setRecent(next);
  }, []);

  /** 换台。四个入口的差异照抄原站：
   *  列表/pager qn()=宽限 2600ms + 切回地球 + 推近；点球 Ar()=1500ms + 原地 + 不推近；
   *  唱片翻页 dt()=4000ms + 原地 + 不推近；准星停留调谐 Ln()=不设宽限 + 原地 + 不推近 */
  const tuneIn = useCallback(
    (
      s: Station,
      autoplay: boolean,
      opts: { grace?: number; toGlobe?: boolean; zoom?: boolean } = {}
    ) => {
      const { grace = 2600, toGlobe = true, zoom = true } = opts;
      dwellGrace.current = performance.now() + grace;
      draggedRef.current = false; // 原站 Ln() 里 Un=!1：调谐之后要重新抓一次球才可能再自动切
      setSwitchZoom(zoom);
      const prev = stationRef.current;
      if (prev && prev.id !== s.id) {
        prevStack.current.unshift(prev.id);
        if (prevStack.current.length > 50) prevStack.current.pop();
      }
      setStation(s);
      setPinned(false);
      nearbyRef.current = { list: [], i: -1 };
      storage.setLast(s.id);
      commitRecent([s.id, ...recentRef.current.filter((x) => x !== s.id)].slice(0, 60));
      /* 原站 qn() 开头就是 We&&lt()：从任何正常入口换台，先退出唱片视图；
         dt()/Ln()/Ar() 传 toGlobe:false，所以唱片态翻页时不会被踢出去 */
      if (toGlobe) {
        setView("globe");
        setRecordView(false);
      }
      autoRecordAt.current = performance.now(); // 重置自动进入唱片计时
      // 注意：不主动关唱片视图——自动换台后唱片视图继续展示新台（原站行为）
      if (autoplay) {
        skipOnError.current = true;
        playTuningFx();
        loadAndPlay(s.url).catch(() => setPlayState("blocked"));
      } else {
        setPlayState("idle");
      }
    },
    [commitRecent]
  );

  const togglePlay = useCallback(() => {
    const s = stationRef.current;
    if (!s) return;
    if (playState === "playing") {
      pauseAudio();
      setPlayState("paused");
    } else if (playState === "paused") {
      skipOnError.current = true;
      resumePlay().catch(() => setPlayState("blocked"));
      setPlayState("loading");
    } else {
      skipOnError.current = false; // 手动播放失败不自动跳台
      loadAndPlay(s.url).catch(() => setPlayState("blocked"));
      setPlayState("loading");
    }
  }, [playState]);

  /* 播放状态订阅（引擎 → UI；放在 tuneIn 之后避免 TDZ） */
  useEffect(
    () =>
      onPlayState((s) => {
        if (s === "playing") skipCount.current = 0;
        if (s === "error") {
          setPlayState("error");
          /* 多线路：直连失败先用本站代理重试一次 */
          const curSt = stationRef.current;
          if (curSt && curSt.url && !String(curSt.url).startsWith("/api/radio/stream") && !proxyRetriedRef.current.has(curSt.id)) {
            proxyRetriedRef.current.add(curSt.id);
            console.log("[radio2] 直连失败，改用本站代理重试：" + curSt.name);
            loadAndPlay("/api/radio/stream?u=" + encodeURIComponent(curSt.url)).catch(() => setPlayState("blocked"));
            return;
          }
          /* 原站：!Gn（唱片态不自动跳）、z<3（最多连跳三次）、跳台走 Ar() 的原地语义 */
          if (skipOnError.current && !recordViewRef.current && skipCount.current < 3) {
            const failedId = stationRef.current?.id;
            showToast(T("toastAutoSkip"));
            setTimeout(() => {
              if (
                recordViewRef.current ||
                stationRef.current?.id !== failedId ||
                playStateRef.current === "playing"
              )
                return;
              const p = poolRef.current;
              if (p.length) {
                const [n] = randomStations(p, 1);
                if (n) {
                  skipCount.current += 1;
                  tuneIn(n, true, { grace: 1500, toGlobe: false, zoom: false });
                }
              }
            }, 1500);
          }
          return;
        }
        setPlayState(s);
      }),
    [showToast, tuneIn]
  );

  /* ---------- 可选池（筛选后） ---------- */
  const pool = useMemo(() => {
    if (!data) return [] as Station[];
    const favSet = favOnly && savedIds.length ? new Set(savedIds) : null;
    return data.stations.filter((s) => {
      if (!s.url) return false;
      if (favSet && !favSet.has(s.id)) return false;
      if (activeGenres.size > 0 && !activeGenres.has(s.genre)) return false;
      if (activeLangs.size > 0 && !activeLangs.has(s.lang)) return false;
      if (bitrateMin > 0 && s.br < bitrateMin) return false;
      return true;
    });
  }, [data, activeGenres, activeLangs, bitrateMin, favOnly, savedIds]);
  const poolRef = useRef(pool);
  poolRef.current = pool;

  /* ---------- 切台 ---------- */
  const nextStation = useCallback(() => {
    const p = poolRef.current;
    if (!p.length) {
      showToast(T("toastNoPool"));
      return;
    }
    const [n] = randomStations(p, 1);
    if (n) tuneIn(n, true);
  }, [showToast, tuneIn]);

  const prevStation = useCallback(() => {
    const id = prevStack.current.shift();
    if (!id || !data) {
      nextStation();
      return;
    }
    const s = findById(data.stations, id);
    if (s) tuneIn(s, true);
  }, [data, nextStation, tuneIn]);

  /* ---------- 标签页标题（原站 iI） ---------- */
  const baseTitle = useRef("");
  if (!baseTitle.current && typeof document !== "undefined") baseTitle.current = document.title;
  useEffect(() => {
    document.title = station ? `${station.name || T("unnamed")} · 世界电台` : baseTitle.current;
  }, [station]);

  /* ---------- Media Session（原站 uP）：锁屏 / 系统媒体键 ---------- */
  const mediaRef = useRef({ station, playState, togglePlay, nextStation, prevStation });
  mediaRef.current = { station, playState, togglePlay, nextStation, prevStation };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    let lastJump = 0;
    const off = () => {
      const s = mediaRef.current.playState;
      return s === "paused" || s === "error" || s === "blocked";
    };
    const guard = (fn: () => void) => () => {
      if (mediaRef.current.station) fn();
    };
    // 原站：next/prev 有 300ms 防抖，避免系统连点把历史打乱
    const jump = (fn: () => void) => () => {
      const now = performance.now();
      if (now - lastJump < 300 || !mediaRef.current.station) return;
      lastJump = now;
      fn();
    };
    const handlers: [MediaSessionAction, () => void][] = [
      ["play", guard(() => { if (off()) mediaRef.current.togglePlay(); })],
      ["pause", guard(() => { if (!off()) mediaRef.current.togglePlay(); })],
      ["stop", guard(() => { if (!off()) mediaRef.current.togglePlay(); })],
      ["nexttrack", jump(() => mediaRef.current.nextStation())],
      ["previoustrack", jump(() => mediaRef.current.prevStation())],
    ];
    for (const [a, fn] of handlers) {
      try {
        ms.setActionHandler(a, fn);
      } catch {
        /* 该动作不支持时忽略 */
      }
    }
    return () => {
      for (const [a] of handlers) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !station) return;
    const ms = navigator.mediaSession;
    const c = data?.meta.countries[station.country];
    const artist = [station.state, lang === "zh" ? c?.[1] : c?.[2]].filter(Boolean).join(" · ");
    const color = data?.meta.genreColors[station.genre] ?? "#8FA39C";
    const name = station.name || T("unnamed");
    try {
      ms.metadata = new MediaMetadata({
        title: name,
        artist,
        album: "世界电台",
        artwork: [{ src: stationArtwork(name, color), sizes: "512x512", type: "image/png" }],
      });
      ms.playbackState =
        playState === "playing" || playState === "loading" ? "playing" : "paused";
    } catch {
      /* 老浏览器不支持 MediaMetadata 时忽略 */
    }
  }, [station, playState, data, lang]);

  const nearbyStep = useCallback(
    (dir: 1 | -1) => {
      const cur = stationRef.current;
      if (!cur || !data) return;
      const nr = nearbyRef.current;
      if (!nr.list.length) {
        nr.list = nearbyStations(poolRef.current, cur, 40);
        nr.i = -1;
      }
      if (!nr.list.length) {
        nextStation();
        return;
      }
      nr.i = (nr.i + dir + nr.list.length) % nr.list.length;
      tuneIn(nr.list[nr.i], true);
    },
    [data, nextStation, tuneIn]
  );

  /* 原站 qe 只在 rt()（进入唱片视图）那一刻按当前台算一次，之后唱片态里换台只挪 Je，
     连停留自动调谐换了台也不重建——否则 ↓ 之后再 ↑ 会翻到另一张列表上去。
     收藏开关与收藏序列取进入这一刻的快照，所以用 ref 读、不进依赖。 */
  useEffect(() => {
    if (!recordView) {
      if (diveRef.current.list.length) setDive({ list: [], i: -1 });
      return;
    }
    const s = stationRef.current;
    if (!s || !data) return;
    const ids = savedIdsRef.current;
    /* 原站 it(e) 第一行：只在收藏里换台（Nt）且当前台在收藏序列里 → 翻页列表就是收藏本身，
       不再按国家/±2° 过滤，也不排热度 */
    const list =
      favOnlyRef.current && ids.includes(s.id)
        ? ids.map((id) => findById(data.stations, id)).filter((x): x is Station => !!x)
        : diveList(poolRef.current, s);
    setDive({ list, i: Math.max(0, list.findIndex((x) => x.id === s.id)) });
  }, [recordView, data]);

  /* 原站 dt()：唱片态里翻同城列表，只把镜头转过去、不推近，4 秒内不听停留调谐 */
  const diveStep = useCallback(
    (dir: 1 | -1) => {
      const d = diveRef.current;
      if (!recordViewRef.current || d.list.length < 2 || d.i < 0) return;
      const k = (d.i + dir + d.list.length) % d.list.length;
      const s = d.list[k];
      if (!s) return;
      setDive({ list: d.list, i: k }); // 列表冻在进来那一刻，这里只挪游标
      tuneIn(s, true, { grace: 4000, toGlobe: false, zoom: false });
    },
    [tuneIn]
  );

  /* 原站 wr()：按下并拖过 6px 就置 Un 并把宽限期作废——重新抓球后停稳即可自动调谐 */
  const onGrab = useCallback(() => {
    draggedRef.current = true;
    dwellGrace.current = 0;
  }, []);

  /* ---------- 收藏 / 固定 / 分享 ---------- */
  const toggleSave = useCallback(
    (s: Station | null) => {
      if (!s) return;
      setSavedIds((ids) => {
        const has = ids.includes(s.id);
        const next = has ? ids.filter((x) => x !== s.id) : [s.id, ...ids];
        storage.setSaved(next);
        if (!has) showToast(T("toastSaved"));
        return next;
      });
    },
    [showToast]
  );

  const togglePin = useCallback(() => {
    setPinned((p) => {
      showToast(T(p ? "toastUnpinned" : "toastPinned"));
      return !p;
    });
  }, [showToast]);

  /* ---------- 收藏顺序 / 下线识别 / 拖拽排序 ---------- */
  const commitSaved = useCallback((next: string[]) => {
    setSavedIds(next);
    storage.setSaved(next);
  }, []);

  /** 收藏里已不在数据集里的 id（原站同一口径：找不到就标「已下线」） */
  const goneIds = useMemo(() => {
    if (!data) return [] as string[];
    return savedIds.filter((id) => !idxMap.current.has(id));
  }, [data, savedIds]);

  const favBoxRef = useRef<HTMLDivElement>(null);
  const drag = useDragSort({
    keys: savedIds,
    enabled: favOpen && favTab === "st" && savedIds.length > 1,
    containerRef: favBoxRef,
    commit: (next) => commitSaved(next),
  });

  /* ---------- 收藏导出 / 导入 ---------- */
  const exportFav = useCallback(() => {
    if (!data) return;
    const items = savedIds
      .map((id) => findById(data.stations, id))
      .filter(Boolean)
      .map((s) => ({ id: s!.id, name: s!.name, url: s!.url }));
    const blob = new Blob([JSON.stringify({ app: "世界电台", saved: items }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "world-radio-saved.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, savedIds]);

  const importFav = useCallback(
    (file: File) => {
      if (!data) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const items: { id?: string }[] = Array.isArray(parsed?.saved) ? parsed.saved : [];
          // 与原站一致：导入的 id 全部并入，数据里查不到的在列表里显示「已下线」
          const ids = items.map((x) => x?.id).filter((x): x is string => typeof x === "string" && !!x);
          if (!ids.length) {
            showToast(t(lang, "toastImportBad"));
            return;
          }
          setSavedIds((prev) => {
            const added = ids.filter((x) => !prev.includes(x));
            const next = [...added, ...prev];
            storage.setSaved(next);
            return next;
          });
          showToast(t(lang, "toastImported", { a: ids.length, b: 0 }));
        } catch {
          showToast(t(lang, "toastImportBad"));
        }
      };
      reader.readAsText(file);
    },
    [data, lang, showToast]
  );

  const share = useCallback(async () => {
    const s = stationRef.current;
    if (!s) return;
    const u = new URL(window.location.origin + window.location.pathname);
      u.hash = "#/radio";
    u.searchParams.set("s", s.id);
    const url = u.toString();
    const place = placeLine(lang, s, data?.meta ?? null, "");
    const text = t(lang, "shareText", { name: s.name, place });
    try {
      if (navigator.share) {
        await navigator.share({ title: "世界电台", text, url });
        return;
      }
    } catch {
      /* 用户取消 */
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t(lang, "toastCopied"));
    } catch {
      showToast(t(lang, "toastCopyFail"));
    }
  }, [data, lang, showToast]);

  /* ---------- 准星就近（带去重，避免拖动时频繁重渲染） ---------- */
  const onNearest = useCallback(
    (
      s: Station | null,
      d: number,
      locked: boolean,
      km?: number,
      settled?: boolean
    ) => {
      const prev = nearestRef.current;
      if (s) {
        if (
          prev &&
          prev.idx === s.idx &&
          Math.abs(prev.d - d) < 2 &&
          prev.locked === locked &&
          prev.settled === !!settled
        )
          return;
        nearestRef.current = { idx: s.idx, d, locked, settled: !!settled };
        setNearest({ s, d, locked, km, settled: !!settled });
        /* 原站 l.preload()：准星锁定的台先缓冲，换台时直接接管元素 */
        if (locked && s.id !== preIdRef.current && s.id !== stationRef.current?.id) {
          preIdRef.current = s.id;
          preload(s.url);
        }
      } else {
        if (!prev) return;
        nearestRef.current = null;
        setNearest(null);
      }
    },
    []
  );

  /* ---------- 停留自动调谐：原站 ei&&m&&xt>.45&&Et.i!==hn&&Vn<0&&now>Hn&&!Gn&&(Un||hn<0) ---------- */
  useEffect(() => {
    /* Un（拖过球面）是原站这条链里最硬的前置条件：每次调谐都会清掉它，
       所以自动切台只会发生在「用户自己把准星挪到另一台头上」之后 */
    const cur0 = stationRef.current;
    if (
      !introDone ||
      !data ||
      pinned ||
      recordView ||
      !nearest ||
      !nearest.locked ||
      !nearest.settled ||
      (!draggedRef.current && !!cur0)
    ) {
      dwellRef.current = null;
      return;
    }
    const cur = stationRef.current;
    if (cur && nearest.s.id === cur.id) {
      dwellRef.current = null;
      return;
    }
    const iv = setInterval(() => {
      const now = performance.now();
      const cur = stationRef.current;
      // 已是当前台 / 宽限期内 / 半途进了唱片态 → 不触发
      if (
        recordViewRef.current ||
        (cur && nearest.s.id === cur.id) ||
        now < dwellGrace.current
      ) {
        dwellRef.current = null;
        return;
      }
      if (!dwellRef.current || dwellRef.current.idx !== nearest.s.idx) {
        dwellRef.current = { idx: nearest.s.idx, at: now };
        return;
      }
      if (now - dwellRef.current.at > 450) {
        dwellRef.current = null;
        /* 原站这里只调 Ln()：不设宽限、不切视图、不推镜头——台本来就在准星底下 */
        tuneIn(nearest.s, true, { grace: 0, toGlobe: false, zoom: false });
      }
    }, 120);
    return () => clearInterval(iv);
  }, [nearest, introDone, data, pinned, recordView, tuneIn]);

  /* ---------- 睡眠定时 ---------- */
  useEffect(() => {
    if (sleepMin <= 0) return;
    setSleepLeft(sleepMin * 60);
    const iv = setInterval(() => {
      setSleepLeft((v) => {
        if (v <= 1) {
          audioRef.current?.pause();
          setPlayState("paused");
          setSleepMin(0);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [sleepMin]);

  /* ---------- 搜索 ---------- */
  useEffect(() => {
    if (!searchOpen || !query.trim() || !data) {
      setResults([]);
      return;
    }
    const iv = setTimeout(() => {
      setResults(searchStations(data.stations, data.meta, query, 24));
      setHl(0);
    }, 160);
    return () => clearTimeout(iv);
  }, [query, searchOpen, data]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setFavOpen(false);
    setSetOpen(false);
    setTimeout(() => searchInputRef.current?.focus(), 60);
  }, []);

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (searchOpen && inInput) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHl((h) => Math.min(h + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setHl((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const r = results[hl];
          if (r) {
            tuneIn(r, true);
            setSearchOpen(false);
            setQuery("");
          }
        } else if (e.key === "Escape") {
          setSearchOpen(false);
          setQuery("");
        }
        return;
      }
      if (inInput) return;
      // 焦点在按钮/链接上时，空格与回车交给默认行为
      const onControl =
        target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
      if (onControl && (e.key === " " || e.key === "Enter")) return;
      /* 原站：进了唱片视图（We）之后整组按键语义换掉，其余键（g / r / n /）一律不响应 */
      if (recordView) {
        switch (e.key) {
          case " ":
            e.preventDefault();
            togglePlay();
            break;
          case "m":
          case "M":
            setMuted((m) => !m);
            break;
          case "Escape":
          case "e":
          case "E":
          case "Enter":
            setRecordView(false);
            break;
          case "ArrowRight":
            e.preventDefault();
            nextStation(); // 原站 Qn('key')，走 qn() 会先 lt() 退出唱片
            break;
          case "ArrowLeft":
            e.preventDefault();
            prevStation();
            break;
          case "ArrowUp":
            e.preventDefault();
            diveStep(-1);
            break;
          case "ArrowDown":
            e.preventDefault();
            diveStep(1);
            break;
          case "f":
          case "F":
            toggleSave(stationRef.current);
            break;
          case "l":
          case "L":
            togglePin();
            break;
        }
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          nextStation();
          break;
        case "ArrowLeft":
          e.preventDefault();
          prevStation();
          break;
        case "ArrowUp":
          e.preventDefault();
          nearbyStep(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          nearbyStep(1);
          break;
        case "g":
        case "G":
          setView((v) => (v === "globe" ? "sky" : "globe"));
          break;
        case "/":
          e.preventDefault();
          openSearch();
          break;
        case "f":
        case "F":
          toggleSave(stationRef.current);
          break;
        case "l":
        case "L":
          togglePin();
          break;
        case "m":
        case "M":
          setMuted((m) => !m);
          break;
        case "r":
        case "R":
        case "n":
        case "N":
          nextStation(); // 原站 r/R/n/N 与 → 同一个 Qn('key')
          break;
        case "Enter":
          /* 原站：准星锁在别的可见台上 → 只 Ln() 过去（不设宽限、不推近、不换视图），
             然后无条件试 rt() 进唱片视图 */
          if (
            nearest &&
            nearest.locked &&
            (!stationRef.current || nearest.s.id !== stationRef.current.id)
          )
            tuneIn(nearest.s, true, { grace: 0, toGlobe: false, zoom: false });
          if (stationRef.current) setRecordView(true);
          break;
        case "Escape":
          setSearchOpen(false);
          setFavOpen(false);
          setSetOpen(false);
          setFilterOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    togglePlay,
    nextStation,
    prevStation,
    nearbyStep,
    diveStep,
    openSearch,
    toggleSave,
    togglePin,
    tuneIn,
    nearest,
    recordView,
    searchOpen,
    results,
    hl,
  ]);

  /* ---------- 入口页 ---------- */
  const enterWorkspace = useCallback(
    (opts: { station?: Station | null; autoplay: boolean; view?: "sky" }) => {
      storage.setSeen();
      setIntroDone(true);
      autoRecordAt.current = performance.now();
      if (opts.station) tuneIn(opts.station, opts.autoplay);
      else if (opts.view) {
        // 纯逛星图：清掉入口页带来的上次电台，回到空态
        setStation(null);
        setPlayState("idle");
        setView(opts.view);
      }
    },
    [tuneIn]
  );

  /* 用户定位 → 打开工作区并播放最近的电台 */
  useEffect(() => {
    const onLocate = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const lat = Number(d.lat), lon = Number(d.lon);
      const all = data?.stations ?? [];
      if (!isFinite(lat) || !isFinite(lon) || !all || !all.length) return;
      const list = nearestByCoord(all, lat, lon, 400);
      if (!list.length) return;
      const st = list[0];
      const nearCount = list.filter((x) => x.distanceKm <= 100).length;
      const how = d.source === 'cache' ? '上次位置' : d.source === 'ip' ? '按 IP 定位' : '已定位';
      const city = d.city ? `${d.city} · ` : '';
      const msg = `${how} · ${city}附近 ${nearCount} 个台，正在播放最近的：${st.name}（${Math.round(st.distanceKm)} km）`;
      if (d.city) setMyCity(String(d.city));
      if (introMounted) { enterWorkspace({ station: st, autoplay: true }); setIntroMounted(false); }
      else tuneIn(st, true, { toGlobe: true, zoom: true });
      showToast(msg);
    };
    const onLocateErr = (e: Event) => {
      const msg = (e as CustomEvent).detail?.message || '无法获取位置';
      showToast(`定位失败：${msg}`);
    };
    window.addEventListener('rd-locate', onLocate as EventListener);
    window.addEventListener('rd-locate-error', onLocateErr as EventListener);
    return () => {
      window.removeEventListener('rd-locate', onLocate as EventListener);
      window.removeEventListener('rd-locate-error', onLocateErr as EventListener);
    };
  }, [data, tuneIn, showToast, enterWorkspace, introMounted]);

  const lastStation = useMemo(() => {
    if (!data || introDone) return null;
    const id = storage.getLast();
    return id ? findById(data.stations, id) : null;
  }, [data, introDone]);

  /* ---------- 派生 ---------- */
  const currentIdx = useMemo(() => {
    if (!station) return null;
    return idxMap.current.get(station.id) ?? null;
  }, [station]);

  const counts = useMemo(
    () => (data ? genreCounts(data.stations) : new Array(11).fill(0)),
    [data]
  );
  const countryCount = useMemo(
    () => (data ? new Set(data.meta.countries.map((c) => c[0])).size : 0),
    [data]
  );

  const isLive = playState === "playing" || playState === "loading";
  const statusText = (() => {
    if (!station) return T("idle");
    switch (playState) {
      case "playing":
        return T("playing");
      case "loading":
        return T("connecting");
      case "paused":
        return T("pausedKey");
      case "error":
        return T("failed");
      case "blocked":
        return T("blocked");
      default:
        return T("pausedKey");
    }
  })();

  const lockbox = (() => {
    const aimed = (s: Station) => {
      const g = data?.meta.genres[s.genre] ?? "";
      const br = s.br > 0 ? `${s.br} kbps` : T("brUnknown");
      return { t1: T("locked"), rest: `${g} · ${br}`, t2: s.name || T("unnamed") };
    };
    // 未开始收听但有预瞄台 = 回访入口页的 .pre.aim 状态
    if (!introDone && lastStation) return aimed(lastStation);
    if (!nearest) return { t1: view === "sky" ? T("viewNeb") : T("tuning"), rest: "", t2: "" };
    if (nearest.locked) return aimed(nearest.s);
    const d =
      nearest.km != null
        ? `${Math.round(nearest.km).toLocaleString(lang === "zh" ? "zh-CN" : "en")} km`
        : `${Math.round(nearest.d)} px`;
    return {
      t1: T("nearest", { d }),
      rest: "",
      t2: nearest.s.name || T("unnamed"),
    };
  })();

  const glowColor = station && data ? data.meta.genreColors[station.genre] : "#ede3cc";
  const toggleGenre = (i: number) =>
    setActiveGenres((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  /* ---------- JSX ---------- */
  return (
    <div
      className={`gx${introMounted ? " pre" : ""}${introMounted && lastStation ? " aim" : ""}${idleHide ? " idle" : ""}${recordView ? " dive" : ""}${isPhone ? " ph" : ""}`}
      id="root"
    >
      {/* 画布层：地球与星云是同一套点云，随 view 做 morph（原站单画布） */}
      <SceneCanvas
        stations={data?.stations ?? []}
        meta={data?.meta ?? EMPTY_META}
        view={view}
        activeGenres={activeGenres}
        currentIdx={currentIdx}
        playing={isLive}
        started={introDone}
        lang={lang}
        onNearest={onNearest}
        onPick={(s) => tuneIn(s, true, { grace: 1500, toGlobe: false, zoom: false })}
        onGrab={onGrab}
        zoomOnSwitch={switchZoom}
        diving={recordView}
        diveForm={diveForm}
        pro={!ecoOn}
        onDive={() => setRecordView(true)}
        onError={() => {
          setWebglFailed(true);
          showToast(T("noWebGL"));
        }}
      />

      <div className="scrim" />
      {/* .glow 的不透明度由 SceneCanvas 按音频实时写（原站同款），这里只给颜色 */}
      <div className="glow" style={{ ["--glow-c" as any]: glowColor }} />

      {/* 准星 */}
      <div className="cross">
        <svg viewBox="0 0 80 80" width="80" height="80">
          <g className="ticks">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 * Math.PI) / 180;
              const r2 = i % 3 === 0 ? 38 : 36;
              // 取整避免 SSR/客户端浮点序列化差异导致的水合警告
              const rd = (v: number) => Math.round(v * 100) / 100;
              return (
                <line
                  key={i}
                  x1={rd(40 + 32 * Math.cos(a))}
                  y1={rd(40 + 32 * Math.sin(a))}
                  x2={rd(40 + r2 * Math.cos(a))}
                  y2={rd(40 + r2 * Math.sin(a))}
                  className={i % 3 === 0 ? "lt" : ""}
                />
              );
            })}
          </g>
          <circle className="ring" cx="40" cy="40" r="30" />
          <path
            className="arc"
            d="M 70 40 A 30 30 0 0 0 40 10"
            strokeDasharray="47.1"
            strokeDashoffset={isLive ? 0 : 47.1}
          />
          <circle className={`sig${isLive ? " on" : ""}`} cx="40" cy="40" r="3" />
        </svg>
        {lockbox && (
          <div className="lockbox">
            <div className="t1">
              <b>{lockbox.t1}</b>
              {lockbox.rest ? ` · ${lockbox.rest}` : ""}
            </div>
            <div className="t2">{lockbox.t2}</div>
          </div>
        )}
      </div>

      {/* 当地大时间 */}
      <div className="ltime">
        <div className="hm">{localTime}</div>
        <div className="mono">
          {station
            ? `${timePlace(lang, station, data?.meta ?? null)} · ${T("localTime")}`
            : "—"}
        </div>
      </div>

      {/* UI 覆盖层 */}
      <div className="ui">
        {/* 左上：品牌 + 统计 */}
        <div className="tl pe">
          {/* 原站 LF()：唱片态左上角那枚返回箭头。CSS 只在 ≤560px 的 .dive 下显示它，
              桌面端另有状态行里的「← 返回 · Esc」，手机端 .now 整块不渲染，全靠这颗 */}
          <button className="dback pe" onClick={() => setRecordView(false)} aria-label={T("back")} title={T("back")}>
            <ChevronIcon />
          </button>
          <button
            className="logo home"
            onClick={() => {
              setView("globe");
              setFavOpen(false);
              setSetOpen(false);
            }}
          >
            <BrandMark />
            <span>世界电台</span>
          </button>
          <div className="stats mono dim" style={{ marginTop: 8 }}>
            {data ? (
              <>
                {T("stats", {
                  n: data.meta.n.toLocaleString(lang === "zh" ? "zh-CN" : "en"),
                  c: countryCount.toLocaleString(lang === "zh" ? "zh-CN" : "en"),
                })}
                {myCity ? ` · 📍 ${myCity}` : null}
                {pool.length < data.meta.n && (
                  <>
                    <br />
                    {T("showing", {
                      v: pool.length.toLocaleString(lang === "zh" ? "zh-CN" : "en"),
                    })}
                  </>
                )}
              </>
            ) : (
              "…"
            )}
          </div>
        </div>

        {/* 右上：搜索 / 视图 / 收藏 / 设置 */}
        <div className="tr pe">
          <div className={`search pe${searchOpen ? " ex" : ""}`}>
            <button
              className="tbtn sbtn"
              onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}
              title={T("searchPhKey")}
              aria-label={T("searchOpen")}
            >
              <SearchIcon />
            </button>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={T("searchPh")}
              title={T("searchPhKey")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
            />
            {results.length > 0 && (
              <div className="results pe">
                {results.map((s, i) => (
                  <button
                    key={s.id}
                    className={i === hl ? "hl" : ""}
                    onClick={() => {
                      tuneIn(s, true);
                      setSearchOpen(false);
                      setQuery("");
                    }}
                  >
                    <span
                      className="gd"
                      style={{ background: data?.meta.genreColors[s.genre] }}
                    />
                    <span className="nm">{s.name || T("unnamed")}</span>
                    <span className="sub">
                      {[
                        data?.meta.countries[s.country]?.[lang === "zh" ? 1 : 2],
                        s.state,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchOpen && query.trim() && results.length === 0 && (
              <div className="results pe">
                <div className="ddnone" style={{ padding: "14px 16px" }}>
                  {T("noHit")}
                </div>
              </div>
            )}
          </div>

          <div className="seg">
            <button
              className={view === "globe" ? "on" : ""}
              onClick={() => setView("globe")}
            >
              {T("viewGlobe")}
            </button>
            <button className={view === "sky" ? "on" : ""} onClick={() => setView("sky")}>
              {T("viewNeb")}
            </button>
          </div>

          <button
            className="tbtn"
            onClick={() => {
              setFavOpen((v) => !v);
              setSetOpen(false);
              setSearchOpen(false);
            }}
            title={T("saved")}
            aria-expanded={favOpen}
          >
            <SaveIcon />
            <span>{T("saved")}</span>
            <b>{savedIds.length}</b>
          </button>

          <button
            className={`tbtn gear${setOpen ? " on" : ""}`}
            onClick={() => {
              setSetOpen((v) => !v);
              setFavOpen(false);
              setSearchOpen(false);
            }}
            aria-expanded={setOpen}
            aria-label={T("settings")}
            title={T("settings")}
          >
            <GearIcon />
          </button>
        </div>

        {/* 收藏 / 历史面板 */}
        {favOpen && (
          <div className="favpanel pe" ref={favBoxRef}>
            <div className="hd">
              <div className="seg">
                <button
                  className={favTab === "st" ? "on" : ""}
                  onClick={() => setFavTab("st")}
                >
                  {T("saved")} {savedIds.length}
                </button>
                <button
                  className={favTab === "recent" ? "on" : ""}
                  onClick={() => setFavTab("recent")}
                >
                  {T("recent")} {recent.length}
                </button>
              </div>
              <button
                className="lnk"
                onClick={() => {
                  const v = !favOnly;
                  setFavOnly(v);
                  storage.setBool("favOnly", v);
                }}
                title={savedIds.length ? T("phFavOnlySub", { n: savedIds.length }) : T("savedEmpty")}
              >
                {T(favOnly ? "showAll" : "onlySaved")}
              </button>
              <button
                className="igx"
                onClick={() => setFavOpen(false)}
                aria-label="close"
              >
                <CloseIcon />
              </button>
            </div>
            {(() => {
              const ids = favTab === "st" ? drag.order : recent;
              const rows = ids.map((id) => ({ id, s: data ? findById(data.stations, id) : null }));
              if (!rows.length)
                return (
                  <div className="empty">
                    {favTab === "st" ? T("savedEmpty") : T("recentEmpty")}
                  </div>
                );
              return rows.map(({ id, s }) => (
                <div
                  className={`frow${drag.dragKey === id ? " drag" : ""}`}
                  key={id}
                  data-dkey={id}
                  title={favTab === "st" && savedIds.length > 1 ? T("dragHint") : undefined}
                  onPointerDown={
                    favTab === "st" && savedIds.length > 1
                      ? (e) => drag.onRowDown(id, e)
                      : undefined
                  }
                >
                  {favTab === "st" && s && (
                    <button
                      className="heart on"
                      onClick={() => toggleSave(s)}
                      aria-label={T("unsaveStation")}
                      title={T("unsaveStation")}
                    >
                      <HeartIcon />
                    </button>
                  )}
                  <button
                    className="it"
                    onClick={() => {
                      if (!s) return;
                      tuneIn(s, true);
                      setFavOpen(false);
                    }}
                  >
                    <span className="gd" style={{ background: s ? data?.meta.genreColors[s.genre] : "#555" }} />
                    <span className="nm">{s ? s.name || T("unnamed") : id.slice(0, 8)}</span>
                    <span className="sub">
                      {s ? (
                        <>
                          <FlagIcon cc={data?.meta.countries[s.country]?.[0]} />{" "}
                          {data?.meta.countries[s.country]?.[lang === "zh" ? 1 : 2]}
                          {s.br ? ` · ${s.br} kbps` : ""}
                        </>
                      ) : (
                        T("gone")
                      )}
                    </span>
                  </button>
                  {favTab !== "st" && <span style={{ width: 28 }} />}
                </div>
              ));
            })()}
            <div className="ft">
              {favTab === "st" && savedIds.length > 1 && (
                <span className="hint2">{T("dragHint")}</span>
              )}
              {favTab === "st" && goneIds.length > 0 && (
                <button
                  className="lnk"
                  onClick={() => {
                    commitSaved(savedIds.filter((x) => !goneIds.includes(x)));
                    showToast(T("toastCleared", { n: goneIds.length }));
                  }}
                >
                  {T("clearGone", { n: goneIds.length })}
                </button>
              )}
              <span className="sp" />
              {favTab === "st" && (
                <>
                  <button
                    className="lnk"
                    disabled={!savedIds.length}
                    title={t(lang, "exportSub")}
                    onClick={exportFav}
                  >
                    {t(lang, "exportFav")}
                  </button>
                  <label className="lnk" style={{ cursor: "pointer" }} title={t(lang, "importSub")}>
                    {t(lang, "importFav")}
                    <input
                      type="file"
                      accept="application/json,.json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importFav(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </>
              )}
              {favTab === "recent" && recent.length > 0 && (
                <button
                  className="lnk"
                  onClick={() => {
                    commitRecent([]);
                    showToast(t(lang, "toastRecentCleared"));
                  }}
                >
                  {t(lang, "clearRecent")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 设置面板：分组与控件对齐原站（收听 / 画面 / 其他） */}
        {setOpen && (
          <div className="setpanel pe" role="dialog" aria-label={T("settings")}>
            <div className="pgrp">{T("phGrpPlay")}</div>
            <div className="row pcol">
              <span className="tx">
                <span>{T("sleep")}</span>
                {sleepMin > 0 && (
                  <span className="sub">
                    {T("sleepLeft", { n: Math.max(1, Math.ceil(sleepLeft / 60)) })}
                  </span>
                )}
              </span>
              <div className="seg">
                {[0, 15, 30, 60].map((v) => (
                  <button
                    key={v}
                    className={sleepMin === v ? "on" : ""}
                    onClick={() => setSleepMin(v)}
                  >
                    {v ? T("minShort", { n: v }) : T("off")}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="row sw"
              onClick={() => {
                const v = !normOn;
                setNormOn(v);
                storage.setBool("norm", v);
                audioSetNorm(v);
              }}
            >
              <div className="tx">
                <span>{T("norm")}</span>
                <span className="sub">{T("normSub")}</span>
              </div>
              <span className={`knob${normOn ? " on" : ""}`} />
            </button>
            <button
              className="row sw"
              onClick={() => {
                const v = !fxOn;
                setFxOn(v);
                storage.setBool("fx", v);
                audioSetFx(v);
              }}
            >
              <div className="tx">
                <span>{T("fx")}</span>
                <span className="sub">{T("fxSub")}</span>
              </div>
              <span className={`knob${fxOn ? " on" : ""}`} />
            </button>

            <div className="pgrp">{T("phGrpScreen")}</div>
            <div className="row mobonly">
              <span className="tx">
                <span>{T("viewRow")}</span>
              </span>
              <div className="seg">
                <button className={view === "globe" ? "on" : ""} onClick={() => setView("globe")}>
                  {T("viewGlobe")}
                </button>
                <button className={view === "sky" ? "on" : ""} onClick={() => setView("sky")}>
                  {T("viewNeb")}
                </button>
              </div>
            </div>
            <button
              className="row sw"
              onClick={() => {
                const v = !autoRecOn;
                setAutoRecOn(v);
                storage.setBool("autoDive", v);
              }}
            >
              <div className="tx">
                {/* 原站这一行刻意用 autoRec 文案：r.autoDive=Y(`autoRec`)，
                    持久化键仍是 roamdial.autoDive，标签写的是「换台后 10 秒没操作进唱片」 */}
                <span>{T("autoRec")}</span>
                <span className="sub">{T("autoRecSub")}</span>
              </div>
              <span className={`knob${autoRecOn ? " on" : ""}`} />
            </button>
            <div className="row pcol">
              <span className="tx">
                <span>{T("diveForm")}</span>
              </span>
              <div className="seg c5">
                {(
                  [
                    ["genre", T("dfGenre")],
                    ["random", T("dfRandom")],
                    ["disc", T("dfDisc")],
                    ["orb", T("dfOrb")],
                    ["field", T("dfField")],
                  ] as [DiveForm, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    className={diveForm === v ? "on" : ""}
                    onClick={() => {
                      setDiveForm(v);
                      storage.setDiveForm(v);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="row sw"
              onClick={() => {
                const v = !ecoOn;
                setEcoOn(v);
                storage.setBool("eco", v);
              }}
            >
              <div className="tx">
                <span>{T("eco")}</span>
                <span className="sub">{T("phEcoSub")}</span>
              </div>
              <span className={`knob${ecoOn ? " on" : ""}`} />
            </button>
            <button
              className="row sw"
              onClick={() => {
                const v = !hintOn;
                setHintOn(v);
                storage.setHint(v);
              }}
            >
              <div className="tx">
                <span>{T("hintSw")}</span>
                <span className="sub">{T("hintSwSub")}</span>
              </div>
              <span className={`knob${hintOn ? " on" : ""}`} />
            </button>

            <div className="pgrp">{T("phGrpGeneral")}</div>
            <div className="row">
              <div className="tx">
                <span>{T("uiLanguage")}</span>
              </div>
              <div className="seg">
                <button
                  className={lang === "zh" ? "on" : ""}
                  onClick={() => switchLang("zh")}
                >
                  中文
                </button>
                <button
                  className={lang === "en" ? "on" : ""}
                  onClick={() => switchLang("en")}
                >
                  English
                </button>
              </div>
            </div>
            
            
          </div>
        )}

        {/* 播放器卡片（桌面） / 调频刻度盘（手机） */}
        {!isPhone ? (
        <div className={`now pe${isLive ? " live" : ""}${!station ? " empty" : ""}`}>
          <div
            className="k"
            onClick={() => station && setRecordView(true)}
            title={T("phRecord")}
            style={station ? { cursor: "pointer" } : undefined}
          >
            <i className="dot" />
            <span>{statusText}</span>
          </div>
          <h1
            onClick={() => station && setSheetOpen(true)}
            title={station ? T("phDetail") : undefined}
            style={station ? { cursor: "pointer" } : undefined}
          >
            {station ? station.name || T("unnamed") : T("tagline")}
          </h1>
          {station ? (
            <>
              <p className="place">
                <span className="flag"><FlagIcon cc={data?.meta.countries[station.country]?.[0]} /></span>
                {placeLine(lang, station, data?.meta ?? null, "")}
              </p>
              <div className="meta mono">{metaLine(lang, station, data?.meta ?? null)}</div>
            </>
          ) : (
            <p className="place">{T("idle")}</p>
          )}

          <div className="ctrl">
            <button
              className="play"
              onClick={togglePlay}
              aria-label={playState === "playing" ? T("pause") : T("play")}
            >
              {playState === "playing" ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="tp">
              <button className="ibtn" onClick={prevStation} title={T("prevStation")}>
                <PrevIcon />
              </button>
            </div>
            <button className="btn" onClick={nextStation}>
              <span>{T("next")}</span>
            </button>
            <div className="acts">
              <button
                className={`ibtn${station && savedIds.includes(station.id) ? " on" : ""}`}
                onClick={() => toggleSave(station)}
                title={T("save")}
                aria-label={T("save")}
              >
                <HeartIcon />
              </button>
              <button
                className="ibtn"
                onClick={share}
                title={T("share")}
                aria-label={T("share")}
              >
                <ShareIcon />
              </button>
              <button
                className={`ibtn${pinned ? " on" : ""}`}
                onClick={togglePin}
                title={T("pin")}
                aria-label={T("pin")}
              >
                <PinIcon />
              </button>
            </div>
          </div>

          <div className="btnrow mono">
            {/* 原站 rt()/lt()：这个键位就是唱片视图的开关，唱片态里换成「返回」 */}
            <button
              className="lnk"
              onClick={() => (recordView ? setRecordView(false) : station && setRecordView(true))}
            >
              {recordView
                ? "← " + (hintOn ? T("backKey") : T("back"))
                : (hintOn ? T("enterKey") : T("enter")) + " →"}
            </button>
            {/* 原站 diveNav：进唱片且同城列表 >1 台才出现，dt() 只转镜头不推近 */}
            {recordView && dive.list.length > 1 && (
              <span className="diveNav">
                <button className="lnk" onClick={() => diveStep(-1)}>
                  ‹ {T("prev")}
                </button>
                <span className="dim">
                  {dive.i + 1} / {dive.list.length}
                </span>
                <button className="lnk" onClick={() => diveStep(1)}>
                  {T("nextNear")} ›
                </button>
              </span>
            )}
            <div className="vol">
              <button
                className="ibtn s"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? T("muted") : T("mute")}
                style={{ border: 0, width: 36, height: 44 }}
              >
                {muted ? <MuteIcon /> : <VolIcon />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                style={{ ["--p" as any]: `${(muted ? 0 : volume) * 100}%` }}
                aria-label={T("volume")}
              />
            </div>
          </div>
        </div>
        ) : (
          <PhonePlayer
            station={station}
            stations={pool}
            meta={data?.meta ?? EMPTY_META}
            lang={lang}
            playing={playState === "playing"}
            loading={playState === "loading"}
            saved={!!station && savedIds.includes(station.id)}
            onTune={(s) => tuneIn(s, true)}
            onTogglePlay={togglePlay}
            onPrev={prevStation}
            onNext={nextStation}
            onShuffle={nextStation}
            onToggleSave={() => toggleSave(station)}
            onOpenSheet={() => setSheetOpen(true)}
          />
        )}

        {/* 底部：筛选 + 流派 chips */}
        <div ref={bottomRef} className={`bottom pe${filterOpen ? " fopen" : ""}`}>
          <div className="fbar">
            <button
              className="chip ftog"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <FilterIcon />
              <span>{T("fltBtn")}</span>
              {(activeGenres.size > 0 || activeLangs.size > 0 || bitrateMin > 0) && (
                <span className="fbadge">
                  {activeGenres.size + activeLangs.size + (bitrateMin > 0 ? 1 : 0)}
                </span>
              )}
              <ChevronIcon />
            </button>
            <div className="chips">
              <button
                className={`chip${activeGenres.size === 0 && activeLangs.size === 0 && bitrateMin === 0 ? " on" : ""}`}
                onClick={() => {
                  setActiveGenres(new Set());
                  setActiveLangs(new Set());
                  setBitrateMin(0);
                }}
              >
                {T("all")} <em>{data?.meta.n ?? 0}</em>
              </button>
              {data?.meta.genres.map((g, i) => (
                <button
                  key={i}
                  className={`chip${activeGenres.has(i) ? " on" : ""}`}
                  onClick={() => toggleGenre(i)}
                >
                  <i style={{ background: data.meta.genreColors[i] }} />
                  {lang === "zh" ? g : data.meta.genresEn[i]} <em>{counts[i]}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="fbody">
            <div>
              <div className="fin">
                <div>
                  <div className="fh">{T("genre")}</div>
                  <div className="fwrap">
                    {data?.meta.genres.map((g, i) => (
                      <button
                        key={i}
                        className={`chip${activeGenres.has(i) ? " on" : ""}`}
                        onClick={() => toggleGenre(i)}
                      >
                        <i style={{ background: data.meta.genreColors[i] }} />
                        {lang === "zh" ? g : data.meta.genresEn[i]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="fh">{T("language")}</div>
                  <div className="fwrap">
                    {(data?.meta.langs ?? []).slice(0, 10).map((l, i) => (
                      <button
                        key={i}
                        className={`chip${activeLangs.has(i) ? " on" : ""}`}
                        onClick={() =>
                          setActiveLangs((prev) => {
                            const n = new Set(prev);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                      >
                        {lang === "zh" ? l[0] : l[1]}
                      </button>
                    ))}
                    <div className={`dd${langDDOpen ? " open" : ""}`}>
                      <button
                        className="ddbtn"
                        onClick={() => setLangDDOpen((v) => !v)}
                      >
                        <span>{T("moreLangs")}</span>
                        <ChevronIcon />
                      </button>
                      {langDDOpen && (
                        <div className="ddpop l">
                          <input
                            className="ddfind"
                            placeholder={T("findLang")}
                            value={langDDQuery}
                            onChange={(e) => setLangDDQuery(e.target.value)}
                          />
                          <div className="ddlist">
                            {(data?.meta.langs ?? [])
                              .map((l, i) => ({ l, i }))
                              .filter(({ l }) => {
                                const q = langDDQuery.trim().toLowerCase();
                                if (!q) return true;
                                return (
                                  l[0].includes(q) ||
                                  l[1].toLowerCase().includes(q)
                                );
                              })
                              .map(({ l, i }) => (
                                <button
                                  key={i}
                                  className={activeLangs.has(i) ? "on" : ""}
                                  onClick={() =>
                                    setActiveLangs((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(i)) n.delete(i);
                                      else n.add(i);
                                      return n;
                                    })
                                  }
                                >
                                  <span className="lb">
                                    {lang === "zh" ? l[0] : l[1]}
                                  </span>
                                  <em>{lang === "zh" ? l[1] : l[0]}</em>
                                </button>
                              ))}
                            {langDDQuery.trim() &&
                              (data?.meta.langs ?? []).filter((l) => {
                                const q = langDDQuery.trim().toLowerCase();
                                return (
                                  l[0].includes(q) || l[1].toLowerCase().includes(q)
                                );
                              }).length === 0 && (
                                <div className="ddnone">{T("noHit")}</div>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="fh">{T("bitrate")}</div>
                  <div className="seg">
                    {[
                      [0, T("all")],
                      [128, "128+"],
                      [192, "192+"],
                      [256, "256+"],
                      [320, "320+"],
                    ].map(([v, label]) => (
                      <button
                        key={String(v)}
                        className={bitrateMin === v ? "on" : ""}
                        onClick={() => setBitrateMin(Number(v))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷键提示 */}
        {hintOn && <div className="hint" dangerouslySetInnerHTML={{ __html: T("hint") }} />}
      </div>

      {/* WebGL 降级提示（地球画不出；星图仍可用） */}
      {webglFailed && (
        <div
          className="toast"
          style={{ maxWidth: 520, whiteSpace: "normal", lineHeight: 1.6, textAlign: "left" }}
        >
          <div style={{ fontWeight: 600 }}>{T("noWebGL")}</div>
          <div style={{ marginTop: 4, color: "var(--dim)", fontSize: 12.5 }}>
            {T("noWebGLHint")}
          </div>
        </div>
      )}

      {/* 唱片视图：已并入 WebGL 场景（原站 3D 点云），不再有 2D 覆盖层 */}

      {/* 闲置挂机画面 */}
      {standbyOn && station && data && (
        <Standby
          station={station}
          meta={data.meta}
          lang={lang}
          playing={playState === "playing"}
          onWake={() => setStandbyOn(false)}
          onTogglePlay={togglePlay}
        />
      )}

      {/* 电台详情面板 */}
      {sheetOpen && station && data && (
        <StationSheet
          station={station}
          meta={data.meta}
          lang={lang}
          saved={savedIds.includes(station.id)}
          onClose={() => setSheetOpen(false)}
          onToggleSave={() => toggleSave(station)}
          onShare={share}
        />
      )}

      {/* PWA 安装引导 */}
      {introDone && <InstallPrompt lang={lang} />}

      {/* Toast */}
      {toast && !webglFailed && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}

      {/* 入口页 */}
      {introMounted && (
        <Intro
          lang={lang}
          meta={data?.meta ?? null}
          loaded={!!data}
          loadError={loadError}
          lastStation={lastStation}
          lastLocalTime={localTime}
          onStart={() =>
            enterWorkspace({
              station: data ? (randomStations(data.stations, 1)[0] ?? null) : null,
              autoplay: true,
            })
          }
          onExplore={() => enterWorkspace({ autoplay: false, view: "sky" })}
          onListenLast={() => enterWorkspace({ station: lastStation, autoplay: true })}
          onRandomLast={() =>
            enterWorkspace({
              station: data ? (randomStations(data.stations, 1)[0] ?? null) : null,
              autoplay: true,
            })
          }
          onExited={() => setIntroMounted(false)}
        />
      )}
    </div>
  );
}
