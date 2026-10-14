/**
 * 首页改版增强：工具搜索 + 分组筛选
 *
 * 只操作 DOM 的显隐与文案，不碰任何路由逻辑。
 * 卡片点击切页仍由 main.js 的 setupRouting() 负责。
 */

const cards = Array.from(document.querySelectorAll('#home-groups .home-card'));
const groups = Array.from(document.querySelectorAll('#home-groups .tool-group'));
const tabs = Array.from(document.querySelectorAll('#home-tabs .home-tab'));
const input = document.getElementById('home-search');
const empty = document.getElementById('home-empty');

if (cards.length && input && tabs.length) {
  let activeFilter = 'all';

  const isVisible = (el) => !el.hidden;

  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;

    cards.forEach((card) => {
      const group = card.closest('.tool-group');
      const gid = group ? group.dataset.group : '';
      const hitGroup = activeFilter === 'all' || gid === activeFilter;
      const hitQuery = !q || card.textContent.toLowerCase().includes(q);
      const ok = hitGroup && hitQuery;
      card.hidden = !ok;
      if (ok) shown++;
    });

    groups.forEach((group) => {
      const all = Array.from(group.querySelectorAll('.home-card'));
      const vis = all.filter(isVisible).length;
      group.hidden = vis === 0;

      const label = group.querySelector('.tool-group-head span');
      if (label) {
        const filtering = q || activeFilter !== 'all';
        label.textContent = filtering && vis !== all.length
          ? `${vis} / ${all.length} 个工具`
          : `${all.length} 个工具`;
      }
    });

    if (empty) empty.classList.toggle('is-visible', shown === 0);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.filter;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      apply();
    });
  });

  input.addEventListener('input', apply);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      apply();
    }
  });

  // 从其它页面返回首页时，保持筛选状态不残留
  window.addEventListener('pk-goto', () => {
    if (input.value) {
      input.value = '';
      apply();
    }
  });
}
