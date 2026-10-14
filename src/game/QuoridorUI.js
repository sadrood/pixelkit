/**
 * QuoridorUI — DOM / 用户交互模块
 *
 * 职责：面板显隐切换、按钮事件绑定、状态栏更新、模式切换、鼠标/触摸事件桥接。
 */
export class QuoridorUI {
  constructor(toast) {
    this.toast = toast;
    this._mode = 'move';
    this._onAction = null;
  }

  onAction(fn) { this._onAction = fn; }

  showLobby() {
    this._el('quoridor-lobby').style.display = 'flex';
    this._el('quoridor-game').style.display = 'none';
    this._el('btn-quoridor-copy').style.display = 'none';
  }
  showGame() {
    this._el('quoridor-lobby').style.display = 'none';
    this._el('quoridor-game').style.display = 'flex';
  }

  updateStatus(engine, myPlayerId) {
    const statusEl = this._el('game-status');
    const listEl = this._el('player-list');
    const logEl = this._el('game-log');
    if (!engine) return;

    if (engine.draw) {
      statusEl.textContent = '🤝 双方和棋';
      statusEl.style.color = '#94a3b8';
      statusEl.style.fontSize = '20px';
      statusEl.style.fontWeight = 'bold';
      logEl.innerHTML = '';
    } else if (engine.winner !== null) {
      const w = engine.players[engine.winner];
      statusEl.textContent = `🏆 ${w.name} 获胜！`;
      statusEl.style.color = w.color;
      statusEl.style.fontSize = '20px';
      statusEl.style.fontWeight = 'bold';

      // 显示对局统计
      const stats = engine.getStats();
      if (stats) {
        logEl.innerHTML = `
          <div style="margin-top:8px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:13px;line-height:1.8;">
            <div style="color:#fbbf24;font-weight:bold;margin-bottom:8px;">📊 对局统计</div>
            <div style="color:#94a3b8;">⏱️ 用时：<span style="color:#e2e8f0;">${stats.elapsed}</span></div>
            <div style="color:#94a3b8;">🎯 总局数：<span style="color:#e2e8f0;">${stats.totalMoves}</span></div>
            <div style="margin-top:8px;">
              ${stats.players.map(p => `
                <div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0;"></span>
                  <span style="color:#e2e8f0;">${p.name}</span>
                  <span style="color:#94a3b8;font-size:11px;">移动${p.moves}次 · 放墙${p.wallsUsed}个 · 余墙${p.fences}个</span>
                </div>
              `).join('')}
            </div>
          </div>`;
      }
    } else {
      const p = engine.players[engine.currentTurn];
      const isMe = p.id === myPlayerId;
      statusEl.textContent = isMe ? '轮到你走棋！' : `等待 ${p.name} 走棋...`;
      statusEl.style.color = isMe ? '#10b981' : '#94a3b8';
      statusEl.style.fontSize = '16px';
      statusEl.style.fontWeight = 'normal';
      logEl.innerHTML = '';
    }

    listEl.innerHTML = engine.players.map((p, i) => {
      const isMe = p.id === myPlayerId;
      const turnMark = i === engine.currentTurn ? ' ⬅' : '';
      const cls = isMe ? 'quoridor-player me' : 'quoridor-player';
      const activeCls = i === engine.currentTurn ? ' active' : '';
      return `<div class="${cls}${activeCls}" style="${isMe ? '--player-color:' + p.color : ''}">
        <span class="player-dot" style="background:${p.color};"></span>
        <span class="player-name">${p.name}${p.isBot ? ' 🤖' : ''}${isMe ? ' (你)' : ''}${p.eliminated ? ' (认输)' : ''}</span>
        <span class="player-turn">${turnMark}</span>
        <span class="player-fences">🚧×${p.fences}</span>
      </div>`;
    }).join('');
  }

  setRoomInfo(roomId) {
    this._el('quoridor-room-info').textContent = '房间: ' + roomId;
    this._el('btn-quoridor-copy').style.display = 'inline-block';
  }
  hideRoomInfo() {
    this._el('quoridor-room-info').textContent = '';
    this._el('btn-quoridor-copy').style.display = 'none';
  }

  showLobbyStatus(message) {
    const statusEl = this._el('quoridor-lobby-status');
    if (statusEl) statusEl.textContent = message || '';
  }

  /** 设置操作提示文字 */
  setActionInfo(text) {
    const el = this._el('action-info');
    if (el) el.textContent = text || '';
  }

  setCreatePending(pending, maxPlayers = 2) {
    const ids = ['btn-quoridor-create', 'btn-quoridor-create4'];
    ids.forEach((id) => {
      const button = this._el(id);
      if (button) button.disabled = pending;
    });
    const activeButton = this._el(maxPlayers === 4 ? 'btn-quoridor-create4' : 'btn-quoridor-create');
    if (activeButton) {
      activeButton.textContent = pending
        ? '正在连接服务器...'
        : (maxPlayers === 4 ? '🎮 创建四人房间' : '🎮 创建双人房间');
    }
  }

  _dispatchAction(action, data) {
    if (typeof this._onAction !== 'function') {
      const error = new Error(`操作处理器尚未注册: ${action}`);
      console.error('[QuoridorUI]', error);
      this.toast?.show('页面尚未初始化完成，请刷新后重试', 'error');
      return;
    }
    try {
      const result = this._onAction(action, data);
      if (result?.catch) {
        result.catch((error) => {
          console.error(`[QuoridorUI] ${action} 操作失败:`, error);
          this.toast?.show(error?.message || '操作失败，请查看控制台', 'error');
        });
      }
    } catch (error) {
      console.error(`[QuoridorUI] ${action} 操作失败:`, error);
      this.toast?.show(error?.message || '操作失败，请查看控制台', 'error');
    }
  }

  bindButtons() {
    const requiredIds = [
      'btn-quoridor-create', 'btn-quoridor-create4', 'btn-quoridor-join',
      'btn-quoridor-local', 'btn-quoridor-local4', 'btn-quoridor-ai',
      'btn-quoridor-nn', 'btn-quoridor-match',
      'btn-quoridor-leave', 'btn-quoridor-undo', 'btn-quoridor-surrender',
      'btn-quoridor-draw', 'btn-quoridor-copy', 'quoridor-room-input',
      'btn-quoridor-restart', 'btn-quoridor-result-leave',
    ];
    const missing = requiredIds.filter(id => !this._el(id));
    if (missing.length) {
      throw new Error(`步步为营页面缺少 DOM 元素: ${missing.join(', ')}`);
    }

    this._el('btn-quoridor-create').addEventListener('click', () => this._dispatchAction('create'));
    this._el('btn-quoridor-create4').addEventListener('click', () => this._dispatchAction('create4'));
    this._el('btn-quoridor-join').addEventListener('click', () => {
      const roomId = this._el('quoridor-room-input').value.trim().toUpperCase();
      this._dispatchAction('join', { roomId });
    });
    this._el('btn-quoridor-local').addEventListener('click', () => this._dispatchAction('local'));
    this._el('btn-quoridor-local4').addEventListener('click', () => this._dispatchAction('local4'));
    this._el('btn-quoridor-ai').addEventListener('click', () => this._dispatchAction('ai'));
    this._el('btn-quoridor-nn').addEventListener('click', () => this._dispatchAction('nnai'));
    this._el('btn-quoridor-match').addEventListener('click', () => this._dispatchAction('match'));
    this._el('btn-quoridor-leave').addEventListener('click', () => this._dispatchAction('leave'));
    this._el('btn-quoridor-undo').addEventListener('click', () => this._dispatchAction('undo'));
    this._el('btn-quoridor-surrender').addEventListener('click', () => this._dispatchAction('surrender'));
    this._el('btn-quoridor-draw').addEventListener('click', () => this._dispatchAction('drawOffer'));
    this._el('btn-quoridor-copy').addEventListener('click', () => this._dispatchAction('copyLink'));
    this._el('btn-quoridor-restart').addEventListener('click', () => this._dispatchAction('restart'));
    this._el('btn-quoridor-result-leave').addEventListener('click', () => this._dispatchAction('resultLeave'));

    this._el('quoridor-room-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const roomId = this._el('quoridor-room-input').value.trim().toUpperCase();
        this._onAction?.('join', { roomId });
      }
    });
  }

  /**
   * 绑定挡板拖拽（桌面鼠标 + 移动端触摸，使用 Pointer Events + 指针捕获）。
   * 拖拽过程中回调 onDrag(x, y, dir, isDrop)，isDrop 为 true 表示松开（放置）。
   */
  bindWallTokens(canvas, onDrag) {
    const tokens = document.querySelectorAll('.wall-token');
    const toPixel = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    tokens.forEach(token => {
      const dir = token.dataset.dir;
      const beginDrag = (e) => {
        e.preventDefault();
        this._draggingWall = dir;
        token.classList.add('dragging');
        try { token.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      };
      const moveDrag = (e) => {
        if (this._draggingWall !== dir) return;
        const p = toPixel(e);
        onDrag(p.x, p.y, dir, false);
      };
      const endDrag = (e) => {
        if (this._draggingWall !== dir) return;
        const p = toPixel(e);
        onDrag(p.x, p.y, dir, true);
        this._draggingWall = null;
        token.classList.remove('dragging');
      };
      const cancelDrag = () => {
        if (this._draggingWall !== dir) return;
        this._draggingWall = null;
        token.classList.remove('dragging');
        onDrag(-1, -1, dir, true);
      };

      token.addEventListener('pointerdown', beginDrag);
      token.addEventListener('pointermove', moveDrag);
      token.addEventListener('pointerup', endDrag);
      token.addEventListener('pointercancel', cancelDrag);
      token.addEventListener('lostpointercapture', cancelDrag);
    });
  }

  /** 绑定 Canvas 交互（桌面鼠标 + 移动端触摸） */
  bindCanvas(canvas, onPixel) {
    let touchStart = null;

    /** 将事件坐标统一转换为 Canvas 内像素坐标 */
    const eventToPixel = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      let cx, cy;
      // touchend 时 e.touches 为空，兼容取 changedTouches
      const touch = e.changedTouches?.[0] || e.touches?.[0];
      if (touch) {
        cx = (touch.clientX - rect.left) * scaleX;
        cy = (touch.clientY - rect.top) * scaleY;
      } else {
        cx = (e.clientX - rect.left) * scaleX;
        cy = (e.clientY - rect.top) * scaleY;
      }
      return { x: cx, y: cy };
    };

    // 桌面端鼠标
    canvas.addEventListener('mousemove', (e) => {
      const p = eventToPixel(e);
      onPixel(p.x, p.y, true);
    });
    canvas.addEventListener('mouseleave', () => {
      onPixel(-1, -1, true);
    });
    canvas.addEventListener('click', (e) => {
      const p = eventToPixel(e);
      onPixel(p.x, p.y, false);
    });

    // 移动端触摸
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const p = eventToPixel(e);
        touchStart = { startX: p.x, startY: p.y, time: Date.now() };
        onPixel(p.x, p.y, true);
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const p = eventToPixel(e);
        onPixel(p.x, p.y, true);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (touchStart) {
        const p = eventToPixel(e);
        const dx = Math.abs(p.x - touchStart.startX);
        const dy = Math.abs(p.y - touchStart.startY);
        const dt = Date.now() - touchStart.time;
        if (dx < 10 && dy < 10 && dt < 300) {
          onPixel(p.x, p.y, false);
        }
        touchStart = null;
      }
      onPixel(-1, -1, true);
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
      touchStart = null;
      onPixel(-1, -1, true);
    });
  }

  fillRoomInput(roomId) {
    const el = this._el('quoridor-room-input');
    if (el) el.value = roomId;
  }

  _el(id) { return document.getElementById(id); }
}
