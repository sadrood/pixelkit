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
    this.updateStatus('就绪');

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
    // 视图切换：地球 / 流派星云 / 收藏
    this.view = 'globe';
    this.genreFilter = -1;
    document.querySelectorAll('#page-radio .radio-view').forEach((b) => {
      b.addEventListener('click', () => this.setView(b.dataset.view));
    });
    // 进入：确保正在播放当前台（或从当前开始播）
    this.$('radio-enter')?.addEventListener('click', () => {
      if (this.current) { this.audio.play().catch(() => {}); this.updateStatus('播放中'); }
      else this.step(1);
    });

    // 浏览面板
    this.$('radio-auto')?.addEventListener('click', () => this.toggleAutoTour());
    this.$('radio-sheet-toggle')?.addEventListener('click', () => this.toggleSheet());
    this.$('radio-sheet-close')?.addEventListener('click', () => this.toggleSheet(false));
    this.$('radio-search')?.addEventListener('input', () => this.renderList());
    this.$('radio-country')?.addEventListener('change', () => this.loadListStations());
    this.$('radio-tag')?.addEventListener('change', () => this.loadListStations());

    // 音频事件
    this.audio?.addEventListener('playing', () => { this.setPlayingUI(true); this.clearStall(); });
    this.audio?.addEventListener('timeupdate', () => { if (this.audio && this.audio.currentTime > 0.2) this.clearStall(); });
    this.audio?.addEventListener('pause', () => this.setPlayingUI(false));
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
    this.bootShow('正在连接星图…');
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
      this.bootShow(`正在绘制星图（${this.geoStations.length.toLocaleString('zh-CN')} 个电台）…`);
      const { createRadioGlobe } = await import('./RadioGlobe.js');
      try {
        this._globe = await createRadioGlobe(el, this.geoStations, {
          tooltipEl: this.$('radio-globe-tip'),
          onPick: (s) => this.onGlobePick(s),
          onHover: (s, x, y) => this.onHover(s, x, y),
        });
      } catch (err) {
        // 3D 不可用（老显卡/WebGL 被禁）：退回 2D 星云视图，保证画面能出来
        console.warn('3D 星图初始化失败，退回星云视图：', err);
        this.bootHide();
        this.renderNebula();
        this.setView('nebula');
        return;
      }
      // 拖动停稳后：准星对准的最近电台自动收听（RoamDial 的核心交互）
      try { this._globe.onSettle?.(() => this.autoTuneFromCrosshair()); } catch { /* ignore */ }
      this.loadFullStations();
      this.buildChips();
      this.startLabels();
      this.updateFavCount();
      const slider = this.$('radio-slider');
      if (slider) { slider.max = String(Math.max(0, this.geoStations.length - 1)); slider.disabled = false; }
      if (loading) loading.style.display = 'none';
      this.bootHide();
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
    const n = this.geoStations.length;
    if (!n) return;
    const idx = ((i % n) + n) % n;
    this.index = idx;
    const s = this.geoStations[idx];
    this.setNowPlaying(s);
    try { this._globe?.setSelected(s); this._globe?.focus?.(s); } catch { /* ignore */ }
    this.syncSlider();
    this.setHint(`第 ${idx + 1} / ${n} 个 · ${[s.country, s.codec, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · ')}`);
    if (play) this.playStation(s);
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
    if (country) country.textContent = [flag, s.country || s.cc].filter(Boolean).join(' ') || '未知地区';
    if (name) name.textContent = s.name || '未命名电台';
    if (sub) {
      const genre = this.genres && s.g != null ? (this.genres[s.g] || '') : '';
      const tags = (s.tags || []).slice(0, 3).join(',').toUpperCase();
      const lang = this.langs && s.l != null ? (this.langs[s.l] || '') : '';
      sub.textContent = [genre, tags, lang, s.bitrate ? s.bitrate + ' KBPS' : ''].filter(Boolean).join(' · ');
    }
    const lock = this.$('radio-lock-meta');
    if (lock) {
      const genre = this.genres && s.g != null ? (this.genres[s.g] || '') : '';
      lock.textContent = ['已锁定', genre, s.bitrate ? s.bitrate + ' KBPS' : ''].filter(Boolean).join(' · ');
    }
    const song = this.$('radio-now-song');
    if (song && this.current !== s) { song.textContent = ''; song.style.display = 'none'; }
    this.buildServices(s);
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
    this.buildChips();
    this.setHint(g < 0 ? `全部 ${n} 个电台` : `${this.genres[g] || ''} · ${n} 个电台`);
    const first = this._globe && this._globe.getFiltered ? this._globe.getFiltered()[0] : null;
    if (first) {
      const i = this.geoStations.indexOf(first);
      if (i >= 0) { this.index = i; this.syncSlider(); this.setNowPlaying(first); }
    }
  }

  /** 切换视图：地球 / 流派星云 / 收藏 */
  setView(v) {
    this.view = v;
    document.querySelectorAll('#page-radio .radio-view').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'fav') { this.showFavSheet(); this.setHint('收藏 · 点一个台开始收听'); return; }
    this.toggleSheet(false);
    const globeEl = this.$('radio-globe');
    const neb = this.$('radio-nebula');
    const labels = this.$('radio-labels');
    if (v === 'nebula') {
      if (this._globe && this._globe.setLayout) {
        // 3D 星云：地球点云原地变形成 11 个星团（0.95 秒过渡）
        if (neb) neb.hidden = true;
        if (globeEl) globeEl.style.display = '';
        this._globe.setLayout('nebula');
        this.setHint('流派星云 · 拖动旋转，准星停稳自动收听；G 回地球');
      } else {
        // WebGL 不可用：退回 2D 光斑星云
        if (globeEl) globeEl.style.display = 'none';
        if (neb) neb.hidden = false;
        if (labels) labels.innerHTML = '';
        this.renderNebula();
        this.setHint('流派星云 · 点任意光斑收听，或按 G 回到地球');
      }
      return;
    }
    if (neb) neb.hidden = true;
    if (globeEl) globeEl.style.display = '';
    if (this._globe) this._globe.setLayout('globe');
    this.setHint('拖动旋转 · 滚轮远近 · 准星停稳自动收听');
  }

  /** 收藏视图：把收藏的台列进抽屉 */
  showFavSheet() {
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
    if (!box) return;
    this._labelTimer = setInterval(() => {
      if (!this._globe || this.view === 'fav') { box.innerHTML = ''; return; }
      if (this.view === 'nebula') {
        let clusters = [];
        try { clusters = this._globe.getNebulaLabels ? this._globe.getNebulaLabels() : []; } catch { clusters = []; }
        box.innerHTML = clusters.map((c, k) => '<span class="nebula-cluster-label" style="left:' + Math.round(c.x) + 'px;top:' + Math.round(c.y + (k % 2 === 0 ? -46 : 30)) + 'px"><b>' + this.esc((this.genres && this.genres[c.i]) || '') + '</b><span>' + c.count.toLocaleString('zh-CN') + ' 个电台</span></span>').join('');
        return;
      }
      let labels = [];
      try { labels = this._globe.getLabels(80) || []; } catch { labels = []; }
      const cur = this.current ? this.current.name : '';
      const w = box.clientWidth || 1, h = box.clientHeight || 1;
      const cx = w / 2, cy = h / 2;
      // 按离准星由近到远排序，再用屏幕网格分桶：每个格子最多一个标签，保证均匀散开
      const sorted = labels
        .map((l) => ({ ...l, d: Math.hypot(l.x - cx, l.y - cy) }))
        .filter((l) => l.d >= 72)
        .sort((a, b) => a.d - b.d);
      // 准星右侧是「已锁定 · 分类 · KBPS」文字，这块区域不放标签
      const lockRect = { x0: cx + 70, x1: cx + 330, y0: cy - 52, y1: cy + 26 };
      const cellW = Math.max(150, w / 7);
      const cellH = 104;
      const used = new Set();
      const out = [];
      for (const l of sorted) {
        if (l.x > lockRect.x0 && l.x < lockRect.x1 && l.y > lockRect.y0 && l.y < lockRect.y1) continue;
        const key = Math.floor(l.x / cellW) + ',' + Math.floor(l.y / cellH);
        if (used.has(key)) continue;
        used.add(key);
        out.push(`<span class="radio-label${l.name === cur ? ' hot' : ''}" style="left:${Math.round(l.x)}px;top:${Math.round(l.y - 14)}px">${this.esc(l.name)}</span>`);
        if (out.length >= 8) break;
      }
      box.innerHTML = out.join('');
    }, 200);
  }

  /** 把构建期列式数据集转成电台对象数组 */
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
          lat: d.lat[i] / 100, lon: d.lng[i] / 100,
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
      if (curId) {
        const k = this.geoStations.findIndex((s) => s.id === curId);
        if (k >= 0) { this.index = k; this.current = this.geoStations[k]; this.syncSlider(); }
      }
      this.buildChips();
      if (this.view === 'nebula') this.renderNebula();
      const slider = this.$('radio-slider');
      if (slider) slider.max = String(Math.max(0, this.geoStations.length - 1));
      this.setHint('完整台库已载入 · ' + this.geoStations.length.toLocaleString('zh-CN') + ' 个电台');
      if (this.listStations && this.listStations.length < this.geoStations.length) this.renderList();
    } catch { this._fullLoaded = false; }
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
    const R = Math.min(w, h) * 0.36;
    const centers = [];
    for (let g = 0; g < nG; g++) {
      const th = g * 2.39996 - Math.PI / 2;
      const rr = R * Math.sqrt((g + 0.6) / nG);
      centers.push({ x: cx + Math.cos(th) * rr * 1.55, y: cy + Math.sin(th) * rr });
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
      const rr = Math.pow(((hsh >> 10) % 1024) / 1024, 0.7) * 52 + 3;
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
    if (!this._globe || !this.geoStations.length) return;
    const i = this._globe.pickCenter ? this._globe.pickCenter() : -1;
    if (i < 0) { this.setHint('准星没对准电台，再拖一点'); return; }
    if (i === this.index) { this.setHint('已锁定 · ' + this.geoStations[i].name); return; }
    this.setIndex(i, true);
    this.updateStatus('已锁定');
    this.setHint('准星锁定 · 自动收听');
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
      if (e.key === 'Escape') { list.hidden = true; q.blur(); }
      else if (e.key === 'Enter') { const first = list.querySelector('.radio-q-item'); if (first) first.click(); }
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
