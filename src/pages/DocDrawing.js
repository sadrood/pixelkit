/**
 * DocDrawing - 文档页面内的涂鸦层
 * canvas 挂在分页容器的父节点上（兄弟关系），避免被 docx-editor 重绘页面时 innerHTML 清空。
 * 位置用归一化坐标 [0,1] 存储，随文档缩放/滚动自动对齐。
 */
import * as Y from 'yjs';

const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#6b7280'];
const SIZES = [2, 4, 8, 16];

export class DocDrawing {
  constructor({ root, ydoc, toast, onDeactivate }) {
    this.root = root;
    this.ydoc = ydoc;
    this.toast = toast;
    this.onDeactivate = onDeactivate;
    this.strokes = ydoc.getArray('draw-strokes');
    this.active = false;
    this.tool = { color: '#ef4444', width: 4 };
    this.current = null;
    this.raf = false;
    this._destroyed = false;
    this._cleanups = [];
    this._mountTimer = null;
    this._pages = null;
    this._host = null;
    this._canvas = null;
    this._ctx = null;
    this._toolbar = null;
  }

  mount() {
    this._tryMount();
  }

  _tryMount() {
    if (this._destroyed) return;
    const pages = this.root.querySelector('.paged-editor__pages');
    if (!pages || !pages.parentElement) {
      this._mountTimer = setTimeout(() => this._tryMount(), 250);
      return;
    }
    // 已挂载且 canvas 仍在 DOM 里 → 仅同步位置
    if (this._pages === pages && this._canvas && this._canvas.isConnected && this._canvas.parentNode === pages.parentElement) {
      this._syncPosition();
      return;
    }
    this._pages = pages;
    this._host = pages.parentElement;
    this._setupCanvas();
    this._setupToolbar();
    this._syncPosition();
    this._render();
  }

  _setupCanvas() {
    const host = this._host;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const canvas = document.createElement('canvas');
    canvas.className = 'doc-draw-canvas';
    canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:20;touch-action:none;';
    host.appendChild(canvas);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');

    this._bindPointer(canvas);

    const ro = new ResizeObserver(() => this._syncPosition());
    ro.observe(this._pages);
    ro.observe(host);
    this._cleanups.push(() => ro.disconnect());

    const onStrokes = () => this._scheduleRender();
    this.strokes.observe(onStrokes);
    this._cleanups.push(() => this.strokes.unobserve(onStrokes));
  }

  _setupToolbar() {
    if (this._toolbar) return;
    const bar = document.createElement('div');
    bar.className = 'doc-draw-toolbar';
    bar.style.display = 'none';
    const colors = PALETTE.map((c) =>
      `<button class="doc-draw-color${this.tool.color === c ? ' active' : ''}" data-color="${c}" style="background:${c};" title="颜色"></button>`
    ).join('');
    const sizes = SIZES.map((w) =>
      `<button class="doc-draw-size${this.tool.width === w ? ' active' : ''}" data-width="${w}" style="width:${w + 6}px;height:${w + 6}px;" title="粗细"></button>`
    ).join('');
    bar.innerHTML = `
      <div class="doc-draw-colors">${colors}</div>
      <div class="doc-draw-sizes">${sizes}</div>
      <button class="doc-draw-btn" data-act="eraser" title="橡皮擦">🧽</button>
      <button class="doc-draw-btn" data-act="clear" title="清空涂鸦">🗑️</button>
      <button class="doc-draw-btn doc-draw-done" data-act="done" title="退出画笔">完成</button>`;
    this.root.appendChild(bar);
    this._toolbar = bar;

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'eraser') { this.tool = { color: 'eraser', width: 24 }; this._refreshToolbar(); }
      else if (act === 'clear') {
        this.ydoc.transact(() => { this.strokes.delete(0, this.strokes.length); });
        this._scheduleRender();
        this.toast?.show('涂鸦已清空', 'success');
      }
      else if (act === 'done') { this.onDeactivate?.(); }
      else if (btn.dataset.color) { this.tool = { color: btn.dataset.color, width: this.tool.width === 24 ? 4 : this.tool.width }; this._refreshToolbar(); }
      else if (btn.dataset.width) { this.tool = { color: this.tool.color === 'eraser' ? '#ef4444' : this.tool.color, width: parseInt(btn.dataset.width) }; this._refreshToolbar(); }
    });
  }

  _refreshToolbar() {
    const bar = this._toolbar;
    if (!bar) return;
    bar.querySelectorAll('.doc-draw-color').forEach((b) => b.classList.toggle('active', b.dataset.color === this.tool.color));
    bar.querySelectorAll('.doc-draw-size').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.width) === this.tool.width));
    bar.querySelectorAll('.doc-draw-btn[data-act="eraser"]').forEach((b) => b.classList.toggle('active', this.tool.color === 'eraser'));
  }

  _bindPointer(canvas) {
    const toPoint = (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { nx: 0, ny: 0 };
      return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      const p = toPoint(e);
      this.current = { id: Math.random().toString(36).slice(2), color: this.tool.color, width: this.tool.width, points: [p] };
      this._scheduleRender();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !this.current) return;
      const p = toPoint(e);
      const last = this.current.points[this.current.points.length - 1];
      if (Math.abs(p.nx - last.nx) + Math.abs(p.ny - last.ny) > 0.002) {
        this.current.points.push(p);
        this._scheduleRender();
      }
    });
    const end = () => {
      if (!this.current) return;
      const s = this.current;
      this.current = null;
      if (s.points.length > 0) this.strokes.push([s]);
      this._scheduleRender();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // 让 canvas 与分页容器对齐：绝对定位在分页容器父节点内，覆盖分页区域
  _syncPosition() {
    const pages = this._pages;
    const canvas = this._canvas;
    if (!pages || !canvas) return;
    if (!canvas.isConnected) { this._canvas = null; this._ctx = null; this._tryMount(); return; }
    const w = Math.max(1, pages.scrollWidth);
    const h = Math.max(1, pages.scrollHeight);
    const left = pages.offsetLeft || 0;
    const top = pages.offsetTop || 0;
    canvas.style.left = left + 'px';
    canvas.style.top = top + 'px';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      this._render();
    }
  }

  _scheduleRender() {
    if (this.raf) return;
    this.raf = true;
    requestAnimationFrame(() => { this.raf = false; this._render(); });
  }

  _render() {
    const ctx = this._ctx;
    const canvas = this._canvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const W = canvas.width, H = canvas.height;
    const draw = (s) => {
      if (!s.points || s.points.length === 0) return;
      if (s.color === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color;
      }
      ctx.lineWidth = Math.max(1, s.width || 4);
      ctx.beginPath();
      ctx.moveTo(s.points[0].nx * W, s.points[0].ny * H);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].nx * W, s.points[i].ny * H);
      if (s.points.length === 1) ctx.lineTo(s.points[0].nx * W + 0.5, s.points[0].ny * H + 0.5);
      ctx.stroke();
    };
    this.strokes.forEach(draw);
    if (this.current) draw(this.current);
    ctx.globalCompositeOperation = 'source-over';
  }

  setActive(active) {
    this.active = active;
    if (this._canvas) {
      this._canvas.style.pointerEvents = active ? 'auto' : 'none';
      this._canvas.style.cursor = active ? 'crosshair' : 'default';
    }
    if (this._toolbar) this._toolbar.style.display = active ? 'flex' : 'none';
    if (active) this.toast?.show('画笔已开启：直接在文档上涂画，点「完成」退出', 'success');
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._mountTimer);
    this._cleanups.forEach((fn) => { try { fn(); } catch {} });
    this._cleanups = [];
    if (this._canvas) { this._canvas.remove(); this._canvas = null; this._ctx = null; }
    if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; }
    this._pages = null;
    this._host = null;
  }
}
