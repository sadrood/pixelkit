/**
 * RadioNebula3D - 真 3D 流派星云（three.js 粒子场）
 *
 * 和 RoamDial 一致：11 个流派星团分布在有纵深的 3D 空间里；
 * 相机可以旋转/拉近，靠近镜头的粒子会变大变糊（bokeh 贴镜头），
 * 远处保持细小星尘，整体缓慢漂移 + 随音乐呼吸。
 */
const THREE_URL = '/night-market/vendor/three.module.js';
/** 模块加载时就开始拉 three，避免切换星云时干等 */
const threePromise = import(/* @vite-ignore */ THREE_URL);

const GENRE_TINTS = [
  '#ffe9c9', '#ffd28f', '#ff9f7a', '#9fe8ff', '#dfe8f0',
  '#ffcf8f', '#b8e6a8', '#ffb3c8', '#d8c8ff', '#ffe08a', '#cfe8d8',
];

export async function createNebula3D(container, stations, opts = {}) {
  const THREE = await threePromise;
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const onPick = opts.onPick || (() => {});
  const onHover = opts.onHover || (() => {});

  /* ---------- 场景 ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070504);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 400);
  let camDist = 15, camYaw = 0, camPitch = 0;
  camera.position.set(0, 0, camDist);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x070504, 1);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.innerHTML = '';
  container.appendChild(canvas);

  /* ---------- 远景星尘 ---------- */
  const bgStars = (() => {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 40 + Math.random() * 90;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      c.setHSL(0.09 + Math.random() * 0.08, 0.4, 0.35 + Math.random() * 0.4);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      map: makeBokeh(THREE), size: 0.5, transparent: true, opacity: 0.55,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const p = new THREE.Points(g, m);
    scene.add(p);
    return p;
  })();

  /* ---------- 星团布局 ---------- */
  const nGenre = (opts.genres && opts.genres.length) || 11;
  const centers = [];
  for (let g = 0; g < nGenre; g++) {
    // 横向铺开 + 纵深错落（有 z 才能有视差/贴镜头）
    const x = (g - (nGenre - 1) / 2) * 4.4;
    const y = Math.sin(g * 1.7) * 2.3;
    const z = Math.cos(g * 1.15) * 3.4;
    centers.push(new THREE.Vector3(x, y, z));
  }

  const hash = (s) => {
    let h = 0;
    const t = String(s || '');
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return h;
  };
  const gauss = (h) => {
    // 两个均匀数近似高斯
    const a = ((h % 10000) / 10000);
    const b = (((h >> 13) % 10000) / 10000);
    return (a + b + a * b - 1.0) * 1.2;
  };

  /* ---------- 粒子场 ---------- */
  const dotTex = makeBokeh(THREE, 0.7);
  let points = null;
  let stationsRef = [];
  let posArr = null;
  let counts = new Array(nGenre).fill(0);

  function rebuild(list) {
    stationsRef = list.slice();
    const n = stationsRef.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    counts = new Array(nGenre).fill(0);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = stationsRef[i];
      const g = (s.g || 0) % nGenre;
      counts[g] += 1;
      const c = centers[g];
      const h = hash(s.id || s.name);
      // 星团半径随该团台数增长
      const spread = 0.85 + Math.sqrt(counts[g] || 1) * 0.095;
      pos[i * 3] = c.x + gauss(h) * spread;
      pos[i * 3 + 1] = c.y + gauss(h >> 5) * spread * 0.9;
      pos[i * 3 + 2] = c.z + gauss(h >> 11) * spread * 1.25;
      tmp.set(GENRE_TINTS[g]).convertSRGBToLinear();
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      size[i] = 0.14 + ((h >> 17) % 100) / 100 * 0.22;
      phase[i] = ((h >> 7) % 1000) / 1000 * Math.PI * 2;
    }
    posArr = pos;
    if (points) { scene.remove(points); points.geometry.dispose(); points.material.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: dotTex },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uScale: { value: 320 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        uniform float uEnergy;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = -mv.z;
          float tw = 0.72 + 0.28 * sin(uTime * 1.6 + aPhase) + uEnergy * 0.25;
          gl_Position = projectionMatrix * mv;
          float s = aSize * (1.0 + uEnergy * 0.5);
          gl_PointSize = s * (560.0 / max(dist, 0.35));
          // 远处淡去、近处（贴镜头）也变淡，避免完全挡住视线
          vAlpha = tw * smoothstep(0.8, 2.2, dist) * (1.0 - smoothstep(24.0, 70.0, dist) * 0.35);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }
      `,
    });
    points = new THREE.Points(geo, mat);
    scene.add(points);
  }
  rebuild(stations);

  /* ---------- 交互（旋转 / 拉近 / 拾取） ---------- */
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = Date.now();
  let settleCb = null, settleTimer = null;
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();

  const onDown = (e) => {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    lastInteract = Date.now(); canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    if (!dragging) {
      // 悬停提示
      const i = pickAt(e.clientX, e.clientY, true);
      onHover(i >= 0 ? stationsRef[i] : null, e.clientX, e.clientY);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    camYaw -= dx * 0.0035;
    camPitch = Math.max(-1.1, Math.min(1.1, camPitch - dy * 0.003));
    lastInteract = Date.now();
  };
  const onUp = (e) => {
    dragging = false; canvas.style.cursor = 'grab';
    if (moved >= 6) {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settleTimer = null; if (!dragging && settleCb) { try { settleCb(); } catch { /* ignore */ } } }, 1100);
      return;
    }
    const i = pickAt(e.clientX, e.clientY, false);
    if (i >= 0) { onPick(stationsRef[i], i); lastInteract = Date.now(); }
  };
  const onWheel = (e) => {
    e.preventDefault();
    camDist = Math.max(2.2, Math.min(46, camDist * (e.deltaY > 0 ? 1.12 : 0.89)));
    lastInteract = Date.now();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /* ---------- 拾取 ---------- */
  function project(i, w, h) {
    tmpV.set(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
    tmpV.applyMatrix4(camera.matrixWorldInverse);
    if (tmpV.z > -0.4) return null;       // 相机后面
    tmpV.applyMatrix4(camera.projectionMatrix);
    return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, depth: -tmpV.z };
  }
  function pickAt(cx, cy, loose) {
    if (!posArr) return -1;
    const r = canvas.getBoundingClientRect();
    const w = r.width || 1, h = r.height || 1;
    const x = cx - r.left, y = cy - r.top;
    let best = -1, bestD = (loose ? 14 : 20);
    for (let i = 0; i < stationsRef.length; i++) {
      const p = project(i, w, h);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ---------- 标签（星团中心投影） ---------- */
  function getClusterLabels() {
    const r = canvas.getBoundingClientRect();
    const w = r.width || 1, h = r.height || 1;
    const out = [];
    for (let g = 0; g < nGenre; g++) {
      tmpV.copy(centers[g]).applyMatrix4(camera.matrixWorldInverse);
      if (tmpV.z > -1) continue;
      tmpV.applyMatrix4(camera.projectionMatrix);
      out.push({ i: g, x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, count: counts[g] || 0 });
    }
    return out;
  }

  /* ---------- 尺寸 / 动画 ---------- */
  let raf = 0, disposed = false;
  const clock = new THREE.Clock();
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = performance.now() / 1000;
    if (!dragging && Date.now() - lastInteract > 4000) camYaw += dt * 0.02;
    // 相机绕原点
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    camera.position.set(Math.sin(camYaw) * cp * camDist, sp * camDist, Math.cos(camYaw) * cp * camDist);
    camera.lookAt(0, 0, 0);
    bgStars.rotation.y += dt * 0.004;
    if (points) {
      points.material.uniforms.uTime.value = t;
      points.rotation.y = Math.sin(t * 0.05) * 0.04;
    }
    renderer.render(scene, camera);
  };
  tick();

  return {
    mode: 'nebula3d',
    setStations(list) { rebuild(Array.isArray(list) ? list : []); },
    setFilter(pred) { rebuild(pred ? stations.filter(pred) : stations); return stationsRef.length; },
    setEnergy(v) { if (points) points.material.uniforms.uEnergy.value = Math.max(0, Math.min(1, Number(v) || 0)); },
    onSettle(cb) { settleCb = cb; },
    pickCenter() {
      const r = canvas.getBoundingClientRect();
      const i = pickAt(r.left + r.width / 2, r.top + r.height / 2, false);
      return i;
    },
    focus(station) {
      if (!station) return;
      const g = (station.g || 0) % nGenre;
      const c = centers[g];
      const len = c.length() || 1;
      camYaw = Math.atan2(c.x, c.z);
      camPitch = Math.max(-0.9, Math.min(0.9, Math.asin(c.y / len)));
      camDist = Math.max(4, Math.min(26, len * 1.4 + 4));
      lastInteract = Date.now();
    },
    getClusterLabels,
    debug() { return { mode: 'nebula3d', n: stationsRef.length, camDist, camYaw, camPitch }; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      try { if (points) { points.geometry.dispose(); points.material.dispose(); } } catch { /* ignore */ }
      try { dotTex.dispose(); } catch { /* ignore */ }
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/** 柔和 bokeh 贴图 */
function makeBokeh(THREE, inner = 0.8) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, `rgba(255,255,255,${inner})`);
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
