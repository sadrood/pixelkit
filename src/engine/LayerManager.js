/**
 * LayerManager - 图层管理器
 * 支持：增删改查、多选、编组/取消编组、排序、选中状态
 */
export class LayerManager {
  constructor(canvas, history) {
    this.canvas = canvas;
    this.history = history;
    this.layers = [];
    this.selectedLayerId = null;
    this.selectedLayerIds = [];
    this.idCounter = 0;
    this.groupCounter = 0;
  }

  generateId() {
    return `layer_${++this.idCounter}_${Date.now()}`;
  }

  generateGroupId() {
    return `group_${++this.groupCounter}_${Date.now()}`;
  }

  /**
   * 添加图片图层
   */
  addLayer(imgData) {
    const layer = {
      id: this.generateId(),
      type: 'image',
      name: imgData.name || '图片',
      src: imgData.src,
      originalWidth: imgData.originalWidth,
      originalHeight: imgData.originalHeight,
      x: imgData.x,
      y: imgData.y,
      width: imgData.width,
      height: imgData.height,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
      locked: false,
      groupId: null,
      originalFile: imgData.file || null
    };

    this.history.saveState(this);
    this.layers.push(layer);
    this.selectedLayerId = layer.id;
    this.selectedLayerIds = [layer.id];
    return layer;
  }

  /**
   * 添加文字图层
   */
  addTextLayer(text) {
    const layer = {
      id: this.generateId(),
      type: 'text',
      name: '文字: ' + text.substring(0, 10),
      text: text,
      x: 100, y: 100,
      width: 300, height: 80,
      fontSize: 48,
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      color: '#000000',
      textAlign: 'center',
      rotation: 0,
      opacity: 1,
      flipH: false, flipV: false,
      visible: true,
      locked: false,
      groupId: null,
      originalFile: null
    };

    this.history.saveState(this);
    this.layers.push(layer);
    this.selectedLayerId = layer.id;
    this.selectedLayerIds = [layer.id];
    return layer;
  }

  // ==================== 选择 ====================

  selectLayer(layerId) {
    this.selectedLayerId = layerId;
    this.selectedLayerIds = layerId ? [layerId] : [];
  }

  toggleLayerSelection(layerId) {
    const idx = this.selectedLayerIds.indexOf(layerId);
    if (idx >= 0) {
      this.selectedLayerIds.splice(idx, 1);
    } else {
      this.selectedLayerIds.push(layerId);
    }
    this.selectedLayerId = this.selectedLayerIds.length > 0 ? this.selectedLayerIds[this.selectedLayerIds.length - 1] : null;
  }

  isLayerSelected(layerId) {
    return this.selectedLayerIds.includes(layerId);
  }

  clearSelection() {
    this.selectedLayerId = null;
    this.selectedLayerIds = [];
  }

  getSelectedLayer() {
    return this.selectedLayerId ? this.getLayer(this.selectedLayerId) : null;
  }

  getSelectedLayers() {
    return this.selectedLayerIds.map(id => this.getLayer(id)).filter(Boolean);
  }

  // ==================== 编组 ====================

  /**
   * 将选中的多个图层编组
   */
  groupSelectedLayers() {
    const selected = this.getSelectedLayers();
    if (selected.length < 2) return null;

    this.history.saveState(this);
    const groupId = this.generateGroupId();

    for (const layer of selected) {
      layer.groupId = groupId;
    }

    return groupId;
  }

  /**
   * 取消编组
   */
  ungroupLayers(groupId) {
    const groupLayers = this.layers.filter(l => l.groupId === groupId);
    if (groupLayers.length === 0) return false;

    this.history.saveState(this);
    for (const layer of groupLayers) {
      layer.groupId = null;
    }
    return true;
  }

  /**
   * 锁定/解锁编组（锁定后不可移动，但可以选中）
   */
  toggleGroupLock(groupId) {
    const groupLayers = this.layers.filter(l => l.groupId === groupId);
    if (groupLayers.length === 0) return false;

    this.history.saveState(this);
    const allLocked = groupLayers.every(l => l.locked);
    for (const layer of groupLayers) {
      layer.locked = !allLocked;
    }
    return true;
  }

  /**
   * 获取所有编组
   */
  getGroups() {
    const groups = new Map();
    for (const layer of this.layers) {
      if (layer.groupId) {
        if (!groups.has(layer.groupId)) {
          groups.set(layer.groupId, []);
        }
        groups.get(layer.groupId).push(layer);
      }
    }
    return groups;
  }

  /**
   * 获取图层的编组信息
   */
  getLayerGroup(layerId) {
    const layer = this.getLayer(layerId);
    if (!layer || !layer.groupId) return null;
    return {
      id: layer.groupId,
      layers: this.layers.filter(l => l.groupId === layer.groupId),
      locked: this.layers.filter(l => l.groupId === layer.groupId).every(l => l.locked)
    };
  }

  // ==================== 基础操作 ====================

  removeLayer(layerId) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return false;

    this.history.saveState(this);
    this.canvas.clearCache(layerId);
    this.layers.splice(index, 1);

    // 从选中列表移除
    this.selectedLayerIds = this.selectedLayerIds.filter(id => id !== layerId);
    this.selectedLayerId = this.selectedLayerIds.length > 0 ? this.selectedLayerIds[this.selectedLayerIds.length - 1] : null;
    return true;
  }

  getLayer(layerId) {
    return this.layers.find(l => l.id === layerId) || null;
  }

  getLayers() {
    return [...this.layers];
  }

  updateLayer(layerId, props, saveHistory = true) {
    const layer = this.getLayer(layerId);
    if (!layer) return false;

    if (saveHistory) {
      this.history.saveState(this);
    }

    Object.assign(layer, props);
    return true;
  }

  moveLayer(layerId, direction) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return false;

    this.history.saveState(this);
    const [layer] = this.layers.splice(index, 1);

    switch (direction) {
      case 'up': this.layers.splice(Math.min(index + 1, this.layers.length), 0, layer); break;
      case 'down': this.layers.splice(Math.max(index - 1, 0), 0, layer); break;
      case 'top': this.layers.push(layer); break;
      case 'bottom': this.layers.unshift(layer); break;
      default: this.layers.splice(index, 0, layer);
    }
    return true;
  }

  reorderLayer(layerId, targetIndex) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1 || index === targetIndex) return false;

    this.history.saveState(this);
    const [layer] = this.layers.splice(index, 1);
    this.layers.splice(targetIndex, 0, layer);
    return true;
  }

  clearAll() {
    this.history.saveState(this);
    this.layers = [];
    this.selectedLayerId = null;
    this.selectedLayerIds = [];
    this.canvas.clearAllCache();
  }

  getLayerIndex(layerId) {
    return this.layers.findIndex(l => l.id === layerId);
  }

  // ==================== 状态序列化 ====================

  getState() {
    return {
      layers: this.layers.map(l => {
        const { originalFile, ...rest } = l;
        return rest;
      }),
      selectedLayerId: this.selectedLayerId,
      selectedLayerIds: [...this.selectedLayerIds],
      idCounter: this.idCounter,
      groupCounter: this.groupCounter
    };
  }

  restoreState(state) {
    const oldLayers = this.layers;
    this.layers = state.layers.map(newLayer => {
      const oldLayer = oldLayers.find(l => l.id === newLayer.id);
      return {
        ...newLayer,
        originalFile: oldLayer ? oldLayer.originalFile : null
      };
    });
    this.selectedLayerId = state.selectedLayerId;
    this.selectedLayerIds = state.selectedLayerIds || [];
    this.idCounter = state.idCounter;
    this.groupCounter = state.groupCounter || 0;
    this.canvas.clearAllCache();
  }
}
