/**
 * ConvertPage - 图片格式转换页面
 * 真实像素级转换，使用 Canvas 重新编码
 */
export class ConvertPage {
  constructor(toast) {
    this.toast = toast;
    this.files = []; // { file, name, size, type, width, height }
    this._inited = false;
  }

  init() {
    this._inited = true;

    this.uploadZone = document.getElementById('convert-upload-zone');
    this.fileInput = document.getElementById('convert-file-input');
    this.settingsEl = document.getElementById('convert-settings');
    this.previewList = document.getElementById('convert-preview-list');

    this.setupUpload();
    this.setupSettings();
    this.setupConvertButtons();
  }

  // ==================== 上传 ====================

  setupUpload() {
    // 点击上传
    document.getElementById('btn-convert-upload').addEventListener('click', (e) => {
      e.stopPropagation();
      this.fileInput.click();
    });
    this.uploadZone.addEventListener('click', (e) => {
      if (!e.target.closest('button')) this.fileInput.click();
    });

    // 文件选择
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.addFiles(e.target.files);
        this.fileInput.value = '';
      }
    });

    // 拖拽上传
    this.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadZone.classList.add('drag-over');
    });
    this.uploadZone.addEventListener('dragleave', () => {
      this.uploadZone.classList.remove('drag-over');
    });
    this.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        this.addFiles(e.dataTransfer.files);
      }
    });

    // 清空
    document.getElementById('btn-clear-convert').addEventListener('click', () => {
      this.files = [];
      this.renderList();
      this.settingsEl.style.display = 'none';
    });
  }

  async addFiles(fileList) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
    const newFiles = [];

    for (const file of fileList) {
      if (!validTypes.includes(file.type) && !file.name.endsWith('.ico')) {
        this.toast.show(`跳过不支持的文件: ${file.name}`, 'error');
        continue;
      }

      try {
        const info = await this.getImageInfo(file);
        newFiles.push(info);
      } catch (err) {
        this.toast.show(`读取失败: ${file.name}`, 'error');
      }
    }

    this.files.push(...newFiles);
    this.renderList();
    if (this.files.length > 0) {
      this.settingsEl.style.display = 'flex';
    }
    if (newFiles.length > 0) {
      this.toast.show(`已添加 ${newFiles.length} 个文件`, 'success');
    }
  }

  getImageInfo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            file,
            name: file.name,
            size: file.size,
            type: file.type,
            width: img.width,
            height: img.height,
            dataUrl: e.target.result
          });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ==================== 设置面板 ====================

  setupSettings() {
    const formatSelect = document.getElementById('convert-target-format');
    const qualitySlider = document.getElementById('convert-quality');
    const qualityValue = document.getElementById('convert-quality-value');
    const sizeMode = document.getElementById('convert-size-mode');
    const scaleRow = document.getElementById('scale-row');
    const fixedRow = document.getElementById('fixed-size-row');
    const scaleSlider = document.getElementById('convert-scale');
    const scaleValue = document.getElementById('convert-scale-value');

    // 格式切换：PNG/BMP 不显示质量选项
    formatSelect.addEventListener('change', () => {
      const fmt = formatSelect.value;
      const qualityRow = document.getElementById('quality-row');
      if (fmt === 'image/png' || fmt === 'image/bmp') {
        qualityRow.style.display = 'none';
      } else {
        qualityRow.style.display = 'flex';
      }
    });

    qualitySlider.addEventListener('input', () => {
      qualityValue.textContent = qualitySlider.value + '%';
    });

    sizeMode.addEventListener('change', () => {
      scaleRow.style.display = sizeMode.value === 'scale' ? 'flex' : 'none';
      fixedRow.style.display = sizeMode.value === 'fixed' ? 'flex' : 'none';
    });

    scaleSlider.addEventListener('input', () => {
      scaleValue.textContent = scaleSlider.value + '%';
    });
  }

  // ==================== 转换按钮 ====================

  setupConvertButtons() {
    document.getElementById('btn-convert-all').addEventListener('click', () => {
      this.convertAll();
    });
  }

  async convertAll() {
    if (this.files.length === 0) {
      this.toast.show('请先添加图片', 'error');
      return;
    }

    const targetFormat = document.getElementById('convert-target-format').value;
    const quality = parseInt(document.getElementById('convert-quality').value) / 100;
    const sizeMode = document.getElementById('convert-size-mode').value;
    const scale = parseInt(document.getElementById('convert-scale').value) / 100;
    const fixedW = parseInt(document.getElementById('convert-fixed-w').value);
    const fixedH = parseInt(document.getElementById('convert-fixed-h').value);

    let successCount = 0;
    this.toast.show(`正在转换 ${this.files.length} 个文件...`, 'success');

    for (const item of this.files) {
      try {
        await this.convertSingle(item, targetFormat, quality, sizeMode, scale, fixedW, fixedH);
        successCount++;
      } catch (err) {
        console.error('转换失败:', item.name, err);
      }
    }

    this.toast.show(`转换完成 ${successCount}/${this.files.length}`, 'success');
  }

  /**
   * 真实格式转换：通过 Canvas 重新编码
   */
  convertSingle(item, targetFormat, quality, sizeMode, scale, fixedW, fixedH) {
    // ICO 需要后端处理（浏览器 Canvas 不支持）
    if (targetFormat === 'image/x-icon') {
      return this.convertToIco(item);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // 计算目标尺寸
        let w = img.width;
        let h = img.height;

        if (sizeMode === 'scale') {
          w = Math.round(img.width * scale);
          h = Math.round(img.height * scale);
        } else if (sizeMode === 'fixed') {
          w = fixedW;
          h = fixedH;
        }

        // 创建离屏 canvas 重新绘制
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // 对于不支持透明的格式（JPG, BMP），先填白底
        if (targetFormat === 'image/jpeg' || targetFormat === 'image/bmp') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
        }

        ctx.drawImage(img, 0, 0, w, h);

        // 导出为指定格式
        canvas.toBlob((blob) => {
          if (!blob) {
            // 降级
            const dataUrl = canvas.toDataURL(targetFormat, quality);
            this.downloadDataUrl(dataUrl, item.name, targetFormat);
            resolve();
            return;
          }
          const url = URL.createObjectURL(blob);
          this.triggerDownload(url, this.getOutputName(item.name, targetFormat));
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          resolve();
        }, targetFormat, quality);
      };
      img.onerror = reject;
      img.src = item.dataUrl;
    });
  }

  /**
   * 单独转换某个文件
   */
  convertSingleItem(index) {
    const item = this.files[index];
    if (!item) return;
    const targetFormat = document.getElementById('convert-target-format').value;
    const quality = parseInt(document.getElementById('convert-quality').value) / 100;
    const sizeMode = document.getElementById('convert-size-mode').value;
    const scale = parseInt(document.getElementById('convert-scale').value) / 100;
    const fixedW = parseInt(document.getElementById('convert-fixed-w').value);
    const fixedH = parseInt(document.getElementById('convert-fixed-h').value);

    this.convertSingle(item, targetFormat, quality, sizeMode, scale, fixedW, fixedH)
      .then(() => this.toast.show(`${item.name} 转换完成`, 'success'))
      .catch(() => this.toast.show(`${item.name} 转换失败`, 'error'));
  }

  async convertToIco(item) {
    const API = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
    const formData = new FormData();
    formData.append('file', item.file);

    try {
      const resp = await fetch(`${API}/api/to-ico`, { method: 'POST', body: formData });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error);

      const dlResp = await fetch(`${API}${result.downloadUrl}`);
      const blob = await dlResp.blob();
      const url = URL.createObjectURL(blob);
      this.triggerDownload(url, this.getOutputName(item.name, 'image/x-icon'));
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      throw err;
    }
  }

  // ==================== 工具方法 ====================

  getOutputName(originalName, targetFormat) {
    const dotIndex = originalName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
    const extMap = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico'
    };
    const ext = extMap[targetFormat] || 'png';
    return `${baseName}.${ext}`;
  }

  downloadDataUrl(dataUrl, originalName, targetFormat) {
    const name = this.getOutputName(originalName, targetFormat);
    const link = document.createElement('a');
    link.download = name;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  getFormatLabel(type) {
    const map = {
      'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP',
      'image/bmp': 'BMP', 'image/svg+xml': 'SVG',
      'image/x-icon': 'ICO', 'image/vnd.microsoft.icon': 'ICO'
    };
    return map[type] || type.split('/')[1]?.toUpperCase() || '未知';
  }

  // ==================== 列表渲染 ====================

  renderList() {
    if (this.files.length === 0) {
      this.previewList.innerHTML = '';
      return;
    }

    this.previewList.innerHTML = this.files.map((item, index) => `
      <div class="convert-item">
        <img class="item-preview" src="${item.dataUrl}" alt="${item.name}" />
        <button class="item-remove" data-index="${index}">×</button>
        <span class="item-badge">${this.getFormatLabel(item.type)}</span>
        <div class="item-info">
          <div class="item-name" title="${item.name}">${item.name}</div>
          <div class="item-meta">
            <span>${item.width}×${item.height}</span>
            <span>${this.formatSize(item.size)}</span>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn btn-sm btn-convert-single" data-index="${index}">转换</button>
        </div>
      </div>
    `).join('');

    // 绑定删除按钮
    this.previewList.querySelectorAll('.item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        this.files.splice(idx, 1);
        this.renderList();
        if (this.files.length === 0) {
          this.settingsEl.style.display = 'none';
        }
      });
    });

    // 绑定单独转换按钮
    this.previewList.querySelectorAll('.btn-convert-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        this.convertSingleItem(idx);
      });
    });
  }
}
