/**
 * UIManager - UI 管理器
 * 管理图层面板、属性面板、按钮状态等
 */
export class UIManager {
  constructor(canvas, layerManager, exportManager, history, toast) {
    this.canvas = canvas;
    this.layerManager = layerManager;
    this.exportManager = exportManager;
    this.history = history;
    this.toast = toast;

    // 引用 ExportManager 的 toast
    this.exportManager.showToast = (msg, type) => toast.show(msg, type);

    this.layerListEl = document.getElementById('layer-list');
    this.layerCountEl = document.getElementById('layer-count');
    this.propsContent = document.getElementById('props-content');
    this.canvasSizeEl = document.getElementById('canvas-size');
  }

  init() {
    this.refreshLayerList();
    this.updateUndoRedoButtons();
    this.updateCanvasSizeDisplay();
  }

  /**
   * 刷新图层面板
   */
  refreshLayerList() {
    const layers = this.layerManager.getLayers();
    const selectedId = this.layerManager.selectedLayerId;
    const count = layers.length;

    this.layerCountEl.textContent = count;

    if (count === 0) {
      this.layerListEl.innerHTML = '<div class="layer-empty">暂无图层，请上传图片</div>';
      this.propsContent.innerHTML = '<div class="props-empty">选择一个图层以编辑属性</div>';
      this.updateCanvasPlaceholder(true);
      return;
    }

    this.updateCanvasPlaceholder(false);

    // 渲染图层列表（倒序：上面的图层在上方显示）
    this.layerListEl.innerHTML = layers
      .slice()
      .reverse()
      .map((layer, reverseIndex) => {
        const index = layers.length - 1 - reverseIndex;
        const isSelected = layer.id === selectedId;
        const thumbSrc = layer.type === 'image' ? layer.src : null;
        const thumbHtml = thumbSrc
          ? `<img class="layer-thumb" src="${thumbSrc}" alt="" />`
          : `<div class="layer-thumb" style="background:var(--primary);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;">T</div>`;

        return `
          <div class="layer-item${isSelected ? ' selected' : ''}"
               data-layer-id="${layer.id}"
               data-index="${index}"
               draggable="true">
            ${thumbHtml}
            <div class="layer-info">
              <div class="layer-name" title="${this.escapeHtml(layer.name)}">${this.escapeHtml(layer.name)}</div>
              <div class="layer-pos">(${Math.round(layer.x)}, ${Math.round(layer.y)}) ${Math.round(layer.width)}×${Math.round(layer.height)}</div>
            </div>
            <div class="layer-actions">
              <button class="layer-btn btn-move" data-action="up" title="上移一层">↑</button>
              <button class="layer-btn btn-move" data-action="down" title="下移一层">↓</button>
              <button class="layer-btn btn-move" data-action="top" title="置顶">⤒</button>
              <button class="layer-btn btn-move" data-action="bottom" title="置底">⤓</button>
              <button class="layer-btn btn-delete" data-action="delete" title="删除">✕</button>
            </div>
          </div>
        `;
      })
      .join('');

    // 绑定图层项事件
    this.bindLayerItemEvents();
    // 刷新属性面板
    this.refreshPropsPanel();
    // 更新撤销/重做按钮
    this.updateUndoRedoButtons();
  }

  /**
   * 绑定图层列表事件
   */
  bindLayerItemEvents() {
    // 点击选中
    this.layerListEl.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 如果点击的是按钮，不处理
        if (e.target.closest('.layer-btn')) return;

        const layerId = item.dataset.layerId;
        if (e.ctrlKey || e.metaKey) {
          this.layerManager.toggleLayerSelection(layerId);
          this.canvas.selectedLayerIds = [...this.layerManager.selectedLayerIds];
        } else {
          this.layerManager.selectLayer(layerId);
          this.canvas.selectedLayerId = layerId;
          this.canvas.selectedLayerIds = [layerId];
        }
        this.canvas.render(this.layerManager.getLayers());
        this.refreshLayerList();
      });

      // 按钮点击
      item.querySelectorAll('.layer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const layerId = item.dataset.layerId;
          const action = btn.dataset.action;

          switch (action) {
            case 'delete':
              this.layerManager.removeLayer(layerId);
              this.canvas.render(this.layerManager.getLayers());
              this.refreshLayerList();
              this.toast.show('图层已删除', 'success');
              break;
            case 'up':
            case 'down':
            case 'top':
            case 'bottom':
              this.layerManager.moveLayer(layerId, action);
              this.canvas.render(this.layerManager.getLayers());
              this.refreshLayerList();
              break;
          }
        });
      });

      // 拖拽排序
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.dataset.layerId);
        e.dataTransfer.effectAllowed = 'move';
        item.style.opacity = '0.5';
      });

      item.addEventListener('dragend', (e) => {
        item.style.opacity = '1';
        // 清除所有 drag-over 样式
        this.layerListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
          el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        item.classList.remove('drag-over-top', 'drag-over-bottom');
        if (e.clientY < midY) {
          item.classList.add('drag-over-top');
        } else {
          item.classList.add('drag-over-bottom');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId === item.dataset.layerId) return;

        const layers = this.layerManager.getLayers();
        const targetIndex = layers.length - 1 - parseInt(item.dataset.index);
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const offset = e.clientY < midY ? 0 : 1;

        const finalTargetIndex = targetIndex + offset;
        this.layerManager.reorderLayer(draggedId, finalTargetIndex);
        this.canvas.render(this.layerManager.getLayers());
        this.refreshLayerList();
      });
    });
  }

  /**
   * 刷新属性面板
   */
  refreshPropsPanel() {
    const layer = this.layerManager.getSelectedLayer();

    if (!layer) {
      this.propsContent.innerHTML = '<div class="props-empty">选择一个图层以编辑属性</div>';
      return;
    }

    const isText = layer.type === 'text';
    const textProps = isText ? `
      <div class="prop-group">
        <label>文字内容</label>
        <input type="text" data-prop="text" value="${this.escapeHtml(layer.text || '')}" />
      </div>
      <div class="prop-group">
        <label>字体大小</label>
        <input type="number" data-prop="fontSize" value="${layer.fontSize || 48}" min="8" max="500" />
      </div>
      <div class="prop-group">
        <label>字体颜色</label>
        <input type="color" data-prop="color" value="${layer.color || '#000000'}" />
      </div>
      <div class="prop-group">
        <label>字体粗细</label>
        <select data-prop="fontWeight">
          <option value="normal" ${layer.fontWeight === 'normal' ? 'selected' : ''}>正常</option>
          <option value="bold" ${layer.fontWeight === 'bold' ? 'selected' : ''}>粗体</option>
        </select>
      </div>
      <div class="prop-group">
        <label>对齐方式</label>
        <select data-prop="textAlign">
          <option value="left" ${layer.textAlign === 'left' ? 'selected' : ''}>左对齐</option>
          <option value="center" ${layer.textAlign === 'center' ? 'selected' : ''}>居中</option>
          <option value="right" ${layer.textAlign === 'right' ? 'selected' : ''}>右对齐</option>
        </select>
      </div>
    ` : '';

    this.propsContent.innerHTML = `
      <div class="prop-group">
        <label>图层名称</label>
        <input type="text" data-prop="name" value="${this.escapeHtml(layer.name)}" />
      </div>
      <div class="prop-group">
        <label>位置与大小</label>
        <div class="prop-row">
          <div>
            <label style="font-size:9px;font-weight:normal;">X</label>
            <input type="number" data-prop="x" value="${Math.round(layer.x)}" />
          </div>
          <div>
            <label style="font-size:9px;font-weight:normal;">Y</label>
            <input type="number" data-prop="y" value="${Math.round(layer.y)}" />
          </div>
        </div>
        <div class="prop-row" style="margin-top:6px;">
          <div>
            <label style="font-size:9px;font-weight:normal;">宽度</label>
            <input type="number" data-prop="width" value="${Math.round(layer.width)}" min="10" max="4000" />
          </div>
          <div>
            <label style="font-size:9px;font-weight:normal;">高度</label>
            <input type="number" data-prop="height" value="${Math.round(layer.height)}" min="10" max="4000" />
          </div>
        </div>
        <button id="btn-reset-size" class="btn btn-sm" style="margin-top:6px;width:100%;" ${isText ? 'disabled' : ''}>
          ${isText ? '文字图层不支持' : '恢复原始尺寸'}
        </button>
      </div>
      <div class="prop-group">
        <label>旋转角度</label>
        <input type="range" data-prop="rotation" value="${layer.rotation || 0}" min="-180" max="180" step="1" />
        <span style="font-size:11px;color:var(--text-muted);">${layer.rotation || 0}°</span>
      </div>
      <div class="prop-group">
        <label>透明度</label>
        <input type="range" data-prop="opacity" value="${(layer.opacity || 1) * 100}" min="10" max="100" step="1" />
        <span style="font-size:11px;color:var(--text-muted);">${Math.round((layer.opacity || 1) * 100)}%</span>
      </div>
      <div class="prop-group">
        <label>翻转</label>
        <div style="display:flex;gap:8px;">
          <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" data-prop="flipH" ${layer.flipH ? 'checked' : ''} /> 水平翻转
          </label>
          <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" data-prop="flipV" ${layer.flipV ? 'checked' : ''} /> 垂直翻转
          </label>
        </div>
      </div>
      <div class="prop-group">
        <label>可见性</label>
        <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" data-prop="visible" ${layer.visible !== false ? 'checked' : ''} /> 显示图层
        </label>
      </div>
      ${textProps}
    `;

    // 绑定属性变更事件
    this.bindPropsEvents(layer);
  }

  /**
   * 绑定属性面板事件
   */
  bindPropsEvents(layer) {
    // 数字输入
    this.propsContent.querySelectorAll('input[type="number"]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        if (!isNaN(value)) {
          this.layerManager.updateLayer(layer.id, { [prop]: value });
          this.canvas.render(this.layerManager.getLayers());
          this.refreshLayerList();
        }
      });
    });

    // 文本输入
    this.propsContent.querySelectorAll('input[type="text"]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('input', () => {
        const value = input.value;
        this.layerManager.updateLayer(layer.id, { [prop]: value });
        this.canvas.render(this.layerManager.getLayers());
        if (prop === 'name') {
          this.refreshLayerList();
        }
      });
    });

    // 颜色输入
    this.propsContent.querySelectorAll('input[type="color"]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('input', () => {
        this.layerManager.updateLayer(layer.id, { [prop]: input.value });
        this.canvas.render(this.layerManager.getLayers());
      });
    });

    // 范围滑块
    this.propsContent.querySelectorAll('input[type="range"]').forEach(input => {
      const prop = input.dataset.prop;
      const update = () => {
        let value = parseFloat(input.value);
        if (prop === 'opacity') {
          value = value / 100;
        }
        this.layerManager.updateLayer(layer.id, { [prop]: value });
        this.canvas.render(this.layerManager.getLayers());
        // 更新显示值
        const span = input.nextElementSibling;
        if (span) {
          span.textContent = prop === 'opacity'
            ? `${Math.round(value * 100)}%`
            : `${Math.round(value)}°`;
        }
      };
      input.addEventListener('input', update);
    });

    // 复选框
    this.propsContent.querySelectorAll('input[type="checkbox"]').forEach(input => {
      const prop = input.dataset.prop;
      input.addEventListener('change', () => {
        this.layerManager.updateLayer(layer.id, { [prop]: input.checked });
        this.canvas.render(this.layerManager.getLayers());
        this.refreshLayerList();
      });
    });

    // 下拉框
    this.propsContent.querySelectorAll('select').forEach(select => {
      const prop = select.dataset.prop;
      select.addEventListener('change', () => {
        this.layerManager.updateLayer(layer.id, { [prop]: select.value });
        this.canvas.render(this.layerManager.getLayers());
      });
    });

    // 恢复原始尺寸
    const resetBtn = document.getElementById('btn-reset-size');
    if (resetBtn && layer.type === 'image') {
      resetBtn.addEventListener('click', () => {
        const origW = layer.originalWidth;
        const origH = layer.originalHeight;
        if (origW && origH) {
          // 等比缩放到适合画布
          let w = origW, h = origH;
          const maxW = this.canvas.width * 0.9;
          const maxH = this.canvas.height * 0.9;
          if (w > maxW || h > maxH) {
            const ratio = Math.min(maxW / w, maxH / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          this.layerManager.updateLayer(layer.id, {
            width: w,
            height: h,
            x: Math.max(0, (this.canvas.width - w) / 2),
            y: Math.max(0, (this.canvas.height - h) / 2)
          });
          this.canvas.render(this.layerManager.getLayers());
          this.refreshLayerList();
          this.toast.show('已恢复原始尺寸', 'success');
        }
      });
    }
  }

  /**
   * 更新撤销/重做按钮状态
   */
  updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = !this.history.canUndo();
    document.getElementById('btn-redo').disabled = !this.history.canRedo();
  }

  /**
   * 更新画布尺寸显示
   */
  updateCanvasSizeDisplay() {
    this.canvasSizeEl.textContent = `画布: ${this.canvas.width} × ${this.canvas.height} | 缩放: ${Math.round(this.canvas.zoom * 100)}%`;
  }

  /**
   * 更新缩放显示
   */
  updateZoomDisplay() {
    const el = document.getElementById('zoom-display');
    if (el) {
      el.textContent = Math.round(this.canvas.zoom * 100) + '%';
    }
  }

  /**
   * 更新画布占位符
   */
  updateCanvasPlaceholder(show) {
    const placeholder = document.getElementById('canvas-placeholder');
    if (show) {
      placeholder.classList.remove('hidden');
    } else {
      placeholder.classList.add('hidden');
    }
  }

  /**
   * HTML 转义
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
