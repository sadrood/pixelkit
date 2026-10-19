/**
 * RadioPage - 世界电台
 * 数据来自本站后端 /api/radio/*（服务器代理开放电台目录），音频经 /api/radio/stream 中转，
 * 因此不依赖用户网络能否直连某个电台。
 */
export class RadioPage {
  constructor(toast) {
    this.toast = toast || null;
    this.inited = false;
    this.stations = [];
    this.current = null;
    this.audio = null;
    this.autoNextCount = 0;
    this._loadingFilters = false;
  }

  $(id) { return document.getElementById(id); }

  init() {
    if (this.inited) return;
    this.inited = true;
    this.audio = this.$('radio-audio');
    const playBtn = this.$('radio-play');
    playBtn?.addEventListener('click', () => this.togglePlay());
    this.$('radio-next')?.addEventListener('click', () => this.nextStation());
    this.$('radio-refresh')?.addEventListener('click', () => this.loadStations());
    this.$('radio-country')?.addEventListener('change', () => { this.country = this.$('radio-country').value; this.loadStations(); });
    this.$('radio-tag')?.addEventListener('change', () => { this.tag = this.$('radio-tag').value; this.loadStations(); });
    const vol = this.$('radio-volume');
    if (vol) {
      // localStorage 没值时 getItem 返回 null，Number(null)===0 —— 会直接把音量静音。
      // 先判 null 再用默认 80。
      const rawVol = localStorage.getItem('pk_radio_volume');
      const saved = rawVol === null ? NaN : Number(rawVol);
      vol.value = String(Number.isFinite(saved) && saved >= 0 ? saved : 80);
      this.applyVolume(vol.value);
      vol.addEventListener('input', () => { this.applyVolume(vol.value); try { localStorage.setItem('pk_radio_volume', vol.value); } catch { /* ignore */ } });
    }
    // 音频事件
    this.audio?.addEventListener('playing', () => { this.setPlayingUI(true); this.clearStall(); });
    this.audio?.addEventListener('timeupdate', () => { if (this.audio && this.audio.currentTime > 0.2) this.clearStall(); });
    this.audio?.addEventListener('pause', () => this.setPlayingUI(false));
    this.audio?.addEventListener('error', () => this.onAudioError());
    this.audio?.addEventListener('stalled', () => { /* 等看门狗处理 */ });
    // 视图切换：地球 / 列表（默认地球，像 RoamDial 那样先看世界）
    this.view = 'globe';
    this.$('radio-view-globe')?.addEventListener('click', () => this.setView('globe'));
    this.$('radio-view-list')?.addEventListener('click', () => this.setView('list'));
    try { window.__pkRadio = this; } catch { /* 调试钩子，无副作用 */ }
    // 首次进入：拉筛选器与列表，并加载地球
    this.loadFilters();
    this.loadStations();
    this.setView('globe');
    this.loadGlobe();
  }

  /** 播放卡住看门狗：直播流 9 秒还没有任何进度，就当这个台不可用，自动换台 */
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

  /** 切换「地球 / 列表」视图 */
  setView(v) {
    this.view = v;
    const globeWrap = this.$('radio-globe-wrap');
    const listView = this.$('radio-list-view');
    const hint = this.$('radio-view-hint');
    if (globeWrap) globeWrap.style.display = v === 'globe' ? '' : 'none';
    if (listView) listView.style.display = v === 'list' ? '' : 'none';
    this.$('radio-view-globe')?.classList.toggle('active', v === 'globe');
    this.$('radio-view-list')?.classList.toggle('active', v === 'list');
    if (hint) hint.textContent = v === 'globe' ? '拖动旋转 · 滚轮缩放 · 点光点试听' : '按国家 / 流派筛选';
  }

  /** 加载 3D 电台地球（数据来自静态数据集，秒开） */
  async loadGlobe() {
    const el = this.$('radio-globe');
    const loading = this.$('radio-globe-loading');
    if (!el || this._globeLoading || this._globe) return;
    this._globeLoading = true;
    try {
      const r = await fetch('/api/radio/geo');
      const d = await r.json();
      if (!d.success || !d.stations || !d.stations.length) throw new Error(d.error || '全球电台数据不可用');
      const { createRadioGlobe } = await import('./RadioGlobe.js');
      this._globe = await createRadioGlobe(el, d.stations, {
        tooltipEl: this.$('radio-globe-tip'),
        onPick: (s) => this.playStation(s),
      });
      this._globeStations = d.stations;
      if (loading) loading.style.display = 'none';
      this.setHint(`地球上有 ${d.stations.length} 个电台，点光点试听`);
    } catch (e) {
      if (loading) loading.textContent = '地球加载失败：' + (e.message || e);
      this.setView('list');
      this.setHint('地球加载失败，已切到列表', true);
    } finally { this._globeLoading = false; }
  }
  applyVolume(v) {
    if (!this.audio) return;
    this.audio.volume = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  }

  setPlayingUI(on) {
    const btn = this.$('radio-play');
    if (btn) btn.textContent = on ? '⏸ 暂停' : '▶ 播放';
  }

  setHint(text, bad) {
    const h = this.$('radio-hint');
    if (!h) return;
    h.textContent = text || '';
    h.classList.toggle('is-bad', Boolean(bad));
  }

  async loadFilters() {
    if (this._loadingFilters) return;
    this._loadingFilters = true;
    try {
      const [cRes, tRes] = await Promise.all([
        fetch('/api/radio/countries').then((r) => r.json()).catch(() => null),
        fetch('/api/radio/tags').then((r) => r.json()).catch(() => null),
      ]);
      const cSel = this.$('radio-country');
      if (cSel && cRes?.success) {
        const keep = cSel.value;
        cSel.innerHTML = '<option value="">全部国家</option>' + (cRes.countries || [])
          .slice(0, 120)
          .map((c) => `<option value="${this.esc(c.name)}">${this.esc(c.name)}（${c.stations}）</option>`).join('');
        cSel.value = keep;
      }
      const tSel = this.$('radio-tag');
      if (tSel && tRes?.success) {
        const keep = tSel.value;
        tSel.innerHTML = '<option value="">全部流派</option>' + (tRes.tags || [])
          .slice(0, 60)
          .map((t) => `<option value="${this.esc(t.name)}">${this.esc(t.name)}（${t.stations}）</option>`).join('');
        tSel.value = keep;
      }
    } finally { this._loadingFilters = false; }
  }

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async loadStations(retry) {
    const box = this.$('radio-list');
    if (!box) return;
    box.innerHTML = '<p class="radio-empty">正在取电台目录…</p>';
    this.setHint('');
    try {
      const q = new URLSearchParams({ limit: '40' });
      if (this.country) q.set('country', this.country);
      if (this.tag) q.set('tag', this.tag);
      const r = await fetch('/api/radio/stations?' + q.toString());
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '加载失败');
      this.stations = d.stations || [];
      this.renderStations();
      this.setHint(`共 ${this.stations.length} 个电台`);
    } catch (e) {
      // 目录源偶发不可达：自动重试一次，再失败才提示（页面上还有「🔄 刷新」可手动重试）
      if (!retry) {
        this.setHint('目录源连接中，正在重试…');
        setTimeout(() => this.loadStations(true), 1500);
        return;
      }
      box.innerHTML = `<p class="radio-empty">${this.esc(e.message)}</p><p class="radio-empty">点上面的「🔄 刷新」再试一次</p>`;
      this.setHint(e.message, true);
    }
  }

  renderStations() {
    const box = this.$('radio-list');
    if (!box) return;
    if (!this.stations.length) { box.innerHTML = '<p class="radio-empty">这个筛选下没有电台，换一个国家或流派试试。</p>'; return; }
    box.innerHTML = this.stations.map((s, i) => {
      const meta = [s.country, s.codec, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · ');
      const tags = (s.tags || []).slice(0, 3).join(' / ');
      return `<button class="radio-item${this.current && this.current.id === s.id ? ' is-on' : ''}" data-i="${i}" type="button">
        <span class="radio-item-play">${this.current && this.current.id === s.id ? '🔊' : '▶'}</span>
        <span class="radio-item-main"><b>${this.esc(s.name)}</b><small>${this.esc(meta)}${tags ? ' · ' + this.esc(tags) : ''}</small></span>
      </button>`;
    }).join('');
    box.querySelectorAll('.radio-item').forEach((b) => {
      b.addEventListener('click', () => {
        const s = this.stations[Number(b.dataset.i)];
        if (s) this.playStation(s);
      });
    });
  }

  async playStation(s) {
    if (!s || !s.url) { this.toast?.show?.('这个电台没有可用音频地址', 'error'); return; }
    this.current = s;
    this.autoNextCount = 0;
    const src = '/api/radio/stream?u=' + encodeURIComponent(s.url);
    this.audio.src = src;
    this.armStall();
    try {
      await this.audio.play();
      this.setPlayingUI(true);
    } catch { /* 浏览器可能要求用户手势，点击本身即手势 */ }
    const name = this.$('radio-name');
    const sub = this.$('radio-sub');
    if (name) name.textContent = s.name;
    if (sub) sub.textContent = [s.country, s.state, s.codec, s.bitrate ? s.bitrate + 'kbps' : ''].filter(Boolean).join(' · ') || '正在播放';
    this.renderStations();
    this.setHint('正在播放：' + s.name);
  }

  togglePlay() {
    if (!this.audio) return;
    if (!this.current) {
      // 还没选台：直接随机一站
      this.nextStation();
      return;
    }
    if (this.audio.paused) { this.audio.play().catch(() => {}); }
    else { this.audio.pause(); }
  }

  async nextStation() {
    const q = new URLSearchParams();
    if (this.country) q.set('country', this.country);
    if (this.tag) q.set('tag', this.tag);
    this.setHint('正在换台…');
    try {
      const r = await fetch('/api/radio/random?' + q.toString());
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '换台失败');
      this.playStation(d.station);
    } catch (e) {
      // 兜底：从已加载列表里挑下一个
      if (this.stations.length) {
        const idx = this.current ? this.stations.findIndex((s) => s.id === this.current.id) : -1;
        this.playStation(this.stations[(idx + 1) % this.stations.length]);
      } else { this.setHint(e.message, true); this.toast?.show?.(e.message, 'error'); }
    }
  }

  onAudioError() {
    this.clearStall();
    this.setPlayingUI(false);
    if (!this.current) return;
    // 连续失败 3 次就停下，避免无限换台
    if (this.autoNextCount >= 3) { this.setHint('这个电台的流打不开，换一个吧', true); return; }
    this.autoNextCount += 1;
    this.setHint('这个台连不上，自动换一个…', true);
    setTimeout(() => this.nextStation(), 800);
  }
}
