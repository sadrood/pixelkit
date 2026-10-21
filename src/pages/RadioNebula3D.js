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

// RoamDial 实测配色（综合/流行/摇滚/电子/新闻谈话/爵士与古典/地方与世界/嘻哈/宗教/运动娱乐/轻松背景）
const GENRE_TINTS = [
  '#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6',
  '#D8B26E', '#E2C35A', '#B7A3D9', '#C8B49A', '#EDE3CC', '#A9C08A',
];

export async function createNebula3D(container, stations, opts = {}) {
  const THREE = await threePromise;
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const onPick = opts.onPick || (() => {});
  const onHover = opts.onHover || (() => {});

  /* ---------- 场景 ---------- */
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 400);
  let camDist = 15, camYaw = 0, camPitch = 0;
  camera.position.set(0, 0, camDist);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden';
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.innerHTML = '';
  container.appendChild(canvas);
  const bloom = document.createElement('canvas');
  bloom.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;filter:blur(14px) saturate(1.25);opacity:.42;z-index:0';
  container.style.position = 'relative';
  container.appendChild(bloom);
  const bctx = bloom.getContext('2d');

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
  // 方位：综合中央偏右最大；新闻左上、地方与世界右上、流行右下、摇滚下中、电子右中…
  const LAYOUT = [
    { x: 1.4, y: -0.2, z: 0.6, r: 1.25 },  // 0 综合（最大）
    { x: 2.6, y: -1.6, z: 0.2, r: 0.95 },  // 1 流行
    { x: 0.4, y: -2.4, z: 0.9, r: 0.8 },   // 2 摇滚
    { x: 3.2, y: 0.2, z: -0.6, r: 0.85 },  // 3 电子
    { x: -2.8, y: 1.8, z: 1.1, r: 0.9 },   // 4 新闻谈话
    { x: -2.9, y: 0.1, z: -0.9, r: 0.8 },  // 5 爵士与古典
    { x: 2.8, y: 1.9, z: 0.3, r: 0.85 },   // 6 地方与世界
    { x: -1.3, y: -0.5, z: 1.6, r: 0.75 }, // 7 嘻哈
    { x: 1.1, y: 1.2, z: 1.7, r: 0.8 },    // 8 宗教
    { x: 1.9, y: -0.9, z: -1.9, r: 0.7 },  // 9 运动与娱乐
    { x: 0.2, y: 2.5, z: -0.4, r: 0.75 },  // 10 轻松背景
  ];
  const centers = [];
  for (let g = 0; g < nGenre; g++) {
    const L = LAYOUT[g % LAYOUT.length];
    centers.push(new THREE.Vector3(L.x, L.y, L.z));
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
    const b = (((h >>> 13) % 10000) / 10000);
    return (a + b + a * b - 1.0) * 1.2;
  };

  /* ---------- 粒子场 ---------- */
  const dotTex = makeBokeh(THREE, 0.7);
  let points = null;
  let stationsRef = [];
  let posArr = null;
  let counts = new Array(nGenre).fill(0);
  let skyClusters = [];

  function rebuild(list) {
    stationsRef = list.slice();
    const n = stationsRef.length;
    const count = n;
    const pos = new Float32Array(count * 3);
    const cent = new Float32Array(count * 3);
    const rank = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    counts = new Array(nGenre).fill(0);
    const tmp = new THREE.Color();
    // §5.3 Sky：电台节点按国家分组，布局可复现（顺序固定、不随机漂移）
    const groups = new Map();
    for (const s of stationsRef) { const k = s.cc || '??'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const order = [...groups.entries()].sort((a, b) => (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : 1));
    const countryCenters = new Map();
    order.forEach(([cc, arr], idx) => {
      const ang = idx * 2.39996;
      const radius = 3.0 + Math.sqrt(idx + 1) * 1.35;
      countryCenters.set(cc, { v: new THREE.Vector3(Math.cos(ang) * radius, Math.sin(idx * 0.9) * 1.8, Math.sin(ang) * radius), n: arr.length });
    });
    skyClusters = order.map(([cc, arr]) => ({ cc, count: arr.length, v: countryCenters.get(cc).v }));
    for (let i = 0; i < n; i++) {
      const s = stationsRef[i];
      const g = (s.g || 0) % nGenre;
      counts[g] += 1;
      const ccGroup = countryCenters.get(s.cc || '??') || { v: new THREE.Vector3(0, 0, 0), n };
      const c = ccGroup.v;
      const h = hash(s.id || s.name);
      const spread = 0.5 + Math.sqrt(ccGroup.n) * 0.05;
      pos[i * 3] = c.x + gauss(h) * spread;
      pos[i * 3 + 1] = c.y + gauss(h >> 5) * spread * 0.9;
      pos[i * 3 + 2] = c.z + gauss(h >> 11) * spread * 1.25;
      cent[i * 3] = c.x; cent[i * 3 + 1] = c.y; cent[i * 3 + 2] = c.z;
      rank[i] = (i % 997) / 997;
      tmp.set(GENRE_TINTS[g]).convertSRGBToLinear();
      // 更淡：向暖白混合 40%
      tmp.lerp(new THREE.Color(1, 0.96, 0.9), 0.4);
      const popK = 0.45 + ((s.pop || 0) / 9) * 0.45;
      tmp.multiplyScalar(popK);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      size[i] = 0.17 + ((h >>> 17) % 100) / 100 * 0.26;
      phase[i] = ((h >>> 7) % 1000) / 1000 * Math.PI * 2;
    }
    posArr = pos;
    if (points) { scene.remove(points); points.geometry.dispose(); points.material.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aCent', new THREE.BufferAttribute(cent, 3));
    geo.setAttribute('aRank', new THREE.BufferAttribute(rank, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: dotTex },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uScale: { value: 320 },
        uCamDist: { value: 15 },
        uHole: { value: new THREE.Vector3(999, 999, 999) },
        uHoleOn: { value: 0 },
        uExpand: { value: 0 },
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
        uniform float uCamDist;
        uniform vec3 uHole;
        uniform float uHoleOn;
        uniform float uExpand;
        attribute vec3 aCent;
        attribute float aRank;
        void main() {
          vColor = color;
          // §5.3 城市螺旋展开：放大时节点绕所属国家中心螺旋散开
          vec3 local = position - aCent;
          float rr = length(local.xz);
          float ang = atan(local.z, local.x) + uExpand * (1.9 - rr * 0.03) + aRank * 0.15;
          float rr2 = rr * (1.0 + uExpand * 1.35) + uExpand * 0.35;
          vec3 sp = aCent + vec3(cos(ang) * rr2, local.y * (1.0 + uExpand * 0.25), sin(ang) * rr2);
          vec4 mv = modelViewMatrix * vec4(sp, 1.0);
          float dist = -mv.z;
          vec3 wp = (modelMatrix * vec4(sp, 1.0)).xyz;
          vec3 toHole = uHole - wp;
          float hd = length(toHole);
          float pull = uHoleOn * smoothstep(5.0, 0.0, hd);
          vec3 dir = normalize(toHole + vec3(0.0001));
          vec3 tangent = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
          vec3 moved = position + (dir * pull * 2.2 + tangent * pull * 1.5);
          mv = modelViewMatrix * vec4(moved, 1.0);
          dist = -mv.z;
          float tw = 0.72 + 0.28 * sin(uTime * 1.6 + aPhase) + uEnergy * 0.25;
          gl_Position = projectionMatrix * mv;
          float s = aSize * (1.0 + uEnergy * 0.5);
          float cap = mix(30.0, 6.5, smoothstep(6.0, 2.0, uCamDist));
          gl_PointSize = min(cap, s * (560.0 / max(dist, 0.35)));
          // 远处淡去、近处（贴镜头）也变淡，避免完全挡住视线
          vAlpha = 0.52 * tw * smoothstep(0.8, 2.2, dist) * mix(1.0, smoothstep(0.2, 1.6, hd), uHoleOn) * (1.0 - smoothstep(24.0, 70.0, dist) * 0.35);
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

  const pointers = new Map();
  let pinchStart = 0, pinchD0 = 0;
  const onDown = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchD0 = camDist; dragging = false; return; }
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    lastInteract = Date.now(); canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart > 0 && d > 0) { camDist = Math.max(0.7, Math.min(46, pinchD0 * (pinchStart / d))); lastInteract = Date.now(); }
      return;
    }
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
    pointers.delete(e.pointerId);
    if (pointers.size === 1) { const p1 = [...pointers.values()][0]; lastX = p1.x; lastY = p1.y; dragging = true; return; }
    pinchStart = 0;
    dragging = false; canvas.style.cursor = 'grab';
    if (moved >= 6) {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settleTimer = null; if (!dragging && settleCb) { try { settleCb(); } catch { /* ignore */ } } }, 1100);
      return;
    }
    const i = pickAt(e.clientX, e.clientY, false);
    if (i >= 0) { onPick(stationsRef[i], i); lastInteract = Date.now(); }
  };
  // 跟随鼠标的黑洞已停用：黑洞属于「粒子唱片/星盘」下方
  const setHole = () => { if (points) points.material.uniforms.uHoleOn.value = 0; };
  let wheelTimer = null;
  const onWheel = (e) => {
    e.preventDefault();
    camDist = Math.max(0.7, Math.min(46, camDist * (e.deltaY > 0 ? 1.12 : 0.89)));
    lastInteract = Date.now();
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = null;
      if (!dragging && settleCb) { try { settleCb(); } catch { /* ignore */ } }
    }, 700);
  };
  canvas.addEventListener('pointermove', (e) => { if (e.buttons === 0) setHole(e.clientX, e.clientY); });
  canvas.addEventListener('pointerleave', () => { if (points) points.material.uniforms.uHoleOn.value = 0; });
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
    const top = skyClusters.slice(0, 14);
    for (let k = 0; k < top.length; k++) {
      const cl = top[k];
      tmpV.copy(cl.v).applyMatrix4(camera.matrixWorldInverse);
      if (tmpV.z > -1) continue;
      tmpV.applyMatrix4(camera.projectionMatrix);
      out.push({ i: k, name: cl.cc, x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, count: cl.count || 0 });
    }
    return out;
  }

  /* ---------- 尺寸 / 动画 ---------- */
  let raf = 0, disposed = false;
  let flyT = 1, flyFrom = 15, flyTo = 15, flyDur = 0.9;
  let nearTween = null;
  const clock = new THREE.Clock();
  const resize = () => {
    const host = container.closest('#radio-stage') || container;
    const w = host.clientWidth || container.clientWidth || window.innerWidth;
    const h = host.clientHeight || container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bloom.width = Math.max(2, Math.round(w / 2));
    bloom.height = Math.max(2, Math.round(h / 2));
  };
  resize();
  requestAnimationFrame(resize);
  setTimeout(resize, 400);
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = performance.now() / 1000;
    if (nearTween) {
      camDist += (nearTween.dist - camDist) * 0.14;
      camYaw += (nearTween.yaw - camYaw) * 0.14;
      camPitch += (nearTween.pitch - camPitch) * 0.14;
      if (Math.abs(nearTween.dist - camDist) < 0.05 && Math.abs(nearTween.yaw - camYaw) < 0.01) nearTween = null;
    }
    if (flyT < 1) {
      flyT = Math.min(1, flyT + dt / Math.max(0.001, flyDur));
      const e = flyT * flyT * (3 - 2 * flyT);
      camDist = flyFrom + (flyTo - flyFrom) * e;
    }
    if (!dragging && Date.now() - lastInteract > 4000) camYaw += dt * 0.02;
    // 相机绕原点
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    camera.position.set(Math.sin(camYaw) * cp * camDist, sp * camDist, Math.cos(camYaw) * cp * camDist);
    camera.lookAt(0, 0, 0);
    bgStars.rotation.y += dt * 0.004;
    if (points) {
      points.material.uniforms.uTime.value = t;
    points.material.uniforms.uCamDist.value = camDist;
    points.material.uniforms.uExpand.value = Math.max(0, Math.min(1, (18 - camDist) / 13));
      points.rotation.y = Math.sin(t * 0.05) * 0.04;
    }
    renderer.render(scene, camera);
    try { bctx.clearRect(0, 0, bloom.width, bloom.height); bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height); } catch { /* ignore */ }
  };
  tick();

  return {
    mode: 'nebula3d',
    resize,
    /** 快速贴近某个电台所在星团 */
    flyToStation(st) {
      if (!st) return;
      const g = Math.max(0, Math.min(10, st.g || 0));
      const L = LAYOUT[g % LAYOUT.length];
      const dist = Math.sqrt(L.x * L.x + L.z * L.z);
      nearTween = {
        dist: 2.6,
        yaw: Math.atan2(L.x, L.z),
        pitch: Math.atan2(L.y, dist || 1),
      };
    },
    /** 从远处飞入星云 */
    enter(dur = 1.1) {
      flyFrom = 46;
      flyTo = 15;
      flyT = 0;
      flyDur = dur;
      camDist = flyFrom;
      camYaw = 0.1;
      camPitch = 0.05;
    },
    setOpacity(v) {
      canvas.style.opacity = String(Math.max(0, Math.min(1, Number(v))));
    },
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
      camDist = Math.max(2.6, Math.min(26, len * 1.1 + 2.4));
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
