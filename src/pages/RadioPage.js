/**
 * RadioPage v3 - 全屏沉浸式电台漫游（参考 RoamDial 的交互）
 *
 * 布局：地球铺满全屏；底部一条滑动条在地球电台间滑动选台（松手即播）；
 *      上一个 / 下一个、播放暂停、音量、浏览面板（国家 / 流派 / 搜索）。
 * 数据：本站 /api/radio/*（Radio Browser 目录 + 服务器音频中转）。
 */
export class RadioPage {
  constructor(toast) {
    this.toast = toast || null;
    this.inited = false;
    this.geoStations = [];      // 滑杆的序列（按经度排序，像绕地球飞一圈）
    this.listStations = [];     // 浏览面板里的列表
    this.index = -1;
    this.current = null;
    this.audio = null;
    this.autoNextCount = 0;
    this._loadingGeo = false;
    this._loadingList = false;
    this.ccNames = {};          // 国家代码 → 国家名
    this._ac = null;            // AudioContext（频谱用）
    this._analyser = null;
    this._srcNode = null;
    this._specRAF = null;
    this._nowTimer = null;
    this._hls = null;
    this._pendingPlay = null;
  }

  $(id) { return document.getElementById(id); }

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  init() {
    if (this.inited) return;
    this.inited = true;
    this.audio = this.$('radio-audio');

    this.$('radio-play')?.addEventListener('click', () => this.togglePlay());
    this.$('radio-prev')?.addEventListener('click', () => this.step(-1));
    this.$('radio-next')?.addEventListener('click', () => this.step(1));

    const slider = this.$('radio-slider');
    if (slider) {
      // input：拖动中预览（换台名、地球转向、高亮），不直接播放
      slider.addEventListener('input', () => this.setIndex(Number(slider.value), false));
      // change：松手才播放
      slider.addEventListener('change', () => this.setIndex(Number(slider.value), true));
    }

    // 音量（记住上次；注意 localStorage 空值时 Number(null)=0 会静音）
    const vol = this.$('radio-volume');
    if (vol) {
      const raw = localStorage.getItem('pk_radio_volume');
      const saved = raw === null ? NaN : Number(raw);
      vol.value = String(Number.isFinite(saved) && saved >= 0 ? saved : 80);
      this.applyVolume(vol.value);
      vol.addEventListener('input', () => {
        this.applyVolume(vol.value);
        try { localStorage.setItem('pk_radio_volume', vol.value); } catch { /* ignore */ }
      });
    }

    this.bindSearch();
    // 自动播放被浏览器拦截时：用户下一次点击就继续
    document.addEventListener('click', () => { const fn = this._pendingPlay; if (fn) { this._pendingPlay = null; fn(); } });
    this.updateStatus('已暂停 · 空格继续');

    // 搜索浮层开关（顶栏放大镜）
    this.$('radio-q-btn')?.addEventListener('click', () => {
      const box = this.$('radio-searchbox');
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) this.$('radio-q')?.focus();
    });
    // 收藏（本机）
    this.loadFavs();
    this.$('radio-fav')?.addEventListener('click', () => this.toggleFav());
    this.$('radio-song-fav')?.addEventListener('click', () => this.toggleFav());
    // 星盘按钮
    this.$('dial-play')?.addEventListener('click', () => {
      const st = this._dialStation || this.current;
      if (!st) return;
      if (this.current && this.current.id === st.id) this.togglePlay();
      else this.playStation(st);
    });
    this.$('dial-fav')?.addEventListener('click', () => { this.toggleFav(); this.updateDialFav(); });
    this.$('dial-next')?.addEventListener('click', () => { this.step(1); this.closeDial(); });
    this.$('dial-close')?.addEventListener('click', () => this.closeDial());
    document.addEventListener('pointerdown', (e) => {
      const dial = this.$('radio-dial');
      if (!dial || dial.hidden || dial.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#radio-globe')) return;
      this.closeDial();
    });
    // 准星刻度盘 + 时钟
    this.buildReticle();
    this.updateClock();
    if (!this._clockTimer) this._clockTimer = setInterval(() => this.updateClock(), 15000);
    // 传输按钮：下一站带文字（对齐 RoamDial）
    try {
      const nextBtn = this.$('radio-next');
      if (nextBtn) { nextBtn.classList.add('rd-next'); nextBtn.innerHTML = '⏭<span>下一站</span>'; }
      const prevBtn = this.$('radio-prev');
      if (prevBtn) prevBtn.innerHTML = '⏮';
    } catch { /* ignore */ }
    // 地球风格切换（点阵 / 写实）
    this.$('rd-settings-close')?.addEventListener('click', () => this.closeSettings());
    this.$('rd-static-close')?.addEventListener('click', () => this.closeStatic());
    document.querySelectorAll('#page-radio .rd-credit-link').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); this.openStatic(a.dataset.page || 'about'); });
    });
    this.$('radio-globe-style')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSettings();
    });

    // 视图切换：地球 / 流派星云 / 收藏
    this.view = 'globe';
    this.genreFilter = -1;
    document.querySelectorAll('#page-radio .radio-view').forEach((b) => {
      b.addEventListener('click', () => this.setView(b.dataset.view));
    });
    // 进入：确保正在播放当前台（或从当前开始播）
    this.$('radio-enter')?.addEventListener('click', () => this.setHint('按空格播放/暂停'));
    this.$('rd-record-play')?.addEventListener('click', () => {
      if (this.audio && !this.audio.paused) this.audio.pause();
      else if (this.current) this.audio.play().catch(() => {});
      setTimeout(() => this.updateRecord(), 120);
    });
    this.$('rd-record-next')?.addEventListener('click', () => { this.step(1); this.updateRecord(); });
    this.$('rd-record-fav')?.addEventListener('click', () => { this.toggleFav(); this.updateRecord(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeRecord();
    });

    // 浏览面板
    this.$('radio-auto')?.addEventListener('click', () => this.toggleAutoTour());
    this.$('radio-sheet-toggle')?.addEventListener('click', () => this.toggleSheet());
    this.$('radio-sheet-close')?.addEventListener('click', () => this.toggleSheet(false));
    this.$('rd-genres-close')?.addEventListener('click', () => this.closeGenres());
    this.$('radio-chips')?.addEventListener('click', (e) => { const chip = e.target.closest('.radio-chip-btn'); if (chip && (chip.dataset.cat === 'all' || chip.dataset.g === '-1')) { e.preventDefault(); e.stopPropagation(); this.openGenres(); } }, true);
    this.$('radio-search')?.addEventListener('input', () => this.renderList());
    this.$('radio-country')?.addEventListener('change', () => this.loadListStations());
    this.$('radio-tag')?.addEventListener('change', () => this.loadListStations());

    // 音频事件
    this.audio?.addEventListener('playing', () => { this.setPlayingUI(true); this.clearStall(); try { this.updateRecord(); } catch { /* ignore */ } });
    this.audio?.addEventListener('timeupdate', () => { if (this.audio && this.audio.currentTime > 0.2) this.clearStall(); });
    this.audio?.addEventListener('pause', () => { this.setPlayingUI(false); try { this.updateRecord(); } catch { /* ignore */ } });
    this.audio?.addEventListener('error', () => this.onAudioError());
    this.audio?.addEventListener('stalled', () => { /* 等看门狗 */ });

    // 键盘：← → 换台，空格暂停，F 收藏，Enter 进入，/ 搜索（仅本页激活时）
    document.addEventListener('keydown', (e) => {
      const page = this.$('page-radio');
      if (!page || !page.classList.contains('active')) return;
      const tag = e.target && e.target.tagName ? e.target.tagName : '';
      if (/input|select|textarea/i.test(tag)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'F' || e.key === 'f') { this.toggleFav(); }
      else if (e.key === 'G' || e.key === 'g') { this.setView(this.view === 'nebula' ? 'globe' : 'nebula'); }
      else if (e.key === 'M' || e.key === 'm') { if (this.audio) { this.audio.muted = !this.audio.muted; this.setHint(this.audio.muted ? '已静音' : '已取消静音'); } }
      else if (e.key === 'Enter') { this.$('radio-enter')?.click(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.stepSameCountry(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.stepSameCountry(1); }
      else if (e.key === 'L' || e.key === 'l') {
        try { localStorage.setItem('pk_radio_pinned', (this.current || {}).id || ''); this.setHint('已固定：' + ((this.current || {}).name || '当前电台')); } catch { /* ignore */ }
      }
      else if (e.key === 'Escape') {
        const rec = this.$('rd-record');
        const sheet = this.$('radio-sheet');
        const sb = this.$('radio-searchbox');
        const dial = this.$('radio-dial');
        const genresBox = this.$('rd-genres');
        if (genresBox && !genresBox.hidden) { this.closeGenres(); return; }
        const staticBox = this.$('rd-static');
        if (staticBox && !staticBox.hidden) { this.closeStatic(); return; }
        const setBox = this.$('rd-settings');
        if (setBox && !setBox.hidden) this.closeSettings();
        else if (rec && !rec.hidden) this.closeRecord();
        else if (dial && !dial.hidden) dial.hidden = true;
        else if (sheet && !sheet.hidden) this.toggleSheet(false);
        else if (sb && !sb.hidden) sb.hidden = true;
      }
      else if (e.key === '/') {
        e.preventDefault();
        const box = this.$('radio-searchbox');
        if (box) box.hidden = false;
        this.$('radio-q')?.focus();
      }
    });

    try { window.__pkRadio = this; } catch { /* 调试钩子 */ }
    // 加载兜底提示：超过 12 秒还在加载就换文案，避免用户以为没加载出来
    this._bootTimer = setTimeout(() => {
      if (!this._globe) this.bootShow('正在加载星图（数据量较大，请稍候）…');
    }, 12000);
    window.addEventListener('resize', () => {
      if (this.view === 'nebula') this.renderNebula();
    });

    try {
      const bh = this.$('rd-blackhole');
      const stage = this.$('radio-stage');
      if (bh && stage) {
        stage.addEventListener('pointermove', (e) => {
          if (this.view !== 'nebula') { bh.classList.remove('on'); return; }
          const r = stage.getBoundingClientRect();
          bh.style.left = (e.clientX - r.left) + 'px';
          bh.style.top = (e.clientY - r.top) + 'px';
          bh.classList.add('on');
        });
        stage.addEventListener('pointerleave', () => bh.classList.remove('on'));
      }
    } catch { /* ignore */ }
    this.applySettings();
    // 无操作：1.2s 隐藏 UI、30s 自动巡游（设置可关）
    this._act = Date.now();
    this._introOpen = true;
    const act = () => { this._act = Date.now(); try { this.$('page-radio')?.classList.remove('ui-idle'); } catch { /* ignore */ } };
    ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, act, { passive: true }));
    if (!this._idleTimer) {
      this._idleTimer = setInterval(() => {
        const page = this.$('page-radio');
        if (!page || !page.classList.contains('active')) return;
        if (this._introOpen) { this._act = Date.now(); return; }
        const idle = Date.now() - this._act;
        const busy = ['rd-record', 'rd-settings', 'radio-sheet', 'radio-searchbox'].some((id) => { const el = this.$(id); return el && !el.hidden; });
        page.classList.toggle('ui-idle', !busy && idle > 1200);
        const st = this.getSettings ? this.getSettings() : {};
        if (st.autodive !== false && idle > 30000 && this.audio && !this.audio.paused && !busy) {
          this._act = Date.now();
          this.step(1);
          this.setHint('自动巡游 · 下一站');
        }
      }, 4000);
    }
    this.ensureSpaceBackground();
    this.loadFilters();
    this.loadListStations();
    this.loadGlobe();
  }

  /* ==================== 地球 + 滑杆序列 ==================== */
  async loadGlobe() {
    const el = this.$('radio-globe');
    const loading = this.$('radio-globe-loading');
    if (!el || this._loadingGeo || this._globe) return;
    this._loadingGeo = true;
    this.bootShow('正在加载电台…');
    try {
      await this.loadCountryNames();
      // 先加载核心台库（约 500KB，先出图），完整台库随后后台补全
      this.bootShow('正在加载核心台库…');
      let stations = null;
      try {
        const d = await fetch('/data/stations-lite.json', { cache: 'force-cache' }).then((r) => r.json());
        stations = this.parseDataset(d);
      } catch { /* 核心包缺失时退回接口 */ }
      if (!stations || !stations.length) {
        try {
          const r = await fetch('/api/radio/geo');
          const d = await r.json();
          if (d && d.success && d.stations && d.stations.length) stations = d.stations;
        } catch { /* ignore */ }
      }
      if (!stations || !stations.length) throw new Error('全球电台数据不可用');
      // 按经度排序：滑杆从左到右就像绕地球飞一圈
      this.geoStations = stations.slice().sort((a, b) => (a.lon - b.lon) || (a.lat - b.lat));
      this._globeStations = this.geoStations;   // 调试/测试用别名
        this.ensureLandMask();
      this.bootShow(`正在绘制星图（${this.geoStations.length.toLocaleString('zh-CN')} 个电台）…`);
      this.bootShow('正在加载 3D 地球…');
      const globeOpts = {
        tooltipEl: this.$('radio-globe-tip'),
        onPick: (s) => this.onGlobePick(s),
        onHover: (s, x, y) => this.onHover(s, x, y),
      };
      try {
        // 首选自研 Three.js 3D 地球（贴图 + 大气 + 飞线 + 分级光点 + 飞入动画）
        const { createRadioGlobe } = await import('./RadioGlobeV2.js');
        this._globe = await createRadioGlobe(el, this.geoStations, globeOpts);
        console.log('[radio] 地球渲染器：自研 V2');
      } catch (e1) {
        console.warn('自研 V2 失败：', e1);
        try {
          const { createRadioGlobeGL } = await import('./RadioGlobeGL.js');
          this._globe = await createRadioGlobeGL(el, this.geoStations, globeOpts);
          console.log('[radio] 地球渲染器：globe.gl（回退）');
        } catch (e2) {
          try {
            const { createRadioGlobe } = await import('./RadioGlobe.js');
            this._globe = await createRadioGlobe(el, this.geoStations, globeOpts);
            console.log('[radio] 地球渲染器：点阵（回退）');
          } catch (e3) {
            this.bootHide();
            this.renderNebula();
            this.setView('nebula');
            return;
          }
        }
      }
      // 拖动停稳后：准星对准的最近电台自动收听（RoamDial 的核心交互）
      try { this._globe.onSettle?.(() => this.autoTuneFromCrosshair()); } catch { /* ignore */ }
      // 介绍页：点击地球也能进入（拖动仍然可以旋转）
      try {
        const globeEl = this.$('radio-globe');
        if (globeEl && !this._introClickBound) {
          this._introClickBound = true;
          globeEl.addEventListener('click', () => {
            const box = this.$('rd-intro');
            if (box && !box.hidden) this.$('rd-continue')?.click();
          });
        }
      } catch { /* ignore */ }
      this.loadFullStations();
      // 预热星云模块（用户切过去时不用等）
      import('./RadioNebula3D.js').catch(() => {});
      this.buildChips();
      this.startLabels();
      this.updateFavCount();
      const slider = this.$('radio-slider');
      if (slider) { slider.max = String(Math.max(0, this.geoStations.length - 1)); slider.disabled = false; }
      try {
        if (!(/[?&]s=[0-9a-f]{6,12}/i.test(location.search))) {
          this._globe?.holdIntro?.();
        this._globe?.setOpacity?.(0.3);
        }
      } catch { /* ignore */ }
      // ?s=<12位 hex> 分享链接：直接定位该台且跳过入场页
      try {
        const sp = new URLSearchParams(location.search).get('s');
        if (sp && /^[0-9a-f]{6,12}$/i.test(sp)) {
          const idx = this.geoStations.findIndex((x) => x.id === sp);
          if (idx >= 0) { this._shareId = sp; this.index = idx; this.setIndex(idx, false); }
        }
      } catch { /* ignore */ }
      if (loading) loading.style.display = 'none';
      this.bootHide();
      this.ensureLandMask();
      setTimeout(() => { this._introOpen = false; }, 30000);
      try { this.showIntro(); } catch (e) { console.warn('intro 失败：', e); }
      // 恢复上次听的电台（没有就从第一个开始）
      let startIdx = 0;
      try {
        const savedId = localStorage.getItem('pk_radio_station');
        if (savedId) { const k = this.geoStations.findIndex((s) => s.id === savedId); if (k >= 0) startIdx = k; }
      } catch { /* ignore */ }
      this.setIndex(startIdx, false);
      // 抽屉先用地球数据集填满（目录接口可能不可用）
      if (!this.listStations.length) {
        this.listStations = this.geoStations.map((g) => ({ id: g.id, name: g.name, country: g.country, codec: g.codec, bitrate: g.bitrate, url: g.url }));
        this.renderList();
      }
      const meta = this.$('radio-top-meta');
      if (meta) meta.textContent = `${this.geoStations.length} 个电台`;
    } catch (e) {
      if (loading) loading.textContent = '地球加载失败：' + (e.message || e);
      this.setHint('地球加载失败，可用「浏览」面板选台', true);
    } finally { this._loadingGeo = false; }
  }

  onGlobePick(station) {
    const i = this.geoStations.findIndex((s) => s.id === station.id);
    if (i >= 0) { this.index = i; this.syncSlider(); }
    this.playStation(station);
    this.openDial(station);
    try { this._globe?.focus?.(station); } catch { /* ignore */ }
    try { if (this.view === 'nebula') this._neb3d?.flyToStation?.(station); else this._globe?.zoomTo?.(1.45, 0.4); } catch { /* ignore */ }
  }

  /** 悬停星点：显示台名提示（roamdial 的悬停动画） */
  onHover(station, x, y) {
    const tip = this.$('radio-globe-tip');
    if (!tip) return;
    if (typeof x === 'number') this._hoverX = x;
    if (typeof y === 'number') this._hoverY = y;
    if (!station) { tip.style.display = 'none'; return; }
    tip.textContent = station.name || '';
    tip.style.display = 'block';
    const stage = this.$('radio-globe-wrap');
    const rect = stage ? stage.getBoundingClientRect() : { left: 0, top: 0 };
    tip.style.left = Math.round((this._hoverX || 0) - rect.left + 14) + 'px';
    tip.style.top = Math.round((this._hoverY || 0) - rect.top - 12) + 'px';
  }

  /** 星盘：点中星点后在准星处弹出的圆形操作盘 */
  openDial(station) {
    const dial = this.$('radio-dial');
    if (!dial || !station) return;
    const name = this.$('dial-name');
    const genre = this.$('dial-genre');
    const meta = this.$('dial-meta');
    if (name) name.textContent = station.name || '';
    if (genre) genre.textContent = (this.genres && station.g != null ? this.genres[station.g] : '') || '电台';
    if (meta) {
      const flag = this.flagOf(station.cc);
      meta.textContent = [flag, station.country, station.bitrate ? station.bitrate + ' KBPS' : ''].filter(Boolean).join(' · ');
    }
    this._dialStation = station;
    dial.hidden = false;
    requestAnimationFrame(() => dial.classList.add('open'));
    this.buildDialTicks();
    this.updateDialFav();
  }

  closeDial() {
    const dial = this.$('radio-dial');
    if (!dial) return;
    dial.classList.remove('open');
    setTimeout(() => { if (!dial.classList.contains('open')) dial.hidden = true; }, 240);
  }

  buildDialTicks() {
    const g = this.$('dial-tick-marks');
    if (!g || g.childNodes.length) return;
    let html = '';
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r1 = 88, r2 = i % 5 === 0 ? 96 : 92;
      const x1 = 100 + Math.cos(a) * r1, y1 = 100 + Math.sin(a) * r1;
      const x2 = 100 + Math.cos(a) * r2, y2 = 100 + Math.sin(a) * r2;
      html += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="rgba(255,217,160,.5)" stroke-width="1"/>';
    }
    g.innerHTML = html;
  }

  updateDialFav() {
    const b = this.$('dial-fav');
    if (!b) return;
    const s = this._dialStation || this.current;
    if (!s) return;
    b.textContent = this.isFav(s.id) ? '♥' : '♡';
  }

  syncSlider() {
    const slider = this.$('radio-slider');
    if (slider && this.index >= 0) slider.value = String(this.index);
  }

  /** 切到第 i 个电台：预览（play=false）或直接播放 */
  setIndex(i, play) {
    // 首次进入工作区默认切到 Sky 星图（规格书 §4.1）
    if (play && !this._enteredSky) { this._enteredSky = true; try { this.setView('nebula'); } catch { /* ignore */ } }
    const n = this.geoStations.length;
    if (!n) return;
    const idx = ((i % n) + n) % n;
    this.index = idx;
    const s = this.geoStations[idx];
    this.setNowPlaying(s);
    // 预览（play=false）时不移动镜头，保持初始的全球视角；切台才聚焦
    try { this._globe?.setSelected(s); if (play) this._globe?.focus?.(s); } catch { /* ignore */ }
    if (play) { try { this.playTuneStatic('switch'); } catch { /* ignore */ } }
    this.syncSlider();
    this.setHint(`第 ${idx + 1} / ${n} 个 · ${[s.country, s.codec, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · ')}`);
    if (play) {
      this.playStation(s);
      try {
        const id = String(s.id || '');
        if (/^[0-9a-f]{6,12}$/i.test(id)) history.replaceState(null, '', '?s=' + id);
      } catch { /* ignore */ }
    }
  }

  step(delta) {
    if (!this.geoStations.length) return;
    const i = this.index < 0 ? 0 : this.index + delta;
    this.setIndex(i, true);
  }

  setNowPlaying(s) {
    const country = this.$('radio-now-country');
    const name = this.$('radio-now-name');
    const sub = this.$('radio-now-sub');
    const flag = this.flagOf(s.cc);
    const city = (s.state || '').replace(/\s+/g, ' ').trim();
    const place = [city ? city + ' · ' : '', this.zhCountry(s.cc) || s.country || s.cc].filter(Boolean).join(' ');
    if (country) country.textContent = place || '未知地区';
    if (name) name.textContent = s.name || '未命名电台';
    if (sub) {
      const genre = this.genres && s.g != null ? (this.genres[s.g] || '') : '';
      const lang = this.langs && s.l != null ? (this.langs[s.l] || '') : '';
      sub.textContent = [genre, lang, s.bitrate ? s.bitrate + ' KBPS' : '码率未知'].filter(Boolean).join(' · ');
    }
    const tuneName = this.$('rd-tune-name');
    if (tuneName) tuneName.textContent = s.name || '';
    // 光晕颜色跟随当前 genre
    try {
      const rd = this.$('page-radio');
      if (rd && s.g != null) {
        const pal = ['#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6', '#D8B26E', '#E2C35A', '#B7A3D9', '#C8B49A', '#EDE3CC', '#A9C08A'];
        rd.style.setProperty('--glow-c', pal[(s.g || 0) % pal.length] + '66');
      }
    } catch { /* ignore */ }
    const song = this.$('radio-now-song');
    if (song && this.current !== s) { song.textContent = ''; song.style.display = 'none'; }
    this.buildServices(s);
    try { this.updateClock(); } catch { /* ignore */ }
    try { this.updateFavUI(); } catch { /* ignore */ }
  }

  flagOf(cc) {
    if (!cc || cc.length !== 2) return '';
    try { return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))); } catch { return ''; }
  }

  /** 「此刻」下面的音乐服务外链（用台名去各平台搜，和 roamdial 一致） */
  buildServices(s) {
    const box = this.$('radio-services');
    if (!box) return;
    const q = encodeURIComponent(s.name || '');
    const items = [
      ['网易云', 'https://music.163.com/#/search/m/?s=' + q],
      ['QQ音乐', 'https://y.qq.com/n/ryqq/search?w=' + q],
      ['Spotify', 'https://open.spotify.com/search/' + q],
      ['Apple Music', 'https://music.apple.com/us/search?term=' + q],
      ['YouTube', 'https://www.youtube.com/results?search_query=' + q],
      ['Google', 'https://www.google.com/search?q=' + q],
    ];
    box.innerHTML = items.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`).join('');
  }

  /* ==================== 播放 ==================== */
  applyVolume(v) {
    if (!this.audio) return;
    this.audio.volume = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  }

  clearStall() {
    if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; }
  }

  armStall() {
    this.clearStall();
    this._stallTimer = setTimeout(() => {
      const a = this.audio;
      if (!a || a.paused) return;
      if (a.currentTime > 0.2 || a.readyState >= 2) return;
      this.onAudioError();
    }, 9000);
  }

  async playStation(s) {
    if (!s || !s.url) { this.toast?.show?.('这个电台没有可用音频地址', 'error'); return; }
    this.current = s;
    this.autoNextCount = 0;
    this.stopNowPlaying();
    this.setPlayingUI(true);
    this.setNowPlaying(s);
    this.setHint('正在连接…');
    this.updateStatus('连台中');
    // HLS（.m3u8）走 hls.js 动态加载；失败再退回原生 <audio>
    const isHls = /\.m3u8($|\?)/i.test(s.url);
    let hlsOk = false;
    if (isHls && this._hls) { try { this._hls.destroy(); } catch { /* ignore */ } this._hls = null; }
    try {
      this.audio.removeAttribute('src');
      this.audio.load();
      if (isHls) {
        try {
          const Hls = await this.ensureHls();
          if (Hls && Hls.isSupported && Hls.isSupported()) {
            this._hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            this._hls.loadSource(s.url);
            this._hls.attachMedia(this.audio);
            hlsOk = true;
          }
        } catch { /* 加载失败就退回原生 */ }
      }
      if (!hlsOk) this.audio.src = '/api/radio/stream?u=' + encodeURIComponent(s.url);
    } catch { /* ignore */ }
    this.armStall();
    try {
      await this.audio.play();
      this.updateStatus('播放中');
      this.setHint('正在播放：' + s.name);
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        // 浏览器拦截自动播放：等用户下一次点击
        this._pendingPlay = () => this.playStation(s);
        this.updateStatus('待点击播放');
        this.setHint('点一下播放按钮开始');
      } else {
        this.updateStatus('流不可用');
      }
    }
    this.setupSpectrum();
    this.startNowPlaying(s);
  }

  togglePlay() {
    if (!this.audio) return;
    if (this.current && !this.audio.paused) { this.audio.pause(); return; }
    if (this.current) { this.audio.play().catch(() => {}); return; }
    this.step(1);
  }

  setPlayingUI(on) {
    const btn = this.$('radio-play');
    if (btn) btn.textContent = on ? '❚❚' : '▶';
  }

  playFromList(s) {
    const i = this.geoStations.findIndex((g) => g.id === s.id);
    if (i >= 0) { this.index = i; this.syncSlider(); }
    this.playStation(s);
    this.toggleSheet(false);
  }

  onAudioError() {
    this.clearStall();
    this.setPlayingUI(false);
    if (!this.current) return;
    if (this.autoNextCount >= 5) { this.setHint('这个台打不开，换一个试试', true); return; }
    this.autoNextCount += 1;
    this.setHint('这个台连不上，自动换下一个…', true);
    setTimeout(() => {
      if (this.index >= 0 && this.geoStations.length) this.setIndex(this.index + 1, true);
      else this.step(1);
    }, 700);
  }

  /** 自动漫游：每 25 秒自动换一台，像收音机巡游 */
  toggleAutoTour() {
    const btn = this.$('radio-auto');
    if (this.autoTour) {
      this.autoTour = false;
      if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; }
      if (btn) { btn.classList.remove('active'); btn.textContent = '自动漫游'; }
      this.setHint('已停止自动漫游');
      return;
    }
    this.autoTour = true;
    if (btn) { btn.classList.add('active'); btn.textContent = '漫游中…'; }
    this.setHint('自动漫游：每 25 秒换一台');
    if (this.index < 0) this.step(1);
    this._autoTimer = setInterval(() => {
      if (this.autoTour) this.step(1);
    }, 25000);
  }
  /** 加载 HLS 库：优先本站 /vendor/hls.min.js（国内可达），失败再试 CDN */
  async ensureHls() {
    if (window.Hls) return window.Hls;
    if (this._hlsLoading) return this._hlsLoading;
    const load = (src) => new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = src; sc.async = true;
      sc.onload = () => resolve(window.Hls || null);
      sc.onerror = () => reject(new Error('load fail ' + src));
      document.head.appendChild(sc);
    });
    this._hlsLoading = (async () => {
      try { const h = await load('/vendor/hls.min.js'); if (h) return h; } catch { /* next */ }
      try { const h = await load('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'); if (h) return h; } catch { /* next */ }
      return null;
    })();
    const Hls = await this._hlsLoading;
    this._hlsLoading = null;
    return Hls;
  }
  /* ==================== 视图 / 分类筛选 / 标签 ==================== */
  genreColor(g) {
    const c = [0xe8dcc8, 0xffd9a0, 0xff9e7a, 0x8fe8ff, 0xdfe8f0, 0xffcf8f, 0xb8e6a8, 0xffb3c8, 0xd8c8ff, 0xffe08a, 0xcfe8d8];
    return '#' + (c[g % c.length] || 0xe8dcc8).toString(16).padStart(6, '0');
  }

  /** 底部流派筛选条（带每个分类的数量，像 roamdial） */
  buildChips() {
    const box = this.$('radio-chips');
    if (!box || !this.genres || !this.genres.length) return;
    const counts = new Array(this.genres.length).fill(0);
    for (const st of this.geoStations) counts[st.g || 0] = (counts[st.g || 0] || 0) + 1;
    const items = [{ g: -1, label: '全部', count: this.geoStations.length },
      ...this.genres.map((zh, i) => ({ g: i, label: zh, count: counts[i] }))];
    box.innerHTML = items.map((it) => `<button class="radio-chip-btn${this.genreFilter === it.g ? ' on' : ''}" data-g="${it.g}" type="button">${it.g >= 0 ? `<i style="background:${this.genreColor(it.g)}"></i>` : ''}${this.esc(it.label)}<small>${it.count}</small></button>`).join('');
    box.querySelectorAll('.radio-chip-btn').forEach((b) => {
      b.onclick = () => this.applyGenreFilter(Number(b.dataset.g));
    });
  }

  applyGenreFilter(g) {
    this.genreFilter = g;
    const n = this._globe ? this._globe.setFilter(g < 0 ? null : (s) => (s.g || 0) === g) : 0;
    try { this._neb3d?.setFilter?.(g < 0 ? null : (s) => (s.g || 0) === g); } catch { /* ignore */ }
    this.buildChips();
    this.setHint(g < 0 ? `全部 ${n} 个电台` : `${this.genres[g] || ''} · ${n} 个电台`);
    const first = this._globe && this._globe.getFiltered ? this._globe.getFiltered()[0] : null;
    if (first) {
      const i = this.geoStations.indexOf(first);
      if (i >= 0) { this.index = i; this.syncSlider(); this.setNowPlaying(first); }
    }
  }

  /** 切换视图：地球 / 流派星云 / 收藏 */
  async setView(v) {
    this.view = v;
    try { const rd = this.$('page-radio'); if (rd) rd.classList.toggle('sky', v === 'nebula'); } catch { /* ignore */ }
    document.querySelectorAll('#page-radio .radio-view').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'fav') { this.showFavSheet(); this.setHint('收藏 · 点一个台开始收听'); return; }
    this.toggleSheet(false);
    const globeEl = this.$('radio-globe');
    const neb = this.$('radio-nebula');
    const labels = this.$('radio-labels');
    if (v === 'nebula') {
      if (this._globe) {
        // 过渡动画：地球先俯冲并淡出，再切换到星云并从远到近飞入
        const wrap = this.$('radio-nebula3d');
        const fadeEl = this.$('rd-fade');
        // 同一批粒子从地球球面飞散成星团（1.5s），最后 0.3s 淡入黑场
        try { this._globe.morphToNebula?.(1.05); this._globe.setOpacity?.(0.25); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 820));
        try { if (fadeEl) { fadeEl.style.transition = 'opacity .3s var(--rd-ease)'; fadeEl.style.opacity = '1'; } } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 240));
        if (globeEl) globeEl.style.visibility = 'hidden';
        if (neb) neb.hidden = true;
        if (wrap) { wrap.hidden = false; wrap.classList.remove('shown'); }
        const listEl = this.$('radio-label-list'); if (listEl) listEl.innerHTML = '';
        const leadEl = this.$('radio-leaders'); if (leadEl) leadEl.innerHTML = '';
        try {
          if (!this._neb3d && !this._neb3dFailed) {
            this.setHint('正在生成星云…（首次需要几秒）');
            const { createNebula3D } = await import('./RadioNebula3D.js');
            this._neb3d = await createNebula3D(wrap, this.geoStations, {
              genres: this.genres,
              onPick: (st) => this.onGlobePick(st),
              onHover: (st, x, y) => this.onHover(st, x, y),
            });
            this._neb3d.onSettle?.(() => {
              try { const i = this._neb3d.pickCenter(); if (i >= 0) this.setIndex(i, true); } catch { /* ignore */ }
            });
          }
          try { this._neb3d?.resize?.(); } catch { /* ignore */ }
          if (this._neb3d && this._neb3d.setStations) this._neb3d.setStations(this.geoStations);
          if (this.genreFilter >= 0) this._neb3d.setFilter?.((st) => (st.g || 0) === this.genreFilter);
          // 从远处飞入星云（不是放大缩小）
          try { this._neb3d.enter?.(1.5); } catch { /* ignore */ }
          if (wrap) {
            requestAnimationFrame(() => wrap.classList.add('shown'));
          }
          await new Promise((r) => setTimeout(r, 160));
          try { if (fadeEl) fadeEl.style.opacity = '0'; } catch { /* ignore */ }
          this.setHint('流派星云 · 拖动旋转 · 滚轮飞近（粒子会贴到镜头）· 点星云收听');
        } catch (err) {
          console.warn('3D 星云不可用，回退 2D：', err);
          this._neb3dFailed = true;
          if (wrap) wrap.hidden = true;
          if (neb) neb.hidden = false;
          this.renderNebula();
          this.startNebulaAnim();
        }
        this.setHint('流派星云 · 拖动旋转 · 滚轮飞近（粒子会贴到镜头）· 点星云收听');
      } else if (this._globe && this._globe.setLayout) {
        // 自绘点阵：地球点云原地变形成 11 个星团（0.95 秒过渡）
        if (neb) neb.hidden = true;
        if (globeEl) globeEl.style.display = '';
        this._globe.setLayout('nebula');
        this.setHint('流派星云 · 拖动旋转，准星停稳自动收听；G 回地球');
      } else {
        // WebGL 不可用：退回 2D 光斑星云
        if (globeEl) globeEl.style.display = 'none';
        if (neb) neb.hidden = false;
        const listEl = this.$('radio-label-list'); if (listEl) listEl.innerHTML = '';
        const leadEl = this.$('radio-leaders'); if (leadEl) leadEl.innerHTML = '';
        this.renderNebula();
        this.setHint('流派星云 · 点任意光斑收听，或按 G 回到地球');
      }
      return;
    }
    const wrap3d = this.$('radio-nebula3d');
    const fadeEl2 = this.$('rd-fade');
    try { if (fadeEl2) { fadeEl2.style.transition = 'opacity .38s var(--rd-ease)'; fadeEl2.style.opacity = '1'; } } catch { /* ignore */ }
    if (wrap3d) wrap3d.classList.remove('shown');
    this.stopNebulaAnim();
    await new Promise((r) => setTimeout(r, 460));
    if (neb) { neb.hidden = true; neb.style.display = 'none'; }
    if (wrap3d) wrap3d.hidden = true;
    if (globeEl) globeEl.style.visibility = '';
    try { this._globe?.resetMorph?.(); } catch { /* ignore */ }
    try { this._globe?.setOpacity?.(1); this._globe?.pullOut?.(0.8); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 220));
    try { if (fadeEl2) fadeEl2.style.opacity = '0'; } catch { /* ignore */ }
    if (globeEl) globeEl.style.display = '';
    if (this._globe) this._globe.setLayout('globe');
    this.setHint('拖动旋转 · 滚轮远近 · 准星停稳自动收听');
  }

  /** 收藏视图：把收藏的台列进抽屉 */
  showFavSheet() {
    try { if (this.openSaved) { this.openSaved(); return; } } catch { /* ignore */ }
    const list = [...(this.favs || [])];
    const items = [];
    for (const id of list) {
      const st = this.geoStations.find((s) => String(s.id) === String(id));
      if (st) items.push(st);
    }
    this.listStations = items;
    const box = this.$('radio-list');
    if (box) {
      box.innerHTML = items.length ? items.map((s, i) => `<button class="radio-item" data-i="${i}" type="button">
        <span class="radio-item-play">♥</span>
        <span class="radio-item-main"><b>${this.esc(s.name)}</b><small>${this.esc([s.country, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · '))}</small></span>
      </button>`).join('') : '<p class="radio-empty">还没有收藏。播放时点 ♡ 收藏。</p>';
      box.querySelectorAll('.radio-item').forEach((el) => {
        el.onclick = () => { const s = this.listStations[Number(el.dataset.i)]; if (s) this.playFromList(s); };
      });
    }
    this.toggleSheet(true);
  }

  /** 台名标签：每 180ms 把准星附近的台投影到屏幕上 */
  startLabels() {
    if (this._labelTimer) return;
    const box = this.$('radio-labels');
    const list = this.$('radio-label-list');
    const leaders = this.$('radio-leaders');
    if (!box || !list) return;
    this._labelTimer = setInterval(() => {
      if (!this._globe || this.view === 'fav') { list.innerHTML = ''; if (leaders) leaders.innerHTML = ''; return; }
      // 星云里贴近某个星团时，弹出星盘（跟着音乐律动）
      try {
        if (this.view === 'nebula' && this._neb3d) {
          const dbg = this._neb3d.debug ? this._neb3d.debug() : null;
          const d = dbg ? dbg.camDist : 15;
          const dial = this.$('radio-dial');
          if (d < 3.9) {
            const i = this._neb3d.pickCenter ? this._neb3d.pickCenter() : -1;
            if (i >= 0) {
              if (this.index !== i) { this.setIndex(i, false); }
              this.openDial(this.geoStations[i]);
            }
          } else if (dial && !dial.hidden && d > 5.2) {
            dial.hidden = true;
          }
        }
      } catch { /* ignore */ }
      // 调谐状态：准星到最近星的像素距离
      try {
        const cx0 = (this.$('radio-labels')?.clientWidth || 1) / 2;
        const cy0 = (this.$('radio-labels')?.clientHeight || 1) / 2;
        let nearest = null, best = Infinity;
        if (this.view === 'nebula' && this._neb3d && this._neb3d.getClusterLabels) {
          for (const c of this._neb3d.getClusterLabels()) {
            const d = Math.hypot(c.x - cx0, c.y - cy0);
            if (d < best) { best = d; nearest = this.genres && this.genres[c.i]; }
          }
        } else {
          for (const l of (this._globe && this._globe.getLabels ? this._globe.getLabels(60) : [])) {
            const d = Math.hypot(l.x - cx0, l.y - cy0);
            if (d < best) { best = d; nearest = l.name; }
          }
        }
        try {
          const leads = this.$('radio-leaders');
          if (leads && best <= 140) {
            const lab = this.$('radio-labels');
            const ccx = (lab && lab.clientWidth || 1) / 2, ccy = (lab && lab.clientHeight || 1) / 2;
            let bestL = null, bd = 1e9;
            for (const l of (this.view === 'nebula' ? [] : (this._globe?.getLabels?.(80) || []))) {
              const d = Math.hypot(l.x - ccx, l.y - ccy);
              if (d < bd) { bd = d; bestL = l; }
            }
            let line = leads.querySelector('#rd-snap-line');
            if (bestL) {
              if (!line) { line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.id = 'rd-snap-line'; leads.appendChild(line); }
              line.setAttribute('x1', String(bestL.x)); line.setAttribute('y1', String(bestL.y));
              line.setAttribute('x2', String(ccx)); line.setAttribute('y2', String(ccy));
              line.setAttribute('stroke', 'rgba(243,107,69,.7)'); line.setAttribute('stroke-width', '1');
            } else if (line) line.remove();
          }
        } catch { /* ignore */ }
        const tune = this.$('rd-tune');
        if (tune) {
          const fixed = best <= 140;
          if (!isFinite(best) || best > 900) { tune.textContent = '移动准星寻找电台'; }
          else tune.textContent = fixed ? '已锁定' : '调谐中 · 最近 ' + Math.round(best) + ' PX';
          if (fixed && nearest) { const n = this.$('rd-tune-name'); if (n) n.textContent = nearest; }
          else if (this.view === 'nebula') { const n = this.$('rd-tune-name'); if (n) n.textContent = ''; }
        }
      } catch { /* ignore */ }
      if (this.view === 'nebula') {
        let clusters = [];
        try {
          if (this._neb3d && this._neb3d.getClusterLabels) clusters = this._neb3d.getClusterLabels();
          else if (this._globe.getNebulaLabels) clusters = this._globe.getNebulaLabels();
        } catch { clusters = []; }
        list.innerHTML = clusters.map((c, k) => {
          const dy = (k % 2 === 0 ? -62 : 44) + (k % 3) * 8;
          const dx = (k % 2 === 0 ? -1 : 1) * (16 + (k % 3) * 12);
          return '<span class="nebula-cluster-label" style="left:' + Math.round(c.x + dx) + 'px;top:' + Math.round(c.y + dy) + 'px"><b>' + this.esc(this.zhCountry(c.name) || c.name || '') + '</b><span>' + c.count.toLocaleString('zh-CN') + ' 个电台</span></span>';
        }).join('');
        if (leaders) leaders.innerHTML = '';
        return;
      }
      let labels = [];
      try { labels = this._globe.getLabels(26) || []; } catch { labels = []; }
      labels = labels.filter((l) => l.d !== 0 && isFinite(l.x) && isFinite(l.y)).sort((a, b) => a.ang - b.ang);
      const cur = this.current ? this.current.name : '';
      const w = box.clientWidth || 1, h = box.clientHeight || 1;
      const cx = w / 2, cy = h / 2;
      // roamdial 式：候选台围绕准星环形绽开（越近的台半径越小），并画引线指回星点
      const out = [];
      let lines = '';
      const MAX = 10;
      for (let k = 0; k < Math.min(MAX, labels.length); k++) {
        const l = labels[k];
        if (l.x < -30 || l.x > w + 30 || l.y < -30 || l.y > h + 30) continue;
        // 先按角度排序，再沿环均匀摆放：引线不交叉、标签不重叠
        labels.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        const spot = labels.indexOf(l);
        const angle = -Math.PI / 2 + spot * (Math.PI * 2 / Math.min(MAX, labels.length));
        const radius = 200 + (spot % 3) * 56;
        const lx = cx + Math.cos(angle) * radius;
        const ly = cy + Math.sin(angle) * radius * 0.72;
        // 避开底部信息面板 / 顶部按钮区 / 中央调谐文字区
        if (ly > h - 190 || ly < 84) continue;
        if (Math.abs(ly - cy) < 120 && lx > cx + 70 && lx < cx + 640) continue;
        // 避开左下正在播放面板
        if (lx < cx - 60 && ly > h - 300) continue;
        lines += '<line x1="' + Math.round(l.x) + '" y1="' + Math.round(l.y) + '" x2="' + Math.round(lx) + '" y2="' + Math.round(ly) + '" stroke="rgba(255,230,200,.28)" stroke-width="1"/>';
        out.push('<span class="radio-label' + (l.name === cur ? ' hot' : '') + '" style="left:' + Math.round(lx) + 'px;top:' + Math.round(ly) + 'px">' + this.esc(l.name) + '</span>');
        if (out.length >= 8) break;
      }
      list.innerHTML = out.join('');
      if (leaders) leaders.innerHTML = lines;
    }, 220);
  }

  parseDataset(d) {
    if (!d || !Array.isArray(d.name) || !d.name.length) return null;
    const n = d.name.length;
    const isV2 = d.v === 2 && Array.isArray(d.cc);
    this.genres = d.genres || this.genres || [];
    this.genresEn = d.genresEn || this.genresEn || [];
    this.langs = d.langs || this.langs || [];
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      if (isV2) {
        const cc = d.cc[d.c[i]] || '';
        out[i] = {
          id: d.id[i], name: d.name[i], url: d.url[i], cc,
          country: this.ccNames[cc] || cc,
          tags: String(d.tags[i] || '').split(',').filter(Boolean),
          lat: Math.max(-89.9, Math.min(89.9, d.lat[i] / 100)),
        lon: ((((d.lng[i] / 100) + 540) % 360) - 180),
          bitrate: d.br[i] || 0, codec: '',
          g: d.g[i] | 0, l: d.l[i] | 0, prec: d.prec[i] | 0, pop: d.pop[i] | 0,
        };
      } else {
        const cc = d.cc[i] || '';
        out[i] = {
          id: String(d.id ? d.id[i] : 'ds' + i), name: d.name[i], url: d.url[i], cc,
          country: this.ccNames[cc] || cc,
          tags: String(d.tag ? d.tag[i] : '').split(',').filter(Boolean),
          lat: d.lat[i], lon: d.lng[i], bitrate: d.br[i] || 0, codec: '', g: 0, l: 0,
        };
      }
    }
    this._datasetInfo = { builtAt: d.builtAt, n, v: d.v || 1 };
    this.spreadByCountry(out);
    return out;
  }

  /** 后台把完整台库（3.4 万）补进来：先出图，再加密星图 */
  async loadFullStations() {
    if (this._fullLoaded || !this._globe) return;
    this._fullLoaded = true;
    try {
      const d = await fetch('/data/stations.json', { cache: 'force-cache' }).then((r) => r.json());
      const all = this.parseDataset(d);
      if (!all || all.length <= this.geoStations.length) return;
      const curId = this.current ? this.current.id : null;
      this.geoStations = all.slice().sort((a, b) => (a.lon - b.lon) || (a.lat - b.lat));
      this._globeStations = this.geoStations;
      if (this._globe && this._globe.setStations) this._globe.setStations(this.geoStations);
      try { this.applyLandSpread(); } catch { /* ignore */ }
      if (curId) {
        const k = this.geoStations.findIndex((s) => s.id === curId);
        if (k >= 0) { this.index = k; this.current = this.geoStations[k]; this.syncSlider(); }
      }
      this.buildChips();
      try { this._neb3d?.setStations?.(this.geoStations); } catch { /* ignore */ }
      if (this.view === 'nebula' && this._neb3dFailed) this.renderNebula();
      const slider = this.$('radio-slider');
      if (slider) slider.max = String(Math.max(0, this.geoStations.length - 1));
      const meta = this.$('radio-top-meta');
      if (meta) meta.textContent = this.geoStations.length.toLocaleString('zh-CN') + ' 个电台';
      const brandSub = this.$('radio-brand-sub');
      if (brandSub) brandSub.textContent = this.geoStations.length.toLocaleString('zh-CN') + ' 个电台 · ' + new Set(this.geoStations.map((x) => x.cc)).size + ' 个国家和地区';
      this.setHint('完整台库已载入 · ' + this.geoStations.length.toLocaleString('zh-CN') + ' 个电台');
      if (this.listStations && this.listStations.length < this.geoStations.length) this.renderList();
    } catch { this._fullLoaded = false; }
  }
  /* ==================== 入场页（RoamDial 复刻） ==================== */
  showIntro() {
    const box = this.$('rd-intro');
    if (!box) return;
    if (this._shareId) return;
    const seen = (() => { try { return localStorage.getItem('pk_roam_seen') === '1'; } catch { return false; } })();
    const lastId = (() => { try { return localStorage.getItem('pk_radio_station'); } catch { return null; } })();
    const last = lastId ? this.geoStations.find((s) => s.id === lastId) : null;
    const target = last || this.geoStations[this.index] || this.geoStations[0];
    if (!target) return;
    const k = this.$('rd-intro-k');
    const name = this.$('rd-intro-name');
    const place = this.$('rd-intro-place');
    const meta = this.$('rd-intro-meta');
    const cta = this.$('rd-continue');
    if (k) k.textContent = seen ? '欢迎回来 · 上次听到' : '正在加载电台…';
    if (name) name.textContent = seen ? (target.name || '') : '去一个没听过的地方';
    if (place && seen) {
      const flag = this.flagOf(target.cc);
      const city = (target.state || '').replace(/\s+/g, ' ').trim();
      place.textContent = [city ? city + ' · ' : '', this.zhCountry(target.cc) || target.country].filter(Boolean).join(' ');
    }
    if (meta) {
      const genre = this.genres && target.g != null ? this.genres[target.g] : '';
      const lang = this.langs && target.l != null ? this.langs[target.l] : '';
      meta.textContent = [genre, lang, target.bitrate ? target.bitrate + ' KBPS' : '码率未知'].filter(Boolean).join(' · ');
    }
    if (cta) cta.textContent = seen ? '继续收听' : '进入星图';
    this.index = this.geoStations.indexOf(target);
    box.hidden = false;
    box.classList.remove('gone');
    box.classList.remove('enter');
    requestAnimationFrame(() => box.classList.add('enter'));
    try { this.$('page-radio')?.classList.add('pre'); } catch { /* ignore */ }
    const close = (play) => {
      try { localStorage.setItem('pk_roam_seen', '1'); } catch { /* ignore */ }
      box.classList.add('gone');
      setTimeout(() => { box.hidden = true; }, 260);
      try { this.$('page-radio')?.classList.remove('pre'); } catch { /* ignore */ }
      this._introOpen = false;
      try { this._globe?.replayIntro?.(); } catch { /* ignore */ }
      if (play) { this.setIndex(this.index, true); this.playStation(this.geoStations[this.index]); }
    };
    this.$('rd-continue')?.addEventListener('click', () => close(true), { once: true });
    this.$('rd-random')?.addEventListener('click', () => {
      this.index = Math.floor(Math.random() * this.geoStations.length);
      const t = this.geoStations[this.index];
      if (name) name.textContent = t.name;
      close(true);
    }, { once: true });
  }

  /* ==================== 星云动画（2D 动态星云） ==================== */
  startNebulaAnim() {
    if (this._nebRAF) return;
    const step = () => {
      this._nebRAF = requestAnimationFrame(step);
      const d = this._neb;
      if (!d || this.view !== 'nebula') return;
      const t = performance.now() / 1000;
      const ctx = d.canvas.getContext('2d');
      ctx.clearRect(0, 0, d.w, d.h);
      const bg = ctx.createRadialGradient(d.w / 2, d.h / 2, 0, d.w / 2, d.h / 2, Math.max(d.w, d.h) * 0.7);
      bg.addColorStop(0, 'rgba(30,24,18,1)');
      bg.addColorStop(1, 'rgba(10,8,6,1)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, d.w, d.h);
      ctx.globalCompositeOperation = 'lighter';
      for (let g = 0; g < d.nG; g++) {
        const c = d.centers[g];
        const cx2 = c.x + Math.sin(t * 0.25 + g) * 6;
        const cy2 = c.y + Math.cos(t * 0.21 + g * 1.3) * 5;
        const grad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, 120);
        grad.addColorStop(0, this.rgba(this.genreColor(g), 0.10 + 0.02 * Math.sin(t * 0.8 + g)));
        grad.addColorStop(1, this.rgba(this.genreColor(g), 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx2, cy2, 120, 0, Math.PI * 2);
        ctx.fill();
      }
      const spr = this._nebSprites || (this._nebSprites = []);
      for (let i = 0; i < this.geoStations.length; i++) {
        const g = (this.geoStations[i].g || 0) % d.nG;
        if (!spr[g]) spr[g] = this.nebulaSprite(this.genreColor(g));
        const drift = Math.sin(t * 0.6 + i * 0.37) * 1.6;
        const s = d.sizes[i] * (0.85 + 0.25 * Math.sin(t * 1.2 + i * 0.7));
        ctx.globalAlpha = 0.22 + 0.12 * Math.sin(t * 0.9 + i * 0.23);
        ctx.drawImage(spr[g], d.pos[i * 2] - s / 2 + drift, d.pos[i * 2 + 1] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      for (let g = 0; g < d.nG; g++) {
        const c = d.centers[g];
        ctx.font = '600 15px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillStyle = 'rgba(250,240,228,.92)';
        ctx.shadowColor = 'rgba(0,0,0,.9)';
        ctx.shadowBlur = 12;
        ctx.fillText(this.genres[g] || '', c.x, c.y - 62);
        ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillStyle = 'rgba(240,225,205,.55)';
        ctx.fillText(d.counts[g].toLocaleString('zh-CN') + ' 个电台', c.x, c.y - 44);
        ctx.shadowBlur = 0;
      }
    };
    step();
  }

  stopNebulaAnim() {
    if (this._nebRAF) { cancelAnimationFrame(this._nebRAF); this._nebRAF = null; }
  }

  /** 把「落在国家中心」的电台在国家范围内散开：国家越大/台越多，散得越开 */
  spreadByCountry(list) {
    const groups = new Map();
    for (const s of list) {
      const k = s.cc || '??';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const hashOf = (str) => {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      return h;
    };
    for (const [, arr] of groups) {
      const precise = arr.filter((s) => s.prec > 0);
      const base = precise.length >= 4 ? precise : arr;
      const lat0 = base.reduce((a, s) => a + s.lat, 0) / base.length;
      const lon0 = base.reduce((a, s) => a + s.lon, 0) / base.length;
      let sLat = 0, sLon = 0;
      for (const s of base) { sLat += Math.pow(s.lat - lat0, 2); sLon += Math.pow((s.lon - lon0) * Math.cos(lat0 * Math.PI / 180), 2); }
      sLat = Math.sqrt(sLat / base.length);
      sLon = Math.sqrt(sLon / base.length);
      const n = arr.length;
      // 散开半径：精确坐标离散度 + 台数规模（台越多、国家越大散越开）
      const rLat = Math.max(1.2, Math.min(9, sLat * 2.6 + Math.sqrt(n) * 0.34));
      const rLon = Math.max(1.5, Math.min(14, sLon * 2.6 + Math.sqrt(n) * 0.42));
      for (const s of arr) {
        if (s.prec > 0) continue;            // 有精确坐标的不动
        const h = hashOf(String(s.id || s.name));
        // 极坐标均匀撒点（hash 决定角度/半径），保证「对齐国家、但散开」
        const a = (h % 4096) / 4096 * Math.PI * 2;
        const rr = Math.sqrt(((h >>> 12) % 4096) / 4096);
        s.lat = lat0 + Math.sin(a) * rr * rLat;
        s.lon = lon0 + Math.cos(a) * rr * rLon / Math.max(0.3, Math.cos(lat0 * Math.PI / 180));
      }
    }
  }

  /** 程序化星空/星云背景（一次性生成，做成 CSS 变量） */
  ensureSpaceBackground() {
    if (this._spaceDone) return;
    this._spaceDone = true;
    try {
      const rd = this.$('page-radio');
      if (!rd) return;
      const W = 1600, H = 1000;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      // 底色
      const bg = ctx.createRadialGradient(W * 0.42, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.75);
      bg.addColorStop(0, '#0b1a17');
      bg.addColorStop(0.55, '#081210');
      bg.addColorStop(1, '#040807');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      // 星云雾团
      const palette = ['#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6', '#D8B26E', '#E2C35A', '#B7A3D9'];
      let seed = 20261020;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 9; i++) {
        const cx = rnd() * W, cy = rnd() * H;
        const r = 160 + rnd() * 420;
        const col = palette[i % palette.length];
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, col + '22');
        g.addColorStop(0.5, col + '0d');
        g.addColorStop(1, col + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 星星
      for (let i = 0; i < 1900; i++) {
        const x = rnd() * W, y = rnd() * H;
        const a = 0.12 + rnd() * 0.8;
        const rr = 0.4 + rnd() * 1.4;
        ctx.fillStyle = 'rgba(245,241,232,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      rd.style.setProperty('--rd-space', 'url(' + cv.toDataURL('image/jpeg', 0.82) + ')');
      console.log('[radio] 星空背景已生成');
    } catch (e) { /* ignore */ }
  }


  /** ↑↓ 同国家换台（在 geoStations 里按国家过滤后前后跳） */
  stepSameCountry(dir) {
    const cur = this.current || this.geoStations[this.index];
    if (!cur || !this.geoStations || !this.geoStations.length) return;
    const cc = cur.cc;
    const n = this.geoStations.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + dir * k + n * 2) % n;
      const cand = this.geoStations[i];
      if (cand && cand.cc === cc && cand !== cur) { this.setIndex(i, true); return; }
    }
    this.step(dir);
  }

  /* ==================== 粒子唱片（5 种律动形态） ==================== */
  startViz() {
    const cv = this.$('rd-viz');
    if (!cv || this._vizRaf) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, C = W / 2;
    const N = 900;
    const seed = Array.from({ length: N }, (_, i) => {
      const r1 = Math.sin(i * 12.9898) * 43758.5453;
      const k = r1 - Math.floor(r1);
      const r2 = Math.sin(i * 78.233) * 24634.6345;
      const k2 = r2 - Math.floor(r2);
      return { a: (i / N) * Math.PI * 2, r: 34 + k * 104, s: 0.5 + k2, k: k2, k3: k };
    });
    const MODES = ['环形', '螺旋', '波浪', '球体', '星云'];
    let t = 0;
    const draw = () => {
      const box = this.$('rd-record');
      if (!box || box.hidden) { this._vizRaf = requestAnimationFrame(draw); return; }
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      const e = this._bassE || 0;
      const m = this._vizMode || 0;
      for (let i = 0; i < N; i++) {
        const p = seed[i];
        let x, y, rad;
        if (m === 0) { rad = p.r * (1 + e * 0.2 + 0.05 * Math.sin(t * 2 + i * 0.05)); x = C + Math.cos(p.a + t * 0.12) * rad; y = C + Math.sin(p.a + t * 0.12) * rad; }
        else if (m === 1) { rad = p.r * 0.72 + (i / N) * 138; x = C + Math.cos(p.a + t * 0.35 + p.r * 0.012) * rad; y = C + Math.sin(p.a + t * 0.35 + p.r * 0.012) * rad; }
        else if (m === 2) { const w = Math.sin(p.a * 5 + t * 2) * (5 + e * 22); x = C + Math.cos(p.a) * p.r * 0.95; y = C + Math.sin(p.a) * (p.r * 0.4 + w); }
        else if (m === 3) { const th = p.a * 3 + t * 0.4; const rr = Math.sqrt(p.k) * 92; x = C + Math.cos(th) * Math.sin(rr / 90) * 92 * Math.cos(t * 0.2); y = C + Math.sin(th) * Math.sin(rr / 90) * 92; }
        else { x = C + Math.cos(p.a * 3 + t * 0.15) * p.r * (1 + 0.35 * Math.sin(t + i * 0.01) + e * 0.25); y = C + Math.sin(p.a * 2 + t * 0.2) * p.r; }
        const pal = ['#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6', '#D8B26E', '#E2C35A', '#B7A3D9', '#C8B49A', '#EDE3CC', '#A9C08A'];
        const gi = (this.current && this.current.g) || 0;
        const baseCol = pal[gi % pal.length];
        const sz = 1.0 + p.s * 2.0 + e * 1.4;
        ctx.globalAlpha = Math.min(1, 0.22 + 0.55 * p.k3 + e * 0.25);
        ctx.fillStyle = baseCol;
        ctx.shadowColor = baseCol;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      // 中心：台名首字母
      try {
        const nm = (this.current && this.current.name) || 'R';
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#f5f1e8';
        ctx.font = '600 34px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nm.trim().charAt(0).toUpperCase(), W / 2, H / 2);
        ctx.globalAlpha = 1;
      } catch { /* ignore */ }
      this._vizRaf = requestAnimationFrame(draw);
    };
    draw();
    const btn = this.$('rd-viz-mode');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', () => {
        this._vizMode = ((this._vizMode || 0) + 1) % MODES.length;
        btn.textContent = '粒子 · ' + MODES[this._vizMode];
      });
      btn.textContent = '粒子 · ' + MODES[this._vizMode || 0];
    }
  }
  stopViz() { if (this._vizRaf) { cancelAnimationFrame(this._vizRaf); this._vizRaf = 0; } }

  zhCountry(cc) {
    try { if (!this._dn) this._dn = new Intl.DisplayNames(['zh-CN'], { type: 'region' }); return this._dn.of(String(cc || '').toUpperCase()) || cc; } catch { return cc; }
  }

  /* ==================== Genres 流派面板 ==================== */
  openGenres() {
    const box = this.$('rd-genres');
    const list = this.$('rd-genres-list');
    if (!box || !list) return;
    const titleEl = this.$('rd-genres-title'); if (titleEl) titleEl.textContent = '流派';
    const pal = ['#8FA39C', '#E8A9A0', '#D99A7E', '#7FC8C0', '#9DB4D6', '#D8B26E', '#E2C35A', '#B7A3D9', '#C8B49A', '#EDE3CC', '#A9C08A'];
    const counts = new Array((this.genres || []).length).fill(0);
    for (const st of (this.geoStations || [])) { const g = st.g || 0; if (g < counts.length) counts[g] += 1; }
    list.innerHTML = (this.genres || []).map((name, g) => '<button class="rd-genre-row" data-g="' + g + '" type="button"><span><i style="background:' + pal[g % pal.length] + '"></i>' + this.esc(name) + '</span><small>' + (counts[g] || 0).toLocaleString('zh-CN') + '</small></button>').join('') + '<button class="rd-genre-row" data-g="-1" type="button"><span><i style="background:#f36b45"></i>全部流派</span><small>' + this.geoStations.length.toLocaleString('zh-CN') + '</small></button>';
    list.querySelectorAll('.rd-genre-row').forEach((el) => { el.onclick = () => { const g = Number(el.dataset.g); this.genreFilter = g; try { this.buildChips(); this.applyFilter && this.applyFilter(); } catch { /* ignore */ } try { this.setView('nebula'); } catch { /* ignore */ } this.closeGenres(); }; });
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('shown'));
  }
  openSaved() {
    const box = this.$('rd-genres');
    const list = this.$('rd-genres-list');
    if (!box || !list) return;
    const title = this.$('rd-genres-title'); if (title) title.textContent = '收藏';
    const favs = (this.geoStations || []).filter((st) => this.isFav && this.isFav(st.id));
    if (!favs.length) { list.innerHTML = '<p style="color:#b3c1b7;font-size:14px;padding:12px 4px">还没有收藏。播放时点 ♡ 收藏，或按 F。</p>'; }
    else {
      list.innerHTML = favs.map((st) => '<button class="rd-genre-row" data-id="' + this.esc(st.id) + '" type="button"><span>' + this.esc(st.name || '') + '</span><small>' + this.esc(this.zhCountry ? this.zhCountry(st.cc) : (st.country || st.cc)) + '</small></button>').join('');
      list.querySelectorAll('.rd-genre-row').forEach((el) => { el.onclick = () => { const id = el.dataset.id; const i = this.geoStations.findIndex((x) => String(x.id) === String(id)); if (i >= 0) { this.setIndex(i, true); } this.closeGenres(); }; });
    }
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('shown'));
  }
  closeGenres() {
    const box = this.$('rd-genres');
    if (!box) return;
    box.classList.remove('shown');
    setTimeout(() => { if (!box.classList.contains('shown')) box.hidden = true; }, 260);
  }

  /* ==================== About / Privacy ==================== */
  openStatic(kind) {
    const box = this.$('rd-static');
    if (!box) return;
    const title = this.$('rd-static-title');
    const body = this.$('rd-static-body');
    const zh = this.zhCountry ? this : this;
    if (kind === 'privacy') {
      if (title) title.textContent = '隐私';
      if (body) body.innerHTML = '<p><b>数据</b>：电台目录来自 Radio Browser 公共 API，地理数据来自 GeoNames。</p><p><b>本地存储</b>：音量、收藏、上次收听、视图偏好只存在你的浏览器 localStorage（pk_radio_* 键），不会上传。</p><p><b>音频</b>：音频流由各电台服务器直接提供，我们只做代理中转，不保存节目内容。</p><p><b>统计</b>：不使用第三方统计脚本。</p>';
    } else {
      if (title) title.textContent = '关于';
      if (body) body.innerHTML = '<p><b>RoamSky</b> 是一个「随机听世界」的电台漫游工具：星图与地球上每个光点都是一个真实电台。</p><p>拖动星图、滚轮拉近，准星停稳会自动收听最近的电台；按 <b>G</b> 可在星图与地球之间切换。</p><p>电台目录来自 <b>Radio Browser</b>，地理信息来自 <b>GeoNames</b>。</p>';
    }
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('shown'));
  }
  closeStatic() {
    const box = this.$('rd-static');
    if (!box) return;
    box.classList.remove('shown');
    setTimeout(() => { if (!box.classList.contains('shown')) box.hidden = true; }, 260);
  }

  /* ==================== 设置面板 ==================== */
  getSettings() {
    try { return Object.assign({ autotune: true, autodive: true, reduce: false, hints: true }, JSON.parse(localStorage.getItem('pk_radio_settings') || '{}')); }
    catch { return { autotune: true, autodive: true, reduce: false, hints: true }; }
  }
  saveSettings(v) {
    try { localStorage.setItem('pk_radio_settings', JSON.stringify(v)); } catch { /* ignore */ }
    this.applySettings(v);
  }
  applySettings(v) {
    const s2 = v || this.getSettings();
    try { this.$('page-radio')?.classList.toggle('reduce-motion', !!s2.reduce); } catch { /* ignore */ }
    try { const hints = this.$('radio-hints'); if (hints) hints.style.display = s2.hints ? '' : 'none'; } catch { /* ignore */ }
  }
  openSettings() {
    const box = this.$('rd-settings');
    if (!box) return;
    const s2 = this.getSettings();
    const set = (id, val) => { const el = this.$(id); if (el) el.checked = !!val; };
    set('rd-set-autotune', s2.autotune); set('rd-set-autodive', s2.autodive); set('rd-set-reduce', s2.reduce); set('rd-set-hints', s2.hints);
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('shown'));
    const onChange = () => this.saveSettings({
      autotune: this.$('rd-set-autotune')?.checked, autodive: this.$('rd-set-autodive')?.checked,
      reduce: this.$('rd-set-reduce')?.checked, hints: this.$('rd-set-hints')?.checked,
    });
    ['rd-set-autotune', 'rd-set-autodive', 'rd-set-reduce', 'rd-set-hints'].forEach((id) => {
      const el = this.$(id); if (el) el.onchange = onChange;
    });
  }
  closeSettings() {
    const box = this.$('rd-settings');
    if (!box) return;
    box.classList.remove('shown');
    setTimeout(() => { if (!box.classList.contains('shown')) box.hidden = true; }, 260);
  }

  /* ==================== 陆地掩膜：把兜底坐标的电台撒到国土陆地上 ==================== */
  async ensureLandMask() {
    if (this._landMask || this._landMaskLoading) return;
    this._landMaskLoading = fetch('/data/land-mask.json', { cache: 'force-cache' })
      .then((r) => r.json())
      .then((m) => {
        try {
          const bin = atob(m.mask);
          const bits = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
          this._landMask = { cols: m.cols, rows: m.rows, step: m.step, bits };
          this.applyLandSpread();
        } catch { /* ignore */ }
      })
      .catch(() => { /* 没有掩膜就用原来的散开方案 */ });
  }

  isLand(lat, lon) {
    const m = this._landMask;
    if (!m) return true;
    const c = Math.floor((lon + 180) / m.step);
    const r = Math.floor((90 - lat) / m.step);
    if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) return false;
    const idx = r * m.cols + c;
    return Boolean((m.bits[idx >> 3] >> (idx & 7)) & 1);
  }

  /** 把 prec=0（无精确定位）的电台分配到所属国家的陆地点上，避免飘到海里 */
  applyLandSpread() {
    const m = this._landMask;
    if (!m || !this.geoStations || !this.geoStations.length) return;
    const groups = new Map();
    for (const s of this.geoStations) {
      const k = s.cc || '??';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; };
    const landCells = [];
    for (let r = 0; r < m.rows; r += 2) {
      for (let c = 0; c < m.cols; c += 2) {
        const idx = r * m.cols + c;
        if (!((m.bits[idx >> 3] >> (idx & 7)) & 1)) continue;
        landCells.push([90 - (r + 0.5) * m.step, -180 + (c + 0.5) * m.step]);
      }
    }
    let moved = 0;
    for (const [, arr] of groups) {
      const precise = arr.filter((x) => x.prec > 0);
      if (!precise.length) continue;
      const lat0 = precise.reduce((a, x) => a + x.lat, 0) / precise.length;
      const lon0 = precise.reduce((a, x) => a + x.lon, 0) / precise.length;
      // 国家陆地点（用于无精确台的兜底，半径收紧，避免越境/入海）
      const n = arr.length;
      const rad = Math.min(6, Math.max(1.8, 1.6 + Math.sqrt(n) * 0.2));
      const cosLat = Math.max(0.25, Math.cos(lat0 * Math.PI / 180));
      const cells = [];
      for (const [la, lo] of landCells) {
        const dLat = la - lat0;
        const dLon = ((lo - lon0 + 540) % 360) - 180;
        if (Math.abs(dLat) <= rad && Math.abs(dLon) * cosLat <= rad) cells.push([la, lo]);
      }
      for (const s2 of arr) {
        // 近似定位的电台不要都堆在中心：按哈希在其所在区域（州/国家）内散开，并校验落在陆地
        if (s2.prec > 1) continue;
        const h = hash(String(s2.id || s2.name));
        const ang = ((h >>> 9) % 4096) / 4096 * Math.PI * 2;
        const baseR = s2.prec === 1 ? 1.0 : 1.2;
        const rr = (0.25 + ((h >>> 21) % 1000) / 1000 * 0.75) * baseR;
        const lat0s = s2.prec === 1 ? s2.lat : lat0;
        const lon0s = s2.prec === 1 ? s2.lon : lon0;
        let placed = false;
        for (let k = 0; k < 5; k++) {
          const q = k === 0 ? 1 : Math.pow(0.6, k);
          const la = lat0s + Math.sin(ang) * rr * q;
          const lo = lon0s + Math.cos(ang) * rr * q / Math.max(0.3, Math.cos(lat0s * Math.PI / 180));
          if (this.isLand(la, lo)) { s2.lat = la; s2.lon = ((lo + 540) % 360) - 180; placed = true; break; }
        }
        if (!placed) { s2.lat = lat0s; s2.lon = lon0s; }
        s2.approx = true;
        moved++;
      }
    }
    try {
      this._globe?.setStations?.(this.geoStations);
      this._globe?.applyZoomLevel?.();
      console.log('[radio] 陆地对齐完成（移动 ' + moved + ' 台）');
    } catch { /* ignore */ }
  }

  /* ==================== 准星刻度 / 时钟 ==================== */
  buildReticle() {
    const g = this.$('reticle-ticks');
    if (!g || g.childNodes.length) return;
    let html = '';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const r1 = 30, r2 = i % 5 === 0 ? 36 : 33;
      const x1 = 40 + Math.cos(a) * r1, y1 = 40 + Math.sin(a) * r1;
      const x2 = 40 + Math.cos(a) * r2, y2 = 40 + Math.sin(a) * r2;
      const stroke = i % 5 === 0 ? 'rgba(245,241,232,.55)' : 'rgba(245,241,232,.28)';
      html += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + stroke + '" stroke-width="1"/>';
    }
    g.innerHTML = html;
  }

  updateClock() {
    const t = this.$('radio-clock-time');
    const w = this.$('radio-clock-where');
    const st = this.current || (this.geoStations && this.geoStations[this.index]);
    if (!t) return;
    const lon = st && typeof st.lon === 'number' ? st.lon : 0;
    const offset = Math.round(lon / 15);           // 用经度估一个当地时区
    const now = new Date(Date.now() + offset * 3600 * 1000);
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    t.textContent = hh + ':' + mm;
    if (w && st) {
      const city = (st.state || '').replace(/\s+/g, ' ').trim().toUpperCase();
      const head = city ? city + ' · ' + (this.zhCountry(st.cc) || st.country) : (this.zhCountry(st.cc) || st.country);
      w.textContent = [head, '当地时间'].filter(Boolean).join(' · ');
    }
  }

  /* ==================== 启动加载层 / 流派星云 ==================== */
  bootShow(text) {
    const box = this.$('radio-boot');
    const t = this.$('radio-boot-text');
    if (t && text) t.textContent = text;
    if (box) box.hidden = false;
  }

  bootHide() {
    const box = this.$('radio-boot');
    if (box) box.hidden = true;
  }

  /** 2D 流派星云：每个分类一团光斑，点光斑就听那个台 */
  renderNebula() {
    const canvas = this.$('radio-nebula');
    const stage = this.$('radio-globe-wrap');
    if (!canvas || !stage || !this.geoStations.length) return;
    const w = (canvas.width = stage.clientWidth || 1440);
    const h = (canvas.height = stage.clientHeight || 900);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const nG = this.genres && this.genres.length ? this.genres.length : 11;
    const cx = w / 2, cy = h / 2;
    // 宇宙式铺开：黄金螺旋铺满整屏（半径随屏幕尺寸放大），各团散得更开
    const R = Math.min(w * 0.47, h * 0.46);
    const centers = [];
    for (let g = 0; g < nG; g++) {
      const th = g * 2.39996 - Math.PI / 2;
      const rr = R * Math.sqrt((g + 0.7) / nG);
      centers.push({ x: cx + Math.cos(th) * rr * 1.7, y: cy + Math.sin(th) * rr * 1.1 });
    }
    const counts = new Array(nG).fill(0);
    const pos = new Float32Array(this.geoStations.length * 2);
    const sizes = new Float32Array(this.geoStations.length);
    for (let i = 0; i < this.geoStations.length; i++) {
      const s = this.geoStations[i];
      const g = (s.g || 0) % nG;
      const c = centers[g];
      let hsh = 0;
      const t = String(s.id || s.name || '');
      for (let k = 0; k < t.length; k++) hsh = (hsh * 31 + t.charCodeAt(k)) >>> 0;
      const a = (hsh % 1024) / 1024 * Math.PI * 2;
      const rr = Math.pow(((hsh >> 10) % 1024) / 1024, 0.65) * 86 + 4;
      pos[i * 2] = c.x + Math.cos(a) * rr;
      pos[i * 2 + 1] = c.y + Math.sin(a) * rr;
      sizes[i] = 3.5 + ((hsh >> 20) % 100) / 100 * 5;
      counts[g] += 1;
    }
    this._neb = { pos, sizes, centers, canvas, w, h, nG, counts };
    this.paintNebula();
  }

  nebulaSprite(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, color);
    gr.addColorStop(0.35, color + 'cc');
    gr.addColorStop(1, color + '00');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    return c;
  }

  rgba(hex, a) {
    const s = String(hex).replace('#', '');
    const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  paintNebula() {
    const d = this._neb;
    if (!d) return;
    const { canvas, w, h, pos, sizes, centers, counts, nG } = d;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    bg.addColorStop(0, 'rgba(30,24,18,1)');
    bg.addColorStop(1, 'rgba(10,8,6,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let g = 0; g < nG; g++) {
      const c = centers[g];
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 110);
      grad.addColorStop(0, this.rgba(this.genreColor(g), 0.12));
      grad.addColorStop(1, this.rgba(this.genreColor(g), 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 130, 0, Math.PI * 2);
      ctx.fill();
    }
    const spr = this._nebSprites || (this._nebSprites = []);
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < this.geoStations.length; i++) {
      const g = (this.geoStations[i].g || 0) % nG;
      if (!spr[g]) spr[g] = this.nebulaSprite(this.genreColor(g));
      const s = sizes[i];
      ctx.drawImage(spr[g], pos[i * 2] - s / 2, pos[i * 2 + 1] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    for (let g = 0; g < nG; g++) {
      const c = centers[g];
      ctx.font = '600 16px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(250,240,228,.94)';
      ctx.shadowColor = 'rgba(0,0,0,.9)';
      ctx.shadowBlur = 12;
      ctx.fillText(this.genres[g] || '', c.x, c.y - 64);
      ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(240,225,205,.6)';
      ctx.fillText(counts[g].toLocaleString('zh-CN') + ' 个电台', c.x, c.y - 46);
      ctx.shadowBlur = 0;
    }
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width);
      const my = (e.clientY - r.top) * (canvas.height / r.height);
      let best = -1, bestD = 30 * 30;
      for (let i = 0; i < this.geoStations.length; i++) {
        const dx = pos[i * 2] - mx, dy = pos[i * 2 + 1] - my;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best >= 0) this.setIndex(best, true);
    };
  }

  updateFavCount() {
    const b = this.$('radio-fav-count');
    if (b) b.textContent = String(this.favs ? this.favs.size : 0);
  }
  /* ==================== 准星自动收听 / 收藏 ==================== */
  autoTuneFromCrosshair() {
    try { if (!this.getSettings().autotune) return; } catch { /* ignore */ }
    if (!this._globe || !this.geoStations.length) return;
    const picker = this.view === 'nebula' ? this._neb3d : this._globe;
    const i = picker && picker.pickCenter ? picker.pickCenter() : -1;
    if (i < 0) { this.setHint('准星没对准电台，再拖一点'); return; }
    if (i === this.index) { this.setHint('已锁定 · ' + this.geoStations[i].name); return; }
    this.setIndex(i, true);
    this.updateStatus('已锁定');
    this.setHint('准星锁定 · 自动收听');
    this.playTuneStatic('lock');
  }

  loadFavs() {
    try { this.favs = new Set(JSON.parse(localStorage.getItem('pk_radio_favs') || '[]')); }
    catch { this.favs = new Set(); }
    this.updateFavUI();
    this.updateFavCount();
  }

  isFav(id) { return !!(this.favs && this.favs.has(String(id))); }

  toggleFav() {
    const s = this.current || this.geoStations[this.index];
    if (!s) return;
    if (!this.favs) this.loadFavs();
    const id = String(s.id);
    if (this.favs.has(id)) this.favs.delete(id);
    else this.favs.add(id);
    try { localStorage.setItem('pk_radio_favs', JSON.stringify([...this.favs])); } catch { /* ignore */ }
    this.updateFavUI();
    this.updateFavCount();
    this.toast?.show?.(this.favs.has(id) ? '已收藏 · ' + s.name : '已取消收藏', 'success');
  }

  updateFavUI() {
    const btn = this.$('radio-fav');
    if (!btn) return;
    const s = this.current || this.geoStations[this.index];
    const on = s && this.isFav(s.id);
    btn.textContent = on ? '♥' : '♡';
    btn.classList.toggle('on', Boolean(on));
  }
  /* ==================== 调频音效（切台静电噪声） ==================== */
  ensureTuneAudio() {
    if (this._tuneCtx) return this._tuneCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      // 预生成 0.5s 白噪声
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
      this._tuneCtx = ctx;
      this._tuneNoise = buf;
      return ctx;
    } catch (e) { return null; }
  }

  /** 切台时播放一段静电/调谐声（受静音与音量控制） */
  playTuneStatic(kind = 'switch') {
    try {
      if (this.audio && this.audio.muted) return;
      const ctx = this.ensureTuneAudio();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._tuneNoise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = kind === 'lock' ? 6 : 1.4;
      bp.frequency.setValueAtTime(kind === 'lock' ? 1600 : 700, now);
      bp.frequency.exponentialRampToValueAtTime(kind === 'lock' ? 2400 : 2800, now + 0.18);
      const gain = ctx.createGain();
      const vol = Math.max(0, Math.min(1, (this.volume == null ? 0.8 : this.volume))) * (kind === 'lock' ? 0.10 : 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'lock' ? 0.16 : 0.26));
      src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
      src.start(now); src.stop(now + 0.35);
    } catch { /* ignore */ }
  }

  /* ==================== 唱片界面 ==================== */
  openRecord() {
    const box = this.$('rd-record');
    if (!box) return;
    this.ensureTuneAudio();
    box.hidden = false;
    requestAnimationFrame(() => { box.classList.add('shown'); this.startViz(); });
    this.updateRecord();
  }

  closeRecord() {
    this.stopViz();
    const box = this.$('rd-record');
    if (!box) return;
    box.classList.remove('shown');
    setTimeout(() => { if (!box.classList.contains('shown')) box.hidden = true; }, 300);
  }

  updateRecord() {
    const s = this.current || this.geoStations[this.index];
    if (!s) return;
    const name = this.$('rd-record-name'); if (name) name.textContent = s.name || '';
    const place = this.$('rd-record-place');
    if (place) {
      const city = (s.state || '').replace(/\s+/g, ' ').trim();
      place.textContent = [city ? city.toUpperCase() + ', ' : '', s.country || s.cc].filter(Boolean).join(' ');
    }
    const meta = this.$('rd-record-meta');
    if (meta) {
      const genre = this.genres && s.g != null ? this.genres[s.g] : '';
      const lang = this.langs && s.l != null ? this.langs[s.l] : '';
      meta.textContent = [genre, lang, s.bitrate ? s.bitrate + ' KBPS' : '码率未知'].filter(Boolean).join(' · ');
    }
    const initial = this.$('rd-vinyl-initial'); if (initial) initial.textContent = (s.name || 'R').trim().charAt(0).toUpperCase();
    const genreLabel = this.$('rd-vinyl-genre'); if (genreLabel) genreLabel.textContent = (this.genres && this.genres[s.g]) || '电台';
    const fav = this.$('rd-record-fav'); if (fav) fav.textContent = this.isFav(s.id) ? '♥ 已收藏' : '♡ 收藏';
    const songEl = this.$('rd-record-song'); if (songEl) songEl.textContent = this._lastSong || '';
    const play = this.$('rd-record-play');
    if (play) play.textContent = (this.audio && !this.audio.paused) ? '❚❚ 暂停' : '▶ 播放';
    const vinyl = this.$('rd-vinyl');
    if (vinyl) vinyl.classList.toggle('spinning', Boolean(this.audio && !this.audio.paused));
    try { this.buildServices(s); } catch { /* ignore */ }
    // 唱片上的音乐服务链接
    const services = this.$('rd-record-services');
    const src = this.$('radio-services');
    if (services && src) services.innerHTML = src.innerHTML;
  }

  /* ==================== 频谱 / 正在播放 / 状态 ==================== */
  updateStatus(text) {
    const el = this.$('radio-status');
    if (el) { el.textContent = text; el.dataset.state = text; }
  }

  /** 音频经同源代理播放，才能接进 Web Audio 拿频谱（跨域流拿到的是全零） */
  setupSpectrum() {
    if (this._ac) {
      if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
      this.startSpectrum();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !this.audio) return;
      this._ac = new Ctx();
      this._analyser = this._ac.createAnalyser();
      this._analyser.fftSize = 128;
      this._analyser.smoothingTimeConstant = 0.82;
      this._srcNode = this._ac.createMediaElementSource(this.audio);
      this._srcNode.connect(this._analyser);
      this._analyser.connect(this._ac.destination);
      this._freq = new Uint8Array(this._analyser.frequencyBinCount);
      this.startSpectrum();
      if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
    } catch { /* Web Audio 不可用：只保留点云自身动画 */ }
  }

  startSpectrum() {
    if (this._specRAF) return;
    const bars = this.$('radio-spec');
    if (bars && !bars.children.length) bars.innerHTML = Array.from({ length: 14 }, () => '<i></i>').join('');
    const tick = () => {
      this._specRAF = requestAnimationFrame(tick);
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(this._freq);
      const n = this._freq.length;
      let bass = 0;
      for (let i = 0; i < Math.min(8, n); i++) bass += this._freq[i];
      bass = bass / (Math.min(8, n) * 255);
      try { this._globe?.setEnergy?.(bass); } catch { /* ignore */ }
      try { this._neb3d?.setEnergy?.(bass); } catch { /* ignore */ }
      try { this.$('page-radio')?.style.setProperty('--rd-energy', String(bass)); } catch { /* ignore */ }
      this._bassE = bass;
      const dial = this.$('radio-dial');
      if (dial && !dial.hidden) dial.style.setProperty('--energy', bass.toFixed(3));
      if (bars) {
        const kids = bars.children;
        for (let i = 0; i < kids.length; i++) {
          const v = this._freq[Math.floor((i / kids.length) * n * 0.7)] / 255;
          kids[i].style.transform = 'scaleY(' + Math.max(0.12, v).toFixed(3) + ')';
        }
      }
    };
    tick();
  }

  stopSpectrum() {
    if (this._specRAF) { cancelAnimationFrame(this._specRAF); this._specRAF = null; }
  }

  /** 每 20 秒问一次服务端「现在播的是什么」（ICY StreamTitle） */
  startNowPlaying(s) {
    this.stopNowPlaying();
    const song = this.$('radio-now-song');
    if (song) { song.textContent = ''; song.style.display = 'none'; }
    const poll = async () => {
      if (!this.current || this.current.url !== s.url) return;
      try {
        const r = await fetch('/api/now?u=' + encodeURIComponent(s.url), { cache: 'no-store' }).then((x) => x.json());
        const title = r && r.title;
        if (song) {
          song.textContent = title ? '正在播放：' + title : '';
          song.style.display = title ? 'block' : 'none';
          this._lastSong = title || '';
          try { this.updateRecord(); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    };
    poll();
    this._nowTimer = setInterval(poll, 20000);
  }

  stopNowPlaying() {
    if (this._nowTimer) { clearInterval(this._nowTimer); this._nowTimer = null; }
  }

  /** 顶栏搜索：在数据集里按台名 / 国家 / 流派过滤 */
  bindSearch() {
    const q = this.$('radio-q');
    const list = this.$('radio-q-list');
    if (!q || !list) return;
    q.addEventListener('input', () => this.renderSearchList(q.value.trim()));
    q.addEventListener('focus', () => { if (q.value.trim()) this.renderSearchList(q.value.trim()); });
    q.addEventListener('keydown', (e) => {
      const items = () => Array.from(list.querySelectorAll('.radio-q-item'));
      const cur = () => list.querySelector('.radio-q-item.sel');
      if (e.key === 'Escape') { list.hidden = true; q.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const arr = items();
        if (!arr.length) return;
        const i = arr.indexOf(cur());
        const n = e.key === 'ArrowDown' ? (i + 1 + arr.length) % arr.length : (i <= 0 ? arr.length - 1 : i - 1);
        arr.forEach((el, k) => el.classList.toggle('sel', k === n));
        arr[n].scrollIntoView({ block: 'nearest' });
      }
      else if (e.key === 'Enter') { const pick = cur() || list.querySelector('.radio-q-item'); if (pick) pick.click(); }
    });
    document.addEventListener('click', (e) => {
      if (!e.target || !e.target.closest || !e.target.closest('.radio-searchbox')) list.hidden = true;
    });
  }

  renderSearchList(kw) {
    const list = this.$('radio-q-list');
    if (!list) return;
    const k = kw.toLowerCase();
    if (!k) { list.hidden = true; list.innerHTML = ''; return; }
    const hits = [];
    for (let i = 0; i < this.geoStations.length && hits.length < 12; i++) {
      const s = this.geoStations[i];
      const hay = (s.name + ' ' + (s.country || '') + ' ' + (s.cc || '') + ' ' + (s.tags || []).join(',')).toLowerCase();
      if (hay.includes(k)) hits.push({ s, i });
    }
    if (!hits.length) { list.innerHTML = '<div class="radio-q-empty">没有匹配的电台</div>'; list.hidden = false; return; }
    list.innerHTML = hits.map(({ s, i }) => `<button class="radio-q-item" data-i="${i}" type="button">
      <b>${this.esc(s.name)}</b>
      <small>${this.esc([s.country, s.cc, (s.tags || []).slice(0, 2).join(' / ')].filter(Boolean).join(' · '))}</small>
    </button>`).join('');
    list.hidden = false;
    list.querySelectorAll('.radio-q-item').forEach((el) => {
      el.onclick = () => {
        this.setIndex(Number(el.dataset.i), true);
        list.hidden = true;
        const input = this.$('radio-q');
        if (input) input.value = '';
      };
    });
  }

  async loadCountryNames() {
    if (Object.keys(this.ccNames).length) return;
    try {
      const c = await fetch('/api/radio/countries').then((r) => r.json());
      if (c && c.success) for (const x of c.countries) if (x.code) this.ccNames[x.code] = x.name;
    } catch { /* ignore */ }
  }

  /* ==================== 浏览面板（国家 / 流派 / 搜索） ==================== */
  toggleSheet(force) {
    const sheet = this.$('radio-sheet');
    if (!sheet) return;
    const show = typeof force === 'boolean' ? force : sheet.hidden;
    sheet.hidden = !show;
    sheet.classList.toggle('show', show);
  }

  async loadFilters() {
    try {
      const [cRes, tRes] = await Promise.all([
        fetch('/api/radio/countries').then((r) => r.json()).catch(() => null),
        fetch('/api/radio/tags').then((r) => r.json()).catch(() => null),
      ]);
      const cSel = this.$('radio-country');
      if (cSel && cRes?.success) {
        cSel.innerHTML = '<option value="">全部国家</option>' + (cRes.countries || []).slice(0, 120)
          .map((c) => `<option value="${this.esc(c.name)}">${this.esc(c.name)}（${c.stations}）</option>`).join('');
      }
      const tSel = this.$('radio-tag');
      if (tSel && tRes?.success) {
        tSel.innerHTML = '<option value="">全部流派</option>' + (tRes.tags || []).slice(0, 60)
          .map((t) => `<option value="${this.esc(t.name)}">${this.esc(t.name)}（${t.stations}）</option>`).join('');
      }
    } catch { /* ignore */ }
  }

  async loadListStations() {
    if (this._loadingList) return;
    this._loadingList = true;
    const box = this.$('radio-list');
    if (box) box.innerHTML = '<p class="radio-empty">正在取电台目录…</p>';
    try {
      const q = new URLSearchParams({ limit: '60' });
      const country = this.$('radio-country')?.value || '';
      const tag = this.$('radio-tag')?.value || '';
      if (country) q.set('country', country);
      if (tag) q.set('tag', tag);
      const r = await fetch('/api/radio/stations?' + q.toString());
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '加载失败');
      this.listStations = d.stations || [];
      this.renderList();
    } catch (e) {
      if (box) box.innerHTML = `<p class="radio-empty">${this.esc(e.message)}</p>`;
    } finally { this._loadingList = false; }
  }

  renderList() {
    const box = this.$('radio-list');
    if (!box) return;
    const q = (this.$('radio-search')?.value || '').trim().toLowerCase();
    const list = q
      ? this.listStations.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.country || '').toLowerCase().includes(q))
      : this.listStations;
    if (!list.length) { box.innerHTML = '<p class="radio-empty">没有匹配的电台</p>'; return; }
    box.innerHTML = list.map((s, i) => {
      const meta = [s.country, s.codec, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · ');
      const on = this.current && this.current.id === s.id;
      return `<button class="radio-item${on ? ' is-on' : ''}" data-i="${i}" type="button">
        <span class="radio-item-play">${on ? '🔊' : '▶'}</span>
        <span class="radio-item-main"><b>${this.esc(s.name)}</b><small>${this.esc(meta)}</small></span>
      </button>`;
    }).join('');
    // 搜索过滤后 data-i 是过滤后列表的下标，所以这里用 list[i] 绑定
    box.querySelectorAll('.radio-item').forEach((el) => {
      el.addEventListener('click', () => {
        const s = list[Number(el.dataset.i)];
        if (s) this.playFromList(s);
      });
    });
  }

  setHint(text, bad) {
    const h = this.$('radio-hint');
    if (!h) return;
    h.textContent = text || '';
    h.classList.toggle('is-bad', Boolean(bad));
  }
}
