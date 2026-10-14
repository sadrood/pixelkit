export class CounterPage {
  constructor(t) {
    this.toast = t;
    this._inited = false;
    this.counters = [];
    this.soundOn = true;
    this.vibrateOn = true;
    this.focusMode = false;
    this.showHelp = false;
    this.sidebarOpen = true;
    this.drawerOpen = false;
    this.activeIdx = 0;
    this.userId = localStorage.getItem('pixelkit_user_id');
    if (!this.userId) {
      this.userId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pixelkit_user_id', this.userId);
    }
    this._storageKey = 'pixelkit_counters_' + this.userId;
  }

  _isDark() { return document.documentElement.getAttribute('data-theme') !== 'light'; }
  _primaryColor() { return (getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#7c6ff7').toLowerCase(); }
  _accentColor() { return (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa').toLowerCase(); }
  _dangerColor() { return (getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#f04860').toLowerCase(); }
  _setGlobalTheme(dark) {
    localStorage.setItem('pk_theme', dark ? 'dark' : 'light');
    if (dark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    const fab = document.getElementById('theme-fab');
    if (fab) fab.innerHTML = dark ? '🌙' : '☀️';
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    this.root = document.getElementById('counter-root');
    if (!this.root) return;
    this._loadData();
    this.render();
    this._bindKeyboard();
  }

  _loadData() {
    try {
      const r = localStorage.getItem(this._storageKey);
      if (r) {
        const d = JSON.parse(r);
        this.counters = d.counters || [];
        const dm = d.darkMode;
        if (dm !== undefined && dm !== null && !localStorage.getItem('pk_theme')) {
          this._setGlobalTheme(dm);
        }
        this.soundOn = d.soundOn ?? true;
        this.vibrateOn = d.vibrateOn ?? true;
      }
    } catch { this.counters = []; }
    if (this.counters.length === 0) {
      this.counters = [{ id: 'c1', name: '计数器 1', value: 0, step: 1, color: this._primaryColor(), goal: 0, locked: false, lastModified: null }];
    }
    this.counters.forEach(c => {
      if (!c.lastModified) c.lastModified = null;
      if (c.locked === undefined) c.locked = false;
      if (!c.color) c.color = this._primaryColor();
    });
    if (this.activeIdx >= this.counters.length) this.activeIdx = 0;
  }

  _saveData() {
    localStorage.setItem(this._storageKey, JSON.stringify({
      counters: this.counters,
      soundOn: this.soundOn,
      vibrateOn: this.vibrateOn
    }));
  }

  _fmtTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  _esc(s) { return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  render() {
    const bg = 'var(--bg)';
    const cb = 'var(--surface)';
    const tx = 'var(--text)';
    const su = 'var(--text-secondary)';
    const bd = 'var(--border)';
    const danger = this._dangerColor();
    const accent = this._accentColor();
    this.root.innerHTML = `<div class="counter-wrap" style="min-height:100vh;background:${bg};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,sans-serif;display:flex;position:relative">${this.focusMode ? this._focusUI(tx, accent) : this._layoutUI(bg, cb, tx, su, bd, danger, accent)}</div>`;
    if (!this.focusMode) {
      this._bindMain();
      this._bindSidebar();
      if (this.drawerOpen) {
        const p = this.root.querySelector('#cp');
        const o = this.root.querySelector('#co');
        if (p) p.style.transform = 'translateX(0)';
        if (o) o.style.display = 'block';
      }
    } else {
      this._bindFocusMode();
    }
  }

  _focusUI(text, accent) {
    const c = this.counters[this.activeIdx] || this.counters[0] || { value: 0, step: 1, color: this._primaryColor() };
    return `<div id="focus-area" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;position:relative;user-select:none">
<button id="focus-close" style="position:fixed;top:20px;right:20px;width:44px;height:44px;border-radius:12px;border:1px solid var(--border-light);background:var(--surface);color:var(--text-secondary);font-size:20px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow)" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border-light)';this.style.color='var(--text-secondary)'">✕</button>
<div id="focus-val" style="font-size:160px;font-weight:800;background:linear-gradient(135deg,${text},${c.color});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;line-height:1;letter-spacing:-4px;cursor:pointer;padding:20px 40px">${c.value.toLocaleString()}</div>
<div style="font-size:15px;color:var(--text-secondary);font-weight:600;letter-spacing:-.2px">${this._esc(c.name)}</div>
<div style="font-size:12px;color:var(--text-muted);margin-top:16px">点击屏幕任意位置 +${c.step}　·　右上角按钮退出</div>
</div>`;
  }

  _layoutUI(bg, cb, tx, su, bd, danger, accent) {
    const sw = this.sidebarOpen ? '248px' : '0px';
    const activeCounter = this.counters[this.activeIdx] || { goal: 0, color: this._primaryColor() };
    return `
<button id="sidebar-toggle" style="position:fixed;left:${this.sidebarOpen ? '244px' : '4px'};top:120px;z-index:50;width:28px;height:48px;border-radius:0 8px 8px 0;background:${cb};border:1px solid ${bd};border-left:none;color:${su};cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:left .25s;box-shadow:2px 0 8px rgba(0,0,0,.08)" onmouseover="this.style.color='var(--primary)';this.style.borderColor='var(--primary)'" onmouseout="this.style.color='';this.style.borderColor=''">${this.sidebarOpen ? '◀' : '▶'}</button>
<div id="counter-sidebar" style="width:${sw};min-width:${sw};max-width:${sw};background:${cb};border-right:1px solid ${bd};transition:all .25s;overflow:hidden;display:flex;flex-direction:column;height:100vh;position:sticky;top:0">
  <div style="padding:20px 16px 12px"><span style="font-size:16px;font-weight:700;color:${tx};letter-spacing:-.3px">📊 ${this.counters.length}</span></div>
  <div style="padding:0 16px 8px;display:flex;gap:6px">
    <button id="se" style="font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid ${bd};background:none;color:${su};cursor:pointer" title="导出">📤</button>
    <button id="si" style="font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid ${bd};background:none;color:${su};cursor:pointer" title="导入">📥</button>
    <input type="file" id="cif" accept=".json" style="display:none">
    <button id="sr" style="font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid ${bd};background:none;color:${danger};cursor:pointer" title="重置全部">↺</button>
    <button id="sda" style="font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid ${bd};background:none;color:${su};cursor:pointer;margin-left:auto" title="删除全部">🗑</button>
  </div>
  <div style="flex:1;overflow-y:auto;padding:4px 12px">
    ${this.counters.map((c, i) => `<div class="sidebar-item" data-idx="${i}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;cursor:pointer;margin-bottom:2px;transition:all .15s;${i === this.activeIdx ? 'background:' + c.color + '1A;border:1px solid ' + c.color + '40' : 'border:1px solid transparent'}" onmouseover="this.style.background=this.style.background||'${bd}08'" onmouseout="if(this.dataset.idx!=='${this.activeIdx}'){this.style.background='';this.style.borderColor='transparent'}">
      <span style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;box-shadow:0 0 8px ${c.color}55"></span>
      <span style="flex:1;font-size:13px;font-weight:600;color:${tx};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc(c.name)}</span>
      <span style="font-size:15px;font-weight:700;color:${tx};min-width:36px;text-align:right">${c.value}</span>
      ${c.locked ? '<span style="font-size:10px;opacity:.5">🔒</span>' : ''}
    </div>`).join('')}
  </div>
  <div style="padding:12px 16px;border-top:1px solid ${bd}">
    <button id="sa" style="width:100%;padding:10px;border-radius:10px;border:2px dashed var(--border-light);background:none;color:${su};font-size:13px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border-light)';this.style.color=''">+ 添加计数器</button>
  </div>
</div>
<div style="flex:1;overflow-y:auto;height:100vh;background:${bg}">
  <div style="max-width:480px;margin:0 auto;padding:20px 24px 120px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
      <h1 style="font-size:26px;font-weight:800;color:${tx};margin:0;letter-spacing:-.5px">${this._esc(activeCounter.name || '计数器')}</h1>
      <div style="display:flex;gap:6px">
        <button id="mh" style="background:none;border:1px solid ${bd};font-size:13px;cursor:pointer;padding:7px 9px;border-radius:10px;color:${su};transition:all .15s" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color=''">?</button>
        <button id="ml" style="background:none;border:1px solid ${bd};font-size:13px;cursor:pointer;padding:7px 9px;border-radius:10px;color:${activeCounter.locked ? danger : su};transition:all .15s" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color=''">${activeCounter.locked ? '🔒' : '🔓'}</button>
        <button id="ms" style="background:none;border:none;font-size:18px;cursor:pointer;padding:7px;border-radius:10px;color:${su};transition:all .15s" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''">⚙</button>
      </div>
    </div>

    ${this.showHelp ? `<div id="ch" style="background:${cb};border:1px solid ${bd};border-radius:14px;padding:14px 18px;margin-bottom:20px;font-size:12px;color:${su};line-height:2;box-shadow:0 2px 12px rgba(0,0,0,.04)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><strong style="color:${tx};font-size:13px">⌨ 快捷键</strong><button id="hc" style="background:none;border:none;color:${su};cursor:pointer;font-size:16px">×</button></div>
      <div><kbd style="background:var(--bg-tertiary);padding:2px 7px;border-radius:4px;font-size:11px">↑ ↓</kbd> 增减计数</div>
      <div><kbd style="background:var(--bg-tertiary);padding:2px 7px;border-radius:4px;font-size:11px">← →</kbd> 切换计数器</div>
      <div><kbd style="background:var(--bg-tertiary);padding:2px 7px;border-radius:4px;font-size:11px">点击卡片</kbd> 快速 +1</div>
      <div><kbd style="background:var(--bg-tertiary);padding:2px 7px;border-radius:4px;font-size:11px">点击名称</kbd> 可编辑</div>
    </div>` : ''}

    ${this.counters.map((c, i) => `<div class="counter-card" data-sidx="${i}" data-id="${c.id}" style="background:linear-gradient(180deg,${c.color}0D,transparent 30%),${cb};border-top:4px solid ${c.color};border-radius:22px;padding:28px 28px 32px;margin-bottom:20px;box-shadow:0 2px 16px rgba(0,0,0,.05);border-left:1px solid ${i === this.activeIdx ? c.color + '50' : bd};border-right:1px solid ${i === this.activeIdx ? c.color + '50' : bd};border-bottom:1px solid ${i === this.activeIdx ? c.color + '50' : bd};transition:all .25s;cursor:pointer;position:relative;${c.locked ? 'opacity:.55;pointer-events:none' : ''}" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 28px rgba(0,0,0,.08)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <span style="width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0;box-shadow:0 0 12px ${c.color}66"></span>
          <span class="counter-name" data-idx="${i}" contenteditable="true" spellcheck="false" style="font-size:15px;font-weight:600;color:${tx};border:none;background:transparent;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:60px">${this._esc(c.name)}</span>
        </div>
        ${c.locked ? '<span style="font-size:12px;opacity:.5">🔒</span>' : ''}
      </div>
      <div class="counter-val" data-idx="${i}" style="font-size:80px;font-weight:800;text-align:center;line-height:1;padding:14px 0 8px;transition:transform .12s;user-select:none;letter-spacing:-3px;background:linear-gradient(135deg,${tx},${c.color});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${c.value.toLocaleString()}</div>
      <div class="counter-time" style="font-size:11px;color:${su};text-align:center;margin-bottom:8px">上次计数 ${this._fmtTime(c.lastModified)}</div>
      ${c.goal > 0 ? `
        <div style="margin:6px 0 16px;height:8px;border-radius:4px;background:${c.color}12;overflow:hidden">
          <div style="height:100%;border-radius:4px;width:${Math.min(100, (c.value / c.goal) * 100)}%;background:linear-gradient(90deg,${c.color},${accent});transition:width .4s;box-shadow:0 0 10px ${c.color}55"></div>
        </div>
        <div style="font-size:11px;color:${su};text-align:right;margin-bottom:10px"><span style="color:${c.color};font-weight:700">${c.value}</span> / ${c.goal}</div>
      ` : '<div style="margin-bottom:16px"></div>'}
      <div style="display:flex;gap:10px;justify-content:center;align-items:center">
        ${c.locked ? '<span style="padding:0 20px;font-size:13px;color:' + su + '">已锁定</span>' :
          `<button class="counter-btn minus" data-idx="${i}" style="width:52px;height:52px;border-radius:16px;border:1px solid ${bd};background:${cb};color:${tx};font-size:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;user-select:none" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color=''">−</button>
          <button class="step-btn" data-idx="${i}" style="background:none;border:1px solid ${bd};color:${su};font-size:13px;padding:8px 12px;border-radius:10px;cursor:pointer;white-space:nowrap;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color=''">步长 ${c.step}</button>
          <button class="counter-btn plus" data-idx="${i}" style="width:52px;height:52px;border-radius:16px;border:none;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;font-size:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;user-select:none;box-shadow:0 4px 16px var(--primary-glow)" onmouseover="this.style.transform='scale(1.06)'" onmouseout="this.style.transform=''">+</button>`}
      </div>
    </div>`).join('')}
  </div>
</div>

<div id="cp" style="position:fixed;top:0;right:0;width:280px;max-width:85vw;height:100vh;background:${cb};z-index:1000;transform:translateX(100%);transition:transform .3s;box-shadow:-8px 0 30px rgba(0,0,0,.12);padding:24px;overflow-y:auto">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
    <h3 style="color:${tx};margin:0;font-size:18px;font-weight:700">设置</h3>
    <button id="pc" style="background:none;border:none;font-size:22px;cursor:pointer;color:${su};transition:all .15s" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color=''">×</button>
  </div>
  <label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bd};cursor:pointer">
    <span style="color:${tx};font-size:14px">🌙 深色模式</span>
    <input type="checkbox" id="cd" ${this._isDark() ? 'checked' : ''}>
  </label>
  <label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bd};cursor:pointer">
    <span style="color:${tx};font-size:14px">🔊 声音反馈</span>
    <input type="checkbox" id="csd" ${this.soundOn ? 'checked' : ''}>
  </label>
  <label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bd};cursor:pointer">
    <span style="color:${tx};font-size:14px">📳 震动反馈</span>
    <input type="checkbox" id="cv" ${this.vibrateOn ? 'checked' : ''}>
  </label>
  <label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bd};cursor:pointer;gap:12px">
    <span style="color:${tx};font-size:14px;flex-shrink:0">🎯 目标值</span>
    <input type="number" id="cg" min="0" step="1" value="${activeCounter.goal || 0}" placeholder="0=不设"
      style="width:120px;padding:7px 10px;border-radius:8px;border:1px solid ${bd};background:var(--bg-tertiary);color:${tx};font-size:13px;outline:none"
      onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'">
  </label>
  <label style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bd};cursor:pointer;gap:12px">
    <span style="color:${tx};font-size:14px;flex-shrink:0">🎨 卡片颜色</span>
    <input type="color" id="cc" value="${activeCounter.color || this._primaryColor()}"
      style="width:48px;height:32px;padding:2px;border-radius:8px;border:1px solid ${bd};background:none;cursor:pointer">
  </label>
  <button id="mf" style="width:100%;margin-top:16px;padding:12px;border-radius:12px;border:1px solid ${bd};background:var(--bg-tertiary);color:${tx};font-size:14px;cursor:pointer;font-weight:500;transition:all .15s"
    onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border)';this.style.color=''">🧘 专注模式</button>
</div>
<div id="co" style="position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:999;display:none;backdrop-filter:blur(2px)"></div>`;
  }

  _bindMain() {
    const r = this.root;
    this.counters.forEach((c, i) => {
      const card = r.querySelector(`.counter-card[data-sidx="${i}"]`);
      if (!card) return;
      card.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.classList.contains('counter-name') || e.target.classList.contains('step-btn')) return;
        this.activeIdx = i;
        this._updateValue(i, c.step);
      });
      const plus = card.querySelector('.counter-btn.plus');
      if (plus) {
        plus.addEventListener('pointerdown', e => {
          e.stopPropagation(); e.preventDefault();
          this._updateValue(i, c.step);
          this._repeatTimer = setInterval(() => this._updateValue(i, c.step), 150);
        });
        const clear = () => clearInterval(this._repeatTimer);
        plus.addEventListener('pointerup', clear);
        plus.addEventListener('pointerleave', clear);
      }
      const minus = card.querySelector('.counter-btn.minus');
      if (minus) {
        minus.addEventListener('pointerdown', e => {
          e.stopPropagation(); e.preventDefault();
          this._updateValue(i, -c.step);
          this._repeatTimer = setInterval(() => this._updateValue(i, -c.step), 150);
        });
        const clear = () => clearInterval(this._repeatTimer);
        minus.addEventListener('pointerup', clear);
        minus.addEventListener('pointerleave', clear);
      }
      card.querySelector('.counter-val')?.addEventListener('click', e => {
        e.stopPropagation();
        this._updateValue(i, c.step);
      });
      card.querySelector('.step-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (c.locked) return;
        const steps = [1, 5, 10];
        const si = steps.indexOf(c.step);
        if (si >= 0 && si < steps.length - 1) c.step = steps[si + 1];
        else {
          const v = parseInt(prompt('输入自定义步长（正整数）:', String(c.step)) || '');
          c.step = (v > 0 && v <= 10000) ? v : 1;
        }
        this._saveData();
        this.render();
      });
      const nm = card.querySelector('.counter-name');
      if (nm) {
        nm.addEventListener('click', e => e.stopPropagation());
        nm.addEventListener('blur', () => {
          const v = nm.textContent?.trim();
          if (v && v !== this.counters[i]?.name) {
            this.counters[i].name = v;
            this._saveData();
            this.render();
          } else if (!v) {
            nm.textContent = this.counters[i]?.name || '计数器';
          }
        });
        nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
      }
    });

    r.querySelector('#mh')?.addEventListener('click', () => { this.showHelp = !this.showHelp; this.render(); });
    r.querySelector('#hc')?.addEventListener('click', () => { this.showHelp = false; this.render(); });
    r.querySelector('#ml')?.addEventListener('click', () => {
      const c = this.counters[this.activeIdx];
      if (c) { c.locked = !c.locked; this._saveData(); this.render(); }
    });

    const p = r.querySelector('#cp'), o = r.querySelector('#co');
    const op = () => { this.drawerOpen = true; if (p) p.style.transform = 'translateX(0)'; if (o) o.style.display = 'block'; };
    const cp = () => { this.drawerOpen = false; if (p) p.style.transform = 'translateX(100%)'; if (o) o.style.display = 'none'; };
    r.querySelector('#ms')?.addEventListener('click', op);
    r.querySelector('#pc')?.addEventListener('click', cp);
    o?.addEventListener('click', cp);

    r.querySelector('#cd')?.addEventListener('change', e => {
      this._setGlobalTheme(e.target.checked);
      this._saveData();
    });
    r.querySelector('#csd')?.addEventListener('change', e => { this.soundOn = e.target.checked; this._saveData(); });
    r.querySelector('#cv')?.addEventListener('change', e => { this.vibrateOn = e.target.checked; this._saveData(); });

    const cg = r.querySelector('#cg');
    if (cg) cg.addEventListener('change', e => {
      const c = this.counters[this.activeIdx];
      if (c) { c.goal = Math.max(0, parseInt(e.target.value) || 0); this._saveData(); this.render(); }
    });
    const cc = r.querySelector('#cc');
    if (cc) cc.addEventListener('input', e => {
      const c = this.counters[this.activeIdx];
      if (c) { c.color = e.target.value; this._saveData(); this.render(); }
    });

    r.querySelector('#mf')?.addEventListener('click', () => {
      this.focusMode = true;
      cp();
      this.render();
    });
  }

  _bindFocusMode() {
    const r = this.root;
    const area = r.querySelector('#focus-area');
    const close = r.querySelector('#focus-close');
    const val = r.querySelector('#focus-val');
    close?.addEventListener('click', e => {
      e.stopPropagation();
      this.focusMode = false;
      this.render();
    });
    const add = e => {
      if (e.target.closest('#focus-close')) return;
      const ci = this.activeIdx;
      const c = this.counters[ci];
      if (!c || c.locked) return;
      this._updateValue(ci, c.step || 1);
    };
    area?.addEventListener('click', add);
    val?.addEventListener('click', e => { e.stopPropagation(); add(e); });
  }

  _bindSidebar() {
    const r = this.root;
    r.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
      this.sidebarOpen = !this.sidebarOpen;
      this.render();
    });
    r.querySelectorAll('.sidebar-item').forEach((el, i) => {
      el.addEventListener('click', () => { this.activeIdx = i; this.render(); });
    });
    r.querySelector('#sa')?.addEventListener('click', () => {
      const n = prompt('输入新计数器名称:', `计数器 ${this.counters.length + 1}`);
      if (!n?.trim()) return;
      const cols = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#FDCB6E', '#E84393', '#00CEC9'];
      const primary = this._primaryColor().toUpperCase();
      const baseColor = cols.includes(primary) ? primary.toLowerCase() : cols[this.counters.length % cols.length];
      this.counters.push({
        id: 'c' + Date.now(),
        name: n.trim(),
        value: 0, step: 1,
        color: baseColor,
        goal: 0, locked: false, lastModified: null
      });
      this.activeIdx = this.counters.length - 1;
      this._saveData();
      this.render();
    });

    r.querySelector('#se')?.addEventListener('click', () => {
      const b = new Blob([JSON.stringify({ counters: this.counters }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'counters_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    });
    r.querySelector('#si')?.addEventListener('click', () => document.getElementById('cif')?.click());
    r.querySelector('#cif')?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          if (d.counters?.length) {
            this.counters = d.counters;
            this.counters.forEach(c => {
              if (!c.lastModified) c.lastModified = null;
              if (c.locked === undefined) c.locked = false;
              if (!c.color) c.color = this._primaryColor();
            });
            this._saveData();
            this.render();
          }
        } catch { this.toast.show('文件格式错误', 'error'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });
    r.querySelector('#sr')?.addEventListener('click', () => {
      this.counters.forEach(c => { c.value = 0; c.lastModified = null; });
      this._saveData();
      this.render();
    });
    r.querySelector('#sda')?.addEventListener('click', () => {
      this.counters = [{ id: 'c1', name: '计数器 1', value: 0, step: 1, color: this._primaryColor(), goal: 0, locked: false, lastModified: null }];
      this.activeIdx = 0;
      this._saveData();
      this.render();
    });
  }

  _updateValue(i, delta) {
    const c = this.counters[i];
    if (!c || c.locked) return;
    c.value += delta;
    if (c.value < 0) c.value = 0;
    c.lastModified = Date.now();
    this._saveData();
    this._feedback();
    if (this.focusMode) {
      const fv = this.root.querySelector('#focus-val');
      if (fv) {
        fv.textContent = c.value.toLocaleString();
        fv.style.transform = 'scale(1.08)';
        setTimeout(() => { if (fv) fv.style.transform = 'scale(1)'; }, 120);
      }
    } else {
      const ve = this.root.querySelector(`.counter-val[data-idx="${i}"]`);
      if (ve) {
        ve.textContent = c.value.toLocaleString();
        ve.style.transform = 'scale(1.12)';
        setTimeout(() => { if (ve) ve.style.transform = 'scale(1)'; }, 120);
      }
      const te = this.root.querySelector(`.counter-card[data-sidx="${i}"] .counter-time`);
      if (te) te.textContent = '上次计数 ' + this._fmtTime(c.lastModified);
      const items = this.root.querySelectorAll('.sidebar-item');
      const de = items[i]?.querySelectorAll('span')[2];
      if (de) de.textContent = String(c.value);
    }
    if (c.goal > 0 && c.value >= c.goal) {
      this.toast.show('🎯 达成目标 ' + c.goal + '！', 'success');
      if (this.soundOn) this._beep(600, .15);
    }
  }

  _feedback() {
    if (this.soundOn) this._beep(800, .05);
    if (this.vibrateOn && navigator.vibrate) navigator.vibrate(15);
  }

  _beep(f, d) {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(.1, c.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, c.currentTime + d);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + d);
    } catch {}
  }

  _bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (!document.getElementById('page-counter')?.classList.contains('active')) return;
      if (this.focusMode) {
        const ci = this.activeIdx;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this._updateValue(ci, this.counters[ci]?.step || 1);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this._updateValue(ci, -(this.counters[ci]?.step || 1));
        else if (e.key === 'Escape') { this.focusMode = false; this.render(); }
        return;
      }
      if (e.key === 'ArrowUp') { this._updateValue(this.activeIdx, this.counters[this.activeIdx]?.step || 1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this._updateValue(this.activeIdx, -(this.counters[this.activeIdx]?.step || 1)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { this.activeIdx = Math.min(this.activeIdx + 1, this.counters.length - 1); this.render(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.activeIdx = Math.max(this.activeIdx - 1, 0); this.render(); e.preventDefault(); }
    });
  }
}
