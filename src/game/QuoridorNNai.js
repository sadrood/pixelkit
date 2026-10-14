/**
 * QuoridorNNai — 超绝 AI（AlphaZero 式 MCTS + ONNX 神经网络推理）
 *
 * 使用训练好的 PyTorch→ONNX 模型，在浏览器端进行 PUCT 蒙特卡洛树搜索。
 * 每次搜索约 30 次模拟（优化后），模型评估棋局状态的价值和策略分布。
 */

import * as ort from 'onnxruntime-web';

const SIZE = 9;
const ACTION_N = 209; // 81 移动 + 64 横墙 + 64 竖墙
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ---- 轻量棋盘状态（MCTS 搜索用） ----

class LightState {
  constructor() {
    this.players = [
      { col: 4, row: 8, goal_row: 0, walls: 10 },
      { col: 4, row: 0, goal_row: 8, walls: 10 },
    ];
    this.walls = [];    // [{col, row, dir}]
    this.turn = 0;
    this.winner = null;
  }

  clone() {
    const s = new LightState();
    s.players = this.players.map(p => ({ col: p.col, row: p.row, goal_row: p.goal_row, walls: p.walls }));
    s.walls = this.walls.map(w => ({ col: w.col, row: w.row, dir: w.dir }));
    s.turn = this.turn;
    s.winner = this.winner;
    return s;
  }

  _isBlocked(c1, r1, c2, r2) {
    const [dc, dr] = [c2 - c1, r2 - r1];
    if (Math.abs(dc) + Math.abs(dr) !== 1) return true;
    if (dr !== 0) {
      // 垂直移动：检查横墙
      const checkR = Math.min(r1, r2);
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i];
        if (w.dir === 'h' && w.row === checkR && (w.col === c1 || w.col === c1 - 1)) return true;
      }
    } else {
      // 水平移动：检查竖墙
      const checkC = Math.min(c1, c2);
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i];
        if (w.dir === 'v' && w.col === checkC && (w.row === r1 || w.row === r1 - 1)) return true;
      }
    }
    return false;
  }

  // ---- 合法走法 ----

  legalMoves(pi) {
    const p = this.players[pi];
    const op = this.players[1 - pi];
    const moves = [];
    for (const [dc, dr] of DIRS) {
      const [nc, nr] = [p.col + dc, p.row + dr];
      if (nc < 0 || nc >= SIZE || nr < 0 || nr >= SIZE) continue;
      if (this._isBlocked(p.col, p.row, nc, nr)) continue;
      if (op.col === nc && op.row === nr) {
        const [jc, jr] = [nc + dc, nr + dr];
        const occupied = (this.players[0].col === jc && this.players[0].row === jr) ||
                         (this.players[1].col === jc && this.players[1].row === jr);
        if (jc >= 0 && jc < SIZE && jr >= 0 && jr < SIZE && !this._isBlocked(nc, nr, jc, jr) && !occupied) {
          moves.push([jc, jr]);
        } else {
          const sides = dc === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [sc, sr] of sides) {
            const [sx, sy] = [nc + sc, nr + sr];
            if (sx < 0 || sx >= SIZE || sy < 0 || sy >= SIZE) continue;
            if (this._isBlocked(nc, nr, sx, sy)) continue;
            if ((this.players[0].col === sx && this.players[0].row === sy) ||
                (this.players[1].col === sx && this.players[1].row === sy)) continue;
            moves.push([sx, sy]);
          }
        }
      } else {
        moves.push([nc, nr]);
      }
    }
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      const k = m[0] * SIZE + m[1];
      if (!seen.has(k)) { seen.add(k); out.push(m); }
    }
    return out;
  }

  // ---- BFS 最短路径（带可选额外挡板） ----

  pathLength(pi, extraWall = null) {
    const p = this.players[pi];
    if (p.goal_row === p.row) return 0;
    const start = [p.col, p.row];
    const q = [start];
    const dist = new Int8Array(SIZE * SIZE).fill(-1);
    dist[p.col * SIZE + p.row] = 0;
    let head = 0;
    while (head < q.length) {
      const [c, r] = q[head++];
      const curDist = dist[c * SIZE + r];
      if (r === p.goal_row) return curDist;
      for (const [dc, dr] of DIRS) {
        const [nc, nr] = [c + dc, r + dr];
        if (nc < 0 || nc >= SIZE || nr < 0 || nr >= SIZE) continue;
        const k = nc * SIZE + nr;
        if (dist[k] >= 0) continue;
        // 检查现有墙
        let blocked = false;
        if (dr !== 0) {
          const cr = Math.min(r, nr);
          for (let wi = 0; wi < this.walls.length; wi++) {
            const w = this.walls[wi];
            if (w.dir === 'h' && w.row === cr && (w.col === c || w.col === c - 1)) { blocked = true; break; }
          }
          // 检查额外横墙
          if (!blocked && extraWall && extraWall.dir === 'h' && extraWall.row === cr && (extraWall.col === c || extraWall.col === c - 1)) blocked = true;
        } else {
          const cc = Math.min(c, nc);
          for (let wi = 0; wi < this.walls.length; wi++) {
            const w = this.walls[wi];
            if (w.dir === 'v' && w.col === cc && (w.row === r || w.row === r - 1)) { blocked = true; break; }
          }
          if (!blocked && extraWall && extraWall.dir === 'v' && extraWall.col === cc && (extraWall.row === r || extraWall.row === r - 1)) blocked = true;
        }
        if (blocked) continue;
        dist[k] = curDist + 1;
        q.push([nc, nr]);
      }
    }
    return -1;
  }

  // ---- 合法挡板（优化版：先用几何检查过滤，仅对通过的做 BFS） ----

  legalFences() {
    const out = [];
    if (this.players[this.turn].walls <= 0) return out;
    const wallSet = this.walls;

    // 预计算 pre-pass 快速过滤表：哪些位置被占用/交叉
    const blocked = new Set();
    for (const w of wallSet) {
      const k = w.col * 8 + w.row;
      blocked.add(k + '_h');
      blocked.add(k + '_v');
      // 重叠宽度为2的墙
      if (w.dir === 'h') {
        if (w.col > 0) blocked.add((w.col - 1) * 8 + w.row + '_h');
        if (w.col < SIZE - 2) blocked.add((w.col + 1) * 8 + w.row + '_h');
      } else {
        if (w.row > 0) blocked.add(w.col * 8 + (w.row - 1) + '_v');
        if (w.row < SIZE - 2) blocked.add(w.col * 8 + (w.row + 1) + '_v');
      }
    }

    // 批量检查：先无 BFS 过滤，再用 BFS 验证
    const candidates = [];
    for (let r = 0; r < SIZE - 1; r++) {
      for (let c = 0; c < SIZE - 1; c++) {
        const k = c * 8 + r;
        // 水平墙不能和同位置的竖直墙交叉
        if (!blocked.has(k + '_h')) candidates.push([c, r, 'h']);
        if (!blocked.has(k + '_v')) candidates.push([c, r, 'v']);
      }
    }

    // BFS 验证通过几何检查的候选
    for (const [c, r, d] of candidates) {
      const extra = { col: c, row: r, dir: d };
      if (this.pathLength(0, extra) >= 0 && this.pathLength(1, extra) >= 0) {
        out.push([c, r, d]);
      }
    }
    return out;
  }

  // ---- 动作索引 ----

  legalActions() {
    const idx = [];
    for (const [c, r] of this.legalMoves(this.turn)) {
      idx.push(r * SIZE + c);
    }
    for (const [c, r, d] of this.legalFences()) {
      if (d === 'h') idx.push(81 + r * 8 + c);
      else idx.push(145 + r * 8 + c);
    }
    return idx;
  }

  /**
   * 返回 (legalActions, legalMask)，避免二次调用 legalActions
   * legalMask 是 Float32Array(ACTION_N)，合法动作为 1.0
   */
  getLegalMask() {
    const idx = [];
    const mask = new Float32Array(ACTION_N);
    for (const [c, r] of this.legalMoves(this.turn)) {
      const a = r * SIZE + c;
      idx.push(a);
      mask[a] = 1.0;
    }
    for (const [c, r, d] of this.legalFences()) {
      let a;
      if (d === 'h') a = 81 + r * 8 + c;
      else a = 145 + r * 8 + c;
      idx.push(a);
      mask[a] = 1.0;
    }
    return { idx, mask };
  }

  applyAction(idx) {
    if (idx < 81) {
      this.applyMove(this.turn, idx % SIZE, Math.floor(idx / SIZE));
    } else if (idx < 145) {
      const k = idx - 81;
      this.applyFence(k % 8, Math.floor(k / 8), 'h');
    } else {
      const k = idx - 145;
      this.applyFence(k % 8, Math.floor(k / 8), 'v');
    }
  }

  applyMove(pi, c, r) {
    const p = this.players[pi];
    p.col = c; p.row = r;
    if (r === p.goal_row) { this.winner = pi; }
    else { this.turn = 1 - this.turn; }
  }

  applyFence(c, r, d) {
    this.players[this.turn].walls -= 1;
    this.walls.push({ col: c, row: r, dir: d });
    this.turn = 1 - this.turn;
  }

  isTerminal() { return this.winner !== null; }

  encode() {
    const my = this.turn;
    const op = 1 - my;
    const board = new Float32Array(5 * SIZE * SIZE);
    const mp = this.players[my];
    const opn = this.players[op];
    board[mp.row * SIZE + mp.col] = 1.0;
    board[SIZE * SIZE + opn.row * SIZE + opn.col] = 1.0;
    for (const w of this.walls) {
      if (w.dir === 'h') {
        board[2 * SIZE * SIZE + w.row * SIZE + w.col] = 1.0;
        board[2 * SIZE * SIZE + w.row * SIZE + w.col + 1] = 1.0;
      } else {
        board[3 * SIZE * SIZE + w.row * SIZE + w.col] = 1.0;
        board[3 * SIZE * SIZE + (w.row + 1) * SIZE + w.col] = 1.0;
      }
    }
    if (mp.goal_row === 0) {
      for (let i = 4 * SIZE * SIZE; i < 5 * SIZE * SIZE; i++) board[i] = 1.0;
    }
    return board;
  }
}

// ---- MCTS 节点 ----

class MCTSNode {
  constructor(prior) {
    this.prior = prior;
    this.visit = 0;
    this.value = 0.0;
    this.children = {};  // { actionIndex: MCTSNode }
  }
}

// ---- MCTS + ONNX 推理 AI ----

export class QuoridorNNai {
  constructor(options = {}) {
    this.sims = options.sims ?? 400;            // MCTS 模拟次数（太少棋力很弱）
    this.thinkTime = options.thinkTime ?? 2000; // 单步思考时间上限（ms）
    this.c_puct = options.c_puct ?? 1.2;
    this._session = null;
    this._modelUrl = options.modelUrl ?? '/quoridor_best.onnx';
    this._ready = false;
    this._loading = null;
    this._warmCache = null; // inference 结果缓存
    this._history = [];      // 近期走位记录，避免原地踱步
    this._historyMax = 6;
  }

  /** 加载 ONNX 模型 + 预热 */
  async ready() {
    if (this._ready) return;
    if (this._loading) return this._loading;
    this._loading = this._loadModel();
    return this._loading;
  }

  async _loadModel() {
    try {
      ort.env.wasm.wasmPaths = '/wasm/';
      ort.env.wasm.numThreads = 1;
      this._session = await ort.InferenceSession.create(this._modelUrl, {
        executionProviders: ['wasm'],
        enableCpuMemArena: true,
      });
      this._ready = true;
      console.log('[QuoridorNNai] ONNX 模型加载成功, inputs:', this._session.inputNames,
        'outputs:', this._session.outputNames);
      await this._warmup();
    } catch (err) {
      this._loading = null; // 重置，允许下次重试
      console.error('[QuoridorNNai] 模型加载失败:', err);
      throw err;
    }
  }

  /** 预热 WASM 推理管线 */
  async _warmup() {
    const board = new Float32Array(5 * SIZE * SIZE);
    board[4 * 8 + 4] = 1.0; // dummy position
    board[SIZE * SIZE + 4] = 1.0;
    const tensor = new ort.Tensor('float32', board, [1, 5, SIZE, SIZE]);
    await this._session.run({ [this._session.inputNames[0]]: tensor });
  }

  /** 记录走位，避免来回踱步 */
  _pushHistory(action) {
    if (!action || action.type !== 'move') return;
    const key = `${action.col},${action.row}`;
    this._history.push(key);
    if (this._history.length > this._historyMax) this._history.shift();
  }

  async chooseAction(engine, playerIndex) {
    await this.ready();
    // 清除上一步的缓存
    this._warmCache = null;

    const rootState = new LightState();
    const aiP = engine.players[playerIndex];
    const otherP = engine.players[1 - playerIndex];
    rootState.players[0] = {
      col: aiP.col, row: aiP.row,
      goal_row: aiP.goalRow, walls: aiP.fences,
    };
    rootState.players[1] = {
      col: otherP.col, row: otherP.row,
      goal_row: otherP.goalRow, walls: otherP.fences,
    };
    for (const f of engine.fences) {
      rootState.walls.push({ col: f.col, row: f.row, dir: f.dir });
    }
    rootState.turn = 0;

    const bestIdx = await this._search(rootState);
    if (bestIdx === null) return null;

    let action;
    if (bestIdx < 81) {
      action = { type: 'move', col: bestIdx % SIZE, row: Math.floor(bestIdx / SIZE) };
    } else if (bestIdx < 145) {
      const k = bestIdx - 81;
      action = { type: 'fence', col: k % 8, row: Math.floor(k / 8), dir: 'h' };
    } else {
      const k = bestIdx - 145;
      action = { type: 'fence', col: k % 8, row: Math.floor(k / 8), dir: 'v' };
    }
    this._pushHistory(action);
    return action;
  }

  // ---- 神经网络评估（接收预计算的合法掩码，避免重复 legalFences） ----

  /** 评估状态，返回 (策略概率, 价值)。legalMask 为预计算结果 */
  async _evaluate(state, legalMask) {
    const board = state.encode();
    const tensor = new ort.Tensor('float32', board, [1, 5, SIZE, SIZE]);

    const feeds = {};
    feeds[this._session.inputNames[0]] = tensor;
    const results = await this._session.run(feeds);

    const outputNames = this._session.outputNames;
    const policyLogits = results[outputNames[0]].cpuData || results[outputNames[0]].data;
    const valueData = results[outputNames[1]].cpuData || results[outputNames[1]].data;
    const value = valueData[0];

    // 合法动作掩码 + Softmax（使用预计算的 mask）
    const masked = new Float32Array(ACTION_N);
    let maxLogit = -Infinity;
    for (let i = 0; i < ACTION_N; i++) {
      masked[i] = legalMask[i] > 0 ? policyLogits[i] : -Infinity;
      if (masked[i] > maxLogit) maxLogit = masked[i];
    }

    let sum = 0;
    const probs = new Float32Array(ACTION_N);
    for (let i = 0; i < ACTION_N; i++) {
      probs[i] = Math.exp(masked[i] - maxLogit);
      sum += probs[i];
    }
    if (sum > 0) {
      for (let i = 0; i < ACTION_N; i++) probs[i] /= sum;
    }
    return { probs, value };
  }

  // ---- MCTS 单次模拟 ----

  async _runSimulation(root, rootState) {
    const s = rootState.clone();
    let node = root;
    const path = [node];
    let leafValue = 0.0;

    while (true) {
      const childKeys = Object.keys(node.children);
      if (childKeys.length === 0) {
        if (s.isTerminal()) {
          leafValue = -1.0;
        } else {
          // 展开叶子节点：获取合法掩码 + 推理
          const { idx: legalIdx, mask: legalMask } = s.getLegalMask();
          const { probs, value } = await this._evaluate(s, legalMask);
          leafValue = value;
          // 用同一个 legalIdx 创建子节点，不再调 legalActions
          for (const a of legalIdx) {
            node.children[a] = new MCTSNode(probs[a]);
          }
        }
        break;
      }

      // PUCT 选择
      let bestA = -1, bestU = -Infinity;
      const total = Math.sqrt(Math.max(node.visit, 1));
      for (const aStr of childKeys) {
        const a = parseInt(aStr);
        const ch = node.children[a];
        const q = ch.visit > 0 ? -ch.value / ch.visit : 0.0;
        const u = q + this.c_puct * ch.prior * total / (1 + ch.visit);
        if (u > bestU) { bestU = u; bestA = a; }
      }

      s.applyAction(bestA);
      if (s.isTerminal()) {
        leafValue = 1.0;
        break;
      }
      node = node.children[bestA];
      path.push(node);
    }

    let v = leafValue;
    for (let i = path.length - 1; i >= 0; i--) {
      path[i].visit += 1;
      path[i].value += v;
      v = -v;
    }
  }

  // ---- MCTS 主搜索 ----

  async _search(state) {
    const { idx: legalIdx, mask: legalMask } = state.getLegalMask();
    if (legalIdx.length === 0) return null;

    // 根节点：预计算 legalMask 后传给 _evaluate
    const root = new MCTSNode(0.0);
    const { probs } = await this._evaluate(state, legalMask);
    for (const a of legalIdx) {
      root.children[a] = new MCTSNode(probs[a]);
    }

    // 执行 sims 次模拟，但受时间预算约束
    const start = Date.now();
    for (let i = 0; i < this.sims; i++) {
      if (Date.now() - start > this.thinkTime) break;
      await this._runSimulation(root, state);
    }

    const elapsed = Date.now() - start;
    console.log(`[QuoridorNNai] MCTS: ${root.visit} visits in ${elapsed}ms`);

    // 选择最优动作（加入历史惩罚，避免原地踱步）
    let bestA = legalIdx[0];
    let bestScore = -Infinity;
    for (const a of legalIdx) {
      const child = root.children[a];
      if (!child || child.visit === 0) continue;
      // 基础分 = 访问次数（MCTS 核心指标）
      let score = child.visit;
      // 历史惩罚：近期走过的格子降低分数
      if (a < 81) {
        const moveKey = `${a % SIZE},${Math.floor(a / SIZE)}`;
        const recentIdx = this._history.lastIndexOf(moveKey);
        if (recentIdx >= 0) {
          score *= 0.3 - (this._history.length - recentIdx) * 0.1; // 越近越罚
        }
      }
      if (score > bestScore) { bestScore = score; bestA = a; }
    }

    return bestA;
  }
}
