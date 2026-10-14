/**
 * PixelKit - 文件中转站
 * 临时文件共享，免密 / 加密两种模式，24小时自动过期
 */
export class FileSharePage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
    this.mode = 'public'; // 'public' | 'protected'
    this.selectedFile = null;
    this.uploading = false;
    // 浏览器用户标识，与 AgentPage 一致
    this.userId = localStorage.getItem('pixelkit_user_id');
    if (!this.userId) {
      this.userId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pixelkit_user_id', this.userId);
    }
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    const root = document.getElementById('fileshare-root');
    if (!root) return;
    this._destroyed = false;
    root.innerHTML = this.render();
    this.bindEvents();
    this.loadFileList();
    // 每 30 秒自动刷新（仅在页面活跃时运行，见 _setupRefreshLifecycle）
    this._setupRefreshLifecycle();
  }

  // ==================== 生命周期：30 秒刷新定时器 ====================

  /**
   * main.js 里没有 destroy/dispose 钩子，页面切换只改了 #page-xxx 的 active class
   * （main.js 的 _lazyPage 也是靠 MutationObserver 监听这个 class 来懒加载）。
   * 所以这里用同一套机制：监听自身 page 元素的 class 变化 + visibilitychange，
   * 页面失活/标签页隐藏时停掉定时器，回来后自动重启。
   */
  _setupRefreshLifecycle() {
    const pageEl = this._pageEl();
    if (pageEl && typeof MutationObserver !== 'undefined') {
      this._activeObserver = new MutationObserver(() => this._syncRefreshTimer());
      this._activeObserver.observe(pageEl, { attributes: true, attributeFilter: ['class'] });
    }
    this._onVisibility = () => this._syncRefreshTimer();
    document.addEventListener('visibilitychange', this._onVisibility);
    this._syncRefreshTimer();
  }

  _pageEl() {
    return document.getElementById('page-fileshare');
  }

  /** 页面是否处于活跃状态（在文件中转站页 + 标签页可见） */
  _isActive() {
    if (this._destroyed) return false;
    if (document.visibilityState === 'hidden') return false;
    const el = this._pageEl();
    return !!el && el.classList.contains('active');
  }

  _syncRefreshTimer() {
    const shouldRun = this._isActive();
    if (shouldRun && !this._refreshTimer) {
      this._refreshTimer = setInterval(() => {
        // 兜底：非活跃时直接 return，不触发请求与渲染
        if (!this._isActive()) return;
        this.loadFileList();
      }, 30000);
    } else if (!shouldRun && this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /** 离开页面 / 需要销毁实例时调用（main.js 目前不调用，供后续接入） */
  destroy() {
    this._destroyed = true;
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._activeObserver) {
      this._activeObserver.disconnect();
      this._activeObserver = null;
    }
    if (this._onVisibility) {
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._onVisibility = null;
    }
  }

  dispose() {
    this.destroy();
  }

  // ==================== 渲染 ====================

  render() {
    return `
      <div class="fs-layout">
        <!-- 上传区 -->
        <div class="fs-upload-section">
          <div class="fs-upload-zone" id="fs-upload-zone">
            <div class="upload-zone-content">
              <div class="upload-zone-icon">📁</div>
              <p>拖拽文件到此处，或点击选择</p>
              <p class="upload-zone-hint">支持任意格式 · 单文件最大 100MB · 24小时后自动过期</p>
              <button class="btn btn-primary" id="fs-select-btn">选择文件</button>
              <input type="file" id="fs-file-input" hidden />
            </div>
          </div>

          <!-- 文件信息 -->
          <div class="fs-file-info" id="fs-file-info" style="display:none;">
            <span class="fs-file-icon" id="fs-file-icon">📄</span>
            <div class="fs-file-detail">
              <span class="fs-file-name" id="fs-file-name">-</span>
              <span class="fs-file-size" id="fs-file-size">-</span>
            </div>
            <button class="btn btn-sm" id="fs-clear-file">✕</button>
          </div>

          <!-- 模式切换 -->
          <div class="fs-mode-tabs" id="fs-mode-tabs" style="display:none;">
            <button class="fs-mode-tab active" data-mode="public">🔓 免密共享</button>
            <button class="fs-mode-tab" data-mode="protected">🔒 加密共享</button>
          </div>

          <!-- 密码输入 -->
          <div class="fs-password-field" id="fs-password-field" style="display:none;">
            <input type="text" id="fs-upload-password" placeholder="设置下载密码" maxlength="32" />
          </div>

          <!-- 上传按钮 -->
          <button class="btn btn-primary fs-upload-btn" id="fs-upload-btn" style="display:none;">
            🚀 上传文件
          </button>

          <!-- 进度条 -->
          <div class="st-progress" id="fs-progress" style="display:none;">
            <div class="st-progress-bar" id="fs-progress-bar"></div>
          </div>
        </div>

        <!-- 文件列表 -->
        <div class="fs-list-section">
          <div class="fs-list-header">
            <h3>📋 文件列表</h3>
            <button class="btn btn-sm" id="fs-refresh-btn">🔄 刷新</button>
          </div>
          <div class="fs-list-hint">文件将在 24 小时后自动删除</div>
          <div class="fs-table-wrap" id="fs-table-wrap">
            <div class="fs-empty" id="fs-empty">暂无文件，上传一个吧</div>
          </div>
        </div>
      </div>

      <!-- 密码弹窗（下载加密文件时） -->
      <div class="fs-dialog-overlay" id="fs-dialog-overlay" style="display:none;">
        <div class="fs-dialog" id="fs-dialog-box">
          <h4 id="fs-dialog-title">🔒 此文件需要密码</h4>
          <div id="fs-dialog-input-area">
            <input type="text" id="fs-download-password" placeholder="输入下载密码" maxlength="32" />
          </div>
          <div id="fs-dialog-link-area" style="display:none;">
            <p style="color:var(--success);margin-bottom:12px;">✅ 验证通过</p>
            <a id="fs-dialog-link" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;" target="_blank" download>⬇ 点击下载</a>
          </div>
          <div class="fs-dialog-actions" id="fs-dialog-actions">
            <button class="btn" id="fs-dialog-cancel">取消</button>
            <button class="btn btn-primary" id="fs-dialog-confirm">确认下载</button>
          </div>
          <div class="fs-dialog-error" id="fs-dialog-error" style="display:none;"></div>
        </div>
      </div>`;
  }

  // ==================== 事件绑定 ====================

  bindEvents() {
    // 上传区域点击
    document.getElementById('fs-upload-zone').addEventListener('click', () => {
      document.getElementById('fs-file-input').click();
    });
    document.getElementById('fs-select-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('fs-file-input').click();
    });

    // 拖拽上传
    const zone = document.getElementById('fs-upload-zone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) this.selectFile(e.dataTransfer.files[0]);
    });

    // 文件选择
    document.getElementById('fs-file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.selectFile(e.target.files[0]);
    });

    // 清除文件
    document.getElementById('fs-clear-file').addEventListener('click', () => this.clearFile());

    // 模式切换
    document.querySelectorAll('.fs-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.fs-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.mode = tab.dataset.mode;
        document.getElementById('fs-password-field').style.display = this.mode === 'protected' ? '' : 'none';
      });
    });

    // 上传
    document.getElementById('fs-upload-btn').addEventListener('click', () => this.uploadFile());

    // 刷新
    document.getElementById('fs-refresh-btn').addEventListener('click', () => this.loadFileList());

    // ===== 文件列表：事件委托（绑定到稳定父容器，避免重建 DOM 丢失监听器） =====
    const wrap = document.getElementById('fs-table-wrap');
    // 加密文件下载按钮
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.fs-dl-btn:not([href])');
      if (btn) this.openDialog(btn.dataset.id);
    });
    // 删除按钮
    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('.fs-del-btn');
      if (!btn) return;
      e.preventDefault();
      if (!confirm('确定删除此文件？')) return;
      const id = btn.dataset.id;
      const uid = encodeURIComponent(this.userId);
      try {
        // 新契约：?userId=<uid>；ownerId 是同值的过渡兼容参数（老后端只认它）
        const r = await fetch(`/api/fileshare/${encodeURIComponent(id)}?userId=${uid}&ownerId=${uid}`, { method: 'DELETE' });
        if (r.ok) {
          this.toast.show('已删除', 'success');
          this.loadFileList();
          return;
        }
        let msg = '';
        if (r.status === 403) {
          msg = '这不是你的文件，无法删除';
        } else if (r.status === 404) {
          msg = '文件不存在或已过期';
        }
        if (!msg) {
          try { const err = await r.json(); msg = err?.error || ''; } catch { /* 非 JSON 响应 */ }
        }
        this.toast.show(msg || '删除失败', 'error');
      } catch { this.toast.show('删除失败，请检查网络', 'error'); }
    });
    // 生成二维码（联动二维码工具）
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.fs-qr-btn');
      if (!btn) return;
      this.generateQrForFile(btn.dataset.qrId, btn.dataset.qrName);
    });

    // 密码弹窗
    document.getElementById('fs-dialog-cancel').addEventListener('click', () => this.closeDialog());
    document.getElementById('fs-dialog-confirm').addEventListener('click', () => this.confirmDownload());
    document.getElementById('fs-download-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmDownload();
    });
  }

  // ==================== 文件选择 ====================

  selectFile(file) {
    if (file.size > 100 * 1024 * 1024) {
      this.toast.show('文件超过 100MB 限制', 'error');
      return;
    }
    this.selectedFile = file;
    document.getElementById('fs-file-info').style.display = '';
    document.getElementById('fs-file-name').textContent = file.name;
    document.getElementById('fs-file-size').textContent = this.formatSize(file.size);
    document.getElementById('fs-file-icon').textContent = this.getFileIcon(file.name);
    document.getElementById('fs-mode-tabs').style.display = '';
    document.getElementById('fs-upload-btn').style.display = '';
    document.getElementById('fs-password-field').style.display = this.mode === 'protected' ? '' : 'none';
  }

  clearFile() {
    this.selectedFile = null;
    document.getElementById('fs-file-info').style.display = 'none';
    document.getElementById('fs-mode-tabs').style.display = 'none';
    document.getElementById('fs-upload-btn').style.display = 'none';
    document.getElementById('fs-password-field').style.display = 'none';
    document.getElementById('fs-progress').style.display = 'none';
    document.getElementById('fs-file-input').value = '';
  }

  // 由已上传的文件生成二维码（联动二维码工具，不重复存文件）
  async generateQrForFile(id, name) {
    try {
      const r = await fetch('/api/qr/from-fileshare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileshareId: id, userId: this.userId })
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '生成失败');
      // 用分享链接生成二维码
      const gr = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: d.url, size: 512 })
      });
      const gd = await gr.json();
      if (!gd.success) throw new Error('二维码生成失败');
      this.showFsQrModal(gd.dataUrl, d.url, name);
      this.toast?.show('已保存到二维码记录', 'success');
    } catch (e) {
      // 生成失败：清空上一次残留的二维码，避免用户下载到旧图
      this._clearFsQrModal(e?.message || '二维码生成失败');
      this.toast?.show(e.message || '生成失败', 'error');
    }
  }

  /** 生成失败时清空二维码弹窗里的旧结果并禁用下载/复制 */
  _clearFsQrModal(reason) {
    const modal = document.getElementById('fs-qr-modal');
    if (!modal) return;
    const wrap = modal.querySelector('#fs-qr-img-wrap');
    if (wrap) wrap.innerHTML = '<div class="fs-empty" style="padding:24px 8px;">二维码生成失败</div>';
    const nameEl = modal.querySelector('#fs-qr-name');
    if (nameEl) nameEl.textContent = reason || '二维码生成失败';
    const linkBox = modal.querySelector('#fs-qr-link');
    if (linkBox) {
      linkBox.style.display = 'none';
      const linkText = linkBox.querySelector('.qr-record-modal-link-text');
      if (linkText) linkText.textContent = '';
    }
    const copy = modal.querySelector('#fs-qr-copy');
    if (copy) { copy.disabled = true; copy.onclick = null; }
    const dl = modal.querySelector('#fs-qr-dl');
    if (dl) { dl.disabled = true; dl.onclick = null; }
  }

  // 二维码弹窗（复用二维码工具的样式类）
  showFsQrModal(dataUrl, url, name) {
    let modal = document.getElementById('fs-qr-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fs-qr-modal';
      modal.className = 'qr-record-modal-overlay';
      modal.innerHTML = `
        <div class="qr-record-modal">
          <button class="qr-record-modal-close" id="fs-qr-close">✕</button>
          <div class="qr-record-modal-img-wrap" id="fs-qr-img-wrap"></div>
          <div class="qr-record-modal-text" id="fs-qr-name"></div>
          <div class="qr-record-modal-link" id="fs-qr-link" style="display:none;">
            <span class="qr-record-modal-link-text"></span>
          </div>
          <div class="qr-record-modal-actions">
            <button class="btn btn-sm" id="fs-qr-copy">📋 复制链接</button>
            <button class="btn btn-sm" id="fs-qr-dl">⬇ 下载二维码</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
      modal.querySelector('#fs-qr-close').addEventListener('click', () => modal.classList.remove('open'));
    }
    modal.querySelector('#fs-qr-img-wrap').innerHTML = `<img class="qr-record-modal-img" src="${dataUrl}" alt="二维码" />`;
    modal.querySelector('#fs-qr-name').textContent = name || '文件';
    const linkBox = modal.querySelector('#fs-qr-link');
    linkBox.style.display = '';
    linkBox.querySelector('.qr-record-modal-link-text').textContent = url;
    const copyBtn = modal.querySelector('#fs-qr-copy');
    const dlBtn = modal.querySelector('#fs-qr-dl');
    copyBtn.disabled = false; dlBtn.disabled = false;
    copyBtn.onclick = () => this.copyText(url);
    dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = `qrcode-${Date.now()}.png`; a.click();
    };
    modal.classList.add('open');
  }

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast?.show('已复制', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); this.toast?.show('已复制', 'success'); } catch {}
      document.body.removeChild(ta);
    }
  }

  // ==================== 上传 ====================

  async uploadFile() {
    if (!this.selectedFile || this.uploading) return;
    this.uploading = true;

    const formData = new FormData();
    formData.append('file', this.selectedFile);
    // 归属标识：当前后端读 ownerId，新契约读 userId，两个都带上（同值，多带无副作用）
    formData.append('ownerId', this.userId);
    formData.append('userId', this.userId);
    if (this.mode === 'protected') {
      const pwd = document.getElementById('fs-upload-password').value.trim();
      if (!pwd) { this.toast.show('请设置密码', 'error'); this.uploading = false; return; }
      formData.append('password', pwd);
    }

    const progress = document.getElementById('fs-progress');
    const progressBar = document.getElementById('fs-progress-bar');
    const btn = document.getElementById('fs-upload-btn');
    progress.style.display = '';
    progressBar.style.width = '0%';
    btn.disabled = true;
    btn.textContent = '⏳ 上传中...';

    // XMLHttpRequest 实现真实进度
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/fileshare/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progressBar.style.width = pct + '%';
          btn.textContent = '⏳ ' + pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(xhr.status + ''));
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.send(formData);
    }).then(d => {
      progressBar.style.width = '100%';
      this.toast.show('上传成功！点文件旁的「📲 二维码」可生成活码', 'success');
      this.clearFile();
      this.loadFileList();
    }).catch(() => {
      this.toast.show('上传失败，请检查网络', 'error');
    }).finally(() => {
      this.uploading = false;
      btn.disabled = false;
      btn.textContent = '🚀 上传文件';
      setTimeout(() => { progress.style.display = 'none'; }, 1500);
    });
  }

  // ==================== 文件列表 ====================

  async loadFileList() {
    try {
      const uid = encodeURIComponent(this.userId);
      const r = await fetch(`/api/fileshare/list?userId=${uid}`);
      if (!r.ok) return;
      const payload = await r.json();
      // 新契约：{ success:true, files:[...] }；旧后端：直接返回数组
      let files = [];
      if (Array.isArray(payload)) files = payload;
      else if (payload && payload.success && Array.isArray(payload.files)) files = payload.files;
      else return;
      // 新契约已由服务端按 userId 过滤（且不再返回 ownerId）；
      // 旧后端仍返回全部文件 + ownerId，这里做一次客户端兜底过滤
      files = files.filter((f) => {
        if (!f || typeof f !== 'object') return false;
        if (typeof f.ownerId === 'string' && f.ownerId && f.ownerId !== this.userId) return false;
        return true;
      });
      this.renderFileList(files);
    } catch (e) { console.error('loadFileList error:', e); }
  }

  /**
   * 每次都重建 #fs-table-wrap 的全部内容。
   * 注意：不要跨渲染复用节点（旧实现把 #fs-empty 取出来又 append 回去，
   * 一旦前一次渲染已把它从 DOM 移除，下一次就会拿到 null 并抛
   * "Cannot read properties of null (reading 'parentNode')"）。
   */
  renderFileList(data) {
    const wrap = document.getElementById('fs-table-wrap');
    if (!wrap) return; // 页面 DOM 已不在
    const files = Array.isArray(data) ? data.filter((f) => f && typeof f === 'object') : [];

    if (files.length === 0) {
      wrap.innerHTML = '<div class="fs-empty" id="fs-empty">暂无文件，上传一个吧</div>';
      return;
    }

    const now = Date.now();
    const rows = files.map((f) => {
      // 新契约字段：uploadedAt / encrypted；兼容旧字段 time / expireAt / hasPassword
      const uploadedAt = f.uploadedAt || f.time || null;
      const uploadedMs = uploadedAt ? new Date(uploadedAt).getTime() : NaN;
      const expireMs = f.expireAt
        ? new Date(f.expireAt).getTime()
        : (isNaN(uploadedMs) ? NaN : uploadedMs + 24 * 3600 * 1000);
      const remainingStr = isNaN(expireMs) ? '—' : this.formatRemaining(Math.max(0, expireMs - now));
      const encrypted = !!(f.encrypted ?? f.hasPassword);
      const sizeStr = typeof f.size === 'number' ? this.formatSize(f.size) : '—';
      const isMine = !f.ownerId || f.ownerId === this.userId;
      const dlUrl = `/api/fileshare/download/${encodeURIComponent(f.id)}`;
      return `
        <div class="fs-row">
          <span class="fs-row-icon">${this.getFileIcon(f.name || '')}${encrypted ? ' 🔒' : ''}</span>
          <span class="fs-row-name" title="${this.escapeHTML(f.name || '')}">${this.escapeHTML(f.name || '未命名文件')}</span>
          <span class="fs-row-size">${sizeStr}</span>
          <span class="fs-row-time" title="剩余 ${remainingStr}">${remainingStr}</span>
          ${f.downloads == null ? '' : `<span class="fs-row-dl">${f.downloads || 0} 次</span>`}
          ${encrypted
            ? `<button class="btn btn-sm fs-dl-btn" data-id="${f.id}">🔒 下载</button>`
            : `<a class="btn btn-sm fs-dl-btn" href="${dlUrl}" target="_blank" download>⬇ 下载</a>`}
          ${isMine
            ? `<button class="btn btn-sm fs-del-btn" data-id="${f.id}" style="color:var(--danger);margin-left:4px;">🗑</button>`
            : `<button class="btn btn-sm" style="color:var(--text-muted);margin-left:4px;opacity:0.35;cursor:not-allowed;" disabled title="仅上传者可删除">🗑</button>`}
          <button class="btn btn-sm fs-qr-btn" data-qr-id="${f.id}" data-qr-name="${this.escapeHTML(f.name || '')}" title="生成二维码">📲 二维码</button>
        </div>`;
    }).join('');

    wrap.innerHTML = rows;
  }

  // ==================== 下载 ====================

  openDialog(id) {
    this._downloadId = id;
    document.getElementById('fs-dialog-overlay').style.display = 'flex';
    document.getElementById('fs-dialog-title').textContent = '🔒 此文件需要密码';
    document.getElementById('fs-dialog-input-area').style.display = '';
    document.getElementById('fs-dialog-link-area').style.display = 'none';
    document.getElementById('fs-dialog-actions').style.display = '';
    document.getElementById('fs-download-password').value = '';
    document.getElementById('fs-dialog-error').style.display = 'none';
  }

  closeDialog() {
    document.getElementById('fs-dialog-overlay').style.display = 'none';
    this._downloadId = null;
  }

  async confirmDownload() {
    const pwd = document.getElementById('fs-download-password').value.trim();
    if (!pwd) {
      document.getElementById('fs-dialog-error').style.display = '';
      document.getElementById('fs-dialog-error').textContent = '请输入密码';
      return;
    }

    const btn = document.getElementById('fs-dialog-confirm');
    btn.disabled = true; btn.textContent = '⏳ 验证中...';

    try {
      const r = await fetch(`/api/fileshare/check-pwd/${this._downloadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      if (r.ok) {
        // 验证通过 → 显示下载链接，用户真正点击下载
        document.getElementById('fs-dialog-title').textContent = '✅ 密码正确';
        document.getElementById('fs-dialog-input-area').style.display = 'none';
        document.getElementById('fs-dialog-actions').style.display = 'none';
        document.getElementById('fs-dialog-link-area').style.display = '';
        document.getElementById('fs-dialog-error').style.display = 'none';
        const link = document.getElementById('fs-dialog-link');
        link.href = `/api/fileshare/download/${this._downloadId}?pwd=${encodeURIComponent(pwd)}`;
        link.onclick = () => setTimeout(() => this.closeDialog(), 200);
        this.loadFileList();
      } else {
        const e = await r.json();
        document.getElementById('fs-dialog-error').style.display = '';
        document.getElementById('fs-dialog-error').textContent = e.error || '密码错误';
        btn.disabled = false; btn.textContent = '确认下载';
      }
    } catch {
      document.getElementById('fs-dialog-error').style.display = '';
      document.getElementById('fs-dialog-error').textContent = '验证失败';
      btn.disabled = false; btn.textContent = '确认下载';
    }
  }

  // ==================== 工具方法 ====================

  formatSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  formatRemaining(ms) {
    if (ms <= 0) return '已过期';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 1) return h + '小时' + (m > 0 ? m + '分' : '');
    if (m >= 1) return m + '分钟';
    return '即将过期';
  }

  getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
      zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️',
      mp4: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      txt: '📄', md: '📄', js: '📜', py: '📜', html: '📜', css: '📜',
      exe: '⚙️', dmg: '💿', iso: '💿',
    };
    return map[ext] || '📎';
  }

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
