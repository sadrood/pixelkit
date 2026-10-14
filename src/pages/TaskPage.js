/** TaskPage — 双核驱动 v2：侧边栏·SVG图标·左色条卡片·进度条 */
export class TaskPage {
  constructor(toast) {
    this.toast = toast; this._inited = false; this.tasks = []; this._nid = 1;
    this.mode = 'kanban'; this._bin = false; this._eid = null; this._srch = '';
    this._fstatus = ''; this._fpri = ''; this._fquad = ''; this._ftag = '';
    this._saveT = null; this._selected = {}; this._isMobile = window.innerWidth < 900; this._viewOnly = false;
    this._smv = 'day'; this._smCur = new Date(); this._smDay = this._dStr(new Date()); this._smWeek = null;
    this._TAGS = ['工作', '个人', '紧急', '学习', '会议', '设计', '开发', '文档', 'BUG', '优化'];
    this._DEF_STS = [{ id: 'todo', t: '待处理', c: '#F59E0B' }, { id: 'doing', t: '进行中', c: '#3B82F6' }, { id: 'done', t: '已完成', c: '#10B981' }];
    this._STS = this._DEF_STS.slice();
    this._QUADS = [{ id: 'Q1', t: '重要且紧急', s: '立即处理', c: '#EF4444' }, { id: 'Q2', t: '重要不紧急', s: '计划安排', c: '#3B82F6' }, { id: 'Q3', t: '不重要但紧急', s: '授权他人', c: '#F59E0B' }, { id: 'Q4', t: '不重要不紧急', s: '尽量减少', c: '#6B7280' }];
    this._COLORS = ['#8B5CF6','#EC4899','#14B8A6','#F97316','#06B6D4','#A855F7','#F43F5E','#22C55E','#EAB308','#6366F1','#EF4444','#3B82F6','#10B981','#F59E0B','#6B7280'];
  }
  init() { if (this._inited) return; this._inited = true; this._load(); this._render(); this._bind(); this._refresh(); }
  _el(id) { return document.getElementById(id); }
  _save() { clearTimeout(this._saveT); this._saveT = setTimeout(() => { try { localStorage.setItem('pixelkit_tasks', JSON.stringify({ tasks: this.tasks, nid: this._nid, sts: this._STS.slice(this._DEF_STS.length) })); } catch (e) { } }, 300); }
  _load() { try { var d = JSON.parse(localStorage.getItem('pixelkit_tasks')); if (!d) return;
    // 脏数据清理：旧版「新建任务」会先写入一条空标题任务（看板里的"无标题"卡片），载入时直接丢弃
    var raw = Array.isArray(d.tasks) ? d.tasks : [];
    var clean = raw.filter(function (t) { return t && typeof t === 'object' && String(t.title || '').trim() !== ''; });
    var needSave = clean.length !== raw.length;
    this.tasks = clean; this._nid = d.nid || 1; var cs = d.sts || []; this._STS = this._DEF_STS.slice().concat(cs);
    // 兼容旧数据：已完成但缺完成时间的任务，用更新时间补上
    this.tasks.forEach(function (t) { if (t.status === 'done' && !t.completedAt && t.updatedAt) { t.completedAt = t.updatedAt; needSave = true; } });
    if (needSave) this._save(); } catch (e) { this.tasks = []; } }
  _esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  _tagColor(tag) { var h = 0; for (var i = 0; i < tag.length; i++) h = ((h << 5) - h) + tag.charCodeAt(i); return this._COLORS[Math.abs(h) % this._COLORS.length]; }
  _getCardColor(t) { if (t.color) return t.color; if (t.tags && t.tags.length) return this._tagColor(t.tags[0]); if (t.priority === 'high') return '#EF4444'; if (t.priority === 'medium') return '#F59E0B'; if (t.priority === 'low') return '#10B981'; var qd = this._QUADS.find(function (x) { return x.id === t.quadrant; }); return qd ? qd.c : '#6B7280'; }
  _fmtD(s) { if (!s) return ''; var d = new Date(s); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  _fmtDue(s) { if (!s) return ''; var d; if (String(s).length === 10) d = new Date(s + 'T00:00:00'); else d = new Date(s); if (isNaN(d.getTime())) return s; var h = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return String(s).length === 10 ? (d.getMonth() + 1) + '/' + d.getDate() : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + h; }
  _now() { return new Date().toISOString(); }
  _pad2(n) { return String(n).padStart(2, '0'); }
  _dStr(d) { return d.getFullYear() + '-' + this._pad2(d.getMonth() + 1) + '-' + this._pad2(d.getDate()); }
  _active() { return this.tasks.filter(function (t) { return !t.deletedAt; }); }
  _deleted() { return this.tasks.filter(function (t) { return !!t.deletedAt; }); }
  _filtered() { var list = this._bin ? this._deleted() : this._active(); var self = this; if (this._srch) { var q = this._srch.toLowerCase(); list = list.filter(function (t) { return (t.title || '').toLowerCase().indexOf(q) >= 0 || (t.content || '').toLowerCase().indexOf(q) >= 0 || (t.tags || []).some(function (x) { return x.toLowerCase().indexOf(q) >= 0; }); }); } if (this._fstatus) list = list.filter(function (t) { return t.status === self._fstatus; }); if (this._fpri) list = list.filter(function (t) { return t.priority === self._fpri; }); if (this._fquad) list = list.filter(function (t) { return t.quadrant === self._fquad; }); if (this._ftag) list = list.filter(function (t) { return (t.tags || []).indexOf(self._ftag) >= 0; }); list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }); return list; }
  _refresh() { this._renderSidebar(); if (this._bin || this.mode === 'list') this._renderList(); else if (this.mode === 'kanban') this._renderKanban(); else if (this.mode === 'matrix') this._renderMatrix(); else this._renderSummary(); this._renderMstat(); this._bindDrag(); }
  _renderMstat() { var e = document.getElementById('task-mstat'); if (e) e.remove(); if (!this._isMobile) return; var a = this._active(), tot = a.length, dn = a.filter(function (t) { return t.status === 'done'; }).length; var d = document.createElement('div'); d.id = 'task-mstat'; d.className = 'tk-mstat'; d.innerHTML = '<span>' + tot + ' 任务</span><span>' + dn + ' 完成</span><span>' + (tot ? Math.round(dn / tot * 100) : 0) + '%</span>'; this._el('task-root').appendChild(d); }
  // SVG icons
  _svg(id) { var m = { k: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="10" width="7" height="11" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>', q: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>', l: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6" stroke-width="3" stroke-linecap="round"/><line x1="3" y1="12" x2="3.01" y2="12" stroke-width="3" stroke-linecap="round"/><line x1="3" y1="18" x2="3.01" y2="18" stroke-width="3" stroke-linecap="round"/></svg>', s: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="20" x2="6" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>', plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>', trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>', cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="11" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="10" width="7" height="4" rx="1"/></svg>' }; return m[id] || ''; }
  // ==== 主渲染 ====
  _render() { var r = this._el('task-root'); r.className = 'tk-page'; var h = '<div class="tk-topbar"><div class="tk-topbar-l"><div class="tk-mode-tog">';
    h += '<button class="tk-mode-btn' + (this.mode === 'kanban' ? ' active' : '') + '" data-m="kanban">' + this._svg('k') + '看板</button>';
    h += '<button class="tk-mode-btn' + (this.mode === 'matrix' ? ' active' : '') + '" data-m="matrix">' + this._svg('q') + '四象限</button>';
    h += '<button class="tk-mode-btn' + (this.mode === 'list' ? ' active' : '') + '" data-m="list">' + this._svg('l') + '列表</button>';
    h += '<button class="tk-mode-btn' + (this.mode === 'summary' ? ' active' : '') + '" data-m="summary">' + this._svg('s') + '总结</button></div>';
    h += '<button class="tk-btn-new" id="task-add">' + this._svg('plus') + '新建任务</button>';
    if (!this._bin) h += '<button class="tk-btn-sm" id="task-batch-del" style="color:var(--danger)">' + this._svg('trash') + '批量删除</button>';
    h += '</div><div class="tk-topbar-r"><div class="tk-srch-wrap"><input type="text" id="task-srch" class="tk-srch" placeholder="搜索任务..." value="' + this._esc(this._srch) + '" />';
    if (this._srch) h += '<button class="tk-srch-clear" id="task-srch-clr">✕</button>'; h += '</div>';
    if (!this._bin) { var i; h += '<select id="task-fstatus" class="tk-sel"><option value="">全部状态</option>';
      for (i = 0; i < this._STS.length; i++) h += '<option value="' + this._STS[i].id + '"' + (this._fstatus === this._STS[i].id ? ' selected' : '') + '>' + this._STS[i].t + '</option>';
      h += '</select><select id="task-fpri" class="tk-sel"><option value="">全部优先级</option>';
      h += '<option value="high"' + (this._fpri === 'high' ? ' selected' : '') + '>高优先</option><option value="medium"' + (this._fpri === 'medium' ? ' selected' : '') + '>中优先</option><option value="low"' + (this._fpri === 'low' ? ' selected' : '') + '>低优先</option></select>';
      h += '<select id="task-fquad" class="tk-sel"><option value="">全部象限</option>';
      for (i = 0; i < this._QUADS.length; i++) h += '<option value="' + this._QUADS[i].id + '"' + (this._fquad === this._QUADS[i].id ? ' selected' : '') + '>' + this._QUADS[i].id + ' ' + this._QUADS[i].t + '</option>';
      h += '</select>'; }
    h += '</div></div><div class="tk-body"><div class="tk-sidebar" id="task-sidebar"></div><div class="tk-main" id="task-main"></div></div>';
    h += '<div class="tk-modal" id="task-modal"><div class="tk-modal-bg" id="task-modal-bg"></div><div class="tk-modal-box">';
    h += '<div class="tk-modal-hd"><h3 id="task-mtitle">编辑任务</h3><button type="button" class="tk-modal-close" id="task-ecancel">✕</button></div><div class="tk-ovrd-banner" id="task-ovrd-banner" style="display:none">⚠ 此任务已逾期，请尽快处理</div><div class="tk-modal-meta" id="task-mmeta"></div>';
    h += '<div class="tk-fg"><label for="task-etitle">任务标题</label><input type="text" id="task-etitle" placeholder="输入任务标题..." /></div>';
    h += '<div class="tk-fg"><label for="task-econtent">详细内容</label><textarea id="task-econtent" rows="3" placeholder="详细内容（可选）..."></textarea></div>';
    h += '<div class="tk-frow"><div class="tk-fg tk-fg-half"><label for="task-estatus">状态</label><select id="task-estatus">';
    for (i = 0; i < this._STS.length; i++) h += '<option value="' + this._STS[i].id + '">' + this._STS[i].t + '</option>';
    h += '</select></div><div class="tk-fg tk-fg-half"><label for="task-equad">象限</label><select id="task-equad">';
    for (i = 0; i < this._QUADS.length; i++) h += '<option value="' + this._QUADS[i].id + '">' + this._QUADS[i].t + '</option>';
    h += '</select></div></div><div class="tk-frow"><div class="tk-fg tk-fg-half"><label for="task-epri">优先级</label><select id="task-epri"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></div>';
    h += '<div class="tk-fg tk-fg-half"><label for="task-edue">截止时间</label><input type="datetime-local" id="task-edue" /></div></div>';
    h += '<div class="tk-fg"><label>卡片颜色</label><div class="tk-color-pick" id="task-ecolor"><span class="tk-cdot sel" data-c="" style="background:transparent" title="自动（按标签/优先级/象限）"></span>';
    for (i = 0; i < this._COLORS.length; i++) h += '<span class="tk-cdot" data-c="' + this._COLORS[i] + '" style="background:' + this._COLORS[i] + '" title="' + this._COLORS[i] + '"></span>';
    h += '</div></div><div class="tk-fg"><label for="task-etags">标签</label><div class="tk-tag-pick" id="task-etags">';
    for (i = 0; i < this._TAGS.length; i++) h += '<span class="tk-topt" data-t="' + this._TAGS[i] + '">' + this._TAGS[i] + '</span>';
    h += '</div><div class="tk-tag-add-wrap"><input type="text" id="task-etagnew" class="tk-tag-add-inp" placeholder="输入自定义标签后回车添加" /><button type="button" class="tk-tag-add-btn" id="task-etagadd">添加</button></div></div><div class="tk-modal-btns"><button type="button" class="btn btn-danger btn-sm" id="task-edel">删除</button><span style="flex:1"></span><button type="button" class="btn btn-sm" id="task-ecancel-cancel">取消</button><button type="button" class="btn btn-primary btn-sm" id="task-esave">保存</button></div></div></div>';
    r.innerHTML = h; }
  // ==== 侧边栏 ====
  _renderSidebar() { var sb = this._el('task-sidebar'); if (!sb) return; var a = this._active(), del = this._deleted(), tot = a.length, dn = a.filter(function (t) { return t.status === 'done'; }).length, pct = tot ? Math.round(dn / tot * 100) : 0, self = this, h = '', i;
    h += '<div class="tk-sb-sec"><div class="tk-sb-label">任务进展</div><div class="tk-sb-prog"><div class="tk-sb-prog-lbl"><span class="tk-sb-prog-tit">总进度</span><span class="tk-sb-prog-pct">' + pct + '%</span></div>';
    h += '<div class="tk-sb-prog-bar"><div class="tk-sb-prog-fill" style="width:' + pct + '%"></div></div>';
    h += '<div class="tk-sb-prog-meta"><span>' + dn + '/' + tot + ' 已完成</span><span>剩余 ' + (tot - dn) + '</span></div></div></div>';
    h += '<div class="tk-sb-sec"><div class="tk-sb-label">状态筛选</div>';
    h += '<div class="tk-sb-stat-all' + (!self._fstatus ? ' active' : '') + '" data-fs="">全部 <span class="tk-sb-stat-num">' + tot + '</span></div>';
    for (i = 0; i < this._STS.length; i++) { var s = this._STS[i], cnt = a.filter(function (t) { return t.status === s.id; }).length;
      h += '<div class="tk-sb-stat' + (self._fstatus === s.id ? ' active' : '') + '" data-fs="' + s.id + '"><span class="tk-sb-stat-dot" style="background:' + s.c + ';color:' + s.c + '"></span><span class="tk-sb-stat-txt">' + s.t + '</span><span class="tk-sb-stat-num">' + cnt + '</span></div>'; }
    h += '</div><div class="tk-sb-sec"><div class="tk-sb-label">标签</div><div class="tk-sb-tags" id="task-sb-tags">';
    var allTags = []; a.forEach(function (t) { (t.tags || []).forEach(function (tag) { if (allTags.indexOf(tag) < 0) allTags.push(tag); }); });
    for (i = 0; i < allTags.length; i++) { var tag = allTags[i], tcnt = a.filter(function (t) { return (t.tags || []).indexOf(tag) >= 0; }).length;
      h += '<span class="tk-sb-tag' + (self._ftag === tag ? ' active' : '') + '" data-ft="' + tag + '">' + tag + '<span class="tk-sb-tag-cnt">' + tcnt + '</span></span>'; }
    h += '</div></div><div class="tk-sb-bin' + (self._bin ? ' active' : '') + '" id="task-sb-bin">' + this._svg('trash') + '回收站<span class="tk-sb-bin-num">' + del.length + '</span></div>';
    sb.innerHTML = h; this._bindSidebar(); }
  _bindSidebar() { var self = this, sb = this._el('task-sidebar');
    sb.querySelectorAll('.tk-sb-stat, .tk-sb-stat-all').forEach(function (el) { el.addEventListener('click', function () { self._fstatus = this.dataset.fs; self._refresh(); }); });
    sb.querySelectorAll('.tk-sb-tag').forEach(function (el) { el.addEventListener('click', function () { var t = this.dataset.ft; self._ftag = self._ftag === t ? '' : t; self._refresh(); }); });
    var bin = sb.querySelector('#task-sb-bin'); if (bin) bin.addEventListener('click', function () { self._bin = !self._bin; self._selected = {}; self._srch = ''; self._fstatus = ''; self._fpri = ''; self._fquad = ''; self._ftag = ''; self._render(); self._bind(); self._refresh(); }); }
  // ==== 看板 ====
  _renderKanban() { var ct = this._el('task-main'); if (!ct) return; var list = this._filtered(), self = this; ct.className = 'tk-main tk-kanban'; var h = '';
    for (var i = 0; i < this._STS.length; i++) { var st = this._STS[i], cards = list.filter(function (t) { return t.status === st.id; }), custom = i >= this._DEF_STS.length;
      h += '<div class="tk-col' + (custom ? ' custom' : '') + '" data-status="' + st.id + '"><div class="tk-col-hd"><span class="tk-col-dot" style="background:' + st.c + ';color:' + st.c + '"></span><span class="tk-col-txt">' + st.t + '</span><span class="tk-col-cnt">' + cards.length + '</span>' + (custom ? '<button class="tk-col-del" data-sid="' + st.id + '" title="删除此列">✕</button>' : '') + '</div><div class="tk-col-body">';
      if (cards.length === 0) h += '<div class="tk-empty" style="padding:24px 8px;font-size:12px">拖拽任务到此处</div>';
      for (var j = 0; j < cards.length; j++) h += self._cardHTML(cards[j]);
      h += '</div></div>'; }
    h += '<button class="tk-col-add" id="task-col-add" title="添加自定义列">' + this._svg('plus') + '<span>添加列</span></button>';
    ct.innerHTML = h; this._bindCards(); this._bindColDel();
    var ca = this._el('task-col-add'); if (ca) ca.addEventListener('click', function () { self._addStatus(); }); }
  _addStatus() { var name = prompt('新列名称：'); if (!name) return; name = name.trim(); if (!name) return; if (this._STS.some(function (s) { return s.t === name; })) { this.toast.show('已存在同名状态列', 'error'); return; }
    var palette = ['#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#A855F7', '#F43F5E'], used = this._STS.map(function (s) { return s.c; }), c = palette.find(function (p) { return used.indexOf(p) < 0; }) || palette[this._STS.length % palette.length];
    this._STS.push({ id: 'c' + Date.now().toString(36), t: name, c: c }); this._save(); this._refresh(); this.toast.show('已添加列「' + name + '」', 'success'); }
  _removeStatus(sid) { var st = this._STS.find(function (s) { return s.id === sid; }); if (!st) return; var n = this._active().filter(function (t) { return t.status === sid; }).length;
    if (!confirm('删除列「' + st.t + '」？' + (n ? '\n该列下 ' + n + ' 个任务将移至「待处理」' : ''))) return; var self = this;
    this.tasks.forEach(function (t) { if (t.status === sid) { t.status = 'todo'; t.completedAt = null; t.updatedAt = self._now(); } });
    this._STS = this._STS.filter(function (s) { return s.id !== sid; }); if (this._fstatus === sid) this._fstatus = '';
    this._save(); this._refresh(); this.toast.show('已删除列「' + st.t + '」', 'success'); }
  _bindColDel() { var self = this; document.querySelectorAll('.tk-col-del').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self._removeStatus(this.dataset.sid); }); }); }
  _cardHTML(t) { var ovrd = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date(), c = this._getCardColor(t), pc = t.priority === 'high' ? '#EF4444' : t.priority === 'medium' ? '#F59E0B' : '#10B981', qd = this._QUADS.find(function (x) { return x.id === t.quadrant; }) || {};
    var h = '<div class="tk-card' + (t.status === 'done' ? ' done' : '') + '" data-tid="' + t.id + '" draggable="true" style="--accent:' + c + '">';
    h += '<div class="tk-card-chk"><input type="checkbox" class="tk-card-cb" data-tid="' + t.id + '"' + (this._selected[t.id] ? ' checked' : '') + ' /></div>';
    h += '<div class="tk-card-body"><div class="tk-card-title">' + this._esc(t.title || '无标题') + '</div>';
    if (t.content) h += '<div class="tk-card-desc">' + this._esc(t.content).slice(0, 80) + '</div>';
    h += '<div class="tk-card-meta"><span class="tk-pri-dot" style="background:' + pc + '" title="优先级"></span>';
    if (t.quadrant) h += '<span class="tk-quad-badge" style="border-color:' + (qd.c || '#6B7280') + ';color:' + (qd.c || '#6B7280') + '">' + t.quadrant + '</span>';
    if (t.dueDate) h += '<span class="tk-due' + (ovrd ? ' overdue' : '') + '">' + this._svg('cal') + this._fmtDue(t.dueDate) + '</span>';
    h += '</div>'; if (t.tags && t.tags.length) { h += '<div class="tk-card-tags">'; for (var k = 0; k < t.tags.length; k++) { var tc = this._tagColor(t.tags[k]); h += '<span style="background:' + tc + '22;color:' + tc + '">' + t.tags[k] + '</span>'; } h += '</div>'; }
    h += '</div></div>'; return h; }
  _bindCards() { var self = this; document.querySelectorAll('.tk-card').forEach(function (card) { var tid = parseInt(card.dataset.tid), body = card.querySelector('.tk-card-body'); if (body) body.addEventListener('dblclick', function () { self._openView(tid); }); var cb = card.querySelector('.tk-card-cb'); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); self._toggleSelect(tid); }); card.addEventListener('dragstart', function (e) { if (self._bin) return; card.classList.add('dragging'); e.dataTransfer.setData('text/plain', tid); }); card.addEventListener('dragend', function () { card.classList.remove('dragging'); }); }); }
  // ==== 四象限 ====
  _renderMatrix() { var ct = this._el('task-main'); if (!ct) return; var list = this._filtered(), self = this; ct.className = 'tk-main tk-matrix'; var h = '<div class="tk-mgrid">';
    for (var i = 0; i < this._QUADS.length; i++) { var q = this._QUADS[i], cards = list.filter(function (t) { return t.quadrant === q.id; }), bgR = q.c === '#EF4444' ? '239,68,68' : q.c === '#3B82F6' ? '59,130,246' : q.c === '#F59E0B' ? '245,158,11' : '107,114,128';
      h += '<div class="tk-mcell" data-quad="' + q.id + '" style="background:rgba(' + bgR + ',0.04)"><div class="tk-mcell-hd" style="color:' + q.c + '"><span class="tk-mcell-hd-t">' + q.id + ' · ' + q.t + '</span><span class="tk-mcell-hd-s">' + q.s + '</span><span class="tk-mcell-hd-c">' + cards.length + '</span></div><div class="tk-mcell-body">';
      if (cards.length === 0) h += '<div class="tk-empty" style="padding:16px 8px;font-size:11px">暂无任务</div>';
      for (var j = 0; j < cards.length; j++) h += self._mcardHTML(cards[j]);
      h += '</div></div>'; } h += '</div>'; ct.innerHTML = h; this._bindMCards(); }
  _mcardHTML(t) { var c = this._getCardColor(t), pc = t.priority === 'high' ? '#EF4444' : t.priority === 'medium' ? '#F59E0B' : '#10B981'; return '<div class="tk-mcard' + (t.status === 'done' ? ' done' : '') + '" data-tid="' + t.id + '" draggable="true" style="border-left:3px solid ' + c + '"><span class="tk-mcard-chk"><input type="checkbox" class="tk-card-cb" data-tid="' + t.id + '"' + (this._selected[t.id] ? ' checked' : '') + ' /></span><span class="tk-mcard-pri" style="background:' + pc + '"></span><span class="tk-mcard-t">' + this._esc(t.title || '无标题') + '</span></div>'; }
  _bindMCards() { var self = this; document.querySelectorAll('.tk-mcard').forEach(function (card) { var tid = parseInt(card.dataset.tid); card.addEventListener('dblclick', function () { self._openView(tid); }); var cb = card.querySelector('.tk-card-cb'); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); self._toggleSelect(tid); }); card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', tid); card.classList.add('dragging'); }); card.addEventListener('dragend', function () { card.classList.remove('dragging'); }); }); }
  // ==== 列表模式 ====
  _renderList() { var ct = this._el('task-main'); if (!ct) return; var list = this._filtered(), self = this; ct.className = 'tk-main tk-list'; var h = '';
    if (!this._bin) { h += '<div class="tk-lhdr"><span class="tk-lh-sel"><input type="checkbox" id="task-sel-all-cb" /></span><span class="tk-lh-tit">标题</span><span class="tk-lh-st">状态</span><span class="tk-lh-qu">象限</span><span class="tk-lh-pr">优先级</span><span class="tk-lh-du">截止</span><span class="tk-lh-ac">操作</span></div>'; }
    else { h += '<div class="tk-lhdr"><span class="tk-lh-sel"><input type="checkbox" id="task-sel-all-cb" /></span><span class="tk-lh-tit">标题</span><span class="tk-lh-st">删除时间</span><span class="tk-lh-ac">操作</span></div>'; }
    h += '<div class="tk-lbody">';
    if (list.length === 0) { h += '<div class="tk-empty">' + this._svg('empty') + '<span class="tk-empty-txt">' + (this._bin ? '回收站为空' : (this._srch || this._fstatus || this._ftag) ? '没有匹配的任务' : '还没有任务') + '</span>';
      if (!this._bin && !this._srch && !this._fstatus && !this._ftag) h += '<button class="tk-empty-btn" id="task-empty-add">创建第一个任务</button>'; h += '</div>'; }
    for (var i = 0; i < list.length; i++) { var t = list[i], ovrd = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date(), sc = this._STS.find(function (s) { return s.id === t.status; }) || {};
      h += '<div class="tk-lrow' + (t.status === 'done' ? ' done' : '') + (self._selected[t.id] ? ' selected' : '') + '" data-tid="' + t.id + '">';
      h += '<span class="tk-lh-sel"><input type="checkbox" class="tk-card-cb" data-tid="' + t.id + '"' + (self._selected[t.id] ? ' checked' : '') + ' /></span>';
      h += '<span class="tk-lh-tit"><span class="tk-lt-title">' + self._esc(t.title || '无标题') + '</span>';
      if (t.content) h += '<span class="tk-lt-desc">' + self._esc(t.content).slice(0, 50) + '</span>'; h += '</span>';
      if (self._bin) { h += '<span class="tk-lh-st">' + self._fmtD(t.deletedAt) + '</span><span class="tk-lh-ac"><button class="tk-lbtn tk-lbtn-restore" data-tid="' + t.id + '" data-act="restore">恢复</button><button class="tk-lbtn tk-lbtn-danger" data-tid="' + t.id + '" data-act="perm">永久删除</button></span>'; }
      else { h += '<span class="tk-lh-st"><span class="tk-lbadge" style="background:' + (sc.c || '#6B7280') + '">' + (sc.t || '-') + '</span></span>';
        h += '<span class="tk-lh-qu">' + (t.quadrant || '-') + '</span><span class="tk-lh-pr"><span class="tk-pri-dot" style="display:inline-block;background:' + (t.priority === 'high' ? '#EF4444' : t.priority === 'medium' ? '#F59E0B' : '#10B981') + '"></span></span>';
        h += '<span class="tk-lh-du"><span class="tk-due' + (ovrd ? ' overdue' : '') + '">' + (t.dueDate ? this._fmtDue(t.dueDate) : '-') + '</span></span>';
        h += '<span class="tk-lh-ac"><button class="tk-lbtn" data-tid="' + t.id + '" data-act="edit">编辑</button><button class="tk-lbtn tk-lbtn-danger" data-tid="' + t.id + '" data-act="del">删除</button></span>'; }
      h += '</div>'; } h += '</div>'; ct.innerHTML = h; this._bindListEvents(); }
  _bindListEvents() { var self = this, sa = this._el('task-sel-all-cb'); if (sa) sa.addEventListener('change', function () { self._toggleAll(this.checked); });
    document.querySelectorAll('.tk-lrow').forEach(function (row) { row.addEventListener('dblclick', function (e) { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; self._openView(parseInt(row.dataset.tid)); }); });
    document.querySelectorAll('.tk-card-cb').forEach(function (cb) { cb.addEventListener('change', function () { self._toggleSelect(parseInt(cb.dataset.tid)); }); });
    var ea = document.getElementById('task-empty-add'); if (ea) ea.addEventListener('click', function () { self._addTask(); });
    document.querySelectorAll('.tk-lbtn[data-act="edit"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self._openEdit(parseInt(b.dataset.tid)); }); });
    document.querySelectorAll('.tk-lbtn[data-act="del"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self._softDelete(parseInt(b.dataset.tid)); }); });
    document.querySelectorAll('.tk-lbtn[data-act="restore"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self._restore(parseInt(b.dataset.tid)); }); });
    document.querySelectorAll('.tk-lbtn[data-act="perm"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self._permanentDelete(parseInt(b.dataset.tid)); }); }); }
  // ==== CRUD ====
  /** 新建任务只打开弹窗，不写 localStorage；点「保存」且标题非空时才真正创建 */
  _addTask() { this._eid = null; this._draft = { id: null, title: '', content: '', status: 'todo', quadrant: 'Q1', priority: 'medium', tags: [], color: null, dueDate: null, createdAt: this._now(), updatedAt: this._now(), completedAt: null, deletedAt: null };
    this._fillModalData(this._draft, true); this._setViewMode(false, true); this._el('task-modal').classList.add('show'); var self = this; setTimeout(function () { var el = self._el('task-etitle'); if (el) el.focus(); }, 100); }
  _closeModal() { this._el('task-modal').classList.remove('show'); this._eid = null; this._draft = null; }
  _fillModal(tid) { var t = this.tasks.find(function (x) { return x.id === tid; }); if (!t) return; this._fillModalData(t, false); }
  _fillModalData(t, isNew) { if (!t) return; var meta = this._el('task-mmeta');
    var mtitle = this._el('task-mtitle'); if (mtitle) mtitle.textContent = isNew ? '新建任务' : '编辑任务';
    this._el('task-etitle').value = t.title || ''; this._el('task-econtent').value = t.content || ''; this._el('task-estatus').value = t.status || 'todo'; this._el('task-equad').value = t.quadrant || 'Q1'; this._el('task-epri').value = t.priority || 'medium'; this._el('task-edue').value = t.dueDate || '';
    var overdue = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date(), ovrdB = document.getElementById('task-ovrd-banner'); if (ovrdB) ovrdB.style.display = overdue ? '' : 'none';
    if (meta) { if (isNew) { meta.innerHTML = '<span>填写标题后点「保存」才会创建任务</span>'; } else { var mh = '<span>创建: ' + this._fmtD(t.createdAt) + '</span><span>更新: ' + this._fmtD(t.updatedAt) + '</span>'; if (t.completedAt) mh += '<span class="tk-meta-done">完成: ' + this._fmtD(t.completedAt) + '</span>'; meta.innerHTML = mh; } }
    var tp = this._el('task-etags'); tp.querySelectorAll('.tk-topt.custom').forEach(function (el) { el.remove(); });
    var self = this; (t.tags || []).forEach(function (tag) { if (self._TAGS.indexOf(tag) < 0 && !tp.querySelector('.tk-topt[data-t="' + self._esc(tag) + '"]')) { var el = document.createElement('span'); el.className = 'tk-topt custom'; el.dataset.t = tag; el.textContent = tag; el.addEventListener('click', function () { el.classList.toggle('sel'); }); tp.appendChild(el); } });
    tp.querySelectorAll('.tk-topt').forEach(function (el) { el.classList.toggle('sel', (t.tags || []).indexOf(el.dataset.t) >= 0); });
    var cp = this._el('task-ecolor'); if (cp) cp.querySelectorAll('.tk-cdot').forEach(function (dot) { dot.classList.toggle('sel', dot.dataset.c === (t.color || '')); });
    var delBtn = this._el('task-edel'); if (delBtn) delBtn.style.display = isNew ? 'none' : ''; }
  _setViewMode(on, isNew) { var self = this, mtitle = document.getElementById('task-mtitle'); if (mtitle) mtitle.textContent = on ? '查看任务' : (isNew ? '新建任务' : '编辑任务');
    ['task-etitle','task-econtent','task-edue'].forEach(function (id) { var el = document.getElementById(id); if (el) { if (on) el.setAttribute('readonly',''); else el.removeAttribute('readonly'); } });
    ['task-estatus','task-equad','task-epri'].forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = on; });
    document.querySelectorAll('#task-etags .tk-topt').forEach(function (el) { el.style.pointerEvents = on ? 'none' : ''; });
    var tagAdd = document.querySelector('.tk-tag-add-wrap'), saveBtn = document.getElementById('task-esave'), delBtn = document.getElementById('task-edel'), cnclBtn = document.getElementById('task-ecancel-cancel'), editBtn = document.getElementById('task-edit-btn'), cpWrap = document.getElementById('task-ecolor');
    if (tagAdd) tagAdd.style.display = on ? 'none' : '';
    if (cpWrap) { cpWrap.style.pointerEvents = on ? 'none' : ''; cpWrap.style.opacity = on ? '.4' : ''; }
    if (saveBtn) saveBtn.style.display = on ? 'none' : '';
    if (delBtn) delBtn.style.display = (on || isNew) ? 'none' : '';
    if (cnclBtn) cnclBtn.style.display = on ? 'none' : '';
    if (on) { if (!editBtn) { var btns = document.querySelector('#task-modal .tk-modal-btns'); if (btns) { var eb = document.createElement('button'); eb.type = 'button'; eb.id = 'task-edit-btn'; eb.className = 'btn btn-primary btn-sm'; eb.textContent = '编辑'; eb.addEventListener('click', function () { self._openEdit(self._eid); }); btns.appendChild(eb); } } else editBtn.style.display = ''; }
    else { if (editBtn) editBtn.style.display = 'none'; } }
  _openView(tid) { this._eid = tid; var t = this.tasks.find(function (x) { return x.id === tid; }); if (!t) return; this._draft = null; this._fillModal(tid); this._setViewMode(true); this._el('task-modal').classList.add('show'); }
  _openEdit(tid) { this._eid = tid; var t = this.tasks.find(function (x) { return x.id === tid; }); if (!t) return; this._draft = null; this._fillModal(tid); this._setViewMode(false); this._el('task-modal').classList.add('show'); var self = this; setTimeout(function () { self._el('task-etitle').focus(); }, 100); }
  _saveEdit() { var isNew = !this._eid; var t = isNew ? this._draft : this.tasks.find(function (x) { return x.id === this._eid; }.bind(this)); if (!t) return;
    // 标题为空的提交一律不落库（localStorage 一个字节都不写）
    var title = String(this._el('task-etitle').value || '').trim();
    if (!title) { this.toast.show('请先填写任务标题', 'error'); var ti = this._el('task-etitle'); if (ti) ti.focus(); return; }
    var oldStatus = t.status; t.title = title; t.content = this._el('task-econtent').value; t.status = this._el('task-estatus').value; t.quadrant = this._el('task-equad').value; t.priority = this._el('task-epri').value; t.dueDate = this._el('task-edue').value || null; var selDot = this._el('task-ecolor').querySelector('.tk-cdot.sel'); t.color = selDot ? (selDot.dataset.c || null) : null; t.tags = []; if (oldStatus !== 'done' && t.status === 'done') t.completedAt = this._now(); else if (oldStatus === 'done' && t.status !== 'done') t.completedAt = null; else if (t.status === 'done' && !t.completedAt) t.completedAt = this._now(); var self = this; this._el('task-etags').querySelectorAll('.tk-topt.sel').forEach(function (el) { t.tags.push(el.dataset.t); }); t.updatedAt = this._now();
    if (isNew) { t.id = this._nid++; t.deletedAt = null; t.createdAt = t.createdAt || this._now(); this.tasks.push(t); this._eid = t.id; this._draft = null; }
    this._el('task-modal').classList.remove('show'); this._refresh(); this._save();
    if (isNew) this.toast.show('任务已创建', 'success'); }
  _softDelete(tid) { if (this._bin) return; var t = this.tasks.find(function (x) { return x.id === tid; }); if (!t) return; t.deletedAt = this._now(); delete this._selected[tid]; this._save(); this._refresh(); this.toast.show('已移至回收站', 'success'); }
  _restore(tid) { var t = this.tasks.find(function (x) { return x.id === tid; }); if (!t) return; t.deletedAt = null; t.updatedAt = this._now(); delete this._selected[tid]; this._save(); this._refresh(); this.toast.show('已恢复', 'success'); }
  _permanentDelete(tid) { if (!confirm('确定永久删除？不可恢复！')) return; this.tasks = this.tasks.filter(function (t) { return t.id !== tid; }); delete this._selected[tid]; this._save(); this._refresh(); this.toast.show('已永久删除', 'success'); }
  _batchSoftDelete() { var ids = Object.keys(this._selected).filter(function (k) { return this._selected[k]; }.bind(this)); if (!ids.length) { this.toast.show('请先选择任务', 'error'); return; } if (!confirm('删除选中 ' + ids.length + ' 个任务？')) return; var now = this._now(), self = this; ids.forEach(function (id) { var t = self.tasks.find(function (x) { return x.id === parseInt(id); }); if (t && !t.deletedAt) t.deletedAt = now; }); this._selected = {}; this._save(); this._refresh(); this.toast.show('已删除 ' + ids.length + ' 个任务', 'success'); }
  _batchRestore() { var ids = Object.keys(this._selected).filter(function (k) { return this._selected[k]; }.bind(this)); if (!ids.length) { this.toast.show('请先选择任务', 'error'); return; } var self = this; ids.forEach(function (id) { var t = self.tasks.find(function (x) { return x.id === parseInt(id); }); if (t && t.deletedAt) { t.deletedAt = null; t.updatedAt = self._now(); } }); this._selected = {}; this._save(); this._refresh(); this.toast.show('已恢复 ' + ids.length + ' 个任务', 'success'); }
  _toggleSelect(tid) { if (this._selected[tid]) delete this._selected[tid]; else this._selected[tid] = true; }
  _toggleAll(on) { var self = this, list = this._filtered(); if (on) list.forEach(function (t) { self._selected[t.id] = true; }); else this._selected = {}; this._refresh(); }
  // ==== 事件绑定 ====
  _bind() { var R = this._el('task-root'), self = this;
    R.querySelectorAll('.tk-mode-btn').forEach(function (b) { b.addEventListener('click', function () { self.mode = this.dataset.m; R.querySelectorAll('.tk-mode-btn').forEach(function (x) { x.classList.toggle('active', x === b); }); self._refresh(); }); });
    document.getElementById('task-add').addEventListener('click', function () { self._addTask(); });
    var bd = document.getElementById('task-batch-del'); if (bd) bd.addEventListener('click', function () { if (self._bin) self._batchRestore(); else self._batchSoftDelete(); });
    var si = R.querySelector('#task-srch'); if (si) { var stT = null; si.addEventListener('input', function () { clearTimeout(stT); var v = si.value; stT = setTimeout(function () { self._srch = v.trim().toLowerCase(); self._refresh(); }, 250); }); }
    var clr = document.getElementById('task-srch-clr'); if (clr) clr.addEventListener('click', function () { self._srch = ''; self._render(); self._bind(); self._refresh(); });
    ['task-fstatus', 'task-fpri', 'task-fquad'].forEach(function (id) { var el = document.getElementById(id); if (el) { var key = id === 'task-fstatus' ? '_fstatus' : id === 'task-fpri' ? '_fpri' : '_fquad'; el.addEventListener('change', function () { self[key] = this.value; self._refresh(); }); } });
    document.getElementById('task-modal-bg').addEventListener('click', function () { self._closeModal(); });
    document.getElementById('task-ecancel').addEventListener('click', function () { self._closeModal(); });
    var ec2 = document.getElementById('task-ecancel-cancel'); if (ec2) ec2.addEventListener('click', function () { self._closeModal(); });
    document.getElementById('task-esave').addEventListener('click', function () { self._saveEdit(); });
    document.getElementById('task-edel').addEventListener('click', function () { if (self._eid) { self._softDelete(self._eid); self._closeModal(); } });
    var cp = document.getElementById('task-ecolor'); if (cp) cp.querySelectorAll('.tk-cdot').forEach(function (dot) { dot.addEventListener('click', function () { cp.querySelectorAll('.tk-cdot').forEach(function (d) { d.classList.remove('sel'); }); dot.classList.add('sel'); }); });
    R.querySelectorAll('.tk-topt').forEach(function (el) { el.addEventListener('click', function () { el.classList.toggle('sel'); }); });
    // 自定义标签添加
    var tagInp = document.getElementById('task-etagnew'), tagBtn = document.getElementById('task-etagadd');
    if (tagInp && tagBtn) { var addTag = function (e) { if (e && e.preventDefault) e.preventDefault(); if (e && e.stopPropagation) e.stopPropagation(); var v = tagInp.value.trim(); if (!v) return; var tp = document.getElementById('task-etags'); if (!tp || tp.querySelector('.tk-topt[data-t="' + self._esc(v) + '"]')) { tagInp.value = ''; return; } var el = document.createElement('span'); el.className = 'tk-topt custom sel'; el.dataset.t = v; el.textContent = v; el.addEventListener('click', function () { el.classList.toggle('sel'); }); tp.appendChild(el); tagInp.value = ''; }; tagBtn.addEventListener('click', addTag); tagInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(); } }); }
    window.addEventListener('resize', function () { var was = self._isMobile; self._isMobile = window.innerWidth < 900; if (was !== self._isMobile) { self._renderMstat(); self._renderSidebar(); } }); }
  _bindDrag() { var cols = document.querySelectorAll('.tk-col, .tk-mcell'), self = this; cols.forEach(function (c) { c.addEventListener('dragover', function (e) { e.preventDefault(); }); c.addEventListener('drop', function (e) { e.preventDefault(); var tid = parseInt(e.dataTransfer.getData('text/plain')), t = self.tasks.find(function (x) { return x.id === tid; }); if (!t) return; var st = c.dataset.status; if (st && t.status !== st) { if (st === 'done') t.completedAt = self._now(); else if (t.status === 'done') t.completedAt = null; t.status = st; t.updatedAt = self._now(); self._save(); self._refresh(); } var qd = c.dataset.quad; if (qd && t.quadrant !== qd) { t.quadrant = qd; t.updatedAt = self._now(); self._save(); self._refresh(); } }); });
    var bin = document.getElementById('task-sb-bin'); if (bin) { bin.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; bin.classList.add('dragover'); }); bin.addEventListener('dragleave', function () { bin.classList.remove('dragover'); }); bin.addEventListener('drop', function (e) { e.preventDefault(); bin.classList.remove('dragover'); var tid = parseInt(e.dataTransfer.getData('text/plain')); if (!tid) return; self._softDelete(tid); }); } }
  // ==== 总结记录（每日/每周） ====
  _doneAt(t) { return t.completedAt || t.updatedAt || t.createdAt; }
  _summaryDone() { return this._active().filter(function (t) { return t.status === 'done' && (t.completedAt || t.updatedAt); }); }
  _hours(t) { var a = new Date(t.createdAt).getTime(), b = new Date(t.completedAt || t.updatedAt).getTime(); return b > a ? Math.round((b - a) / 3600000 * 10) / 10 : 0; }
  _fmtDur(h) { if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分钟'; if (h < 24) return h + ' 小时'; return Math.round(h / 24 * 10) / 10 + ' 天'; }
  _weekStartOf(d) { var t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); t.setHours(0, 0, 0, 0); return t; }
  _fmtDayKey(k) { var d = new Date(k + 'T00:00:00'); return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()]; }
  _renderSummary() { var ct = this._el('task-main'); if (!ct) return; var self = this, done = this._summaryDone(); ct.className = 'tk-main tk-summary'; var h = '';
    h += '<div class="tk-sum-head"><div class="tk-sum-tabs"><button class="tk-sum-tab' + (this._smv === 'day' ? ' on' : '') + '" data-v="day">每日</button><button class="tk-sum-tab' + (this._smv === 'week' ? ' on' : '') + '" data-v="week">每周</button></div><span class="tk-sum-total">累计完成 <b>' + done.length + '</b> 个任务</span></div>';
    h += this._smv === 'day' ? this._sumCal(done) : this._sumWeeks(done);
    ct.innerHTML = h; this._bindSummary(); }
  _sumCal(done) { var self = this, m = this._smCur, y = m.getFullYear(), mo = m.getMonth(), byDay = {};
    done.forEach(function (t) { var k = self._dStr(new Date(self._doneAt(t))); (byDay[k] = byDay[k] || []).push(t); });
    var start = this._weekStartOf(new Date(y, mo, 1)), h = '';
    h += '<div class="tk-sum-nav"><button class="tk-sum-nav-btn" data-nav="prev" title="上一月">‹</button><span class="tk-sum-nav-tit">' + y + ' 年 ' + (mo + 1) + ' 月</span><button class="tk-sum-nav-btn" data-nav="next" title="下一月">›</button></div>';
    h += '<div class="tk-cal"><div class="tk-cal-hd"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>';
    for (var i = 0; i < 42; i++) { var d = new Date(start); d.setDate(start.getDate() + i); var k = this._dStr(d), inM = d.getMonth() === mo, cnt = (byDay[k] || []).length, sel = this._smDay === k;
      h += '<div class="tk-cal-d' + (inM ? '' : ' out') + (sel ? ' sel' : '') + (cnt ? ' has' : '') + '" data-day="' + k + '"><span class="tk-cal-n">' + d.getDate() + '</span>' + (cnt ? '<i class="tk-cal-dot"></i>' : '') + '</div>'; }
    h += '</div>';
    if (byDay[this._smDay] && this._smDay.slice(0, 7) === y + '-' + this._pad2(mo + 1)) h += this._sumReport(this._smDay, byDay[this._smDay], false);
    return h; }
  _sumWeeks(done) { var self = this, weeks = {};
    done.forEach(function (t) { var k = self._dStr(self._weekStartOf(new Date(self._doneAt(t)))); (weeks[k] = weeks[k] || []).push(t); });
    var keys = Object.keys(weeks).sort().reverse(), h = '<div class="tk-sum-weeklist">';
    keys.forEach(function (k) { var tasks = weeks[k], s = new Date(k + 'T00:00:00'), e = new Date(s); e.setDate(e.getDate() + 6);
      h += '<div class="tk-sum-week' + (self._smWeek === k ? ' on' : '') + '" data-wk="' + k + '"><span class="tk-sum-week-t">' + (s.getMonth() + 1) + '/' + s.getDate() + ' - ' + (e.getMonth() + 1) + '/' + e.getDate() + '</span><span class="tk-sum-week-c">' + tasks.length + ' 个任务</span></div>'; });
    if (!keys.length) h += '<div class="tk-empty" style="padding:32px">暂无已完成任务</div>';
    h += '</div>';
    if (this._smWeek && weeks[this._smWeek]) h += this._sumReport(this._smWeek, weeks[this._smWeek], true);
    return h; }
  _sumReport(key, tasks, isWeek) { var self = this, n = tasks.length, hrs = tasks.map(function (t) { return self._hours(t); });
    var sum = hrs.reduce(function (a, b) { return a + b; }, 0), avg = n ? Math.round(sum / n * 10) / 10 : 0;
    var quads = {}, qc = { Q1: '#EF4444', Q2: '#3B82F6', Q3: '#F59E0B', Q4: '#6B7280' }, pri = {};
    tasks.forEach(function (t) { var q = t.quadrant || 'Q?'; quads[q] = (quads[q] || 0) + 1; var p = t.priority || 'medium'; pri[p] = (pri[p] || 0) + 1; });
    var qNames = { Q1: '重要且紧急', Q2: '重要不紧急', Q3: '不重要但紧急', Q4: '不重要不紧急', 'Q?': '未设置' }, pNames = { high: '高', medium: '中', low: '低' };
    var qData = Object.keys(quads).map(function (q) { return { label: qNames[q] || q, value: quads[q], color: qc[q] || '#8B5CF6' }; });
    var qHtml = qData.map(function (d) { return '<div class="tk-legend"><i style="background:' + d.color + '"></i>' + d.label + '<b>' + d.value + '</b></div>'; }).join('');
    var priHtml = Object.keys(pri).map(function (p) { return pNames[p] + ' <b>' + pri[p] + '</b>'; }).join(' · ');
    var h = '<div class="tk-report"><div class="tk-report-hd">' + (isWeek ? '本周总结' : this._fmtDayKey(key)) + '<span class="tk-report-sub">共完成 ' + n + ' 个任务</span></div>';
    h += '<div class="tk-kpis"><div class="tk-kpi"><b>' + n + '</b><span>完成数量</span></div><div class="tk-kpi"><b>' + (n ? this._fmtDur(avg) : '-') + '</b><span>平均耗时</span></div><div class="tk-kpi"><b>' + (n ? this._fmtDur(sum) : '-') + '</b><span>累计耗时</span></div></div>';
    if (isWeek) { var wk = new Date(key + 'T00:00:00'), bar = '';
      for (var i = 0; i < 7; i++) { var d = new Date(wk); d.setDate(wk.getDate() + i); var k = this._dStr(d), cnt = tasks.filter(function (t) { return self._dStr(new Date(self._doneAt(t))) === k; }).length; bar += '<div class="tk-bar-v"><div class="tk-bar-v-fill" style="height:' + (cnt ? Math.max(8, cnt / 5 * 100) : 2) + '%"></div><span>' + '日一二三四五六'[d.getDay()] + '</span><b>' + (cnt || '') + '</b></div>'; }
      h += '<div class="tk-chart wk"><div class="tk-chart-t">每日完成量</div><div class="tk-bar-vert">' + bar + '</div></div>'; }
    h += '<div class="tk-charts"><div class="tk-chart"><div class="tk-chart-t">类型分布</div><div class="tk-donut-wrap">' + this._donut(qData, n) + '<div class="tk-legend-box">' + (qHtml || '<div class="tk-empty">无</div>') + '</div></div><div class="tk-pri-line">优先级：' + (priHtml || '无') + '</div></div>';
    h += '<div class="tk-chart"><div class="tk-chart-t">耗时分析</div>' + (n ? this._barH(tasks) : '<div class="tk-empty">无</div>') + '</div></div>';
    h += '<div class="tk-sum-list"><div class="tk-chart-t">完成记录</div>';
    tasks.slice().sort(function (a, b) { return String(self._doneAt(b)).localeCompare(String(self._doneAt(a))); }).forEach(function (t) {
      var qd = qc[t.quadrant] || '#8B5CF6';
      h += '<div class="tk-sum-item"><span class="tk-sum-item-bar" style="background:' + qd + '"></span><div class="tk-sum-item-m"><span class="tk-sum-item-t">' + self._esc(t.title || '无标题') + '</span>' + (t.tags && t.tags.length ? '<span class="tk-sum-item-tags">' + t.tags.map(function (x) { return '#' + self._esc(x); }).join(' ') + '</span>' : '') + '</div><span class="tk-sum-item-dur">' + self._fmtDur(self._hours(t)) + '</span></div>'; });
    h += '</div></div>';
    return h; }
  _donut(data, total) { if (!total) return '<div class="tk-empty">无数据</div>'; var cx = 60, cy = 60, R = 50, a = -Math.PI / 2, segs = '';
    data.forEach(function (d) { var ang = d.value / total * Math.PI * 2, x1 = cx + R * Math.cos(a), y1 = cy + R * Math.sin(a), x2 = cx + R * Math.cos(a + ang), y2 = cy + R * Math.sin(a + ang), big = ang > Math.PI ? 1 : 0; segs += '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' + d.color + '"/>'; a += ang; });
    return '<svg viewBox="0 0 120 120" width="132" height="132" style="flex-shrink:0">' + segs + '<circle cx="60" cy="60" r="30" fill="var(--surface)"/><text x="60" y="66" text-anchor="middle" font-size="18" font-weight="700" fill="currentColor">' + total + '</text></svg>'; }
  _barH(tasks) { var self = this, max = Math.max.apply(null, tasks.map(function (t) { return self._hours(t); })) || 1, sorted = tasks.slice().sort(function (a, b) { return self._hours(b) - self._hours(a); }).slice(0, 8), h = '';
    sorted.forEach(function (t) { var v = self._hours(t), w = Math.max(3, Math.round(v / max * 100)); h += '<div class="tk-bar-row"><span class="tk-bar-lbl" title="' + self._esc(t.title || '') + '">' + self._esc((t.title || '无标题').slice(0, 14)) + '</span><div class="tk-bar-tr"><div class="tk-bar-fill" style="width:' + w + '%"></div></div><span class="tk-bar-val">' + self._fmtDur(v) + '</span></div>'; });
    return h; }
  _bindSummary() { var self = this, ct = this._el('task-main'); if (!ct) return;
    ct.querySelectorAll('.tk-sum-tab').forEach(function (b) { b.addEventListener('click', function () { self._smv = this.dataset.v; self._refresh(); }); });
    ct.querySelectorAll('.tk-sum-nav-btn').forEach(function (b) { b.addEventListener('click', function () { var m = new Date(self._smCur); m.setDate(1); if (this.dataset.nav === 'prev') m.setMonth(m.getMonth() - 1); else m.setMonth(m.getMonth() + 1); self._smCur = m; self._refresh(); }); });
    ct.querySelectorAll('.tk-cal-d').forEach(function (d) { d.addEventListener('click', function () { self._smDay = this.dataset.day; self._refresh(); }); });
    ct.querySelectorAll('.tk-sum-week').forEach(function (w) { w.addEventListener('click', function () { self._smWeek = this.dataset.wk; self._refresh(); }); }); }
}
