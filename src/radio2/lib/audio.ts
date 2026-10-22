/* 音频引擎：播放唯一控制点
 * - 双元素策略照抄原站 web 引擎：A 元素 crossOrigin=anonymous 并接入
 *   MediaElementSource → AnalyserNode，能拿到真实频谱；A 失败（流无 CORS）
 *   自动退回普通 B 元素直出，播放不受影响、只是没有频谱
 * - 音量 / 静音统一在这里落地并持久化
 * - 调台音效：独立的 WebAudio 静电 burst，不接入播放流，无 CORS 风险
 */

let elA: HTMLAudioElement | null = null;
let elB: HTMLAudioElement | null = null;
let mode: "A" | "B" | "" = "";
let curUrl = "";
let aFailed = false;
let live = false;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let master: GainNode | null = null;
let streamGain: GainNode | null = null;
let normGain: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;

let normOn = false;
let volume = 0.8;
let muted = false;
let fxOn = false;
let staticUntil = 0;

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

function applyVol(el: HTMLAudioElement) {
  el.volume = volume;
  el.muted = muted;
}

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
  } catch {
    ctx = null;
    analyser = null;
  }
  elA = new Audio();
  elA.preload = "none";
  if (ctx && analyser) {
    try {
      elA.crossOrigin = "anonymous";
      ctx.createMediaElementSource(elA).connect(analyser);
    } catch {
      elA.crossOrigin = "";
    }
  }
  elB = new Audio();
  elB.preload = "none";
  for (const el of [elA, elB]) {
    el.addEventListener("playing", () => {
      if (el !== cur()) return;
      live = true;
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
      emit("paused");
    });
    el.addEventListener("error", () => {
      if (el !== cur() || !el.getAttribute("src")) return;
      if (el === elA && mode === "A") {
        // 无 CORS 的流：A 元素必然失败，退回 B 直出（原站同款回退）
        aFailed = true;
        mode = "B";
        elA.pause();
        const b = elB!;
        b.src = curUrl;
        applyVol(b);
        b.play().catch(() => emit("error"));
        return;
      }
      live = false;
      emit("error");
    });
  }
}

function cur(): HTMLAudioElement | null {
  return mode === "A" ? elA : mode === "B" ? elB : null;
}

export function getAudio(): HTMLAudioElement {
  ensureGraph();
  return cur() ?? elB!;
}

/* ---------- 音量 ---------- */

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (elA) applyVol(elA);
  if (elB) applyVol(elB);
}

export function setMuted(m: boolean) {
  muted = m;
  if (elA) applyVol(elA);
  if (elB) applyVol(elB);
}

/* ---------- 响度归一（原站 setNorm：只重置自动增益） ---------- */

export function setNorm(on: boolean) {
  normOn = on;
  if (ctx && normGain) normGain.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
}

export function isNorm(): boolean {
  return normOn;
}

/* ---------- 调台音效（静电 burst，独立图） ---------- */

export function setFx(on: boolean) {
  fxOn = on;
}

export function isFx(): boolean {
  return fxOn;
}

/** 换台时响一下电台杂音；同时点亮颗粒层的静电（原站 wn(.8)） */
export function playTuningFx() {
  if (!fxOn) return;
  staticUntil = performance.now() + 800;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const dur = 0.22;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // 静电噪声 + 指数衰减包络
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * 0.16;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start();
  } catch {
    /* 无音频环境时静默失败 */
  }
}

/** 颗粒层静电强度（原站 setLevels 返回 fx&&静电计时 ? .08 : 0） */
export function getStaticLevel(): number {
  return fxOn && performance.now() < staticUntil ? 0.08 : 0;
}

/* ---------- 播放控制 ---------- */

export function loadAndPlay(url: string): Promise<void> {
  ensureGraph();
  curUrl = url;
  mode = analyser && !aFailed ? "A" : "B";
  const el = cur()!;
  const other = el === elA ? elB : elA;
  other?.pause();
  el.src = url;
  applyVol(el);
  // 直连失败（CORS/混合内容/地区限制）时，自动改用本站代理重试一次
  const directUrl = url;
  el.onerror = () => {
    if (el !== cur()) return;
    if (!directUrl.startsWith("/api/radio/stream")) {
      const proxied = "/api/radio/stream?u=" + encodeURIComponent(directUrl);
      console.log("[radio2] 直连失败，改用代理重试");
      loadAndPlay(proxied);
    } else {
      emit("error");
    }
  };
  if (ctx && ctx.state === "suspended") ctx.resume();
  emit("loading");
  return el.play().catch(() => emit("blocked"));
}

export function resumePlay(): Promise<void> {
  ensureGraph();
  const el = cur() ?? elB!;
  applyVol(el);
  if (ctx && ctx.state === "suspended") ctx.resume();
  emit("loading");
  return el.play().catch(() => emit("blocked"));
}

export function pauseAudio() {
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
    let bs = 0;
    for (let e = 0; e < FFT_W; e++) {
      const v = Math.min(1, (tmpBands[e] * 0.8) / autoGain);
      fftData[e] = v * 255;
      if (e < 40) bs += v;
    }
    bass += (bs / 40 - bass) * 0.3;
  } else {
    const base = (live ? 0.08 : 0.04) * (1 + 0.02 * Math.sin(time * 1.2));
    const bv = Math.round(base * 255);
    for (let e = 0; e < FFT_W; e++) fftData[e] = bv;
    bass += (0 - bass) * 0.1;
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

// 诊断入口（浏览器控制台可查频谱/低音是否工作）
if (typeof window !== "undefined") {
  (window as any).__rdAudio = { getBass, getLevel, isReal, isLiveAudio, currentState, loadAndPlay };
}
