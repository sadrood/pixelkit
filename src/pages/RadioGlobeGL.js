/**
 * RadioGlobeGL - 用 globe.gl（GitHub 上的开源 3D 地球库）实现的星图
 *
 * 和 RadioGlobe.js 暴露同一套接口，RadioPage 无需关心底层是哪个渲染器：
 *   focus / pickCenter / getLabels / setSelected / pick / setEnergy /
 *   onSettle / setLayout / setFilter / setStations / getFiltered / dispose / debug
 *
 * 视觉：蓝色大理石地球 + 地形凹凸 + 大气光晕 + 星空背景 + 电台光点 + 弧线
 */
const GLOBE_GL_URL = '/vendor/globe/globe.gl.min.js';

/** 11 个分类的颜色（暖色为主，配蓝色地球） */
const GENRE_COLORS = [
  '#e8dcc8', '#ffd9a0', '#ff9e7a', '#8fe8ff', '#dfe8f0',
  '#ffcf8f', '#b8e6a8', '#ffb3c8', '#d8c8ff', '#ffe08a', '#cfe8d8',
];
/** GitHub 风格的青绿点色 */
const GH_POINTS = ['#58a6ff', '#3fb950', '#7ee787', '#39c5cf', '#a5d6ff', '#56d364', '#79c0ff', '#2ea043', '#8b949e', '#56d364', '#6e8a5c'];

let globeLibPromise = null;
function loadGlobeLib() {
  if (window.Globe) return Promise.resolve(window.Globe);
  if (globeLibPromise) return globeLibPromise;
  globeLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GLOBE_GL_URL;
    s.async = true;
    s.onload = () => (window.Globe ? resolve(window.Globe) : reject(new Error('globe.gl 未导出 Globe')));
    s.onerror = () => reject(new Error('globe.gl 加载失败'));
    document.head.appendChild(s);
  });
  return globeLibPromise;
}

export async function createRadioGlobeGL(container, stations, opts = {}) {
  const Globe = await loadGlobeLib();
  const mobile = window.matchMedia('(max-width: 720px)').matches;

  // GitHub 风格：暗色点阵地球（运行时生成点阵纹理，不依赖外部图片）
  const texUrl = makeDotGlobeTexture('#08111d', '#2a4d72');
  const bgUrl = null;

  // 显式宿主：保证 canvas 挂在容器内、尺寸跟随容器（而不是 window）
  container.innerHTML = '';
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1';
  container.appendChild(host);

  const globe = Globe()(host)
    .atmosphereColor('#3f7fbf')
    .atmosphereAltitude(0.18)
    .showAtmosphere(true)
    .pointsMerge(false)
    .pointAltitude(0.001)
    .pointRadius(mobile ? 0.55 : 0.4)
    .pointResolution(6)
    .pointsTransitionDuration(0)
    .pointLat((d) => d.lat)            // 我们的数据字段是 lat/lon，默认读 lng
    .pointLng((d) => d.lon)
    .onPointClick((d) => onPick(d))
    .onPointHover((d) => { if (opts.onHover) opts.onHover(d || null, px, py); });

  try { globe.globeMaterial().color.setHex(0x081421); } catch (e) { /* ignore */ }
  if (texUrl) globe.globeImageUrl(texUrl);
  globe.backgroundColor('#03060a');
  globe.showGraticules(false);
  // 兜底：4 秒后如果地球还是隐藏的，强制显示并退回纯色，绝不黑屏
  setTimeout(() => {
    try {
      const mat = globe.globeMaterial();
      if (!mat.map) mat.color.setHex(0x0b2336);
      const mesh = globe.scene().children.find((c) => c.type === 'Mesh');
      if (mesh) mesh.visible = true;
    } catch (e) { /* ignore */ }
  }, 4000);

  // 控制：拖动旋转、滚轮缩放、缓慢自转
  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.18;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 130;
  controls.maxDistance = 620;

  let px = 0, py = 0;
  container.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; });
  const onPick = (station) => {
    if (!station) return;
    try { opts.onPick && opts.onPick(station); } catch { /* ignore */ }
    setSelected(station);
  };

  let filtered = stations.slice();
  let selected = null;
  let energy = 0;
  const raycaster = null;

  // 缩放分级：远景只显示各国热门台，拉近逐步显示更多（放大后能看到当前国家全部电台）
  let zoomLevel = 0;
  const refreshPoints = () => {
    const perCountry = zoomLevel === 0 ? 10 : zoomLevel === 1 ? 40 : 100000;
    const byCc = new Map();
    for (const s of filtered) {
      const k = s.cc || '??';
      if (!byCc.has(k)) byCc.set(k, []);
      byCc.get(k).push(s);
    }
    const out = [];
    for (const [, arr] of byCc) {
      arr.sort((a, b) => (b.pop || 0) - (a.pop || 0));
      for (let i = 0; i < Math.min(perCountry, arr.length); i++) out.push(arr[i]);
    }
    setPoints(out);
  };
  const setPoints = (list) => {
    globe.pointsData(list).pointColor((d) => GH_POINTS[(d.g || 0) % GH_POINTS.length]);
    // 按人气区分大小；拉近时点变小变圆，避免糊成一片
    const baseR = zoomLevel === 2 ? (mobile ? 0.24 : 0.18) : (mobile ? 0.45 : 0.32);
    globe.pointRadius((d) => baseR + (d.pop || 0) / 9 * (mobile ? 0.14 : 0.12));
    globe.pointResolution(zoomLevel === 2 ? 10 : 6);
  };
  setPoints(filtered);

  // 选中：一圈扩散的光环 + 从当前点到附近几个台的弧线
  const setSelected = (station) => {
    selected = station || null;
    if (!station) { globe.ringsData([]); globe.arcsData([]); return; }
    globe.ringsData([{ lat: station.lat, lon: station.lon }])
      .ringLat((d) => d.lat).ringLng((d) => d.lon)
      .ringColor(() => '#ffd9a0')
      .ringMaxRadius(2.2).ringPropagationSpeed(1.6).ringRepeatPeriod(900);
    // GitHub 风格：从当前台向全球随机台拉出发光弧线
    const pool = filtered.filter((s) => s !== station);
    const arcs = [];
    for (let k = 0; k < 12 && pool.length; k++) {
      const s = pool[Math.floor((k * 7919 + station.lat * 31 + station.lon * 17) % pool.length)];
      arcs.push({ startLat: station.lat, startLng: station.lon, endLat: s.lat, endLng: s.lon });
    }
    globe.arcsData(arcs)
      .arcColor(() => ['rgba(120,190,255,1)', 'rgba(57,197,207,.25)'])
      .arcAltitudeAutoScale(0.5)
      .arcStroke(mobile ? 0.4 : 0.3)
      .arcDashLength(0.32).arcDashGap(0.58).arcDashAnimateTime(2400)
      .arcsTransitionDuration(600);
  };

  try { window.__globeGL = globe; } catch (e) {
    /* ignore */
  }
  // 尺寸跟随容器
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    host.style.width = w + 'px';
    host.style.height = h + 'px';
    globe.width(w).height(h);
  };
  resize();
  requestAnimationFrame(resize);
  setTimeout(resize, 350);
  requestAnimationFrame(() => { resize(); try { globe.renderer().render(globe.scene(), globe.camera()); } catch (e) { /* ignore */ } });
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  let settleCb = null; let settleTimer = null;
  const onStart = () => { if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; } controls.autoRotate = false; };
  let lastZoom = 0;
  controls.addEventListener('change', () => {
    const d = controls.getDistance();
    const lvl = d > 300 ? 0 : d > 215 ? 1 : 2;
    if (lvl !== lastZoom) {
      lastZoom = lvl;
      zoomLevel = lvl;
      clearTimeout(onStart._zoomTimer);
      onStart._zoomTimer = setTimeout(refreshPoints, 260);
    }
  });
  const onEnd = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = null; if (settleCb) { try { settleCb(); } catch { /* ignore */ } } }, 1100);
  };
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);

  // 帧循环：能量驱动光环/光点呼吸
  let raf = 0;
  const pulse = () => {
    raf = requestAnimationFrame(pulse);
    if (selected) {
      const r = (mobile ? 0.6 : 0.45) + (selected.pop || 0) / 9 * 0.16;
      globe.pointRadius((d) => (d === selected ? r * (1.5 + energy * 0.9) : r));
    }
  };
  pulse();

  // 初始视角 + 入场动画：从远处飞入
  globe.pointOfView({ lat: 32, lng: 18, altitude: mobile ? 4.4 : 3.9 }, 0);
  setTimeout(() => {
    try {
      controls.autoRotate = true;
      globe.pointOfView({ lat: 32, lng: 18, altitude: mobile ? 2.4 : 1.9 }, 1900);
      // 光点从无到有地浮现
      let t0 = performance.now();
      const stepFade = () => {
        const t = Math.min(1, (performance.now() - t0) / 1600);
        const k = t * t * (3 - 2 * t);
        globe.pointRadius((d) => ((d.pop || 0) / 9 * 0.12 + 0.32) * (mobile ? 0.8 : 0.7) * k + (d.pop || 0) / 9 * (mobile ? 0.16 : 0.12) * 0.1);
        if (t < 1) requestAnimationFrame(stepFade);
        else refreshPoints();
      };
      stepFade();
    } catch (e) { /* ignore */ }
  }, 260);
  if (localStorage.getItem('pk_globe_style') === 'real') {
    try { globe.globeImageUrl('/vendor/globe/earth-day-small.jpg'); } catch (e) { /* ignore */ }
  }

  const api = {
    isGlobeGL: true,
    focus(station) {
      if (!station) return;
      controls.autoRotate = false;
      globe.pointOfView({ lat: station.lat, lng: station.lon, altitude: Math.max(1.35, controls.getDistance() / 300) }, 900);
    },
    pickCenter() {
      if (!filtered.length) return -1;
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      const geo = globe.toGlobeCoords(w / 2, h / 2);
      if (!geo) return -1;
      const lat = geo.lat, lng = geo.lng;
      let best = -1, bestD = 1e9;
      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i];
        const dLat = (s.lat - lat) * Math.PI / 180;
        const dLng = (((s.lon - lng) + 540) % 360 - 180) * Math.PI / 180;
        const cosLat = Math.cos((s.lat + lat) / 2 * Math.PI / 180);
        const d = dLat * dLat + (dLng * cosLat) * (dLng * cosLat);
        if (d < bestD) { bestD = d; best = i; }
      }
      // 只接受中心 25° 内的最近台
      return Math.sqrt(bestD) * 180 / Math.PI <= 25 ? best : -1;
    },
    getLabels(limit = 8) {
      if (!filtered.length) return [];
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      const cam = globe.camera();
      const geo = globe.toGlobeCoords(w / 2, h / 2);
      if (!geo) return [];
      const out = [];
      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i];
        const dLat = (s.lat - geo.lat) * Math.PI / 180;
        const dLng = (((s.lon - geo.lng) + 540) % 360 - 180) * Math.PI / 180;
        const cosLat = Math.cos((s.lat + geo.lat) / 2 * Math.PI / 180);
        const ang = Math.sqrt(dLat * dLat + (dLng * cosLat) * (dLng * cosLat));
        if (ang > 0.62) continue;
        const c = globe.getCoords(s.lat, s.lon, 0.01);
        if (!c) continue;
        const p = { x: c.x, y: c.y, z: c.z };
        // 手动投影（避免依赖 three 实例）
        const v = projectToScreen(cam, p, w, h);
        if (!v) continue;
        out.push({ i, ang, x: v.x, y: v.y, name: s.name });
      }
      return out.sort((a, b) => a.ang - b.ang).slice(0, limit);
    },
    getNebulaLabels() { return []; },
    setSelected(station) { setSelected(station); },
    pick(index) {
      if (filtered[index]) { setSelected(filtered[index]); try { opts.onPick && opts.onPick(filtered[index]); } catch { /* ignore */ } }
    },
    setEnergy(v) { energy = Math.max(0, Math.min(1, Number(v) || 0)); },
    onSettle(cb) { settleCb = cb; },
    /** 切换地球风格：dots=GitHub 点阵，real=写实卫星 */
    setStyle(style) {
      const st = style === 'real' ? 'real' : 'dots';
      try {
        if (st === 'real') {
          globe.globeImageUrl('/vendor/globe/earth-day-small.jpg');
          globe.backgroundColor('#03060a');
          globe.atmosphereColor('#7fb3ff');
        } else {
          globe.globeImageUrl(makeDotGlobeTexture('#08111d', '#2a4d72'));
          globe.backgroundColor('#03060a');
          globe.atmosphereColor('#3f7fbf');
        }
        const mesh = globe.scene().children.find((c) => c.type === 'Mesh');
        if (mesh) mesh.visible = true;
        localStorage.setItem('pk_globe_style', st);
      } catch (e) { /* ignore */ }
      return st;
    },
    setLayout(mode) {
      if (mode === 'nebula') { container.style.visibility = 'hidden'; return 'nebula'; }
      container.style.visibility = 'visible';
      return 'globe';
    },
    setFilter(pred) {
      filtered = pred ? stations.filter(pred) : stations.slice();
      refreshPoints();
      selected = null;
      return filtered.length;
    },
    setStations(list) {
      stations = Array.isArray(list) ? list : [];
      filtered = stations.slice();
      refreshPoints();
      selected = null;
      return filtered.length;
    },
    getFiltered() { return filtered; },
    debug() { return { mode: 'globe.gl', filtered: filtered.length }; },
    dispose() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      try { if (globe._destructor) globe._destructor(); } catch { /* ignore */ }
      container.innerHTML = '';
    },
  };
  return api;
}

/** 把 THREE 坐标投影到屏幕（不依赖 three 实例，用相机矩阵手算） */
function projectToScreen(camera, p, w, h) {
  if (!camera) return null;
  const cp = camera.position;
  // 用相机的 matrixWorldInverse 与 projectionMatrix
  const m = camera.matrixWorldInverse.elements;
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  const pm = camera.projectionMatrix.elements;
  const cx = pm[0] * x + pm[4] * y + pm[8] * z + pm[12];
  const cy = pm[1] * x + pm[5] * y + pm[9] * z + pm[13];
  const cw = pm[3] * x + pm[7] * y + pm[11] * z + pm[15];
  if (!cw) return null;
  const nx = cx / cw, ny = cy / cw;
  if (nx < -1.2 || nx > 1.2 || ny < -1.2 || ny > 1.2) return null;
  return { x: (nx * 0.5 + 0.5) * w, y: (-ny * 0.5 + 0.5) * h };
}

/** 把图片预取成 objectURL；失败返回 null */
async function fetchObjectUrl(url) {
  try {
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    return null;
  }
}

/** 生成「暗色点阵地球」纹理（GitHub/Octoverse 观感），返回 dataURL */
function makeDotGlobeTexture(bg, dot) {
  const w = 2048, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // 经纬点阵
  for (let y = 6; y < h; y += 9) {
    for (let x = 6; x < w; x += 9) {
      // 越靠两极越暗，制造球体的层次
      const lat = (y / h) * Math.PI - Math.PI / 2;
      const shade = 0.35 + 0.65 * Math.cos(lat);
      ctx.globalAlpha = 0.35 * shade;
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return c.toDataURL('image/png');
}
