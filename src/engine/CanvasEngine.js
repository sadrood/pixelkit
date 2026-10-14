/**
 * CanvasEngine - 无限画布引擎
 * 支持：视口平移(Pan)、滚轮缩放(Zoom)、画布边界动态扩展
 *
 * 坐标系说明：
 * - 世界坐标 (worldX, worldY)：图层在无限画布上的实际位置
 * - 屏幕坐标 (screenX, screenY)：鼠标在 canvas 元素上的像素位置
 * - 视口变换：screen = (world - panOffset) * zoom
 */
export class CanvasEngine {
  constructor(canvasId, initialWidth, initialHeight) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // 画布逻辑尺寸（世界坐标中的画布大小）
    this.width = initialWidth;
    this.height = initialHeight;

    // 视口变换参数
    this.panX = 0;      // 视口左上角在世界坐标中的 X
    this.panY = 0;      // 视口左上角在世界坐标中的 Y
    this.zoom = 1;      // 缩放级别 (0.1 ~ 5.0)
    this.minZoom = 0.05;
    this.maxZoom = 5.0;

    // 存储图片 Image 对象（显示用，可能被缩放）
    this.imageCache = new Map();

    // 存储原始图片（完整分辨率，导出用）
    this.originalImageCache = new Map();

    // 画布网格背景相关
    this.gridSize = 50;
    this.gridColor = '#e0e0e0';
    this.gridBgColor = '#f5f5f5';
  }

  // ==================== 视口变换 ====================

  /**
   * 屏幕坐标 → 世界坐标
   */
  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = screenX - rect.left;
    const sy = screenY - rect.top;
    return {
      x: sx / this.zoom + this.panX,
      y: sy / this.zoom + this.panY
    };
  }

  /**
   * 世界坐标 → 屏幕坐标
   */
  worldToScreen(worldX, worldY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (worldX - this.panX) * this.zoom + rect.left,
      y: (worldY - this.panY) * this.zoom + rect.top
    };
  }

  /**
   * 世界坐标 → Canvas 内坐标（相对于 canvas 元素左上角）
   */
  worldToCanvas(worldX, worldY) {
    return {
      x: (worldX - this.panX) * this.zoom,
      y: (worldY - this.panY) * this.zoom
    };
  }

  /**
   * Canvas 内坐标 → 世界坐标
   */
  canvasToWorld(canvasX, canvasY) {
    return {
      x: canvasX / this.zoom + this.panX,
      y: canvasY / this.zoom + this.panY
    };
  }

  /**
   * 设置缩放级别（以屏幕中心为缩放原点）
   */
  zoomAt(centerScreenX, centerScreenY, newZoom) {
    const oldZoom = this.zoom;
    const clampedZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

    if (clampedZoom === oldZoom) return;

    // 计算屏幕中心对应的世界坐标（缩放前）
    const worldCX = centerScreenX / oldZoom + this.panX;
    const worldCY = centerScreenY / oldZoom + this.panY;

    this.zoom = clampedZoom;

    // 调整平移使中心点不变
    this.panX = worldCX - centerScreenX / this.zoom;
    this.panY = worldCY - centerScreenY / this.zoom;
  }

  /**
   * 平移视口
   */
  pan(deltaScreenX, deltaScreenY) {
    this.panX -= deltaScreenX / this.zoom;
    this.panY -= deltaScreenY / this.zoom;
  }

  /**
   * 聚焦到世界坐标点（移动视口使该点居中）
   */
  focusOn(worldX, worldY) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    this.panX = worldX - cx / this.zoom;
    this.panY = worldY - cy / this.zoom;
  }

  /**
   * 重置视口（适配画布大小）
   */
  resetView() {
    const rect = this.canvas.getBoundingClientRect();
    const padding = 40;

    // 计算使整个画布可见的缩放
    const scaleX = (rect.width - padding * 2) / this.width;
    const scaleY = (rect.height - padding * 2) / this.height;
    this.zoom = Math.min(scaleX, scaleY, 1.0);

    // 居中
    this.panX = (this.width - rect.width / this.zoom) / 2;
    this.panY = (this.height - rect.height / this.zoom) / 2;
  }

  // ==================== 画布尺寸 ====================

  /**
   * 设置画布逻辑尺寸
   */
  setSize(width, height) {
    this.width = Math.max(100, width);
    this.height = Math.max(100, height);
    document.getElementById('canvas-width').value = this.width;
    document.getElementById('canvas-height').value = this.height;
    this.updateSizeDisplay();
  }

  /**
   * 根据图层位置自动扩展画布
   */
  autoExpand(layers) {
    if (layers.length === 0) return;

    let maxX = this.width;
    let maxY = this.height;
    let minX = 0;
    let minY = 0;

    for (const layer of layers) {
      if (!layer.visible) continue;
      const r = layer.x + layer.width;
      const b = layer.y + layer.height;
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;
      if (layer.x < minX) minX = layer.x;
      if (layer.y < minY) minY = layer.y;
    }

    // 增加边距
    const margin = 200;
    const newWidth = Math.max(this.width, maxX + margin);
    const newHeight = Math.max(this.height, maxY + margin);

    // 处理负坐标
    if (minX < 0 || minY < 0) {
      const shiftX = minX < 0 ? -minX + margin : 0;
      const shiftY = minY < 0 ? -minY + margin : 0;

      // 移动所有图层
      if (shiftX > 0 || shiftY > 0) {
        for (const layer of layers) {
          layer.x += shiftX;
          layer.y += shiftY;
        }
        this.panX += shiftX;
        this.panY += shiftY;
      }

      const finalWidth = Math.max(this.width, maxX + shiftX + margin);
      const finalHeight = Math.max(this.height, maxY + shiftY + margin);
      this.setSize(finalWidth, finalHeight);
    } else if (newWidth !== this.width || newHeight !== this.height) {
      this.setSize(newWidth, newHeight);
    }
  }

  updateSizeDisplay() {
    const el = document.getElementById('canvas-size');
    if (el) {
      el.textContent = `画布: ${this.width} × ${this.height} | 缩放: ${Math.round(this.zoom * 100)}%`;
    }
  }

  // ==================== 渲染 ====================

  /**
   * 渲染所有图层到画布
   * @param {Array} layers - 图层列表
   * @param {Object} snapLines - 可选，吸附参考线
   */
  render(layers, snapLines = null) {
    const ctx = this.ctx;
    const canvasEl = this.canvas;

    // 使 canvas 元素填满容器
    const container = canvasEl.parentElement;
    if (container) {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w;
        canvasEl.height = h;
      }
    }

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // 绘制背景
    this.drawBackground(ctx, canvasEl.width, canvasEl.height);

    // 绘制画布区域（白色底色 + 阴影）
    this.drawCanvasArea(ctx);

    // 裁剪到画布区域
    ctx.save();
    const canvasRect = this.getCanvasRect();
    ctx.beginPath();
    ctx.rect(canvasRect.x, canvasRect.y, canvasRect.w, canvasRect.h);
    ctx.clip();

    // 应用视口变换，在世界坐标中渲染
    ctx.save();
    ctx.translate(-this.panX * this.zoom, -this.panY * this.zoom);
    ctx.scale(this.zoom, this.zoom);

    // 棋盘格透明背景
    this.drawTransparencyGrid(ctx, 0, 0, this.width, this.height);

    // 按图层顺序渲染
    for (const layer of layers) {
      if (!layer.visible) continue;
      this.renderLayer(layer, ctx);
    }

    ctx.restore(); // 恢复视口变换
    ctx.restore(); // 恢复裁剪

    // 绘制编组边框
    this.drawGroupBoxes(layers);

    // 绘制选中框
    this.drawSelectionBox(layers);

    // 绘制吸附参考线
    if (snapLines) {
      this.drawSnapLines(snapLines);
    }

    this.updateSizeDisplay();
  }

  /**
   * 绘制背景（无限网格）
   */
  drawBackground(ctx, w, h) {
    // 基础背景
    ctx.fillStyle = '#e8ecf1';
    ctx.fillRect(0, 0, w, h);

    // 计算网格在世界坐标中的起止范围
    const worldLeft = this.panX;
    const worldTop = this.panY;
    const worldRight = this.panX + w / this.zoom;
    const worldBottom = this.panY + h / this.zoom;

    // 适配缩放的网格大小
    const baseGrid = 50;
    let gridSize = baseGrid;
    if (this.zoom < 0.25) gridSize = baseGrid * 4;
    else if (this.zoom < 0.5) gridSize = baseGrid * 2;

    const startX = Math.floor(worldLeft / gridSize) * gridSize;
    const startY = Math.floor(worldTop / gridSize) * gridSize;

    ctx.save();
    ctx.translate(-this.panX * this.zoom, -this.panY * this.zoom);
    ctx.scale(this.zoom, this.zoom);

    ctx.strokeStyle = 'rgba(180,180,180,0.4)';
    ctx.lineWidth = 1 / this.zoom;

    ctx.beginPath();
    for (let x = startX; x <= worldRight; x += gridSize) {
      ctx.moveTo(x, worldTop);
      ctx.lineTo(x, worldBottom);
    }
    for (let y = startY; y <= worldBottom; y += gridSize) {
      ctx.moveTo(worldLeft, y);
      ctx.lineTo(worldRight, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 绘制画布区域（带阴影的白板效果）
   */
  drawCanvasArea(ctx) {
    const rect = this.getCanvasRect();

    // 阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    // 边框
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  /**
   * 绘制透明棋盘格（视觉上表示透明区域）
   */
  drawTransparencyGrid(ctx, x, y, w, h) {
    const size = 16; // 棋盘格大小

    ctx.save();
    for (let row = 0; row < Math.ceil(h / size); row++) {
      for (let col = 0; col < Math.ceil(w / size); col++) {
        const isLight = (row + col) % 2 === 0;
        ctx.fillStyle = isLight ? '#ffffff' : '#e5e5e5';
        ctx.fillRect(x + col * size, y + row * size, size, size);
      }
    }
    ctx.restore();
  }

  /**
   * 获取画布在屏幕上的矩形
   */
  getCanvasRect() {
    return {
      x: (0 - this.panX) * this.zoom,
      y: (0 - this.panY) * this.zoom,
      w: this.width * this.zoom,
      h: this.height * this.zoom
    };
  }

  /**
   * 绘制所有选中图层的选中框
   */
  drawSelectionBox(layers) {
    const selectedIds = this._selectedLayerIds || (this._selectedLayerId ? [this._selectedLayerId] : []);
    for (const id of selectedIds) {
      const layer = layers.find(l => l.id === id);
      if (!layer || !layer.visible) continue;
      this.drawSingleSelectionBox(layer);
    }
  }

  drawSingleSelectionBox(layer) {
    const ctx = this.ctx;
    const { x, y, width, height, locked } = layer;

    const sx = (x - this.panX) * this.zoom;
    const sy = (y - this.panY) * this.zoom;
    const sw = width * this.zoom;
    const sh = height * this.zoom;

    ctx.save();

    // 锁定图层用红色边框
    const color = locked ? '#ef4444' : '#6366f1';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);

    // 四角控制点（放大到 7px 便于点击）
    const handleSize = 7;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    const handles = [
      { x: sx, y: sy },
      { x: sx + sw, y: sy },
      { x: sx, y: sy + sh },
      { x: sx + sw, y: sy + sh }
    ];

    for (const h of handles) {
      ctx.fillRect(h.x - handleSize, h.y - handleSize, handleSize * 2, handleSize * 2);
      ctx.strokeRect(h.x - handleSize, h.y - handleSize, handleSize * 2, handleSize * 2);
    }

    // 图层名标签
    const label = (locked ? '🔒 ' : '') + (layer.name || '图层');
    ctx.font = '11px sans-serif';
    const textWidth = ctx.measureText(label).width;
    const labelX = sx;
    const labelY = sy - 24;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, textWidth + 12, 20, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, labelX + 6, labelY + 14);

    ctx.restore();
  }

  /**
   * 绘制编组边框（用半透明背景框住整个编组）
   */
  drawGroupBoxes(layers) {
    const groups = new Map();
    for (const layer of layers) {
      if (layer.groupId && layer.visible) {
        if (!groups.has(layer.groupId)) groups.set(layer.groupId, []);
        groups.get(layer.groupId).push(layer);
      }
    }

    const ctx = this.ctx;
    for (const [groupId, groupLayers] of groups) {
      if (groupLayers.length < 2) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const l of groupLayers) {
        minX = Math.min(minX, l.x); minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + l.width); maxY = Math.max(maxY, l.y + l.height);
      }

      const sx = (minX - this.panX) * this.zoom;
      const sy = (minY - this.panY) * this.zoom;
      const sw = (maxX - minX) * this.zoom;
      const sh = (maxY - minY) * this.zoom;

      const isLocked = groupLayers.every(l => l.locked);

      ctx.save();
      ctx.fillStyle = isLocked ? 'rgba(239, 68, 68, 0.08)' : 'rgba(139, 92, 246, 0.08)';
      ctx.fillRect(sx - 4, sy - 4, sw + 8, sh + 8);

      ctx.strokeStyle = isLocked ? 'rgba(239, 68, 68, 0.4)' : 'rgba(139, 92, 246, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(sx - 4, sy - 4, sw + 8, sh + 8);
      ctx.setLineDash([]);

      // 编组标签
      const label = isLocked ? '🔒 编组' : '编组';
      ctx.font = '10px sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = isLocked ? 'rgba(239, 68, 68, 0.7)' : 'rgba(139, 92, 246, 0.7)';
      ctx.beginPath();
      ctx.roundRect(sx - 4, sy - 20, tw + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, sx + 1, sy - 8);

      ctx.restore();
    }
  }

  /**
   * 绘制吸附参考线（粉色）
   */
  drawSnapLines(snapLines) {
    if (!snapLines) return;
    const ctx = this.ctx;
    ctx.save();

    // 垂直线
    for (const line of snapLines.vertical || []) {
      const sx = (line.x - this.panX) * this.zoom;
      const sy1 = (line.y1 - this.panY) * this.zoom;
      const sy2 = (line.y2 - this.panY) * this.zoom;

      ctx.strokeStyle = line.dim ? 'rgba(255, 105, 180, 0.4)' : 'rgba(255, 105, 180, 0.8)';
      ctx.lineWidth = line.dim ? 0.8 : 1.2;
      ctx.setLineDash(line.dim ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(sx, sy1);
      ctx.lineTo(sx, sy2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 水平线
    for (const line of snapLines.horizontal || []) {
      const sy = (line.y - this.panY) * this.zoom;
      const sx1 = (line.x1 - this.panX) * this.zoom;
      const sx2 = (line.x2 - this.panX) * this.zoom;

      ctx.strokeStyle = line.dim ? 'rgba(255, 105, 180, 0.4)' : 'rgba(255, 105, 180, 0.8)';
      ctx.lineWidth = line.dim ? 0.8 : 1.2;
      ctx.setLineDash(line.dim ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(sx1, sy);
      ctx.lineTo(sx2, sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  set selectedLayerId(id) {
    this._selectedLayerId = id;
    this._selectedLayerIds = id ? [id] : [];
  }

  get selectedLayerId() {
    return this._selectedLayerId;
  }

  set selectedLayerIds(ids) {
    this._selectedLayerIds = ids;
    this._selectedLayerId = ids.length > 0 ? ids[ids.length - 1] : null;
  }

  get selectedLayerIds() {
    return this._selectedLayerIds || [];
  }

  /**
   * 渲染单个图层（在世界坐标中）
   */
  renderLayer(layer, ctx) {
    ctx.save();

    if (layer.opacity !== undefined && layer.opacity < 1) {
      ctx.globalAlpha = layer.opacity;
    }

    if (layer.type === 'text') {
      this.renderTextLayer(layer, ctx);
    } else {
      this.renderImageLayer(layer, ctx);
    }

    ctx.restore();
  }

  renderImageLayer(layer, ctx) {
    const { x, y, width, height, rotation = 0, flipH = false, flipV = false } = layer;
    const img = this.getImage(layer);
    if (!img) return;

    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.translate(cx, cy);
    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (flipH) { sx = img.width; sw = -img.width; }
    if (flipV) { sy = img.height; sh = -img.height; }

    ctx.drawImage(img, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
  }

  renderTextLayer(layer, ctx) {
    const { x, y, width, height, text, fontSize = 48, fontFamily = 'sans-serif',
            fontWeight = 'bold', color = '#000000', textAlign = 'center',
            rotation = 0 } = layer;

    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.translate(cx, cy);
    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    ctx.fillStyle = color;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
  }

  /**
   * 获取或缓存图片（显示用，可能是缩放过的 dataURL）
   */
  getImage(layer) {
    if (this.imageCache.has(layer.id)) {
      return this.imageCache.get(layer.id);
    }
    if (layer.src) {
      const img = new Image();
      img.src = layer.src;
      this.imageCache.set(layer.id, img);
      return img;
    }
    return null;
  }

  /**
   * 获取或缓存原始图片（完整分辨率，导出用）
   * 从 originalFile 重新加载原始图片
   */
  getOriginalImage(layer) {
    if (this.originalImageCache.has(layer.id)) {
      return this.originalImageCache.get(layer.id);
    }
    if (layer.originalFile) {
      // 同步创建 Image，src 设为空触发异步加载
      // 实际由 ExportManager 异步加载后缓存
      return null;
    }
    // 没有原始文件，回退到显示用的图片
    return this.getImage(layer);
  }

  /**
   * 缓存原始图片（由 ExportManager 异步加载后调用）
   */
  cacheOriginalImage(layerId, img) {
    this.originalImageCache.set(layerId, img);
  }

  /**
   * 检测世界坐标点命中的图层
   */
  hitTest(layers, worldX, worldY) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.locked) continue;
      const { x, y, width, height } = layer;
      if (worldX >= x && worldX <= x + width && worldY >= y && worldY <= y + height) {
        return layer;
      }
    }
    return null;
  }

  /**
   * 检测缩放控制点
   * @param {number} threshold - 世界坐标中的检测范围，默认 12/zoom
   */
  getResizeHandle(layer, worldX, worldY, threshold = null) {
    const edge = threshold || (12 / this.zoom);
    const { x, y, width, height } = layer;
    const handles = {
      tl: { x, y },
      tr: { x: x + width, y },
      bl: { x, y: y + height },
      br: { x: x + width, y: y + height }
    };
    for (const [key, pos] of Object.entries(handles)) {
      if (Math.abs(worldX - pos.x) <= edge && Math.abs(worldY - pos.y) <= edge) {
        return key;
      }
    }
    return null;
  }

  clearCache(layerId) {
    this.imageCache.delete(layerId);
    this.originalImageCache.delete(layerId);
  }

  clearAllCache() {
    this.imageCache.clear();
    this.originalImageCache.clear();
  }
}
