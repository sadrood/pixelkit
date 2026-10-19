/**
 * RadioGlobe v2 - 世界电台 3D 地球
 *
 * 参考《Threejs 实现酷炫 3D 地球技术点汇总》（知乎 嘟嘟MD）里的技术点重做：
 *   1. 动态星空背景：9000 个粒子 + HSL 随机色 + AdditiveBlending，缓慢旋转
 *   2. 地球模型：SphereGeometry + 等距柱状投影夜景贴图（public/radio-earth.jpg）
 *   3. 大气层光圈：径向渐变贴图 Sprite，放大 3 倍
 *   4. 卫星环绕：倾斜轨道线 + 卫星沿轨道运动
 *   5. 经纬度 → 3D 坐标
 *   6. 标注：电台点云 + 扩散光圈（缩放/透明度循环，文章的 WaveMesh 动画）
 *   7. 光柱：两张 90° 交叉的渐变平面，从选中电台拔地而起
 *   8. 飞线：三次贝塞尔曲线 + 沿线飞行的光点
 *   9. 交互不变：拖动旋转、滚轮缩放、悬停提示、点击光点播放
 */
const THREE_URL = '/night-market/vendor/three.module.js';

export async function createRadioGlobe(container, stations, opts = {}) {
  const THREE = await import(/* @vite-ignore */ THREE_URL);
  const onPick = opts.onPick || (() => {});
  const tipEl = opts.tooltipEl || null;
  const mobile = window.matchMedia('(max-width: 720px)').matches;

  /* ==================== 1. 渲染器 / 场景 / 相机 ==================== */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020924);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(0, 0.12, mobile ? 3.05 : 2.7);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x020924, 1);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.appendChild(canvas);

  const world = new THREE.Group();   // 整体（含地球），拖动时旋转它
  scene.add(world);

  /* ==================== 2. 动态星空 ==================== */
  const STAR_COUNT = 9000;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCol = new Float32Array(STAR_COUNT * 3);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = 4 + Math.random() * 6;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.cos(ph);
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    tmpColor.setHSL(Math.random() * 0.2 + 0.5, 0.55, Math.random() * 0.25 + 0.55);
    starCol[i * 3] = tmpColor.r; starCol[i * 3 + 1] = tmpColor.g; starCol[i * 3 + 2] = tmpColor.b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starTex = makeGlowTexture(THREE, 0.9);
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    map: starTex, size: 0.05, transparent: true, opacity: 0.9, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(stars);

  /* ==================== 3. 地球（夜景贴图） ==================== */
  const earthGroup = new THREE.Group();
  world.add(earthGroup);

  const earthMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.22, 1.22, 1.22) });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat);
  earthGroup.add(earth);
  new THREE.TextureLoader().load('/radio-earth.jpg', (tex) => {
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  }, undefined, () => { earthMat.color = new THREE.Color(0x123843); earthMat.needsUpdate = true; });

  // 很淡的经纬线，数字地球的感觉
  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(1.001, 36, 24),
    new THREE.MeshBasicMaterial({ color: 0x2b6b78, wireframe: true, transparent: true, opacity: 0.07, depthWrite: false })
  );
  earthGroup.add(grid);
  // 暗面底光：略小一圈的深蓝球，让地球暗面不至于纯黑（夜景贴图里海洋很暗）
  earthGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.995, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x0e3654, transparent: true, opacity: 0.65, depthWrite: false })
  ));

  /* ==================== 4. 大气层光圈 ==================== */
  const glowTex = makeGlowTexture(THREE, 0.42);
  const atmo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x5fd6f2, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  atmo.scale.set(3.05, 3.05, 1);
  world.add(atmo);

  /* ==================== 5. 卫星环绕 ==================== */
  const orbitGroup = new THREE.Group();
  orbitGroup.rotation.set(1.18, 0.2, 0.42);
  world.add(orbitGroup);
  const orbitR = 1.34;
  const orbitPts = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    orbitPts.push(new THREE.Vector3(Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR));
  }
  const orbitLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0x4d8ea6, transparent: true, opacity: 0.28, depthWrite: false })
  );
  orbitGroup.add(orbitLine);
  const satTex = makeGlowTexture(THREE, 0.9);
  const satellite = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(orbitR, 0, 0)]),
    new THREE.PointsMaterial({ map: satTex, color: 0xbfefff, size: 0.09, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
  );
  orbitGroup.add(satellite);

  /* ==================== 6. 经纬度 → 3D + 电台点云 ==================== */
  const toVec3 = (lat, lon, r) => {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  };

  const PALETTE = [0xffc45c, 0xff9e5a, 0x8ecae6, 0x5ec8e5, 0x9fe3a0, 0xf6a4b4, 0xffe08a];
  const n = stations.length;
  const posArr = new Float32Array(n * 3);
  const colArr = new Float32Array(n * 3);
  const stationVecs = [];
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const v = toVec3(s.lat, s.lon, 1.012);
    stationVecs.push(v);
    posArr[i * 3] = v.x; posArr[i * 3 + 1] = v.y; posArr[i * 3 + 2] = v.z;
    const cc = String(s.cc || '');
    let h = 0;
    for (let k = 0; k < cc.length; k++) h = (h * 31 + cc.charCodeAt(k)) >>> 0;
    tmpColor.setHex(PALETTE[h % PALETTE.length]);
    colArr[i * 3] = tmpColor.r; colArr[i * 3 + 1] = tmpColor.g; colArr[i * 3 + 2] = tmpColor.b;
  }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  pointGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const BASE_DOT = mobile ? 0.042 : 0.032;
  let energy = 0;            // 频谱能量 0~1（RadioPage 通过 setEnergy 喂入）
  const dotTex = makeGlowTexture(THREE, 0.95);
  const stationPoints = new THREE.Points(pointGeo, new THREE.PointsMaterial({
    map: dotTex, size: BASE_DOT, transparent: true, opacity: 1,
    vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  world.add(stationPoints);

  /* ==================== 7. 扩散光圈（文章的 WaveMesh 动画） ==================== */
  const ringTex = makeRingTexture(THREE);
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  const rings = [];
  const ringCount = mobile ? 14 : 24;
  const step = Math.max(1, Math.floor(n / ringCount));
  for (let i = 0; i < ringCount; i++) {
    const idx = (i * step) % n;
    const v = stationVecs[idx];
    const mat = new THREE.MeshBasicMaterial({
      map: ringTex, color: 0x66d9ee, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    const size = 0.085;
    mesh.scale.set(size, size, 1);
    mesh.position.copy(v);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
    mesh._s = 1 + Math.random() * 1.2;
    mesh._size = size;
    world.add(mesh);
    rings.push(mesh);
  }

  /* ==================== 8. 光柱（选中电台） ==================== */
  const pillarTex = makePillarTexture(THREE);
  const pillarGroup = new THREE.Group();
  pillarGroup.visible = false;
  world.add(pillarGroup);
  const pillarGeo = new THREE.PlaneGeometry(0.075, 0.4);
  pillarGeo.translate(0, 0.2, 0);
  for (let k = 0; k < 2; k++) {
    const m = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({
      map: pillarTex, color: 0x9fe8ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.rotation.z = (k * Math.PI) / 2;
    pillarGroup.add(m);
  }

  /* ==================== 9. 飞线（贝塞尔 + 沿线光点） ==================== */
  const arcs = [];      // { tube, comet, curve, t }
  const arcGroup = new THREE.Group();
  world.add(arcGroup);
  const cometTex = makeGlowTexture(THREE, 0.95);

  function clearArcs() {
    for (const a of arcs) {
      try { arcGroup.remove(a.tube); a.tube.geometry.dispose(); a.tube.material.dispose(); } catch { /* ignore */ }
      try { arcGroup.remove(a.comet); a.comet.geometry.dispose(); a.comet.material.dispose(); } catch { /* ignore */ }
    }
    arcs.length = 0;
  }

  function makeArc(from, to) {
    const v0 = from.clone().multiplyScalar(1.01);
    const v3 = to.clone().multiplyScalar(1.01);
    const mid = v0.clone().add(v3).multiplyScalar(0.5).normalize();
    const lift = 1.05 + v0.angleTo(v3) * 0.22;
    const vtop = mid.multiplyScalar(lift);
    const v1 = v0.clone().lerp(vtop, 0.42);
    const v2 = v3.clone().lerp(vtop, 0.42);
    const curve = new THREE.CubicBezierCurve3(v0, v1, v2, v3);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 36, 0.0022, 4, false),
      new THREE.MeshBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    arcGroup.add(tube);
    const comet = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
      new THREE.PointsMaterial({ map: cometTex, color: 0xd8f7ff, size: 0.06, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
    );
    arcGroup.add(comet);
    arcs.push({ tube, comet, curve, t: Math.random() * 0.8 });
  }

  function spawnArcs(fromIndex) {
    clearArcs();
    const from = stationVecs[fromIndex];
    if (!from) return;
    const count = mobile ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const to = stationVecs[Math.floor(Math.random() * n)];
      if (to && from.distanceTo(to) > 0.25) makeArc(from, to);
    }
  }

  /* ==================== 10. 选中标记 ==================== */
  let selectedIndex = -1;
  let focusTarget = null;      // 滑杆选台时的镜头目标朝向 { y, x }
  let settleCb = null;         // 拖动停稳后的回调（准星自动选台）
  let settleTimer = null;
  const selectTex = makeRingTexture(THREE);
  const selectRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    map: selectTex, color: 0xffffff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  selectRing.visible = false;
  world.add(selectRing);

  /* ==================== 11. 交互 ==================== */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = mobile ? 0.04 : 0.03;
  const ndc = new THREE.Vector2();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = Date.now(), hoverAt = 0;

  const setNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  const hitTest = (e) => {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(stationPoints, false);
    return hits.length ? (hits[0].index >= 0 ? hits[0].index : -1) : -1;
  };
  const showTip = (e, s) => {
    if (!tipEl) return;
    if (!s) { tipEl.style.display = 'none'; return; }
    tipEl.textContent = `${s.name}${s.country ? ' · ' + s.country : ''}`;
    const r = container.getBoundingClientRect();
    tipEl.style.display = 'block';
    const x = Math.min(Math.max(e.clientX - r.left + 12, 6), Math.max(6, r.width - 210));
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
      world.rotation.y += dx * 0.006;
      world.rotation.x = Math.max(-1.0, Math.min(1.0, world.rotation.x + dy * 0.005));
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
    if (moved >= 6) {
      // 拖动停稳后（1.2s 没有继续拖）交给页面做准星选台
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!dragging && settleCb) { try { settleCb(); } catch { /* ignore */ } }
      }, 1200);
    }
    if (moved < 6) {
      const i = hitTest(e);
      if (i >= 0) { onPick(stations[i]); setSelectedIndex(i); lastInteract = Date.now(); }
    }
    if (tipEl) tipEl.style.display = 'none';
  };
  const onLeave = () => { if (tipEl) tipEl.style.display = 'none'; };
  const onWheel = (e) => {
    e.preventDefault();
    camera.position.z = Math.max(1.85, Math.min(4.8, camera.position.z + (e.deltaY > 0 ? 0.16 : -0.16)));
    lastInteract = Date.now();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function setSelectedIndex(i) {
    if (i < 0 || !stationVecs[i]) {
      selectedIndex = -1; pillarGroup.visible = false; selectRing.visible = false; clearArcs(); return;
    }
    selectedIndex = i;
    const v = stationVecs[i];
    const nrm = v.clone().normalize();
    pillarGroup.position.copy(v);
    pillarGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    pillarGroup.visible = true;
    selectRing.position.copy(v);
    selectRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
    selectRing.scale.set(0.11, 0.11, 1);
    selectRing.visible = true;
    spawnArcs(i);
  }

  /* ==================== 12. 尺寸 ==================== */
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

  /* ==================== 13. 动画 ==================== */
  let raf = 0, disposed = false;
  const clock = new THREE.Clock();

  const tick = () => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    // 星空缓慢自转 + 呼吸
    stars.rotation.y += dt * 0.006;
    stars.rotation.x += dt * 0.0015;
    stars.material.opacity = 0.78 + Math.sin(performance.now() / 2600) * 0.12;

    // 地球自转 / 聚焦动画：滑杆选台时把目标电台转到镜头正前方
    if (focusTarget) {
      const dy = Math.atan2(Math.sin(focusTarget.y - world.rotation.y), Math.cos(focusTarget.y - world.rotation.y));
      const dx = focusTarget.x - world.rotation.x;
      world.rotation.y += dy * 0.085;
      world.rotation.x += dx * 0.085;
      if (Math.abs(dy) < 0.008 && Math.abs(dx) < 0.008) { world.rotation.y = focusTarget.y; world.rotation.x = focusTarget.x; focusTarget = null; }
    } else if (!dragging && Date.now() - lastInteract > 2500) {
      world.rotation.y += dt * 0.05;
    }

    // 卫星绕行
    satellite.rotation.y = performance.now() / 2800;

    // 频谱能量：点云随低频能量一起呼吸
    const e = stationPoints.material.size;
    const want = BASE_DOT * (1 + energy * 0.9);
    if (Math.abs(e - want) > 1e-5) stationPoints.material.size = e + (want - e) * 0.18;

    // 扩散光圈动画（文章的 WaveMesh 公式）
    for (const r of rings) {
      r._s += dt * 0.42;
      const s = r._size * r._s;
      r.scale.set(s, s, 1);
      if (r._s <= 1.5) r.material.opacity = (r._s - 1) * 2;
      else if (r._s <= 2) r.material.opacity = 1 - (r._s - 1.5) * 2;
      else r._s = 1;
    }

    // 选中光圈脉动 + 光柱亮度
    if (selectRing.visible) {
      const p = 0.5 + Math.sin(performance.now() / 500) * 0.5;
      selectRing.material.opacity = 0.35 + p * 0.5;
      selectRing.scale.setScalar(0.1 + p * 0.03);
    }
    pillarGroup.children.forEach((m, k) => {
      m.material.opacity = 0.5 + Math.sin(performance.now() / 700 + k) * 0.3;
    });

    // 飞线：光点沿曲线飞行，到达后换一条
    for (const a of arcs) {
      a.t += dt * 0.55;
      if (a.t > 1) {
        a.t = 0;
        if (selectedIndex >= 0) {
          const to = stationVecs[Math.floor(Math.random() * n)];
          const from = stationVecs[selectedIndex];
          if (to && from.distanceTo(to) > 0.25) {
            const v0 = from.clone().multiplyScalar(1.01);
            const v3 = to.clone().multiplyScalar(1.01);
            const mid = v0.clone().add(v3).multiplyScalar(0.5).normalize();
            const lift = 1.05 + v0.angleTo(v3) * 0.22;
            const vtop = mid.multiplyScalar(lift);
            a.curve = new THREE.CubicBezierCurve3(v0, v0.clone().lerp(vtop, 0.42), v3.clone().lerp(vtop, 0.42), v3);
            a.tube.geometry.dispose();
            a.tube.geometry = new THREE.TubeGeometry(a.curve, 36, 0.0022, 4, false);
          }
        }
      }
      const p = a.curve.getPointAt(Math.min(Math.max(a.t, 0), 1));
      a.comet.geometry.setFromPoints([p]);
      a.comet.geometry.attributes.position.needsUpdate = true;
      a.comet.material.opacity = 0.35 + Math.sin(a.t * Math.PI) * 0.6;
    }

    renderer.render(scene, camera);
  };
  tick();

  return {
    setSelected(station) {
      const i = station ? stations.findIndex((s) => s.id === station.id) : -1;
      setSelectedIndex(i);
    },
    pick(index) { if (stations[index]) { setSelectedIndex(index); onPick(stations[index]); } },
    /** 频谱能量 0~1：点云呼吸 + 选中光圈脉动 */
    setEnergy(v) { energy = Math.max(0, Math.min(1, Number(v) || 0)); },
    /** 准星（屏幕中心）对准的最近电台：返回下标，超过约 18° 返回 -1 */
    pickCenter() {
      if (!stations.length) return -1;
      const camDir = new THREE.Vector3(0, 0, -1);
      camDir.applyQuaternion(camera.quaternion);
      const inv = new THREE.Matrix4().copy(world.matrixWorld).invert();
      const camLocal = camera.position.clone().applyMatrix4(inv);
      const v = new THREE.Vector3();
      let best = -1, bestAngle = 0.62;   // ~35° 内选最近的台
      for (let i = 0; i < stations.length; i++) {
        v.set(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
        const toCam = camLocal.clone().sub(v).normalize();
        const n = v.clone().normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, n.dot(toCam))));
        if (ang < bestAngle) { bestAngle = ang; best = i; }
      }
      if (best < 0) {
        // 中心附近没有台时，退而求其次：取整颗球上离准星最近的台（限 75° 内）
        let any = -1, anyAngle = 1.31;
        for (let i = 0; i < stations.length; i++) {
          v.set(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
          const toCam = camLocal.clone().sub(v).normalize();
          const n = v.clone().normalize();
          const ang = Math.acos(Math.max(-1, Math.min(1, n.dot(toCam))));
          if (ang < anyAngle) { anyAngle = ang; any = i; }
        }
        return any;
      }
      return best;
    },
    /** 拖动停稳后的回调（页面用来做准星自动收听） */
    onSettle(cb) { settleCb = cb; },
    /** 把某个电台转到镜头正前方（滑杆 / 列表选台时用），带平滑动画 */
    focus(station) {
      if (!station || !Number.isFinite(station.lon)) return;
      const theta = (station.lon + 180) * Math.PI / 180;
      focusTarget = {
        y: Math.PI / 2 - theta,
        x: Math.max(-0.95, Math.min(0.95, -(station.lat || 0) * Math.PI / 180 * 0.9)),
      };
      lastInteract = Date.now();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      clearArcs();
      [pointGeo, starGeo, ringGeo, pillarGeo].forEach((g) => { try { g.dispose(); } catch { /* ignore */ } });
      [glowTex, ringTex, starTex, dotTex, pillarTex, selectTex, cometTex].forEach((t) => { try { t.dispose(); } catch { /* ignore */ } });
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

/* ==================== 贴图小工具（全部 canvas 生成，无外部图片依赖） ==================== */
function makeGlowTexture(THREE, innerAlpha = 0.9) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, `rgba(255,255,255,${innerAlpha})`);
  g.addColorStop(0.62, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeRingTexture(THREE) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  ctx.strokeStyle = 'rgba(190,245,255,0.95)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  const g = ctx.createRadialGradient(cx, cx, size * 0.36, cx, cx, size * 0.5);
  g.addColorStop(0, 'rgba(160,240,255,0.5)');
  g.addColorStop(1, 'rgba(160,240,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makePillarTexture(THREE) {
  const w = 32, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, 'rgba(160,235,255,0.75)');
  g.addColorStop(1, 'rgba(160,235,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 两侧收窄，做出光柱轮廓
  ctx.globalCompositeOperation = 'destination-in';
  const hg = ctx.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0, 'rgba(0,0,0,0)');
  hg.addColorStop(0.5, 'rgba(0,0,0,1)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
