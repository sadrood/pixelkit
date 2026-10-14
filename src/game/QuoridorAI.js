/**
 * QuoridorAI — 步步为营人机对战 AI（仅支持 2 人局）
 *
 * 实现：负极大值（Negamax）Alpha-Beta 剪枝 + 迭代加深。
 * 搜索过程完全依赖 QuoridorEngine 的 simulate/rollback 模拟，不复制状态。
 * 评估函数：双方最短路径差 + 剩余挡板差 + 终局分数。
 */

const WIN_SCORE = 100000;
const MAX_DEPTH = 3;
const THINK_TIME = 1200; // 单步思考时间上限（ms）

export class QuoridorAI {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth ?? MAX_DEPTH;
    this.thinkTime = options.thinkTime ?? THINK_TIME;
    this._history = []; // 近期走位记录，避免原地踱步
    this._historyMax = 6;
  }

  /** 计算当前玩家最优动作，返回 { type:'move'|'fence', col, row, dir? } */
  chooseAction(engine, playerIndex) {
    const start = Date.now();
    const rootActions = this._orderRootActions(engine, playerIndex);
    if (rootActions.length === 0) return null;

    let best = rootActions[0];
    let alpha = -Infinity;
    const beta = Infinity;

    for (let depth = 1; depth <= this.maxDepth; depth++) {
      const iterStart = Date.now();
      let iterBest = null;
      let iterAlpha = -Infinity;

      for (const action of rootActions) {
        if (Date.now() - start > this.thinkTime) break;
        engine.simulate(action, playerIndex);
        const score = -this._negamax(engine, 1 - playerIndex, depth - 1, -beta, -alpha, start);
        engine.rollback();
        if (score > iterAlpha) {
          iterAlpha = score;
          iterBest = action;
        }
        if (iterAlpha > alpha) alpha = iterAlpha;
      }

      if (iterBest) {
        best = iterBest;
        alpha = iterAlpha;
      }
      // 该层用时已占预算大部分，停止加深
      if (Date.now() - start > this.thinkTime ||
          Date.now() - iterStart > this.thinkTime * 0.75) break;
    }

    // 记录走位历史，避免来回踱步
    this._pushHistory(best, playerIndex);
    return best;
  }

  /** 记录走位，仅对 move 动作有意义 */
  _pushHistory(action, playerIndex) {
    if (!action || action.type !== 'move') return;
    const key = `${playerIndex}:${action.col},${action.row}`;
    this._history.push(key);
    if (this._history.length > this._historyMax) this._history.shift();
  }

  /** 负极大值搜索 */
  _negamax(engine, playerIndex, depth, alpha, beta, start) {
    if (Date.now() - start > this.thinkTime) {
      return this._evaluate(engine, playerIndex);
    }

    // 终局：任何玩家到达目标
    for (let i = 0; i < engine.players.length; i++) {
      if (!engine.players[i].eliminated && engine._hasReachedGoal(i)) {
        return i === playerIndex ? WIN_SCORE : -WIN_SCORE;
      }
    }

    if (depth === 0) return this._evaluate(engine, playerIndex);

    const actions = this._generateActions(engine, playerIndex);
    if (actions.length === 0) return -WIN_SCORE; // 无棋可走视为必败

    let value = -Infinity;
    for (const action of actions) {
      engine.simulate(action, playerIndex);
      const score = -this._negamax(engine, 1 - playerIndex, depth - 1, -beta, -alpha, start);
      engine.rollback();
      if (score > value) value = score;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return value;
  }

  /** 生成某玩家的全部合法动作（移动 + 挡板） */
  _generateActions(engine, playerIndex) {
    const actions = [];
    for (const m of engine.getValidMoves(playerIndex)) {
      actions.push({ type: 'move', col: m.col, row: m.row });
    }
    const p = engine.players[playerIndex];
    if (p && p.fences > 0) {
      for (const f of engine.getValidFencePlacements()) {
        actions.push({ type: 'fence', col: f.col, row: f.row, dir: f.dir });
      }
    }
    return actions;
  }

  /**
   * 根节点动作排序（决定搜索顺序，超时/平局时直接决定选谁）：
   *   - 移动：缩短自己到目标的距离越多越优先（推进 > 横移 > 后退）
   *   - 挡板：只有切实增加对手路径长度才加分；若损害自己的路径则重罚
   * 保证即使搜索预算不够，AI 也会先尝试"前进"，而不是乱放挡板或原地横跳。
   */
  _orderRootActions(engine, playerIndex) {
    const other = 1 - playerIndex;
    const actions = this._generateActions(engine, playerIndex);
    const myBase = engine.shortestPathLength(playerIndex);
    const oppBase = engine.shortestPathLength(other);

    const scored = actions.map(action => {
      engine.simulate(action, playerIndex);
      const myDist = engine.shortestPathLength(playerIndex);
      const oppDist = engine.shortestPathLength(other);
      engine.rollback();

      let s = 0;
      if (action.type === 'move') {
        s = (myBase - myDist) * 100 - myDist * 3;
        // 惩罚近期走过的格子，避免原地踱步
        const moveKey = `${playerIndex}:${action.col},${action.row}`;
        const recentIdx = this._history.lastIndexOf(moveKey);
        if (recentIdx >= 0) {
          // 越近越罚
          s -= (this._history.length - recentIdx) * 50;
        }
      } else {
        s = (oppDist - oppBase) * 120 - Math.max(0, myDist - myBase) * 80 - 50;
      }
      return { action, s };
    });

    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.action);
  }

  /** 静态评估：正数对 playerIndex 有利 */
  _evaluate(engine, playerIndex) {
    const other = 1 - playerIndex;
    const myDist = engine.shortestPathLength(playerIndex);
    const oppDist = engine.shortestPathLength(other);
    if (myDist === -1) return -WIN_SCORE;
    if (oppDist === -1) return WIN_SCORE;
    const myFences = engine.players[playerIndex]?.fences ?? 0;
    const oppFences = engine.players[other]?.fences ?? 0;
    return (oppDist - myDist) * 100 + (myFences - oppFences) * 6;
  }
}
