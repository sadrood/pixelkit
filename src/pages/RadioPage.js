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

    // 键盘：← → 换台，空格播放/暂停（仅本页激活时）
    document.addEventListener('keydown', (e) => {
      const page = this.$('page-radio');
      if (!page || !page.classList.contains('active')) return;
      const tag = e.target && e.target.tagName ? e.target.tagName : '';
      if (/input|select|textarea/i.test(tag)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
    });

    try { window.__pkRadio = this; } catch { /* 调试钩子 */ }

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
    try {
      await this.loadCountryNames();
      // 优先读构建期数据集（scripts/build-stations.mjs 产出，列式、gzip ~82KB）
      let stations = null;
      try {
        const d = await fetch('/data/stations.json', { cache: 'force-cache' }).then((r) => r.json());
        if (d && Array.isArray(d.name) && d.name.length) {
          const n = d.name.length;
          stations = new Array(n);
          for (let i = 0; i < n; i++) {
            stations[i] = {
              id: 'ds' + i, name: d.name[i], url: d.url[i], cc: d.cc[i],
              country: this.ccNames[d.cc[i]] || d.cc[i],
              tags: String(d.tag[i] || '').split(',').filter(Boolean),
              lat: d.lat[i], lon: d.lng[i], bitrate: d.br[i] || 0, codec: '',
            };
          }
          this._datasetInfo = { builtAt: d.builtAt, n };
        }
      } catch { /* 数据集缺失时退回接口 */ }
      if (!stations) {
        const r = await fetch('/api/radio/geo');
        const d = await r.json();
        if (!d.success || !d.stations || !d.stations.length) throw new Error(d.error || '全球电台数据不可用');
        stations = d.stations;
      }
      // 按经度排序：滑杆从左到右就像绕地球飞一圈
      this.geoStations = stations.slice().sort((a, b) => (a.lon - b.lon) || (a.lat - b.lat));
      this._globeStations = this.geoStations;   // 调试/测试用别名
      const { createRadioGlobe } = await import('./RadioGlobe.js');
      this._globe = await createRadioGlobe(el, this.geoStations, {
        tooltipEl: this.$('radio-globe-tip'),
        onPick: (s) => this.onGlobePick(s),
      });
      const slider = this.$('radio-slider');
      if (slider) { slider.max = String(Math.max(0, this.geoStations.length - 1)); slider.disabled = false; }
      if (loading) loading.style.display = 'none';
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
    if (country) country.textContent = [s.country, s.cc].filter(Boolean).join(' · ') || '未知地区';
    if (name) name.textContent = s.name || '未命名电台';
    if (sub) sub.textContent = [s.codec, s.bitrate ? s.bitrate + 'kbps' : '', (s.tags || []).slice(0, 2).join(' / ')].filter(Boolean).join(' · ') || '松手即播放';
    const song = this.$('radio-now-song');
    if (song && this.current !== s) { song.textContent = ''; song.style.display = 'none'; }
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
          song.style.display = title ? '' : 'none';
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
