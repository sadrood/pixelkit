/**
 * HistoryManager - 撤销/重做管理器
 */
export class HistoryManager {
  constructor(maxSize = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
  }

  /**
   * 保存当前状态
   */
  saveState(layerManager) {
    const state = layerManager.getState();
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    // 新操作清空重做栈
    this.redoStack = [];
  }

  /**
   * 撤销
   */
  undo(layerManager, canvas, ui) {
    if (this.undoStack.length === 0) return false;

    // 保存当前状态到重做栈
    const currentState = layerManager.getState();
    this.redoStack.push(currentState);

    // 恢复上一个状态
    const prevState = this.undoStack.pop();
    layerManager.restoreState(prevState);
    canvas.render(layerManager.getLayers());
    if (ui) ui.refreshLayerList();

    return true;
  }

  /**
   * 重做
   */
  redo(layerManager, canvas, ui) {
    if (this.redoStack.length === 0) return false;

    // 保存当前状态到撤销栈
    const currentState = layerManager.getState();
    this.undoStack.push(currentState);

    // 恢复重做状态
    const nextState = this.redoStack.pop();
    layerManager.restoreState(nextState);
    canvas.render(layerManager.getLayers());
    if (ui) ui.refreshLayerList();

    return true;
  }

  /**
   * 是否可以撤销
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * 是否可以重做
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * 清空历史
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
