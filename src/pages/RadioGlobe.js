/**
 * RadioGlobe v5 - RoamSky 星图（逆向 roamdial 后的实现）
 *
 * 特点：
 *  - 暖黑背景 + bokeh 柔光星点（additive），没有地球贴图，靠点阵的疏密"画"出大陆
 *  - 台名标签：把准星附近（角度最小）的若干台投影到屏幕上，由页面用 HTML 显示
 *  - 两种布局：globe（经纬度球面）/ nebula（按流派聚成星云）
 *  - 交互：拖动旋转、滚轮远近、准星停稳回调、点击拾取、能量呼吸
 */
const THREE_URL = '/night-market/vendor/three.module.js';

/** 11 个分类的配色（暖色调为主，少量青色点缀，接近 roamdial 的星图观感） */
const GENRE_COLORS = [
  0xe8dcc8, // 综合
  0xffd9a0, // 流行
  0xff9e7a, // 摇滚
  0x8fe8ff, // 电子
  0xdfe8f0, // 新闻谈话
  0xffcf8f, // 爵士与古典
  0xb8e6a8, // 地方与世界
  0xffb3c8, // 嘻哈节奏
  0xd8c8ff, // 宗教
  0xffe08a, // 运动与娱乐
  0xcfe8d8, // 轻松背景
];

export async function createRadioGlobe(container, stations, opts = {}) {
  const THREE = await import(/* @vite-ignore */ THREE_URL);
  const onPick = opts.onPick || (() => {});
  const mobile = window.matchMedia('(max-width: 720px)').matches;

  /* ---------- 场景 ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14100d);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
  camera.position.set(0, 0, mobile ? 3.0 : 2.55);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x14100d, 1);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.appendChild(canvas);

  const world = new THREE.Group();
  world.rotation.y = 0.6;
  /* ---------- 陆地点阵（暗点把陆地画出来） ---------- */
  let landPoints = null;
  const landDots = [];
  const LAND_R = 0.9975;
  const toVec3Radius = (lat, lon, r) => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  };
  function buildLandLayer(m) {
    const { cols, rows, step, mask } = m;
    const bin = atob(mask);
    const bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    const total = cols * rows;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const land = (bits[idx >> 3] >> (idx & 7)) & 1;
        const lat = 90 - (r + 0.5) * step;
        const lon = -180 + (c + 0.5) * step;
        const v = toVec3Radius(lat, lon, LAND_R);
        pos[idx * 3] = v.x; pos[idx * 3 + 1] = v.y; pos[idx * 3 + 2] = v.z;
        // 目标颜色按 sRGB 指定，再转线性（否则会被 sRGB 输出提亮成一片白点）
        if (land) { tmpC.setRGB(0.50, 0.68, 0.56).convertSRGBToLinear(); }
        else { tmpC.setRGB(0.055, 0.115, 0.095).convertSRGBToLinear(); }
        col[idx * 3] = tmpC.r; col[idx * 3 + 1] = tmpC.g; col[idx * 3 + 2] = tmpC.b;
        landDots.push({ lat, lon, land });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    landPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.0055, vertexColors: true, transparent: true, opacity: 0.95,
      sizeAttenuation: true, depthWrite: false,
    }));
    world.add(landPoints);
  }
  fetch('/data/land-mask.json', { cache: 'force-cache' })
    .then((r) => r.json())
    .then(buildLandLayer)
    .catch(() => { /* 没有掩膜就只显示星点 */ });
  scene.add(world);

  /* ---------- 星空 ---------- */
  const STAR_N = 1800;
  const sPos = new Float32Array(STAR_N * 3);
  const sCol = new Float32Array(STAR_N * 3);
  const tmpC = new THREE.Color();
  for (let i = 0; i < STAR_N; i++) {
    const r = 4 + Math.random() * 6;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    sPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    sPos[i * 3 + 1] = r * Math.cos(ph);
    sPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    tmpC.setHSL(0.09 + Math.random() * 0.06, 0.35, 0.55 + Math.random() * 0.3);
    sCol[i * 3] = tmpC.r; sCol[i * 3 + 1] = tmpC.g; sCol[i * 3 + 2] = tmpC.b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const bokeh = makeBokehTexture(THREE, 0.9);
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    map: bokeh, size: 0.035, transparent: true, opacity: 0.5, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(stars);

  /* ---------- 坐标换算 ---------- */
  const toVec3 = (lat, lon, r) => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  };
  const hashOf = (s) => {
    let h = 0;
    const t = String(s.id || s.name || '');
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return h;
  };

  /* ---------- 布局 + 重建 ---------- */
  let layout = 'globe';
  let nebulaCenters = [];
  let nebulaCounts = [];
  let morph = null;              // 地球↔星云的位置渐变
  const RADIUS = 1.0;
  let filtered = stations.slice();
  let pointGeo = null;
  let dotTex = null;
  let points = null;
  let selectedMesh = null;
  let hoverIndex = -1;
  let hoverRing = null;
  let hoverCb = opts.onHover || null;

  function computePositions(list) {
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    if (layout === 'globe') {
      for (let i = 0; i < n; i++) {
        const s = list[i];
        const v = toVec3(s.lat, s.lon, RADIUS * 1.005);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        tmpC.setHex(GENRE_COLORS[(s.g || 0) % GENRE_COLORS.length]);
        col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
      }
    } else {
      // 流派星云：11 个星团横向排成一条"银河带"（和 roamdial 一致）
      const G = GENRE_COLORS.length;
      nebulaCounts = new Array(G).fill(0);
      for (const s of list) nebulaCounts[(s.g || 0) % G] += 1;
      const maxCount = Math.max(1, ...nebulaCounts);
      nebulaCenters = [];
      for (let g = 0; g < G; g++) {
        // 平铺在一条水平带上（z 固定 0），保证投影后不重叠
        nebulaCenters.push(new THREE.Vector3(
          (g - (G - 1) / 2) * 0.50,
          Math.sin(g * 0.95) * 0.14,
          0
        ));
      }
      for (let i = 0; i < n; i++) {
        const s = list[i];
        const g = (s.g || 0) % G;
        const c = nebulaCenters[g];
        const h = hashOf(s);
        const spread = 0.075 + 0.105 * Math.sqrt(nebulaCounts[g] / maxCount);
        const a = (h % 1024) / 1024 * Math.PI * 2;
        const rr = Math.pow(((h >> 10) % 1024) / 1024, 0.55) * spread;
        const zz = ((((h >> 20) % 1024) / 1024) - 0.5) * spread * 1.4;
        pos[i * 3] = c.x + Math.cos(a) * rr;
        pos[i * 3 + 1] = c.y + Math.sin(a) * rr * 0.75;
        pos[i * 3 + 2] = c.z + zz;
        tmpC.setHex(GENRE_COLORS[g]);
        col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
      }
    }
    return { pos, col };
  }

  function applyColors() {
    if (!pointGeo) return;
    const col = pointGeo.attributes.color.array;
    for (let i = 0; i < filtered.length; i++) {
      tmpC.setHex(GENRE_COLORS[(filtered[i].g || 0) % GENRE_COLORS.length]);
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    }
    pointGeo.attributes.color.needsUpdate = true;
  }

  function rebuild() {
    if (points) { world.remove(points); points.geometry.dispose(); points.material.dispose(); }
    const { pos, col } = computePositions(filtered);
    pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pointGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!dotTex) dotTex = makeBokehTexture(THREE, 0.85);
    points = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      map: dotTex, size: mobile ? 0.05 : 0.036, transparent: true, opacity: 0.92,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    world.add(points);
  }
  rebuild();

  /* ---------- 选中标记 ---------- */
  function ensureSelectedMesh() {
    if (selectedMesh) return selectedMesh;
    selectedMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.026, 0.032, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    world.add(selectedMesh);
    return selectedMesh;
  }

  let selectedIndex = -1;
  function setSelectedIndex(i) {
    selectedIndex = i;
    if (i < 0 || !filtered[i]) { if (selectedMesh) selectedMesh.visible = false; return; }
    const arr = pointGeo.attributes.position.array;
    const v = new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    const m = ensureSelectedMesh();
    m.visible = true;
    m.position.copy(v);
    m.lookAt(v.clone().multiplyScalar(2));
  }

  /* ---------- 交互 ---------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = mobile ? 0.05 : 0.04;
  const ndc = new THREE.Vector2();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = Date.now();
  let settleCb = null, settleTimer = null;
  let focusTarget = null;

  const setNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  const hitTest = (e) => {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(points, false);
    return hits.length ? hits[0].index : -1;
  };
  const onDown = (e) => {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    lastInteract = Date.now(); canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    if (!dragging) {
      // 悬停：命中星点就放大高亮 + 回调给页面显示台名
      const hi = hitTest(e);
      if (hi !== hoverIndex) {
        hoverIndex = hi;
        canvas.style.cursor = hi >= 0 ? 'pointer' : 'grab';
        if (hi >= 0) {
          const arr = pointGeo.attributes.position.array;
          const v = new THREE.Vector3(arr[hi * 3], arr[hi * 3 + 1], arr[hi * 3 + 2]);
          if (!hoverRing) {
            hoverRing = new THREE.Mesh(
              new THREE.RingGeometry(0.02, 0.026, 28),
              new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
            );
            world.add(hoverRing);
          }
          hoverRing.position.copy(v);
          hoverRing.visible = true;
        } else if (hoverRing) hoverRing.visible = false;
        if (hoverCb) { try { hoverCb(hi >= 0 ? filtered[hi] : null, e.clientX, e.clientY); } catch { /* ignore */ } }
      } else if (hi >= 0 && hoverCb) {
        try { hoverCb(filtered[hi], e.clientX, e.clientY); } catch { /* ignore */ }
      }
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    world.rotation.y += dx * 0.005;
    world.rotation.x = Math.max(-1.1, Math.min(1.1, world.rotation.x + dy * 0.004));
    lastInteract = Date.now();
  };
  const onUp = (e) => {
    dragging = false; canvas.style.cursor = 'grab';
    if (moved >= 6) {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!dragging && settleCb) { try { settleCb(); } catch { /* ignore */ } }
      }, 1100);
      return;
    }
    const i = hitTest(e);
    if (i >= 0) {
      setSelectedIndex(i);
      onPick(filtered[i], i);
      lastInteract = Date.now();
    }
  };
  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(1.35, Math.min(5.2, camera.position.z + (e.deltaY > 0 ? 0.16 : -0.16)));
    lastInteract = Date.now();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerleave', () => {
    if (hoverIndex >= 0) {
      hoverIndex = -1;
      if (hoverRing) hoverRing.visible = false;
      canvas.style.cursor = 'grab';
      if (hoverCb) { try { hoverCb(null, 0, 0); } catch { /* ignore */ } }
    }
  });

  /* ---------- 尺寸 ---------- */
  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  let ro = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(container); }

  /* ---------- 动画 ---------- */
  let raf = 0, disposed = false, energy = 0;
  const clock = new THREE.Clock();
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    stars.rotation.y += dt * 0.004;

    if (focusTarget) {
      const dy = Math.atan2(Math.sin(focusTarget.y - world.rotation.y), Math.cos(focusTarget.y - world.rotation.y));
      world.rotation.y += dy * 0.09;
      world.rotation.x += (focusTarget.x - world.rotation.x) * 0.09;
      if (Math.abs(dy) < 0.006) focusTarget = null;
    } else if (layout === 'globe' && !dragging && Date.now() - lastInteract > 3500) {
      world.rotation.y += dt * 0.04;
    }

    if (points) {
      const wantOpacity = layout === 'nebula' ? 0.62 : 0.92;
      points.material.opacity += (wantOpacity - points.material.opacity) * 0.12;
      const want = (mobile ? 0.05 : 0.036) * (1 + energy * 0.55);
      points.material.size += (want - points.material.size) * 0.15;
    }
    if (morph) {
      morph.t += dt / morph.dur;
      const t = Math.min(1, morph.t);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const arr = pointGeo.attributes.position.array;
      const from = morph.from, to = morph.to;
      for (let i = 0; i < arr.length; i++) arr[i] = from[i] + (to[i] - from[i]) * e;
      pointGeo.attributes.position.needsUpdate = true;
      if (t >= 1) morph = null;
    }
    if (selectedMesh && selectedMesh.visible) {
      const p = 1 + Math.sin(performance.now() / 420) * 0.18;
      selectedMesh.scale.set(p, p, 1);
    }
    if (hoverRing && hoverRing.visible) {
      const hp = 1 + Math.sin(performance.now() / 260) * 0.22 + energy * 0.2;
      hoverRing.scale.set(hp, hp, 1);
    }
    if (landPoints) {
      landPoints.material.opacity = 0.85 + energy * 0.12;
    }
    // 星云布局：整体缓慢漂移 + 星团随音乐轻微起伏
    if (layout === 'nebula' && !morph && points) {
      const now = performance.now();
      points.rotation.y = Math.sin(now / 7000) * 0.045;
      points.rotation.x = Math.cos(now / 9000) * 0.02;
      points.rotation.z = Math.sin(now / 6000) * 0.02;
    }
    renderer.render(scene, camera);
  };
  tick();

  /* ---------- 对外接口 ---------- */
  return {
    focus(station) {
      if (!station) return;
      const theta = (station.lon + 180) * Math.PI / 180;
      focusTarget = { y: Math.PI / 2 - theta, x: Math.max(-0.9, Math.min(0.9, -(station.lat || 0) * Math.PI / 180 * 0.9)) };
      lastInteract = Date.now();
    },
    pickCenter() {
      if (!filtered.length) return -1;
      const camLocal = camera.position.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
      const arr = pointGeo.attributes.position.array;
      let best = -1, bestAng = 0.62;
      const v = new THREE.Vector3();
      for (let i = 0; i < filtered.length; i++) {
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
        const ang = Math.acos(Math.max(-1, Math.min(1, v.clone().normalize().dot(camLocal.clone().sub(v).normalize()))));
        if (ang < bestAng) { bestAng = ang; best = i; }
      }
      return best;
    },
    getLabels(limit = 6) {
      if (!filtered.length) return [];
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const camLocal = camera.position.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
      const arr = pointGeo.attributes.position.array;
      const v = new THREE.Vector3();
      const out = [];
      for (let i = 0; i < filtered.length; i++) {
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
        const n = v.clone().normalize();
        const toCam = camLocal.clone().sub(v).normalize();
        if (n.dot(toCam) < 0.06) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, n.dot(toCam))));
        if (ang > (layout === 'nebula' ? 1.25 : 1.15)) continue;
        const p = v.clone().applyMatrix4(world.matrixWorld).project(camera);
        out.push({ i, ang, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, name: filtered[i].name });
      }
      return out.sort((a, b) => a.ang - b.ang).slice(0, limit);
    },
    setSelected(station) {
      const i = station ? filtered.findIndex((s) => s.id === station.id) : -1;
      setSelectedIndex(i);
    },
    pick(index) { if (filtered[index]) { setSelectedIndex(index); onPick(filtered[index], index); } },
    probe() {
      const arr = pointGeo.attributes.position.array;
      const camLocal = camera.position.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
      const v = new THREE.Vector3();
      let front = 0, angled = 0; const samples = [];
      for (let i = 0; i < Math.min(filtered.length, 4000); i++) {
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
        const n = v.clone().normalize();
        const toCam = camLocal.clone().sub(v).normalize();
        const dot = n.dot(toCam);
        if (dot < 0.12) continue;
        front += 1;
        const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (ang > 0.42) continue;
        angled += 1;
        if (samples.length < 3) samples.push({ i, dot: +dot.toFixed(3), ang: +ang.toFixed(3) });
      }
      return { filtered: filtered.length, camLocal: camLocal.toArray().map((x) => +x.toFixed(2)), front, angled, samples, camZ: camera.position.z };
    },
    /** 调试：返回渲染内部状态（正式使用无副作用） */
    debug() {
      const arr = pointGeo ? pointGeo.attributes.position.array : null;
      return {
        filtered: filtered.length,
        layout,
        pos0: arr ? [arr[0], arr[1], arr[2]] : null,
        camZ: camera.position.z,
        worldRot: [world.rotation.x, world.rotation.y],
        hasPoints: !!points,
        canvas: [canvas.clientWidth, canvas.clientHeight],
        labels: (() => { try { return this.getLabels(5).length; } catch { return 'err'; } })(),
      };
    },    setEnergy(v) { energy = Math.max(0, Math.min(1, Number(v) || 0)); },
    onSettle(cb) { settleCb = cb; },
    setLayout(mode) {
      const target = mode === 'nebula' ? 'nebula' : 'globe';
      if (target === layout) return layout;
      layout = target;
      const targetPos = computePositions(filtered).pos;
      const from = pointGeo.attributes.position.array.slice();
      morph = { from, to: targetPos, t: 0, dur: 0.95 };
      camera.position.z = target === 'nebula' ? 4.35 : 2.55;
      if (target === 'nebula') { world.rotation.x = 0; world.rotation.y = 0; }
      if (landPoints) landPoints.visible = target === 'globe';
      applyColors();
      selectedIndex = -1;
      lastInteract = Date.now();
      return layout;
    },
    /** 星云星团的屏幕坐标 + 数量（页面用来画品类标签） */
    getNebulaLabels() {
      if (layout !== 'nebula' || !nebulaCenters.length) return [];
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      return nebulaCenters.map((c, i) => {
        const p = c.clone().applyMatrix4(world.matrixWorld).project(camera);
        return { i, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, count: nebulaCounts[i] || 0 };
      });
    },
    setFilter(pred) {
      filtered = pred ? stations.filter(pred) : stations.slice();
      rebuild();
      selectedIndex = -1;
      return filtered.length;
    },

    /** 替换整份台站列表（核心包先出图，完整台库后台补进来） */
    setStations(list) {
      stations = Array.isArray(list) ? list : [];
      filtered = stations.slice();
      rebuild();
      selectedIndex = -1;
      return filtered.length;
    },
    getFiltered() { return filtered; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      try { pointGeo.dispose(); } catch { /* ignore */ }
      try { starGeo.dispose(); } catch { /* ignore */ }
      try { dotTex.dispose(); bokeh.dispose(); } catch { /* ignore */ }
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/** bokeh 柔光贴图：中心亮、边缘渐隐，模拟 roamdial 的星点光晕 */
function makeBokehTexture(THREE, inner = 0.85) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, `rgba(255,255,255,${inner})`);
  g.addColorStop(0.42, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
