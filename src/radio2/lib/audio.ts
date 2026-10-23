/* 音频引擎：播放唯一控制点
 * - 双元素策略照抄原站 web 引擎：A 元素 crossOrigin=anonymous 并接入
 *   MediaElementSource → AnalyserNode，能拿到真实频谱；A 失败（流无 CORS）
 *   自动退回普通 B 元素直出，播放不受影响、只是没有频谱
 * - .m3u8 走 hls.js（原站同款）：Chrome 不能原生播 HLS，且 hls.js 的 XHR 也要 CORS，
 *   所以链路是 HLS(A) → HLS(B) → emit error（由上层自动换台）
 * - 音量 / 静音 / 静电都经 setLevels 写进音频图（原站每帧调用同一个函数）
 */

let elA: HTMLAudioElement | null = null;
let elB: HTMLAudioElement | null = null;
let mode: "A" | "B" | "" = "";
let curUrl = "";
let aFailed = false;
let live = false;
let paused = true;

type HlsClass = typeof import("hls.js").default;
type HlsInstance = InstanceType<HlsClass>;
let hlsMod: HlsClass | null | undefined;
let hls: HlsInstance | null = null;
let tuneToken = 0;
let failTimer = 0;
let stallTimer = 0;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let master: GainNode | null = null;
let streamGain: GainNode | null = null;
let normGain: GainNode | null = null;
let noiseGain: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let td: Float32Array<ArrayBuffer> | null = null;

let normOn = false;
let volume = 0.8;
let muted = false;
let fxOn = false;
/** 原站 gn：静电剩余秒数（换台时 wn(.9) 顶上去） */
let staticLeft = 0;
let ms = 0;
let msT = 0;

type Listener = (s: PlayState) => void;
const listeners = new Set<Listener>();

export type PlayState = "idle" | "loading" | "playing" | "paused" | "error" | "blocked";

function emit(s: PlayState) {
  listeners.forEach((f) => f(s));
}

export function onPlayState(f: Listener): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/* ---------- 图与元素 ---------- */

function ensureGraph() {
  if (elB) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;
    master = ctx.createGain();
    master.connect(ctx.destination);
    streamGain = ctx.createGain();
    streamGain.connect(master);
    normGain = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -3;
    comp.knee.value = 3;
    comp.ratio.value = 20;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    analyser.connect(normGain);
    normGain.connect(comp);
    comp.connect(streamGain);
    td = new Float32Array(analyser.fftSize);
    /* 静电：2 秒白噪循环 → 带通 2200/Q.5 → noiseGain（原站同款，靠增益开关） */
    const n = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, n, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 0.5;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    ns.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(master);
    ns.start();
    window.setInterval(() => {
      const t = ctx!.currentTime;
      normalize(t - normLast);
      normLast = t;
    }, 100);
  } catch {
    ctx = null;
    analyser = null;
  }
  elA = mkEl("A");
  elB = mkEl("B");
}

/** 原站 mkEl：A 接分析器，B 直出；两者共用一套事件语义 */
function mkEl(kind: "A" | "B"): HTMLAudioElement {
  const el = new Audio();
  el.preload = "none";
  if (kind === "A" && ctx && analyser) {
    try {
      el.crossOrigin = "anonymous";
      ctx.createMediaElementSource(el).connect(analyser);
    } catch {
      el.crossOrigin = "";
    }
  }
  el.addEventListener("playing", () => {
    if (el !== cur()) return;
    live = true;
    paused = false;
    window.clearTimeout(failTimer);
    window.clearTimeout(stallTimer);
    dropHold();
    emit("playing");
  });
  el.addEventListener("waiting", () => {
    if (el !== cur()) return;
    live = false;
    emit("loading");
  });
  el.addEventListener("pause", () => {
    if (el !== cur()) return;
    live = false;
    paused = true;
    emit("paused");
  });
  /* 播放中途断流/卡顿：12 秒内进度不走就切换线路（A→B）或触发换台 */
  const armStall = () => {
    if (el !== cur() || paused) return;
    window.clearTimeout(stallTimer);
    const t0 = el.currentTime;
    stallTimer = window.setTimeout(() => {
      if (el !== cur() || paused) return;
      if (el.currentTime - t0 < 0.5) failStream();
    }, 12000);
  };
  el.addEventListener("waiting", armStall);
  el.addEventListener("stalled", armStall);
  el.addEventListener("error", () => {
    if (el !== cur() || !el.getAttribute("src")) return;
    // HLS 的失败统一走 hls.js 的 ERROR 事件，避免同一次失败被处理两遍
    if (hls) return;
    failStream();
  });
  return el;
}

/* ---------- 备用元素池 / hold / 预载（原站 spareA / spareB / hold / pre） ---------- */

const POOL_MAX = 2;
const poolA: HTMLAudioElement[] = [];
const poolB: HTMLAudioElement[] = [];
let holdEl: HTMLAudioElement | null = null;
let holdKind: "A" | "B" = "A";
let preEl: HTMLAudioElement | null = null;
let preUrl = "";
let preKind: "A" | "B" = "A";

function recycle(el: HTMLAudioElement, kind: "A" | "B") {
  try {
    el.pause();
    el.removeAttribute("src");
    el.load();
  } catch {
    /* ignore */
  }
  const pool = kind === "A" ? poolA : poolB;
  if (pool.length < POOL_MAX && !pool.includes(el)) pool.push(el);
}

function takeEl(kind: "A" | "B"): HTMLAudioElement {
  const pool = kind === "A" ? poolA : poolB;
  return pool.pop() ?? mkEl(kind);
}

/** 新台出声后，旧台才可以停 */
function dropHold() {
  if (!holdEl) return;
  const h = holdEl;
  const k = holdKind;
  holdEl = null;
  recycle(h, k);
}

function dropPre() {
  if (!preEl) return;
  const p = preEl;
  const k = preKind;
  preEl = null;
  preUrl = "";
  recycle(p, k);
}

/** 原站 preload / preStart：把准星锁定的台先缓冲进空闲元素，换台时直接接管 */
export function preload(url: string) {
  if (!url) return;
  ensureGraph();
  if (url === curUrl || url === preUrl) return;
  const kind: "A" | "B" = analyser && !aFailed ? "A" : "B";
  dropPre();
  const el = takeEl(kind);
  el.preload = "auto";
  el.src = url;
  try {
    el.load();
  } catch {
    /* ignore */
  }
  preEl = el;
  preUrl = url;
  preKind = kind;
}

/* ---------- HLS（原站 oA / hlsJs） ---------- */

const isHlsUrl = (u: string) => /\.m3u8($|\?)/i.test(u);

async function ensureHls(): Promise<HlsClass | null> {
  if (hlsMod !== undefined) return hlsMod;
  try {
    hlsMod = (await import("hls.js")).default;
  } catch {
    hlsMod = null;
  }
  return hlsMod ?? null;
}

function destroyHls() {
  if (!hls) return;
  try {
    hls.destroy();
  } catch {
    /* ignore */
  }
  hls = null;
}

/** 原站 failTimer：9 秒还没有声音就判这条线路失败 */
function armFail() {
  window.clearTimeout(failTimer);
  failTimer = window.setTimeout(() => {
    if (!live && !paused) failStream();
  }, 9000);
}

/** 原站 fail()：A 失败→换 B；B 也失败→报错（上层自动换台） */
function failStream() {
  destroyHls();
  window.clearTimeout(failTimer);
  if (mode === "A") {
    aFailed = true;
    mode = "B";
    elA?.pause();
    void loadOn(elB!, curUrl);
    return;
  }
  live = false;
  paused = true;
  dropHold();
  emit("error");
}

function loadOn(el: HTMLAudioElement, url: string): Promise<void> {
  const token = ++tuneToken;
  el.removeAttribute("src");
  try {
    el.load();
  } catch {
    /* ignore */
  }
  setLevels();
  if (!isHlsUrl(url)) {
    el.src = url;
    armFail();
    return el.play().catch(() => {
      if (token === tuneToken) emit("blocked");
      return undefined;
    });
  }
  return startHls(token, url, el);
}

async function startHls(token: number, url: string, el: HTMLAudioElement): Promise<void> {
  const Hls = await ensureHls();
  if (token !== tuneToken) return;
  if (!Hls || !Hls.isSupported()) {
    el.src = url;
    armFail();
    return el.play().catch(() => {
      if (token === tuneToken) emit("blocked");
    });
  }
  const h = new Hls();
  hls = h;
  h.on(Hls.Events.ERROR, (_ev, data) => {
    if (!data?.fatal || token !== tuneToken || el !== cur()) return;
    failStream();
  });
  h.loadSource(url);
  h.attachMedia(el);
  armFail();
  return el.play().catch((e: DOMException) => {
    if (token !== tuneToken) return;
    if (e?.name === "NotAllowedError") {
      paused = true;
      emit("blocked");
    }
  });
}

function cur(): HTMLAudioElement | null {
  return mode === "A" ? elA : mode === "B" ? elB : null;
}

export function getAudio(): HTMLAudioElement {
  ensureGraph();
  return cur() ?? elB!;
}

/* ---------- 音量 / 静音 / 静电（原站 setLevels，渲染循环每帧调用） ---------- */

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  setLevels();
}

export function setMuted(m: boolean) {
  muted = m;
  setLevels();
}

/** A 走音频图（streamGain 控音量），B 是普通元素（自身 volume 控音量） */
export function setLevels(): number {
  const v = muted || paused ? 0 : volume;
  const a = fxOn && staticLeft > 0 ? 0.08 : 0;
  if (elB) elB.volume = Math.min(1, Math.max(0, v));
  if (ctx && streamGain) {
    const now = ctx.currentTime;
    noiseGain?.gain.setTargetAtTime(a * v, now, 0.05);
    streamGain.gain.setTargetAtTime(v, now, 0.08);
  }
  return paused ? 0 : a;
}

/* ---------- 响度归一（原站 normalize：RMS → normGain） ---------- */

export function setNorm(on: boolean) {
  normOn = on;
  ms = 0;
  msT = 0;
  if (ctx && normGain) normGain.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
}

export function isNorm(): boolean {
  return normOn;
}

let normLast = 0;

function normalize(dt: number) {
  if (!normOn || !live || paused || mode !== "A" || dt <= 0) return;
  if (!analyser || !td || !ctx || !normGain) return;
  analyser.getFloatTimeDomainData(td);
  let sum = 0;
  for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
  const mean = sum / td.length;
  if (mean < 1e-5) return;
  ms = msT === 0 ? mean : ms + (mean - ms) * Math.min(1, dt / (msT < 4 ? 1 : 6));
  msT += dt;
  const g = Math.min(3, Math.max(0.5, 0.18 / Math.sqrt(ms)));
  normGain.gain.setTargetAtTime(g, ctx.currentTime, msT < 4 ? 0.4 : 1.5);
}

/* ---------- 调台静电 ---------- */

export function setFx(on: boolean) {
  fxOn = on;
}

export function isFx(): boolean {
  return fxOn;
}

/** 原站 wn(.9)：换台时把静电计时顶上去，噪声环带通增益自然淡入淡出 */
export function playTuningFx(sec = 0.9) {
  staticLeft = Math.max(staticLeft, sec);
}

/** 原站 gn=Math.max(0,gn-e) */
export function tickStatic(dt: number) {
  staticLeft = Math.max(0, staticLeft - dt);
}

/* ---------- 播放控制 ---------- */

export function loadAndPlay(url: string): Promise<void> {
  ensureGraph();
  curUrl = url;
  live = false;
  const kind: "A" | "B" = analyser && !aFailed ? "A" : "B";
  const prev = mode ? cur() : null;
  dropHold();
  /* 旧台还在响就留在 hold 里继续出声，等新台 playing 再回收 */
  if (prev && mode === kind && !prev.paused && prev.getAttribute("src")) {
    holdEl = prev;
    holdKind = kind;
  } else if (prev) {
    recycle(prev, mode as "A" | "B");
  }
  let el: HTMLAudioElement;
  if (preEl && preUrl === url && preKind === kind) {
    el = preEl;
    preEl = null;
    preUrl = "";
  } else {
    dropPre();
    el = takeEl(kind);
  }
  mode = kind;
  if (kind === "A") elA = el;
  else elB = el;
  destroyHls();
  window.clearTimeout(failTimer);
  paused = false;
  setLevels();
  if (ctx && ctx.state === "suspended") ctx.resume();
  emit("loading");
  return loadOn(el, url);
}

export function resumePlay(): Promise<void> {
  ensureGraph();
  const el = cur() ?? elB!;
  paused = false;
  setLevels();
  if (ctx && ctx.state === "suspended") ctx.resume();
  emit("loading");
  armFail();
  return el.play().catch(() => emit("blocked"));
}

export function pauseAudio() {
  paused = true;
  window.clearTimeout(failTimer);
  dropHold();
  setLevels();
  cur()?.pause();
}

export function currentState(): PlayState {
  const a = cur();
  if (!a) return "idle";
  if (a.error) return "error";
  if (!a.src) return "idle";
  if (a.paused) return a.readyState < 3 ? "idle" : "paused";
  return "playing";
}

/* ---------- 频谱分析（原站 Bn：256 段对数频带 + 256×64 瀑布纹理） ---------- */

const FFT_W = 256;
const FFT_H = 64;
const fftData = new Uint8Array(FFT_W * FFT_H);
const tmpBands = new Float32Array(FFT_W);
const bandEdges = new Float64Array(FFT_W + 1);
for (let i = 0; i <= FFT_W; i++) bandEdges[i] = 32 * Math.pow(500, i / FFT_W);
let freqBuf: Uint8Array<ArrayBuffer> | null = null;
let autoGain = 0.5;
let bass = 0;
let level = 0;
let histAcc = 0;

/** 每帧调用：刷新频带、瀑布纹理行、bass 与 uLevel（公式照抄原站） */
/** 没有可用的真实 FFT 时，用节拍合成一条频谱，让画面仍然“随音乐起伏” */
function synthSpectrum(x: number, time: number, playing: boolean): number {
  const amp = playing ? 1 : 0.25;
  const beat = Math.pow(0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 1.7), 3);
  const beat2 = Math.pow(0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 0.85 + 1.2), 2);
  const low = Math.exp(-x * 5.5) * (0.28 + 0.55 * beat + 0.18 * beat2);
  const mid = Math.exp(-Math.pow((x - 0.34) / 0.16, 2)) * (0.16 + 0.26 * beat2) * (0.7 + 0.3 * Math.sin(time * 6 + x * 12));
  const high = Math.exp(-Math.pow((x - 0.62) / 0.3, 2)) * 0.1 * (0.5 + 0.5 * Math.sin(time * 9 + x * 40));
  return Math.min(1, amp * (low + mid + high));
}

export function updateSpectrum(dt: number, time: number) {
  const real = isReal();
  if (real && analyser) {
    if (!freqBuf) freqBuf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqBuf);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    let peak = 0;
    for (let t = 0; t < FFT_W; t++) {
      const i0 = Math.max(1, (bandEdges[t] / binHz) | 0);
      const i1 = Math.max(i0 + 1, (bandEdges[t + 1] / binHz) | 0);
      let n = 0;
      for (let i = i0; i < i1 && i < freqBuf.length; i++) if (freqBuf[i] > n) n = freqBuf[i];
      const o = Math.pow(Math.max(0, n / 255 - 0.18) / 0.82, 1.5) * (1 + (t / FFT_W) * 0.9);
      tmpBands[t] = o;
      if (o > peak) peak = o;
    }
    autoGain += (Math.max(peak, 0.25) - autoGain) * (peak > autoGain ? 0.08 : 0.01);
    if (peak < 0.01) {
      // 有分析器但音频静音/被静音：用合成频谱保持律动
      let sb = 0;
      for (let e = 0; e < FFT_W; e++) {
        const v = synthSpectrum(e / FFT_W, time, live);
        fftData[e] = v * 255;
        if (e < 40) sb += v;
      }
      bass += (sb / 40 - bass) * 0.25;
      histAcc += dt;
      if (histAcc > 0.095) { histAcc = 0; fftData.copyWithin(FFT_W, 0, FFT_W * (FFT_H - 1)); }
      level += ((live ? 0.75 : 0.2) - level) * 0.06;
      return;
    }
    let bs = 0;
    for (let e = 0; e < FFT_W; e++) {
      const v = Math.min(1, (tmpBands[e] * 0.8) / autoGain);
      fftData[e] = v * 255;
      if (e < 40) bs += v;
    }
    bass += (bs / 40 - bass) * 0.3;
    // blendSynth：真实频谱偏安静时，叠加一条合成节拍，保证唱片/山脉仍有起伏
    if (live) {
      const quiet = peak < 0.15 ? 1 : 0.32;
      let sb2 = 0;
      for (let e = 0; e < FFT_W; e++) {
        const sv = synthSpectrum(e / FFT_W, time, true) * 0.9 * quiet;
        const cur = fftData[e] as number;
        if (sv * 255 > cur) fftData[e] = sv * 255;
        if (e < 40) sb2 += (fftData[e] as number) / 255;
      }
      bass += (sb2 / 40 - bass) * 0.25;
    }
  } else {
    let sb = 0;
    for (let e = 0; e < FFT_W; e++) {
      const v = synthSpectrum(e / FFT_W, time, live);
      fftData[e] = v * 255;
      if (e < 40) sb += v;
    }
    bass += (sb / 40 - bass) * 0.25;
  }
  histAcc += dt;
  if (histAcc > 0.095) {
    histAcc = 0;
    fftData.copyWithin(FFT_W, 0, FFT_W * (FFT_H - 1));
  }
  const target = real ? 1 : live ? 0.5 : 0.15;
  level += (target - level) * 0.05;
}

export const getFftData = () => fftData;
export const getBass = () => bass;
export const getLevel = () => level;
/** 原站 l.real：正在播放且走的是带分析器的 A 元素 */
export const isReal = () => live && mode === "A";
export const isLiveAudio = () => live;
export const isStalled = () => stallTimer !== 0;

if (typeof window !== "undefined") {
  (window as any).__rdAudio = { getBass, getLevel, isReal, isLiveAudio, currentState, loadAndPlay };
}
