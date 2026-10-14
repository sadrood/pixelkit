/**
 * AgentPage - AI 助手聊天页面（支持文件上传 + API 调用）
 */
import { renderMarkdown } from '../agent/MarkdownRenderer.js';
import { MOODS, detectMood, getMood, getFace } from '../agent/MoodSystem.js';

/* ============== 头像：矢量图形（2026-10-08 重做）==============
   原来用 emoji 🧑 / 颜文字 (◍•ᴗ•◍) 当头像，用户反馈"太丑"。
   现在改成内联 SVG：助手=品牌色圆底 + 四角星（PixelKit 的"像素火花"），
   用户=中性底 + 人像轮廓。矢量绘制，深浅主题与高分屏都清晰。 */
const PK_AVATAR_AI = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2.6c.62 4.3 2.5 6.18 6.8 6.8-4.3.62-6.18 2.5-6.8 6.8-.62-4.3-2.5-6.18-6.8-6.8 4.3-.62 6.18-2.5 6.8-6.8Z" fill="currentColor"/>
  <circle cx="18.6" cy="18.4" r="1.9" fill="currentColor" opacity=".6"/>
</svg>`;
const PK_AVATAR_USER = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="8.6" r="3.5" stroke="currentColor" stroke-width="1.7"/>
  <path d="M5.4 20c.66-3.7 3.3-5.7 6.6-5.7s5.94 2 6.6 5.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

// ============== 纯显示清洗（不再做任何内容删除，杜绝前端吞字）==============
// 所有防幻觉/防重复过滤已收敛到后端（filterRoleLines / filterDualDelusions，
// 且后端已收窄正则 + 改增量过滤）。前端只做无损的显示级整理：
//   去行首 Pixel说:/Kit说: 前缀 + 合并多余空行，绝不删任何有效内容。
function sanitizeDisplayContent(rawContent) {
  if (!rawContent) return rawContent;
  let text = String(rawContent);
  // 1) 去 Pixel说:/Kit说: 前缀（仅行首，无损）
  text = text.replace(/^(Pixel|Kit)\s*[说：:]\s*/gm, '');
  // 2) 合并多余空行（仅空白整理，无损）
  text = text.replace(/\n{3,}/g, '\n\n').trimStart();
  return text;
}

export class AgentPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
    this.processing = false;
    this.attachFiles = [];
    this.sessionId = null;
    this._currentMood = 'happy';
    this._currentLabel = 'AI助手';
    this.userId = localStorage.getItem('pixelkit_user_id');
    if (!this.userId) {
      this.userId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pixelkit_user_id', this.userId);
    }
  }

  // 兼容老代码：默认按 Pixel 风格取
  getMood() { return getMood(this._currentLabel, this._currentMood); }

  /* ======================================================================
     聊天界面重设计（2026-09-30）：会话侧栏 / 模型选择 / 停止生成 / 空状态建议词 /
     消息操作条 / 深浅主题。以下方法只负责"壳"，对话逻辑仍走原有路径。
     ====================================================================== */

  /** 空状态：没有消息时显示建议词 */
  _pkSetEmpty(show) {
    const el = document.getElementById('agent-empty');
    if (!el) return;
    const hasMsg = this.chatList && this.chatList.querySelector('.agent-msg, .agent-time-sep');
    const on = typeof show === 'boolean' ? show : !hasMsg;
    el.hidden = !on;
  }

  /** 流式进行中：显示「■ 停止」，把输入区切到停止态 */
  _pkSetStreaming(on) {
    const stop = document.getElementById('agent-stop-btn');
    if (stop) stop.style.display = on ? 'inline-flex' : 'none';
    if (this.sendBtn) this.sendBtn.style.display = on ? 'none' : '';
    // 流式结束时去掉光标
    if (!on) this.chatList?.querySelectorAll('.pk-streaming').forEach((el) => el.classList.remove('pk-streaming'));
  }

  /** 把消息内容包进 .pk-body，并在助手消息下挂操作条（无头像，仿 DeepSeek Harness 排布） */
  _pkDecorate(div, role, content) {
    if (!div || div.dataset.pkDecorated) return;
    div.dataset.pkDecorated = '1';
    try {
      /* 2026-10-08：按用户要求去掉头像 —— 仿 DSH 的聊天界面（无头像、纯文本 + 角色小标签）。
         .pk-avatar 不再插入；PK_AVATAR_* 常量保留，便于以后想恢复时一行改回。 */
      const body = document.createElement('div');
      body.className = 'pk-body';
      while (div.children.length > 1) body.appendChild(div.children[1]);
      div.appendChild(body);

      // 操作条：复制（所有消息）+ 重新生成（助手消息）
      const acts = document.createElement('div');
      acts.className = 'pk-actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'pk-act';
      copy.textContent = '⧉ 复制';
      copy.addEventListener('click', async () => {
        const bubble = body.querySelector('.agent-bubble');
        const text = (bubble?.innerText || '').trim();
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = '✓ 已复制';
          copy.classList.add('is-ok');
          setTimeout(() => { copy.textContent = '⧉ 复制'; copy.classList.remove('is-ok'); }, 1500);
        } catch {
          copy.textContent = '复制失败';
          setTimeout(() => { copy.textContent = '⧉ 复制'; }, 1500);
        }
      });
      acts.appendChild(copy);
      if (role !== 'user') {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'pk-act';
        // 失败回复给"重试"，正常回复给"重新生成" —— 用户不用自己想怎么再来一次
        const failed = /响应失败|暂时不可用|额度|过载|加载失败|生成中断/.test(String(content || ''));
        again.textContent = failed ? '↻ 重试' : '↻ 重新生成';
        again.addEventListener('click', () => this._pkRegenerate());
        acts.appendChild(again);
      }
      body.appendChild(acts);
    } catch (e) {
      console.warn('decorate failed:', e);
    }
  }

  /** 重新生成：把最后一条用户消息再发一次（先移除它之后的助手回复） */
  _pkRegenerate() {
    if (this.processing) return;
    const text = this._lastUserMsg;
    if (!text) { this.toast?.show?.('没有可重新生成的内容', 'error'); return; }
    // 从末尾往前删掉最后一段助手消息
    const msgs = [...this.chatList.querySelectorAll('.agent-msg')];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].classList.contains('agent-msg-assistant')) msgs[i].remove();
      else break;
    }
    this.chatInput.value = text;
    this.handleSend();
  }

  /** 停止生成：中断正在进行的流式请求 */
  _pkStop() {
    if (this._abort) {
      try { this._abort.abort(); } catch { /* ignore */ }
      this._abort = null;
    }
    this.processing = false;
    if (this.sendBtn) this.sendBtn.disabled = false;
    this._pkSetStreaming(false);
    this.chatList?.querySelectorAll('.agent-typing').forEach((el) => el.classList.remove('agent-typing'));
    this.toast?.show?.('已停止生成', 'info');
  }

  /** 显示"实际服务的模型"；跨供应商兜底时提示一次（例如商汤被限流 → 自动用 OpenRouter 免费模型） */
  _pkNoteActualModel(meta) {
    const state = document.getElementById('agent-model-state');
    if (state) {
      state.textContent = meta.fallback
        ? `已自动改用 ${meta.model}`
        : (state.textContent || '');
      state.classList.toggle('is-bad', Boolean(meta.fallback));
    }
    if (meta.fallback && !this._pkFallbackNotified) {
      this._pkFallbackNotified = true;
      this.toast?.show?.(`${meta.requestedModel || '所选模型'} 不可用，已自动改用 ${meta.model}`, 'info');
    }
    if (!meta.fallback) this._pkFallbackNotified = false;
  }

  /** 输入框自动增高（1~6 行） */
  _pkAutoGrow() {    const ta = this.chatInput;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 190) + 'px';
  }

  /** 深/浅主题切换：与 src/main.js 的 _setupTheme 用同一个 key 与规则 */
  _pkToggleTheme() {
    const KEY = 'pk_theme';
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    this.toast?.show?.(next === 'light' ? '已切换到浅色' : '已切换到深色', 'success');
  }

  /** 模型列表：/api/agent/models 会告诉我们哪些模型当前套餐可用（403=未开通） */
  async _pkLoadModels() {
    const sel = document.getElementById('agent-model-select');
    const state = document.getElementById('agent-model-state');
    if (!sel) return;
    try {
      const r = await fetch('/api/agent/models');
      const j = await r.json();
      if (!j.success || !j.models?.length) throw new Error('empty');
      const saved = localStorage.getItem('pk_agent_model') || '';
      sel.innerHTML = '';
      for (const m of j.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        // 置灰规则：收费模型（站点只允许免费）或未开通的模型都不能选
        const blocked = Boolean(m.disabled) || m.status === 'plan_denied' || Boolean(m.billable);
        opt.textContent = m.label + (m.billable ? '（收费·已禁用）'
          : (m.status === 'plan_denied' ? '（未开通）' : (m.isDefault ? '（默认）' : '')));
        opt.title = m.disabledReason || m.note || '';
        if (blocked) { opt.disabled = true; opt.dataset.denied = '1'; }
        sel.appendChild(opt);
      }
      // 优先级：本地记忆 → 服务端默认 → 第一个可用项（置灰项不参与）
      // 关键：只有当"用户上次选模型时的服务端默认"与现在的默认一致，才沿用本地选择。
      // 否则说明主模型被换过（如商汤 → OpenRouter 免费模型），必须以新默认为准；
      // 否则浏览器会一直用旧模型发请求 —— 2026-09-30「为什么还是用不了」就是这个原因。
      const usable = j.models.filter((m) => !(m.disabled || m.status === 'plan_denied' || m.billable));
      const savedBase = localStorage.getItem('pk_agent_model_base') || '';
      const savedStillValid = saved && savedBase === j.defaultModel;
      this._pkDefaultModel = j.defaultModel;
      const pick = [savedStillValid ? saved : '', j.defaultModel].find((id) => id && usable.some((m) => m.id === id)) || usable[0]?.id;
      if (pick) { sel.value = pick; this._pkModel = pick; }
      if (saved && !savedStillValid && saved !== pick) {
        console.log(`[model] 主模型已变更为 ${j.defaultModel}，忽略浏览器里旧的 ${saved}`);
      }
      const blockedCount = j.models.length - usable.length;
      if (state) {
        // 技术细节不再堆在头部（用户反馈"看着乱"），挪进下拉的 title
        state.textContent = '';
        state.classList.toggle('is-bad', false);
      }
      if (blockedCount) sel.title = `另有 ${blockedCount} 个模型不可用（收费 / 未开通）`;
      sel.addEventListener('change', () => {
        const chosen = sel.options[sel.selectedIndex];
        if (chosen?.dataset.denied) { sel.value = this._pkModel || ''; return; }
        this._pkModel = sel.value;
        try {
          localStorage.setItem('pk_agent_model', this._pkModel);
          localStorage.setItem('pk_agent_model_base', this._pkDefaultModel || '');   // 记下当时的默认，用于判断是否过期
        } catch { /* ignore */ }
        this.toast?.show?.(`已切换模型：${chosen?.textContent || sel.value}`, 'success');
      });
    } catch {
      sel.innerHTML = '<option value="">默认模型</option>';
      if (state) { state.textContent = '模型列表获取失败'; state.classList.add('is-bad'); }
    }
  }

  /** 会话侧栏：按 今天 / 昨天 / 更早 分组，单行标题 + 右侧时间 */
  async _pkLoadSessions() {
    const box = document.getElementById('agent-sessions');
    if (!box) return;
    try {
      const r = await fetch(`/api/agent/sessions?userId=${encodeURIComponent(this.userId)}`);
      const j = await r.json();
      const list = (j.sessions || []).filter((s) => s.messageCount > 0);
      box.innerHTML = '';
      this._pkRecentSessions = list.slice(0, 3);
      this._pkRenderRecent();
      if (!list.length) {
        box.innerHTML = '<div class="pk-side-empty">还没有历史对话。<br>聊几句后这里会出现可回看的会话。</div>';
        return;
      }
      // 分组：今天 / 昨天 / 更早
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const groups = { 今天: [], 昨天: [], 更早: [] };
      for (const s of list) {
        const ts = Number(s.updated) || 0;
        if (ts >= dayStart.getTime()) groups['今天'].push(s);
        else if (ts >= dayStart.getTime() - 86400000) groups['昨天'].push(s);
        else groups['更早'].push(s);
      }
      for (const [name, arr] of Object.entries(groups)) {
        if (!arr.length) continue;
        const h = document.createElement('div');
        h.className = 'pk-side-group';
        h.textContent = name;
        box.appendChild(h);
        for (const s of arr) box.appendChild(this._pkSessionRow(s));
      }
    } catch {
      box.innerHTML = '<div class="pk-side-empty">会话列表读取失败</div>';
    }
  }

  /** 单条会话行 */
  _pkSessionRow(s) {
    const item = document.createElement('div');
    item.className = 'pk-sess' + (s.id === this.sessionId ? ' is-active' : '');
    item.dataset.sid = s.id;
    const t = document.createElement('div');
    t.className = 'pk-sess-title';
    t.textContent = String(s.preview || '(空对话)').replace(/\s+/g, ' ').slice(0, 60);
    t.title = t.textContent;
    const meta = document.createElement('div');
    meta.className = 'pk-sess-meta';
    meta.textContent = this._pkRelTime(s.updated);
    const del = document.createElement('button');
    del.className = 'pk-sess-del';
    del.title = '删除这个会话';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除这段会话记录？')) return;
      await fetch(`/api/agent/session/${s.id}?userId=${encodeURIComponent(this.userId)}`, { method: 'DELETE' }).catch(() => {});
      if (s.id === this.sessionId) {
        this.sessionId = null;
        localStorage.removeItem('pixelkit_session_id');
        this.chatList.innerHTML = '';
        this._pkSetEmpty(true);
      }
      this._pkLoadSessions();
    });
    item.append(t, meta, del);
    item.addEventListener('click', () => this._pkOpenSession(s.id));
    return item;
  }

  /** 空状态里的"继续上次对话"（最多 3 条） */
  _pkRenderRecent() {
    const box = document.getElementById('agent-recent');
    if (!box) return;
    const list = this._pkRecentSessions || [];
    box.innerHTML = '';
    if (!list.length) return;
    const h = document.createElement('div');
    h.className = 'pk-recent-title';
    h.textContent = '继续上次对话';
    box.appendChild(h);
    for (const s of list) {
      const b = document.createElement('button');
      b.className = 'pk-recent-item';
      const tt = document.createElement('span');
      tt.className = 'pk-recent-t';
      tt.textContent = String(s.preview || '(空对话)').replace(/\s+/g, ' ').slice(0, 40);
      const dd = document.createElement('span');
      dd.className = 'pk-recent-d';
      dd.textContent = this._pkRelTime(s.updated);
      b.append(tt, dd);
      b.addEventListener('click', () => this._pkOpenSession(s.id));
      box.appendChild(b);
    }
  }

  _pkRelTime(ts) {
    if (!ts) return '刚刚';
    const d = Date.now() - Number(ts);
    if (Number.isNaN(d) || d < 0) return '刚刚';
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return new Date(Number(ts)).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  async _pkOpenSession(sid) {
    if (this.processing) { this.toast?.show?.('正在生成中，先停止再切换会话', 'error'); return; }
    this.sessionId = sid;
    try { localStorage.setItem('pixelkit_session_id', sid); } catch { /* ignore */ }
    this.chatList.innerHTML = '';
    await this._loadHistory(sid);
    this._pkSetEmpty();
    this._pkLoadSessions();
    this._pkMarkActiveSession();
  }

  _pkMarkActiveSession() {
    document.querySelectorAll('#agent-sessions .pk-sess').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.sid === this.sessionId);
    });
  }

  /** 壳层初始化：侧栏 / 模型 / 停止 / 建议词 / 主题 / 输入自动增高 */
  _pkInitShell() {
    const page = document.getElementById('page-agent');
    // 窄屏：侧栏默认收起为抽屉；并跟随视口变化（旋转屏幕 / 拖窗口都不会卡在半开状态）
    const mq = window.matchMedia('(max-width: 900px)');
    const applyNarrow = (narrow) => {
      page.classList.toggle('pk-side-collapsed', narrow);
    };
    applyNarrow(mq.matches);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', (e) => applyNarrow(e.matches));

    document.getElementById('agent-side-toggle')?.addEventListener('click', () => page.classList.toggle('pk-side-collapsed'));
    document.getElementById('agent-side-open')?.addEventListener('click', () => page.classList.toggle('pk-side-collapsed'));
    document.getElementById('agent-side-refresh')?.addEventListener('click', () => this._pkLoadSessions());
    document.getElementById('agent-theme-btn')?.addEventListener('click', () => this._pkToggleTheme());
    document.getElementById('agent-stop-btn')?.addEventListener('click', () => this._pkStop());
    document.getElementById('agent-clear-chat')?.addEventListener('click', () => {
      if (this.processing) { this.toast?.show?.('正在生成中，先点停止', 'error'); return; }
      this.sessionId = null;
      try { localStorage.removeItem('pixelkit_session_id'); } catch { /* ignore */ }
      this.chatList.innerHTML = '';
      this._pkSetEmpty(true);
    });
    document.getElementById('agent-new-chat-btn')?.addEventListener('click', () => {
      if (this.processing) { this.toast?.show?.('正在生成中，先点停止', 'error'); return; }
      this.sessionId = null;
      try { localStorage.removeItem('pixelkit_session_id'); } catch { /* ignore */ }
      this.chatList.innerHTML = '';
      this._pkSetEmpty(true);
      this.chatInput?.focus();
      this._pkLoadSessions();
    });

    // 空状态建议词：点一下即填入并发送
    document.querySelectorAll('#agent-empty .pk-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.chatInput.value = chip.dataset.prompt || '';
        this._pkAutoGrow();
        this.handleSend();
      });
    });

    // 输入框自动增高
    this.chatInput?.addEventListener('input', () => this._pkAutoGrow());

    // 打开这个页面就自动聚焦输入框（少一次点击，"好难用"里很实际的一条）
    try {
      const obs = new MutationObserver(() => {
        const on = page.classList.contains('active');
        if (on) this.chatInput?.focus();
        // 2026-10-13：body.pk-agent-active 用来隐藏右下角全局主题吉祥物
        // （原写法用了 CSS :has()，老浏览器不支持 → 改由 JS 打标记）
        document.body.classList.toggle('pk-agent-active', on);
      });
      obs.observe(page, { attributes: true, attributeFilter: ['class'] });
      if (page.classList.contains('active')) { this.chatInput?.focus(); document.body.classList.add('pk-agent-active'); }
    } catch { /* ignore */ }

    this._pkLoadModels();
    this._pkLoadSessions();
  }

  init() {
    this._inited = true;
    this.chatList = document.getElementById('agent-chat-list');
    this.chatInput = document.getElementById('agent-chat-input');
    this.sendBtn = document.getElementById('agent-send-btn');
    this.fileInput = document.getElementById('agent-file-input');
    this.attachBtn = document.getElementById('agent-attach-btn');
    this.filePreview = document.getElementById('agent-file-preview');
    this.chatContainer = document.querySelector('.agent-chat-container');

    // 文件拖拽上传
    this.chatContainer.addEventListener('dragover', (e) => { e.preventDefault(); this.chatContainer.classList.add('agent-dragover'); });
    this.chatContainer.addEventListener('dragleave', () => this.chatContainer.classList.remove('agent-dragover'));
    this.chatContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      this.chatContainer.classList.remove('agent-dragover');
      if (e.dataTransfer.files.length > 0) this.handleFiles(e.dataTransfer.files);
    });

    // 粘贴图片
    document.addEventListener('paste', (e) => {
      if (!document.getElementById('page-agent').classList.contains('active')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) this.handleFiles([blob]);
          break;
        }
      }
    });

    this.voiceBtn = document.getElementById('agent-voice-btn');
    this.voiceBtn?.addEventListener('mousedown', () => this.startVoice());
    this.voiceBtn?.addEventListener('mouseup', () => this.stopVoice());
    this.voiceBtn?.addEventListener('mouseleave', () => this.stopVoice());
    this.voiceBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.startVoice(); });
    this.voiceBtn?.addEventListener('touchend', () => this.stopVoice());

    // 内测模式开关切换欢迎语
    document.getElementById('agent-dual-check')?.addEventListener('change', (e) => {
      const beta = e.target.checked;
      const msgs = this.chatList.querySelectorAll('.agent-msg');
      // 空对话下没有欢迎气泡可替换，给个提示就够（避免凭空塞一条假消息）
      if (msgs.length === 0) {
        this.toast?.show?.(beta ? '内测双 AI 已开启：Pixel & Kit 会一起回答' : '已回到单 AI 模式', beta ? 'success' : 'info');
        return;
      }
      // 如果只有欢迎语一条消息，替换它
      if (msgs.length === 1 && msgs[0].querySelector('.agent-bubble')?.textContent.includes('PixelKit 小助手')) {
        this.chatList.innerHTML = '';
        if (beta) {
          this.addMessage('assistant', '🧪 内测模式启动！\n\n我是 Pixel（emoji控 ✨）和 Kit（颜文字控 ﾉ◕ヮ◕）ﾉ\n你想找谁聊天直接 @Ta 就好啦~\n\n@Pixel 讲个笑话\n@Kit 你怎么看\n直接说话 → 我俩都来！', null, null, '系统');
        } else {
          this.addMessage('assistant', '嗨嗨~ 我是 PixelKit 小助手呀 ✨\n\n我可以帮你做这些事儿哦：\n💬 陪你聊天（我有小脑瓜，能记住上下文呢）\n📎 处理文件 — 上传文件告诉我干啥\n👁 看图说话 — 上传图片问"这是什么"我就告诉你\n🎨 文生图 — 说"帮我画一张信息图"我就能画出来！\n\n快来跟我玩吧 👇', null, null, 'AI助手');
        }
      }
    });

    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.attachBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    document.getElementById('agent-clear-files').addEventListener('click', () => this.clearFiles());

    this.chatList.innerHTML = '';

    // 尝试恢复上次会话；没有历史就停在空状态（建议词是 HTML 里静态渲染的）
    const savedSessionId = localStorage.getItem('pixelkit_session_id');
    if (savedSessionId) {
      this.sessionId = savedSessionId;
      this._loadHistory(savedSessionId);
    } else {
      this._pkSetEmpty(true);
    }

    // 壳层：会话侧栏 / 模型选择 / 停止生成 / 建议词 / 深浅主题 / 输入自动增高
    this._pkInitShell();

    // 心跳保活：每60秒发一次，保持会话不销毁
    this._heartbeat = setInterval(() => {
      if (this.sessionId) {
        fetch('/api/agent/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId })
        }).catch(() => {});
      }
    }, 60000);

    // 页面关闭时清理定时器
    window.addEventListener('beforeunload', () => clearInterval(this._heartbeat));

    // 回底按钮
    this._initScrollBtn();
  }

  /** 从服务器加载历史会话 */
  async _loadHistory(sessionId) {
    try {
      const resp = await fetch(`/api/agent/session/${sessionId}?userId=${encodeURIComponent(this.userId)}`);
      const data = await resp.json();
      if (data.success && data.session && data.session.messages.length > 0) {
        this.chatList.innerHTML = '';
        // 渲染历史消息
        for (const msg of data.session.messages) {
          const role = msg.role === 'user' ? 'user' : 'assistant';
          // 检测 Kit 消息
          const isKitMsg = msg.content.startsWith('Kit: ');
          const isPixelMsg = msg.content.startsWith('Pixel: ');
          let label = 'AI助手';
          let content = msg.content;
          if (isKitMsg) { label = 'Kit'; content = content.slice(5); }
          else if (isPixelMsg) { label = 'Pixel'; content = content.slice(7); }
          this.addMessage(role, content, null, null, role === 'user' ? null : label);
        }
        this._smartScroll(this.chatList);
        this._pkSetEmpty(false);
        this._pkMarkActiveSession();
      } else {
        this._pkSetEmpty(true);
      }
    } catch {
      this._pkSetEmpty(true);
    }
  }

  handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    const files = Array.from(fileList);
    const oversized = files.filter(f => f.size > MAX_SIZE);
    if (oversized.length > 0) {
      this.toast.show(`文件过大：${oversized.map(f => f.name).join(', ')}（单文件最大 50MB）`, 'error');
      if (oversized.length === files.length) { this.fileInput.value = ''; return; }
      this.attachFiles = files.filter(f => f.size <= MAX_SIZE);
    } else {
      this.attachFiles = files;
    }
    this.showFilePreview();
    this.fileInput.value = '';
  }

  showFilePreview() {
    const names = this.attachFiles.map(f => f.name).join(', ');
    const totalSize = this.attachFiles.reduce((s, f) => s + f.size, 0);
    this.filePreview.innerHTML = `
      📎 ${this.attachFiles.length}个文件: ${names} (${(totalSize/1024).toFixed(0)}KB)
      <button onclick="document.getElementById('agent-clear-files').click()" style="margin-left:8px;background:none;border:1px solid var(--danger,red);color:var(--danger,red);border-radius:4px;cursor:pointer;font-size:11px;padding:1px 6px;">✕ 移除</button>
    `;
    this.filePreview.style.display = 'block';
  }

  clearFiles() {
    this.attachFiles = [];
    this.filePreview.style.display = 'none';
    this.filePreview.innerHTML = '';
  }

  async handleSend() {
    const text = this.chatInput.value.trim();
    if (this.processing) return;
    if (!text && this.attachFiles.length === 0) return;
    this._lastUserMsg = text;

    // 上传了单张图片 → 根据意图路由
    if (this.attachFiles.length === 1 && this.attachFiles[0].type.startsWith('image/')) {
      const genKeywords = /(画|生成|做|创建|制作|按这个|参考|模仿|照着|风格|换一个|来一张)/;
      if (genKeywords.test(text)) {
        await this.generateImageFromReference(text);
        return;
      }
      // 图片理解意图
      const askKeywords = /(是什么|有什么|看到|描述|分析|识别|这是什么图|里面|写|写作|看图|解读|讲讲|说说|介绍|数学|题|算|公式|方程)/;
      const isAsk = askKeywords.test(text);
      const noConvertIntent = !/(转|pdf|压缩|合并|加密|解密|水印|转换|导出|ico|图标|png|jpg|webp)/i.test(text);
      if (isAsk || (!text && noConvertIntent) || (noConvertIntent && !isAsk)) {
        let question = text || '帮我看看这张图，描述一下';
        if (/(数学|题|算|公式|方程)/.test(text)) {
          question = '请完整识别图中所有题目和公式，不要遗漏任何内容' + (text ? '。' + text : '');
        }
        this.chatInput.value = '';
        this.addMessage('user', `📷 ${question}`);
        await this.understandImage(question);
        this.processing = false;
        this.sendBtn.disabled = false;
        this.chatInput.focus();
        return;
      }
    }

    this.processing = true;
    this.sendBtn.disabled = true;

    // 检测是否为文本文件（可被 AI 阅读的格式）
    const textFileExts = ['.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', '.htm',
      '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh',
      '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.docx', '.doc', '.xlsx', '.xls', '.pdf'];
    const allTextFiles = this.attachFiles.length > 0 && this.attachFiles.every(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      return textFileExts.includes(ext);
    });

    // 显示用户消息
    let defaultMsg;
    if (!text && this.attachFiles.length > 0) {
      defaultMsg = allTextFiles ? '请阅读这个文件，告诉我主要内容' : '请帮我处理这些文件';
    } else {
      defaultMsg = '';
    }
    const userMsg = text || defaultMsg;
    if (this.attachFiles.length > 0) {
      this.addMessage('user', `📎 [${this.attachFiles.length}个文件] ${userMsg}`);
    } else {
      this.addMessage('user', userMsg);
    }

    this.chatInput.value = '';

    // Typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'agent-msg agent-msg-assistant';
    typingDiv.innerHTML = '<div class="agent-bubble agent-typing"><span></span><span></span><span></span></div>';
    this.chatList.appendChild(typingDiv);
    this._smartScroll(this.chatList);

    try {
      if (this.attachFiles.length > 0) {
        // 文件处理模式
        await this.executeFiles(text, typingDiv);
      } else {
        // 纯对话模式
        await this.chatOnly(text, typingDiv);
      }
    } catch (err) {
      typingDiv.remove();
      this.clearFiles();
      if (err.name === 'AbortError') {
        this.addMessage('assistant', '处理超时了 😅 文件可能太大或转换比较慢，试试小一点的文件？');
      } else {
        this.addMessage('assistant', '处理失败: ' + (err.message || '未知错误'));
      }
    }

    this.processing = false;
    this.sendBtn.disabled = false;
    this.chatInput.focus();
  }

  async executeFiles(instruction, typingDiv) {
    const formData = new FormData();
    formData.append('instruction', instruction);
    if (this.sessionId) formData.append('sessionId', this.sessionId);
    formData.append('userId', this.userId);
    for (const f of this.attachFiles) {
      formData.append('files', f);
    }

    const apiUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:3001/api/agent/execute'
      : '/api/agent/execute';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const res = await fetch(apiUrl, { method: 'POST', body: formData, signal: controller.signal });
    clearTimeout(timeout);
    let data;
    try { data = await res.json(); } catch { data = { success: false, error: `HTTP ${res.status} 响应异常` }; }
    typingDiv.remove();
    this.clearFiles();

    if (!res.ok) {
      this.addMessage('assistant', '❌ 服务器错误(' + res.status + '): ' + (data.error || '未知'));
      return;
    }

    if (data.success) {
      // AI 生成的自然语言回复
      let reply = data.reply || `✅ ${data.action}完成！`;
      if (data.detail && !data.reply) reply += `\n${data.detail}`;

      // 添加下载按钮（可点击但不会自动下载）
      const dlHtml = [];
      if (data.downloadUrls && data.downloadUrls.length > 1) {
        data.downloadUrls.forEach((url, i) => {
          dlHtml.push(`[📥 文件${i+1}](${url})`);
        });
      } else if (data.downloadUrl) {
        dlHtml.push(`[📥 下载文件](${data.downloadUrl})`);
      }

      this.addMessage('assistant', reply, dlHtml);
    } else {
      this.addMessage('assistant', '❌ ' + (data.error || '处理失败'));
    }
  }

  async understandImage(question) {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'agent-msg agent-msg-assistant';
    typingDiv.innerHTML = '<div class="agent-bubble agent-typing"><span></span><span></span><span></span></div>';
    this.chatList.appendChild(typingDiv);
    this._smartScroll(this.chatList);

    try {
      const formData = new FormData();
      formData.append('file', this.attachFiles[0]);
      formData.append('question', question);
      if (this.sessionId) formData.append('sessionId', this.sessionId);
      formData.append('userId', this.userId);

      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/agent/understand-image'
        : '/api/agent/understand-image';
      const res = await fetch(apiUrl, { method: 'POST', body: formData });
      let data;
      try { data = await res.json(); } catch { data = { reply: '服务器响应异常' }; }
      typingDiv.remove();
      this.clearFiles();

      this.addMessage('assistant', data.reply || '嗯...这张图我看不太清楚呢 🧐');
    } catch (err) {
      typingDiv.remove();
      this.clearFiles();
      this.addMessage('assistant', '看图时网络开小差了 😢');
    }
  }

  async generateImage(prompt) {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'agent-msg agent-msg-assistant';
    typingDiv.innerHTML = '<div class="agent-bubble agent-typing"><span></span><span></span><span></span></div>';
    this.chatList.appendChild(typingDiv);
    this._smartScroll(this.chatList);

    try {
      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/agent/generate-image'
        : '/api/agent/generate-image';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000); // 3分钟超时

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId: this.sessionId, userId: this.userId }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      let data;
      try { data = await res.json(); } catch { data = { reply: '画图响应异常 😢' }; }
      typingDiv.remove();

      if (data.success && data.image) {
        this.addMessage('assistant', data.reply || '给你画好啦~ ✨', null, data.image);
      } else {
        this.addMessage('assistant', data.reply || '画图时出了点小状况 😢');
      }
    } catch (err) {
      typingDiv.remove();
      if (err.name === 'AbortError') {
        this.addMessage('assistant', '画图超时了 😅 图片生成比较慢，试试简化描述再画一次吧~');
      } else {
        this.addMessage('assistant', '网络开小差了 😢 再试一次吧~');
      }
    }
  }

  /** 参考上传图片的风格生成新图 */
  async generateImageFromReference(text) {
    this.chatInput.value = '';
    this.addMessage('user', `📷 ${text}（参考上传的图片风格）`);
    const typingDiv = document.createElement('div');
    typingDiv.className = 'agent-msg agent-msg-assistant';
    typingDiv.innerHTML = '<div class="agent-bubble agent-typing"><span></span><span></span><span></span></div>';
    this.chatList.appendChild(typingDiv);
    this._smartScroll(this.chatList);
    try {
      const formData = new FormData();
      formData.append('file', this.attachFiles[0]);
      formData.append('question', '请详细描述这张图的风格特征：整体色调、绘画风格（如写实/卡通/水彩/赛博朋克等）、构图特点、光影效果。用200字以内的中文描述，格式为"这张图的风格是：…"');
      const apiUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001/api/agent/understand-image' : '/api/agent/understand-image';
      const styleResp = await fetch(apiUrl, { method: 'POST', body: formData });
      const styleData = await styleResp.json();
      typingDiv.remove();
      this.clearFiles();
      const styleDesc = styleData.reply || '';
      const combinedMsg = styleDesc
        ? `[系统分析：${styleDesc}]\n\n用户请求：${text}。请调用generate_image，把上述风格描述融入prompt中。`
        : text;
      this.addMessage('user', combinedMsg);
      await this.chatOnly(combinedMsg, null);
    } catch { typingDiv.remove(); this.clearFiles(); }
    this.processing = false;
    this.sendBtn.disabled = false;
    this.chatInput.focus();
  }

  async chatOnly(text, typingDiv) {
    const searchOn = document.getElementById('agent-search-check')?.checked ?? true;
    const dualMode = document.getElementById('agent-dual-check')?.checked ?? false;

    // 流式输出（失败时回退到普通接口）
    try {
      // 没传 typingDiv 时自动创建一个等待动画
      if (typingDiv) {
        typingDiv.remove();
      } else {
        typingDiv = document.createElement('div');
        typingDiv.className = 'agent-msg agent-msg-assistant';
        typingDiv.innerHTML = '<div class="agent-bubble agent-typing"><span></span><span></span><span></span></div>';
        this.chatList.appendChild(typingDiv);
        this._smartScroll(this.chatList);
      }
      let currentBubble = null;
      let currentContent = '';
      let currentSources = null;
      let debateRounds = 0;
      let labelCount = 0;
      let surrenderSpeaker = '';

      // 用 AbortController 包住整条流：界面上的「■ 停止」就是 abort 它
      this._abort = new AbortController();
      this._pkSetStreaming(true);
      let res;
      try {
        res = await fetch('/api/agent/chat-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: this._abort.signal,
          body: JSON.stringify({
            message: text, sessionId: this.sessionId, searchOn, dualMode, userId: this.userId,
            model: this._pkModel || undefined,     // 前端选择的模型（服务端白名单校验，非法则回退）
          })
        });
      } catch (e) {
        this._pkSetStreaming(false);
        if (e.name === 'AbortError') { if (typingDiv) typingDiv.remove(); return; }
        throw e;
      }

      if (!res.ok) { this._pkSetStreaming(false); throw new Error('stream failed'); }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let evt = '', data = '';
          for (const l of lines) {
            if (l.startsWith('event: ')) evt = l.slice(7);
            else if (l.startsWith('data: ')) data = l.slice(6);
          }
          if (!data) continue;
          try {
            const d = JSON.parse(data);
            if (evt === 'meta') {
              if (d.sessionId) { this.sessionId = d.sessionId; localStorage.setItem('pixelkit_session_id', d.sessionId); }
              // 服务端会告知"实际服务的模型"：跨供应商兜底时如实显示，避免用户以为用的还是自己选的
              if (d.model) this._pkNoteActualModel(d);
            } else if (evt === 'sources') {
              currentSources = d;
            } else if (evt === 'status') {
              // 子Agent 状态通知
              if (typingDiv) {
                const bubble = typingDiv.querySelector('.agent-bubble');
                if (bubble) bubble.innerHTML = `<span class="agent-status-msg">${d.text || d}</span>`;
              } else if (currentBubble) {
                // 在气泡顶部插入状态提示
                const statusEl = currentBubble.bubble.querySelector('.agent-status-line');
                if (statusEl) {
                  statusEl.textContent = d.text || d;
                } else {
                  const el = document.createElement('div');
                  el.className = 'agent-status-line';
                  el.textContent = d.text || d;
                  currentBubble.bubble.insertBefore(el, currentBubble.bubble.firstChild);
                }
              }
            } else if (evt === 'image') {
              // AI 调用画图工具生成的图片 — 立刻显示
              this._streamImageUrl = d.url;
              if (currentBubble) {
                const imgWrap = document.createElement('div');
                imgWrap.style.cssText = 'margin-top:8px;max-width:100%;';
                const img = document.createElement('img');
                img.src = d.url;
                img.style.cssText = 'max-width:100%;max-height:400px;border-radius:8px;cursor:pointer;';
                img.title = '点击查看大图';
                img.addEventListener('click', () => window.open(d.url, '_blank'));
                imgWrap.appendChild(img);
                currentBubble.bubble.appendChild(imgWrap);
              }
            } else if (evt === 'label') {
              currentContent = '';
              labelCount++;
              // 第一个 label 时移除 loading 动画
              if (labelCount === 1 && typingDiv) {
                typingDiv.remove();
                typingDiv = null;
              }
              const rawLabel = typeof d === 'string' ? d : (d.label || d);
              const dual = !!(document.getElementById('agent-dual-check')?.checked);
              // 前后端双保险：没开内测模式时，任何 Kit/Pixel label 都强制只显示 AI助手，不触发辩论轮次
              const label = dual ? rawLabel : 'AI助手';
              currentBubble = this.createStreamBubble(label);
              // 内测模式新气泡创建后，立刻强制显示 moodBadge 并跑一次初始 mood
              if (currentBubble?.moodBadge) {
                try {
                  const moodName = detectMood('');
                  currentBubble.moodBadge._mood = moodName;
                  const faceData = getMood(currentBubble.speaker || 'AI助手', moodName);
                  // 强制 display 覆盖 CSS 历史 display:none !important 规则
                  /* 2026-10-08：不再显示名字后面的颜文字情绪徽章（用户反馈太丑），保持创建时的 display:none */
                  currentBubble.moodBadge.style.setProperty('--mood-color', faceData.color);
                  // 强制跳动动画重启：先去class，下一帧再加
                  currentBubble.moodBadge.className = 'agent-mood-badge';
                  const badge = currentBubble.moodBadge;
                  const animClass = faceData.anim || '';
                  setTimeout(() => { badge.className = 'agent-mood-badge ' + animClass; badge.setAttribute('data-mood', moodName); badge.title = faceData.label; badge.textContent = faceData.face; }, 0);
                } catch (e) {}
              }
              // 第一个 label 是主回复，后续的是辩论轮次（只有内测模式才会计数）
              if (dual && labelCount > 1) {
                debateRounds++;
              }
            } else if (evt === 'token') {
              // 累积 chunk 后做纯显示清洗（内容过滤已收敛到后端，前端只做无损整理）
              currentContent += d.content;
              let displayContent = sanitizeDisplayContent(currentContent);

              if (currentBubble) {
                currentBubble.bubble.classList.remove('agent-typing');
                currentBubble.textDiv.innerHTML = renderMarkdown(displayContent, currentSources);
                // 实时更新情绪（每次刷新，强制 display + 重设 animation 保证跳动可见）
                if (currentBubble.moodBadge) {
                  try {
                    const moodName = detectMood(displayContent);
                    currentBubble.moodBadge._mood = moodName;
                    const faceData = getMood(currentBubble.speaker || 'AI助手', moodName);
                    /* 2026-10-08：不再显示名字后面的颜文字情绪徽章（用户反馈太丑），保持创建时的 display:none */
                    currentBubble.moodBadge.style.setProperty('--mood-color', faceData.color);
                    currentBubble.moodBadge.className = 'agent-mood-badge';
                    const badge = currentBubble.moodBadge;
                    const animClass = faceData.anim || '';
                    setTimeout(() => { badge.className = 'agent-mood-badge ' + animClass; badge.setAttribute('data-mood', moodName); badge.title = faceData.label; badge.textContent = faceData.face; }, 0);
                  } catch (e) { /* mood update should not break chat */ }
                }
                this._smartScroll(this.chatList);
              }
              // 检测认输关键词（用 currentContent 原始内容，避免过滤后丢关键词）
              if (debateRounds > 0 && !surrenderSpeaker) {
                const stopWords = /(不说了|拜拜|再见|就到这儿|就到这吧|我撤了|你赢了|停|够了|我认输|不想说了)/;
                if (stopWords.test(currentContent)) {
                  const msgEl = currentBubble?.bubble?.closest('.agent-msg');
                  const metaEl = msgEl?.querySelector('.agent-meta');
                  surrenderSpeaker = metaEl?.textContent || '';
                }
              }
            } else if (evt === 'done') {
              if (currentBubble) {
                const speakerDone = currentBubble.speaker || 'AI助手';
                const displayDone = sanitizeDisplayContent(currentContent);
                currentBubble.textDiv.innerHTML = renderMarkdown(displayDone, currentSources) || '...';
                // 最后也再强制刷新一次心情徽章，保证 done 后徽章显示正确
                if (currentBubble.moodBadge) {
                  try {
                    const moodName = detectMood(displayDone);
                    const faceData = getMood(speakerDone, moodName);
                    /* 2026-10-08：不再显示名字后面的颜文字情绪徽章（用户反馈太丑），保持创建时的 display:none */
                    currentBubble.moodBadge.style.setProperty('--mood-color', faceData.color);
                    currentBubble.moodBadge.className = 'agent-mood-badge';
                    const b = currentBubble.moodBadge;
                    const c = faceData.anim || '';
                    setTimeout(() => { b.className = 'agent-mood-badge ' + c; b.setAttribute('data-mood', moodName); b.title = faceData.label; b.textContent = faceData.face; }, 0);
                  } catch (e) {}
                }
              }
            }
          } catch {}
        }
      }
      // 最终渲染也用同一纯显示清洗（与 token/done 一致）
      if (currentBubble) {
        const finalContent = sanitizeDisplayContent(currentContent);
        currentBubble.textDiv.innerHTML = renderMarkdown(finalContent, currentSources) || '...';
      }
      this._pkSetStreaming(false);

      // 辩论结束后显示统计（至少两轮才算辩论）
      if (debateRounds > 1) {
        const statsText = surrenderSpeaker
          ? `🎭 Pixel & Kit 辩论了 ${debateRounds} 轮，${surrenderSpeaker} 先认输~`
          : `🎭 Pixel & Kit 辩论了 ${debateRounds} 轮`;
        this.addDebateStats(statsText);
      }
    } catch {
      // 流式失败，回退到非流式
      if (typingDiv) { typingDiv.remove(); typingDiv = null; }
      console.log('Stream failed, falling back to normal chat');
      try {
        const fbRes = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId: this.sessionId, searchOn, dualMode, userId: this.userId })
        });
        const data = await fbRes.json();
        if (data.sessionId) this.sessionId = data.sessionId;
        if (data.success) {
          this.addMessage('assistant', data.reply, null, data.image, data.dualReply ? 'Pixel' : 'AI助手');
          if (data.dualReply) this.addMessage('assistant', data.dualReply, null, null, 'Kit');
          if (data.pixelAdd) this.addMessage('assistant', data.pixelAdd, null, null, 'Pixel');
        }
      } catch {
        this.addMessage('assistant', '加载失败 😢');
      }
    }
  }

  createStreamBubble(label) {
    const isKit = label === 'Kit';
    const isPixel = label === 'Pixel';
    const div = document.createElement('div');
    div.className = 'agent-msg agent-msg-assistant' + (isKit ? ' agent-msg-kit' : '') + (isPixel ? ' agent-msg-pixel' : '');

    const bubble = document.createElement('div');
    bubble.className = 'agent-bubble agent-typing pk-streaming';   // pk-streaming：尾部闪烁光标

    // 文本内容放在子 div 中，图片/下载链接等作为 bubble 的兄弟元素
    const textDiv = document.createElement('div');
    textDiv.className = 'agent-bubble-text';
    textDiv.innerHTML = '<span></span><span></span><span></span>';
    bubble.appendChild(textDiv);

    const meta = document.createElement('div');
    meta.className = 'agent-meta';
    meta.textContent = label;

    // 霓虹颜文字情绪徽章（按 label 分风格：Kit 颜文字 / Pixel emoji）
    const moodBadge = document.createElement('span');
    moodBadge.className = 'agent-mood-badge';
    const initialMood = 'thinking';
    try {
      if (initialMood) {
        const faceData = getMood(label, initialMood);
        moodBadge.style.setProperty('--mood-color', faceData.color);
        moodBadge.setAttribute('data-mood', initialMood);
        moodBadge.className = 'agent-mood-badge ' + (faceData.anim || '');
        moodBadge.title = faceData.label;
        moodBadge.textContent = faceData.face;
        moodBadge._mood = initialMood;
      } else {
        moodBadge.style.display = 'none';
      }
    } catch (e) {
      console.warn('Mood badge creation failed:', e);
      moodBadge.textContent = getFace(label, 'happy');
      moodBadge.style.color = '#f5a623';
    }
    meta.appendChild(moodBadge);

    div.appendChild(meta);
    div.appendChild(bubble);
    this._addFeedbackBtns(div, bubble, label);
    this.chatList.appendChild(div);
    this._pkDecorate(div, 'assistant');
    this._pkSetEmpty(false);
    this._smartScroll(this.chatList);
    return { bubble, textDiv, moodBadge, speaker: label };
  }

  /** 智能滚动：仅当用户在底部附近（100px 内）才自动滚动 */
  _smartScroll(scrollEl) {
    const d = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (d < 100) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  _initScrollBtn() {
    const btn = document.getElementById('agent-scroll-bottom');
    if (!btn) return;
    btn.addEventListener('click', () => this.chatList.scrollTo({ top: this.chatList.scrollHeight, behavior: 'smooth' }));
    this.chatList.addEventListener('scroll', () => {
      const d = this.chatList.scrollHeight - this.chatList.scrollTop - this.chatList.clientHeight;
      btn.classList.toggle('visible', d > 200);
    });
  }

  addMessage(role, content, dlButtons, imageUrl, label) {
    const now = Date.now();
    if (this._lastMsgTime && (now - this._lastMsgTime > 120000)) {
      const sep = document.createElement('div');
      sep.className = 'agent-time-sep';
      sep.innerHTML = '<span>' + new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) + '</span>';
      this.chatList.appendChild(sep);
    }
    this._lastMsgTime = now;

    const isKit = label === 'Kit';
    const isPixel = label === 'Pixel';
    const div = document.createElement('div');
    div.className = `agent-msg agent-msg-${role}` + (isKit ? ' agent-msg-kit' : '') + (isPixel ? ' agent-msg-pixel' : '');

    const bubble = document.createElement('div');
    bubble.className = 'agent-bubble';
    bubble.innerHTML = renderMarkdown(content);
    if (imageUrl) {
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'margin-top:8px;max-width:100%;';
      const img = document.createElement('img'); img.src = imageUrl;
      img.style.cssText = 'max-width:100%;max-height:400px;border-radius:8px;cursor:pointer;';
      img.title = '点击查看大图';
      img.addEventListener('click', () => window.open(imageUrl, '_blank'));
      imgWrap.appendChild(img); bubble.appendChild(imgWrap);
    }
    if (dlButtons && dlButtons.length > 0) {
      const dlDiv = document.createElement('div');
      dlDiv.style.cssText = 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;';
      dlButtons.forEach(btn => {
        const m = btn.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (m) { const a = document.createElement('a'); a.href = m[2]; a.target = '_blank'; a.className = 'agent-dl-link'; a.textContent = m[1]; dlDiv.appendChild(a); }
      });
      bubble.appendChild(dlDiv);
    }

    const meta = document.createElement('div');
    meta.className = 'agent-meta';
    const labelText = role === 'user' ? '你' : (label || 'AI助手');
    meta.textContent = labelText;

    // 霓虹颜文字（AI 消息，按 label 分风格：Kit 颜文字 / Pixel emoji）
    if (role === 'assistant') {
      try {
        const moodName = detectMood(content);
        this._currentMood = moodName;
        this._currentLabel = label || 'AI助手';
        const faceData = getMood(this._currentLabel, moodName);
        const badge = document.createElement('span');
        badge.className = 'agent-mood-badge ' + (faceData.anim || '');
        badge.style.setProperty('--mood-color', faceData.color);
        badge.setAttribute('data-mood', moodName);
        badge.title = faceData.label;
        badge.textContent = faceData.face;
        meta.appendChild(badge);
      } catch (e) {
        console.warn('Mood badge in addMessage failed:', e);
      }
    }

    // 标签在气泡上方
    div.appendChild(meta);
    div.appendChild(bubble);
    if (role === 'assistant') this._addFeedbackBtns(div, bubble, label);
    this.chatList.appendChild(div);
    this._pkDecorate(div, role, content);
    this._pkSetEmpty(false);
    this._smartScroll(this.chatList);
  }

  addDebateStats(text) {
    const div = document.createElement('div');
    div.className = 'agent-debate-stats';
    div.textContent = text;
    this.chatList.appendChild(div);
    this._smartScroll(this.chatList);
    this._smartScroll(this.chatList);
  }

  /** 给 AI 气泡添加 👍👎 反馈按钮 */
  _addFeedbackBtns(container, bubble, speaker) {
    const btns = document.createElement('div');
    btns.className = 'agent-feedback';
    btns.innerHTML = '<button class="agent-fb-btn" data-rating="good" title="不错">👍</button><button class="agent-fb-btn" data-rating="bad" title="不好">👎</button>';
    container.appendChild(btns);

    const userMsg = this._lastUserMsg || '';
    const toast = this.toast;
    const userId = this.userId;

    btns.querySelectorAll('.agent-fb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return; // 已点过，忽略
        btns.querySelectorAll('.agent-fb-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (btn.dataset.rating === 'good') {
          toast.show('谢谢表扬！✨', 'success');
        } else {
          const replyText = bubble.querySelector('.agent-bubble-text')?.textContent || bubble.textContent || '';
          fetch('/api/agent/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId, rating: 'bad', speaker,
              message: userMsg,
              reply: replyText.slice(0, 500)
            })
          }).catch(() => {});
          toast.show('收到，我会改进的 ✍️', 'success');
        }
      });
    });
  }

  // ============ 语音输入（长按收音） ============
  startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || this._recognition) return;

    const rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    this._recognition = rec;
    this.voiceBtn.classList.add('active');

    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      this.chatInput.value = text;
    };

    rec.onend = () => {
      this.voiceBtn.classList.remove('active');
      this._recognition = null;
    };

    rec.onerror = () => {
      this.voiceBtn.classList.remove('active');
      this._recognition = null;
    };

    rec.start();
  }

  stopVoice() {
    if (this._recognition) {
      this._recognition.stop();
      this._recognition = null;
      this.voiceBtn.classList.remove('active');
    }
  }
}
