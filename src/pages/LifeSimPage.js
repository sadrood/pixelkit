import { GW } from './life/gongwuyuan.js';
import { RSBT } from './life/rensheng_baitai.js';
import { CY } from './life/chuangyezhe.js';
import { BOOK } from './life/rensheng_zhishu.js';

// 小说流：结局散文是否接入大模型润色（1=开，结算调 /api/agent/book-ai；0=关，纯前端完整可玩）
const LIFE_BOOK_AI = 1;

// 剧本清单：扁平一层（不再分「玩法包」，避免为单剧本多穿一层点击）。
// 每个字都是一部可玩的人生；group 只用于在界面上分组显示。
// page 字段的条目不在本页引擎内运行，而是跳转到对应页面（如《人生之书》加厚版）。
const SCRIPTS = [
  {
    id: 'rsbt', group: '全景人生', data: RSBT,
    tag: '百态一生 · 高随机',
    desc: '1990 年小城出生，从童年走到暮年。属性：心态/体格/机遇/学识/人际。',
  },
  {
    id: 'gw', group: '职业人生', data: GW,
    tag: '公务员 · 上岸到厅处',
    desc: '2001 年重生，端稳体制这碗饭。属性：笔杆子/会来事/酒量体能/廉洁定力/考运/人脉。',
  },
  {
    id: 'cy', group: '职业人生', data: CY,
    tag: '创业 · 白手起家',
    desc: '2005 年揣着几千块进城，从摆摊打工到身家千万。属性：商业头脑/口才/体能/抗压/技术/人脉。',
  },
  {
    id: 'zhishu', group: '文学人生', data: BOOK,
    tag: '《人生之书》· 灯与雪',
    desc: '一九九三年雪夜出生，走过巷子与水井、绿皮火车与凌晨三点的厨房。你点过很多灯，也熄过几盏。',
  },
  {
    id: 'pkb', group: '文学人生', page: 'book',
    title: '人生之书 · 玩法加厚版', tag: '五条世界线 · 灯谱',
    desc: '小城浮世 / 赛博·霓虹井 / 仙侠·照心灯 / 民国·雪与刀 / 校园·十七岁的灯。五维属性 + 18 盏灯谱 + 随机人生事件 + 抉择锁 + 12 结局 + 二周目回响。',
  },
];
const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
const money = (n) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + ' 万';
  return v.toLocaleString('zh-CN') + ' 元';
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 属性图标（跨剧本通用，key 覆盖不到就用圆点）
const ATTR_ICONS = {
  pen: '✍️', so: '🗣️', vita: '🍶', clean: '🧭', exam: '📝', guanxi: '🤝',
  shang: '🧮', kou: '💬', tili: '🏃', xin: '🧱', jishu: '💻', renmai: '🌐',
  psy: '🧠', body: '💪', opp: '🎲', int: '📚', soc: '☕',
};
const attrLevel = (v) => (v >= 67 ? 'hi' : v >= 34 ? 'mid' : 'lo');
// 档位文字：让「颜色=高低」这层含义可读（避免被当成类别色）
const LV_TEXT = { hi: '优', mid: '中', lo: '低' };
// 结局等级：S 最好 → D 最差；用于 pill 配色与「结局收集」排序
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];
const TIER_DESC = {
  S: 'S 级 · 极少数人才能走到的一生',
  A: 'A 级 · 稳稳站住了脚的一生',
  B: 'B 级 · 认真活过、没掉队的一生',
  C: 'C 级 · 平凡但完整的一生',
  D: 'D 级 · 中途塌方的一生',
};
const TIER_COLOR = { S: '#fbbf24', A: '#a78bfa', B: '#22d3ee', C: '#94a3b8', D: '#f04860' };
// 成就块的图标（按各剧本 achievements 的书写顺序取用）
const ACH_ICONS = ['🌱', '🏙️', '💼', '🧑‍💼', '🏠', '💰', '💪', '🌤️', '🧓', '🍚', '🧭', '🎓'];

export class LifeSimPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
    this.SC = null;
    this._sidePref = null;
  }
  init() {
    if (this._inited) return;
    this._inited = true;
    this.root = document.getElementById('lifesim-root');
    if (!this.root) return;
    this._achUnlocked = new Set();
    this._renderShell();
    this._showScriptSelect();
  }

  _state() {
    return {
      stageIdx: 0, roundIn: 0, year: this.SC.startYear,
      attrs: {}, money: 0, health: 85, happy: 60,
      status: new Set(), usedBig: new Set(), flags: {},
      actionLeft: 0, smallUsed: false, log: [], bg: null, cheat: null, payBase: null,
    };
  }

  // ---------- 外层壳 ----------
  _renderShell() {
    this.root.innerHTML = `
      <div class="life-wrap">
        <div class="life-topbar">
          <div class="life-topmeta">
            <span id="life-stage" class="life-stage-badge"></span>
            <span id="life-year" class="life-year-big"></span>
          </div>
          <div class="life-stats">
            <div class="life-stat"><span class="life-stat-ic">💰</span><div class="life-stat-txt"><b id="life-money"></b><small>积蓄</small></div></div>
            <div class="life-stat"><span class="life-stat-ic" id="life-health-ic">🫀</span><div class="life-stat-txt"><b id="life-health"></b><small>健康</small></div></div>
            <div class="life-stat"><span class="life-stat-ic">😊</span><div class="life-stat-txt"><b id="life-happy"></b><small>幸福</small></div></div>
          </div>
        </div>
        <div class="life-main">
          <aside class="life-side" id="life-side"></aside>
          <section class="life-center" id="life-card"></section>
        </div>
        <details class="life-log" id="life-log-box">
          <summary>📜 最近履历 · 0 条</summary>
          <div id="life-log"></div>
        </details>
      </div>`;
    this._refreshTopbar();
    this._syncLogSummary();
  }

  // ---------- 剧本选择（扁平清单，仅按题材分组显示） ----------
  _showScriptSelect() {
    this.root.classList.remove('life-mode-book');
    this.root.classList.remove('life-ending-mode');
    // 还没选剧本：顶栏数值与左栏属性都没有内容，用 setup 态把它们收起来，避免出现空壳
    this.root.classList.add('life-mode-setup');
    const groups = [...new Set(SCRIPTS.map((s) => s.group))];
    const body = groups.map((g) => `
      <h4 class="life-script-group">${esc(g)}</h4>
      <div class="life-choice-grid">
        ${SCRIPTS.map((s, i) => ({ s, i })).filter(({ s }) => s.group === g).map(({ s, i }) => `
          <button class="life-option-card" data-script="${i}">
            <b>${esc(s.page ? s.title : s.data.title)}</b>
            <small>${esc(s.page ? '' : s.data.tagline)}</small>
            <em class="life-script-tag">${esc(s.tag)}</em>
            <small class="life-script-desc">${esc(s.desc)}</small>
            ${s.page ? '<small class="life-script-jump">独立页面玩法 →</small>' : ''}
          </button>`).join('')}
      </div>`).join('');
    this._card(`
      <div class="life-setup-head">🌱 成长模拟器 · 选一套人生</div>
      <p class="life-tagline">一套引擎，${SCRIPTS.length} 套人生。每一部都是一条截然不同的命运；不想挑，也可以直接随机投胎。</p>
      ${body}
      <button class="btn btn-primary" id="life-random">🎲 不选了，直接随机开一局</button>`);
    this._cardEl.querySelectorAll('[data-script]').forEach((b) =>
      b.addEventListener('click', () => this._pickScript(parseInt(b.dataset.script))));
    const rnd = document.getElementById('life-random');
    if (rnd) rnd.addEventListener('click', () => this._randomStart());
  }

  /** 随机投胎：只抽本页引擎内的剧本（page 型条目会跳走页面，随机时排除更顺滑） */
  _randomStart() {
    const pool = SCRIPTS.filter((s) => !s.page);
    this.SC = pick(pool).data;
    this._enterScript();
  }

  // 数值剧本 → 投胎开局；chapter 剧本 → 翻书开局
  _enterScript() {
    this._achUnlocked = new Set(JSON.parse(localStorage.getItem('lifesim_ach_' + this.SC.id) || '[]'));
    this.root.classList.remove('life-ending-mode');
    if (this.SC.type === 'chapter') this._bookStart();
    else this._birthRoll();
  }

  _pickScript(i) {
    const s = SCRIPTS[i];
    if (!s) return;
    // page 型条目（如《人生之书》加厚版）走独立页面，交给外壳路由切换
    if (s.page) { window.dispatchEvent(new CustomEvent('pk-goto', { detail: s.page })); return; }
    this.SC = s.data;
    this._enterScript();
  }

  _stage() { return this.SC.stages[this._s.stageIdx]; }

  _refreshTopbar() {
    if (!this._s) return;
    const el = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    const s = this._s;
    if (this.SC.type === 'chapter') {
      const total = this.SC.chapters.length;
      el('life-year', `${this.SC.chapters[s.chIdx]?.t.split(' · ')[0] || ''}`);
      el('life-stage', `《${this.SC.title}》 · ${Math.min(s.chIdx + 1, total)}/${total}`);
      return;
    }
    el('life-year', `${s.year}`);
    el('life-stage', `${this._stage().label}`);
    el('life-money', money(s.money));
    const hc = s.health >= 80 ? '🟢' : s.health >= 50 ? '🟡' : '🔴';
    const hi = document.getElementById('life-health-ic');
    if (hi) hi.textContent = hc;
    el('life-health', Math.round(s.health));
    el('life-happy', Math.round(s.happy));
  }

  _log(text) {
    const s = this._s;
    if (this.SC.type === 'chapter') {
      const ch = this.SC.chapters[Math.min(s.chIdx, this.SC.chapters.length - 1)];
      const [no, ...sub] = (ch && ch.t.split(' · ')) || ['', ''];
      s.log.push({ year: no, stage: sub.join(' · '), text });
    } else {
      s.log.push({ year: this._s.year, stage: this._stage().label, text });
    }
    const el = document.getElementById('life-log');
    if (el) {
      el.innerHTML = s.log.slice(-40).map((l) =>
        `<div class="life-log-item"><span class="life-log-year">${l.year}</span><b>${esc(l.stage)}</b> ${esc(l.text)}</div>`).join('');
      el.scrollTop = el.scrollHeight;
    }
    this._syncLogSummary();
  }

  // 履历折叠标题：带箭头（CSS）与条数，避免「一条细线，不知道能点」
  _syncLogSummary() {
    const el = document.querySelector('#life-log-box summary');
    if (!el) return;
    const n = this._s && this._s.log ? this._s.log.length : 0;
    const title = this.SC ? this.SC.title : '人生模拟';
    el.textContent = `📜 最近履历（${title}） · ${n} 条`;
  }

  // 左栏是否收起：终局默认收起（把位置让给成就与履历）；玩家手动切过就听玩家的
  _sideIsCollapsed() {
    if (this._sidePref !== null && this._sidePref !== undefined) return this._sidePref;
    return this.root && this.root.classList.contains('life-ending-mode');
  }

  _bindSideToggle() {
    const b = document.getElementById('life-side-toggle');
    if (b) b.addEventListener('click', () => {
      this._sidePref = !this._sideIsCollapsed();
      this._renderSide();
    });
  }

  _renderSide() {
    const side = document.getElementById('life-side');
    if (!side) return;
    if (this.SC.type === 'chapter') { side.classList.remove('is-collapsed'); return this._renderLampSide(side); }
    const collapsed = this._sideIsCollapsed();
    if (collapsed) { side.classList.add('is-collapsed'); } else { side.classList.remove('is-collapsed'); }
    if (this.root) {
      if (collapsed) this.root.classList.add('life-side-collapsed');
      else this.root.classList.remove('life-side-collapsed');
    }
    const head = `<div class="life-side-head">
        <span class="life-side-head-title">这一生</span>
        <button class="life-side-toggle" id="life-side-toggle" title="${collapsed ? '展开属性与身份' : '收起，把位置让给结局与履历'}">${collapsed ? '▸' : '▾ 收起'}</button>
      </div>`;
    if (collapsed) {
      side.innerHTML = head;
      this._bindSideToggle();
      return;
    }
    const s = this._s;
    const attrRows = Object.entries(this.SC.attrMeta).map(([k, m]) => {
      const v = clamp(s.attrs[k] || 0, 0, 100);
      const lv = attrLevel(v);
      return `<div class="life-attr" data-attr="${k}">
        <span class="life-attr-name" title="${m.label} · ${LV_TEXT[lv]}（${Math.round(v)}/100）">${ATTR_ICONS[k] || '·'}<i>${m.label}</i><em class="life-attr-lv lv-${lv}">${LV_TEXT[lv]}</em></span>
        <div class="life-attr-track"><i class="lv-${lv}" style="width:${v}%"></i></div>
        <b>${Math.round(v)}</b></div>`;
    }).join('');
    const chips = s.status.size
      ? [...s.status].map((k) => {
        const d = this._def(k);
        return `<span class="life-chip" title="${esc(d?.desc || '')}">${esc(d?.label || k)}${d?.danger ? ' ⚠' : ''}</span>`;
      }).join('')
      : '<span class="life-muted">— 暂无状态</span>';
    side.innerHTML = head + `<h4 class="life-side-title">个人属性</h4>${attrRows}
      <h4 class="life-side-title" style="margin-top:12px">身份 · 状态</h4><div class="life-chips">${chips}</div>
      <p class="life-side-note">进度条颜色即高低：<b class="lv-hi">绿优</b> · <b class="lv-mid">黄中</b> · <b class="lv-lo">红低</b></p>`;
    this._bindSideToggle();
  }

  // ================= 小说流（人生之书 · chapter 引擎） =================
  // 整章散文 → 章末抉择 → 灯谱结算。灯 ≥2 格才算点亮；隐藏结局须六盏主灯全亮。
  _bookLamps() {
    if (this._lampOrder) return this._lampOrder;
    const seen = [];
    const add = (k) => { if (!seen.includes(k)) seen.push(k); };
    for (const ch of this.SC.chapters) {
      for (const o of (ch.choice && ch.choice.opts) || []) Object.keys(o.light || {}).forEach(add);
    }
    (this.SC.hiddenLamps || []).forEach(add);
    this._lampOrder = seen;
    return seen;
  }
  _litLamps() {
    const c = this._s.lights || {};
    return Object.keys(c).filter((k) => (c[k] || 0) >= 2);
  }
  _lightDelta(light = {}) {
    return Object.entries(light).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' · ');
  }
  // 性别双版取文：字符串原样返回，数组 [男版, 女版] 按所生性别取
  _vt(x) { return Array.isArray(x) ? x[this._s.g === 'f' ? 1 : 0] : x; }
  // {名} → 随机抽到的名字
  _tk(x) { return String(x).split('{名}').join(this._s.given); }
  _genderLabel() { return this._s.g === 'f' ? '闺女' : '小子'; }
  _renderLampSide(side) {
    const c = this._s.lights || {};
    const order = this._bookLamps();
    const hidden = this.SC.hiddenLamps || [];
    const litOn = (k) => (c[k] || 0) >= 2;
    const litAll = this._litLamps().length;
    const mainOn = hidden.filter(litOn).length;
    const chips = order.map((k) => `
      <span class="life-lamp${litOn(k) ? ' on' : ''}${hidden.includes(k) ? ' main' : ''}" title="${hidden.includes(k) ? '主灯' : ''}${litOn(k) ? ' · 已点亮' : ''}">${esc(k)}<i>${c[k] || 0}</i></span>`).join('');
    side.innerHTML = `
      <h4 class="life-side-title">灯谱</h4>
      <div class="life-lamps">${chips}</div>
      <p class="life-muted" style="font-size:11px;margin:8px 0 0">同一盏灯集满 2 格才算点亮；虚线框为主灯，点亮 ${Math.max(0, hidden.length - 1)}/${hidden.length} 盏或见未见之结局。</p>
      <p class="life-lamp-summary">点亮 <b>${litAll}</b> 盏 · 主灯 <b>${mainOn}</b>/${hidden.length}</p>`;
  }

  _bookStart() {
    this._lampOrder = null;
    this._s = { chIdx: 0, lights: {}, log: [] };
    // 出生随机：性别与姓名，天注定，玩家不挑（每次翻书都重新投胎）
    const names = this.SC.names || { s: ['陈'], m: ['志远'], f: ['婷婷'] };
    this._s.g = Math.random() < 0.5 ? 'm' : 'f';
    this._s.surname = pick(names.s);
    this._s.given = pick(this._s.g === 'f' ? names.f : names.m);
    this._s.fullName = this._s.surname + this._s.given;
    this.root.classList.add('life-mode-book');
    this.root.classList.remove('life-ending-mode');
    this.root.classList.remove('life-mode-setup');
    const nEnd = this.SC.endings.length;
    this._card(`
      <div class="life-book-cover">
        <div class="life-book-kicker">📖 互动小说 · 灯谱结局 ${nEnd} 种</div>
        <h2 class="life-book-title">《${esc(this.SC.title)}》</h2>
        <p class="life-book-era">${esc(this.SC.era)}</p>
        <p class="life-tagline">${esc(this.SC.tagline)}</p>
        <div class="life-book-rules">
          <p>翻开书，你会随机投胎：是男是女、叫什么名字，都天注定，由不得你挑。</p>
          <p>每一章，先读完整段人生；合上书页之前，做一次抉择。</p>
          <p>抉择会点亮或熄灭灯谱里的灯——同一盏灯集满 2 格，才算真正点亮。</p>
          <p>最后一页，灯谱会为这一生结算：<b>${this.SC.endings.map((e) => esc(e.label)).join(' · ')}</b>。</p>
        </div>
        <button class="btn btn-primary" id="life-book-open">翻开第一页，投胎去 →</button>
        <button class="btn" id="life-book-back">换个剧本</button>
      </div>`);
    this._cardEl.querySelector('#life-book-open').addEventListener('click', () => this._bookChapter(0));
    this._cardEl.querySelector('#life-book-back').addEventListener('click', () => this._showScriptSelect());
    this._refreshTopbar();
    this._renderLampSide(document.getElementById('life-side'));
  }

  _bookChapter(i) {
    const chs = this.SC.chapters;
    if (i >= chs.length) return this._bookEnding();
    this._s.chIdx = i;
    const ch = chs[i];
    const [no, ...sub] = ch.t.split(' · ');
    // 逐段错开淡入，营造"一句句读下去"的节奏（纯 CSS，不需要跳过逻辑，重玩也不烦）
    const prose = ch.prose.map((p, k) => `<p class="life-prose-line" style="animation-delay:${Math.min(k * 110, 900)}ms">${esc(this._tk(this._vt(p)))}</p>`).join('');
    // 序章页首：出生档案（随机性别 / 姓名）
    const registry = i === 0 ? `
      <div class="life-registry">
        <span class="life-registry-title">📄 出生档案</span>
        <span class="life-birth-chip">姓名 ${esc(this._s.fullName)}</span>
        <span class="life-birth-chip">${this._genderLabel() === '闺女' ? '♀ 闺女' : '♂ 小子'}</span>
        <span class="life-birth-chip">二〇〇一年腊月 · 小城</span>
      </div>` : '';
    let tail = '';
    if (ch.choice) {
      tail = `
        <div class="life-book-q">${esc(this._tk(this._vt(ch.choice.q)))}</div>
        <div class="life-choices life-book-choices">
          ${ch.choice.opts.map((o, k) => `
            <button class="life-choice" data-opt="${k}">
              <span class="life-idx">${k + 1}</span>
              <span class="life-choice-txt">${esc(this._tk(this._vt(o.a)))}</span>
              ${o.light ? `<small class="life-light-preview">灯 ${esc(this._lightDelta(o.light))}</small>` : ''}
            </button>`).join('')}
        </div>`;
    } else {
      tail = `<button class="btn btn-primary" id="life-book-next">${no === '序章' ? '翻开第一章 →' : '下一页 →'}</button>`;
    }
    this._card(`
      <div class="life-book-page">
        <div class="life-chap-no">${esc(no)}</div>
        <h3 class="life-book-sub">${esc(sub.join(' · '))}</h3>
        ${registry}
        <div class="life-prose">${prose}</div>
        ${tail}
      </div>`);
    if (ch.choice) {
      this._cardEl.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => this._bookChoose(i, parseInt(b.dataset.opt))));
    } else {
      this._cardEl.querySelector('#life-book-next').addEventListener('click', () => this._bookChapter(i + 1));
    }
    this._refreshTopbar();
    this._renderSide();
    const c = this._cardEl;
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  _bookChoose(i, k) {
    const ch = this.SC.chapters[i];
    const o = ch.choice.opts[k];
    if (!o) return;
    const aTxt = this._tk(this._vt(o.a));
    const thenTxt = this._tk(this._vt(o.then));
    const c = this._s.lights;
    Object.entries(o.light || {}).forEach(([lk, v]) => {
      c[lk] = Math.max(0, (c[lk] || 0) + v);
    });
    this._log(`抉择：${aTxt}`);
    if (o.light) this._log(`灯：${this._lightDelta(o.light)}`);
    this._card(`
      <div class="life-book-page">
        <div class="life-kicker">${ch.t.split(' · ')[0]} · 你的选择</div>
        <h3 class="life-book-sub">${esc(aTxt)}</h3>
        <div class="life-prose"><p>${esc(thenTxt)}</p></div>
        ${o.light ? `<div class="life-light-box">灯 ${esc(this._lightDelta(o.light))}</div>` : ''}
        <button class="btn btn-primary" id="life-book-next">${i + 1 >= this.SC.chapters.length ? '合上书，看结局 →' : '翻到下一页 →'}</button>
      </div>`);
    this._cardEl.querySelector('#life-book-next').addEventListener('click', () => this._bookChapter(i + 1));
    this._refreshTopbar();
    this._renderSide();
  }

  _bookEnding() {
    const c = this._s.lights;
    const deg = (k) => c[k] || 0;
    const hidden = this.SC.hiddenLamps || [];
    const main = Object.keys(c).sort((a, b) => deg(b) - deg(a))[0];
    const six = hidden.filter((k) => deg(k) >= 2).length;
    let key;
    if (six >= 6) key = 'hidden';
    else if (['孝', '守', '传'].includes(main) && deg(main) >= 3) key = 'zhizhang';
    else if (['路', '踮', '追', '远'].includes(main) && deg(main) >= 2) key = 'yuanxing';
    else if (['守', '暖', '诚', '桥'].includes(main) && deg(main) >= 2) key = 'shoudeng';
    else if (['欠', '藏'].includes(main)) key = 'queyi';
    else if (['念', '痴', '归', '滚'].includes(main) && deg(main) >= 2) key = 'dengxue';
    else key = 'shoudeng';
    const E = this.SC.endings.find((x) => x.key === key) || this.SC.endings[0];
    this._s.chIdx = this.SC.chapters.length - 1;
    this._log(`终局：${E.label}`);
    const endProse = this._tk(this._vt(E.prose));
    const litOn = this._litLamps();
    const litChips = this._bookLamps().filter((k) => litOn.includes(k)).map((k) =>
      `<span class="life-lamp on${hidden.includes(k) ? ' main' : ''}">${esc(k)}<i>${deg(k)}</i></span>`).join('');
    this._card(`
      <div class="life-book-page life-book-end">
        <div class="life-kicker">终章 · 灯谱落定</div>
        <h2 class="life-ending-title${key === 'hidden' ? ' life-ending-dark' : ''}">${esc(E.label)}</h2>
        <div class="life-prose"><p>${esc(endProse)}</p></div>
        ${litChips ? `<div class="life-light-box">这一生点亮的灯<br><span class="life-lamps">${litChips}</span></div>` : '<p class="life-muted">这一生，没有一盏灯亮到第二格。可你的日子，仍是暖的。</p>'}
        <blockquote class="life-epilogue">${esc(this.SC.epilogue)}</blockquote>
        <div class="life-ai-note" id="life-ai-note">✦ 页边的余墨……</div>
        <div class="life-end-actions">
          <button class="btn btn-primary" id="life-book-again">📖 再读一遍</button>
          <button class="btn" id="life-book-other">🔁 换个剧本</button>
          <button class="btn" id="life-book-log">📜 看完整履历</button>
        </div>
      </div>`);
    this._cardEl.querySelector('#life-book-again').addEventListener('click', () => this._bookStart());
    this._cardEl.querySelector('#life-book-other').addEventListener('click', () => this._showScriptSelect());
    this._cardEl.querySelector('#life-book-log').addEventListener('click', () => { const b = document.getElementById('life-log-box'); if (b) b.open = true; });
    this._refreshTopbar();
    this._renderSide();
    if (LIFE_BOOK_AI) this._bookAi(E, c);
  }

  // 结局页：接入大模型续写一页"页边余墨"（有明确加载态；失败优雅降级，纯前端仍完整可玩）
  _bookAi(E, lights, _autoRetried) {
    const el = document.getElementById('life-ai-note');
    // 不给出进行中反馈时，等待几秒会被当成"卡死"——先亮明状态
    if (el) {
      el.style.display = '';
      el.classList.add('is-loading');
      el.textContent = '✦ 正在为这一生添一句页边余墨…';
    }
    const settle = (text) => {
      const n = document.getElementById('life-ai-note');
      if (!n) return;
      n.classList.remove('is-loading');
      if (text) n.textContent = text;
      else n.style.display = 'none';   // 失败不留"永远在等"的假象
    };
    /* 上游是"按分钟窗口"的共享配额：服务端会把建议等待放进 retryAfterMs，
       等待不长（≤30s）就自动重试一次，玩家只会看到状态多停留一会儿，而不是失败。 */
    const retryLater = (wait) => {
      const ms = Number(wait) || 0;
      if (_autoRetried || ms <= 0 || ms > 30000) return false;
      const n = document.getElementById('life-ai-note');
      if (n) {
        n.style.display = '';
        n.classList.add('is-loading');
        n.textContent = `✦ 上游额度紧张，约 ${Math.round(ms / 1000)} 秒后自动重试…`;
      }
      setTimeout(() => this._bookAi(E, lights, true), ms + 400);
      return true;
    };
    /* 流式：服务端 book-ai 支持 stream:true（SSE delta/done/err），边收边渲染，
       避免结算散文要等十几秒时前端"半天没动静"；不支持流式则回落到一次性 JSON */
    const paint = (t) => {
      const n = document.getElementById('life-ai-note');
      if (!n) return;
      n.classList.remove('is-loading');
      n.textContent = t;
    };
    let acc = '';
    fetch('/api/agent/book-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId: this.SC.id, ending: E.key, label: E.label, lights, stream: true }),
    }).then((r) => {
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !r.body || !ct.includes('text/event-stream')) {
        return r.text().then((t) => {
          let j = null;
          try { j = t ? JSON.parse(t) : null; } catch { j = null; }
          if (j && j.ok && j.text) settle(String(j.text).trim());
          else if (!retryLater(j && j.retryAfterMs)) settle('');
        });
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '', ended = false;
      const pump = () => reader.read().then(({ value, done }) => {
        if (ended) return undefined;
        if (done) { ended = true; settle(acc.trim() || ''); return undefined; }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          let j = null;
          try { j = JSON.parse(s.slice(5).trim()); } catch { continue; }
          if (j && j.t) { acc += j.t; paint(acc); }
          else if (j && j.text) { acc = String(j.text); paint(acc); }
          else if (j && j.error) { ended = true; if (!retryLater(j.retryAfterMs)) settle(''); return undefined; }
        }
        return pump();
      });
      return pump().catch(() => settle(acc.trim() || ''));
    }).catch(() => settle(''));
  }

  // ---------- 开局：随机投胎（出生不由你选） ----------
  _startSetup() { this._birthRoll(); }

  _birthRoll() {
    this.root.classList.remove('life-mode-book');
    this.root.classList.remove('life-ending-mode');
    this.root.classList.add('life-mode-setup');
    this._s = this._state();
    // 出身随机：父母与家境，天注定（保留"重生也改不了出身"的无力感）
    const bg = pick(this.SC.backgrounds);
    Object.assign(this._s.attrs, { ...bg.init });
    this._s.money = bg.money;
    this._s.bg = bg.id;
    this._log(`投胎：${bg.label}（启动金 ${money(bg.money)}）`);
    // 天赋：从剧本天赋池里随机发 3 张，玩家挑 1 张（或都不要）——把唯一一次主动决策交给玩家
    const pool = (this.SC.cheats || []).filter((c) => c.id !== 'none');
    const dealt = [];
    const bag = pool.slice();
    while (dealt.length < 3 && bag.length) dealt.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    this._renderBirth(bg, dealt);
  }

  _renderBirth(bg, dealt) {
    const cards = dealt.map((c, i) => `
      <button class="life-option-card life-talent-card" data-talent="${i}">
        <b>${esc(c.label.replace(/（.*?）/, ''))}</b>
        <em class="life-script-tag">${esc((c.label.match(/（(.*?)）/) || [, '天赋'])[1] || '天赋')}</em>
        <small class="life-script-desc">${esc(c.desc || '')}</small>
      </button>`).join('');
    this._card(`
      <div class="life-kicker">投胎结果</div>
      <div class="life-setup-head">你出生在——${esc(bg.label)}</div>
      <p class="life-tagline">${esc(bg.desc)} 出身由天定，改不了；天赋这一项，让你自己挑。</p>
      <div class="life-birth-row">
        <div class="life-birth-chip">💰 启动金 ${money(bg.money)}</div>
        <div class="life-birth-chip">🎲 天赋三选一</div>
      </div>
      <h4 class="life-script-group">挑一样带在身上</h4>
      <div class="life-choice-grid">${cards}</div>
      <div class="life-end-actions">
        <button class="btn" id="life-no-talent">不要外挂，平凡开局 →</button>
        <button class="btn" id="life-switch">换个剧本</button>
      </div>`);
    this._cardEl.querySelectorAll('[data-talent]').forEach((b) =>
      b.addEventListener('click', () => this._takeTalent(dealt[parseInt(b.dataset.talent)])));
    const noneBtn = this._cardEl.querySelector('#life-no-talent');
    if (noneBtn) noneBtn.addEventListener('click', () => this._takeTalent(null));
    const sw = document.getElementById('life-switch');
    if (sw) sw.addEventListener('click', () => this._showScriptSelect());
  }

  /** 选定天赋（null = 不要外挂）后正式进入这一生 */
  _takeTalent(c) {
    this._s.cheat = c ? c.id : 'none';
    if (c && c.effect) this._applyEffect(c.effect);
    if (c && c.id === 'foresight') this._s.flags.foresight = true;
    this._log(c ? `天生天赋：${c.label.replace(/（.*?）/, '')}` : '选择白纸一张，不借外力');
    // 注意顺序：_stageStart 会重渲染侧栏，飘字必须放在它之后才不会被冲掉
    this._stageStart();
    if (c && c.effect) this._floatDeltas(c.effect);
  }

  // ---------- 阶段 / 行动 ----------
  _stageStart() {
    this.root.classList.remove('life-mode-setup');
    const s = this._s, st = this._stage();
    s.roundIn = 0;
    s.year = st.year[0];
    s.actionLeft = st.actionSlots;
    s.smallUsed = false;
    this._refreshAll();
    this._log(`进入${st.label}（${st.year[0]}—${st.year[1]}）`);
    if (s.actionLeft > 0) this._renderAction();
    else this._beginEventFlow();
  }

  _renderAction() {
    const s = this._s, st = this._stage();
    const usable = this.SC.actions.filter((a) => !a.stages || a.stages.includes(st.id));
    const list = usable.map((a, i) => {
      // 积蓄不够的行动直接置灰：旧实现仍可点，点完才弹一句 toast，等于让玩家白点一次
      const afford = !a.cost || s.money >= a.cost;
      return `
      <button class="life-action-btn${afford ? '' : ' is-locked'}" data-act="${i}" ${afford ? '' : 'disabled'}>
        <span class="life-act-name">${esc(a.label)}</span>
        <small>${esc(a.desc)}</small>
        <span class="life-act-cost">${a.cost ? '花费 ' + money(a.cost) : '免费'}</span>
        ${afford ? '' : '<span class="life-act-poor">积蓄不够</span>'}
      </button>`;
    }).join('');
    this._card(`
      <div class="life-kicker">${st.label} · 行动机会 ×${s.actionLeft}</div>
      <h3 class="life-card-title">${s.year} 年：在命运推着你走之前，你可以做点什么</h3>
      <div class="life-actions">${list}</div>
      <button class="btn life-stop-act" id="life-stop-act">停止行动，开始经历这一程 →</button>`);
    this._cardEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this._doAction(parseInt(b.dataset.act))));
    this._cardEl.querySelector('#life-stop-act').addEventListener('click', () => { s.actionLeft = 0; this._beginEventFlow(); });
  }

  _doAction(i) {
    const s = this._s, st = this._stage();
    const usable = this.SC.actions.filter((a) => !a.stages || a.stages.includes(st.id));
    const a = usable[i];
    if (!a || s.actionLeft <= 0) return;
    if (a.cost > 0 && s.money < a.cost) { this.toast?.show('囊中羞涩，付不起这笔开销', 'error'); return; }
    s.money -= a.cost;
    // 行动不再是固定加值：正向属性按 0.6~1.4 倍随机浮动，让"做不做、什么时候做"产生悬念
    const roll = 0.6 + Math.random() * 0.8;
    const eff = {};
    Object.entries(a.effect || {}).forEach(([k, v]) => {
      if (!v) return;
      eff[k] = this.SC.attrMeta[k] && v > 0 ? Math.max(1, Math.round(v * roll)) : v;
    });
    this._applyEffect(eff);
    s.actionLeft--;
    this._log(`行动：${a.label}${a.cost > 0 ? `（花费 ${money(a.cost)}）` : ''}`);
    this._refreshAll();
    // 飘字同时体现「行动收益」与「行动花费」，一次看清这笔账
    const shown = { ...eff };
    if (a.cost > 0) shown.money = (shown.money || 0) - a.cost;
    this._floatDeltas(shown);
    if (s.actionLeft > 0) this._renderAction();
    else this._beginEventFlow();
  }

  // ---------- 事件流 ----------
  _beginEventFlow() {
    const s = this._s, st = this._stage();
    if (s.roundIn >= st.rounds) {
      // 本阶段完成
      const years = Math.round(s.year);
      if (s.stageIdx + 1 >= this.SC.stages.length) return this._ending();
      s.stageIdx++;
      this._card(`
        <div class="life-kicker">阶段收官 · ${years} 年</div>
        <p class="life-story">${this._stageIntro(st.id, true)}</p>
        <button class="btn btn-primary" id="life-next-stage">进入下一程 →</button>`);
      this._cardEl.querySelector('#life-next-stage').addEventListener('click', () => this._stageStart());
      return;
    }
    // 小事件（每阶段至多一次）
    if (!s.smallUsed && s.roundIn > 0 && Math.random() < 0.35) {
      s.smallUsed = true;
      const sm = pick(this.SC.small);
      this._card(`
        <div class="life-kicker">随波逐流 · ${s.year} 年</div>
        <p class="life-story">${esc(sm.text)}</p>
        <button class="btn life-sm-ok" id="life-sm-ok">( 继续 )</button>`);
      this._cardEl.querySelector('#life-sm-ok').addEventListener('click', () => {
        this._applyEffect(sm.effect);
        this._log(sm.text);
        this._refreshAll();
        this._beginEventFlow();
      });
      return;
    }
    // 抽大事件（支持 cond：仅在条件满足时进入候选池）
    const sCond = s;
    const pool = this.SC.big.filter((e) => e.stage === st.id && !s.usedBig.has(e.id) && (!e.cond || e.cond(sCond)));
    let evt;
    if (s.roundIn === 0) evt = pool.find((e) => e.first) || pick(pool);
    else evt = pick(pool);
    if (!evt) {
      // 事件池已抽完：旧实现直接 s.roundIn = st.rounds 把整段跳过，玩家会觉得「这段人生空了」。
      // 改为用一轮平淡岁月填满，并带来小幅自然增减，节奏不断档。
      const drift = {};
      Object.keys(this.SC.attrMeta).forEach((k) => {
        if (Math.random() < 0.3) drift[k] = Math.random() < 0.6 ? 1 : -1;
      });
      this._applyEffect(drift);
      this._log(`${s.year} 年：没有大事发生，日子就这么过去了`);
      s.roundIn++;
      this._paySalary();
      this._refreshAll();
      this._floatDeltas(drift);
      return this._beginEventFlow();
    }
    s.usedBig.add(evt.id);
    // 年份推进（事件发生年份）
    const span = st.year[1] - st.year[0];
    const step = Math.max(1, Math.round(span / st.rounds));
    s.year = st.year[0] + Math.min(span, s.roundIn * step) + (Math.random() < 0.3 && s.roundIn < st.rounds - 1 ? 1 : 0);
    this._refreshTopbar();
    this._renderBigEvent(evt);
  }

  _renderBigEvent(evt) {
    const s = this._s;
    const opts = evt.choices.map((c, i) => {
      const ok = !c.need || c.need(s);
      return `<button class="life-choice${ok ? '' : ' life-choice-dis'}" data-opt="${i}" ${ok ? '' : 'disabled'}>
        <span class="life-idx">${i + 1}</span>
        <span class="life-choice-txt">${esc(c.text)}</span>${ok ? '' : '<small class="life-muted">( 条件不足 )</small>'}
      </button>`;
    }).join('');
    this._card(`
      <div class="life-card-head">
        <span class="life-chap">${this._stage().label}</span>
        <span class="life-chap-year">${s.year} 年</span>
      </div>
      <p class="life-story life-story-main">${esc(evt.text)}</p>
      <div class="life-choices">${opts}</div>`);
    this._cardEl.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => this._choose(evt, parseInt(b.dataset.opt))));
  }

  _choose(evt, i) {
    const s = this._s, c = evt.choices[i];
    if (!c || (c.need && !c.need(s))) return;
    this._applyEffect(c.effect);
    if (c.addStatus) c.addStatus.forEach((k) => s.status.add(k));
    if (c.removeStatus) c.removeStatus.forEach((k) => s.status.delete(k));
    if (c.flag) Object.assign(s.flags, c.flag);
    this._log(`抉择：${c.text}`);
    if (c.log) this._log(c.log);
    this._refreshAll();
    this._floatDeltas(c.effect);

    if (s.status.has('investigated')) return this._ending();

    const delta = this._describeChange(c);
    this._card(`
      <div class="life-kicker">${c.log ? '结果 · ' + s.year + ' 年' : '你做了选择'}</div>
      <p class="life-story">${esc(c.log || c.text)}</p>
      ${delta ? `<div class="life-delta">${delta}</div>` : ''}
      <button class="btn btn-primary" id="life-next">光阴荏苒 →</button>`);
    this._cardEl.querySelector('#life-next').addEventListener('click', () => {
      s.roundIn++;
      this._paySalary();
      this._beginEventFlow();
    });
  }

  // 发工资：有职级(在编)后，按最高职级年薪 × 经过的年数结算
  _annualSalary() {
    const s = this._s;
    for (const row of this.SC.income || []) {
      if (s.status.has(row.if)) return row.per;
    }
    return 0;
  }
  _paySalary() {
    const s = this._s;
    const annual = this._annualSalary();
    if (annual <= 0) { s.payBase = null; return; }
    if (s.payBase == null) s.payBase = s.year - 1;
    const years = Math.max(1, s.year - s.payBase);
    const pay = Math.round((annual * years) / 1000) * 1000; // 取整到千元，避免碎钱
    if (pay > 0) {
      s.money += pay;
      s.payBase = s.year;
      this._log(`💰 领取 ${years} 年工资 +${money(pay)}（年薪 ${money(annual)}）`);
      this._refreshTopbar();
    }
  }

  // ---------- 结算 ----------
  // 结局收集（跨周目，按剧本分别记录；用于「还有哪个结局没见过」）
  _endSeen() {
    try { return JSON.parse(localStorage.getItem('lifesim_end_' + this.SC.id) || '[]'); }
    catch (e) { return []; }
  }

  _ending() {
    const s = this._s;
    this.root.classList.add('life-ending-mode');
    this._refreshAll();
    const ending = this.SC.endings.find((e) => e.cond(s)) || this.SC.endings[this.SC.endings.length - 1];
    const tier = ending.tier || '';
    const unlocked = this.SC.achievements.filter((a) => a.cond(s));
    const before = this._achUnlocked.size;
    unlocked.forEach((a) => this._achUnlocked.add(a.id));
    localStorage.setItem('lifesim_ach_' + this.SC.id, JSON.stringify([...this._achUnlocked]));
    const newCnt = this._achUnlocked.size - before;

    const seen = this._endSeen();
    const isNewEnd = !!ending.id && !seen.includes(ending.id);
    if (isNewEnd) {
      seen.push(ending.id);
      localStorage.setItem('lifesim_end_' + this.SC.id, JSON.stringify(seen));
    }

    const badges = [...s.status].map((k) => this._def(k)?.label || k).join('、');

    // 成就：等宽小块（图标 + 名称），未解锁的也显示，才有收集欲
    const achGrid = this.SC.achievements.map((a, i) => {
      const got = this._achUnlocked.has(a.id);
      return `<span class="life-ach${got ? ' on' : ''}" title="${esc(a.label)}">${got ? ACH_ICONS[i % ACH_ICONS.length] : '◇'}<i>${esc(a.label)}</i></span>`;
    }).join('');

    // 结局收集：按等级排序，未解锁的显示为 ?，一眼看出还缺哪几个
    const endGrid = this.SC.endings
      .slice()
      .sort((x, y) => TIER_ORDER.indexOf(x.tier || 'C') - TIER_ORDER.indexOf(y.tier || 'C'))
      .map((e) => {
        const got = seen.includes(e.id);
        const t = e.tier || 'C';
        return got
          ? `<span class="life-end-pill on" data-tier="${t}" title="${esc(e.label)}">${t} · ${esc(e.label)}</span>`
          : `<span class="life-end-pill" title="尚未抵达">? · 未解锁</span>`;
      }).join('');

    this._card(`
      <div class="life-end-head">
        <div class="life-kicker">终局</div>
        <button class="life-end-log" id="life-detail" title="打开页面下方的人生履历">📜 看完整履历</button>
      </div>
      <div class="life-end-hero">
        <span class="life-tier" data-tier="${tier}" title="结局等级 ${tier}">${tier || '·'}</span>
        <h2 class="life-ending-title ${ending.dark ? 'life-ending-dark' : ''}">${esc(ending.label)}</h2>
      </div>
      <div class="life-tier-legend">结局等级 <b>${tier || '—'}</b>${TIER_DESC[tier] ? ' · ' + TIER_DESC[tier] : ''}${isNewEnd ? '<span class="life-new-tag">首次抵达</span>' : ''}</div>
      <p class="life-story">${esc(ending.story)}</p>
      <div class="life-ending-stats">
        <div>🏛 一生印记：${badges || '平凡一程'}</div>
        <div>💰 积蓄 ${money(s.money)} · 🫀 健康 ${Math.round(s.health)} · 😊 幸福 ${Math.round(s.happy)}</div>
      </div>
      <details class="life-end-block"${newCnt ? ' open' : ''}>
        <summary>🏆 成就 ${this._achUnlocked.size} / ${this.SC.achievements.length}${newCnt ? `　<span class="life-new-tag">新解锁 ${newCnt}</span>` : ''}</summary>
        <div class="life-ach-grid">${achGrid}</div>
      </details>
      <div class="life-end-block">
        <div class="life-end-block-head">🎯 结局收集 ${seen.length} / ${this.SC.endings.length}${isNewEnd ? '　<span class="life-new-tag">本局新解锁</span>' : ''}</div>
        <div class="life-end-grid">${endGrid}</div>
      </div>
      <div class="life-end-actions">
        <button class="btn btn-primary" id="life-again">🌱 再来一次</button>
        <button class="btn" id="life-png">🖼 生成卡片图</button>
        <button class="btn" id="life-share">📤 分享这一生</button>
        <button class="btn" id="life-saving">🔁 换个剧本</button>
      </div>`);
    this._cardEl.querySelector('#life-again').addEventListener('click', () => this._startSetup());
    this._cardEl.querySelector('#life-saving').addEventListener('click', () => this._showScriptSelect());
    this._cardEl.querySelector('#life-detail').addEventListener('click', () => {
      const b = document.getElementById('life-log-box');
      if (b) { b.open = true; b.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
    const png = this._cardEl.querySelector('#life-png');
    if (png) png.addEventListener('click', () => this._exportCard(ending, tier, badges, seen));
    const share = this._cardEl.querySelector('#life-share');
    if (share) share.addEventListener('click', () => this._share(ending, tier, badges, seen));
    this._log(`终局：${ending.label}`);
  }

  // 绘制「一生卡片」（纯 canvas，无第三方依赖）。返回 canvas；环境不支持时返回 null
  _drawCard(ending, tier, badges, seen) {
    const s = this._s, SC = this.SC;
    const cv = document.createElement('canvas');
    const W = 1080, H = 1440;
    cv.width = W; cv.height = H;
    const g = cv.getContext && cv.getContext('2d');
    if (!g) return null;
    const F = '"Songti SC","SimSun","Noto Serif CJK SC","Microsoft YaHei",serif';

    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1024'); bg.addColorStop(0.55, '#111830'); bg.addColorStop(1, '#080c18');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.22, 0, 0, W * 0.22, 0, W * 0.85);
    glow.addColorStop(0, 'rgba(124,111,247,.30)'); glow.addColorStop(1, 'rgba(124,111,247,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, 640);
    g.strokeStyle = 'rgba(124,111,247,.35)'; g.lineWidth = 2; g.strokeRect(38, 38, W - 76, H - 76);
    g.textBaseline = 'top';

    const wrap = (text, x, y, maxW, lh, maxLines) => {
      const chars = String(text == null ? '' : text).split('');
      const lines = [];
      let line = '';
      for (let i = 0; i < chars.length; i++) {
        const t = line + chars[i];
        if (g.measureText(t).width > maxW && line) { lines.push(line); line = chars[i]; }
        else line = t;
        if (maxLines && lines.length >= maxLines) break;
      }
      if (line && (!maxLines || lines.length < maxLines)) lines.push(line);
      lines.forEach((l, i) => g.fillText(l, x, y + i * lh));
      return y + lines.length * lh;
    };

    // 页眉
    g.fillStyle = '#9aa4c0'; g.font = `600 26px ${F}`;
    const head = '人 生 之 书  ·  ' + SC.title;
    g.fillText(head, 86, 92);
    g.fillStyle = 'rgba(154,164,192,.28)';
    g.fillRect(86, 140, W - 172, 1);

    // 等级 + 结局名
    const col = TIER_COLOR[tier] || '#94a3b8';
    g.fillStyle = col; g.font = `800 48px ${F}`;
    const tierStr = tier || '·';
    g.fillText(tierStr, 86, 176);
    g.fillStyle = 'rgba(154,164,192,.9)'; g.font = `500 22px ${F}`;
    g.fillText('结局等级', 86 + g.measureText(tierStr).width + 40, 200);
    g.fillStyle = '#e9ecf5'; g.font = `800 64px ${F}`;
    let y = wrap(ending.label, 86, 262, W - 172, 80, 2);
    g.fillStyle = col; g.font = `600 24px ${F}`;
    y = wrap(TIER_DESC[tier] || '', 86, y + 20, W - 172, 36, 1);

    // 结局散文
    g.fillStyle = '#c8d0e4'; g.font = `400 30px ${F}`;
    y = wrap(ending.story, 86, y + 36, W - 172, 50, 8);

    // 数据区
    y = Math.max(y + 30, 860);
    g.strokeStyle = 'rgba(34,48,79,1)'; g.lineWidth = 1;
    const rows = [
      ['一生印记', badges || '平凡一程'],
      ['积蓄 / 健康 / 幸福', `${money(s.money)} · ${Math.round(s.health)} · ${Math.round(s.happy)}`],
      ['成就', `${this._achUnlocked.size} / ${SC.achievements.length}`],
      ['结局收集', `${seen.length} / ${SC.endings.length}`],
    ];
    rows.forEach((r) => {
      g.beginPath(); g.moveTo(86, y); g.lineTo(W - 86, y); g.stroke();
      g.fillStyle = '#9aa4c0'; g.font = `600 24px ${F}`;
      g.fillText(r[0], 86, y + 24);
      g.fillStyle = '#e9ecf5'; g.font = `500 28px ${F}`;
      let t = String(r[1]);
      const maxW = W - 172 - 320;
      while (t.length > 1 && g.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
      g.fillText(t, W - 86 - g.measureText(t).width, y + 22);
      y += 76;
    });

    // 页脚
    g.fillStyle = 'rgba(154,164,192,.75)'; g.font = `500 22px ${F}`;
    const foot = 'PixelKit · 人生模拟器';
    g.fillText(foot, W - 86 - g.measureText(foot).width, H - 112);
    g.fillStyle = 'rgba(154,164,192,.55)';
    g.fillText(new Date().toLocaleDateString('zh-CN'), 86, H - 112);

    return cv;
  }

  _cardName(ending) {
    return '一生卡片-' + this.SC.title + '-' + String(ending.label).replace(/[\\/:*?"<>|\s]/g, '') + '.png';
  }

  // 下载 PNG
  _exportCard(ending, tier, badges, seen) {
    const cv = this._drawCard(ending, tier, badges, seen);
    if (!cv) { this.toast?.show?.('当前环境不支持导出图片', 'error'); return; }
    const name = this._cardName(ending);
    const save = (url) => {
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
    };
    if (cv.toBlob) {
      cv.toBlob((b) => {
        if (!b) { this.toast?.show?.('导出失败，请重试', 'error'); return; }
        save(URL.createObjectURL(b));
      }, 'image/png');
    } else {
      save(cv.toDataURL('image/png'));
    }
    this.toast?.show?.('一生卡片已生成，看看下载栏', 'success');
  }

  // 分享文案（纯文本，便于粘到任何地方）
  _shareText(ending, tier, badges, seen) {
    const s = this._s, SC = this.SC;
    const lines = [
      `《${SC.title}》 · ${tier ? tier + ' 级 · ' : ''}${ending.label}`,
      `积蓄 ${money(s.money)} · 健康 ${Math.round(s.health)} · 幸福 ${Math.round(s.happy)}`,
      `一生印记：${badges || '平凡一程'}`,
      `成就 ${this._achUnlocked.size} / ${SC.achievements.length} · 结局收集 ${seen.length} / ${SC.endings.length}`,
    ];
    try {
      if (typeof location !== 'undefined' && location.origin) lines.push(location.origin + location.pathname);
    } catch (e) { /* 忽略 */ }
    lines.push('—— PixelKit · 人生模拟器');
    return lines.join('\n');
  }

  _copyText(text) {
    const done = () => this.toast?.show?.('分享文案已复制，粘到哪儿都行', 'success');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        done();
      } catch (e) { this.toast?.show?.('复制失败，请手动选择文本', 'error'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  // 分享这一生：优先系统分享面板（带卡片图），否则回落到复制文案
  _share(ending, tier, badges, seen) {
    const text = this._shareText(ending, tier, badges, seen);
    const title = `《${this.SC.title}》${ending.label}`;
    const cv = this._drawCard(ending, tier, badges, seen);
    const toText = () => this._copyText(text);
    const quiet = (err) => { if (!err || err.name !== 'AbortError') toText(); };
    const doShare = (file) => {
      try {
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title, text }).catch(quiet);
          return;
        }
        if (navigator.share) { navigator.share({ title, text }).catch(quiet); return; }
      } catch (e) { /* 落到复制 */ }
      toText();
    };
    if (!cv) { toText(); return; }
    if (cv.toBlob) {
      cv.toBlob((b) => {
        let f = null;
        if (b) { try { f = new File([b], this._cardName(ending), { type: 'image/png' }); } catch (e) { f = null; } }
        doShare(f);
      }, 'image/png');
    } else doShare(null);
  }

  // ---------- 工具 ----------
  _card(html) {
    this._cardEl = document.getElementById('life-card');
    this._cardEl.innerHTML = html;
    this._syncLogSummary();
    return this._cardEl;
  }
  _def(k) { return (this.SC.statuses || []).find((x) => x.key === k); }
  _applyEffect(eff = {}) {
    const s = this._s;
    Object.entries(eff).forEach(([k, v]) => {
      if (!v) return;
      if (k === 'money') s.money = Math.max(-50000, s.money + v);
      else if (k === 'health') s.health = clamp(s.health + v, 0, 100);
      else if (k === 'happy') s.happy = clamp(s.happy + v, 0, 100);
      else if (this.SC.attrMeta[k]) s.attrs[k] = clamp(s.attrs[k] + v);
    });
  }
  /**
   * 数值变化飘字：从对应的属性条 / 顶栏胶囊上浮出 +N 并淡出。
   * 目的是让「我刚才这一下到底改变了什么」一眼可见，而不是只留一个静态 pill。
   * 必须在 _refreshAll() 之后调用（依赖重新渲染出来的 DOM）。
   */
  _floatDeltas(eff = {}) {
    if (!this._s || !this.root) return;
    const labelOf = (k) => (k === 'money' ? '积蓄' : k === 'health' ? '健康'
      : k === 'happy' ? '幸福' : (this.SC.attrMeta[k]?.label || k));
    Object.entries(eff).forEach(([k, v]) => {
      if (!v) return;
      let host = this.root.querySelector(`.life-attr[data-attr="${k}"]`);
      if (!host) {
        const idMap = { money: 'life-money', health: 'life-health', happy: 'life-happy' };
        const target = idMap[k] && document.getElementById(idMap[k]);
        host = target && target.closest('.life-stat');
      }
      if (!host) return;   // 左栏被收起时静默跳过，不报错
      const span = document.createElement('span');
      span.className = `life-float ${v > 0 ? 'up' : 'down'}`;
      span.textContent = `${v > 0 ? '+' : ''}${v} ${labelOf(k)}`;
      host.classList.add('is-bumped');
      host.appendChild(span);
      setTimeout(() => span.remove(), 1200);
      setTimeout(() => host.classList.remove('is-bumped'), 720);
    });
  }

  _describeChange(c) {
    const parts = [];
    Object.entries(c.effect || {}).forEach(([k, v]) => {
      if (!v) return;
      const name = k === 'money' ? '金钱' : k === 'health' ? '健康' : k === 'happy' ? '幸福' : this.SC.attrMeta[k]?.label || k;
      parts.push(`${name} ${v > 0 ? '+' : ''}${v}`);
    });
    (c.addStatus || []).forEach((k) => { const d = this._def(k); if (d) parts.push(`获得「${d.label}」`); });
    (c.removeStatus || []).forEach((k) => { const d = this._def(k); if (d) parts.push(`失去「${d.label}」`); });
    return parts.map((p) => `<span class="life-delta-pill">${esc(p)}</span>`).join(' ');
  }
  _stageIntro(id, done) {
    // 剧本自定义阶段收尾文案优先
    if (this.SC.stageIntros && this.SC.stageIntros[id]) {
      const arr = this.SC.stageIntros[id];
      return done ? arr[1] : arr[0];
    }
    const map = {
      study: ['大学的日子晃晃悠悠，但你想得很清楚：这条路，通向体制。', '大学四年转眼到头。你要去撞那扇千军万马的门了。'],
      gaokao: ['毕业即分水岭。你提笔上阵，千军万马过独木桥。', '你上岸了。乡镇，是体制给新人的第一课。'],
      grassroots: ['乡镇是最小也是最大的课堂：写材料、值夜班、走村入户。', '乡镇几年，你摸清了基层的脾气，也攒下了资历。'],
      mid: ['你开始摸到体制的门道，也摸到它的另一边。', '中坚岁月将尽，往上是峭壁，往下是平川。'],
      top: ['越往上走，风越大，每一步都要想清楚。', '高处岁月将尽，该想想退休后的生活了。'],
      old: ['岁月不饶人，你也不饶岁月。', '你的一生的账，该盘一盘了。'],
    };
    const arr = map[id];
    return done && arr ? arr[1] : arr?.[0] || '';
  }
  _refreshAll() { this._refreshTopbar(); this._renderSide(); }
}
