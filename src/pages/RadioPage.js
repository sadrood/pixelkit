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

    // 浏览面板
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
      const r = await fetch('/api/radio/geo');
      const d = await r.json();
      if (!d.success || !d.stations || !d.stations.length) throw new Error(d.error || '全球电台数据不可用');
      // 按经度排序：滑杆从左到右就像绕地球飞一圈
      this.geoStations = d.stations.slice().sort((a, b) => (a.lon - b.lon) || (a.lat - b.lat));
      const { createRadioGlobe } = await import('./RadioGlobe.js');
      this._globe = await createRadioGlobe(el, this.geoStations, {
        tooltipEl: this.$('radio-globe-tip'),
        onPick: (s) => this.onGlobePick(s),
      });
      const slider = this.$('radio-slider');
      if (slider) { slider.max = String(Math.max(0, this.geoStations.length - 1)); slider.disabled = false; }
      if (loading) loading.style.display = 'none';
      this.setIndex(0, false);
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
    this.setPlayingUI(true);
    this.setNowPlaying(s);
    this.setHint('正在连接…');
    this.audio.src = '/api/radio/stream?u=' + encodeURIComponent(s.url);
    this.armStall();
    try { await this.audio.play(); } catch { /* 需要用户手势时忽略 */ }
    this.setHint('正在播放：' + s.name);
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
    if (this.autoNextCount >= 3) { this.setHint('这个台打不开，换一个试试', true); return; }
    this.autoNextCount += 1;
    this.setHint('这个台连不上，自动换下一个…', true);
    setTimeout(() => {
      if (this.index >= 0 && this.geoStations.length) this.setIndex(this.index + 1, true);
      else this.step(1);
    }, 700);
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
