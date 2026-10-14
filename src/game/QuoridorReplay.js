/**
 * QuoridorReplay — 对局复盘器
 *
 * 从 localStorage 加载历史对局记录，逐步回放棋盘状态，支持：
 * - 对局列表（按时间倒序）
 * - 逐步前进/后退
 * - 自动播放
 * - 直接跳转到任意步
 */

import { QuoridorEngine } from './QuoridorEngine.js';
import { QuoridorRecorder } from './QuoridorRecorder.js';
import { QuoridorRenderer } from './QuoridorRenderer.js';

const CANVAS_ID = 'quoridor-canvas';

export class QuoridorReplay {
  constructor(container) {
    this._container = container;
    this._games = [];
    this._currentGame = null;
    this._engine = null;
    this._renderer = null;
    this._stepIdx = 0;
    this._autoTimer = null;
    this._autoSpeed = 500; // ms per step
  }

  /** 显示对局列表 */
  showList() {
    this._games = QuoridorRecorder.loadAll().reverse(); // 最新在前
    this._renderList();
    this._container.style.display = 'flex';
  }

  hide() {
    this._stopAuto();
    this._container.style.display = 'none';
  }

  _renderList() {
    if (this._games.length === 0) {
      this._container.innerHTML = `
        <div class="replay-panel">
          <div class="replay-header">
            <h3>📋 对局复盘</h3>
            <button class="btn btn-sm replay-back-btn">← 返回大厅</button>
          </div>
          <div style="text-align:center;color:#94a3b8;padding:40px;">
            <p>暂无对局记录</p>
            <p style="font-size:12px;margin-top:8px;">完成一局本地/人机对战后会自动保存</p>
          </div>
        </div>`;
    } else {
      let html = `
        <div class="replay-panel">
          <div class="replay-header">
            <h3>📋 对局复盘 (${this._games.length} 局)</h3>
            <button class="btn btn-sm replay-back-btn">← 返回大厅</button>
          </div>
          <div class="replay-list">`;
      for (let i = 0; i < this._games.length; i++) {
        const g = this._games[i];
        const date = new Date(g.ts).toLocaleString('zh-CN');
        const duration = this._fmtDuration(g.duration);
        const winner = g.winnerName || (g.draw ? '和棋' : '?');
        const resultColor = g.draw ? '#fbbf24' : '#10b981';
        html += `
          <div class="replay-item" data-idx="${i}">
            <div class="replay-item-left">
              <div class="replay-item-date">${date}</div>
              <div class="replay-item-players">${g.names?.join(' vs ') || '?'}</div>
            </div>
            <div class="replay-item-right">
              <div class="replay-item-result" style="color:${resultColor}">${g.draw ? '和棋' : '胜: ' + winner}</div>
              <div class="replay-item-info">${duration} · ${g.totalMoves} 步</div>
            </div>
          </div>`;
      }
      html += `</div></div>`;
      this._container.innerHTML = html;
    }

    // 绑定事件
    this._container.querySelector('.replay-back-btn')?.addEventListener('click', () => this._onBack?.());
    this._container.querySelectorAll('.replay-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        this._startReplay(this._games[idx]);
      });
    });
  }

  /** 开始回放某局 */
  _startReplay(game) {
    this._currentGame = game;
    // 从录制的 moves 重建初始状态
    this._engine = new QuoridorEngine(game.players || 2);
    // 设置玩家名称
    if (game.names) {
      game.names.forEach((name, i) => {
        if (this._engine.players[i]) this._engine.players[i].name = name;
      });
    }
    this._stepIdx = 0;

    // 初始化渲染器
    if (!this._renderer) {
      const canvas = document.getElementById(CANVAS_ID);
      if (canvas) this._renderer = new QuoridorRenderer(canvas);
    }
    if (this._renderer) this._renderer.resize();

    this._renderReplayUI();
  }

  _renderReplayUI() {
    const g = this._currentGame;
    const total = g.moves.length;
    const cur = this._stepIdx;
    const date = new Date(g.ts).toLocaleString('zh-CN');
    const winner = g.winnerName || (g.draw ? '和棋' : '?');
    const resultColor = g.draw ? '#fbbf24' : '#10b981';

    // 应用 moves 到当前步
    this._resetToStep(cur);

    let movesHtml = '';
    for (let i = 0; i < total; i++) {
      const m = g.moves[i];
      const pName = g.names?.[m.player] || `P${m.player}`;
      const desc = m.type === 'move'
        ? `${String.fromCharCode(65 + m.col)}${m.row + 1}`
        : `${m.dir === 'h' ? '━' : '┃'}(${m.col},${m.row})`;
      const isCur = i === cur - 1;
      movesHtml += `<span class="replay-move-chip ${isCur ? 'current' : ''}" data-step="${i}">${pName}: ${desc}</span>`;
    }

    this._container.innerHTML = `
      <div class="replay-panel">
        <div class="replay-header">
          <h3>🔁 复盘回放</h3>
          <button class="btn btn-sm replay-back-btn">← 返回列表</button>
        </div>
        <div class="replay-meta">
          <span>${date}</span>
          <span>${g.names?.join(' vs ') || '?'}</span>
          <span style="color:${resultColor}">${g.draw ? '和棋' : '胜: ' + winner}</span>
          <span>${this._fmtDuration(g.duration)} · ${total} 步</span>
        </div>
        <div class="replay-controls">
          <button class="btn btn-sm replay-btn-first" ${cur <= 0 ? 'disabled' : ''}>⏮️</button>
          <button class="btn btn-sm replay-btn-prev" ${cur <= 0 ? 'disabled' : ''}>◀ 上一步</button>
          <span class="replay-step-info">${cur} / ${total}</span>
          <button class="btn btn-sm replay-btn-next" ${cur >= total ? 'disabled' : ''}>下一步 ▶</button>
          <button class="btn btn-sm replay-btn-last" ${cur >= total ? 'disabled' : ''}>⏭️</button>
          <button class="btn btn-sm replay-btn-auto">${this._autoTimer ? '⏸ 暂停' : '▶ 自动播放'}</button>
          <input type="range" class="replay-slider" min="0" max="${total}" value="${cur}" />
        </div>
        <div class="replay-moves">${movesHtml}</div>
      </div>`;

    // 绑定控制按钮
    this._container.querySelector('.replay-back-btn')?.addEventListener('click', () => this.showList());
    this._container.querySelector('.replay-btn-first')?.addEventListener('click', () => this._jumpTo(0));
    this._container.querySelector('.replay-btn-prev')?.addEventListener('click', () => this._stepBack());
    this._container.querySelector('.replay-btn-next')?.addEventListener('click', () => this._stepForward());
    this._container.querySelector('.replay-btn-last')?.addEventListener('click', () => this._jumpTo(total));
    this._container.querySelector('.replay-btn-auto')?.addEventListener('click', () => this._toggleAuto());
    const slider = this._container.querySelector('.replay-slider');
    slider?.addEventListener('input', (e) => this._jumpTo(parseInt(e.target.value)));
    // 点击歩数标签跳转到该步
    this._container.querySelectorAll('.replay-move-chip').forEach(el => {
      el.addEventListener('click', () => this._jumpTo(parseInt(el.dataset.step) + 1));
    });

    // 渲染棋盘
    if (this._renderer && this._engine) {
      this._renderer.render(this._engine, null);
    }
  }

  /** 重置引擎到指定步数 */
  _resetToStep(steps) {
    // 重建引擎
    const g = this._currentGame;
    this._engine = new QuoridorEngine(g.players || 2);
    if (g.names) {
      g.names.forEach((name, i) => {
        if (this._engine.players[i]) this._engine.players[i].name = name;
      });
    }
    for (let i = 0; i < steps && i < g.moves.length; i++) {
      const m = g.moves[i];
      if (m.type === 'move') {
        this._engine.movePawn(m.player, m.col, m.row);
      } else if (m.type === 'fence') {
        this._engine.placeFence(m.player, m.col, m.row, m.dir);
      }
    }
  }

  _stepForward() {
    const total = this._currentGame.moves.length;
    if (this._stepIdx < total) {
      this._stepIdx++;
      this._renderReplayUI();
    }
  }

  _stepBack() {
    if (this._stepIdx > 0) {
      this._stepIdx--;
      this._renderReplayUI();
    }
  }

  _jumpTo(step) {
    this._stopAuto();
    this._stepIdx = Math.max(0, Math.min(this._currentGame.moves.length, step));
    this._renderReplayUI();
  }

  _toggleAuto() {
    if (this._autoTimer) {
      this._stopAuto();
      this._renderReplayUI();
    } else {
      this._autoTimer = setInterval(() => {
        if (this._stepIdx >= this._currentGame.moves.length) {
          this._stopAuto();
          this._renderReplayUI();
          return;
        }
        this._stepIdx++;
        this._renderReplayUI();
      }, this._autoSpeed);
      this._renderReplayUI();
    }
  }

  _stopAuto() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer);
      this._autoTimer = null;
    }
  }

  _fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}分${sec}s`;
  }

  /** 回到大厅的回调 */
  onBack(fn) { this._onBack = fn; }
}
