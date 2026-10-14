/**
 * QuoridorEngine — 步步为营纯游戏逻辑引擎
 *
 * 职责：棋盘状态管理、走法合法性校验、BFS 路径检测、胜负判定。
 * 纯函数式设计，不依赖 DOM / Canvas / 网络，可独立单测。
 *
 * 棋盘坐标系说明（9×9 格子）：
 *   - 棋子位置 (col, row)：col∈[0,8], row∈[0,8]，共 81 个格子
 *   - 横向挡板 {col, row, dir:'h'}：横跨 col~col+1，位于 row 与 row+1 之间
 *     col∈[0,7], row∈[0,7]，共 8×8=64 种可能
 *   - 纵向挡板 {col, row, dir:'v'}：纵跨 row~row+1，位于 col 与 col+1 之间
 *     col∈[0,7], row∈[0,7]，共 8×8=64 种可能
 *
 * 四人游戏玩家起始位置：
 *   P0(红): (4,8) 目标行 0   P1(蓝): (4,0) 目标行 8
 *   P2(绿): (0,4) 目标列 8   P3(金): (8,4) 目标列 0
 */

// ---- 玩家颜色与初始配置 ----
const PLAYER_DEFS = [
  { color: '#e23636ff', col: 4, row: 8, goalRow: 0,  goalCol: -1, name: '红方' },
  { color: '#3b82f6', col: 4, row: 0, goalRow: 8,  goalCol: -1, name: '蓝方' },
  { color: '#10b981', col: 0, row: 4, goalRow: -1, goalCol: 8,  name: '绿方' },
  { color: '#f59e0b', col: 8, row: 4, goalRow: -1, goalCol: 0,  name: '金方' },
];

const BOARD_SIZE = 9;
const FENCES_PER_PLAYER = 10;

// ---- 方向向量 ----
const DIRS = [
  { dc: 0, dr: -1 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
];

export class QuoridorEngine {
  /**
   * @param {number} playerCount - 玩家数量 (2 或 4)
   */
  constructor(playerCount = 2) {
    this.playerCount = Math.min(playerCount, 4);
    this.players = [];
    this.fences = [];
    this.currentTurn = 0;
    this.winner = null;
    this.draw = false;   // 和棋（双方同意）
    this.history = [];   // 操作历史（用于悔棋）

    this._initPlayers();
  }

  /** 从服务器状态快照恢复引擎 */
  static fromState(state) {
    const e = new QuoridorEngine(state.players?.length || 2);
    if (state.players) {
      e.players = state.players.map(p => ({ ...p }));
    }
    if (state.fences) {
      e.fences = state.fences.map(f => ({ ...f }));
    }
    e.currentTurn = state.currentTurn ?? 0;
    e.winner = state.winner ?? null;
    e.draw = !!state.draw;
    e.totalMoves = state.totalMoves ?? 0;
    e.startTime = state.startedAt || Date.now();
    return e;
  }

  /** 导出纯数据快照（可序列化，用于网络同步） */
  toState() {
    return {
      players: this.players.map(p => ({
        id: p.id, name: p.name, color: p.color,
        col: p.col, row: p.row, fences: p.fences,
        goalRow: p.goalRow, goalCol: p.goalCol,
        eliminated: !!p.eliminated,
        moves: p.moves || 0, wallsUsed: p.wallsUsed || 0,
      })),
      fences: this.fences.map(f => ({ ...f })),
      currentTurn: this.currentTurn,
      winner: this.winner,
      draw: this.draw,
      totalMoves: this.totalMoves || 0,
      startedAt: this.startTime || Date.now(),
    };
  }

  // ==================== 初始化 ====================

  _initPlayers() {
    for (let i = 0; i < this.playerCount; i++) {
      const def = PLAYER_DEFS[i];
      this.players.push({
        id: `p${i}`,
        name: def.name,
        color: def.color,
        col: def.col,
        row: def.row,
        goalRow: def.goalRow,
        goalCol: def.goalCol,
        fences: FENCES_PER_PLAYER,
        moves: 0,      // 该玩家移动步数
        wallsUsed: 0,  // 该玩家已用挡板数
        eliminated: false, // 认输/离场后标记
      });
    }
    this.startTime = Date.now(); // 游戏开始时间
    this.totalMoves = 0;          // 总局数
  }

  // ==================== 胜负判定 ====================

  /**
   * 检查指定玩家是否已到达目标行/列。
   * 双人游戏：目标是对面行；四人游戏：目标是对面行或列。
   */
  _hasReachedGoal(playerIndex) {
    const p = this.players[playerIndex];
    if (p.goalCol !== -1 && p.col === p.goalCol) return true;
    if (p.goalRow !== -1 && p.row === p.goalRow) return true;
    return false;
  }

  /** 切换到下一回合（跳过已获胜/已认输的玩家） */
  _advanceTurn() {
    if (this.winner !== null || this.draw) return;
    const total = this.players.length;
    for (let i = 0; i < total; i++) {
      this.currentTurn = (this.currentTurn + 1) % total;
      const p = this.players[this.currentTurn];
      if (!p.eliminated && !this._hasReachedGoal(this.currentTurn)) return;
    }
  }

  // ==================== 挡板阻挡检查 ====================

  /**
   * 检查从 (c1,r1) 到 (c2,r2) 的移动是否被已有挡板阻挡。
   * 可选 extraFence 用于模拟"如果放置这块挡板会怎样"。
   *
   * 横向挡板 (dir='h')：阻挡垂直方向的移动。
   *   位于 row=r 和 row=r+1 之间，横跨 col=c ~ c+1。
   *   从 (c,r) 向下到 (c,r+1) 时被阻挡；从 (c+1,r) 向下到 (c+1,r+1) 同理。
   *
   * 纵向挡板 (dir='v')：阻挡水平方向的移动。
   *   位于 col=c 和 col=c+1 之间，纵跨 row=r ~ r+1。
   *   从 (c,r) 向右到 (c+1,r) 时被阻挡；从 (c,r+1) 向右到 (c+1,r+1) 同理。
   */
  _isBlocked(c1, r1, c2, r2, extraFence = null) {
    const dc = c2 - c1;
    const dr = r2 - r1;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return true;

    const blocksMove = (f) => {
      if (f.dir === 'h' && dr !== 0) {
        return f.row === Math.min(r1, r2) &&
          (f.col === c1 || f.col === c1 - 1);
      }
      if (f.dir === 'v' && dc !== 0) {
        return f.col === Math.min(c1, c2) &&
          (f.row === r1 || f.row === r1 - 1);
      }
      return false;
    };

    return (extraFence !== null && blocksMove(extraFence)) ||
      this.fences.some(blocksMove);
  }

  // ==================== BFS 路径检测 ====================

  /**
   * BFS 判断从 (col,row) 出发，是否能到达 playerIndex 的目标行/列。
   * 这是挡板合法性校验的核心算法：
   *   - 将棋盘视为无向图（节点=格子，边=可行走步）
   *   - 标准广度优先搜索，遇到挡板则跳过那条边
   *   - 搜索到目标行/列任一格子即返回 true
   *
   * @param {number} col - 起始列
   * @param {number} row - 起始行
   * @param {number} playerIndex - 玩家索引
   * @param {{col,row,dir}|null} extraFence - 可选，模拟放置的挡板
   * @returns {boolean}
   */
  hasPath(col, row, playerIndex, extraFence = null) {
    const p = this.players[playerIndex];
    if (!p || !Number.isInteger(col) || !Number.isInteger(row) ||
        col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) {
      return false;
    }

    const visited = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    const queue = [{ col, row }];
    let head = 0;
    visited[row * BOARD_SIZE + col] = 1;

    while (head < queue.length) {
      const { col: c, row: r } = queue[head++];

      // 到达目标行或列
      if (p.goalCol !== -1 && c === p.goalCol) return true;
      if (p.goalRow !== -1 && r === p.goalRow) return true;

      for (const { dc, dr } of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= BOARD_SIZE || nr < 0 || nr >= BOARD_SIZE) continue;
        const index = nr * BOARD_SIZE + nc;
        if (visited[index] || this._isBlocked(c, r, nc, nr, extraFence)) continue;
        visited[index] = 1;
        queue.push({ col: nc, row: nr });
      }
    }
    return false;
  }

  // ==================== 棋子移动合法性 ====================

  /**
   * 获取 playerIndex 的所有合法移动目标。
   *
   * 标准规则：
   *   1. 可移动到相邻空格（上下左右）
   *   2. 若相邻格有对手棋子，可以跳过它（类似跳棋）
   *   3. 若跳过被挡板封堵，可以侧跳到对手两侧的空格
   */
  getValidMoves(playerIndex) {
    const p = this.players[playerIndex];
    if (!p) return [];
    const moves = [];

    for (const { dc, dr } of DIRS) {
      const nc = p.col + dc;
      const nr = p.row + dr;
      if (nc < 0 || nc >= BOARD_SIZE || nr < 0 || nr >= BOARD_SIZE) continue;
      if (this._isBlocked(p.col, p.row, nc, nr)) continue;

      // 检查目标格是否有其他棋子
      const blockerIdx = this.players.findIndex(
        op => op.col === nc && op.row === nr && op !== p
      );

      if (blockerIdx === -1) {
        // 空格：直接可走
        moves.push({ col: nc, row: nr });
      } else {
        // 有棋子阻挡，尝试跳跃
        const jc = nc + dc;
        const jr = nr + dr;
        const canJump =
          jc >= 0 && jc < BOARD_SIZE &&
          jr >= 0 && jr < BOARD_SIZE &&
          !this._isBlocked(nc, nr, jc, jr) &&
          !this.players.some(op => op.col === jc && op.row === jr);

        if (canJump) {
          // 正面跳跃
          moves.push({ col: jc, row: jr });
        } else {
          // 标准规则：正面跳越被堵时，可走到阻挡棋子左右两侧的相邻格
          // （纵向相遇 → 阻挡棋子左右；横向相遇 → 阻挡棋子上下）
          const sides = dc === 0
            ? [{ sc: nc - 1, sr: nr }, { sc: nc + 1, sr: nr }]
            : [{ sc: nc, sr: nr - 1 }, { sc: nc, sr: nr + 1 }];

          for (const { sc, sr } of sides) {
            if (sc >= 0 && sc < BOARD_SIZE && sr >= 0 && sr < BOARD_SIZE &&
                !this._isBlocked(nc, nr, sc, sr) &&
                !this.players.some(op => op.col === sc && op.row === sr)) {
              moves.push({ col: sc, row: sr });
            }
          }
        }
      }
    }
    return moves;
  }

  // ==================== 挡板放置合法性 ====================

  /**
   * 检查能否在指定位置放置挡板。
   *
   * 约束：
   *   1. 不越界
   *   2. 不与已有挡板重叠（同位置同方向）
   *   3. 不与已有挡板交叉（同位置不同方向）
   *   4. 不与同方向相邻挡板共线重叠
   *   5. **关键规则**：放置后不能完全阻断任何玩家通往目标的路径（BFS 检测）
   */
  canPlaceFence(col, row, dir) {
    if (!Number.isInteger(col) || !Number.isInteger(row) ||
        (dir !== 'h' && dir !== 'v')) {
      return false;
    }

    // 所有挡板都使用 8×8 锚点：col/row ∈ [0, 7]
    if (col < 0 || col >= BOARD_SIZE - 1 || row < 0 || row >= BOARD_SIZE - 1) {
      return false;
    }

    // 拒绝交叉、完全重叠，以及同方向错开一格造成的部分重叠。
    for (const f of this.fences) {
      if (f.dir !== dir && f.col === col && f.row === row) return false;
      if (dir === 'h' && f.dir === 'h' && f.row === row && Math.abs(f.col - col) < 2) return false;
      if (dir === 'v' && f.dir === 'v' && f.col === col && Math.abs(f.row - row) < 2) return false;
    }

    // 路径可达性检查：每个玩家都必须有一条通路到达目标
    const testFence = { col, row, dir };
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!this.hasPath(p.col, p.row, i, testFence)) return false;
    }

    return true;
  }

  /** 获取当前玩家的所有可放置挡板位置（用于 UI 提示或 AI） */
  getValidFencePlacements() {
    const placements = [];
    // 横向挡板
    for (let col = 0; col < BOARD_SIZE - 1; col++) {
      for (let row = 0; row < BOARD_SIZE - 1; row++) {
        if (this.canPlaceFence(col, row, 'h')) {
          placements.push({ col, row, dir: 'h' });
        }
      }
    }
    // 纵向挡板
    for (let col = 0; col < BOARD_SIZE - 1; col++) {
      for (let row = 0; row < BOARD_SIZE - 1; row++) {
        if (this.canPlaceFence(col, row, 'v')) {
          placements.push({ col, row, dir: 'v' });
        }
      }
    }
    return placements;
  }

  // ==================== 执行操作 ====================

  /**
   * 移动棋子。返回 { success, winner } 表示操作结果。
   * 方法内部会校验回合、坐标与走法合法性。
   */
  movePawn(playerIndex, col, row) {
    if (this.winner !== null || this.draw) return { success: false };
    if (!Number.isInteger(playerIndex) || playerIndex !== this.currentTurn ||
        !Number.isInteger(col) || !Number.isInteger(row)) {
      return { success: false };
    }

    const p = this.players[playerIndex];
    if (!p || !this.getValidMoves(playerIndex).some(move => move.col === col && move.row === row)) {
      return { success: false };
    }
    const fromCol = p.col, fromRow = p.row;

    // 记录操作历史（悔棋用）
    this.history.push({
      type: 'move', playerIndex,
      from: { col: fromCol, row: fromRow },
      to: { col, row },
    });

    p.col = col;
    p.row = row;
    p.moves = (p.moves || 0) + 1;
    this.totalMoves = (this.totalMoves || 0) + 1;

    if (this._hasReachedGoal(playerIndex)) {
      this.winner = playerIndex;
    } else {
      this._advanceTurn();
    }
    return { success: true, winner: this.winner };
  }

  /**
   * 放置挡板。返回 { success, winner }。
   * 调用方应确保 fence 合法（先通过 canPlaceFence 校验，且玩家还有剩余挡板）。
   */
  placeFence(playerIndex, col, row, dir) {
    if (this.winner !== null || this.draw) return { success: false };
    if (playerIndex !== this.currentTurn) return { success: false };

    const p = this.players[playerIndex];
    if (p.fences <= 0) return { success: false };
    if (!this.canPlaceFence(col, row, dir)) return { success: false };

    // 记录操作历史（悔棋用）
    this.history.push({ type: 'fence', playerIndex, fence: { col, row, dir } });

    p.fences--;
    p.wallsUsed = (p.wallsUsed || 0) + 1;
    this.fences.push({ col, row, dir, playerIndex });
    this._advanceTurn();
    return { success: true, winner: this.winner };
  }

  /**
   * 悔棋：撤销最近一步操作（仅本地模式支持）。
   * 返回 { success, action } 表示撤销结果和撤销的动作描述。
   */
  undo() {
    if (this.history.length === 0) return { success: false };

    const last = this.history.pop();

    if (last.type === 'surrender') {
      const p = this.players[last.playerIndex];
      if (p) p.eliminated = false;
      this.draw = false;
      if (this.winner !== null) this.winner = null;
      this.currentTurn = last.playerIndex;
      return { success: true, action: `撤销 ${p?.name || '玩家'} 的认输` };
    }

    if (last.type === 'move') {
      const p = this.players[last.playerIndex];
      p.col = last.from.col;
      p.row = last.from.row;
      this.currentTurn = last.playerIndex;
      // 还原统计计数（AI 搜索模拟与真实落子都依赖此平衡）
      p.moves = Math.max(0, (p.moves || 0) - 1);
      this.totalMoves = Math.max(0, (this.totalMoves || 0) - 1);
      // 如果撤销后之前有获胜者，清除获胜状态
      if (this.winner !== null) this.winner = null;
      this.draw = false;
      return { success: true, action: `撤销 ${p.name} 的移动` };
    }

    if (last.type === 'fence') {
      const p = this.players[last.playerIndex];
      p.fences++;
      // 移除最后放置的挡板
      this.fences.pop();
      this.currentTurn = last.playerIndex;
      p.wallsUsed = Math.max(0, (p.wallsUsed || 0) - 1);
      if (this.winner !== null) this.winner = null;
      this.draw = false;
      return { success: true, action: `撤销 ${p.name} 的挡板` };
    }

    return { success: false };
  }

  // ==================== AI 搜索辅助（模拟与回退） ====================

  /**
   * 计算指定玩家到目标的最短步数（BFS）。不可达返回 -1。
   * 仅供 AI 评估与走法排序使用，不修改任何状态。
   */
  shortestPathLength(playerIndex) {
    const p = this.players[playerIndex];
    if (!p || p.eliminated) return -1;
    const visited = new Int32Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
    const queue = [{ col: p.col, row: p.row }];
    let head = 0;
    visited[p.row * BOARD_SIZE + p.col] = 0;

    while (head < queue.length) {
      const { col: c, row: r } = queue[head++];
      if ((p.goalCol !== -1 && c === p.goalCol) ||
          (p.goalRow !== -1 && r === p.goalRow)) {
        return visited[r * BOARD_SIZE + c];
      }
      for (const { dc, dr } of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= BOARD_SIZE || nr < 0 || nr >= BOARD_SIZE) continue;
        const idx = nr * BOARD_SIZE + nc;
        if (visited[idx] !== -1 || this._isBlocked(c, r, nc, nr)) continue;
        visited[idx] = visited[r * BOARD_SIZE + c] + 1;
        queue.push({ col: nc, row: nr });
      }
    }
    return -1;
  }

  /**
   * 仅供 AI 搜索使用：不校验回合、不推进回合，直接执行动作。
   * 与 movePawn/placeFence 的区别在于绕过 currentTurn / winner / draw 校验。
   */
  simulateMove(playerIndex, col, row) {
    const p = this.players[playerIndex];
    if (!p) return false;
    this.history.push({
      type: 'move', playerIndex,
      from: { col: p.col, row: p.row }, to: { col, row },
    });
    p.col = col;
    p.row = row;
    p.moves = (p.moves || 0) + 1;
    this.totalMoves = (this.totalMoves || 0) + 1;
    return true;
  }

  /** 仅供 AI 搜索使用：直接放置挡板（不校验回合）。 */
  simulateFence(playerIndex, col, row, dir) {
    const p = this.players[playerIndex];
    if (!p || p.fences <= 0) return false;
    this.history.push({ type: 'fence', playerIndex, fence: { col, row, dir } });
    p.fences--;
    p.wallsUsed = (p.wallsUsed || 0) + 1;
    this.fences.push({ col, row, dir, playerIndex });
    return true;
  }

  /** 统一动作入口：{ type:'move'|'fence', col, row, dir? } */
  simulate(action, playerIndex) {
    if (action.type === 'move') return this.simulateMove(playerIndex, action.col, action.row);
    if (action.type === 'fence') return this.simulateFence(playerIndex, action.col, action.row, action.dir);
    return false;
  }

  /** 回退最近一次模拟（AI 搜索用，复用悔棋逻辑）。 */
  rollback() {
    return this.undo();
  }

  // ==================== 认输与和棋 ====================

  /** 玩家认输：多人模式下标记淘汰；仅剩一人时直接判胜。 */
  surrender(playerIndex) {
    if (this.winner !== null || this.draw) return { success: false };
    const p = this.players[playerIndex];
    if (!p || p.eliminated) return { success: false };
    p.eliminated = true;
    this.history.push({ type: 'surrender', playerIndex });

    const active = this.players.filter(x => !x.eliminated);
    if (active.length === 1) {
      this.winner = this.players.indexOf(active[0]);
      return { success: true, winner: this.winner };
    }
    this._advanceTurn();
    return { success: true };
  }

  /** 双方同意和棋。 */
  declareDraw() {
    if (this.winner !== null || this.draw) return { success: false };
    this.draw = true;
    return { success: true };
  }

  /** 获取游戏统计信息 */
  getStats() {
    const elapsed = Math.floor((Date.now() - (this.startTime || Date.now())) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return {
      totalMoves: this.totalMoves || 0,
      elapsed: `${minutes}分${seconds}秒`,
      players: this.players.map(p => ({
        name: p.name,
        color: p.color,
        moves: p.moves || 0,
        wallsUsed: p.wallsUsed || 0,
        fences: p.fences,
      })),
    };
  }
}
