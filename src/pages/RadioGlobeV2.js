/**
 * RadioGlobeV2 - 自研 Three.js 3D 地球（经典"酷炫 3D 地球"做法）
 *
 * 视觉：夜景地球贴图（城市灯光）+ 大气光晕 + 星空 + 电台光点（bokeh 加法混合）
 *      + 选中台的飞线弧（带流动光点）+ 拉近分级显示 + 入场飞入动画
 * 交互：拖动旋转 / 滚轮远近 / 点击拾取 / 准星停稳回调 / 悬停高亮 / 频谱呼吸
 */
const THREE_URL = '/night-market/vendor/three.module.js';

// RoamDial 实测配色：综合/流行/摇滚/电子/新闻谈话/爵士与古典/地方与世界/嘻哈/宗教/运动娱乐/轻松背景
const POINT_COLORS = ['#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6', '#D8B26E', '#E2C35A', '#B7A3D9', '#C8B49A', '#EDE3CC', '#A9C08A'];

export async function createRadioGlobe(container, stations, opts = {}) {
  const THREE = await import(/* @vite-ignore */ THREE_URL);
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const onPick = opts.onPick || (() => {});
  const onHover = opts.onHover || (() => {});

  /* ---------- 基础 ---------- */
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const START_Z = mobile ? 4.4 : 4.8;
  const END_Z = mobile ? 2.9 : 2.8;
  camera.position.set(0, 0.15, START_Z);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.innerHTML = '';
  container.appendChild(canvas);

  // Bloom：把渲染结果画到模糊叠加层（低成本辉光）
  const bloom = document.createElement('canvas');
  bloom.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;filter:blur(16px) saturate(1.35);opacity:.55;z-index:0';
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.appendChild(bloom);
  const bctx = bloom.getContext('2d');

  const world = new THREE.Group();
  world.rotation.y = 2.6;
  scene.add(world);

  const tmpC = new THREE.Color();

  /* ---------- 星空 ---------- */
  (() => {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 12;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      tmpC.setHSL(0.1 + Math.random() * 0.08, 0.35, 0.5 + Math.random() * 0.4);
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      map: makeBokeh(THREE), size: 0.06, transparent: true, opacity: 0.75,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    scene.add(new THREE.Points(g, m));
  })();

  /* ---------- 地球 ---------- */
  const EARTH_R = 1;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R, mobile ? 64 : 96, mobile ? 48 : 64),
    new THREE.MeshPhongMaterial({ color: 0x07100e, specular: 0x0d1a16, shininess: 2 })
  );
  world.add(earth);
  scene.add(new THREE.AmbientLight(0x8fb5d8, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
  sun.position.set(4, 2, 5);
  scene.add(sun);

  // 柔和光晕（在球体后面的大号径向渐变精灵，经典 3D 地球做法）
  (() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.34, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(90,150,190,0.14)');
    g.addColorStop(0.6, 'rgba(70,120,170,0.07)');
    g.addColorStop(1, 'rgba(50,100,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.15, 2.15, 1);
    sp.position.set(0, 0, -0.02);
    sp.renderOrder = -2;
    world.add(sp);
  })();

  /* ---------- 陆地点阵（球面细点纹理，RoamDial 观感） ---------- */
  let landLayer = null;
  fetch('/data/land-mask.json', { cache: 'force-cache' })
    .then((r) => r.json())
    .then((m) => {
      try {
        const { cols, rows, step, mask } = m;
        const bin = atob(mask);
        const bits = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
        const cells = [];
        // 0.5° 掩膜隔点取样（约 1°），约 1.9 万个陆地点
        for (let r = 0; r < rows; r += 2) {
          for (let c = 0; c < cols; c += 2) {
            const idx = r * cols + c;
            if (!((bits[idx >> 3] >> (idx & 7)) & 1)) continue;
            cells.push({ lat: 90 - (r + 0.5) * step, lon: -180 + (c + 0.5) * step });
          }
        }
        const n = cells.length;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const v = toVec3(cells[i].lat, cells[i].lon, EARTH_R * 1.004);
          pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        landLayer = new THREE.Points(g, new THREE.PointsMaterial({
          map: dotTex, size: 0.0055, color: 0x3f544b, transparent: true, opacity: 0.4,
          depthWrite: false, sizeAttenuation: true,
        }));
        world.add(landLayer);
        console.log('[radio] 陆地点阵：' + n + ' 点');
      } catch (e) { /* ignore */ }
    })
    .catch(() => { /* 没有掩膜就不画 */ });

  /* ---------- 坐标换算 ---------- */
  const toVec3 = (lat, lon, r) => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  };
  const hashOf = (s) => {
    let h = 0;
    const t = String(s.id || s.name || '');
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return h;
  };

  /* ---------- 光点 ---------- */
  const dotTex = makeBokeh(THREE, 0.75);
  let filtered = stations.slice();
  let points = null;
  let pointsGlow = null;
  let pointGeo = null;
  let pointsList = [];
  let zoomLevel = 1;

  function buildPoints(list) {
    pointsList = list.slice();
    if (points) { world.remove(points); points.geometry.dispose(); points.material.dispose(); }
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const v = toVec3(s.lat, s.lon, EARTH_R * 1.006);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      tmpC.set(POINT_COLORS[(s.g || 0) % POINT_COLORS.length]);
      // pop 0–9 提亮；码率未知（br=0）降权
      const popK = 0.5 + (Math.min(9, Math.max(0, s.pop || 0)) / 9) * 0.34;
      const brK = s.bitrate ? 0.95 : 0.66;
      // 远景去饱和成灰白点阵；近景保留 genre 色
      const sat = zoomLevel >= 2 ? 1 : (zoomLevel === 1 ? 0.45 : 0.12);
      const gray = 0.78;
      const r0 = tmpC.r * popK * brK, g0 = tmpC.g * popK * brK, b0 = tmpC.b * popK * brK;
      col[i * 3] = (r0 * sat + gray * (1 - sat)) * (sat < 1 ? 0.85 : 1);
      col[i * 3 + 1] = (g0 * sat + gray * (1 - sat)) * (sat < 1 ? 0.85 : 1);
      col[i * 3 + 2] = (b0 * sat + gray * (1 - sat)) * (sat < 1 ? 0.85 : 1);
    }
    pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pointGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    points = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      map: dotTex, size: mobile ? 0.062 : 0.05, transparent: true, opacity: 0,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    world.add(points);
    // 光晕层：大尺寸低透明度，模拟 bloom
    if (pointsGlow) { world.remove(pointsGlow); pointsGlow.geometry.dispose(); pointsGlow.material.dispose(); }
    pointsGlow = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      map: dotTex, size: 0.06, transparent: true, opacity: 0.09,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    world.add(pointsGlow);
  }
  buildPoints(filtered);

  /* ---------- 选中：光环 + 飞线 ---------- */
  const arcsGroup = new THREE.Group();
  world.add(arcsGroup);
  const arcDots = [];
  let selectedIndex = -1;
  let ring = null;

  function clearArcs() {
    while (arcsGroup.children.length) {
      const c = arcsGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    arcDots.length = 0;
  }

  function setSelectedIndex(i) {
    selectedIndex = i;
    if (ring) { world.remove(ring); ring.geometry.dispose(); ring.material.dispose(); ring = null; }
    clearArcs();
    if (i < 0 || !filtered[i]) return;
    const s = filtered[i];
    const v = toVec3(s.lat, s.lon, EARTH_R * 1.01);
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.028, 0.036, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.copy(v);
    ring.lookAt(v.clone().multiplyScalar(2));
    world.add(ring);
    // 飞线：从选中台连到若干其他台
    const pool = filtered.filter((x) => x !== s);
    const count = mobile ? 5 : 9;
    for (let k = 0; k < count && pool.length; k++) {
      const t = pool[Math.floor((k * 7919 + hashOf(s)) % pool.length)];
      const a = toVec3(s.lat, s.lon, EARTH_R * 1.005);
      const b = toVec3(t.lat, t.lon, EARTH_R * 1.005);
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(EARTH_R * (1.18 + (k % 4) * 0.06));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const pts = curve.getPoints(48);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false });
      arcsGroup.add(new THREE.Line(geo, mat));
      // 流动光点
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.95 })
      );
      dot.userData = { curve, t: Math.random() };
      arcsGroup.add(dot);
      arcDots.push(dot);
    }
  }

  /* ---------- 缩放分级 ---------- */
  function centerLatLon() {
    // 相机正对地球的经纬度
    const dir = camera.position.clone().sub(world.position).normalize();
    const inv = new THREE.Matrix4().copy(world.matrixWorld).invert();
    const d = dir.clone().transformDirection(inv);
    const lat = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
    const lon = Math.atan2(d.z, -d.x) * 180 / Math.PI - 180;
    return { lat, lon: ((lon + 540) % 360) - 180 };
  }
  function applyZoomLevel() {
    const z = camera.position.z;
    // 默认视角 z≈2.8 属于中景（全量细点）；再拉近才切到本国视图
    const lvl = z > 4.0 ? 0 : z > 2.05 ? 1 : 2;
    if (lvl === zoomLevel) return;
    zoomLevel = lvl;
    if (lvl === 2) {
      const c = centerLatLon();
      const cos = Math.cos(c.lat * Math.PI / 180);
      let best = null, bestD = 1e9;
      for (const s of stations) {
        const dLat = s.lat - c.lat;
        const dLng = ((s.lon - c.lon + 540) % 360) - 180;
        const d = dLat * dLat + (dLng * cos) * (dLng * cos);
        if (d < bestD) { bestD = d; best = s; }
      }
      const cc = best ? best.cc : null;
      const near = stations.filter((s) => (cc && s.cc === cc));
      buildPoints(near.length > 30 ? near : stations);
      if (points) points.material.size = mobile ? 0.06 : 0.048;
    } else {
      // 远景/中景：全部电台都画（小点），形成"点云地球"
      buildPoints(stations);
      if (points) points.material.size = lvl === 0 ? (mobile ? 0.022 : 0.014) : (mobile ? 0.03 : 0.022);
    }
  }
  applyZoomLevel();
  /* ---------- 交互 ---------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = mobile ? 0.05 : 0.04;
  const ndc = new THREE.Vector2();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = Date.now();
  let settleCb = null, settleTimer = null;
  let hoverIndex = -1, hoverRing = null;

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
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX; lastY = e.clientY;
      world.rotation.y += dx * 0.005;
      world.rotation.x = Math.max(-1.1, Math.min(1.1, world.rotation.x + dy * 0.004));
      rotVX = dx * 0.0016;
      rotVY = dy * 0.0013;
      focusTarget = null;
      lastInteract = Date.now();
      return;
    }
    const hi = hitTest(e);
    if (hi !== hoverIndex) {
      hoverIndex = hi;
      canvas.style.cursor = hi >= 0 ? 'pointer' : 'grab';
      if (hi >= 0) {
        const arr = pointGeo.attributes.position.array;
        if (!hoverRing) {
          hoverRing = new THREE.Mesh(
            new THREE.RingGeometry(0.02, 0.027, 28),
            new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
          );
          world.add(hoverRing);
        }
        hoverRing.position.set(arr[hi * 3], arr[hi * 3 + 1], arr[hi * 3 + 2]);
        hoverRing.lookAt(hoverRing.position.clone().multiplyScalar(2));
        hoverRing.visible = true;
      } else if (hoverRing) hoverRing.visible = false;
      try { onHover(hi >= 0 ? pointsList[hi] : null, e.clientX, e.clientY); } catch { /* ignore */ }
    } else if (hi >= 0) {
      try { onHover(pointsList[hi], e.clientX, e.clientY); } catch { /* ignore */ }
    }
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
      onPick(pointsList[i], i);
      lastInteract = Date.now();
    }
  };
  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(1.4, Math.min(6.0, camera.position.z + (e.deltaY > 0 ? 0.2 : -0.2)));
    lastInteract = Date.now();
    applyZoomLevel();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerleave', () => { if (hoverRing) hoverRing.visible = false; hoverIndex = -1; try { onHover(null, 0, 0); } catch { /* ignore */ } });

  /* ---------- 尺寸 ---------- */
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bloom.width = Math.max(2, Math.round(w / 2));
    bloom.height = Math.max(2, Math.round(h / 2));
  };
  resize();
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  /* ---------- 入场动画 + 帧循环 ---------- */
  let raf = 0, disposed = false, energy = 0, introDone = false;
  let rotVX = 0, rotVY = 0, focusTarget = null;
  let diveT = 1, diveFrom = END_Z, diveTo = END_Z, diveDur = 0.7;
  const clock = new THREE.Clock();
  const t0 = performance.now();
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const el = performance.now() - t0;
    // 入场：只在前 1.9s 接管相机；之后完全交给用户（否则缩放/旋转会被每帧重置）
    if (!introDone) {
      const intro = Math.min(1, el / 1900);
      const ie = intro * intro * (3 - 2 * intro);
      camera.position.z = START_Z + (END_Z - START_Z) * ie;
      if (points) points.material.opacity = 0.92 * ie;
      if (intro >= 1) { introDone = true; applyZoomLevel(); }
    } else if (points && points.material.opacity < 0.92) {
      points.material.opacity = Math.min(0.92, points.material.opacity + dt * 0.6);
    }
    // 惯性旋转（松手后自然减速）
    if (!dragging && (Math.abs(rotVX) > 0.0002 || Math.abs(rotVY) > 0.0002)) {
      world.rotation.y += rotVX;
      world.rotation.x = Math.max(-1.1, Math.min(1.1, world.rotation.x + rotVY));
      rotVX *= 0.94; rotVY *= 0.94;
    }
    // 平滑聚焦到指定电台
    if (focusTarget) {
      world.rotation.y += (focusTarget.y - world.rotation.y) * 0.12;
      world.rotation.x += (focusTarget.x - world.rotation.x) * 0.12;
      if (Math.abs(focusTarget.y - world.rotation.y) < 0.004) focusTarget = null;
    }
    // 视图切换：俯冲进入
    if (diveT < 1) {
      diveT = Math.min(1, diveT + dt / Math.max(0.001, diveDur));
      const e = diveT * diveT * (3 - 2 * diveT);
      camera.position.z = diveFrom + (diveTo - diveFrom) * e;
    }
    // 选中环脉动
    if (ring) {
      const p = 1 + Math.sin(performance.now() / 420) * 0.18 + energy * 0.2;
      ring.scale.set(p, p, 1);
      ring.material.opacity = 0.95;
    }
    // 飞线流动光点
    for (const d of arcDots) {
      d.userData.t = (d.userData.t + dt * 0.22) % 1;
      const p = d.userData.curve.getPoint(d.userData.t);
      d.position.copy(p);
      d.material.opacity = 0.25 + 0.75 * Math.sin(d.userData.t * Math.PI);
    }
    // 频谱呼吸
    if (points) {
      const base = zoomLevel === 2 ? (mobile ? 0.06 : 0.048) : zoomLevel === 1 ? (mobile ? 0.03 : 0.022) : (mobile ? 0.022 : 0.014);
      const want = base * (1 + energy * 0.5);
      points.material.size += (want - points.material.size) * 0.12;
      if (pointsGlow) {
        pointsGlow.material.size = points.material.size * (zoomLevel >= 2 ? 3.0 : 2.2);
        pointsGlow.material.opacity = zoomLevel >= 2 ? 0.13 : 0.05;
      }
    }
    if (!dragging && Date.now() - lastInteract > 5000) world.rotation.y += dt * 0.02;
    renderer.render(scene, camera);
    try { bctx.clearRect(0, 0, bloom.width, bloom.height); bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height); } catch { /* ignore */ }
  };
  tick();

  /* ---------- 对外接口 ---------- */
  return {
    mode: 'custom3d',
    focus(station) {
      if (!station) return;
      const theta = (station.lon + 180) * Math.PI / 180;
      focusTarget = {
        y: Math.PI / 2 - theta,
        x: Math.max(-0.9, Math.min(0.9, -(station.lat || 0) * Math.PI / 180 * 0.9)),
      };
      lastInteract = Date.now();
    },
    /** 视图切换动画：镜头俯冲进入地球 */
    diveIn(dur = 0.7) {
      diveFrom = camera.position.z;
      diveTo = Math.max(1.45, diveFrom * 0.55);
      diveT = 0;
      diveDur = dur;
    },
    /** 切换动画：镜头拉回正常距离 */
    pullOut(dur = 0.6) {
      diveFrom = camera.position.z;
      diveTo = END_Z;
      diveT = 0;
      diveDur = dur;
    },
    pickCenter() {
      if (!pointsList.length) return -1;
      const c = centerLatLon();
      const cos = Math.cos(c.lat * Math.PI / 180);
      let best = -1, bestD = 1e9;
      for (let i = 0; i < pointsList.length; i++) {
        const s = pointsList[i];
        const dLat = s.lat - c.lat;
        const dLng = ((s.lon - c.lon + 540) % 360) - 180;
        const d = dLat * dLat + (dLng * cos) * (dLng * cos);
        if (d < bestD) { bestD = d; best = i; }
      }
      return Math.sqrt(bestD) * 180 / Math.PI <= 25 ? best : -1;
    },
    getLabels(limit = 8) {
      if (!pointsList.length || !pointGeo) return [];
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      const c = centerLatLon();
      const cos = Math.cos(c.lat * Math.PI / 180);
      const arr = pointGeo.attributes.position.array;
      const v = new THREE.Vector3();
      const out = [];
      const camDir = camera.position.clone().normalize();
      for (let i = 0; i < pointsList.length; i++) {
        const s = pointsList[i];
        const dLat = s.lat - c.lat;
        const dLng = ((s.lon - c.lon + 540) % 360) - 180;
        const ang = Math.sqrt(dLat * dLat + (dLng * cos) * (dLng * cos)) * Math.PI / 180;
        if (ang > 0.5) continue;
        v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
        const worldPos = v.clone().applyMatrix4(world.matrixWorld);
        if (worldPos.clone().normalize().dot(camDir) < 0.05) continue;
        const p = worldPos.clone().project(camera);
        if (p.z > 1) continue;
        const px = (p.x * 0.5 + 0.5) * w;
        const py = (-p.y * 0.5 + 0.5) * h;
        if (!isFinite(px) || !isFinite(py)) continue;
        out.push({ i, ang, x: px, y: py, name: s.name });
      }
      return out.sort((a, b) => a.ang - b.ang).slice(0, limit);
    },
    getNebulaLabels() { return []; },
    setSelected(station) {
      if (!station) { setSelectedIndex(-1); return; }
      setSelectedIndex(pointsList.findIndex((s) => s.id === station.id));
    },
    pick(index) {
      if (pointsList[index]) { setSelectedIndex(index); try { onPick(pointsList[index], index); } catch { /* ignore */ } }
    },
    setEnergy(v) { energy = Math.max(0, Math.min(1, Number(v) || 0)); },
    setOpacity(v) {
      const o = Math.max(0, Math.min(1, Number(v)));
      canvas.style.opacity = String(o);
      if (points) points.material.opacity = 0.92 * o;
      if (pointsGlow) pointsGlow.material.opacity = (zoomLevel >= 2 ? 0.13 : 0.05) * o;
    },
    onSettle(cb) { settleCb = cb; },
    setLayout(mode) { return mode === 'nebula' ? 'globe' : 'globe'; },
    setFilter(pred) {
      filtered = pred ? stations.filter(pred) : stations.slice();
      zoomLevel = -1;
      applyZoomLevel();
      selectedIndex = -1;
      return filtered.length;
    },
    setStations(list) {
      stations = Array.isArray(list) ? list : [];
      filtered = stations.slice();
      zoomLevel = -1;
      applyZoomLevel();
      selectedIndex = -1;
      return filtered.length;
    },
    getFiltered() { return pointsList.slice(); },
    debug() { return { mode: 'custom3d', zoomLevel, points: pointsList.length, cameraZ: +camera.position.z.toFixed(2) }; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      try { pointGeo.dispose(); } catch { /* ignore */ }
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
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
