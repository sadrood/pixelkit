"use client";

import { useEffect, useRef } from "react";
import type { Station, StationMeta } from "../lib/stations";
import { reducedMotion } from "../lib/motion";

/* ------------------------------------------------------------------ */
/*  唱片视图（Record View / dive）                                       */
/*  换台后 10 秒无操作、或闲置 30 秒自动进入；碰一下回到原处。            */
/*  10 种效果参数化到同一渲染器：圆盘/星球/山脉/雷达/星系/电波/            */
/*  脉冲星/光环/按流派/随机。                                            */
/* ------------------------------------------------------------------ */

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

/* 原站 gA()：轻效果池 + 重效果池，按「画质档」决定可用范围，
   genre 走两张 11 流派对照表，random 从池中排除上一个效果再取。 */
const LIGHT_FORMS: DiveForm[] = ["disc", "orb", "field"];
const HEAVY_FORMS: DiveForm[] = ["radar", "galaxy", "waves", "pulsar", "ring"];
/** 11 个流派 → 轻档效果 */
const GENRE_LIGHT: DiveForm[] = [
  "field", "field", "field", "disc", "disc", "orb", "field", "disc", "field", "disc", "disc",
];
/** 11 个流派 → 高画质档效果 */
const GENRE_HEAVY: DiveForm[] = [
  "field", "radar", "ring", "disc", "pulsar", "waves", "field", "disc", "galaxy", "disc", "orb",
];

export type ResolvedForm = Exclude<DiveForm, "genre" | "random">;

/**
 * @param form   设置里的偏好（genre / random / 具体效果）
 * @param genre  电台流派索引
 * @param pro    高画质档：省电模式下只允许 3 种轻效果（对齐原站 fA / mA 分支）
 * @param prev   上一个效果，random 时排除，避免连着几次都是同一个
 */
export function resolveForm(
  form: DiveForm,
  genre: number,
  pro = true,
  prev?: ResolvedForm | null,
): ResolvedForm {
  const pool = pro ? [...LIGHT_FORMS, ...HEAVY_FORMS] : LIGHT_FORMS;
  if (form === "random") {
    const cand = pool.filter((f) => f !== prev);
    return cand[Math.floor(Math.random() * cand.length)] as ResolvedForm;
  }
  if (pool.includes(form)) return form as ResolvedForm;
  return ((pro ? GENRE_HEAVY : GENRE_LIGHT)[genre] ?? "disc") as ResolvedForm;
}

export interface RecordViewProps {
  station: Station;
  meta: StationMeta;
  form: DiveForm;
  /** 高画质档（省电模式下为 false，只剩 3 种轻效果） */
  pro: boolean;
  playing: boolean;
}

/** 上一次实际用到的效果，供 random 排除 */
let lastResolved: ResolvedForm | null = null;

export function RecordView({ station, meta, form, pro, playing }: RecordViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resolved = resolveForm(form, station.genre, pro, lastResolved);
  lastResolved = resolved;
  const color = meta.genreColors[station.genre] ?? "#f36b45";
  const colorRef = useRef(color);
  colorRef.current = color;
  const formRef = useRef(resolved);
  formRef.current = resolved;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  /* 原站唱片态里点盘面什么都不做（Er 里 We||Ar(...)：We 为真时连拾取都跳过），
     滚轮是缩放唱片（Sr 的 We 分支），退出只有 Esc/e/E/Enter、← 返回 与换台 qn() 这几条路，
     所以这里不再挂「任意输入退出」，否则 diveNav 与整套唱片态键位全被吃掉 */

  /* 渲染循环 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    /* 粒子（星系/电波复用） */
    const N = 900;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      px[i] = Math.cos(a) * r;
      py[i] = Math.sin(a) * r;
      pz[i] = Math.random();
    }

    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      // 减弱动效：时间轴冻结，只保留一帧静态画面（尺寸变化时仍会重绘）
      if (!reducedMotion()) t = ms * 0.001;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.32;
      const col = colorRef.current;
      const fm = formRef.current;
      const live = playingRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#101f1d";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(cx, cy);

      const beat = live ? 1 + 0.06 * Math.sin(t * 2.2) : 1;

      if (fm === "disc") {
        /* 圆盘：同心纹路旋转 */
        ctx.rotate(t * 0.25);
        for (let i = 0; i < 26; i++) {
          const r = R * (0.18 + (i / 26) * 0.95) * beat;
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.1 + 0.5 * (1 - i / 26);
          ctx.lineWidth = i % 4 === 0 ? 1.6 : 0.7;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.1 * beat, 0, Math.PI * 2);
        ctx.fill();
        // 唱臂
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#f5f1e8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.02, -0.6, 0.5);
        ctx.stroke();
      } else if (fm === "orb") {
        /* 星球：脉冲球体 + 光环 */
        const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * beat);
        g.addColorStop(0, col);
        g.addColorStop(0.7, col + "44");
        g.addColorStop(1, "#101f1d00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R * beat, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(0, 0, R * (1.15 + i * 0.18) * beat, R * 0.22, t * 0.3 + i, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (fm === "field") {
        /* 山脉：多层起伏曲线 */
        for (let layer = 0; layer < 5; layer++) {
          ctx.globalAlpha = 0.16 + layer * 0.12;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          const amp = R * (0.1 + layer * 0.09);
          const yBase = R * (0.55 - layer * 0.22);
          for (let x = -w; x <= w; x += 8) {
            const y =
              yBase +
              Math.sin(x * 0.004 + t * 0.6 + layer * 1.7) * amp +
              Math.sin(x * 0.011 + t * 0.3 + layer) * amp * 0.4;
            if (x === -w) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (fm === "radar") {
        /* 雷达：扫描扇形 + 网格 */
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = col;
        for (let i = 1; i <= 4; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, (R * i) / 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        const sweep = (t * 0.8) % (Math.PI * 2);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R * beat, sweep - 0.5, sweep);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sweep) * R * beat, Math.sin(sweep) * R * beat);
        ctx.stroke();
      } else if (fm === "galaxy") {
        /* 星系：金色角螺旋粒子 */
        const GA = 2.399963;
        for (let i = 0; i < N; i++) {
          const r = Math.sqrt((i + 0.5) / N) * R * 1.25 * beat;
          const a = i * GA + t * 0.12;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r * 0.72;
          ctx.globalAlpha = 0.14 + 0.5 * pz[i];
          ctx.fillStyle = i % 7 === 0 ? "#f5f1e8" : col;
          const s = 0.6 + pz[i] * 1.6;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      } else if (fm === "waves") {
        /* 电波：横向正弦带 */
        for (let b = 0; b < 7; b++) {
          ctx.globalAlpha = 0.5 - b * 0.05;
          ctx.strokeStyle = b % 2 ? "#f5f1e8" : col;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const yBase = (b - 3) * R * 0.16;
          for (let x = -w / 2; x <= w / 2; x += 6) {
            const y =
              yBase +
              Math.sin(x * 0.012 + t * (1.2 + b * 0.18)) * R * 0.1 * (live ? 1.3 : 0.7) +
              Math.sin(x * 0.03 - t * 0.7) * R * 0.03;
            if (x === -w / 2) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (fm === "pulsar") {
        /* 脉冲星：对向旋转光束 */
        for (let i = 0; i < 2; i++) {
          const a = t * (i ? -0.9 : 0.9);
          const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * R * 1.6, Math.sin(a) * R * 1.6);
          grad.addColorStop(0, col);
          grad.addColorStop(1, "#101f1d00");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2.4;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * R * 1.6 * beat, Math.sin(a) * R * 1.6 * beat);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#f5f1e8";
        ctx.beginPath();
        ctx.arc(0, 0, 5 * beat, 0, Math.PI * 2);
        ctx.fill();
      } else {
        /* ring 光环：扩散同心圆 */
        for (let i = 0; i < 5; i++) {
          const phase = (t * 0.35 + i / 5) % 1;
          ctx.globalAlpha = (1 - phase) * 0.55;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2 - phase * 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, phase * R * 1.5 * beat, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.07 * beat, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="rv" data-testid="record-view">
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0 }} />
    </div>
  );
}
