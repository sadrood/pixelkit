/**
 * KeyboardHandler - 键盘快捷键处理
 */
export class KeyboardHandler {
  constructor(canvas, layerManager, ui, history) {
    this.canvas = canvas;
    this.layerManager = layerManager;
    this.ui = ui;
    this.history = history;
  }

  init() {
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  onKeyDown(e) {
    // 如果焦点在输入框中，不处理快捷键（但允许 Ctrl+Z 等）
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

    // 空格键切换平移模式由 DragDropHandler 处理，不在这里拦截

    const layer = this.layerManager.getSelectedLayer();

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (layer && !isInput) {
          e.preventDefault();
          this.layerManager.removeLayer(layer.id);
          this.canvas.selectedLayerId = null;
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'ArrowUp':
        if (layer && !isInput) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          this.layerManager.updateLayer(layer.id, { y: layer.y - step });
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'ArrowDown':
        if (layer && !isInput) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          this.layerManager.updateLayer(layer.id, { y: layer.y + step });
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'ArrowLeft':
        if (layer && !isInput) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          this.layerManager.updateLayer(layer.id, { x: layer.x - step });
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'ArrowRight':
        if (layer && !isInput) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          this.layerManager.updateLayer(layer.id, { x: layer.x + step });
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) {
            this.history.redo(this.layerManager, this.canvas, this.ui);
          } else {
            this.history.undo(this.layerManager, this.canvas, this.ui);
          }
          this.ui.updateUndoRedoButtons();
        }
        break;

      case ']':
        if (layer && !isInput) {
          e.preventDefault();
          this.layerManager.moveLayer(layer.id, 'up');
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case '[':
        if (layer && !isInput) {
          e.preventDefault();
          this.layerManager.moveLayer(layer.id, 'down');
          this.canvas.render(this.layerManager.getLayers());
          this.ui.refreshLayerList();
        }
        break;

      case 'g':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) {
            // Ctrl+Shift+G: 取消编组
            const selected = this.layerManager.getSelectedLayer();
            if (selected && selected.groupId) {
              this.layerManager.ungroupLayers(selected.groupId);
              this.canvas.render(this.layerManager.getLayers());
              this.ui.refreshLayerList();
            }
          } else {
            // Ctrl+G: 编组
            this.layerManager.groupSelectedLayers();
            this.canvas.render(this.layerManager.getLayers());
            this.ui.refreshLayerList();
          }
        }
        break;

      case '0':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.canvas.resetView();
          this.canvas.render(this.layerManager.getLayers());
        }
        break;

      case '=':
      case '+':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const rect = this.canvas.canvas.getBoundingClientRect();
          this.canvas.zoomAt(rect.width / 2, rect.height / 2, this.canvas.zoom * 1.1);
          this.canvas.render(this.layerManager.getLayers());
          this.ui.updateZoomDisplay();
        }
        break;

      case '-':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const rect = this.canvas.canvas.getBoundingClientRect();
          this.canvas.zoomAt(rect.width / 2, rect.height / 2, this.canvas.zoom * 0.9);
          this.canvas.render(this.layerManager.getLayers());
          this.ui.updateZoomDisplay();
        }
        break;
    }
  }
}
