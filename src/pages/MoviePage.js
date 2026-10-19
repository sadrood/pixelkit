/**
 * MoviePage - 影视发现
 * 数据：本站后端 /api/media/*（TVmaze 开放 API；电影需要 TMDB_API_KEY），海报经服务器中转。
 * 只做浏览与发现，不提供播放源。
 */
export class MoviePage {
  constructor(toast) {
    this.toast = toast || null;
    this.inited = false;
    this.tab = 'tv';
    this.page = 0;
    this.genre = '';
    this.q = '';
    this.items = [];
    this.hasMore = false;
    this.loading = false;
  }

  $(id) { return document.getElementById(id); }

  init() {
    if (this.inited) return;
    this.inited = true;
    this.$('movie-tab-tv')?.addEventListener('click', () => this.switchTab('tv'));
    this.$('movie-tab-movie')?.addEventListener('click', () => this.switchTab('movie'));
    const search = this.$('movie-search');
    search?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.q = search.value.trim(); this.page = 0; this.load(true); }
    });
    this.$('movie-genre')?.addEventListener('change', (e) => { this.genre = e.target.value; this.page = 0; this.load(true); });
    this.$('movie-more')?.addEventListener('click', () => this.load(false));
    this.$('movie-detail-close')?.addEventListener('click', () => this.closeDetail());
    this.$('movie-detail')?.addEventListener('click', (e) => { if (e.target === this.$('movie-detail')) this.closeDetail(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeDetail(); });
    this.loadGenres();
    this.load(true);
  }

  switchTab(tab) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.page = 0;
    this.items = [];
    this.$('movie-tab-tv')?.classList.toggle('active', tab === 'tv');
    this.$('movie-tab-movie')?.classList.toggle('active', tab === 'movie');
    this.load(true);
  }

  async loadGenres() {
    try {
      const r = await fetch('/api/media/genres');
      const d = await r.json();
      const sel = this.$('movie-genre');
      if (sel && d.success) {
        sel.innerHTML = '<option value="">全部类型</option>' + (d.genres || []).map((g) => `<option value="${this.esc(g)}">${this.esc(g)}</option>`).join('');
      }
      this._hasMovies = Boolean(d?.hasMovies);
    } catch { /* ignore */ }
  }

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  setHint(text, bad) {
    const h = this.$('movie-hint');
    if (!h) return;
    h.textContent = text || '';
    h.classList.toggle('is-bad', Boolean(bad));
  }

  async load(reset) {
    if (this.loading) return;
    this.loading = true;
    const grid = this.$('movie-grid');
    const more = this.$('movie-more');
    if (reset && grid) grid.innerHTML = '<p class="movie-empty">正在加载…</p>';
    if (more) more.hidden = true;
    try {
      const isMovie = this.tab === 'movie';
      const q = new URLSearchParams();
      if (isMovie) {
        q.set('page', String(this.page + 1));
        if (this.q) q.set('q', this.q);
      } else {
        q.set('page', String(this.page));
        if (this.q) q.set('q', this.q);
        if (this.genre) q.set('genre', this.genre);
      }
      const r = await fetch('/api/media/' + (isMovie ? 'movies' : 'shows') + '?' + q.toString());
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '加载失败');
      const list = isMovie ? d.movies : d.shows;
      this.items = reset ? list : this.items.concat(list);
      this.hasMore = Boolean(d.hasMore);
      this.render();
      this.setHint(`共 ${this.items.length} 部${isMovie ? '电影' : '剧集'}${this.q ? '（搜索「' + this.q + '」）' : ''}`);
      if (more) more.hidden = !this.hasMore;
    } catch (e) {
      if (grid && reset) grid.innerHTML = `<p class="movie-empty">${this.esc(e.message)}</p>`;
      this.setHint(e.message, true);
    } finally { this.loading = false; }
  }

  render() {
    const grid = this.$('movie-grid');
    if (!grid) return;
    if (!this.items.length) { grid.innerHTML = '<p class="movie-empty">没有找到结果，换个关键词或类型试试。</p>'; return; }
    grid.innerHTML = this.items.map((it, i) => {
      const img = it.image ? `/api/media/img?u=${encodeURIComponent(it.image)}` : '';
      const rating = it.rating ? `<span class="movie-rating">★ ${it.rating}</span>` : '';
      const meta = [it.year, it.network].filter(Boolean).join(' · ');
      return `<button class="movie-card" data-i="${i}" type="button">
        <span class="movie-poster">${img ? `<img src="${this.esc(img)}" alt="${this.esc(it.name)}" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="movie-poster-empty">无海报</span>'}${rating}</span>
        <span class="movie-title">${this.esc(it.name)}</span>
        <span class="movie-meta">${this.esc(meta)}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.movie-card').forEach((b) => {
      b.addEventListener('click', () => {
        const it = this.items[Number(b.dataset.i)];
        if (it) this.openDetail(it);
      });
    });
  }

  openDetail(it) {
    const box = this.$('movie-detail');
    if (!box) return;
    const img = this.$('movie-detail-img');
    if (img) {
      img.src = it.image ? `/api/media/img?u=${encodeURIComponent(it.image)}` : '';
      img.alt = it.name;
      img.style.display = it.image ? '' : 'none';
    }
    const name = this.$('movie-detail-name'); if (name) name.textContent = it.name;
    const meta = this.$('movie-detail-meta');
    if (meta) meta.textContent = [it.year, it.network, it.status, it.runtime ? it.runtime + ' 分钟/集' : '', it.rating ? '★ ' + it.rating : ''].filter(Boolean).join(' · ') || '—';
    const sum = this.$('movie-detail-summary'); if (sum) sum.textContent = it.summary || '暂无简介';
    const link = this.$('movie-detail-link');
    if (link) {
      if (it.url) { link.href = it.url; link.style.display = ''; } else { link.style.display = 'none'; }
    }
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('show'));
  }

  closeDetail() {
    const box = this.$('movie-detail');
    if (!box || box.hidden) return;
    box.classList.remove('show');
    setTimeout(() => { box.hidden = true; }, 180);
  }
}
