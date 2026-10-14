/**
 * Changelog — 版本更新弹窗
 * 仅在新版本首次打开时展示一次（localStorage 记录已看过的版本号）
 */
export class Changelog {
  static VERSION = '1.1.0';
  static STORE_KEY = 'pk_changelog_v';

  constructor() {
    this.entries = [
      {
        version: '1.1.0',
        date: '2026-08-05',
        title: 'PixelKit v1.1.0',
        highlight: '新增「竹知了」与「任务总结」，一起回顾你的工作轨迹',
        items: [
          { tag: '新增', color: '#10b981', text: '🪀 竹知了：传统竹蝉玩具模拟，按住画圈甩起来，一转就哇哇叫' },
          { tag: '新增', color: '#10b981', text: '📊 任务总结：每日/每周回顾已完成任务，日历视图 + 统计图表' },
          { tag: '新增', color: '#10b981', text: '📋 任务看板：支持自定义状态列，按需管理你的工作流' },
          { tag: '优化', color: '#3b82f6', text: '🎨 首页卡片按最新功能排序，新功能优先展示' },
          { tag: '修复', color: '#f97316', text: '🐛 修复任务完成时间在凌晨时归入前一天的统计问题' },
        ],
      },
    ];
  }

  /** 新版本首次打开时展示弹窗（"知道了"永久记住；"稍后再说"本次会话内不再打扰） */
  maybeShow() {
    try {
      if (localStorage.getItem(Changelog.STORE_KEY) === Changelog.VERSION) return;
      if (sessionStorage.getItem(Changelog.STORE_KEY) === Changelog.VERSION) return;
    } catch (_) { return; }
    this.render();
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  render() {
    const entry = this.entries.find(e => e.version === Changelog.VERSION) || this.entries[0];
    if (!entry) return;

    const overlay = document.createElement('div');
    overlay.className = 'clg-overlay';
    overlay.innerHTML = `
      <div class="clg-card" role="dialog" aria-modal="true" aria-labelledby="clg-title">
        <div class="clg-header">
          <div class="clg-head-info">
            <div class="clg-badge">更新日志</div>
            <h2 class="clg-title" id="clg-title">${this._esc(entry.title)}</h2>
          </div>
          <button class="clg-close" title="关闭" aria-label="关闭">✕</button>
        </div>
        <div class="clg-body">
          <p class="clg-highlight">${this._esc(entry.highlight)}</p>
          <ul class="clg-list">
            ${entry.items.map(it => `
              <li>
                <span class="clg-tag" style="color:${it.color}">${this._esc(it.tag)}</span>
                <span class="clg-txt">${this._esc(it.text)}</span>
              </li>`).join('')}
          </ul>
        </div>
        <div class="clg-footer">
          <span class="clg-version">v${this._esc(entry.version)}</span>
          <button class="clg-btn clg-btn-secondary" data-act="later">稍后再说</button>
          <button class="clg-btn" data-act="ok">知道了</button>
        </div>
      </div>`;

    const dismiss = (remember) => {
      overlay.classList.add('clg-hide');
      if (remember) {
        try { localStorage.setItem(Changelog.STORE_KEY, Changelog.VERSION); } catch (_) {}
      } else {
        // "稍后再说"：本次会话内不再弹（刷新页面也不弹），下次打开浏览器再看
        try { sessionStorage.setItem(Changelog.STORE_KEY, Changelog.VERSION); } catch (_) {}
      }
      setTimeout(() => overlay.remove(), 300);
    };

    // 点击遮罩空白处 = "知道了"（避免全屏遮罩挡住页面操作，让用户无从关闭）
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(true); });
    overlay.querySelector('.clg-close').addEventListener('click', () => dismiss(true));
    overlay.querySelector('.clg-btn[data-act="ok"]').addEventListener('click', () => dismiss(true));
    overlay.querySelector('.clg-btn[data-act="later"]').addEventListener('click', () => dismiss(false));
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(true); });
    const card = overlay.querySelector('.clg-card');
    card.focus();
    card.tabIndex = -1;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('clg-show'));
  }
}
