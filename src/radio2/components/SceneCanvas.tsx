"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Station, StationMeta } from "../lib/stations";
import { reducedMotion } from "../lib/motion";
import { t } from "../lib/i18n";
import {
  DIVE_N,
  DIVE_CFG,
  diveGeo,
  diveSeeds,
  originCloud,
  resolveForm,
  type DiveForm,
  type DiveGeo,
  type DiveKey,
  type ResolvedForm,
} from "../lib/dive";
import {
  updateSpectrum,
  getFftData,
  getBass,
  getLevel,
  setLevels,
  tickStatic,
  isReal,
  isLiveAudio,
} from "../lib/audio";

/* ------------------------------------------------------------------ */
/*  场景（原站唯一一块画布）                                             */
/*  35,699 个电台在同一个 Points 里：position 是地球坐标，aNeb 是星云坐标，*/
/*  uView 在两者之间插值，每个点再按自己的随机数错峰（原站 oe() / IN）。   */
/*  拖拽/滚轮/点击/准星扫描在两种视图下都用当前视图的坐标（原站 jt()）。   */
/* ------------------------------------------------------------------ */

const R = 100;
const U = 1.6; // 原站球半径，所有距离都按 U 换算
const S = R / U;
const BG = 0x101f1d;
const PITCH_MAX = 1.45;
const DEG = Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** 原站 ZN(lat, lng, r, out, o) */
function latLng(lat: number, lng: number, radius: number, out: Float32Array, o: number) {
  const a = (90 - lat) * DEG;
  const b = (lng + 180) * DEG;
  out[o] = -radius * Math.sin(a) * Math.cos(b);
  out[o + 1] = radius * Math.cos(a);
  out[o + 2] = radius * Math.sin(a) * Math.sin(b);
}

/** 原站 $N(seed) */
function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let e = t;
    e = Math.imul(e ^ (e >>> 15), e | 1);
    e ^= e + Math.imul(e ^ (e >>> 7), e | 61);
    return ((e ^ (e >>> 14)) >>> 0) / 4294967296;
  };
}

/** 原站 eP(r)：Box-Muller */
function gauss(rnd: () => number) {
  const t = rnd() || 1e-6;
  const n = rnd();
  return Math.sqrt(-2 * Math.log(t)) * Math.cos(2 * Math.PI * n);
}

interface Layout {
  globe: Float32Array;
  neb: Float32Array;
  /** 原站 aRing：贴近停稳后，环内电台重排成盘的位置（按需填充） */
  ring: Float32Array;
  den: Float32Array;
  info: Float32Array;
  anchors: { x: number; y: number; z: number; r: number }[];
}

/** 原站 oe()：地球坐标 + 星云坐标一次算完 */
function buildLayout(stations: Station[], meta: StationMeta): Layout {
  const n = stations.length;
  const globe = new Float32Array(n * 3);
  const neb = new Float32Array(n * 3);
  const den = new Float32Array(n);
  const info = new Float32Array(n * 4);
  const cells = new Map<number, number>();
  const counts = new Array(meta.genres.length || 11).fill(0);
  for (const s of stations) {
    const k = Math.floor(s.lat * 2) * 1000 + Math.floor(s.lng * 2);
    cells.set(k, (cells.get(k) ?? 0) + 1);
    counts[s.genre] = (counts[s.genre] ?? 0) + 1;
  }
  const G = counts.length;
  const maxC = Math.max(1, ...counts);
  const anchors: { x: number; y: number; z: number; r: number }[] = [];
  for (let g = 0; g < G; g++) {
    const t = (g / G) * Math.PI * 2 + 0.3;
    const rad = 3 + (g % 2) * 0.9;
    anchors.push({
      x: Math.cos(t) * rad,
      y: Math.sin(g * 1.9) * 0.7,
      z: Math.sin(t) * rad,
      r: 0.35 + 0.95 * Math.sqrt(counts[g] / maxC),
    });
  }
  const rnd = prng(7);
  const sMax = Math.max(44, meta.langs.length);
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    latLng(s.lat, s.lng, R * 1.004, globe, i * 3);
    const k = Math.floor(s.lat * 2) * 1000 + Math.floor(s.lng * 2);
    den[i] = 1 / (1 + Math.sqrt(Math.max(0, (cells.get(k) ?? 1) - 1)) * 0.6);
    const a = anchors[s.genre] ?? anchors[0];
    const lang = s.lang;
    const o = 1 - ((lang + 0.5) / sMax) * 2;
    const l = Math.sqrt(Math.max(0, 1 - o * o));
    const u = lang * GOLDEN * 3.1;
    const d = a.r * 0.62 * (lang === 0 ? 0 : 1);
    neb[i * 3] = (a.x + Math.cos(u) * l * d + gauss(rnd) * a.r * 0.3) * S;
    neb[i * 3 + 1] = (a.y + o * d * 0.45 + gauss(rnd) * a.r * 0.16) * S;
    neb[i * 3 + 2] = (a.z + Math.sin(u) * l * d + gauss(rnd) * a.r * 0.3) * S;
    info[i * 4] = s.genre;
    info[i * 4 + 1] = s.pop;
    info[i * 4 + 2] = s.prec;
    info[i * 4 + 3] = rnd();
  }
  return {
    globe,
    neb,
    ring: new Float32Array(n * 3),
    den,
    info,
    anchors: anchors.map((a) => ({ x: a.x * S, y: a.y * S, z: a.z * S, r: a.r * S })),
  };
}

/* 原站 AN 噪声 + curl（涡流）；用于视图过渡时让点在半路散开 */
const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 sn3(vec3 p){return vec3(snoise(p),snoise(p+vec3(31.4,-17.2,9.1)),snoise(p+vec3(-7.7,23.9,-41.3)));}
vec3 curl(vec3 p){
  const float e=0.1;
  vec3 dx=vec3(e,0.0,0.0),dy=vec3(0.0,e,0.0),dz=vec3(0.0,0.0,e);
  vec3 px0=sn3(p-dx),px1=sn3(p+dx),py0=sn3(p-dy),py1=sn3(p+dy),pz0=sn3(p-dz),pz1=sn3(p+dz);
  return normalize(vec3(py1.z-py0.z-pz1.y+pz0.y,pz1.x-pz0.x-px1.z+px0.z,px1.y-px0.y-py1.x+py0.x)+1e-5);
}
`;

const DIVE_SC = S / 1.6;

const SIG_FN = `
/* 原站 NN：选台后的球面行进脉冲（5 秒一圈，只在原生宿主开启） */
float sig(vec3 p){
  if (uSigOn < 0.001) return 0.0;
  float ang = acos(clamp(dot(normalize(p), uSig), -1.0, 1.0));
  float ph = fract(uTime / 5.0);
  return exp(-pow((ang - ph) / 0.08, 2.0)) * smoothstep(0.03, 0.16, ph) * pow(1.0 - ph, 1.5) * uSigOn;
}
`;

const VERT = `
attribute vec3 aNeb;
attribute vec4 aInfo;
attribute vec2 aFlag;
attribute vec3 aRing;
attribute float aIdx;
attribute float aDen;
uniform float uTime, uView, uRingE, uPR, uSel, uIntro, uBoost, uLevel, uSigOn, uDive;
uniform vec3 uCol[11];
uniform vec3 uSig;
uniform sampler2D uFFT;
varying vec3 vCol;
varying float vA;
${NOISE}
${SIG_FN}
float ease(float t){ return t<0.5 ? 4.0*t*t*t : 1.0-pow(-2.0*t+2.0,3.0)/2.0; }
void main(){
  float sd = aInfo.w;
  float e = ease(clamp((uView - sd*0.4)/0.6, 0.0, 1.0));
  vec3 pos = mix(position, aNeb, e);
  float mid = sin(3.14159265*e);
  if (mid > 0.002) pos += curl(pos*0.35 + vec3(uTime*0.08, 0.0, sd*2.0)) * mid * (0.5 + sd*1.6);
  float ie = ease(clamp((uIntro - sd*0.5)/0.5, 0.0, 1.0));
  if (ie < 0.999) pos = mix(normalize(position + vec3(sd-0.5, fract(sd*13.1)-0.5, fract(sd*7.7)-0.5)*2.0) * (6.0 + sd*6.0) * ${S.toFixed(1)}, pos, ie);
  /* 原站 uRingE：贴近停稳后，环内电台沿相机朝向排成向日葵盘 */
  float rr = ease(uRingE) * aFlag.y;
  pos = mix(pos, aRing, rr);
  float m = aFlag.x;
  pos *= mix(0.975, 1.0, max(m, e));
  /* 原站：按电台自身 seed 去 FFT 纹理取一条频带，让点随音乐呼吸 */
  float ff = texture2D(uFFT, vec2(fract(sd*7.31)*0.85 + 0.02, 0.004)).r;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 wn = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  float face = smoothstep(-0.08, 0.28, dot(wn, normalize(cameraPosition)));
  float back = mix(mix(0.05, 1.0, face), 1.0, max(e, rr));
  float pop = aInfo.y / 9.0;
  float sel = 1.0 - step(0.5, abs(aIdx - uSel));
  float sg = sig(position) * (1.0 - e) * (1.0 - rr);
  float sz = (1.0 + sg*0.35) * (1.1 + pop*2.3) * (6.0 * ${S.toFixed(1)} / -mv.z) * mix(1.0, 2.6, rr) * mix(1.0, 2.1, e) * mix(0.6, uBoost, m) * (1.0 + ff*0.7*m*uLevel) + sel*(9.0 + uLevel*10.0);
  gl_PointSize = clamp(sz * uPR, 1.0, 46.0);
  vec3 gc = uCol[int(aInfo.x + 0.5)];
  vCol = mix(vec3(0.95, 0.9, 0.82), gc, mix(0.45, 1.0, max(e, rr)));
  vCol = mix(vCol, vec3(0.953, 0.420, 0.271), sel*0.9);
  float dn = mix(aDen, 1.0, max(e, rr));
  dn *= mix(1.0, 0.16, ease(uRingE) * (1.0 - aFlag.y));
  vA = (0.16 + pop*0.7) * mix(1.0, 1.25, e) * dn * back * mix(0.035, 1.0, m) * (1.0 + ff*uLevel) * ie + sel*1.6;
  vCol = mix(vCol, vec3(1.0, 0.78, 0.62), sg*0.35);
  vA *= 1.0 + sg * 0.7;
  vA *= 1.0 - uDive;
}
`;

const FRAG = `
varying vec3 vCol;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  gl_FragColor = vec4(vCol * vA * a, 1.0);
  #include <colorspace_fragment>
}
`;

/* 原站 BN / VN：唱片态（dive）点云。aFrom/aTo 各带亮度，aBand 是 FFT 取样行列 */
const DIVE_VERT = `
attribute vec4 aFrom;
attribute vec4 aTo;
attribute vec4 aSeed;
attribute vec4 aBand;
uniform float uTime, uProg, uFromMode, uToMode, uFromGain, uToGain, uFromPt, uToPt, uSize, uPR, uFocus, uAspect, uMouseF, uLevel;
uniform vec2 uMouse;
uniform sampler2D uFFT;
varying float vA;
varying float vAmp;
varying float vB;
varying float vHot;
${NOISE}
float dease(float t){ return t<0.5 ? 4.0*t*t*t : 1.0-pow(-2.0*t+2.0,3.0)/2.0; }
vec3 dirFor(float m, vec3 p){ return m < 0.5 ? normalize(p+1e-5) : vec3(0.0,1.0,0.0); }
void main(){
  float e = dease(clamp((uProg - aSeed.x*0.4)/0.6, 0.0, 1.0));
  vec3 pos = mix(aFrom.xyz, aTo.xyz, e);
  float bright = mix(aFrom.w, aTo.w, e);
  float mid = sin(3.14159265*e);
  if (mid > 0.002) {
    pos += curl(pos*0.45 + vec3(uTime*0.12, 0.0, aSeed.y*3.0)) * mid * (0.9 + aSeed.y*2.2);
    pos += normalize(aFrom.xyz + aTo.xyz + 1e-4) * mid * mid * (0.4 + aSeed.z*1.7);
  }
  float aF = texture2D(uFFT, vec2(aBand.x, aBand.y*0.97+0.004)).r;
  float aT = texture2D(uFFT, vec2(aBand.z, aBand.w*0.97+0.004)).r;
  float amp = mix(aF*uFromGain, aT*uToGain, e);
  float energy = clamp(uLevel, 0.0, 1.0);
  vec3 dir = normalize(mix(dirFor(uFromMode, pos), dirFor(uToMode, pos), e) + 1e-5);
  float rowShape = step(0.0005, mix(aBand.y, aBand.w, e));
  // 音乐越大，跳得越高（山脉/雷达等垂直形态收益更明显）
  pos += dir * amp * mix(0.35 + aSeed.w*0.65, 1.0, rowShape) * (0.65 + energy * 2.1);
  // 垂直形态：整体高度随低音缩放（安静时压低，响时隆起）
  float modeNow = mix(uFromMode, uToMode, e);
  pos.y *= mix(1.0, 0.42 + energy * 1.75, step(0.5, modeNow) * uProg);
  // 静止时不要抖动，只保留缓慢自转
  float alive = smoothstep(0.004, 0.14, amp);
  pos += vec3(sin(uTime*0.7+aSeed.y*40.0), cos(uTime*0.6+aSeed.z*40.0), sin(uTime*0.5+aSeed.x*40.0)) * 0.006 * alive;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 cl = projectionMatrix * mv;
  vec2 nd = cl.xy / cl.w;
  vec2 d = nd - uMouse;
  d.x *= uAspect;
  mv.xy += normalize(d + 1e-5) * smoothstep(0.22, 0.0, length(d)) * uMouseF * 0.22 * (-mv.z) * 0.16;
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float coc = abs(depth - uFocus);
  vec3 wn = normalize((modelMatrix * vec4(pos,0.0)).xyz + 1e-5);
  float face = smoothstep(-0.35, 0.35, dot(wn, normalize(cameraPosition - (modelMatrix*vec4(pos,1.0)).xyz)));
  float radial = 1.0 - min(1.0, mix(uFromMode, uToMode, e));
  float back = mix(1.0, 0.12 + 0.88*face, radial * (1.0 - mid));
  float sz = uSize * (0.55 + aSeed.w*0.9) * (1.0 + coc*coc*0.9) * (6.0/depth) * (1.0 + amp*0.9);
  gl_PointSize = clamp(sz * uPR, 1.0, 44.0);
  float pt = mix(uFromPt, 0.0, e) + mix(0.0, uToPt, e);
  vA = bright * back * (0.62 / (1.0 + coc*coc*3.0)) * (1.0 + amp*0.7) * (1.0 + mid*0.5) * mix(1.0, 0.004, clamp(pt, 0.0, 1.0));
  vAmp = amp;
  vB = aSeed.w;
  vHot = smoothstep(0.85, 1.6, bright);
}
`;

const DIVE_FRAG = `
uniform vec3 uBase;
uniform vec3 uAccA;
uniform vec3 uAccB;
uniform float uProg;
varying float vA;
varying float vAmp;
varying float vB;
varying float vHot;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  vec3 acc = mix(uAccA, uAccB, smoothstep(0.25, 0.75, uProg));
  vec3 col = mix(uBase, acc, clamp(vAmp*1.1 + vHot*0.8 + step(0.86, vB)*0.55, 0.0, 1.0))
    + vec3(1.0) * smoothstep(0.7, 1.2, vAmp) * 0.6;
  gl_FragColor = vec4(col * vA * a, 1.0);
  #include <colorspace_fragment>
}
`;

/* 原站 jN / MN：全屏程序化背景（星野 + 中心辉光 + 偶发流星），无球体网格 */
const BG_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const BG_FRAG = `
uniform float uAspect, uView, uDive, uTime, uLive;
uniform vec2 uTilt;
uniform vec3 uAcc;
varying vec2 vUv;
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float stars(vec2 q, float dens, float rad){
  vec2 c = floor(q);
  float h1 = hh(c);
  if (h1 > dens) return 0.0;
  vec2 o = vec2(hh(c+7.1), hh(c+13.7)) - 0.5;
  float d = length(fract(q) - 0.5 - o*0.6);
  float h2 = hh(c+3.3);
  float tw = mix(0.4, 0.75, uLive);
  return smoothstep(rad, 0.0, d) * (0.35 + 0.65*hh(c+5.9))
    * max(0.0, 1.0 - tw + tw*sin(uTime*(0.3+h2*1.2)*mix(1.0, 1.6, uLive) + h2*40.0));
}
void main(){
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float g = exp(-dot(p,p) * 3.0);
  vec3 c = vec3(0.0040,0.0098,0.0090)
    + mix(mix(vec3(0.0030,0.0072,0.0050), vec3(0.0022,0.0060,0.0072), uView), uAcc * 0.010, uDive) * g;
  vec2 s = vUv * vec2(uAspect, 1.0);
  float dr = mix(1.0, 2.6, uLive);
  float st = stars((s + uTilt*0.012)*70.0 + uTime*vec2(0.040,0.012)*dr, 0.10, 0.14)
    + stars((s + uTilt*0.03)*32.0 + uTime*vec2(0.050,0.015)*dr, 0.06, 0.09)*2.4;
  c += vec3(0.050,0.056,0.052) * st * (1.0 - uDive*0.35) * mix(1.0, 1.35, uLive);
  float mt = uTime / 14.0, mi = floor(mt), mf = fract(mt) * 14.0;
  if (uLive > 0.5 && mf < 1.1 && hh(vec2(mi, 0.7)) < 0.8) {
    vec2 h0 = vec2(uAspect * (0.35 + 0.6*hh(vec2(mi, 1.3))), 0.62 + 0.33*hh(vec2(mi, 7.9))) + uTilt*0.03;
    vec2 dir = normalize(vec2(-0.75 - 0.5*hh(vec2(mi, 3.1)), -0.42));
    float k = mf / 1.1;
    vec2 q = s - (h0 + dir * k * 0.55);
    float along = dot(q, -dir), across = abs(q.x*dir.y - q.y*dir.x);
    c += vec3(0.30,0.30,0.27) * step(0.0, along) * (1.0 - smoothstep(0.0, 0.16, along))
      * (1.0 - smoothstep(0.0, 0.0022, across)) * sin(3.14159*k) * (1.0 - uDive);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/* 原站 RN / zN：色散 + 暗角 + 颗粒，作为 composer 最后一个 ShaderPass（OutputPass 之前） */
const GRAIN_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

const GRAIN_FRAG = `
uniform sampler2D tDiffuse;
uniform float uTime, uNoise;
uniform vec2 uRes;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 d = vUv - 0.5;
  float r2 = dot(d,d);
  vec2 o = d * (0.0014 + uNoise*0.006) * (0.4 + r2*3.0);
  vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
  c *= 1.0 - smoothstep(0.2, 0.8, r2) * 0.7;
  float g = h(vUv*uRes + fract(uTime*7.13)*100.0) - 0.5;
  c *= 1.0 + g * (0.2 + uNoise*0.9);
  c += max(g,0.0) * (0.0015 + uNoise*0.01);
  c += g * 0.0025 * (1.0 - smoothstep(0.0, 0.05, dot(c, vec3(0.333))));
  gl_FragColor = vec4(c, 1.0);
}
`;

/* 原站 PN / FN：/land-dots.json 的陆地小点层 */
const LAND_VERT = `
uniform float uPR, uTime, uSigOn;
uniform vec3 uSig;
varying float vF;
varying float vS;
${SIG_FN}
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 wn = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vF = smoothstep(-0.05, 0.35, dot(wn, normalize(cameraPosition)));
  vS = sig(position);
  gl_PointSize = 1.6 * uPR * (6.0 * ${S.toFixed(1)} / -mv.z) * (1.0 + vS * 0.4);
  gl_Position = projectionMatrix * mv;
}
`;

const LAND_FRAG = `
uniform float uA;
varying float vF;
varying float vS;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  if (length(c) > 0.5) discard;
  gl_FragColor = vec4((vec3(0.028, 0.040, 0.036) + vec3(0.06, 0.046, 0.035) * vS) * vF * uA, 1.0);
}
`;

export interface SceneCanvasProps {
  stations: Station[];
  meta: StationMeta;
  /** 目标视图：地球 / 流派星云 */
  view: "globe" | "sky";
  /** 流派筛选；不在集合内的整体压暗（原站 aFlag.x） */
  activeGenres: Set<number>;
  currentIdx: number | null;
  playing: boolean;
  /** 已进入（原站 ei）：环形唱片阵只在开始后出现 */
  started: boolean;
  lang: "zh" | "en";
  onNearest: (
    s: Station | null,
    dist: number,
    locked: boolean,
    km?: number,
    settled?: boolean
  ) => void;
  onPick: (s: Station) => void;
  onGrab?: () => void;
  zoomOnSwitch?: boolean;
  diving?: boolean;
  onDive?: () => void;
  /** 唱片态效果偏好（原站设置里的 diveForm） */
  diveForm?: DiveForm;
  /** 高画质档：省电模式只允许 3 种轻效果 */
  pro?: boolean;
  onError: () => void;
}

export function SceneCanvas({
  stations,
  meta,
  view,
  activeGenres,
  currentIdx,
  playing,
  started,
  lang,
  onNearest,
  onPick,
  onGrab,
  zoomOnSwitch = true,
  diving = false,
  onDive,
  diveForm = "genre",
  pro = true,
  onError,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annRef = useRef<SVGSVGElement>(null);
  const propsRef = useRef({
    stations,
    meta,
    view,
    activeGenres,
    currentIdx,
    playing,
    started,
    lang,
    onNearest,
    onPick,
    onGrab,
    zoomOnSwitch,
    diving,
    onDive,
    diveForm,
    pro,
    onError,
  });
  propsRef.current = {
    stations,
    meta,
    view,
    activeGenres,
    currentIdx,
    playing,
    started,
    lang,
    onNearest,
    onPick,
    onGrab,
    zoomOnSwitch,
    diving,
    onDive,
    diveForm,
    pro,
    onError,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
      if (!renderer.getContext()) throw new Error("no ctx");
    } catch {
      propsRef.current.onError();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth > 1200 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);

    /* 原站 PerspectiveCamera(38, ...)，机位在 +z 轴，组绕自身原点转 */
    const camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / window.innerHeight,
      0.02 * S,
      100 * S
    );
    const vScale = () => Math.min(2, Math.max(1, 0.95 / camera.aspect));
    const skyDist = () =>
      Math.min(32, Math.max(10.5, 4.4 / (Math.tan(19 * DEG) * camera.aspect))) * S;
    const globeDist = () => 6.2 * vScale() * S;
    let camZ = 9 * vScale() * S;
    let camZNow = camZ;
    camera.position.set(0, 0, camZ);

    /* 后处理：原站 three EffectComposer（HalfFloat）→ RenderPass → UnrealBloom(.45/.55/.2)
       → 颗粒 ShaderPass → OutputPass；软件渲染只关 bloom（原站 ce.enabled=!m） */
    let softwareMode = false;
    let composer: EffectComposer | null = null;
    let bloom: UnrealBloomPass | null = null;
    let grain: ShaderPass | null = null;
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      const software = /swiftshader|software|basic render|llvmpipe/i.test(rendererName);
      softwareMode = software;
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(dpr);
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth * 0.6, window.innerHeight * 0.6),
        0.45,
        0.55,
        0.2
      );
      bloom.enabled = !software;
      composer.addPass(bloom);
      grain = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uTime: { value: 0 },
          uNoise: { value: 0 },
          uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        },
        vertexShader: GRAIN_VERT,
        fragmentShader: GRAIN_FRAG,
      });
      composer.addPass(grain);
      composer.addPass(new OutputPass());
    } catch {
      composer = null;
      bloom = null;
      grain = null;
    }

    /* 背景：原站全屏程序化星空（jN/MN），不用任何球体网格 */
    const bgAccent = new THREE.Color(meta.genreColors[10] ?? "#EDE3CC");
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uAspect: { value: window.innerWidth / window.innerHeight },
        uView: { value: 0 },
        uDive: { value: 0 },
        uTime: { value: 0 },
        uLive: { value: 0 },
        uTilt: { value: new THREE.Vector2(0, 0) },
        uAcc: { value: bgAccent.clone() },
      },
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      depthWrite: false,
      depthTest: false,
    });
    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = -1;
    scene.add(bgMesh);

    /* 旋转组：地球与星云共用，拖拽/换台对准都转它 */
    const group = new THREE.Group();
    scene.add(group);

    /* 地景点球（原站 setLand）：极暗小点铺出大陆，morph 到星云时淡出 */
    const sigDir = new THREE.Vector3(0, 0, 1); // 原站 D/te 共用同一个 uSig
    const landMat = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: 0 },
        uPR: { value: dpr },
        uTime: { value: 0 },
        uSigOn: { value: 0 },
        uSig: { value: sigDir },
        uDive: { value: 0 },
      },
      vertexShader: LAND_VERT,
      fragmentShader: LAND_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    let landAbort = false;
    fetch("/roamdial/land-dots.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: number[]) => {
        if (landAbort || !Array.isArray(arr) || arr.length < 2) return;
        const n = Math.floor(arr.length / 2);
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          latLng(arr[i * 2] / 100, arr[i * 2 + 1] / 100, R * 0.997, pos, i * 3);
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(lg, landMat);
        pts.frustumCulled = false;
        group.add(pts);
      })
      .catch(() => {});

    /* 点云 */
    const pointColors = (meta.genreColors.length ? meta.genreColors : ["#EDE3CC"]).map(
      (c) => new THREE.Color(c)
    );
    // 着色器里 uCol 固定 11 项，数据未到也要按声明长度给足
    while (pointColors.length < 11) pointColors.push(new THREE.Color("#EDE3CC"));
    /* 原站 FFT 瀑布：256 频带 × 64 行历史，行 0 是当前帧 */
    const fftTex = new THREE.DataTexture(
      getFftData(),
      256,
      64,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    fftTex.unpackAlignment = 1;
    fftTex.minFilter = THREE.LinearFilter;
    fftTex.magFilter = THREE.LinearFilter;
    fftTex.generateMipmaps = false;
    fftTex.wrapS = THREE.ClampToEdgeWrapping;
    fftTex.wrapT = THREE.ClampToEdgeWrapping;
    fftTex.needsUpdate = true;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uView: { value: 0 },
        uRingE: { value: 0 },
        uPR: { value: dpr },
        uSel: { value: -1 },
        uIntro: { value: 0 },
        uBoost: { value: 1 },
        uLevel: { value: 0 },
        uFFT: { value: fftTex },
        uSigOn: { value: 0 },
        uSig: { value: sigDir },
        uDive: { value: 0 },
        uCol: { value: pointColors },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    /* ---------- 唱片态 3D 点云（原站 je / ke / Me / I） ---------- */
    const diveUniforms = {
      uTime: { value: 0 },
      uProg: { value: 1 },
      uFromMode: { value: 0 },
      uToMode: { value: 0 },
      uFromGain: { value: 0 },
    uLevel: { value: 0 },
      uToGain: { value: 0 },
      uFromPt: { value: 1 },
      uToPt: { value: 1 },
      uSize: { value: pro ? 1.7 : 2.1 },
      uPR: { value: dpr },
      uFocus: { value: 6 },
      uAspect: { value: window.innerWidth / window.innerHeight },
      uMouse: { value: new THREE.Vector2(9, 9) },
      uMouseF: { value: 0 },
      uFFT: { value: fftTex },
      uBase: { value: new THREE.Color("#F5F1E8") },
      uAccA: { value: new THREE.Color("#EDE3CC") },
      uAccB: { value: new THREE.Color("#EDE3CC") },
    };
    const diveMat = new THREE.ShaderMaterial({
      uniforms: diveUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: DIVE_VERT,
      fragmentShader: DIVE_FRAG,
    });
    /* 原站 c 档：高画质 65,536 点 / 省电 32,768 点，点大小 1.7 / 2.1 */
    const diveN = pro ? DIVE_N : DIVE_N / 2;
    const diveSeed = diveSeeds(diveN);
    const diveFrom = new THREE.BufferAttribute(new Float32Array(diveN * 4), 4);
    const diveTo = new THREE.BufferAttribute(new Float32Array(diveN * 4), 4);
    const diveBand = new THREE.BufferAttribute(new Float32Array(diveN * 2), 2);
    const diveGeom = new THREE.BufferGeometry();
    diveGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(diveN * 3), 3));
    diveGeom.setAttribute("aFrom", diveFrom);
    diveGeom.setAttribute("aTo", diveTo);
    diveGeom.setAttribute("aSeed", new THREE.BufferAttribute(diveSeed, 4));
    diveGeom.setAttribute("aBand", diveBand);
    const divePoints = new THREE.Points(diveGeom, diveMat);
    divePoints.frustumCulled = false;
    divePoints.visible = false;
    const diveSpin = new THREE.Group();
    const diveGroup = new THREE.Group();
    diveGroup.add(diveSpin);
    diveSpin.add(divePoints);
    scene.add(diveGroup);
    let diveKey: DiveKey = "point";
    let diveLast: ResolvedForm = "disc";
    let diveFe = 1;
    let diveRate = 0.42;
    let diveWasOn = false;
    let diveSpinA = 0;
    let diveZoom = 1;
    let diveYaw = 0;
    let divePitch = 0;
    let diveYawT = 0;
    let divePitchT = 0;
    let diveDrag = false;
    let diveHover = false;
    let diveReq = { form: "genre" as DiveForm, pro: true, genre: 10 };
    let diveMouseF = 0;
    const diveTmp = new THREE.Vector3();
    const ease01 = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    /** 原站 Ue()：把新形态塞进 aTo，aFrom 按 uProg 追平，aBand 过半数后换列 */
    const applyDive = (key: DiveKey, geo: DiveGeo, rate = 0.42, color?: string) => {
      const fa = diveFrom.array as Float32Array;
      const ta = diveTo.array as Float32Array;
      const ba = diveBand.array as Float32Array;
      for (let i = 0; i < diveN; i++) {
        const r = i * 4;
        const n = ease01(Math.min(1, Math.max(0, (diveFe - diveSeed[r] * 0.4) / 0.6)));
        fa[r] += (ta[r] - fa[r]) * n;
        fa[r + 1] += (ta[r + 1] - fa[r + 1]) * n;
        fa[r + 2] += (ta[r + 2] - fa[r + 2]) * n;
        fa[r + 3] += (ta[r + 3] - fa[r + 3]) * n;
        if (n > 0.5) {
          ba[r] = ba[r + 2];
          ba[r + 1] = ba[r + 3];
        }
        ba[r + 2] = geo.band[i * 2];
        ba[r + 3] = geo.band[i * 2 + 1];
      }
      ta.set(geo.pos);
      diveFrom.needsUpdate = true;
      diveTo.needsUpdate = true;
      diveBand.needsUpdate = true;
      const c = DIVE_CFG[diveKey];
      const l = DIVE_CFG[key];
      diveUniforms.uFromMode.value = c.mode;
      diveUniforms.uToMode.value = l.mode;
      diveUniforms.uFromGain.value = c.gain;
      diveUniforms.uToGain.value = l.gain;
      diveUniforms.uFromPt.value = diveKey === "point" ? 1 : 0;
      diveUniforms.uToPt.value = key === "point" ? 1 : 0;
      (diveUniforms.uAccA.value as THREE.Color).copy(diveUniforms.uAccB.value as THREE.Color);
      if (color) (diveUniforms.uAccB.value as THREE.Color).set(color);
      diveKey = key;
      if (key !== "point") diveLast = key as ResolvedForm;
      diveFe = 0;
      diveRate = rate;
    };

    let points: THREE.Points | null = null;
    let layout: Layout = { globe: new Float32Array(0), neb: new Float32Array(0), den: new Float32Array(0), info: new Float32Array(0), anchors: [], ring: new Float32Array(0) };
    let flags: Float32Array = new Float32Array(0);
    let geom: THREE.BufferGeometry | null = null;
    let builtFor: Station[] | null = null;
    let builtGenres = new Set<number>();

    /* 原站环形唱片阵（uRingE/aRing）：Nt / Ft / Pt / Rt / It / Lt */
    let ringOn = false;
    let ringE = 0;
    let ringTarget = 0;
    let ringList: number[] = [];
    let ringNormal = new THREE.Vector3(0, 0, 1);
    let ringAngular = 0;
    let userDragged = false;
    let userZoomed = false;

    const build = () => {
      const { stations: st, meta: mt, activeGenres: ag } = propsRef.current;
      const n = st.length;
      if (geom) {
        group.remove(points!);
        geom.dispose();
        geom = null;
      }
      layout = buildLayout(st, mt);
      ringOn = false;
      ringE = 0;
      ringTarget = 0;
      ringList = [];
      mat.uniforms.uRingE.value = 0;
      flags = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        flags[i * 2] = ag.size === 0 || ag.has(st[i].genre) ? 1 : 0;
        flags[i * 2 + 1] = 0;
      }
      const cols = mat.uniforms.uCol.value as THREE.Color[];
      for (let i = 0; i < cols.length; i++) {
        cols[i]?.set(mt.genreColors[i] ?? "#EDE3CC");
      }
      bgAccent.set(mt.genreColors[10] ?? "#EDE3CC");
      builtGenres = new Set(ag);
      const idx = new Float32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(layout.globe, 3));
      geom.setAttribute("aNeb", new THREE.BufferAttribute(layout.neb, 3));
      geom.setAttribute("aRing", new THREE.BufferAttribute(layout.ring, 3));
      geom.setAttribute("aInfo", new THREE.BufferAttribute(layout.info, 4));
      geom.setAttribute("aFlag", new THREE.BufferAttribute(flags, 2));
      geom.setAttribute("aIdx", new THREE.BufferAttribute(idx, 1));
      geom.setAttribute("aDen", new THREE.BufferAttribute(layout.den, 1));
      points = new THREE.Points(geom, mat);
      points.frustumCulled = false;
      group.add(points);
      builtFor = st;
      if (canvas) canvas.dataset.stations = String(n);
    };
    build();

    const updateFlags = () => {
      const { stations: st, activeGenres: ag } = propsRef.current;
      if (!geom) return;
      const same =
        ag.size === builtGenres.size && [...ag].every((g) => builtGenres.has(g));
      if (same) return;
      builtGenres = new Set(ag);
      for (let i = 0; i < st.length; i++) {
        flags[i * 2] = ag.size === 0 || ag.has(st[i].genre) ? 1 : 0;
      }
      (geom.getAttribute("aFlag") as THREE.BufferAttribute).needsUpdate = true;
      deactivateRing(true);
    };

    /* 原站 Wt()：相机贴近且停稳后，把 (筛选内) 台级精度的电台铺成向日葵盘，
       盘面切于正对相机的球面点。前 700 台按热度取，越靠中心越热门。
       原站 Gt()/Kt()：uRingE 缓出，归零后清 aFlag.y。 */
    const ringDir = new THREE.Vector3();
    const ringInvQ = new THREE.Quaternion();
    const buildRing = () => {
      if (ringOn || morph > 0.01 || camZ / S > 3.9) return;
      const p = propsRef.current;
      const n = stationCount();
      ringInvQ.copy(group.quaternion).invert();
      const a = ringDir.set(0, 0, 1).applyQuaternion(ringInvQ).normalize().clone();
      /* 原站实际写法：prec>=3 被 || 短路，环里只收 0.75° 相机轴内的城市/国家级台 */
      const cap = Math.cos(0.75 * DEG);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        if (flags[i * 2] < 0.5) continue;
        if (p.stations[i].prec >= 3) continue;
        const dot =
          (layout.globe[i * 3] * a.x +
            layout.globe[i * 3 + 1] * a.y +
            layout.globe[i * 3 + 2] * a.z) /
          (R * 1.004);
        if (dot > cap) out.push(i);
      }
      if (out.length < 4) return;
      out.sort((x, y) => p.stations[y].pop - p.stations[x].pop);
      const list = out.length > 700 ? out.slice(0, 700) : out;
      const k = camZ / S;
      const l = 0.0105 * Math.max(0.6, (k - U) / 1.3) * S;
      const o = Math.abs(a.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const s = new THREE.Vector3().crossVectors(o, a).normalize();
      const c = new THREE.Vector3().crossVectors(a, s);
      const d = a.clone().multiplyScalar(R * 1.012);
      const ra = layout.ring;
      for (let t = 0; t < list.length; t++) {
        const idx = list[t];
        const rad = l * Math.sqrt(t + 0.6);
        const ang = t * GOLDEN;
        ra[idx * 3] = d.x + (s.x * Math.cos(ang) + c.x * Math.sin(ang)) * rad;
        ra[idx * 3 + 1] = d.y + (s.y * Math.cos(ang) + c.y * Math.sin(ang)) * rad;
        ra[idx * 3 + 2] = d.z + (s.z * Math.cos(ang) + c.z * Math.sin(ang)) * rad;
        flags[idx * 2 + 1] = 1;
      }
      ringAngular = (l * Math.sqrt(list.length)) / R;
      ringNormal.copy(a);
      ringList = list;
      ringTarget = 1;
      ringOn = true;
      ringE = 0;
      geom!.getAttribute("aRing")!.needsUpdate = true;
      geom!.getAttribute("aFlag")!.needsUpdate = true;
      /* 原站：扫中的台若在环里，对准它的新位置 */
      const aim = nearestRef.idx;
      if (aim >= 0 && flags[aim * 2 + 1] > 0) {
        const [px, py] = rotFor(ra[aim * 3], ra[aim * 3 + 1], ra[aim * 3 + 2]);
        let y = py;
        while (y - tgt.y > Math.PI) y -= Math.PI * 2;
        while (y - tgt.y < -Math.PI) y += Math.PI * 2;
        tgt.x = px;
        tgt.y = y;
        vel.x = 0;
        vel.y = 0;
      }
    };

    function clearRing() {
      for (const idx of ringList) flags[idx * 2 + 1] = 0;
      if (geom) geom.getAttribute("aFlag")!.needsUpdate = true;
      ringList = [];
      ringOn = false;
      ringTarget = 0;
      ringE = 0;
      mat.uniforms.uRingE.value = 0;
    }

    function deactivateRing(hard: boolean) {
      if (!ringOn) return;
      ringTarget = 0;
      if (hard) clearRing();
    }

    /* 旋转状态：rot 是实际值，tgt 是目标，原站 ht/mt ↔ _t/gt */
    const rot = { x: 0.32, y: 0 };
    const tgt = { x: 0.32, y: 0 };
    {
      /* 原站初始朝向 St(32°N, 112°E) 再往左偏 .6 rad */
      const p = new Float32Array(3);
      latLng(32, 112, 1, p, 0);
      const r = Math.atan2(-p[0], p[2]);
      const i = -p[0] * Math.sin(r) + p[2] * Math.cos(r);
      rot.x = tgt.x = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(p[1], i)));
      rot.y = tgt.y = r - 0.6;
    }
    const vel = { x: 0, y: 0 };
    let dragState = false;
    let moved = 0;
    let downAt = 0;
    let grabbed = false;
    let last = { x: 0, y: 0 };
    const tiltTarget = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    let diveAmt = 0;
    let morph = 0; // 原站 ft
    let morphTarget = 0; // 原站 pt
    let lastView = propsRef.current.view;
    let stillFor = 0;
    let prevMs = 0;
    let settledReported = false;
    let focusedFor = -1;
    let enteredNoZoom = false;
    let intro = 0;
    let scanFor = 0;
    let labelFor = 0;

    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const LOCK_PX = coarse ? 20 : 14;
    const SNAP_PX = coarse ? 60 : 46;
    const PICK_PX = coarse ? 44 : 30;
    const LIMB_SCAN = R * 0.1125;
    const LIMB_PICK = R * 0.09375;

    const dragRate = () => {
      const depth = Math.max(1, camera.position.z - R);
      const pxPerRad =
        (R * window.innerHeight) / 2 / Math.tan((camera.fov / 2) * DEG) / depth;
      return 1 / pxPerRad;
    };

    const rotFor = (x: number, y: number, z: number) => {
      const r = Math.atan2(-x, z);
      const i = -x * Math.sin(r) + z * Math.cos(r);
      return [Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(y, i))), r] as const;
    };

    /** 当前视图（目标）下第 i 台的位置数组（原站 jt 的 j / M / N） */
    const posFor = (i: number, sky: boolean) => {
      if (!sky && ringE > 0.99 && flags[i * 2 + 1] > 0) return layout.ring;
      return sky ? layout.neb : layout.globe;
    };

    const focusIdx = (i: number, aimZoom = false) => {
      const arr = posFor(i, morphTarget > 0.5);
      if (!arr.length || i < 0 || i * 3 + 2 >= arr.length) return;
      const [px, py] = rotFor(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      let y = py;
      while (y - tgt.y > Math.PI) y -= Math.PI * 2;
      while (y - tgt.y < -Math.PI) y += Math.PI * 2;
      tgt.x = px;
      tgt.y = y;
      vel.x = 0;
      vel.y = 0;
      if (aimZoom && morphTarget < 0.5) camZ = 3.2 * S;
    };

    /* 投影：世界（组内）坐标 → 屏幕。viewPoint 走与渲染一致的矩阵 */
    const v3 = new THREE.Vector3();
    /* 复用同一个输出对象：原来每次调用都返回新字面量，扫 35,699 个台就是 35,699 次分配 */
    type ScreenPt = { x: number; y: number; z: number; front: number };
    const spTmp: ScreenPt = { x: 0, y: 0, z: 0, front: 0 };
    const pvMat = new THREE.Matrix4();
    let vw2 = window.innerWidth;
    let vh2 = window.innerHeight;
    const toScreen = (arr: Float32Array, i: number, out: ScreenPt = spTmp): ScreenPt => {
      v3.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      group.localToWorld(v3);
      out.front = v3.z;
      v3.project(camera);
      out.x = (v3.x * 0.5 + 0.5) * vw2;
      out.y = (-v3.y * 0.5 + 0.5) * vh2;
      out.z = v3.z;
      return out;
    };

    const pickAt = (sx: number, sy: number): number => {
      const sky = morphTarget > 0.5;
      const useRing = !sky && ringE > 0.99;
      const arr = useRing ? layout.ring : posFor(0, sky);
      const n = useRing ? ringList.length : arr.length / 3;
      let best = -1;
      let bestD = PICK_PX * PICK_PX;
      for (let k = 0; k < n; k++) {
        const i = useRing ? ringList[k] : k;
        const p = toScreen(arr, i);
        if (!sky && !useRing && p.front < LIMB_PICK) continue;
        const dx = p.x - sx;
        const dy = p.y - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    /* 交互 */
    const onPointerDown = (e: PointerEvent) => {
      dragState = true;
      diveDrag = true;
      moved = 0;
      downAt = performance.now();
      grabbed = false;
      userDragged = false;
      userZoomed = false;
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("drag");
    };
    const onPointerMove = (e: PointerEvent) => {
      tiltTarget.x = (e.clientX / window.innerWidth - 0.5) * 2;
      tiltTarget.y = -(e.clientY / window.innerHeight - 0.5) * 2;
      (diveUniforms.uMouse.value as THREE.Vector2).set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      diveHover = true;
      if (propsRef.current.diving) {
        if (dragState) {
          const ddx = e.clientX - last.x;
          const ddy = e.clientY - last.y;
          diveYawT += ddx * 0.0042;
          divePitchT = Math.max(-1.1, Math.min(1.1, divePitchT + ddy * 0.003));
          last = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (!dragState) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (!grabbed && moved >= 6) {
        grabbed = true;
        userDragged = true;
        propsRef.current.onGrab?.();
      }
      const k = dragRate();
      vel.y = dx * k;
      vel.x = dy * k;
      tgt.y += vel.y;
      tgt.x = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, tgt.x + vel.x));
      rot.y = tgt.y;
      rot.x = tgt.x;
      last = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (
        !propsRef.current.diving &&
        dragState &&
        moved < 6 &&
        performance.now() - downAt <= 400
      ) {
        const hit = pickAt(e.clientX, e.clientY);
        if (hit >= 0) {
          focusedFor = hit;
          focusIdx(hit);
          propsRef.current.onPick(propsRef.current.stations[hit]);
        }
      }
      dragState = false;
      diveDrag = false;
      canvas.classList.remove("drag");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userDragged = false;
      userZoomed = true;
      const delta = e.deltaY;
      if (propsRef.current.diving) {
        diveZoom = Math.max(0.55, Math.min(1.8, diveZoom * (1 + delta * 0.0012)));
        return;
      }
      /* 原站 Sr()：地球 [1.95, 9v]，星云 [3.5, max(15, y*1.3)] */
      const sky = morphTarget > 0.5;
      const lo = (sky ? 3.5 : 1.95) * S;
      const hi = (sky ? Math.max(15, (skyDist() / S) * 1.3) : 9 * vScale()) * S;
      camZ = Math.max(lo, Math.min(hi, camZ * (1 + delta * 0.0011)));
    };
    const onDblClick = () => {
      if (nearestRef.locked && nearestRef.idx === propsRef.current.currentIdx)
        propsRef.current.onDive?.();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    /* 原站键盘：环展开后 ↑/↓ 按环内热度顺序逐台（先于全局快捷键） */
    const onRingKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if (!ringOn || ringE < 0.99 || !ringList.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      e.preventDefault();
      e.stopPropagation();
      const p = propsRef.current;
      const len = ringList.length;
      const cur = p.currentIdx == null ? -1 : ringList.indexOf(p.currentIdx);
      const next = ringList[(cur + (e.key === "ArrowDown" ? 1 : -1) + len) % len];
      focusIdx(next);
      propsRef.current.onPick(p.stations[next]);
    };
    window.addEventListener("keydown", onRingKey, true);

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer?.setSize(w, h);
      bgMat.uniforms.uAspect.value = w / h;
      if (grain) (grain.uniforms.uRes.value as THREE.Vector2).set(w, h);
      if (propsRef.current.view === "sky") camZ = skyDist();
    };
    window.addEventListener("resize", onResize);

    /* 标签层（.ann） */
    const ann = annRef.current;
    const labelEls: {
      g: SVGTextElement;
      n: SVGTextElement;
      line: SVGLineElement;
    }[] = [];
    if (ann) {
      ann.innerHTML = "";
      for (let g = 0; g < 11; g++) {
        const gEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        gEl.setAttribute("class", "big");
        gEl.style.paintOrder = "stroke";
        gEl.style.stroke = "rgba(9,20,18,0.85)";
        gEl.style.strokeWidth = "3px";
        const nEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        nEl.setAttribute("class", "s");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ann.appendChild(line);
        ann.appendChild(gEl);
        ann.appendChild(nEl);
        labelEls.push({ g: gEl, n: nEl, line });
      }
    }

    /* 渲染循环 */
    let raf = 0;
    let tt = 0;
    let frameNo = 0;
    const nearestRef = { idx: -1, dist: 1e9, locked: false, settled: false };
    let labels: [number, number, number][] = [];
    const stationCount = () => layout.globe.length / 3;
    /* .glow 的不透明度由音频驱动（原站在渲染循环里写 style.opacity），这里缓存节点 */
    let glowEl: HTMLElement | null = null;
    let glowO = 0;
    let glowLast = -1;
    /** 原站 Wr：脉冲强度的缓动值 */
    let sigAmt = 0;
    /* 自适应画质：连续 2 秒平均帧时间 > 24ms 就把渲染分辨率降到 1.25，弱 GPU 上更稳 */
    let perfAcc = 0;
    let perfN = 0;
    let perfChecked = false;

    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      tt = ms * 0.001;
      const dt = prevMs ? Math.min(0.05, Math.max(0.001, (ms - prevMs) / 1000)) : 1 / 60;
      prevMs = ms;
      const f60 = dt * 60;
      frameNo += 1;
      if (!perfChecked) {
        perfAcc += dt;
        perfN++;
        if (perfAcc > 2) {
          perfChecked = true;
          const avg = perfAcc / perfN;
          if (avg > 0.033) {
            // 明显掉帧：降到 1.0 DPR 并关掉 Bloom
            renderer.setPixelRatio(1);
            composer?.setPixelRatio(1);
            composer?.setSize(window.innerWidth, window.innerHeight);
            if (bloom) bloom.enabled = false;
            console.log("[radio2] 性能降级：DPR 1.0 + 关闭 Bloom");
          } else if (avg > 0.024) {
            const pr = Math.min(dpr, 1.25);
            renderer.setPixelRatio(pr);
            composer?.setPixelRatio(pr);
            composer?.setSize(window.innerWidth, window.innerHeight);
            console.log("[radio2] 性能降级：DPR " + pr);
          }
        }
      }

      if (p.stations !== builtFor) build();
      updateFlags();

      /* 视图目标变化：原站 wt() */
      if (p.view !== lastView) {
        lastView = p.view;
        morphTarget = p.view === "sky" ? 1 : 0;
        camZ = p.view === "sky" ? skyDist() : globeDist();
        if (p.view === "sky") tgt.x = 0.42;
        settledReported = false;
        focusedFor = propsRef.current.currentIdx ?? -1;
        deactivateRing(true);
      }
      /* 原站每帧 uView += i*.45（约 2.2 秒），逐点再错峰 0.4+0.6 */
      if (morph < morphTarget) morph = Math.min(morphTarget, morph + dt * 0.45);
      else if (morph > morphTarget) morph = Math.max(morphTarget, morph - dt * 0.45);
      mat.uniforms.uView.value = morph;
      mat.uniforms.uTime.value = tt;
      mat.uniforms.uPR.value = renderer.getPixelRatio();
      vw2 = window.innerWidth;
      vh2 = window.innerHeight;
      mat.uniforms.uIntro.value = intro;
      mat.uniforms.uSel.value = p.currentIdx ?? -1;

      /* 唱片态：点阵/背景一起让位（原站 uDive），我们的 .rv 是覆盖层，淡出更稳 */
      /* 原站 Ge+=(Ke-Ge)*min(1, i*(Ke?1.6:1.3))：进 1.6/s、出 1.3/s，比之前 dt*5 慢得多 */
      diveAmt +=
        ((p.diving ? 1 : 0) - diveAmt) *
        (reducedMotion() ? 1 : Math.min(1, dt * (p.diving ? 1.6 : 1.3)));
      (mat.uniforms.uBoost as { value: number }).value = 1 - diveAmt * 0.4;

      /* 音频联动：省电模式下降频刷新并关闭 Bloom */
      if (p.pro || (frameNo & 1) === 0) {
        updateSpectrum(dt, tt);
        fftTex.needsUpdate = true;
        mat.uniforms.uLevel.value = getLevel();
        const bs = getBass();
        if (bloom) bloom.strength = 0.45 + bs * 0.3;
      }
      if (bloom) bloom.enabled = !softwareMode && !!p.pro;
      tickStatic(dt);
      const staticLv = setLevels();
      if (grain) grain.uniforms.uNoise.value = staticLv * 4;
      if (!glowEl || !glowEl.isConnected) glowEl = document.querySelector<HTMLElement>(".glow");
      if (glowEl) {
        const gt =
          p.currentIdx == null
            ? 0
            : isReal()
              ? 0.4 + Math.min(1, bs) * 0.6
              : isLiveAudio()
                ? 0.3
                : 0.16;
        glowO += (gt - glowO) * Math.min(1, dt * 6);
        if (Math.abs(glowO - glowLast) > 0.004) {
          glowLast = glowO;
          glowEl.style.opacity = glowO.toFixed(3);
        }
      }

      /* 背景星空 + 颗粒（原站 S / le 的 uniform 更新） */
      const cur = p.currentIdx != null ? p.stations[p.currentIdx] : null;
      if (cur) bgAccent.set(p.meta.genreColors[cur.genre] ?? "#EDE3CC");
      tilt.x += (tiltTarget.x - tilt.x) * Math.min(1, dt * 6);
      tilt.y += (tiltTarget.y - tilt.y) * Math.min(1, dt * 6);
      bgMat.uniforms.uView.value = morph;
      bgMat.uniforms.uDive.value = diveAmt;
      bgMat.uniforms.uTime.value = tt;
      bgMat.uniforms.uTilt.value.set(tilt.x, tilt.y);
      bgMat.uniforms.uAcc.value.copy(bgAccent);
      if (grain) grain.uniforms.uTime.value = tt;

      /* 陆地小点层不透明度（原站 D.uniforms.uA） */
      landMat.uniforms.uA.value =
        (1 - Math.min(1, diveAmt * 1.5)) *
        Math.max(0, 1 - morph * 2.5) *
        Math.min(1, 0.5 + intro) *
        Math.max(0.3, Math.min(1, (camZ / S - 2.2) / 3.2));
      landMat.uniforms.uPR.value = renderer.getPixelRatio();

      /* 原站只在原生宿主（HM）里跑：选台后的球面行进脉冲 + 背景流星。
         web 端用 window.__roamdialNative 显式模拟宿主，默认关闭（与原站网页一致） */
      const nativeOn = (window as any).__roamdialNative === true;
      bgMat.uniforms.uLive.value = nativeOn ? 1 : 0;
      const sigTarget =
        nativeOn && p.currentIdx != null && !p.diving && !ringOn
          ? Math.max(0, 1 - morph * 3)
          : 0;
      sigAmt += (sigTarget - sigAmt) * Math.min(1, dt * 2);
      mat.uniforms.uSigOn.value = sigAmt;
      landMat.uniforms.uSigOn.value = sigAmt;
      landMat.uniforms.uTime.value = tt;

      /* ---------- 唱片态 3D 点云（原站 rt / lt / Ue / 每帧驱动） ---------- */
      if (p.diving !== diveWasOn && layout.globe.length > 0) {
        const idx = p.currentIdx ?? 0;
        const g = p.stations[idx];
        diveTmp
          .set(layout.globe[idx * 3], layout.globe[idx * 3 + 1], layout.globe[idx * 3 + 2])
          .applyMatrix4(group.matrixWorld)
          .divideScalar(DIVE_SC);
        if (p.diving) {
          const o0 = originCloud(diveTmp.x, diveTmp.y, diveTmp.z, 0.012, diveN);
          (diveFrom.array as Float32Array).set(o0.pos);
          (diveTo.array as Float32Array).set(o0.pos);
          diveFrom.needsUpdate = true;
          diveTo.needsUpdate = true;
          diveKey = "point";
          diveFe = 1;
          const col = p.meta.genreColors[g?.genre ?? 10] ?? "#EDE3CC";
          (diveUniforms.uAccB.value as THREE.Color).set(col);
          diveSpinA = 0;
          diveZoom = 1;
          diveYaw = diveYawT = divePitch = divePitchT = 0;
          diveGroup.rotation.set(0, 0, 0);
          diveSpin.rotation.set(0, 0, 0);
          diveReq = { form: p.diveForm, pro: p.pro, genre: g?.genre ?? 10 };
          const rf = resolveForm(diveReq.form, diveReq.genre, diveReq.pro, diveLast);
          applyDive(rf, diveGeo(rf, diveN), 0.42, col);
          divePoints.visible = true;
        } else {
          applyDive("point", originCloud(diveTmp.x, diveTmp.y, diveTmp.z, 0.012, diveN), 0.6);
        }
        diveWasOn = p.diving;
      }
      diveFe = Math.min(1, diveFe + dt * diveRate);
      diveUniforms.uLevel.value = getLevel();
      diveUniforms.uProg.value = diveFe;
      diveUniforms.uTime.value = tt;
      diveUniforms.uPR.value = renderer.getPixelRatio();
      diveUniforms.uAspect.value = camera.aspect;
      /* 设置里换了效果 / 换了台 / 切了画质档 → 交叉淡入到新形态 */
      if (p.diving && p.currentIdx != null) {
        const g = p.stations[p.currentIdx];
        const genre = g?.genre ?? 10;
        if (
          diveFe > 0.85 &&
          (diveReq.form !== p.diveForm || diveReq.pro !== p.pro || diveReq.genre !== genre)
        ) {
          diveReq = { form: p.diveForm, pro: p.pro, genre };
          const rf = resolveForm(diveReq.form, genre, diveReq.pro, diveLast);
          if (rf !== diveLast) applyDive(rf, diveGeo(rf, diveN), 0.42, p.meta.genreColors[genre] ?? "#EDE3CC");
        }
      }
      diveSpinA += dt * DIVE_CFG[diveKey].spin * (1 + getBass() * 0.6);
      diveSpin.rotation.y = diveSpinA;
      diveYaw += (diveYawT - diveYaw) * 0.06;
      divePitch += (divePitchT - divePitch) * 0.06;
      if (!diveDrag) {
        diveYawT *= 0.985;
        divePitchT *= 0.985;
      }
      diveGroup.rotation.set(divePitch * diveAmt, diveYaw * diveAmt, 0);
      diveMouseF += ((diveHover && !diveDrag && p.diving ? 1 : 0) - diveMouseF) * Math.min(1, dt * 8);
      diveUniforms.uMouseF.value = diveMouseF;
      if (!p.diving && diveFe >= 1 && divePoints.visible) divePoints.visible = false;
      if (points) points.visible = diveAmt < 0.995;
      mat.uniforms.uDive.value = diveAmt;
      if (p.currentIdx != null) {
        const b = p.currentIdx * 3;
        sigDir.set(layout.globe[b], layout.globe[b + 1], layout.globe[b + 2]).normalize();
      }

      /* 拖拽惯性 + 自转 + 缓动 */
      if (!dragState) {
        tgt.y += vel.y * f60;
        tgt.x = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, tgt.x + vel.x * f60));
        vel.y *= Math.pow(0.9, f60);
        vel.x *= Math.pow(0.9, f60);
        if (Math.abs(vel.y) + Math.abs(vel.x) <= 4e-4) {
          vel.y = 0;
          vel.x = 0;
        }
        if (p.currentIdx == null && !reducedMotion() && Math.abs(vel.y) < 1e-5)
          tgt.y += 0.033 * dt;
        const k = reducedMotion() ? 1 : 1 - Math.pow(0.92, f60);
        rot.x += (tgt.x - rot.x) * k;
        rot.y += (tgt.y - rot.y) * k;
      }
      group.rotation.set(rot.x, rot.y, 0);
      group.updateMatrixWorld(true);
      /* 原站机位：唱片态把相机抬到 de[form].cam 并看向 look，靠 uDive 混合过去 */
      camZNow += (camZ - camZNow) * (reducedMotion() ? 1 : 1 - Math.pow(0.94, f60));
      if (diveAmt > 0.001) {
        const cfg = DIVE_CFG[p.diving ? diveLast : "point"];
        const uScale = Math.max(1, 0.95 / camera.aspect);
        const cWave = Math.sin(Math.PI * ease01(diveFe));
        const k = diveZoom * uScale * (1 + cWave * 0.22) * (1 + 0.45 * diveAmt);
        const dz = cfg.cam[2] * k;
        const bDive = camZNow / DIVE_SC;
        /* 原站唱片态鼠标视差：Ye.x += xr.x*.25、Ye.y += xr.y*.15 */
        const par = diveHover ? diveAmt : 0;
        const pmx = (diveUniforms.uMouse.value as THREE.Vector2).x * 0.25 * par;
        const pmy = (diveUniforms.uMouse.value as THREE.Vector2).y * 0.15 * par;
        camera.position.set(
          cfg.cam[0] * k * diveAmt + pmx,
          cfg.cam[1] * k * diveAmt + pmy,
          bDive + (dz - bDive) * diveAmt
        );
        camera.lookAt(cfg.look[0] * diveAmt, cfg.look[1] * diveAmt, cfg.look[2] * diveAmt);
        diveUniforms.uFocus.value = camera.position.distanceTo(
          diveTmp.set(cfg.look[0] * diveAmt, cfg.look[1] * diveAmt, cfg.look[2] * diveAmt)
        );
      } else {
        camera.position.set(0, 0, camZNow);
        camera.lookAt(0, 0, 0);
        diveUniforms.uFocus.value = camZNow / DIVE_SC;
      }
      camera.updateMatrixWorld(true);
      /* 原站每帧 setViewOffset：桌面唱片态整体右移 11% 让位给左侧信息，窄屏下移 13%
         （ci 是宿主 setIntroShift 的缓动值，独立访问恒 0） */
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw > 900) camera.setViewOffset(vw, vh, -vw * 0.11 * diveAmt, 0, vw, vh);
      else camera.setViewOffset(vw, vh, 0, vh * 0.13 * diveAmt, vw, vh);

      /* 入场：数据到了以后原站 uIntro += i*.35 */
      if (builtFor && intro < 1) intro = Math.min(1, intro + dt * 0.35);

      /* 停稳判定（原站 xt）：拖拽/惯性/缓动/过渡中都不算 */
      const morphing = Math.abs(morph - morphTarget) > 1e-4;
      const inertial = Math.abs(vel.y) + Math.abs(vel.x) > 4e-4;
      const camMoving = Math.abs(camZ - camera.position.z) > 0.002 * (6.2 * S);
      const settling = Math.abs(tgt.x - rot.x) + Math.abs(tgt.y - rot.y) > 0.0015;
      const busy = dragState || inertial || camMoving || settling || morphing || p.diving;
      stillFor = busy ? 0 : stillFor + dt;
      if (busy) settledReported = false;

      /* 原站环形唱片阵：贴近停稳后展开；视线离开盘面或拉远时收起 */
      if (p.diving) deactivateRing(true);
      if (ringOn) {
        ringE += (ringTarget - ringE) * (reducedMotion() ? 1 : Math.min(1, dt * 4.5));
        if (ringTarget === 0 && ringE < 0.01) clearRing();
      } else {
        ringE = 0;
      }
      if (
        p.started &&
        !p.diving &&
        diveAmt < 0.02 &&
        morph < 0.01 &&
        !ringOn &&
        stillFor > 0.55 &&
        camZ / S < 3.9 &&
        (userDragged ||
          userZoomed ||
          p.currentIdx == null ||
          p.stations[p.currentIdx].prec < 3)
      ) {
        buildRing();
      }
      if (ringOn && ringTarget === 1 && ringE > 0.99) {
        ringInvQ.copy(group.quaternion).invert();
        ringDir.set(0, 0, 1).applyQuaternion(ringInvQ).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, ringDir.dot(ringNormal))));
        if (ang > ringAngular * 1.5 + 0.004 || camZ / S > 4.3) deactivateRing(false);
      }
      mat.uniforms.uRingE.value = ringE;

      /* 换台 → 对准（原站 qn/Ar/Ln 的 Ct） */
      if (p.currentIdx != null && p.currentIdx !== focusedFor) {
        const already = nearestRef.locked && nearestRef.idx === p.currentIdx;
        focusedFor = p.currentIdx;
        if (!already) focusIdx(p.currentIdx, !enteredNoZoom && p.zoomOnSwitch);
      }
      enteredNoZoom = false;

      /* 扫描：原站 Mt()，过渡中（含环形阵展开/收起）直接清空 */
      const skySettled = morph > 0.99;
      const globeSettled = morph < 0.01;
      const ringMid = ringOn && ringE > 0.01 && ringE < 0.99;
      scanFor += dt;
      if (!p.diving && scanFor > (busy ? 0.12 : 0.22)) {
        scanFor = 0;
        if ((!skySettled && !globeSettled) || ringMid) {
          if (nearestRef.idx !== -1 || nearestRef.locked) {
            nearestRef.idx = -1;
            nearestRef.dist = 1e9;
            nearestRef.locked = false;
            nearestRef.settled = false;
            p.onNearest(null, 1e9, false, undefined, false);
          }
          labels = [];
        } else {
          const sky = skySettled;
          const ringFull = !sky && ringOn && ringE > 0.99;
          const arr = ringFull ? layout.ring : posFor(0, sky);
          const n = ringFull ? ringList.length : stationCount();
          const hw = vw2 / 2;
          const hh = vh2 / 2;
          let bi = -1;
          let bd = 1e9;
          const near: [number, number, number][] = [];
          /* 内联 world*project：每点只做乘加，避免 35,699 次 Vector3 方法调用 */
          const gm = group.matrixWorld.elements;
          const pv = pvMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
          for (let k = 0; k < n; k++) {
            const i = ringFull ? ringList[k] : k;
            const x0 = arr[i * 3], y0 = arr[i * 3 + 1], z0 = arr[i * 3 + 2];
            const wx = gm[0] * x0 + gm[4] * y0 + gm[8] * z0 + gm[12];
            const wy = gm[1] * x0 + gm[5] * y0 + gm[9] * z0 + gm[13];
            const wz = gm[2] * x0 + gm[6] * y0 + gm[10] * z0 + gm[14];
            if (!sky && !ringFull && wz < LIMB_SCAN) continue;
            const cw = pv[3] * wx + pv[7] * wy + pv[11] * wz + pv[15];
            if (cw <= 0) continue;
            const spx = ((pv[0] * wx + pv[4] * wy + pv[8] * wz + pv[12]) / cw * 0.5 + 0.5) * vw2;
            const spy = (-(pv[1] * wx + pv[5] * wy + pv[9] * wz + pv[13]) / cw * 0.5 + 0.5) * vh2;
            const dx = spx - hw;
            const dy = spy - hh;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) {
              bd = d2;
              bi = i;
            }
            const st = p.stations[i];
            if (d2 < 260 * 260 && st && st.pop >= 4) {
              near.push([i, spx, spy]);
            }
          }
          const nd = Math.sqrt(bd);
          const settled = stillFor > 0.45;
          const locked = bi >= 0 && nd < LOCK_PX;
          if (
            bi !== nearestRef.idx ||
            Math.abs(nd - nearestRef.dist) > 2 ||
            locked !== nearestRef.locked ||
            settled !== nearestRef.settled
          ) {
            nearestRef.idx = bi;
            nearestRef.dist = nd;
            nearestRef.locked = locked;
            nearestRef.settled = settled;
            if (settled) settledReported = true;
            let km: number | undefined;
            if (!sky && !ringFull && bi >= 0) {
              const invQ = new THREE.Quaternion().copy(group.quaternion).invert();
              const frontLocal = new THREE.Vector3(0, 0, 1)
                .applyQuaternion(invQ)
                .normalize();
              const sv = new THREE.Vector3(
                arr[bi * 3] / R,
                arr[bi * 3 + 1] / R,
                arr[bi * 3 + 2] / R
              );
              const dot = Math.max(-1, Math.min(1, frontLocal.dot(sv)));
              km = Math.acos(dot) * 6371;
            }
            p.onNearest(bi >= 0 ? p.stations[bi] : null, nd, locked, km, settled);
          }
          /* 标签候选：原站按 pop 与距离排序，取前 7（手机 4） */
          near.sort((a, b) => {
            const pa = p.stations[a[0]].pop - Math.hypot(a[1] - hw, a[2] - hh) / 90;
            const pb = p.stations[b[0]].pop - Math.hypot(b[1] - hw, b[2] - hh) / 90;
            return pb - pa;
          });
          labels = near.slice(0, coarse ? 4 : 7);
        }
      }

      /* 磁吸（原站 !f && xt∈(.15,.6) → Ct(当前视图坐标)） */
      if (
        !busy &&
        (skySettled || globeSettled) &&
        nearestRef.idx >= 0 &&
        nearestRef.dist > 2 &&
        nearestRef.dist < SNAP_PX &&
        stillFor > 0.15 &&
        stillFor < 0.6
      ) {
        focusIdx(nearestRef.idx);
      }

      /* 标签：20Hz，唱片态/过渡态不画（原站 Ir） */
      labelFor += dt;
      if (ann && labelFor > 0.08) {
        labelFor = 0;
        if (p.diving) {
          ann.style.opacity = "0";
        } else if (morph > 0.98) {
          ann.style.opacity = "1";
          const colors = p.meta.genreColors;
          const safeZones = [
            { x: 16, y: 16, w: 320, h: 120 },
            { x: window.innerWidth - 520, y: 16, w: 504, h: 96 },
            { x: 0, y: window.innerHeight - 96, w: window.innerWidth, h: 96 },
            { x: 0, y: window.innerHeight - 330, w: 340, h: 330 },
          ];
          const placedZones: { x: number; y: number; w: number; h: number }[] = [];
          const zoneHit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
            a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          const counts = new Array(11).fill(0);
          for (const s of p.stations) counts[s.genre] = (counts[s.genre] ?? 0) + 1;
          const rp = new THREE.Vector3();
          for (let g = 0; g < labelEls.length; g++) {
            const el = labelEls[g];
            const a = layout.anchors[g];
            if (!a) {
              el.g.style.display = el.n.style.display = el.line.style.display = "none";
              continue;
            }
            rp.set(a.x, a.y + a.r * 0.9 + 0.15 * S, a.z);
            group.localToWorld(rp);
            rp.project(camera);
            if (rp.z > 1) {
              el.g.style.display = el.n.style.display = el.line.style.display = "none";
              continue;
            }
            const sx = (rp.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-rp.y * 0.5 + 0.5) * window.innerHeight;
            el.g.style.display = el.n.style.display = "block";
            el.line.style.display = "none";
            el.g.textContent = p.lang === "zh" ? p.meta.genres[g] : p.meta.genresEn[g];
            el.n.textContent = p.lang === "zh" ? `${counts[g]} 台` : `${counts[g]} stations`;
            el.g.setAttribute("x", String(sx));
            el.g.setAttribute("y", String(sy));
            el.n.setAttribute("x", String(sx));
            el.n.setAttribute("y", String(sy + 15));
            el.g.setAttribute("text-anchor", "middle");
            el.n.setAttribute("text-anchor", "middle");
            el.g.setAttribute("fill", colors[g] ?? "#f5f1e8");
            let gw = 90;
              {
                // 用字符宽度估算替代 getBBox（避免每帧强制布局）
                const txt = el.g.textContent || "";
                let est = 0;
                for (const ch of txt) est += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 14 : 8;
                if (est > 0) gw = est + 8;
              }
            const lblBox = { x: sx - gw / 2 - 10, y: sy - 20, w: gw + 20, h: 48 };
            if (safeZones.some((r) => zoneHit(lblBox, r)) || placedZones.some((r) => zoneHit(lblBox, r))) {
              el.g.style.display = el.n.style.display = el.line.style.display = "none";
              continue;
            }
            placedZones.push(lblBox);
            const dim = p.activeGenres.size > 0 && !p.activeGenres.has(g);
            (el.g as SVGTextElement).style.opacity = dim ? "0.45" : "1";
            (el.n as SVGTextElement).style.opacity = dim ? "0.35" : "1";
          }
        } else if (morph < 0.02) {
          ann.style.opacity = "1";
          /* 原站记录 .lockbox 附近的禁放矩形：以 li=0.5 定位，330×70 */
          const rects: [number, number, number, number][] = [
            [window.innerWidth * 0.5 - 30, window.innerHeight * 0.5 - 40, 330, 70],
          ];
          for (let g = 0; g < labelEls.length; g++) {
            const el = labelEls[g];
            el.g.style.display = el.n.style.display = el.line.style.display = "none";
          }
          const items = dragState ? [] : labels.slice();
          for (let k = 0; k < items.length && k < labelEls.length; k++) {
            const [i, x, y] = items[k];
            const rawName = p.stations[i]?.name || "";
            const name = rawName.length > 26 ? rawName.slice(0, 26) + "…" : rawName;
            if (!name || i === p.currentIdx || i === nearestRef.idx) continue;
            const w = Math.min(26, name.length) * 6.6 + 16;
            const rect: [number, number, number, number] = [x + 8, y - 34, w, 20];
            if (
              rects.some(
                (r) =>
                  rect[0] < r[0] + r[2] &&
                  rect[0] + rect[2] > r[0] &&
                  rect[1] < r[1] + r[3] &&
                  rect[1] + rect[3] > r[1]
              )
            )
              continue;
            rects.push(rect);
            const el = labelEls[k];
            el.line.style.display = "block";
            el.line.setAttribute("x1", String(x));
            el.line.setAttribute("y1", String(y));
            el.line.setAttribute("x2", String(x + 8));
            el.line.setAttribute("y2", String(y - 18));
            el.g.style.display = "block";
            el.n.style.display = "none";
            el.g.textContent = name;
            el.g.setAttribute("text-anchor", "start");
            el.g.setAttribute("x", String(x + 11));
            el.g.setAttribute("y", String(y - 20));
            el.g.setAttribute("fill", "#f5f1e8");
            el.g.style.opacity = "0.85";
          }
          /* 原站 Ir：环完全展开后，在盘心上方写「城市/州 · 国家 / 附近 N 个台」
             窄屏（<=560）与原站一致不写标题；拖拽中整层不画 */
          if (!dragState && ringOn && ringE > 0.95 && ringList.length && window.innerWidth > 560) {
            const el = labelEls[7];
            const sb = labelEls[8];
            const rs = p.stations[ringList[0]];
            if (el && sb && rs) {
              const cn =
                p.meta.countries[rs.country]?.[p.lang === "zh" ? 1 : 2] || "";
              const title =
                rs.prec <= 2 && rs.state
                  ? rs.state + (p.lang === "zh" ? " · " : ", ") + cn
                  : cn;
              const ctr = new THREE.Vector3(
                ringNormal.x * R,
                ringNormal.y * R,
                ringNormal.z * R
              );
              group.localToWorld(ctr);
              ctr.project(camera);
              if (ctr.z <= 1) {
                const sx = (ctr.x * 0.5 + 0.5) * window.innerWidth;
                const sy = (-ctr.y * 0.5 + 0.5) * window.innerHeight;
                const ty = Math.max(sy - Math.min(window.innerHeight * 0.36, 230), 0);
                el.g.style.display = "block";
                el.line.style.display = el.n.style.display = "none";
                el.g.textContent = title;
                el.g.setAttribute("x", String(sx));
                el.g.setAttribute("y", String(ty));
                el.g.setAttribute("text-anchor", "middle");
                sb.g.style.display = sb.line.style.display = "none";
                sb.n.style.display = "block";
                sb.n.textContent =
                  t(p.lang, "ringN", { n: ringList.length }) +
                  (coarse ? "" : t(p.lang, "ringKeys"));
                sb.n.setAttribute("x", String(sx));
                sb.n.setAttribute("y", String(ty + 16));
                sb.n.setAttribute("text-anchor", "middle");
              }
            }
          }
        } else {
          ann.style.opacity = "0.35";
          for (const el of labelEls) {
            el.g.style.display = el.n.style.display = el.line.style.display = "none";
          }
        }
      }

      if (composer) composer.render();
      else renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      landAbort = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onRingKey, true);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      mat.dispose();
      fftTex.dispose();
      grain?.material.dispose();
      bloom?.dispose();
      composer?.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="gl"
        data-testid="scene-canvas"
        style={{ position: "absolute", inset: 0 }}
      />
      <svg
        ref={annRef}
        className="ann"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", opacity: 0.35 }}
      />
    </>
  );
}
