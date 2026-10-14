import { useState, useRef, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-editor-react';
import { parseDocx } from '@eigenpal/docx-editor-core';
import { toProseDoc } from '@eigenpal/docx-editor-core/prosemirror/conversion';
import zhCN from '@eigenpal/docx-editor-i18n/zh-CN';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ySyncPlugin, yCursorPlugin, prosemirrorToYXmlFragment, ySyncPluginKey } from 'y-prosemirror';
import { DocDrawing } from './DocDrawing.js';
import '@eigenpal/docx-editor-react/styles.css';

// 协同 WebSocket：开发直连 3001，生产走同域 Nginx 代理
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const COLLAB_URL = isLocal
  ? `ws://${window.location.hostname}:3001/collab`
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`;

function getRoomFromURL() {
  return new URLSearchParams(window.location.search).get('room') || null;
}

// 协作者配色池：每人随机分配一个，用于区分不同人的光标/输入
const USER_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f43f5e'];

// 复制到剪贴板：优先 Clipboard API，非 HTTPS 环境回退到 execCommand
function copyText(text) {
  return new Promise((resolve, reject) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(resolve).catch(() => fallbackCopy(text, resolve, reject));
    } else {
      fallbackCopy(text, resolve, reject);
    }
  });
}

function fallbackCopy(text, resolve, reject) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) resolve();
    else reject(new Error('copy failed'));
  } catch (e) {
    reject(e);
  }
}

// 构建一个绑定了内容的 Y.Doc：yFragment 作为正文的唯一事实来源
function buildYdocWith(pmDoc) {
  const ydoc = new Y.Doc();
  const yfrag = ydoc.getXmlFragment('doc');
  if (pmDoc) prosemirrorToYXmlFragment(pmDoc, yfrag);
  return { ydoc, yfrag };
}

function buildPlugins(yfrag, awareness) {
  const plugins = [ySyncPlugin(yfrag)];
  if (awareness) plugins.push(yCursorPlugin(awareness, { cursorBuilder: minimalCursorBuilder }));
  plugins.push(authorAttributionPlugin(makeAuthorResolver(awareness, yfrag.doc.clientID)));
  return plugins;
}

// 远程光标：只显示彩色竖线，悬停才显示名字（避免常驻名字标签挡住文字）
function minimalCursorBuilder(user) {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.setAttribute('style', `border-color: ${user.color};`);
  cursor.title = user.name || '';
  cursor.insertBefore(document.createTextNode('\u2060'), null);
  return cursor;
}

// ==================== 内容作者归属标注 ====================
// 遍历 Yjs 文本内容，读取每个字符片段的作者 clientId，映射到 ProseMirror 位置，
// 用彩色下划线标注「这段是谁写的」，悬停显示作者名。

function makeAuthorResolver(awareness, selfClientId) {
  return (clientId) => {
    if (clientId === selfClientId) return null; // 自己写的不标注
    const state = awareness?.getStates?.()?.get(clientId);
    const name = state?.user?.name || ('协作者' + clientId);
    const color = USER_COLORS[Math.abs(clientId) % USER_COLORS.length];
    return { name, color };
  };
}

function authorAttributionPlugin(resolveAuthor) {
  return new Plugin({
    props: {
      decorations(state) {
        return computeAuthorDecorations(state, resolveAuthor);
      },
    },
  });
}

// 读取一个 Y.XmlText 中每个字符片段的作者与区间（相对该文本起点）
function getYTextAuthorRanges(yText) {
  const ranges = [];
  let n = yText._start;
  let offset = 0;
  while (n !== null) {
    if (!n.deleted && n.countable && n.content instanceof Y.ContentString) {
      const len = n.content.str.length;
      if (len > 0) {
        const clientId = n.id.client;
        const last = ranges[ranges.length - 1];
        if (last && last.clientId === clientId && last.start + last.length === offset) {
          last.length += len;
        } else {
          ranges.push({ clientId, start: offset, length: len });
        }
      }
      offset += len;
    }
    n = n.right;
  }
  return ranges;
}

function computeAuthorDecorations(state, resolveAuthor) {
  const syncState = ySyncPluginKey.getState(state);
  const yfrag = syncState?.type;
  if (!yfrag) return DecorationSet.empty;

  // 按文档顺序收集每个文本片段的作者与字符区间（相对完整正文）
  const spans = [];
  collectAuthorSpans(yfrag, 0, spans);
  if (spans.length === 0) return DecorationSet.empty;

  // 收集文档里所有文本节点的位置，用于把字符偏移映射到 PM 位置
  const docTexts = [];
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text) docTexts.push({ pos, text: node.text });
  });

  const charToPos = (charOffset) => {
    let acc = 0;
    for (const t of docTexts) {
      const len = t.text.length;
      if (charOffset <= acc + len) return t.pos + (charOffset - acc);
      acc += len;
    }
    return null;
  };

  const decos = [];
  for (const span of spans) {
    const info = resolveAuthor(span.clientId);
    if (!info) continue;
    const from = charToPos(span.from);
    const to = charToPos(span.to);
    if (from != null && to != null && to > from) {
      decos.push(Decoration.inline(from, to, {
        class: 'docx-author-mark',
        style: `box-shadow: inset 0 -2px 0 0 ${info.color};`,
        title: '作者：' + info.name,
      }));
    }
  }
  return DecorationSet.create(state.doc, decos);
}

// 递归遍历 Yjs 片段，累积每个文本片段的字符偏移与作者
function collectAuthorSpans(yfrag, offset, out) {
  const arr = yfrag.toArray();
  for (const child of arr) {
    if (child instanceof Y.XmlText) {
      const ranges = getYTextAuthorRanges(child);
      for (const r of ranges) {
        out.push({ from: offset + r.start, to: offset + r.start + r.length, clientId: r.clientId });
      }
      offset += child.length;
    } else if (child instanceof Y.XmlElement) {
      offset = collectAuthorSpans(child, offset, out);
    }
  }
  return offset;
}

// 整体替换协同正文内容（新建 / 打开文件时使用）
function setFragmentContent(yfrag, pmDoc) {
  yfrag.doc.transact(() => {
    yfrag.delete(0, yfrag.length);
    prosemirrorToYXmlFragment(pmDoc, yfrag);
  });
}

export class DocxEditorPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
  }
  init() {
    if (this._inited) return;
    this._inited = true;
    const rootEl = document.getElementById('docx-editor-root');
    if (!rootEl) return;
    const root = createRoot(rootEl);
    const toast = this.toast;
    const actions = { current: {} };
    root.render(<DocxEditorApp toast={toast} actions={actions} />);
    const get = (key) => () => actions.current[key]?.();
    document.getElementById('btn-docx-new')?.addEventListener('click', get('newDoc'));
    document.getElementById('btn-docx-open')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.docx';
      input.onchange = (e) => { if (e.target.files?.[0]) actions.current.upload?.(e.target.files[0]); };
      input.click();
    });
    document.getElementById('btn-docx-collab')?.addEventListener('click', get('toggleCollab'));
    document.getElementById('btn-docx-share')?.addEventListener('click', get('share'));
    document.getElementById('btn-docx-feedback')?.addEventListener('click', get('feedback'));
    document.getElementById('btn-docx-draw')?.addEventListener('click', get('togglePen'));
    document.getElementById('btn-docx-rename')?.addEventListener('click', get('rename'));
  }
}

// 在线文档内嵌涂鸦层：直接在文档页面上画，随文档滚动、联机同步
function DocDrawingHost({ root, ydoc, docKey, toast, active, onDeactivate }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!root || !ydoc) return;
    const drawing = new DocDrawing({ root, ydoc, toast, onDeactivate });
    drawing.mount();
    ref.current = drawing;
    return () => { drawing.destroy(); ref.current = null; };
  }, [root, ydoc, docKey, toast, onDeactivate]);

  useEffect(() => {
    ref.current?.setActive(active);
  }, [active, docKey]);

  return null;
}

function DocxEditorApp({ toast, actions }) {
  const [seedDoc, setSeedDoc] = useState(null);
  const [plugins, setPlugins] = useState([]);
  const [docKey, setDocKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [docId, setDocId] = useState(null);
  const [userName, setUserName] = useState(() => {
    const saved = localStorage.getItem('pk_username');
    return saved || ('用户' + Math.random().toString(36).substring(2, 6).toUpperCase());
  });
  const [collabActive, setCollabActive] = useState(false);
  const [peers, setPeers] = useState([]);
  const [showShare, setShowShare] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [penActive, setPenActive] = useState(false);
  const ydocRef = useRef(null);
  const yFragmentRef = useRef(null);
  const providerRef = useRef(null);
  const awarenessRef = useRef(null);
  const pluginsSetRef = useRef(false);
  const userColorRef = useRef(USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]);
  // 只在首次挂载时读取一次：避免创建房间后 URL 变化导致误入"等待加入房间"界面
  const [roomFromURL] = useState(() => getRoomFromURL());

  const updateCollabUI = useCallback((active) => {
    const btn = document.getElementById('btn-docx-collab');
    const shareBtn = document.getElementById('btn-docx-share');
    if (btn) btn.textContent = active ? '👥 断开' : '👤 协同';
    if (shareBtn) shareBtn.style.display = active ? '' : 'none';
  }, []);

  // 在线协作者同步到 DOM（带各自颜色圆点，区分不同人）
  useEffect(() => {
    const badge = document.getElementById('docx-peers-badge');
    if (!badge) return;
    if (peers.length > 0) {
      badge.style.display = 'inline-flex';
      badge.innerHTML = '';
      peers.forEach((p) => {
        const s = document.createElement('span');
        s.className = 'docx-peer';
        const dot = document.createElement('span');
        dot.className = 'docx-peer-dot';
        dot.style.background = p.color;
        s.appendChild(dot);
        s.appendChild(document.createTextNode(p.name));
        badge.appendChild(s);
      });
    } else {
      badge.style.display = 'none';
    }
  }, [peers]);

  // 接入 provider 的事件：连接状态 + 在线人数 + 本地用户信息
  const wireProvider = useCallback((provider, roomId) => {
    provider.on('status', (e) => {
      if (e.status === 'connected') {
        setCollabActive(true);
        updateCollabUI(true);
        toast?.show(`已加入房间: ${roomId}`, 'success');
      }
      if (e.status === 'disconnected') { setCollabActive(false); updateCollabUI(false); }
    });
    provider.awareness.on('change', () => {
      const states = [];
      provider.awareness.getStates().forEach((state) => {
        if (state.user) states.push({ name: state.user.name || '匿名', color: state.user.color || '#6366f1' });
      });
      setPeers(states);
    });
    provider.awareness.setLocalStateField('user', { name: userName, color: userColorRef.current });
  }, [toast, updateCollabUI, userName]);

  // 启动协同：在现有 ydoc 上挂 provider，并加入远程光标插件（重挂载使插件生效）
  const startCollab = useCallback((roomId) => {
    if (providerRef.current || !ydocRef.current) return;
    const provider = new WebsocketProvider(COLLAB_URL, roomId, ydocRef.current, { connect: true, maxBackoffTime: 5000 });
    providerRef.current = provider;
    awarenessRef.current = provider.awareness;
    wireProvider(provider, roomId);
    setPlugins(buildPlugins(yFragmentRef.current, provider.awareness));
    pluginsSetRef.current = true;
    setDocKey((k) => k + 1);
  }, [wireProvider]);

  const stopCollab = useCallback(() => {
    providerRef.current?.destroy();
    providerRef.current = null;
    awarenessRef.current = null;
    setPeers([]); setCollabActive(false);
    updateCollabUI(false);
    // 去掉远程光标插件（重挂载）
    if (yFragmentRef.current) {
      setPlugins(buildPlugins(yFragmentRef.current, null));
      pluginsSetRef.current = true;
      setDocKey((k) => k + 1);
    }
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
  }, [updateCollabUI]);

  // 挂载时同步创建本地 Y.Doc：新建/打开/加入房间均基于它；卸载时统一断开并销毁
  useEffect(() => {
    const { ydoc, yfrag } = buildYdocWith(null);
    ydocRef.current = ydoc;
    yFragmentRef.current = yfrag;
    return () => {
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current?.destroy();
      ydocRef.current = null;
    };
  }, []);

  // 链接进入房间：先同步，再挂载编辑器
  useEffect(() => {
    if (!roomFromURL) return;
    let cancelled = false;
    setLoading(true);
    setDocId(roomFromURL);
    const ydoc = ydocRef.current;
    const yfrag = yFragmentRef.current;
    const provider = new WebsocketProvider(COLLAB_URL, roomFromURL, ydoc, { connect: true, maxBackoffTime: 5000 });
    providerRef.current = provider;
    awarenessRef.current = provider.awareness;
    wireProvider(provider, roomFromURL);

    let finalized = false;
    const finalize = async () => {
      if (finalized || cancelled) return;
      finalized = true;
      try {
        // 房间为空时补一个空文档，保证编辑器有合法的初始内容
        if (yfrag.length === 0) {
          const empty = await createEmptyDocument();
          prosemirrorToYXmlFragment(toProseDoc(empty), yfrag);
        }
        const seed = await createEmptyDocument();
        setSeedDoc(seed);
        setPlugins(buildPlugins(yfrag, provider.awareness));
        pluginsSetRef.current = true;
      } finally {
        setLoading(false);
      }
    };
    provider.on('sync', (synced) => { if (synced) finalize(); });
    const timer = setTimeout(finalize, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [roomFromURL, wireProvider]);

  // 首次从欢迎页进入编辑器时，初始化 seedDoc + 插件；正文内容写入协同片段
  const bootstrap = useCallback(async (pmDoc) => {
    const yfrag = yFragmentRef.current;
    if (yfrag) setFragmentContent(yfrag, pmDoc);
    if (!pluginsSetRef.current) {
      const seed = await createEmptyDocument();
      setSeedDoc(seed);
      setPlugins(buildPlugins(yfrag, awarenessRef.current));
      pluginsSetRef.current = true;
    }
    setLoading(false);
  }, []);

  // 新建空白文档：替换协同正文（若在协同中会同步给所有人）
  const newDoc = useCallback(async () => {
    try {
      const doc = await createEmptyDocument();
      await bootstrap(toProseDoc(doc));
    } catch { toast?.show('创建失败', 'error'); }
  }, [bootstrap, toast]);

  // 打开 .docx：解析正文后替换协同内容
  const upload = useCallback(async (file) => {
    if (!file.name.endsWith('.docx')) { toast?.show('请上传 .docx', 'error'); return; }
    try {
      const buffer = await file.arrayBuffer();
      const doc = await parseDocx(buffer);
      await bootstrap(toProseDoc(doc));
      toast?.show('文档已打开', 'success');
    } catch (e) {
      toast?.show('打开失败: ' + (e.message || '文件解析错误'), 'error');
    }
  }, [bootstrap, toast]);

  const toggleCollab = useCallback(() => {
    if (providerRef.current) { stopCollab(); toast?.show('已退出协同', 'success'); }
    else {
      const roomId = docId || 'doc_' + Math.random().toString(36).substring(2, 10);
      setDocId(roomId);
      startCollab(roomId);
    }
  }, [docId, startCollab, stopCollab, toast]);

  const share = useCallback(() => {
    const currentId = docId;
    if (!currentId) { toast?.show('请先开启协同', 'error'); return; }
    const url = new URL(window.location);
    url.searchParams.set('room', currentId);
    setShareLink(url.toString()); setShowShare(true);
    copyText(url.toString())
      .then(() => toast?.show('邀请链接已复制', 'success'))
      .catch(() => toast?.show('自动复制失败，请手动选中链接复制', 'error'));
  }, [docId, toast]);

  const feedback = useCallback(() => setShowFeedback(true), []);
  const togglePen = useCallback(() => setPenActive((v) => !v), []);
  const deactivatePen = useCallback(() => setPenActive(false), []);
  const rename = useCallback(() => {
    const name = window.prompt('请输入你的名字（协作者们会看到）:', userName);
    if (!name || !name.trim()) return;
    const n = name.trim().slice(0, 16);
    setUserName(n);
    localStorage.setItem('pk_username', n);
    if (awarenessRef.current) {
      awarenessRef.current.setLocalStateField('user', { name: n, color: userColorRef.current });
    }
    toast?.show('名字已更新：' + n, 'success');
  }, [userName, toast]);

  useEffect(() => {
    const el = document.getElementById('docx-user-name');
    if (el) el.textContent = userName;
  }, [userName]);

  useEffect(() => { actions.current = { upload, newDoc, toggleCollab, share, feedback, setShowFeedback, togglePen, rename }; });

  const handleFeedbackSubmit = useCallback(async () => {
    if (!feedbackText.trim()) return;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: feedbackText.trim(), page: 'docx-editor', time: new Date().toISOString() }),
      });
      if (res.ok) {
        setFeedbackSent(true); toast?.show('反馈已发送！', 'success');
        setTimeout(() => { setShowFeedback(false); setFeedbackSent(false); setFeedbackText(''); }, 1500);
      } else { toast?.show('发送失败', 'error'); }
    } catch { toast?.show('网络错误', 'error'); }
  }, [feedbackText, toast]);

  // 双击页面缝隙折叠 / 展开页间距（Google Docs 风格）
  useEffect(() => {
    if (!seedDoc) return;
    const root = document.getElementById('docx-editor-root');
    if (!root) return;
    let compact = false;

    const applyCompact = (pagesEl) => {
      if (!pagesEl) return;
      if (compact) {
        pagesEl.style.gap = '2px';
        pagesEl.style.padding = '2px';
      } else {
        pagesEl.style.gap = '';
        pagesEl.style.padding = '';
      }
    };

    // 页面重绘会重置 gap/padding，监听 style 变化并重新套用
    let observer = null;
    const ensureObserver = (pagesEl) => {
      if (observer) observer.disconnect();
      if (!pagesEl) return;
      observer = new MutationObserver(() => applyCompact(pagesEl));
      observer.observe(pagesEl, { attributes: true, attributeFilter: ['style'] });
      applyCompact(pagesEl);
    };

    const findPages = () => root.querySelector('.paged-editor__pages');
    const timer = window.setInterval(() => {
      const el = findPages();
      if (el) { clearInterval(timer); ensureObserver(el); }
    }, 250);

    const onDblClick = (e) => {
      const pagesEl = findPages();
      if (!pagesEl) return;
      const pages = Array.from(pagesEl.querySelectorAll('.layout-page'));
      if (pages.length < 2) return;

      // 判断双击点是否落在页面之间的缝隙（不在任何页面内部）
      const inPage = pages.some((p) => {
        const r = p.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
      });
      if (compact) {
        // 紧凑模式：双击靠近页缝（±14px）处恢复
        const nearSeam = pages.slice(0, -1).some((p) => {
          const r = p.getBoundingClientRect();
          return Math.abs(e.clientY - r.bottom) <= 14;
        });
        if (nearSeam) { compact = false; ensureObserver(pagesEl); toast?.show('已展开页间距', 'success'); }
      } else if (!inPage) {
        compact = true; ensureObserver(pagesEl); toast?.show('已折叠页间距（双击缝隙恢复）', 'success');
      }
    };

    root.addEventListener('dblclick', onDblClick, true);
    return () => {
      clearInterval(timer);
      observer?.disconnect();
      root.removeEventListener('dblclick', onDblClick, true);
    };
  }, [seedDoc, toast]);

  // 加载中 / 欢迎页 / 编辑器
  if (!seedDoc) {
    if (loading || roomFromURL) {
      return (
        <div className="docx-welcome">
          <div className="docx-welcome-icon">⏳</div>
          <h2>正在加入协同房间...</h2>
          <p style={{ color: 'var(--text-muted)' }}>房间 <code>{roomFromURL}</code></p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>如果没有自动打开文档，请点击下方按钮</p>
          <div className="docx-welcome-actions">
            <button className="btn btn-primary" onClick={newDoc}>✨ 新建空白文档</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              📂 打开 .docx 文件
              <input type="file" accept=".docx" onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); }} hidden />
            </label>
          </div>
        </div>
      );
    }
    return (
      <div className="docx-welcome">
        <div className="docx-welcome-icon">📝</div>
        <h2>在线文档编辑器</h2>
        <p>纯前端运行 · OOXML 原生处理 · 修订模式 · 实时协作 · AI 审稿</p>
        <div className="docx-welcome-actions">
          <button className="btn btn-primary" onClick={newDoc}>✨ 新建空白文档</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            📂 打开 .docx 文件
            <input type="file" accept=".docx" onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); }} hidden />
          </label>
        </div>
        <div className="docx-welcome-features">
          <span>🔤 WYSIWYG 编辑</span>
          <span>📋 修订追踪</span>
          <span>💬 批注评论</span>
          <span>👥 实时协作</span>
          <span>🤖 AI 审稿</span>
          <span>🎨 多主题</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <DocxEditor
        key={docKey}
        document={seedDoc}
        externalContent
        externalPlugins={plugins}
        mode="editing"
        i18n={zhCN}
        author={userName}
        colorMode="system"
        showRuler
        showFileOpen={false}
        onError={(e) => console.error(e)}
        style={{ height: '100%' }}
      />
      {seedDoc && (
        <DocDrawingHost
          root={document.getElementById('docx-editor-root')}
          ydoc={ydocRef.current}
          docKey={docKey}
          toast={toast}
          active={penActive}
          onDeactivate={deactivatePen}
        />
      )}
      {showShare && (
        <div className="docx-modal-overlay" onClick={() => setShowShare(false)}>
          <div className="docx-modal" onClick={e => e.stopPropagation()}>
            <h3>🔗 邀请协作</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>分享此链接，对方打开后自动加入同一房间</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="docx-feedback-input" value={shareLink} readOnly onClick={e => e.target.select()} style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" onClick={() => { copyText(shareLink).then(() => { toast?.show('已复制！', 'success'); setShowShare(false); }).catch(() => toast?.show('复制失败，请手动选中复制', 'error')); }}>复制</button>
            </div>
          </div>
        </div>
      )}
      {showFeedback && (
        <div className="docx-modal-overlay" onClick={() => setShowFeedback(false)}>
          <div className="docx-modal" onClick={e => e.stopPropagation()}>
            <h3>💬 反馈建议</h3>
            {feedbackSent ? (
              <p style={{ textAlign: 'center', color: 'var(--primary)', padding: 20 }}>已收到，谢谢！✨</p>
            ) : (
              <>
                <textarea className="docx-feedback-input" placeholder="说说你的建议或遇到的问题..." value={feedbackText} onChange={e => setFeedbackText(e.target.value)} rows={5} autoFocus />
                <div className="docx-modal-actions"><button className="btn" onClick={() => setShowFeedback(false)}>取消</button><button className="btn btn-primary" onClick={handleFeedbackSubmit} disabled={!feedbackText.trim()}>发送反馈</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
