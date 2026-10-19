/**
 * PixelKit - 在线工具箱
 * 所有功能页面按需动态加载，首页仅加载核心路由代码
 */
import { Toast } from './ui/Toast.js';
// import { Changelog } from './ui/Changelog.js';  // 更新日志弹窗暂时下线，需要时取消注释并恢复下方调用

class App {
  constructor() {
    this.toast = new Toast(document.getElementById('toast'));
    this.currentPage = 'home';
    this.init();
  }

  init() {
    this._setupTheme();
    this._reverseCards();
    this.setupRouting();

    // 为每个页面预注册 Observer，点击时才动态加载对应模块
    this._lazyPage('compose', () => this._loadCompose());
    this._lazyPage('convert', () => this._loadConvert());
    this._lazyPage('document', () => this._loadDocument());
    this._lazyPage('agent', () => this._loadAgent());
    this._lazyPage('docx-editor', () => this._loadDocxEditor());
    this._lazyPage('timer', () => this._loadTimer());
    this._lazyPage('counter', () => this._loadCounter());
		this._lazyPage('fileshare', () => this._loadFileShare());
    this._lazyPage('qr', () => this._loadQr());
    // [已注销] 本次更新暂不带步步为营功能
    // this._lazyPage('quoridor', () => this._loadQuoridor());
    this._lazyPage('tasks', () => this._loadTasks());
    this._lazyPage('lifesim', () => this._loadLifeSim());
    this._lazyPage('book', () => this._loadBook());

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    // const gameParam = params.get('game');
    // if (gameParam) { this.showPage('quoridor'); }
    if (roomParam) {
      this.showPage('docx-editor');
    } else {
      this.showPage('home');
    }
  }

  // ==================== 主题 & 主色 管理 ====================
  _setupTheme() {
    const THEME_KEY = 'pk_theme';            // 'dark' | 'light'
    const PRIMARY_KEY = 'pk_primary';        // '#rrggbb' 或 ''
    const PRESETS = [
      { name: '午夜紫',  c: '#7c6ff7' },
      { name: '翡翠绿',  c: '#10b981' },
      { name: '青蓝',    c: '#3b82f6' },
      { name: '珊瑚橙',  c: '#f97316' },
      { name: '玫瑰粉',  c: '#ec4899' },
      { name: '琥珀金',  c: '#d97706' },
      { name: '晴蓝',    c: '#06b6d4' },
    ];

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const hex2rgb = (h) => { h = h.replace('#',''); if (h.length===3) h=h.split('').map(x=>x+x).join(''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
    const rgb2hex = (r,g,b) => '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
    const rgb2hsl = (r,g,b) => {
      r/=255; g/=255; b/=255; const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      let h,s,l=(mx+mn)/2;
      if (mx===mn) { h=s=0; } else { const d=mx-mn; s = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
        switch(mx){ case r: h=((g-b)/d+(g<b?6:0))/6; break; case g: h=((b-r)/d+2)/6; break; case b: h=((r-g)/d+4)/6; break; } }
      return [h*360, s*100, l*100];
    };
    const hsl2rgb = (h,s,l) => {
      h/=360; s/=100; l/=100;
      if (s===0) { const v=l*255; return [v,v,v]; }
      const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
      const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
      return [hue2rgb(p,q,h+1/3)*255, hue2rgb(p,q,h)*255, hue2rgb(p,q,h-1/3)*255];
    };
    const shade = (hex, dl, ds=0) => {
      const [r,g,b] = hex2rgb(hex); let [h,s,l] = rgb2hsl(r,g,b);
      l = clamp(l + dl, 4, 92); s = clamp(s + ds, 0, 100);
      return rgb2hex(...hsl2rgb(h,s,l));
    };

    const applyTheme = (mode) => {
      if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    };
    const applyPrimary = (hex) => {
      const style = document.documentElement.style;
      if (!hex) { style.removeProperty('--primary'); style.removeProperty('--primary-hover'); style.removeProperty('--primary-glow'); style.removeProperty('--primary-soft'); style.removeProperty('--accent'); return; }
      style.setProperty('--primary', hex);
      style.setProperty('--primary-hover', shade(hex, -6));
      style.setProperty('--accent', shade(hex, +6, -4));
      const [r,g,b] = hex2rgb(hex);
      style.setProperty('--primary-glow', `rgba(${r},${g},${b},0.25)`);
      style.setProperty('--primary-soft', `rgba(${r},${g},${b},0.08)`);
    };

    // 初始应用（在 DOMContentLoaded 前就执行，避免闪白）
    // 默认改为「暖白日光」以匹配改版后的视觉体系；已存过偏好的用户不受影响
    const savedMode = localStorage.getItem(THEME_KEY) || 'light';
    const savedPrimary = localStorage.getItem(PRIMARY_KEY) || '';
    applyTheme(savedMode);
    applyPrimary(savedPrimary);

    // 渲染浮动面板
    const fab = document.createElement('button');
    fab.className = 'theme-fab'; fab.id = 'theme-fab';
    fab.innerHTML = savedMode === 'light' ? '☀️' : '🌙';
    fab.title = '主题 & 主色';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'theme-panel'; panel.id = 'theme-panel';
    panel.innerHTML = `
      <h4>外观主题</h4>
      <div class="theme-row">
        <button class="theme-preset" data-mode="dark" title="深邃午夜蓝" style="background:linear-gradient(135deg,#141312 0%,#262320 100%);box-shadow:inset 0 0 0 1px rgba(255,107,74,0.2);">
          <span style="position:absolute;left:6px;top:6px;font-size:12px;">🌙</span>
        </button>
        <button class="theme-preset" data-mode="light" title="日光白" style="background:linear-gradient(135deg,#f3f5fb 0%,#eef2fc 100%);box-shadow:inset 0 0 0 1px rgba(100,120,180,0.2);">
          <span style="position:absolute;left:6px;top:6px;font-size:12px;">☀️</span>
        </button>
      </div>
      <div class="theme-label" id="theme-mode-label">${savedMode === 'light' ? '当前：日光白' : '当前：深邃午夜蓝'}</div>
      <h4>主色调</h4>
      <div class="theme-row" id="primary-row">
        ${PRESETS.map(p => `<button class="theme-swatch" data-color="${p.c}" title="${p.name}" style="background:linear-gradient(135deg,${p.c},${shade(p.c,-14)});"></button>`).join('')}
        <label class="theme-custom" title="自定义颜色">✎<input type="color" id="primary-custom" value="${savedPrimary || '#ff6b4a'}" /></label>
        <button class="theme-swatch" data-color="" title="恢复默认" style="background:repeating-linear-gradient(45deg,#888 0 2px,transparent 2px 6px);"></button>
      </div>
      <div class="theme-label" id="theme-primary-label">${savedPrimary ? `当前：自定义 ${savedPrimary}` : '当前：默认珊瑚橙'}</div>
    `;
    document.body.appendChild(panel);

    const refreshActive = () => {
      const mode = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      panel.querySelectorAll('.theme-preset').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      const curr = document.documentElement.style.getPropertyValue('--primary').trim() || '';
      panel.querySelectorAll('.theme-swatch').forEach(b => {
        const dc = b.dataset.color;
        if (dc === undefined) return;
        if (!dc && !curr) b.classList.add('active');
        else if (dc && curr && dc.toLowerCase() === curr.toLowerCase()) b.classList.add('active');
        else b.classList.remove('active');
      });
    };

    // 事件：打开/关闭面板
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
      refreshActive();
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== fab) panel.classList.remove('open');
    });

    // 事件：主题切换
    panel.querySelectorAll('.theme-preset').forEach(b => {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        applyTheme(mode); localStorage.setItem(THEME_KEY, mode);
        fab.innerHTML = mode === 'light' ? '☀️' : '🌙';
        panel.querySelector('#theme-mode-label').textContent = mode === 'light' ? '当前：日光白' : '当前：深邃午夜蓝';
        refreshActive();
      });
    });

    // 事件：主色切换
    const primaryLabel = panel.querySelector('#theme-primary-label');
    panel.querySelectorAll('.theme-swatch').forEach(b => {
      b.addEventListener('click', () => {
        const c = b.dataset.color;
        applyPrimary(c);
        if (c) localStorage.setItem(PRIMARY_KEY, c); else localStorage.removeItem(PRIMARY_KEY);
        primaryLabel.textContent = c ? `当前：${c}` : '当前：默认珊瑚橙';
        refreshActive();
      });
    });
    panel.querySelector('#primary-custom').addEventListener('input', (e) => {
      const c = e.target.value; applyPrimary(c); localStorage.setItem(PRIMARY_KEY, c);
      primaryLabel.textContent = `当前：自定义 ${c}`; refreshActive();
    });

    refreshActive();
  }

  // ==================== 首页卡片排序 ====================

  /** 最新加入的功能（HTML 末尾）排到最前，老版本功能排后面 */
  _reverseCards() {
    const grid = document.querySelector('.home-cards');
    if (!grid) return;
    Array.from(grid.children).reverse().forEach(card => grid.appendChild(card));
  }

  // ==================== 通用懒加载 ====================

  /** 监听页面切换，首次激活时调用 loadFn 动态加载 */
  _lazyPage(name, loadFn) {
    let loaded = false;
    const observer = new MutationObserver(() => {
      if (document.getElementById(`page-${name}`).classList.contains('active')) {
        if (!loaded) { loaded = true; loadFn(); }
      }
    });
    observer.observe(document.getElementById(`page-${name}`), { attributes: true, attributeFilter: ['class'] });
  }

  // ==================== 页面路由 ====================

  setupRouting() {
    document.querySelectorAll('.home-card').forEach(card => {
      card.addEventListener('click', () => {
        const page = card.dataset.page;
        if (page) this.showPage(page);
      });
    });

    const pages = ['compose', 'convert', 'document', 'agent', 'ppt', 'docx-editor', 'timer', 'fileshare', 'counter', 'qr', 'tasks', 'lifesim', 'book', 'nightmarket', 'radio'];
    for (const p of pages) {
      document.getElementById(`btn-back-${p}`).addEventListener('click', () => this.showPage('home'));
    }

    // 夜市小游戏全屏切换（包一层 wrap，全屏时保留整个游戏区域）
    const nmFs = document.getElementById('btn-nightmarket-fullscreen');
    if (nmFs) {
      nmFs.addEventListener('click', async () => {
        const wrap = document.querySelector('.nightmarket-wrap');
        try {
          if (!document.fullscreenElement) await (wrap || document.documentElement).requestFullscreen();
          else await document.exitFullscreen();
        } catch { /* 浏览器不支持就忽略 */ }
      });
    }



    // 页内跳转（成长模拟器选中「人生之书 · 玩法加厚版」时切到 #page-book）
    window.addEventListener('pk-goto', (e) => {
      const target = e.detail;
      if (target && document.getElementById(`page-${target}`)) this.showPage(target);
    });
  }

  showPage(name) {
    this.toast.hide();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`page-${name}`);
    if (pageEl) pageEl.classList.add('active');
    this.currentPage = name;
    // 世界电台：第一次进入时初始化（拉目录 + 绑定播放器）
    if (name === 'radio' && !this._radioInited) {
      this._radioInited = true;
      this._initRadio();
    }
    // 夜市小游戏用 iframe 懒加载：只有第一次打开时才去加载那 2MB 静态资源
    if (name === 'nightmarket') {
      const f = document.getElementById('nightmarket-frame');
      if (f && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
    }


    if (name === 'compose' && this._composeInited) {
      setTimeout(() => {
        this.canvas.render(this.layerManager.getLayers());
      }, 50);
    }
  }

  /** 懒加载世界电台页（独立模块，避免拖慢首屏） */
  async _initRadio() {
    try {
      const { RadioPage } = await import('./pages/RadioPage.js');
      this._radioPage = new RadioPage(this.toast);
      this._radioPage.init();
    } catch (e) {
      this._radioInited = false;
      this.toast?.show?.('电台工具加载失败：' + (e.message || e), 'error');
    }
  }

  // ==================== 图片拼接（动态加载） ====================

  async _loadCompose() {
    const [
      { CanvasEngine }, { LayerManager }, { ExportManager }, { HistoryManager },
      { UIManager }, { DragDropHandler }, { KeyboardHandler },
    ] = await Promise.all([
      import('./engine/CanvasEngine.js'),
      import('./engine/LayerManager.js'),
      import('./engine/ExportManager.js'),
      import('./engine/HistoryManager.js'),
      import('./ui/UIManager.js'),
      import('./ui/DragDropHandler.js'),
      import('./ui/KeyboardHandler.js'),
    ]);

    this._composeInited = true;
    this.history = new HistoryManager();
    this.canvas = new CanvasEngine('main-canvas', 1200, 800);
    this.layerManager = new LayerManager(this.canvas, this.history);
    this.exportManager = new ExportManager(this.canvas, this.layerManager);
    this.ui = new UIManager(this.canvas, this.layerManager, this.exportManager, this.history, this.toast);
    this.dragDrop = new DragDropHandler(this.canvas, this.layerManager, this.ui, this.toast);
    this.keyboard = new KeyboardHandler(this.canvas, this.layerManager, this.ui, this.history);

    this.ui.init();
    this.dragDrop.init();
    this.keyboard.init();
    this._bindComposeButtons();

    this.canvas.render(this.layerManager.getLayers());
    setTimeout(() => {
      this.canvas.resetView();
      this.canvas.render(this.layerManager.getLayers());
    }, 100);

    this.toast.show('就绪 - Ctrl+G编组 | 滚轮缩放 | 空格平移 | 对齐吸附', 'success');
  }

  _bindComposeButtons() {
    // 文件上传
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) { this._handleFiles(e.target.files); fileInput.value = ''; }
    });

    // 导出
    document.getElementById('btn-export-png').addEventListener('click', () => this.exportManager.exportImage('png'));
    document.getElementById('btn-export-jpg').addEventListener('click', () => this.exportManager.exportImage('jpeg'));
    document.getElementById('btn-export-webp').addEventListener('click', () => this.exportManager.exportImage('webp'));
    document.getElementById('btn-export-original').addEventListener('click', () => this.exportManager.exportOriginal());

    // 工具
    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.layerManager.getLayers().length === 0) return;
      if (confirm('确定要清空画布上的所有图层吗？')) {
        this.layerManager.clearAll(); this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList(); this.toast.show('画布已清空', 'success');
      }
    });
    document.getElementById('btn-undo').addEventListener('click', () => {
      this.history.undo(this.layerManager, this.canvas, this.ui); this.ui.updateUndoRedoButtons();
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      this.history.redo(this.layerManager, this.canvas, this.ui); this.ui.updateUndoRedoButtons();
    });
    document.getElementById('btn-add-text').addEventListener('click', () => {
      const text = prompt('请输入文字内容:', '文字');
      if (text) { this.layerManager.addTextLayer(text); this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList(); this.toast.show('文字图层已添加', 'success'); }
    });

    // 编组
    document.getElementById('btn-group').addEventListener('click', () => {
      const gid = this.layerManager.groupSelectedLayers();
      if (gid) { this.canvas.render(this.layerManager.getLayers()); this.ui.refreshLayerList(); this.toast.show('已编组', 'success'); }
      else this.toast.show('请至少选中 2 个图层', 'error');
    });
    document.getElementById('btn-ungroup').addEventListener('click', () => {
      const s = this.layerManager.getSelectedLayer();
      if (s?.groupId) { this.layerManager.ungroupLayers(s.groupId); this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList(); this.toast.show('编组已拆开', 'success'); }
      else this.toast.show('请选中编组内的图层', 'error');
    });
    document.getElementById('btn-lock-group').addEventListener('click', () => {
      const s = this.layerManager.getSelectedLayer();
      if (s?.groupId) { this.layerManager.toggleGroupLock(s.groupId); this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList(); this.toast.show(this.layerManager.getLayer(s.id)?.locked ? '编组已锁定' : '编组已解锁', 'success'); }
      else if (s) { this.layerManager.updateLayer(s.id, { locked: !s.locked }); this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList(); this.toast.show(s.locked ? '图层已解锁' : '图层已锁定', 'success'); }
      else this.toast.show('请选中一个图层或编组', 'error');
    });

    // 画布尺寸
    document.getElementById('btn-resize-canvas').addEventListener('click', () => {
      const w = parseInt(document.getElementById('canvas-width').value);
      const h = parseInt(document.getElementById('canvas-height').value);
      if (w >= 100 && h >= 100) { this.canvas.setSize(w, h); this.canvas.render(this.layerManager.getLayers());
        this.toast.show(`画布 ${w}×${h}`, 'success'); }
      else this.toast.show('画布至少 100×100', 'error');
    });

    // 视图
    document.getElementById('btn-zoom-fit').addEventListener('click', () => { this.canvas.resetView(); this.canvas.render(this.layerManager.getLayers()); });
    document.getElementById('btn-zoom-100').addEventListener('click', () => {
      const r = this.canvas.canvas.getBoundingClientRect();
      this.canvas.zoomAt(r.width / 2, r.height / 2, 1); this.canvas.render(this.layerManager.getLayers());
    });
  }

  async _handleFiles(files) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    const promises = [];
    for (const file of files) {
      if (!validTypes.includes(file.type)) { this.toast.show(`跳过: ${file.name}`, 'error'); continue; }
      promises.push(this._loadImage(file));
    }
    const images = (await Promise.all(promises)).filter(Boolean);
    if (images.length > 0) {
      for (const d of images) this.layerManager.addLayer(d);
      this.canvas.autoExpand(this.layerManager.getLayers());
      this.canvas.render(this.layerManager.getLayers());
      this.ui.refreshLayerList();
      this.toast.show(`已添加 ${images.length} 张`, 'success');
    }
  }

  _loadImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const max = 2000;
          if (width > max || height > max) {
            const r = Math.min(max / width, max / height);
            width = Math.round(width * r); height = Math.round(height * r);
          }
          const rect = this.canvas.canvas.getBoundingClientRect();
          const vc = this.canvas.canvasToWorld(rect.width / 2, rect.height / 2);
          resolve({ name: file.name, src: e.target.result, originalWidth: img.width, originalHeight: img.height,
            width, height, x: vc.x - width / 2, y: vc.y - height / 2, type: file.type, file });
        };
        img.onerror = () => { this.toast.show(`加载失败: ${file.name}`, 'error'); resolve(null); };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ==================== 格式转换（动态加载） ====================

  async _loadConvert() {
    const { ConvertPage } = await import('./pages/ConvertPage.js');
    const page = new ConvertPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 文档转换（动态加载） ====================

  async _loadDocument() {
    const { DocumentPage } = await import('./pages/DocumentPage.js');
    const page = new DocumentPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== AI助手（动态加载） ====================

  async _loadAgent() {
    const { AgentPage } = await import('./pages/AgentPage.js');
    const page = new AgentPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 文档编辑器（动态加载，最重） ====================

  async _loadDocxEditor() {
    const { DocxEditorPage } = await import('./pages/DocxEditorPage.jsx');
    const page = new DocxEditorPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 计时工具（动态加载） ====================

  async _loadTimer() {
    const { TimerPage } = await import('./pages/TimerPage.js');
    const page = new TimerPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 文件中转站（动态加载） ====================

  	async _loadCounter() {
		const { CounterPage } = await import('./pages/CounterPage.js');
		const page = new CounterPage(this.toast);
		if (!page._inited) page.init();
	}

	// ==================== 文件中转站（动态加载） ====================

	async _loadFileShare() {
    const { FileSharePage } = await import('./pages/FileSharePage.js');
    const page = new FileSharePage(this.toast);
    if (!page._inited) page.init();
  }

  // =================== 二维码工具（动态加载） ===================

	async _loadQr() {
    const { QrPage } = await import('./pages/QrPage.js');
    const page = new QrPage(this.toast);
    if (!page._inited) page.init();
  }
  // [已注销] 本次更新暂不带步步为营功能
  // ==================== 步步为营游戏（动态加载） ====================
  // async _loadQuoridor() {
  //   const { QuoridorPage } = await import('./pages/QuoridorPage.js');
  //   const page = new QuoridorPage(this.toast);
  //   if (!page._inited) page.init();
  //   // 调试入口：控制台 window.__quoridor.replay.showList() 查看复盘
  //   window.__quoridor = page;
  // }

  // ==================== 任务管理（动态加载） ====================

  async _loadTasks() {
    const { TaskPage } = await import('./pages/TaskPage.js');
    const page = new TaskPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 成长模拟器（动态加载） ====================

  async _loadLifeSim() {
    const { LifeSimPage } = await import('./pages/LifeSimPage.js');
    const page = new LifeSimPage(this.toast);
    if (!page._inited) page.init();
  }

  // ==================== 人生之书（玩法加厚版 · 五条世界线） ====================

  async _loadBook() {
    const { LifeBookPage } = await import('./pages/LifeBookPage.js');
    const page = new LifeBookPage();
    page.init(document.getElementById('pkb-root'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
  // new Changelog().maybeShow();  // 更新日志弹窗暂时下线
  fetch('/api/visitors').then(r => r.json()).then(d => {
    const today = document.getElementById('visitor-today');
    const total = document.getElementById('visitor-total');
    if (today) today.textContent = d.today;
    if (total) total.textContent = d.total;
  }).catch(() => {});
});
