/**
 * ExportManager - 导出管理器
 *
 * 普通导出 (PNG/JPG/WebP)：画布尺寸 × 统一缩放比例，保持清晰度
 * 原图导出：所有图层用统一缩放比，确保拼接正确，原图像素 1:1
 */
export class ExportManager {
  constructor(canvas, layerManager) {
    this.canvas = canvas;
    this.layerManager = layerManager;
  }

  // ==================== 普通导出 ====================

  async exportImage(format = 'png') {
    const layers = this.layerManager.getLayers().filter(l => l.visible);
    if (layers.length === 0) {
      this.showToast('画布为空，请先添加图片', 'error');
      return;
    }

    // 计算统一缩放比例：取所有图层中最大的 originalSize/displaySize
    let exportScale = 1;
    for (const layer of layers) {
      if (layer.type === 'image' && layer.originalWidth && layer.originalHeight) {
        exportScale = Math.max(exportScale, layer.originalWidth / layer.width, layer.originalHeight / layer.height);
      }
    }
    exportScale = Math.max(1, Math.min(4, exportScale));

    const w = Math.round(this.canvas.width * exportScale);
    const h = Math.round(this.canvas.height * exportScale);

    // 预加载原图
    const loadedLayers = await this.loadOriginalImages(layers);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');

    // 背景
    if (format === 'jpeg' || format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    // 用统一缩放比例渲染所有图层
    for (const layer of loadedLayers) {
      this.renderLayerScaled(layer, ctx, exportScale);
    }

    this.downloadCanvas(offscreen, format, `拼接导出_${Date.now()}`);
  }

  // ==================== 原图导出（拼接正确，零压缩） ====================

  async exportOriginal() {
    const allLayers = this.layerManager.getLayers().filter(l => l.visible);
    if (allLayers.length === 0) {
      this.showToast('画布为空，请先添加图片', 'error');
      return;
    }

    // 加载所有原始图片
    const loadedLayers = await this.loadOriginalImages(allLayers);

    // 使用统一缩放比例（和普通导出一样），确保图层相对位置正确
    let exportScale = 1;
    for (const layer of loadedLayers) {
      if (layer.type === 'image' && layer.originalWidth && layer.originalHeight) {
        exportScale = Math.max(exportScale, layer.originalWidth / layer.width, layer.originalHeight / layer.height);
      }
    }
    exportScale = Math.max(1, Math.min(4, exportScale));

    // 用统一比例计算缩放后的坐标，计算包围盒
    const scaledLayers = loadedLayers.map(l => ({
      ...l,
      _sx: l.x * exportScale,
      _sy: l.y * exportScale,
      _sw: l.width * exportScale,
      _sh: l.height * exportScale,
      _sfontSize: (l.fontSize || 48) * exportScale
    }));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of scaledLayers) {
      minX = Math.min(minX, l._sx);
      minY = Math.min(minY, l._sy);
      maxX = Math.max(maxX, l._sx + l._sw);
      maxY = Math.max(maxY, l._sy + l._sh);
    }

    const w = Math.round(maxX - minX);
    const h = Math.round(maxY - minY);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // 渲染到紧密包围盒
    for (const layer of scaledLayers) {
      const destX = layer._sx - minX;
      const destY = layer._sy - minY;

      ctx.save();
      if (layer.opacity !== undefined && layer.opacity < 1) {
        ctx.globalAlpha = layer.opacity;
      }

      if (layer.type === 'text') {
        const cx = destX + layer._sw / 2;
        const cy = destY + layer._sh / 2;
        ctx.translate(cx, cy);
        if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.fillStyle = layer.color || '#000000';
        ctx.font = `${layer.fontWeight || 'bold'} ${layer._sfontSize}px ${layer.fontFamily || 'sans-serif'}`;
        ctx.textAlign = layer.textAlign || 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.text, 0, 0);
      } else {
        // 使用原始图片（完整像素）
        const img = layer._originalImg || this.canvas.getImage(layer);
        if (!img) { ctx.restore(); continue; }

        const cx = destX + layer._sw / 2;
        const cy = destY + layer._sh / 2;
        ctx.translate(cx, cy);
        if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);

        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (layer.flipH) { sx = img.width; sw = -img.width; }
        if (layer.flipV) { sy = img.height; sh = -img.height; }

        ctx.drawImage(img, sx, sy, sw, sh, -layer._sw / 2, -layer._sh / 2, layer._sw, layer._sh);
      }

      ctx.restore();
    }

    this.downloadCanvas(offscreen, 'png', `原图导出_${Date.now()}`);
    this.showToast(`原图导出完成 (${w}×${h})`, 'success');
  }

  // ==================== 渲染 ====================

  /**
   * 用统一缩放比例渲染图层
   */
  renderLayerScaled(layer, ctx, scale) {
    ctx.save();
    if (layer.opacity !== undefined && layer.opacity < 1) {
      ctx.globalAlpha = layer.opacity;
    }

    if (layer.type === 'text') {
      const x = layer.x * scale;
      const y = layer.y * scale;
      const w = layer.width * scale;
      const h = layer.height * scale;
      const fs = (layer.fontSize || 48) * scale;

      const cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.fillStyle = layer.color || '#000000';
      ctx.font = `${layer.fontWeight || 'bold'} ${fs}px ${layer.fontFamily || 'sans-serif'}`;
      ctx.textAlign = layer.textAlign || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, 0, 0);
    } else {
      const img = layer._originalImg || this.canvas.getImage(layer);
      if (!img) { ctx.restore(); return; }

      const x = layer.x * scale;
      const y = layer.y * scale;
      const w = layer.width * scale;
      const h = layer.height * scale;

      const cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (layer.flipH) { sx = img.width; sw = -img.width; }
      if (layer.flipV) { sy = img.height; sh = -img.height; }

      ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    }

    ctx.restore();
  }

  // ==================== 工具方法 ====================

  async loadOriginalImages(layers) {
    const result = [];
    for (const layer of layers) {
      let originalImg = null;
      if (layer.type === 'image' && layer.originalFile) {
        try {
          originalImg = await this.loadImageFromFile(layer.originalFile);
        } catch (err) {
          console.warn('加载原图失败:', layer.name, err);
        }
      }
      result.push({ ...layer, _originalImg: originalImg });
    }
    return result;
  }

  loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * 用 Blob 方式下载（避免 DataURL 过长导致无法打开）
   */
  downloadCanvas(canvas, format, filename) {
    let mimeType, ext;
    switch (format) {
      case 'jpeg': case 'jpg': mimeType = 'image/jpeg'; ext = 'jpg'; break;
      case 'webp': mimeType = 'image/webp'; ext = 'webp'; break;
      default: mimeType = 'image/png'; ext = 'png'; break;
    }

    const w = canvas.width;
    const h = canvas.height;

    // 优先使用 toBlob（生成更小的文件）
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) {
          const url = URL.createObjectURL(blob);
          this.triggerDownload(url, `${filename}.${ext}`);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          this.showToast(`已导出 ${ext.toUpperCase()} (${w}×${h})`, 'success');
        } else {
          // toBlob 失败，降级到 dataURL
          this.downloadViaDataURL(canvas, mimeType, ext, filename);
        }
      }, mimeType, 1.0); // quality=1.0 最高质量
    } else {
      // 不支持 toBlob，降级到 dataURL
      this.downloadViaDataURL(canvas, mimeType, ext, filename);
    }
  }

  downloadViaDataURL(canvas, mimeType, ext, filename) {
    try {
      const dataUrl = canvas.toDataURL(mimeType, 1.0);
      this.triggerDownload(dataUrl, `${filename}.${ext}`);
      this.showToast(`已导出 ${ext.toUpperCase()} (${canvas.width}×${canvas.height})`, 'success');
    } catch (err) {
      console.error('导出失败:', err);
      this.showToast('导出失败，请尝试缩小画布或图片尺寸', 'error');
    }
  }

  triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
