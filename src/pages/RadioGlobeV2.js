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
  bloom.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;filter:blur(14px) saturate(1.25);opacity:.42;z-index:0';
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
    new THREE.MeshPhongMaterial({ color: 0x0b1815, specular: 0x122320, shininess: 3 })
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
        // 陆地/海洋贴图（数据来自 land-mask，可辨认大陆轮廓）
        const cv = document.createElement('canvas');
        cv.width = cols; cv.height = rows;
        const lctx = cv.getContext('2d');
        const img = lctx.createImageData(cols, rows);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const land = (bits[idx >> 3] >> (idx & 7)) & 1;
            const o = idx * 4;
            if (land) { img.data[o] = 34; img.data[o + 1] = 74; img.data[o + 2] = 62; img.data[o + 3] = 255; }
            else { img.data[o] = 7; img.data[o + 1] = 16; img.data[o + 2] = 14; img.data[o + 3] = 255; }
          }
        }
        lctx.putImageData(img, 0, 0);
        const landTex = new THREE.CanvasTexture(cv);
        landTex.colorSpace = THREE.SRGBColorSpace;
        landTex.anisotropy = 4;
        earth.material.map = landTex;
        earth.material.color.set(0xffffff);
        earth.material.needsUpdate = true;
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
          map: dotTex, size: 0.0065, color: 0x4d6a5f, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
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
  let morphT = 1, morphDur = 1.5, morphBase = null, morphTarget = null;
  let pointGeo = null;
  let pointsList = [];
  let zoomLevel = 1;

  function buildPoints(list, spreadK = 0) {
    pointsList = list.slice();
    if (points) { world.remove(points); points.geometry.dispose(); points.material.dispose(); }
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      let v = toVec3(s.lat, s.lon, EARTH_R * 1.006);
      if (spreadK) {
        // 城市级：按台 ID 哈希在切平面上散开，避免所有台叠在一点
        let hh = 0; const sid = String(s.id || s.name || i);
        for (let k = 0; k < sid.length; k++) hh = (hh * 31 + sid.charCodeAt(k)) >>> 0;
        const ox = (((hh >>> 3) % 1000) / 1000 - 0.5) * 0.012 * spreadK;
        const oy = (((hh >>> 13) % 1000) / 1000 - 0.5) * 0.012 * spreadK;
        v = new THREE.Vector3(v.x + ox, v.y + oy, v.z).normalize().multiplyScalar(EARTH_R * 1.006);
      }
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      tmpC.set(POINT_COLORS[(s.g || 0) % POINT_COLORS.length]);
      // 规格书：不要未经验证的夜间灯光染色，直接使用 genre 色
      const r0 = tmpC.r, g0 = tmpC.g, b0 = tmpC.b;
      // 信号强度（pop 0–9 + 码率）：弱的暗，只在大地图时出现
      const power = (s.pop || 0) * 10 + (s.bitrate >= 128 ? 6 : s.bitrate >= 64 ? 4 : s.bitrate ? 2 : 0);
      const strength = Math.min(1, 0.22 + power / 100);
      const k = strength * (zoomLevel >= 2 ? 0.62 : zoomLevel === 1 ? 0.8 : 0.55);
      col[i * 3] = r0 * k;
      col[i * 3 + 1] = g0 * k;
      col[i * 3 + 2] = b0 * k;
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
    // 记录变形起点；目标 = 该电台所属流派的星团位置（与星云 LAYOUT 一致的方位）
    morphBase = pos.slice();
    const LAY = [
      [1.05, -0.15, 0.45], [1.95, -1.2, 0.15], [0.3, -1.8, 0.68], [2.4, 0.15, -0.45],
      [-2.1, 1.35, 0.83], [-2.2, 0.08, -0.68], [2.1, 1.43, 0.23], [-1.0, -0.38, 1.2],
      [0.83, 0.9, 1.28], [1.43, -0.68, -1.43], [0.15, 1.88, -0.3],
    ];
    morphTarget = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const g = (list[i].g || 0) % LAY.length;
      const L = LAY[g];
      let h = 0; const id = String(list[i].id || list[i].name || i);
      for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
      const jx = (((h >>> 3) % 1000) / 1000 - 0.5) * 0.7;
      const jy = (((h >>> 13) % 1000) / 1000 - 0.5) * 0.7;
      const jz = (((h >>> 23) % 1000) / 1000 - 0.5) * 0.7;
      morphTarget[i * 3] = L[0] + jx;
      morphTarget[i * 3 + 1] = L[1] + jy;
      morphTarget[i * 3 + 2] = L[2] + jz;
    }
    morphT = 1;
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
    if (z < 1.25) {
      const c = centerLatLon();
      const cos = Math.cos(c.lat * Math.PI / 180);
      const near = stations.filter((s) => {
        const dLat = s.lat - c.lat;
        const dLng = ((s.lon - c.lon + 540) % 360) - 180;
        return Math.abs(dLat) <= 3.2 && Math.abs(dLng) * cos <= 3.2;
      });
      buildPoints(near.length > 60 ? near : stations, 3.2);
      if (points) { points.material.size = mobile ? 0.009 : 0.006; points.material.opacity = 0.5; }
      if (landLayer) landLayer.visible = false;
      return;
    }
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
      // 本国 + 8° 内的台，放大后画面才有足够分散的点
      const near = stations.filter((s) => {
        if (cc && s.cc === cc) return true;
        const dLat = s.lat - c.lat;
        const dLng = ((s.lon - c.lon + 540) % 360) - 180;
        return Math.abs(dLat) <= 8 && Math.abs(dLng) * cos <= 8;
      });
      buildPoints(near.length ? near : stations);
      if (points) { points.material.size = mobile ? 0.011 : 0.007; points.material.opacity = 0.55; }
    } else {
      // 远景只显示强台，中景显示中强台：弱信号要放大才出现
      const minPower = lvl === 0 ? 60 : 46;
      const strong = stations.filter((s) => {
        const power = (s.pop || 0) * 10 + (s.bitrate >= 128 ? 6 : s.bitrate >= 64 ? 4 : s.bitrate ? 2 : 0);
        return power >= minPower;
      });
      buildPoints(strong.length > 1200 ? strong : stations);
      if (points) points.material.size = lvl === 0 ? (mobile ? 0.02 : 0.012) : (mobile ? 0.028 : 0.018);
      if (landLayer) landLayer.visible = lvl !== 2;
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
      const sens = Math.max(0.22, Math.min(1, (camera.position.z - 1.05) / 2.0));
      world.rotation.y += dx * 0.005 * sens;
      world.rotation.x = Math.max(-1.1, Math.min(1.1, world.rotation.x + dy * 0.004 * sens));
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
  let wheelTimer = null;
  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(0.62, Math.min(6.0, camera.position.z + (e.deltaY > 0 ? 0.2 : -0.2)));
    lastInteract = Date.now();
    applyZoomLevel();
    // 松手停稳 650ms：把最近的一颗星「吸」过来（自动对焦/锁定）
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = null;
      try {
        const i = pickCenter();
        if (i >= 0) {
          if (settleCb) settleCb();
          else if (opts.onPick) opts.onPick(pointsList[i], i);
        }
      } catch { /* ignore */ }
    }, 650);
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
  let introHold = false;
  let zoomT = 1, zoomFrom = 0, zoomToZ = 0, zoomDur = 0.35;
  const clock = new THREE.Clock();
  let introStart = performance.now();
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const el = performance.now() - introStart;
    // 入场：只在前 1.9s 接管相机；之后完全交给用户（否则缩放/旋转会被每帧重置）
    if (introHold) {
      camera.position.z = START_Z;
      if (points) points.material.opacity = 0.3;
    } else if (!introDone) {
      const intro = Math.min(1, el / 1900);
      const ie = intro * intro * (3 - 2 * intro);
      camera.position.z = START_Z + (END_Z - START_Z) * ie;
      if (points) points.material.opacity = 0.92 * ie;
      if (landLayer) landLayer.visible = zoomLevel !== 2;
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
    if (zoomT < 1) {
      zoomT = Math.min(1, zoomT + dt / Math.max(0.001, zoomDur));
      const e = zoomT * zoomT * (3 - 2 * zoomT);
      camera.position.z = zoomFrom + (zoomToZ - zoomFrom) * e;
    }
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
      const base = zoomLevel === 2 ? (mobile ? 0.011 : 0.007) : zoomLevel === 1 ? (mobile ? 0.03 : 0.022) : (mobile ? 0.022 : 0.014);
      const want = base * (1 + energy * 0.5);
      points.material.size += (want - points.material.size) * 0.12;
      if (pointsGlow) {
        pointsGlow.material.size = points.material.size * (zoomLevel >= 2 ? 2.2 : 2.0);
        pointsGlow.material.opacity = zoomLevel >= 2 ? 0.0 : 0.05;
      }
    }
    // 不再自动旋转：避免用户操作时地球「乱转」
    // 粒子变形：球面 → 星团
    if (morphT < 1 && morphBase && morphTarget && pointGeo) {
      morphT = Math.min(1, morphT + dt / Math.max(0.001, morphDur));
      const e = 1 - Math.pow(1 - morphT, 3);
      const arr = pointGeo.attributes.position.array;
      for (let i = 0; i < arr.length; i++) arr[i] = morphBase[i] + (morphTarget[i] - morphBase[i]) * e;
      pointGeo.attributes.position.needsUpdate = true;
    }
    renderer.render(scene, camera);
    try { bctx.clearRect(0, 0, bloom.width, bloom.height); bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height); } catch { /* ignore */ }
  };
  tick();

  /* ---------- 对外接口 ---------- */
  return {
    mode: 'custom3d',
    focus(station) {
      // 只标记选中，不再自动旋转地球（用户反馈放大后地球会乱转）
      if (!station) return;
      lastInteract = Date.now();
    },
    /** 介绍页期间：保持远景、隐藏点云，等用户点「开始收听」再飞入 */
    holdIntro() { introHold = true; introDone = false; },
    replayIntro() {
      introHold = false;
      introDone = false;
      const t = performance.now();
      try { window.__pkT0 = t; } catch { /* ignore */ }
      // 重置内部计时：用新的起点
      introStart = t;
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
    applyZoomLevel() { applyZoomLevel(); },
    /** 地球→星云：同一批粒子从球面飞散到星团位置 */
    morphToNebula(dur = 1.5) {
      if (!morphBase) return;
      morphT = 0;
      morphDur = dur;
      zoomFrom = camera.position.z; zoomToZ = 3.4; zoomT = 0; zoomDur = dur;
    },
    /** 星云→地球：恢复球面位置 */
    resetMorph() {
      if (!morphBase || !pointGeo) return;
      const arr = pointGeo.attributes.position.array;
      for (let i = 0; i < arr.length; i++) arr[i] = morphBase[i];
      pointGeo.attributes.position.needsUpdate = true;
      morphT = 1;
    },
    /** 吸附动画：轻微推近到目标电台 */
    zoomTo(z, dur = 0.35) { zoomFrom = camera.position.z; zoomToZ = z; zoomT = 0; zoomDur = dur; },
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
