/**
 * QuoridorNetwork — WebSocket 网络通信模块（增强版）
 *
 * 职责：房间创建/加入、玩家状态同步、操作广播。
 * 新增：指数退避自动重连、心跳保活、断线恢复。
 *
 * 消息协议：
 *   客户端 → 服务端: { type:'create', name } | { type:'join', roomId, name }
 *                   | { type:'move', pi, col, row } | { type:'fence', col, row, dir }
 *                   | { type:'leave' } | { type:'rejoin', roomId, playerId, sessionToken }
 *                   | { type:'ping' }
 *   服务端 → 客户端: { type:'created', roomId, playerId, playerIndex, state }
 *                   | { type:'joined', roomId, playerId, playerIndex, state }
 *                   | { type:'player_joined', name, state }
 *                   | { type:'player_left', state }
 *                   | { type:'update', state }
 *                   | { type:'error', message }
 *                   | { type:'pong' }
 */

const CONNECT_TIMEOUT = 5000;
const MAX_RECONNECT = 5;          // 最大重连次数
const BASE_RECONNECT_DELAY = 1000; // 初始重连延迟（ms）
const HEARTBEAT_INTERVAL = 15000;  // 心跳间隔（ms）
const HEARTBEAT_TIMEOUT = 5000;    // 心跳超时（ms）
const REQUEST_TIMEOUT = 8000;

function getBrowserRandomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function makeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const randomPart = Array.from(getBrowserRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${Date.now()}-${randomPart}`;
}

export class QuoridorNetwork {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    this.playerName = '';
    this._handlers = {};
    this._connectTimer = null;
    this._reconnectCount = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._heartbeatTimeout = null;
    this._intentionalClose = false;
    this._pendingJoin = null;
    this._pendingMatch = false;
    this._pendingRequest = null;
  }

  /** 注册消息处理器 */
  on(type, handler) { this._handlers[type] = handler; }

  /** 计算 WebSocket URL */
  _buildUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = location.port === '3000' ? ':3001' : (location.port ? ':' + location.port : '');
    return `${protocol}//${location.hostname}${wsPort}/game`;
  }

  /** 建立连接并设置事件监听 */
  _doConnect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    const socket = new WebSocket(this._buildUrl());
    this.ws = socket;

    // 超时处理
    this._connectTimer = setTimeout(() => {
      if (this.ws === socket && socket.readyState !== WebSocket.OPEN) socket.close();
    }, CONNECT_TIMEOUT);

    socket.onopen = () => {
      if (this.ws !== socket) return;
      clearTimeout(this._connectTimer);
      this._startHeartbeat();

      if (this.roomId && this.playerId && this.sessionToken) {
        this._send({
          type: 'rejoin', roomId: this.roomId, playerId: this.playerId,
          sessionToken: this.sessionToken,
        });
      } else if (this._pendingJoin) {
        const { type, roomId, maxPlayers, requestId } = this._pendingJoin;
        this._pendingJoin = null;
        try {
          if (type === 'join' && roomId) {
            this._send({ type: 'join', roomId, name: this.playerName, requestId });
          } else if (type === 'create') {
            this._send({ type: 'create', name: this.playerName, maxPlayers: maxPlayers || 2, requestId });
          }
        } catch (error) {
          this._settleRequest(error);
        }
      } else if (this._pendingMatch) {
        this._pendingMatch = false;
        try {
          this._send({ type: 'matchmake', name: this.playerName });
        } catch (error) {
          this._emit('error', { message: error.message, code: 'MATCHMAKE_SEND_FAILED' });
        }
      }

      this._emit('connected');
    };

    socket.onmessage = (e) => {
      if (this.ws !== socket) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pong') {
          this._ackHeartbeat();
          return;
        }

        if (msg.type === 'created' || msg.type === 'joined' || msg.type === 'matched') {
          this.playerId = msg.playerId;
          this.roomId = msg.roomId;
          this.sessionToken = msg.sessionToken || this.sessionToken;
          this._reconnectCount = 0;
          this._settleRequest(null, msg);
        } else if (msg.type === 'error') {
          const error = new Error(msg.message || '服务器拒绝了请求');
          error.code = msg.code || 'SERVER_ERROR';
          this._settleRequest(error);
        }

        this._emit(msg.type, msg);
      } catch (err) {
        console.error('[QuoridorNetwork] 消息解析失败:', err);
        this._settleRequest(new Error(`服务器响应无法解析: ${err.message}`));
        this._emit('error', { message: '服务器响应格式错误', code: 'INVALID_RESPONSE' });
      }
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      clearTimeout(this._connectTimer);
      this.ws = null;
      this._stopHeartbeat();
      this._settleRequest(new Error(`WebSocket 已关闭（${event.code || 1006}${event.reason ? `: ${event.reason}` : ''}）`));
      if (!this._intentionalClose) {
        this._emit('disconnected');
        this._tryReconnect();
      }
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      clearTimeout(this._connectTimer);
      this._settleRequest(new Error(`无法连接游戏服务器 ${this._buildUrl()}`));
    };
  }

  // ==================== 断线重连 ====================

  /** 指数退避自动重连 */
  _tryReconnect() {
    if (this._intentionalClose) return;
    if (this._reconnectCount >= MAX_RECONNECT) {
      this._emit('error', '重连失败，请手动重新加入房间');
      this._pendingJoin = null;
      return;
    }

    const delay = BASE_RECONNECT_DELAY * Math.pow(2, this._reconnectCount);
    this._reconnectCount++;

    this._emit('reconnecting', { attempt: this._reconnectCount, maxAttempts: MAX_RECONNECT });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._intentionalClose) return;
      this._doConnect();
    }, delay);
  }

  /** 取消自动重连 */
  _cancelReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._reconnectCount = 0;
  }

  // ==================== 心跳保活 ====================

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL);
    this._sendHeartbeat();
  }

  _sendHeartbeat() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this._send({ type: 'ping' });
    this._armHeartbeatTimeout(this.ws);
  }

  _armHeartbeatTimeout(socket) {
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = setTimeout(() => {
      if (this.ws === socket && socket.readyState === WebSocket.OPEN) socket.close();
    }, HEARTBEAT_TIMEOUT);
  }

  _ackHeartbeat() {
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = null;
  }

  _stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimer = null;
    this._heartbeatTimeout = null;
  }

  // ==================== 公开 API ====================

  /** 创建房间 */
  createRoom(maxPlayers = 2) {
    if (![2, 4].includes(maxPlayers)) {
      return Promise.reject(new Error('房间人数必须是 2 或 4'));
    }
    if (this._pendingRequest) {
      return Promise.reject(new Error('已有房间请求正在处理中'));
    }

    this.playerName = '玩家' + Math.random().toString(36).slice(2, 5).toUpperCase();
    this._intentionalClose = false;
    const requestId = makeRequestId();
    this._pendingJoin = { type: 'create', maxPlayers, requestId };

    const request = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._settleRequest(new Error(`创建房间超时：${REQUEST_TIMEOUT / 1000} 秒内未收到服务器响应`));
      }, REQUEST_TIMEOUT);
      this._pendingRequest = { requestId, resolve, reject, timer };
      try {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this._pendingJoin = null;
          this._send({
            type: 'create', name: this.playerName, maxPlayers, requestId,
          });
        } else {
          this._doConnect();
        }
      } catch (error) {
        this._settleRequest(error);
      }
    });

    return request;
  }

  /** 加入已有房间 */
  joinRoom(roomId) {
    this.roomId = roomId.toUpperCase();
    this.playerName = '玩家' + Math.random().toString(36).slice(2, 5).toUpperCase();
    this._intentionalClose = false;
    this._pendingJoin = { type: 'join', roomId: this.roomId };
    this._doConnect();
  }

  /** 随机匹配：优先配真人，超时由服务端补 AI 玩家 */
  matchmake() {
    this.playerName = '玩家' + Math.random().toString(36).slice(2, 5).toUpperCase();
    this._intentionalClose = false;
    this._pendingMatch = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._pendingMatch = false;
      this._send({ type: 'matchmake', name: this.playerName });
      return;
    }
    this._doConnect();
  }

  /** 移动棋子 */
  sendMove(pi, col, row) {
    this._send({ type: 'move', pi, col, row });
  }

  /** 放置挡板 */
  sendFence(col, row, dir) {
    this._send({ type: 'fence', col, row, dir });
  }

  /** 认输 */
  sendSurrender() {
    this._send({ type: 'surrender' });
  }

  /** 发起和棋请求 */
  sendDrawOffer() {
    this._send({ type: 'draw_offer' });
  }

  /** 响应和棋请求（accept 为 true 接受，false 拒绝） */
  sendDrawResponse(accept) {
    this._send({ type: 'draw_response', accept: !!accept });
  }

  /** 离开房间 */
  leave() {
    this._intentionalClose = true;
    this._cancelReconnect();
    this._pendingJoin = null;
    this._pendingMatch = false;
    try { this._send({ type: 'leave' }); } catch (_) { /* ws already gone (local/AI mode, etc.) */ }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.roomId = null;
    this.playerId = null;
    this.sessionToken = null;
    this._stopHeartbeat();
  }

  /** 获取分享链接 */
  getShareLink() {
    if (!this.roomId) return '';
    return `${location.origin}/?game=${this.roomId}`;
  }

  get isConnected() {
    return this.ws?.readyState === 1;
  }

  // ---- 内部方法 ----

  _settleRequest(error, response) {
    const pending = this._pendingRequest;
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pendingRequest = null;
    this._pendingJoin = null;
    if (error) pending.reject(error);
    else pending.resolve(response);
  }

  _send(data) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket 未就绪，当前状态: ${this.ws?.readyState ?? '未创建'}`);
    }
    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      throw new Error(`WebSocket 消息发送失败: ${error.message}`);
    }
  }

  _emit(type, data) {
    const handler = this._handlers[type];
    if (!handler) return;
    try {
      handler(data);
    } catch (error) {
      console.error(`[QuoridorNetwork] ${type} 处理器执行失败:`, error);
    }
  }
}
