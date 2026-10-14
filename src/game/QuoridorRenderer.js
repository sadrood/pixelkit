/**
 * QuoridorRenderer — Canvas 棋盘渲染器
 *
 * 职责：将游戏状态绘制到 Canvas 上。不包含任何游戏逻辑。
 * 棋子绘制在格子中心（网格内部），挡板绘制在格子之间的线上。
 * 支持：棋盘网格、棋子、挡板、移动提示、选中高亮、鼠标悬停预览。
 */

const CELL = 62;       // 棋盘每格像素（基准值）
const PADDING = 40;    // 棋盘四周留白
const BOARD_SIZE = 9;  // 9×9 格子

export class QuoridorRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;           // 当前缩放比
    this.hoverCell = null;     // { col, row } 鼠标悬停格
    this.fencePreview = null;  // { col, row, dir } 挡板预览

    this._resizeTimer = null;
    this._measure();
    // 桌面端：窗口尺寸变化
    window.addEventListener('resize', () => this._debouncedResize());
    // 移动端：地址栏显隐、键盘弹出等导致 visualViewport 变化
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this._debouncedResize());
    }
  }

  /** 防抖 resize（移动端避免频繁重绘） */
  _debouncedResize() {
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      this._measure();
    }, 150);
  }

  // ==================== 尺寸计算 ====================

  /** 根据棋盘容器实际可用空间计算 Canvas 尺寸与缩放比（适配桌面/移动端布局） */
  _measure() {
    const container = this.canvas.parentElement;
    // 优先取容器尺寸；容器不可见时退回窗口尺寸估算
    const availW = (container && container.clientWidth > 0) ? container.clientWidth : window.innerWidth;
    // 移动端优先用 visualViewport（排除地址栏干扰），桌面端用容器高度
    const viewH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const fallbackH = Math.max(viewH - 120, 260); // 去掉 header + 控件高度
    const availH = (container && container.clientHeight > 20) ? container.clientHeight : fallbackH;
    const maxW = Math.max(availW - 8, 240);
    const maxH = Math.max(availH - 8, 240);
    const needed = BOARD_SIZE * CELL + PADDING * 2;
    this.scale = Math.max(Math.min(maxW / needed, maxH / needed, 1.2), 0.25);
    const size = Math.floor(needed * this.scale);
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
  }

  /** 重新计算尺寸并重绘（用于面板显示后调用） */
  resize() {
    this._measure();
  }

  // ==================== 坐标映射 ====================

  /** 像素 → 棋盘格子坐标。使用 Math.floor 将点击区域映射为格子索引（网格内部）。 */
  pixelToGrid(px, py) {
    const cell = CELL * this.scale;
    const pad = PADDING * this.scale;
    const col = Math.floor((px - pad) / cell);
    const row = Math.floor((py - pad) / cell);
    if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;
    return { col, row };
  }

  /**
   * 像素坐标 → 最近的挡板放置位置。
   * 鼠标靠近方格边缘时返回可放置挡板的位置。
   * 挡板始终在格子之间的线上，坐标计算不受棋子偏移影响。
   */
  pixelToFence(px, py) {
    const cell = CELL * this.scale;
    const pad = PADDING * this.scale;
    const fx = (px - pad) / cell;
    const fy = (py - pad) / cell;
    if (fx < 0 || fx > BOARD_SIZE || fy < 0 || fy > BOARD_SIZE) return null;

    const nearestX = Math.round(fx);
    const nearestY = Math.round(fy);
    const distX = Math.abs(fx - nearestX);
    const distY = Math.abs(fy - nearestY);
    const margin = 0.25;

    const vertical = distX < margin && nearestX > 0 && nearestX < BOARD_SIZE
      ? {
          fence: {
            col: nearestX - 1,
            row: Math.min(Math.max(Math.round(fy) - 1, 0), BOARD_SIZE - 2),
            dir: 'v',
          },
          distance: distX,
        }
      : null;
    const horizontal = distY < margin && nearestY > 0 && nearestY < BOARD_SIZE
      ? {
          fence: {
            col: Math.min(Math.max(Math.round(fx) - 1, 0), BOARD_SIZE - 2),
            row: nearestY - 1,
            dir: 'h',
          },
          distance: distY,
        }
      : null;

    if (!vertical) return horizontal?.fence || null;
    if (!horizontal) return vertical.fence;
    if (horizontal.distance < vertical.distance) return horizontal.fence;
    if (vertical.distance < horizontal.distance) return vertical.fence;

    // 交叉点距离相同时，沿哪个方向更接近挡板段中心就选择哪个方向。
    const fracX = fx - Math.floor(fx);
    const fracY = fy - Math.floor(fy);
    return Math.abs(fracX - 0.5) <= Math.abs(fracY - 0.5)
      ? horizontal.fence
      : vertical.fence;
  }

  /**
   * 像素坐标 + 指定方向 → 最近的挡板槽位（拖拽放置用）。
   * 横向挡板：鼠标靠近某条水平网格线时，吸附到该横墙槽位；
   * 纵向挡板：鼠标靠近某条垂直网格线时，吸附到该竖墙槽位。
   * 不再受"最近网格线方向"的歧义影响，边缘槽位可稳定命中。
   */
  pixelToFenceDir(px, py, dir) {
    const cell = CELL * this.scale;
    const pad = PADDING * this.scale;
    const fx = (px - pad) / cell;
    const fy = (py - pad) / cell;
    if (fx < 0 || fx > BOARD_SIZE || fy < 0 || fy > BOARD_SIZE) return null;

    const margin = 0.4;
    const nearestX = Math.round(fx);
    const nearestY = Math.round(fy);
    const distX = Math.abs(fx - nearestX);
    const distY = Math.abs(fy - nearestY);

    if (dir === 'h') {
      // 需要靠近水平网格线（row 边界），横向跨度吸附到最近锚点
      if (nearestY <= 0 || nearestY >= BOARD_SIZE || distY > margin) return null;
      const col = Math.min(Math.max(nearestX - 1, 0), BOARD_SIZE - 2);
      return { col, row: nearestY - 1, dir: 'h' };
    }
    if (dir === 'v') {
      // 需要靠近垂直网格线（col 边界）
      if (nearestX <= 0 || nearestX >= BOARD_SIZE || distX > margin) return null;
      const row = Math.min(Math.max(nearestY - 1, 0), BOARD_SIZE - 2);
      return { col: nearestX - 1, row, dir: 'v' };
    }
    return null;
  }

  /** 棋盘格子 → 像素坐标（格子中心） */
  gridToPixel(col, row) {
    const cell = CELL * this.scale;
    const pad = PADDING * this.scale;
    return { x: pad + col * cell + cell / 2, y: pad + row * cell + cell / 2 };
  }

  // ==================== 绘制 ====================

  /**
   * 绘制完整棋盘。
   * @param {QuoridorEngine} engine
   * @param {object} highlight - 可选 { selectedPawn, validMoves, canPlaceFence, pendingFence }
   */
  render(engine, highlight = {}) {
    const ctx = this.ctx;
    const s = this.scale;
    const cell = CELL * s;
    const pad = PADDING * s;
    const total = BOARD_SIZE * cell;
    const w = this.canvas.width;

    ctx.clearRect(0, 0, w, this.canvas.height);

    // 背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, this.canvas.height);
    ctx.fillStyle = '#2d2d44';
    ctx.fillRect(pad, pad, total, total);

    // 目标区域底色
    this._drawGoalZones(engine, pad, cell, total);

    // 网格线
    this._drawGrid(pad, cell, total, s);

    // 交叉点装饰
    this._drawIntersections(pad, cell, s);

    // 挡板
    for (const f of engine.fences) {
      this._drawFence(f, s, false, engine);
    }

    // 挡板预览（绿色=合法，红色=非法）
    if (this.fencePreview) {
      const isLegal = highlight.canPlaceFence?.(this.fencePreview);
      this._drawFence(this.fencePreview, s, isLegal ? 'legal' : 'illegal');
    }

    // 待确认挡板预览（两段确认，黄色闪烁效果）
    if (highlight.pendingFence) {
      const isLegal = highlight.canPlaceFence?.(highlight.pendingFence);
      this._drawFence(highlight.pendingFence, s, isLegal ? 'pending' : 'illegal');
    }

    // 合法移动提示
    if (highlight.validMoves) {
      this._drawMoveHints(highlight.validMoves, pad, cell, s, engine);
    }

    // 棋子悬停高亮
    if (this.hoverCell) {
      this._drawHoverCell(this.hoverCell, pad, cell, s);
    }

    // 棋子
    engine.players.forEach((p, i) => {
      const isSelected = highlight.selectedPawn === i;
      this._drawPawn(p, pad, cell, s, isSelected);
    });
  }

  _drawGoalZones(engine, pad, cell, total) {
    engine.players.forEach((p) => {
      this.ctx.fillStyle = p.color.slice(0, 7) + '20';
      if (p.goalRow !== -1) {
        const y = p.goalRow === 0 ? pad : pad + 8 * cell;
        this.ctx.fillRect(pad, y, total, cell);
      }
      if (p.goalCol !== -1) {
        const x = p.goalCol === 0 ? pad : pad + 8 * cell;
        this.ctx.fillRect(x, pad, cell, total);
      }
    });
  }

  _drawGrid(pad, cell, total, s) {
    this.ctx.strokeStyle = '#444';
    this.ctx.lineWidth = 1.5 * s;
    for (let i = 0; i <= BOARD_SIZE; i++) {
      const pos = pad + i * cell;
      this.ctx.beginPath();
      this.ctx.moveTo(pad, pos);
      this.ctx.lineTo(pad + total, pos);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(pos, pad);
      this.ctx.lineTo(pos, pad + total);
      this.ctx.stroke();
    }
  }

  _drawIntersections(pad, cell, s) {
    this.ctx.fillStyle = '#555';
    for (let r = 0; r <= BOARD_SIZE; r++) {
      for (let c = 0; c <= BOARD_SIZE; c++) {
        this.ctx.beginPath();
        this.ctx.arc(pad + c * cell, pad + r * cell, 2.5 * s, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  _drawFence(f, s, mode, engine) {
    const ctx = this.ctx;
    const cell = CELL * s;
    const pad = PADDING * s;
    const half = 4 * s;

    // mode: 'legal' = 绿色预览, 'illegal' = 红色预览, 'pending' = 黄色确认预览, falsy = 正常挡板
    if (mode === 'legal') {
      ctx.fillStyle = 'rgba(16,185,129,0.45)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5 * s;
    } else if (mode === 'illegal') {
      ctx.fillStyle = 'rgba(239,68,68,0.3)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 * s;
    } else if (mode === 'pending') {
      ctx.fillStyle = 'rgba(251,191,36,0.55)';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3 * s;
    } else {
      // 已放置的挡板：按玩家颜色着色
      const owner = engine && f.playerIndex != null
        ? engine.players[f.playerIndex]
        : null;
      ctx.fillStyle = owner ? owner.color.slice(0, 7) + '99' : '#e5e7eb';
      ctx.strokeStyle = owner ? owner.color.slice(0, 7) : '#6b7280';
      ctx.lineWidth = 1.5 * s;
    }

    if (f.dir === 'h') {
      // 横向挡板：横跨 col~col+1，在 row 与 row+1 之间
      const x = pad + f.col * cell;
      const y = pad + f.row * cell + cell;
      this._roundRect(x, y - half, cell * 2, half * 2, half);
    } else {
      // 纵向挡板：纵跨 row~row+1，在 col 与 col+1 之间
      const x = pad + f.col * cell + cell;
      const y = pad + f.row * cell;
      this._roundRect(x - half, y, half * 2, cell * 2, half);
    }
    ctx.fill();
    if (mode) ctx.stroke();
  }

  _drawMoveHints(moves, pad, cell, s, engine) {
    if (!moves || moves.length === 0) return;
    const color = engine.players[engine.currentTurn]?.color || '#fff';
    const ctx = this.ctx;
    const r = cell * 0.22;

    ctx.fillStyle = color + '40';
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 2 * s;
    for (const m of moves) {
      ctx.beginPath();
      // 画在格子中心（网格内部）
      ctx.arc(pad + m.col * cell + cell / 2, pad + m.row * cell + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** 悬停格子高亮 */
  _drawHoverCell(pos, pad, cell, s) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(pad + pos.col * cell, pad + pos.row * cell, cell, cell);
  }

  _drawPawn(p, pad, cell, s, isSelected) {
    const ctx = this.ctx;
    // 画在格子中心（网格内部）
    const px = pad + p.col * cell + cell / 2;
    const py = pad + p.row * cell + cell / 2;
    const r = cell * 0.35;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(px + 2 * s, py + 2 * s, r, 0, Math.PI * 2);
    ctx.fill();

    // 主体渐变
    const grad = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, p.color);
    grad.addColorStop(1, this._darken(p.color, 40));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    // 选中高亮环
    if (isSelected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.arc(px, py, r + 3 * s, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 剩余挡板数
    ctx.fillStyle = '#fff';
    ctx.font = `${10 * s}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🚧${p.fences}`, px, py + r + 12 * s);
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _darken(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `rgb(${r},${g},${b})`;
  }
}
