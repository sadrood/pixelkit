/**
 * RadioGlobe - 世界电台 3D 地球
 * 用 three.js 把带经纬度的电台画成点云地球：可拖动旋转、滚轮缩放、点击光点播放。
 * 体积小、无外部依赖（three.js 复用站内 public/night-market/vendor 里的 ESM 版本）。
 */
export async function createRadioGlobe(container, stations, opts = {}) {
  // 注意：three 是 public/ 下的运行时静态资源，这里用变量 + @vite-ignore，
  // 避免 Rollup 在构建期尝试解析这个绝对路径（静态解析会直接让构建失败）。
  const THREE_URL = '/night-market/vendor/three.module.js';
  const THREE = await import(/* @vite-ignore */ THREE_URL);
  const onPick = opts.onPick || (() => {});
  const tipEl = opts.tooltipEl || null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  camera.position.set(0, 0.05, mobile ? 2.95 : 2.55);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.appendChild(canvas);

  const globe = new THREE.Group();
  scene.add(globe);

  /* ---------- 星空背景 ---------- */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const r = 6 + Math.random() * 8;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.cos(ph);
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x8fa9b8, size: 0.022, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  scene.add(stars);

  /* ---------- 球体 + 经纬网格 ---------- */
  globe.add(new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x123843, transparent: true, opacity: 0.62 })
  ));
  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(1.002, 28, 20),
    new THREE.MeshBasicMaterial({ color: 0x2b6b78, wireframe: true, transparent: true, opacity: 0.16 })
  );
  globe.add(wire);
  // 大气光晕：稍大一圈的反面球，边缘微微发亮
  globe.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.07, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x2aa7b8, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false })
  ));

  /* ---------- 点云：每个电台一个光点 ---------- */
  const PALETTE = [0xffb703, 0xfb8500, 0x8ecae6, 0x219ebc, 0x90be6d, 0xf28482, 0xffd166];
  const n = stations.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tmpColor = new THREE.Color();
  const toVec3 = (lat, lon, r) => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return [
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    ];
  };
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const [x, y, z] = toVec3(s.lat, s.lon, 1.012);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const cc = String(s.cc || '');
    let h = 0;
    for (let k = 0; k < cc.length; k++) h = (h * 31 + cc.charCodeAt(k)) >>> 0;
    tmpColor.setHex(PALETTE[h % PALETTE.length]);
    col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b;
  }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pointGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dotTex = makeCircleTexture(THREE);
  const points = new THREE.Points(pointGeo, new THREE.PointsMaterial({
    size: mobile ? 0.045 : 0.034,
    map: dotTex, vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  globe.add(points);

  /* ---------- 选中标记 ---------- */
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  marker.visible = false;
  globe.add(marker);

  /* ---------- 交互 ---------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = mobile ? 0.035 : 0.025;
  const ndc = new THREE.Vector2();
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let lastInteract = Date.now();
  let hoverAt = 0;

  const setNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  const hitTest = (e) => {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(points, false);
    if (!hits.length) return -1;
    return hits[0].index >= 0 ? hits[0].index : -1;
  };
  const showTip = (e, s) => {
    if (!tipEl) return;
    if (!s) { tipEl.style.display = 'none'; return; }
    tipEl.textContent = `${s.name}${s.country ? ' · ' + s.country : ''}`;
    const r = container.getBoundingClientRect();
    tipEl.style.display = 'block';
    const x = Math.min(Math.max(e.clientX - r.left + 12, 6), Math.max(6, r.width - 200));
    const y = Math.min(Math.max(e.clientY - r.top + 12, 6), Math.max(6, r.height - 40));
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
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
      globe.rotation.y += dx * 0.006;
      globe.rotation.x = Math.max(-1.1, Math.min(1.1, globe.rotation.x + dy * 0.005));
      lastInteract = Date.now();
      if (tipEl) tipEl.style.display = 'none';
      return;
    }
    const now = Date.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const i = hitTest(e);
    showTip(e, i >= 0 ? stations[i] : null);
  };
  const onUp = (e) => {
    dragging = false; canvas.style.cursor = 'grab';
    if (moved < 6) {
      const i = hitTest(e);
      if (i >= 0) { onPick(stations[i]); lastInteract = Date.now(); }
    }
    if (tipEl) tipEl.style.display = 'none';
  };
  const onLeave = () => { if (tipEl) tipEl.style.display = 'none'; };
  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(1.75, Math.min(4.6, camera.position.z + (e.deltaY > 0 ? 0.18 : -0.18)));
    lastInteract = Date.now();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

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
  let raf = 0, disposed = false;
  const clock = new THREE.Clock();
  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    clock.getDelta();
    if (!dragging && Date.now() - lastInteract > 2500) globe.rotation.y += 0.0008;
    marker.position.copy(points.geometry.attributes.position.array
      ? new THREE.Vector3(marker.position.x, marker.position.y, marker.position.z) : new THREE.Vector3());
    renderer.render(scene, camera);
  };
  tick();

  return {
    /** 高亮某个电台（传电台对象；传 null 清除） */
    setSelected(station) {
      const i = station ? stations.findIndex((s) => s.id === station.id) : -1;
      if (i < 0) { marker.visible = false; return; }
      marker.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      marker.visible = true;
    },
    /** 程序化选台（测试/键盘操作用） */
    pick(index) { if (stations[index]) onPick(stations[index]); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      pointGeo.dispose(); starGeo.dispose(); dotTex.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

function makeCircleTexture(THREE) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
