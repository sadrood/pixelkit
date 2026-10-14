/**
 * DragDropHandler - 画布交互处理器
 * 支持：移动/缩放图层、对齐吸附线、画布平移、滚轮缩放、文件拖入
 */
export class DragDropHandler {
  constructor(canvas, layerManager, ui, toast) {
    this.canvas = canvas;
    this.layerManager = layerManager;
    this.ui = ui;
    this.toast = toast;

    this.dragState = null;
    this.panState = null;
    this.resizeState = null;
    this.isPanMode = false;
    this.renderPending = false;

    // 吸附阈值（世界坐标像素）
    this.snapThreshold = 5;
    // 当前吸附线
    this.snapLines = { vertical: [], horizontal: [] };
  }

  init() {
    const canvasEl = this.canvas.canvas;
    const container = document.getElementById('canvas-container');

    canvasEl.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));

    canvasEl.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) this.handleDroppedFiles(e.dataTransfer.files);
    });

    canvasEl.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    canvasEl.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    canvasEl.addEventListener('touchend', this.onTouchEnd.bind(this));
  }

  // ==================== 键盘 ====================

  onKeyDown(e) {
    if (e.code === 'Space' && !this.isPanMode) {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.isPanMode = true;
        this.canvas.canvas.style.cursor = 'grab';
      }
    }
  }

  onKeyUp(e) {
    if (e.code === 'Space') {
      this.isPanMode = false;
      this.canvas.canvas.style.cursor = 'default';
    }
  }

  // ==================== 滚轮缩放 ====================

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    this.canvas.zoomAt(mouseX, mouseY, this.canvas.zoom * delta);
    this.canvas.render(this.layerManager.getLayers());
  }

  // ==================== 坐标工具 ====================

  getCanvasPos(e) {
    const rect = this.canvas.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * 获取当前视口中心的世界坐标
   */
  getViewportCenter() {
    const rect = this.canvas.canvas.getBoundingClientRect();
    return this.canvas.canvasToWorld(rect.width / 2, rect.height / 2);
  }

  // ==================== 对齐吸附 ====================

  /**
   * 计算吸附后的坐标和参考线
   * 检查与其他图层的边缘对齐、中心对齐、尺寸一致
   */
  calcSnap(draggingLayer, newX, newY, newW, newH) {
    const lines = { vertical: [], horizontal: [] };
    const threshold = this.snapThreshold;

    let snappedX = newX;
    let snappedY = newY;
    let snappedW = newW;
    let snappedH = newH;

    const dl = { left: newX, right: newX + newW, top: newY, bottom: newY + newH, cx: newX + newW / 2, cy: newY + newH / 2 };

    for (const other of this.layerManager.getLayers()) {
      if (other.id === draggingLayer.id || !other.visible) continue;

      const ol = {
        left: other.x, right: other.x + other.width,
        top: other.y, bottom: other.y + other.height,
        cx: other.x + other.width / 2, cy: other.y + other.height / 2
      };

      // --- 垂直吸附线 ---
      // 左对左
      if (Math.abs(dl.left - ol.left) < threshold) { snappedX = ol.left; lines.vertical.push({ x: ol.left, y1: Math.min(dl.top, ol.top), y2: Math.max(dl.bottom, ol.bottom) }); }
      // 左对右
      else if (Math.abs(dl.left - ol.right) < threshold) { snappedX = ol.right; lines.vertical.push({ x: ol.right, y1: Math.min(dl.top, ol.top), y2: Math.max(dl.bottom, ol.bottom) }); }
      // 右对右
      else if (Math.abs(dl.right - ol.right) < threshold) { snappedX = ol.right - newW; lines.vertical.push({ x: ol.right, y1: Math.min(dl.top, ol.top), y2: Math.max(dl.bottom, ol.bottom) }); }
      // 右对左
      else if (Math.abs(dl.right - ol.left) < threshold) { snappedX = ol.left - newW; lines.vertical.push({ x: ol.left, y1: Math.min(dl.top, ol.top), y2: Math.max(dl.bottom, ol.bottom) }); }
      // 中心对中心
      else if (Math.abs(dl.cx - ol.cx) < threshold) { snappedX = ol.cx - newW / 2; lines.vertical.push({ x: ol.cx, y1: Math.min(dl.top, ol.top), y2: Math.max(dl.bottom, ol.bottom) }); }

      // --- 水平吸附线 ---
      // 顶对顶
      if (Math.abs(dl.top - ol.top) < threshold) { snappedY = ol.top; lines.horizontal.push({ y: ol.top, x1: Math.min(dl.left, ol.left), x2: Math.max(dl.right, ol.right) }); }
      // 顶对底
      else if (Math.abs(dl.top - ol.bottom) < threshold) { snappedY = ol.bottom; lines.horizontal.push({ y: ol.bottom, x1: Math.min(dl.left, ol.left), x2: Math.max(dl.right, ol.right) }); }
      // 底对底
      else if (Math.abs(dl.bottom - ol.bottom) < threshold) { snappedY = ol.bottom - newH; lines.horizontal.push({ y: ol.bottom, x1: Math.min(dl.left, ol.left), x2: Math.max(dl.right, ol.right) }); }
      // 底对顶
      else if (Math.abs(dl.bottom - ol.top) < threshold) { snappedY = ol.top - newH; lines.horizontal.push({ y: ol.top, x1: Math.min(dl.left, ol.left), x2: Math.max(dl.right, ol.right) }); }
      // 中心对中心
      else if (Math.abs(dl.cy - ol.cy) < threshold) { snappedY = ol.cy - newH / 2; lines.horizontal.push({ y: ol.cy, x1: Math.min(dl.left, ol.left), x2: Math.max(dl.right, ol.right) }); }

      // --- 尺寸一致吸附（宽高相等时提示） ---
      if (Math.abs(newW - other.width) < threshold && Math.abs(newH - other.height) < threshold) {
        snappedW = other.width;
        snappedH = other.height;
        // 在四边生成弱提示线
        lines.vertical.push({ x: other.x, y1: other.y, y2: other.y + other.height, dim: true });
        lines.vertical.push({ x: other.x + other.width, y1: other.y, y2: other.y + other.height, dim: true });
        lines.horizontal.push({ y: other.y, x1: other.x, x2: other.x + other.width, dim: true });
        lines.horizontal.push({ y: other.y + other.height, x1: other.x, x2: other.x + other.width, dim: true });
      }
    }

    return { x: snappedX, y: snappedY, w: snappedW, h: snappedH, lines };
  }

  // ==================== 鼠标事件 ====================

  onMouseDown(e) {
    const pos = this.getCanvasPos(e);
    const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);

    if (e.button === 1) {
      e.preventDefault();
      this.panState = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: this.canvas.panX, startPanY: this.canvas.panY };
      this.canvas.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 2 || (e.button === 0 && this.isPanMode)) {
      e.preventDefault();
      this.panState = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: this.canvas.panX, startPanY: this.canvas.panY };
      this.canvas.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      // 优先检测缩放控制点（扩大检测范围到 12 像素）
      const selected = this.layerManager.getSelectedLayer();
      if (selected && selected.visible && !selected.locked) {
        const handle = this.canvas.getResizeHandle(selected, worldPos.x, worldPos.y, 12 / this.canvas.zoom);
        if (handle) {
          this.resizeState = {
            layerId: selected.id, handle,
            startWorldX: worldPos.x, startWorldY: worldPos.y,
            startX: selected.x, startY: selected.y,
            startWidth: selected.width, startHeight: selected.height,
            aspectRatio: selected.width / selected.height
          };
          e.preventDefault();
          return;
        }
      }

      // 检测图层命中
      const layer = this.canvas.hitTest(this.layerManager.getLayers(), worldPos.x, worldPos.y);

      if (layer) {
        // Ctrl+点击多选
        if (e.ctrlKey || e.metaKey) {
          this.layerManager.toggleLayerSelection(layer.id);
          this.canvas.selectedLayerIds = [...this.layerManager.selectedLayerIds];
        } else if (!this.layerManager.isLayerSelected(layer.id)) {
          this.layerManager.selectLayer(layer.id);
          this.canvas.selectedLayerIds = [layer.id];
          this.canvas.selectedLayerId = layer.id;
        }
        this.ui.refreshLayerList();

        // 如果图层被锁定/编组，不允许拖拽
        if (layer.locked) {
          e.preventDefault();
          return;
        }

        // 拖拽移动所有选中图层
        const selectedIds = this.layerManager.selectedLayerIds;
        const selectedLayers = selectedIds.map(id => this.layerManager.getLayer(id)).filter(Boolean);

        this.dragState = {
          layerId: layer.id,
          selectedIds: [...selectedIds],
          startWorldX: worldPos.x,
          startWorldY: worldPos.y,
          startLayers: selectedLayers.map(l => ({ id: l.id, x: l.x, y: l.y, width: l.width, height: l.height }))
        };
        e.preventDefault();
      } else {
        // 点击空白取消选中
        this.layerManager.clearSelection();
        this.canvas.selectedLayerIds = [];
        this.canvas.selectedLayerId = null;
        this.ui.refreshLayerList();

        this.panState = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: this.canvas.panX, startPanY: this.canvas.panY };
      }
    }
  }

  onMouseMove(e) {
    if (this.panState) {
      const dx = e.clientX - this.panState.startMouseX;
      const dy = e.clientY - this.panState.startMouseY;
      this.canvas.panX = this.panState.startPanX - dx / this.canvas.zoom;
      this.canvas.panY = this.panState.startPanY - dy / this.canvas.zoom;
      this.scheduleRender();
      return;
    }

    if (this.dragState) {
      const pos = this.getCanvasPos(e);
      const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);
      const dx = worldPos.x - this.dragState.startWorldX;
      const dy = worldPos.y - this.dragState.startWorldY;

      // 使用主拖动图层计算吸附
      const mainLayer = this.layerManager.getLayer(this.dragState.layerId);
      if (mainLayer) {
        const startMain = this.dragState.startLayers.find(l => l.id === mainLayer.id);
        if (startMain) {
          const rawX = startMain.x + dx;
          const rawY = startMain.y + dy;

          // 对齐吸附
          const snap = this.calcSnap(mainLayer, rawX, rawY, mainLayer.width, mainLayer.height);
          const snapDx = snap.x - rawX;
          const snapDy = snap.y - rawY;

          // 更新所有选中图层
          for (const sl of this.dragState.startLayers) {
            this.layerManager.updateLayer(sl.id, {
              x: sl.x + dx + snapDx,
              y: sl.y + dy + snapDy
            }, false);
          }

          this.snapLines = snap.lines;
        }
      }

      this.scheduleRender();
    }

    if (this.resizeState) {
      const pos = this.getCanvasPos(e);
      const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);
      const dx = worldPos.x - this.resizeState.startWorldX;
      const dy = worldPos.y - this.resizeState.startWorldY;
      const { handle, startX, startY, startWidth, startHeight, aspectRatio } = this.resizeState;

      let newX = startX, newY = startY, newW = startWidth, newH = startHeight;
      const keepRatio = e.shiftKey;

      switch (handle) {
        case 'br':
          newW = Math.max(10, startWidth + dx);
          newH = keepRatio ? newW / aspectRatio : Math.max(10, startHeight + dy);
          break;
        case 'bl':
          newW = Math.max(10, startWidth - dx);
          newX = startX + startWidth - newW;
          newH = keepRatio ? newW / aspectRatio : Math.max(10, startHeight + dy);
          break;
        case 'tr':
          newW = Math.max(10, startWidth + dx);
          if (keepRatio) { newH = newW / aspectRatio; newY = startY + startHeight - newH; }
          else { newH = Math.max(10, startHeight - dy); newY = startY + startHeight - newH; }
          break;
        case 'tl':
          newW = Math.max(10, startWidth - dx);
          newX = startX + startWidth - newW;
          if (keepRatio) { newH = newW / aspectRatio; newY = startY + startHeight - newH; }
          else { newH = Math.max(10, startHeight - dy); newY = startY + startHeight - newH; }
          break;
      }

      // 尺寸吸附
      const layer = this.layerManager.getLayer(this.resizeState.layerId);
      if (layer) {
        const snap = this.calcSnap(layer, newX, newY, newW, newH);
        this.layerManager.updateLayer(this.resizeState.layerId, {
          x: snap.x, y: snap.y, width: snap.w, height: snap.h
        }, false);
        this.snapLines = snap.lines;
      }

      this.scheduleRender();
    }

    if (!this.dragState && !this.panState && !this.resizeState) {
      this.updateCursor(e);
    }
  }

  onMouseUp(e) {
    if (this.panState) {
      this.panState = null;
      this.canvas.canvas.style.cursor = this.isPanMode ? 'grab' : 'default';
      return;
    }

    if (this.dragState) {
      // 保存最终位置
      for (const sl of this.dragState.startLayers) {
        const layer = this.layerManager.getLayer(sl.id);
        if (layer) {
          this.layerManager.updateLayer(sl.id, { x: layer.x, y: layer.y }, true);
        }
      }
      this.canvas.autoExpand(this.layerManager.getLayers());
      this.snapLines = { vertical: [], horizontal: [] };
      this.scheduleRender();
      this.dragState = null;
      this.ui.updateUndoRedoButtons();
    }

    if (this.resizeState) {
      const layer = this.layerManager.getLayer(this.resizeState.layerId);
      if (layer) {
        this.layerManager.updateLayer(this.resizeState.layerId, {
          x: layer.x, y: layer.y, width: layer.width, height: layer.height
        }, true);
        this.canvas.autoExpand(this.layerManager.getLayers());
      }
      this.snapLines = { vertical: [], horizontal: [] };
      this.scheduleRender();
      this.resizeState = null;
      this.ui.updateUndoRedoButtons();
    }
  }

  scheduleRender() {
    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.canvas.render(this.layerManager.getLayers(), this.snapLines);
        if (this.dragState || this.resizeState) {
          this.ui.refreshLayerList();
        }
        this.renderPending = false;
      });
    }
  }

  updateCursor(e) {
    const pos = this.getCanvasPos(e);
    const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);

    if (this.isPanMode) {
      this.canvas.canvas.style.cursor = 'grab';
      return;
    }

    const selected = this.layerManager.getSelectedLayer();
    if (selected) {
      const handle = this.canvas.getResizeHandle(selected, worldPos.x, worldPos.y, 12 / this.canvas.zoom);
      if (handle) {
        const cursors = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' };
        this.canvas.canvas.style.cursor = cursors[handle];
        return;
      }
    }

    const hit = this.canvas.hitTest(this.layerManager.getLayers(), worldPos.x, worldPos.y);
    this.canvas.canvas.style.cursor = hit ? 'move' : 'default';
  }

  // ==================== 文件拖入 ====================

  handleDroppedFiles(files) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    const promises = [];
    for (const file of files) {
      if (!validTypes.includes(file.type)) {
        this.toast.show(`跳过不支持的文件: ${file.name}`, 'error');
        continue;
      }
      promises.push(this.loadImage(file));
    }

    Promise.all(promises).then(images => {
      const validImages = images.filter(Boolean);
      for (const imgData of validImages) {
        this.layerManager.addLayer(imgData);
      }
      if (validImages.length > 0) {
        this.canvas.autoExpand(this.layerManager.getLayers());
        this.canvas.render(this.layerManager.getLayers());
        this.ui.refreshLayerList();
        this.toast.show(`已添加 ${validImages.length} 张图片`, 'success');
      }
    });
  }

  loadImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const maxDim = 2000;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          // 定位到当前视口中心
          const vc = this.getViewportCenter();
          resolve({
            name: file.name,
            src: e.target.result,
            originalWidth: img.width,
            originalHeight: img.height,
            width,
            height,
            x: vc.x - width / 2,
            y: vc.y - height / 2,
            type: file.type,
            file: file
          });
        };
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ==================== 触摸事件 ====================

  onTouchStart(e) {
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      this.pinchState = {
        startDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        startZoom: this.canvas.zoom,
        centerX: (t1.clientX + t2.clientX) / 2,
        centerY: (t1.clientY + t2.clientY) / 2
      };
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      const pos = this.getCanvasPos(touch);
      const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);
      const layer = this.canvas.hitTest(this.layerManager.getLayers(), worldPos.x, worldPos.y);

      if (layer && !layer.locked) {
        this.layerManager.selectLayer(layer.id);
        this.canvas.selectedLayerIds = [layer.id];
        this.canvas.selectedLayerId = layer.id;
        this.ui.refreshLayerList();
        this.dragState = {
          layerId: layer.id, selectedIds: [layer.id],
          startWorldX: worldPos.x, startWorldY: worldPos.y,
          startLayers: [{ id: layer.id, x: layer.x, y: layer.y, width: layer.width, height: layer.height }]
        };
        e.preventDefault();
      } else {
        this.panState = { startMouseX: touch.clientX, startMouseY: touch.clientY, startPanX: this.canvas.panX, startPanY: this.canvas.panY };
      }
    }
  }

  onTouchMove(e) {
    if (this.pinchState && e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const ratio = dist / this.pinchState.startDist;
      const newZoom = this.pinchState.startZoom * ratio;
      const rect = this.canvas.canvas.getBoundingClientRect();
      const cx = this.pinchState.centerX - rect.left;
      const cy = this.pinchState.centerY - rect.top;
      this.canvas.zoomAt(cx, cy, newZoom);
      this.scheduleRender();
      e.preventDefault();
    } else if (this.panState && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - this.panState.startMouseX;
      const dy = touch.clientY - this.panState.startMouseY;
      this.canvas.panX = this.panState.startPanX - dx / this.canvas.zoom;
      this.canvas.panY = this.panState.startPanY - dy / this.canvas.zoom;
      this.scheduleRender();
    } else if (this.dragState && e.touches.length === 1) {
      const touch = e.touches[0];
      const pos = this.getCanvasPos(touch);
      const worldPos = this.canvas.canvasToWorld(pos.x, pos.y);
      const dx = worldPos.x - this.dragState.startWorldX;
      const dy = worldPos.y - this.dragState.startWorldY;

      for (const sl of this.dragState.startLayers) {
        this.layerManager.updateLayer(sl.id, {
          x: sl.x + dx, y: sl.y + dy
        }, false);
      }
      this.scheduleRender();
      e.preventDefault();
    }
  }

  onTouchEnd() {
    if (this.dragState) {
      for (const sl of this.dragState.startLayers) {
        const layer = this.layerManager.getLayer(sl.id);
        if (layer) this.layerManager.updateLayer(sl.id, { x: layer.x, y: layer.y }, true);
      }
      this.canvas.autoExpand(this.layerManager.getLayers());
      this.snapLines = { vertical: [], horizontal: [] };
      this.scheduleRender();
      this.dragState = null;
    }
    this.panState = null;
    this.pinchState = null;
  }
}
