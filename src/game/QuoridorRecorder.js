/**
 * QuoridorRecorder — 对局记录器
 *
 * 记录每一步（棋子移动/挡板放置）到内存，游戏结束时自动持久化到 localStorage，
 * 供后续分析或 AI 训练使用。
 * 最多保留 50 局，超出时淘汰最旧的。
 */

const STORAGE_KEY = 'quoridor_games';
const MAX_GAMES = 50;

export class QuoridorRecorder {
  constructor() {
    this._started = false;
    this._moves = [];
    this._startTime = null;
    this._playerCount = 2;
    this._playerNames = [];
  }

  /** 开始新一局 */
  start(playerNames, playerCount = 2) {
    this._moves = [];
    this._startTime = Date.now();
    this._playerNames = [...playerNames];
    this._playerCount = playerCount;
    this._started = true;
  }

  /** 记录一步 */
  recordMove(playerIndex, action) {
    if (!this._started) return;
    this._moves.push({
      tick: this._moves.length + 1,
      player: playerIndex,
      ...action, // { type: 'move'|'fence', col, row, dir? }
    });
  }

  /**
   * 游戏结束，持久化到 localStorage。
   * @param {object} result - { winnerIdx, winnerName?, draw }
   */
  finish(result) {
    if (!this._started) return;
    this._started = false;

    const record = {
      ts: new Date().toISOString(),
      duration: Date.now() - this._startTime,
      players: this._playerCount,
      names: this._playerNames,
      totalMoves: this._moves.length,
      winner: result.winnerIdx ?? null,
      winnerName: result.winnerName ?? '',
      draw: !!result.draw,
      moves: this._moves,
    };

    try {
      const list = this._load();
      list.push(record);
      // 淘汰最旧
      while (list.length > MAX_GAMES) list.shift();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[QuoridorRecorder] 保存失败:', e);
    }

    return record;
  }

  /** 撤销最后一步（配合引擎 undo） */
  undo() {
    if (!this._started || this._moves.length === 0) return false;
    this._moves.pop();
    return true;
  }

  /** 取消本局（不保存） */
  cancel() { this._started = false; this._moves = []; }

  /** 读取所有历史记录 */
  static loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  /** 清空所有记录 */
  static clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
}
