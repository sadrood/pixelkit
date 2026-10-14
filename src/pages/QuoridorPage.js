/**
 * QuoridorPage — 步步为营游戏页面（组合层）
 *
 * 组合 QuoridorEngine / QuoridorRenderer / QuoridorNetwork / QuoridorUI 四大模块。
 * 本文件只做模块装配和事件桥接，不包含游戏逻辑、渲染或网络细节。
 */
import { QuoridorEngine } from '../game/QuoridorEngine.js';
import { QuoridorRenderer } from '../game/QuoridorRenderer.js';
import { QuoridorNetwork } from '../game/QuoridorNetwork.js';
import { QuoridorUI } from '../game/QuoridorUI.js';
import { QuoridorAI } from '../game/QuoridorAI.js';
import { QuoridorNNai } from '../game/QuoridorNNai.js';
import { QuoridorRecorder } from '../game/QuoridorRecorder.js';
import { QuoridorReplay } from '../game/QuoridorReplay.js';

const AI_INDEX = 1;

export class QuoridorPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;

    // 四大模块
    this.engine = null;
    this.renderer = null;
    this.network = null;
    this.ui = null;

    // 运行时状态
    this.localMode = false;
    this.aiMode = false;
    this.nnMode = false;          // 超绝 AI 模式
    this._ai = null;
    this._aiThinking = false;
    this._aiTimer = null;
    this.myPlayerId = null;
    this.selectedPawn = -1;
    this._playerCount = 2;
    this._drawPending = false;
    this.recorder = new QuoridorRecorder();
    this.replay = new QuoridorReplay(document.getElementById('quoridor-replay'));
  }

  /** 当前是否轮到本地玩家操作 */
  get isMyTurn() {
    if (!this.engine) return false;
    if (this.localMode) return true;
    const myIdx = this.engine.players.findIndex(p => p.id === this.myPlayerId);
    return myIdx === this.engine.currentTurn && this.engine.winner === null;
  }

  // ==================== 初始化 ====================

  init() {
    if (this._inited) return;
    this._inited = true;

    const canvas = document.getElementById('quoridor-canvas');

    // 创建模块
    this.renderer = new QuoridorRenderer(canvas);
    this.network = new QuoridorNetwork();
    this.ui = new QuoridorUI(this.toast);

    // 绑定网络事件
    this._bindNetwork();

    // 绑定 UI 事件
    this.ui.bindButtons();
    this.ui.onAction((action, data) => this._handleAction(action, data));

    // 绑定 Canvas 交互
    this.ui.bindCanvas(canvas, (px, py, isHover) => this._handleCanvas(px, py, isHover));

    // 绑定挡板拖拽
    this.ui.bindWallTokens(canvas, (x, y, dir, isDrop) => {
      if (isDrop) this._handleWallDrop(x, y, dir);
      else this._handleWallDrag(x, y, dir);
    });

    this.ui.showLobby();

    // 链接参数 ?game=XXXX → 自动加入房间
    const gameParam = new URLSearchParams(window.location.search).get('game');
    if (gameParam) {
      this.ui.fillRoomInput(gameParam);
      this._joinRoom(gameParam);
    }
  }

  // ==================== 网络事件 ====================

  _bindNetwork() {
    // 连接中
    this.network.on('connected', () => {
      // 初始连接成功，什么都不做，等待 created/joined 消息
    });

    // 断线事件
    this.network.on('disconnected', () => {
      this.toast.show('网络断开，正在尝试重连...', 'error');
    });

    // 重连中
    this.network.on('reconnecting', (data) => {
      this.toast.show(`正在重连 (${data.attempt}/${data.maxAttempts})...`, 'error');
    });

    this.network.on('error', (msg) => {
      if (typeof msg === 'string') {
        this.toast.show(msg, 'error');
      } else if (msg.message) {
        this._handleServerError(msg.message);
      }
    });

    this.network.on('created', (msg) => {
      this.myPlayerId = msg.playerId;
      this.ui.setRoomInfo(msg.roomId);
      this._enterGame(msg.state);
      this.toast.show('房间已创建，等待对手加入...', 'success');
    });

    this.network.on('joined', (msg) => {
      this.myPlayerId = msg.playerId;
      this.ui.setRoomInfo(msg.roomId);
      this._enterGame(msg.state);
      this.toast.show('已加入房间！', 'success');
    });

    this.network.on('player_joined', (msg) => {
      this._syncState(msg.state);
      this.toast.show(msg.name + ' 加入了游戏！', 'success');
    });

    this.network.on('player_left', (msg) => {
      this._syncState(msg.state);
      this.toast.show('有玩家离开了...', 'error');
    });

    this.network.on('update', (msg) => {
      this._syncState(msg.state);
    });

    // 随机匹配结果
    this.network.on('matched', (msg) => {
      this.myPlayerId = msg.playerId;
      this.ui.setRoomInfo(msg.roomId);
      this._enterGame(msg.state);
      if (msg.waiting) {
        this.ui.showLobbyStatus('已进入匹配队列，等待真人对手...');
        this.toast.show('正在匹配真人对手，若无人则匹配 AI 玩家', 'success');
      } else {
        this.ui.showLobbyStatus('');
        this.toast.show('匹配到真人对手！', 'success');
      }
    });

    // 匹配房间未等到真人 → AI 玩家加入
    this.network.on('bot_joined', (msg) => {
      this._syncState(msg.state);
      this.ui.showLobbyStatus('');
      this.toast.show('暂时没有真人，AI 玩家加入对战', 'success');
    });

    // 对手发起和棋
    this.network.on('draw_offer', () => {
      const accept = window.confirm('对手请求和棋，是否接受？');
      this.network.sendDrawResponse(accept);
      if (accept) {
        this.toast.show('已同意和棋', 'success');
      } else {
        this.toast.show('已拒绝和棋', 'error');
      }
    });

    // 对手拒绝和棋
    this.network.on('draw_declined', () => {
      this.toast.show('对手拒绝了和棋请求', 'error');
    });
  }

  // ==================== 用户动作 ====================

  async _handleAction(action, data) {
    switch (action) {
      case 'create':
      case 'create4': {
        const maxPlayers = action === 'create4' ? 4 : 2;
        this.ui.setCreatePending(true, maxPlayers);
        this.ui.showLobbyStatus('正在连接游戏服务器...');
        try {
          await this.network.createRoom(maxPlayers);
        } catch (error) {
          console.error('[QuoridorPage] 创建房间失败:', error);
          this.ui.showLobbyStatus(`创建失败：${error.message}`);
          this.toast.show(`创建房间失败：${error.message}`, 'error');
        } finally {
          this.ui.setCreatePending(false, maxPlayers);
        }
        break;
      }
      case 'join':
        if (!data.roomId) {
          this.toast.show('请输入房间号', 'error');
          return;
        }
        this._joinRoom(data.roomId);
        break;
      case 'local':
        this._startLocal(2);
        break;
      case 'local4':
        this._startLocal(4);
        break;
      case 'ai':
        this._startAI();
        break;
      case 'nnai':
        this._startNNAI();
        break;
      case 'match':
        this.ui.setCreatePending(true, 2);
        this.ui.showLobbyStatus('正在匹配对手...');
        this.network.matchmake(); // 匹配结果通过 gameStart 或 error 事件回调
        break;
      case 'leave':
        this._leaveGame();
        break;
      case 'undo':
        this._handleUndo();
        break;
      case 'surrender':
        this._handleSurrender();
        break;
      case 'drawOffer':
        this._handleDrawOffer();
        break;
      case 'copyLink':
        this._copyLink();
        break;
      case 'restart':
        this._restart();
        break;
      case 'resultLeave':
        this._leaveGame();
        break;
      case 'replay':
        this._hideResult();
        this._showReplay();
        break;
    }
  }

  // ==================== Canvas 交互 ====================

  _handleCanvas(px, py, isHover) {
    if (!this.engine || this.engine.winner || this.engine.draw) return;

    // 鼠标移动：更新 hover 预览（仅移动相关）
    if (isHover) {
      if (px < 0 || this._aiThinking) {
        this.renderer.hoverCell = null;
      } else {
        this.renderer.hoverCell = this.renderer.pixelToGrid(px, py);
      }
      this._render();
      return;
    }

    if (this._aiThinking) {
      this.toast.show('AI 正在思考中...', 'error');
      return;
    }

    if (!this.isMyTurn) {
      this.toast.show('还没轮到你哦~', 'error');
      return;
    }

    const pos = this.renderer.pixelToGrid(px, py);
    if (!pos) return;
    this._handleMoveClick(pos.col, pos.row);
  }

  // ==================== 挡板拖拽（借鉴 Cocos 版拖拽放置） ====================

  /** 拖拽过程中实时更新预览 */
  _handleWallDrag(px, py, dir) {
    if (!this.engine || this.engine.winner || this.engine.draw) return;
    if (px < 0) {
      this.renderer.fencePreview = null;
      this._render();
      return;
    }
    const fence = this.renderer.pixelToFenceDir(px, py, dir);
    this.renderer.hoverCell = null;
    this.renderer.fencePreview = fence;
    this._render();
  }

  /** 松开：合法则直接放置 */
  _handleWallDrop(px, py, dir) {
    const fence = this.renderer.pixelToFenceDir(px, py, dir);
    this.renderer.fencePreview = null;
    if (!this.engine || this.engine.winner || this.engine.draw) {
      this._render();
      return;
    }
    if (!fence) {
      this._render();
      return;
    }
    if (!this.isMyTurn) {
      this.toast.show('还没轮到你哦~', 'error');
      this._render();
      return;
    }
    if (this._aiThinking) {
      this.toast.show('AI 正在思考中...', 'error');
      this._render();
      return;
    }
    if (!this.engine.canPlaceFence(fence.col, fence.row, fence.dir)) {
      this.toast.show('此处不能放置挡板', 'error');
      this._render();
      return;
    }
    this.selectedPawn = -1;
    if (this.localMode) {
      const turn = this.engine.currentTurn;
      this.engine.placeFence(turn, fence.col, fence.row, fence.dir);
      this.recorder.recordMove(turn, { type: 'fence', col: fence.col, row: fence.row, dir: fence.dir });
      this._render();
      this._maybeTriggerAI();
      this._maybeShowResult();
    } else {
      try { this.network.sendFence(fence.col, fence.row, fence.dir); }
      catch (e) { this.toast.show('连接已断开，请返回大厅', 'error'); this._leaveGame(); return; }
      this._render();
    }
  }

  _handleMoveClick(gc, gr) {
    // 第一击：选中棋子
    if (this.selectedPawn < 0) {
      const currentPlayerIdx = this.localMode
        ? this.engine.currentTurn
        : this.engine.players.findIndex(p => p.id === this.myPlayerId);

      const cp = this.engine.players[currentPlayerIdx];
      if (cp && cp.col === gc && cp.row === gr) {
        this.selectedPawn = currentPlayerIdx;
      } else {
        this.toast.show('请先点击当前玩家的棋子', 'error');
      }
      this._render();
      return;
    }

    // 第二击：执行移动
    const moves = this.engine.getValidMoves(this.selectedPawn);
    const valid = moves.find(m => m.col === gc && m.row === gr);

    if (!valid) {
      // 点了自己的棋子 → 取消选中；点了别人的棋子 → 切换
      const otherIdx = this.engine.players.findIndex(p => p.col === gc && p.row === gr);
      if (otherIdx >= 0 && (this.localMode || this.engine.players[otherIdx].id === this.myPlayerId)) {
        this.selectedPawn = otherIdx;
      } else if (this.engine.players[this.selectedPawn].col === gc && this.engine.players[this.selectedPawn].row === gr) {
        this.selectedPawn = -1;
      } else {
        this.toast.show('不能走到那里', 'error');
      }
      this._render();
      return;
    }

    // 联机模式由服务端权威校验并通过 state 消息更新本地状态
    this.selectedPawn = -1;
    if (!this.localMode) {
      try { this.network.sendMove(this.engine.currentTurn, gc, gr); }
      catch (e) { this.toast.show('连接已断开，请返回大厅', 'error'); this._leaveGame(); return; }
      this._render();
      return;
    }

    const turn = this.engine.currentTurn;
    const result = this.engine.movePawn(turn, gc, gr);
    this.recorder.recordMove(turn, { type: 'move', col: gc, row: gr });
    this._render();
    if (result.success) this._maybeTriggerAI();
    this._maybeShowResult();
    if (result.winner !== null) {
      this.toast.show(`🏆 ${this.engine.players[result.winner].name} 获胜！`, 'success');
    }
  }

  // ==================== 游戏流程 ====================

  _startLocal(playerCount = 2) {
    this.localMode = true;
    this.selectedPawn = -1;
    this._playerCount = playerCount;
    this._drawPending = false;
    this.engine = new QuoridorEngine(playerCount);
    this.recorder.start(this.engine.players.map(p => p.name), playerCount);
    this.ui.showGame();
    this.renderer.resize();
    this.ui.setActionInfo('点击棋子移动；拖拽右侧横墙/竖墙到棋盘放置挡板');
    this.ui.updateStatus(this.engine, null);
    this._setUndoVisible(true);
    this._hideResult();
    this._render();
    this.toast.show(`本地${playerCount}人模式已就绪`, 'success');
  }

  /** 人机对战：人类执红（P0），本地策略 AI 执蓝（P1） */
  _startAI() {
    this.localMode = true;
    this.aiMode = true;
    this._initAIGame('电脑', '人机对战开始，你执红先行');
  }

  /** 人机对战：人类执红（P0），超绝神经网络 AI 执蓝（P1） */
  async _startNNAI() {
    this.localMode = true;
    this.aiMode = true;
    this.nnMode = true;
    this.selectedPawn = -1;
    this._playerCount = 2;
    this._drawPending = false;
    this._cancelAI();
    this._ai = new QuoridorNNai();
    this.engine = new QuoridorEngine(2);
    this.engine.players[AI_INDEX].name = '超绝 AI';
    this.recorder.start([this.engine.players[0].name, '超绝 AI'], 2);
    this.ui.showGame();
    this.renderer.resize();
    this.ui.setActionInfo('对手：超绝 AI。正在加载神经网络模型...');
    this.ui.updateStatus(this.engine, null);
    this._setUndoVisible(true);
    this._hideResult();
    this._render();
    this.toast.show('正在加载超绝 AI 模型...', 'success');

    // 预加载模型
    try {
      await this._ai.ready();
      // 加载期间用户可能已退出
      if (!this.engine || !this.aiMode) return;
      this.ui.setActionInfo('对手：超绝 AI。点击棋子移动；拖拽挡板到棋盘放置');
      this.toast.show('人机对战开始，你执红先行', 'success');
      this._maybeTriggerAI();
    } catch (err) {
      // 加载期间用户可能已退出，避免 race condition
      if (!this.engine || !this.aiMode) return;
      this.toast.show('超绝 AI 模型加载失败，已切换到策略 AI', 'error');
      this.nnMode = false;
      this._ai = new QuoridorAI();
      this.engine.players[AI_INDEX].name = '电脑';
      this.ui.setActionInfo('对手：电脑。点击棋子移动；拖拽挡板到棋盘放置');
      this._maybeTriggerAI();
    }
  }

  _initAIGame(opponentName, toastText) {
    this.selectedPawn = -1;
    this._playerCount = 2;
    this._drawPending = false;
    this._cancelAI();
    this._ai = new QuoridorAI();
    this.engine = new QuoridorEngine(2);
    this.engine.players[AI_INDEX].name = opponentName;
    this.recorder.start([this.engine.players[0].name, opponentName], 2);
    this.ui.showGame();
    this.renderer.resize();
    this.ui.setActionInfo(`对手：${opponentName}。点击棋子移动；拖拽挡板到棋盘放置`);
    this.ui.updateStatus(this.engine, null);
    this._setUndoVisible(true);
    this._hideResult();
    this._render();
    this.toast.show(toastText, 'success');
    this._maybeTriggerAI();
  }

  _joinRoom(roomId) {
    this.localMode = false;
    this.network.joinRoom(roomId);
  }

  _enterGame(state) {
    this.localMode = false;
    this.selectedPawn = -1;
    this._drawPending = false;
    this.engine = QuoridorEngine.fromState(state);
    this.ui.showGame();
    this.renderer.resize();
    this.ui.setActionInfo('点击棋子移动；拖拽横墙/竖墙到棋盘放置挡板');
    this.ui.updateStatus(this.engine, this.myPlayerId);
    this._setUndoVisible(false);
    this._hideResult();
    this._render();
    this._maybeShowResult();
  }

  _showReplay() {
    this.replay.onBack(() => {
      this.replay.hide();
      this.ui.showLobby();
    });
    this.ui.showGame();
    this.replay.showList();
  }

  _leaveGame() {
    this._cancelAI();
    this._hideResult();
    this.replay.hide();
    this.network.leave();
    this.engine = null;
    this.selectedPawn = -1;
    this.localMode = false;
    this.aiMode = false;
    this.nnMode = false;
    this._ai = null;
    this._drawPending = false;
    this.myPlayerId = null;
    this.ui.showLobby();
    this.ui.hideRoomInfo();
    this.ui.showLobbyStatus('');
    this.ui.setCreatePending(false, 2);
    this._setUndoVisible(false);
  }

  _handleUndo() {
    if (!this.localMode || !this.engine || this.engine.winner || this.engine.draw) return;
    if (this._aiThinking) {
      this.toast.show('AI 正在思考，暂不能悔棋', 'error');
      return;
    }
    const result = this.engine.undo();
    if (result.success) {
      this.selectedPawn = -1;
      this.recorder.undo();
      this._render();
      this.toast.show(result.action, 'success');
      this._maybeTriggerAI();
    } else {
      this.toast.show('没有可撤销的操作', 'error');
    }
  }

  _setUndoVisible(visible) {
    const el = document.getElementById('btn-quoridor-undo');
    if (el) el.style.display = visible ? 'inline-block' : 'none';
  }

  _syncState(state) {
    this.engine = QuoridorEngine.fromState(state);
    this.selectedPawn = -1;
    this.ui.updateStatus(this.engine, this.myPlayerId);
    this._render();
    this._maybeShowResult();
  }

  _handleServerError(msg) {
    this.toast.show(msg, 'error');
    this._leaveGame();
  }

  _copyLink() {
    const link = this.network.getShareLink();
    if (!link) return;
    navigator.clipboard.writeText(link).then(
      () => this.toast.show('邀请链接已复制！发给朋友即可加入', 'success'),
      () => this.toast.show('复制失败，请手动分享房间号', 'error'),
    );
  }

  // ==================== 人机对战 ====================

  /** 轮到 AI 时安排落子 */
  _maybeTriggerAI() {
    if (!this.aiMode || !this.engine) return;
    if (this.engine.winner !== null || this.engine.draw) return;
    if (this.engine.currentTurn !== AI_INDEX) return;
    if (this._aiThinking || this._aiTimer) return;
    this._aiTimer = setTimeout(() => {
      this._aiTimer = null;
      this._aiThink();
    }, 350);
  }

  _cancelAI() {
    if (this._aiTimer) {
      clearTimeout(this._aiTimer);
      this._aiTimer = null;
    }
    this._aiThinking = false;
  }

  async _aiThink() {
    if (!this.aiMode || !this.engine) return;
    if (this.engine.winner !== null || this.engine.draw) return;
    this._aiThinking = true;
    this.selectedPawn = -1;
    this.renderer.hoverCell = null;
    this.renderer.fencePreview = null;
    this.ui.setActionInfo('AI 正在思考...');
    this.ui.updateStatus(this.engine, null);
    this._render();

    try {
      const action = await this._ai.chooseAction(this.engine, AI_INDEX);
      // AI 思考期间用户可能已退出，避免 race condition
      if (!this.engine || !this.aiMode) return;
      if (!action) {
        this.toast.show('AI 暂时无棋可走', 'error');
        return;
      }
      if (action.type === 'move') {
        this.engine.movePawn(AI_INDEX, action.col, action.row);
        this.recorder.recordMove(AI_INDEX, action);
      } else {
        this.engine.placeFence(AI_INDEX, action.col, action.row, action.dir);
        this.recorder.recordMove(AI_INDEX, action);
      }
    } catch (error) {
      // 用户退出后不再报错
      if (!this.engine || !this.aiMode) return;
      console.error('[QuoridorPage] AI 出错:', error);
      this.toast.show('AI 出错了，请重试', 'error');
    } finally {
      this._aiThinking = false;
      this.ui.setActionInfo('你是红方，点击棋子移动；拖拽挡板到棋盘放置');
      this._render();
      this._maybeShowResult();
      this._maybeTriggerAI();
    }
  }

  // ==================== 结算与再来一局 ====================

  _maybeShowResult() {
    if (!this.engine) return;
    if (this.engine.winner !== null || this.engine.draw) {
      this._showResult();
      // 仅本地模式持久化对局记录
      if (this.localMode) {
        this.recorder.finish({
          winnerIdx: this.engine.winner,
          winnerName: this.engine.winner !== null ? this.engine.players[this.engine.winner]?.name : '',
          draw: this.engine.draw,
        });
      }
    }
  }

  _showResult() {
    if (!this.engine) return;
    const el = document.getElementById('quoridor-result');
    const titleEl = document.getElementById('result-title');
    const statsEl = document.getElementById('result-stats');
    if (!el || !titleEl || !statsEl) return;

    let title = '🤝 双方和棋';
    let color = '#94a3b8';
    if (this.engine.winner !== null) {
      const w = this.engine.players[this.engine.winner];
      title = `🏆 ${w.name} 获胜！`;
      color = w.color;
    }
    titleEl.textContent = title;
    titleEl.style.color = color;

    const stats = this.engine.getStats();
    statsEl.innerHTML = `
      <div class="result-stat">⏱️ 用时：<b>${stats.elapsed}</b>　🎯 总步数：<b>${stats.totalMoves}</b></div>
      <div class="result-players">
        ${stats.players.map(p => `
          <div class="result-player">
            <span class="result-dot" style="background:${p.color};"></span>
            <span class="result-name">${p.name}${p.eliminated ? '（已认输）' : ''}</span>
            <span class="result-detail">移动${p.moves} · 放墙${p.wallsUsed} · 余墙${p.fences}</span>
          </div>`).join('')}
      </div>`;

    const restartBtn = document.getElementById('btn-quoridor-restart');
    if (restartBtn) restartBtn.style.display = this.localMode ? 'inline-block' : 'none';
    el.style.display = 'flex';
  }

  _hideResult() {
    const el = document.getElementById('quoridor-result');
    if (el) el.style.display = 'none';
  }

  async _restart() {
    this._cancelAI();
    this._hideResult();
    if (this.nnMode) {
      await this._startNNAI();
    } else if (this.aiMode) {
      this._startAI();
    } else if (this.localMode) {
      this._startLocal(this._playerCount);
    } else {
      this._leaveGame();
    }
  }

  // ==================== 认输 / 求和 ====================

  _handleSurrender() {
    if (!this.engine || this.engine.winner !== null || this.engine.draw) return;
    if (!window.confirm('确定要认输吗？')) return;

    if (!this.localMode) {
      this.network.sendSurrender();
      this.toast.show('已认输', 'error');
      return;
    }

    // 人机模式：仅红方（人类）可认输，AI 思考时不可
    if (this.aiMode) {
      if (this._aiThinking) {
        this.toast.show('AI 正在思考，稍等片刻', 'error');
        return;
      }
      if (this.engine.currentTurn !== 0) {
        this.toast.show('现在不是你的回合', 'error');
        return;
      }
    }

    const result = this.engine.surrender(this.engine.currentTurn);
    if (result.success) {
      this.selectedPawn = -1;
      this._render();
      this._maybeShowResult();
    }
  }

  _handleDrawOffer() {
    if (!this.engine || this.engine.winner !== null || this.engine.draw) return;

    // 联机：发送和棋请求，由服务端转发给对方
    if (!this.localMode) {
      this.network.sendDrawOffer();
      this.toast.show('已发起和棋请求，等待对方回应...', 'success');
      return;
    }

    // 人机模式：AI 劣势时接受，否则拒绝
    if (this.aiMode) {
      if (this._aiThinking) {
        this.toast.show('AI 正在思考，稍等片刻', 'error');
        return;
      }
      if (this.engine.currentTurn !== 0) {
        this.toast.show('现在不是你的回合', 'error');
        return;
      }
      const aiScore = this._ai._evaluate(this.engine, AI_INDEX);
      if (aiScore < -120) {
        this.engine.declareDraw();
        this._render();
        this._maybeShowResult();
      } else {
        this.toast.show('电脑拒绝了和棋请求', 'error');
      }
      return;
    }

    // 本地多人：先发起，对方再点一次"求和"确认
    if (this._drawPending) {
      this._drawPending = false;
      const accept = window.confirm('对方请求和棋，是否接受？');
      if (accept) {
        this.engine.declareDraw();
        this._render();
        this._maybeShowResult();
      } else {
        this.toast.show('已拒绝和棋', 'error');
      }
      return;
    }
    this._drawPending = true;
    this.toast.show('已发起和棋请求，请对方点击"求和"确认', 'success');
  }

  // ==================== 渲染 ====================

  _render() {
    if (!this.engine || !this.renderer) return;

    const highlight = {
      selectedPawn: this.selectedPawn,
      validMoves: null,
      canPlaceFence: (f) => this.engine.canPlaceFence(f.col, f.row, f.dir),
    };

    // 选中棋子时显示合法移动位置
    if (this.selectedPawn >= 0 && this.isMyTurn) {
      highlight.validMoves = this.engine.getValidMoves(this.selectedPawn);
    }

    this.renderer.render(this.engine, highlight);
    this.ui.updateStatus(this.engine, this.myPlayerId);
  }
}
