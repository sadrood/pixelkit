/**
 * DocumentPage - 文档转换页面
 * Tab 1: 格式互转 (docx/xlsx/pptx/pdf)
 * Tab 2: 图片⇄PDF
 * Tab 3: PDF 合并/拆分
 * Tab 4: PDF 压缩/加密/解密/水印
 */
import mammoth from 'mammoth';

const API = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

export class DocumentPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    this.initTabs();
    this.initFormatConvert();
    this.initImgPdf();
    this.initMergeSplit();
    this.initPdfTools();
  }

  // ==================== Tab 切换 ====================

  initTabs() {
    document.querySelectorAll('#page-document .doc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#page-document .doc-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-document .doc-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });

    document.querySelectorAll('#page-document .doc-sub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const parent = tab.parentElement;
        parent.querySelectorAll('.doc-sub-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const panelId = `sub-${tab.dataset.sub}`;
        const panel = document.getElementById(panelId);
        if (panel) {
          panel.parentElement.querySelectorAll('.doc-sub-panel').forEach(p => p.classList.remove('active'));
          panel.classList.add('active');
        }
      });
    });
  }

  // ==================== Tab 1: 格式互转 ====================

  initFormatConvert() {
    const zone = document.getElementById('doc-upload-zone');
    const input = document.getElementById('doc-file-input');
    let pdfData = null, pages = [], currentPage = 0;

    document.getElementById('btn-doc-upload').addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    zone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== input) input.click(); });

    input.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        const f = e.target.files[0];
        if (!validateDocFile(f)) { input.value = ''; return; }
        const ext = f.name.split('.').pop().toLowerCase();
        document.getElementById('doc-file-name').textContent = f.name;
        document.getElementById('doc-file-meta').textContent = `${formatSize(f.size)} | ${ext.toUpperCase()}`;
        document.getElementById('doc-info-bar').style.display = 'flex';
        updateTargetOptions(ext);
        input._file = f;
        input.value = '';
      }
    });

    this.setupDragDrop(zone, (file) => {
      if (!validateDocFile(file)) return;
      const ext = file.name.split('.').pop().toLowerCase();
      document.getElementById('doc-file-name').textContent = file.name;
      document.getElementById('doc-file-meta').textContent = `${formatSize(file.size)} | ${ext.toUpperCase()}`;
      document.getElementById('doc-info-bar').style.display = 'flex';
      updateTargetOptions(ext);
      input._file = file;
    });

    document.getElementById('btn-doc-convert').addEventListener('click', async () => {
      const file = input._file;
      if (!file) { this.toast.show('请先选择文件', 'error'); return; }

      const target = document.getElementById('doc-target-format').value;
      const fileExt = file.name.split('.').pop().toLowerCase();

      // PDF → Word 模式选择
      const modeSelect = document.getElementById('docx-convert-mode');
      const mode = (fileExt === 'pdf' && target === 'docx' && modeSelect) ? modeSelect.value : 'auto';

      // Markdown 纯前端转换
      if (target === 'md') {
        await this.convertToMarkdown(file, fileExt);
        return;
      }

      const apiUrl = `${API}/api/convert`;

      this.toast.show('正在转换...', 'success');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('target', target);
      formData.append('mode', mode);

      try {
        const resp = await fetch(apiUrl, { method: 'POST', body: formData });
        const result = await resp.json();
        if (!result.success) throw new Error(result.error);

        // 下载转换结果
        const dlUrl = `${API}${result.downloadUrl}`;
        const dlResp = await fetch(dlUrl);
        const blob = await dlResp.blob();
        const url = URL.createObjectURL(blob);
        download(url, result.filename);
        setTimeout(() => URL.revokeObjectURL(url), 2000);

        // 结果提示
        if (target === 'md') {
          this.toast.show('Markdown 转换完成！标题/段落/表格结构已保留', 'success');
        } else if (result.engine === 'pdf2image-docx') {
          this.toast.show(`转换完成！${result.pages || '?'} 页高清图片已嵌入 Word，排版 100% 还原`, 'success');
        } else if (result.engine === 'pdf2docx') {
          this.toast.show('转换完成（智能还原）。格式为近似还原，如需 100% 排版还原请选择「图片嵌入」模式', 'success');
        } else {
          this.toast.show('转换完成，已开始下载', 'success');
        }

        // 如果是转为 PDF，预览
        if (target === 'pdf' || result.filename.endsWith('.pdf')) {
          const buf = await blob.arrayBuffer();
          pdfData = buf;
          await renderPdfPreview(buf);
        }
      } catch (err) {
        this.toast.show('转换失败: ' + err.message, 'error');
      }
    });

    // 翻页
    document.getElementById('btn-doc-prev').addEventListener('click', () => {
      if (currentPage > 0) { currentPage--; showPage(pages, currentPage); updatePageNav(pages, currentPage); }
    });
    document.getElementById('btn-doc-next').addEventListener('click', () => {
      if (currentPage < pages.length - 1) { currentPage++; showPage(pages, currentPage); updatePageNav(pages, currentPage); }
    });

    async function renderPdfPreview(buffer) {
      const body = document.getElementById('doc-preview-body');
      const container = document.getElementById('doc-preview-container');
      container.style.display = 'flex';
      body.innerHTML = '<div class="doc-loading"><span class="spinner"></span>加载PDF引擎...</div>';

      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        body.innerHTML = '<div class="doc-loading"><span class="spinner"></span>渲染预览...</div>';
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          body.innerHTML = `<div class="doc-loading"><span class="spinner"></span>渲染第 ${i}/${pdf.numPages} 页...</div>`;
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1.5 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          pages.push(c);
        }
        currentPage = 0;
        showPage(pages, currentPage);
        updatePageNav(pages, currentPage);
      } catch (err) {
        body.innerHTML = '<div class="doc-preview-empty">预览渲染失败</div>';
      }
    }

    function showPage(pages, idx) {
      const body = document.getElementById('doc-preview-body');
      if (pages.length === 0) { body.innerHTML = '<div class="doc-preview-empty">无内容</div>'; return; }
      const c = pages[idx].cloneNode(true);
      c.className = 'doc-page-canvas';
      body.innerHTML = ''; body.appendChild(c);
    }

    function updatePageNav(pages, idx) {
      document.getElementById('doc-page-info').textContent = `${idx + 1} / ${pages.length}`;
      document.getElementById('btn-doc-prev').disabled = idx <= 0;
      document.getElementById('btn-doc-next').disabled = idx >= pages.length - 1;
    }
  }

  // ==================== Tab 2: 图片⇄PDF ====================

  initImgPdf() {
    // 图片 → PDF
    const imgZone = document.getElementById('img2pdf-zone');
    const imgInput = document.getElementById('img2pdf-input');
    const imgList = document.getElementById('img2pdf-list');
    const imgBtn = document.getElementById('btn-img2pdf-convert');
    let imgFiles = [];

    document.getElementById('btn-img2pdf-upload').addEventListener('click', (e) => { e.stopPropagation(); imgInput.click(); });
    imgZone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== imgInput) imgInput.click(); });

    imgInput.addEventListener('change', (e) => {
      imgFiles = Array.from(e.target.files).filter(f => validateImageFile(f));
      if (imgFiles.length === 0) { imgInput.value = ''; return; }
      renderImgList(imgFiles, imgList);
      imgBtn.style.display = imgFiles.length > 0 ? 'inline-flex' : 'none';
      document.getElementById('img2pdf-progress').classList.remove('active');
      imgInput.value = '';
    });
    this.setupDragDrop(imgZone, (file) => {
      if (!validateImageFile(file)) return;
      imgFiles.push(file);
      renderImgList(imgFiles, imgList);
      imgBtn.style.display = 'inline-flex';
      document.getElementById('img2pdf-progress').classList.remove('active');
    });

    imgBtn.addEventListener('click', async () => {
      if (imgFiles.length === 0) return;

      // 显示进度条
      const progressWrap = document.getElementById('img2pdf-progress');
      const progressFill = document.getElementById('img2pdf-progress-fill');
      const statusText = document.getElementById('img2pdf-status-text');
      const percentEl = document.getElementById('img2pdf-percent');
      const currentFileEl = document.getElementById('img2pdf-current-file');
      const etaEl = document.getElementById('img2pdf-eta');
      const errorEl = document.getElementById('img2pdf-error');

      progressWrap.classList.add('active');
      errorEl.style.display = 'none';
      statusText.textContent = '正在处理...';
      percentEl.textContent = '0%';
      progressFill.style.width = '0%';
      currentFileEl.textContent = '';
      etaEl.textContent = '';
      imgBtn.disabled = true;

      const fd = new FormData();
      imgFiles.forEach(f => fd.append('files', f));

      try {
        // 1. 发起转换请求
        const resp = await fetch(`${API}/api/img-to-pdf`, { method: 'POST', body: fd });
        const data = await resp.json();

        if (!data.success) {
          if (resp.status === 429) {
            const waitSec = data.retryAfter || 30;
            errorEl.innerHTML = `⏳ ${data.error}<br><small>服务器 2 核 2G，同时只能处理 ${2} 个任务。预计等待 ${waitSec} 秒后可重试。</small>`;
          } else {
            errorEl.textContent = data.error || '请求失败';
          }
          errorEl.style.display = 'block';
          statusText.textContent = '🚫 请求失败';
          imgBtn.disabled = false;
          return;
        }

        // 2. 轮询进度
        const taskId = data.taskId;
        const startTime = Date.now();
        const estimatedTotal = data.estimatedSeconds * 1000;
        let pollTimer;

        const updateETA = (progress) => {
          if (progress <= 0) return;
          const elapsed = Date.now() - startTime;
          const total = elapsed / progress;
          const remaining = Math.max(0, total - elapsed);
          if (remaining < 2000) {
            etaEl.textContent = '即将完成...';
            etaEl.className = 'task-progress-eta';
          } else if (remaining > 120000) {
            etaEl.textContent = '预计剩余 ' + Math.ceil(remaining / 60000) + ' 分钟';
            etaEl.className = 'task-progress-eta warn';
          } else {
            etaEl.textContent = '预计剩余 ' + Math.ceil(remaining / 1000) + ' 秒';
            etaEl.className = 'task-progress-eta';
          }
        };

        const taskResult = await new Promise((resolve, reject) => {
          let notFoundCount = 0;
          pollTimer = setInterval(async () => {
            try {
              const statusResp = await fetch(`${API}/api/task/${taskId}/status`);
              if (statusResp.status === 404) {
                notFoundCount++;
                // 任务可能刚创建还没注册，容忍 3 次
                if (notFoundCount > 3) {
                  clearInterval(pollTimer);
                  reject(new Error('任务已过期或丢失'));
                }
                return;
              }
              notFoundCount = 0;
              const t = await statusResp.json();

              if (t.status === 'done') {
                clearInterval(pollTimer);
                progressFill.style.width = '100%';
                percentEl.textContent = '100%';
                statusText.textContent = '✅ 转换完成！';
                currentFileEl.textContent = `共处理 ${t.total} 张图片，${t.pages} 页 PDF`;
                etaEl.textContent = '';
                resolve(t);
              } else if (t.status === 'error') {
                clearInterval(pollTimer);
                errorEl.textContent = t.error || '处理失败';
                errorEl.style.display = 'block';
                statusText.textContent = '❌ 转换失败';
                reject(new Error(t.error));
              } else if (t.status === 'processing') {
                const pct = Math.round(t.progress * 100);
                progressFill.style.width = pct + '%';
                percentEl.textContent = pct + '%';
                currentFileEl.textContent = t.current
                  ? `正在处理: ${t.current} (${t.index}/${t.total})`
                  : `正在处理: ${t.index}/${t.total}`;
                updateETA(t.progress);
              }
            } catch {
              // 网络错误，继续轮询
            }
          }, 500);

          // 超时保护：5 分钟后强制停止
          setTimeout(() => {
            clearInterval(pollTimer);
            reject(new Error('处理超时，请重试'));
          }, 300000);
        });

        // 3. 下载结果（用任务完成后的 downloadUrl）
        const dlUrl = (taskResult && taskResult.downloadUrl) || `/api/download/${taskId}/output.pdf`;
        const dlResp = await fetch(`${API}${dlUrl}`);
        if (dlResp.ok) {
          const blob = await dlResp.blob();
          download(URL.createObjectURL(blob), '图片合并_' + Date.now() + '.pdf');
          this.toast.show('PDF 已生成，开始下载', 'success');
        }
      } catch (err) {
        this.toast.show(err.message || '转换失败', 'error');
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      } finally {
        imgBtn.disabled = false;
      }
    });

    // PDF → 图片
    const pdfZone = document.getElementById('pdf2img-zone');
    const pdfInput = document.getElementById('pdf2img-input');
    const pdfBtn = document.getElementById('btn-pdf2img-convert');
    let pdfFile = null;

    document.getElementById('btn-pdf2img-upload').addEventListener('click', (e) => { e.stopPropagation(); pdfInput.click(); });
    pdfZone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== pdfInput) pdfInput.click(); });

    pdfInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!validatePdfFile(f)) { pdfInput.value = ''; return; }
      pdfFile = f;
      pdfBtn.style.display = 'inline-flex';
      pdfInput.value = '';
    });
    this.setupDragDrop(pdfZone, (file) => {
      if (!validatePdfFile(file)) return;
      pdfFile = file; pdfBtn.style.display = 'inline-flex';
    });

    pdfBtn.addEventListener('click', async () => {
      if (!pdfFile) return;
      const format = document.getElementById('pdf2img-format').value;
      this.toast.show('正在导出图片...', 'success');
      const fd = new FormData();
      fd.append('file', pdfFile);
      fd.append('format', format);
      try {
        const resp = await fetch(`${API}/api/pdf-to-img`, { method: 'POST', body: fd });
        const result = await resp.json();
        if (result.success) {
          for (const url of result.downloadUrls) {
            const dlResp = await fetch(`${API}${url}`);
            const blob = await dlResp.blob();
            const fname = url.split('/').pop();
            download(URL.createObjectURL(blob), fname);
          }
          this.toast.show(`已导出 ${result.files.length} 张图片`, 'success');
        }
      } catch (err) { this.toast.show('导出失败', 'error'); }
    });
  }

  // ==================== Tab 3: 合并拆分 ====================

  initMergeSplit() {
    // 合并
    const mergeZone = document.getElementById('merge-zone');
    const mergeInput = document.getElementById('merge-input');
    const mergeList = document.getElementById('merge-list');
    const mergeBtn = document.getElementById('btn-merge-convert');
    let mergeFiles = [];

    document.getElementById('btn-merge-upload').addEventListener('click', (e) => { e.stopPropagation(); mergeInput.click(); });
    mergeZone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== mergeInput) mergeInput.click(); });

    mergeInput.addEventListener('change', (e) => {
      mergeFiles = Array.from(e.target.files).filter(f => validatePdfFile(f));
      if (mergeFiles.length === 0) { mergeInput.value = ''; return; }
      renderMergeList(mergeFiles, mergeList);
      mergeBtn.style.display = mergeFiles.length > 1 ? 'inline-flex' : 'none';
      mergeInput.value = '';
    });
    this.setupDragDrop(mergeZone, (file) => {
      if (!validatePdfFile(file)) return;
      mergeFiles.push(file);
      renderMergeList(mergeFiles, mergeList);
      mergeBtn.style.display = mergeFiles.length > 1 ? 'inline-flex' : 'none';
    });

    mergeBtn.addEventListener('click', async () => {
      this.toast.show('正在合并...', 'success');
      const fd = new FormData();
      mergeFiles.forEach(f => fd.append('files', f));
      try {
        const resp = await fetch(`${API}/api/pdf-merge`, { method: 'POST', body: fd });
        const r = await resp.json();
        if (r.success) {
          const dl = await fetch(`${API}${r.downloadUrl}`);
          download(URL.createObjectURL(await dl.blob()), 'PDF合并_' + Date.now() + '.pdf');
          this.toast.show(`合并完成 (${r.pages} 页)`, 'success');
        }
      } catch (err) { this.toast.show('合并失败', 'error'); }
    });

    // 拆分
    const splitZone = document.getElementById('split-zone');
    const splitInput = document.getElementById('split-input');
    const splitBtn = document.getElementById('btn-split-convert');
    let splitFile = null;

    document.getElementById('btn-split-upload').addEventListener('click', (e) => { e.stopPropagation(); splitInput.click(); });
    splitZone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== splitInput) splitInput.click(); });

    splitInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!validatePdfFile(f)) { splitInput.value = ''; return; }
      splitFile = f;
      splitBtn.style.display = 'inline-flex';
      splitInput.value = '';
    });
    this.setupDragDrop(splitZone, (file) => {
      if (!validatePdfFile(file)) return;
      splitFile = file; splitBtn.style.display = 'inline-flex';
    });

    splitBtn.addEventListener('click', async () => {
      if (!splitFile) return;
      this.toast.show('正在拆分...', 'success');
      const fd = new FormData();
      fd.append('file', splitFile);
      fd.append('pagesPer', document.getElementById('split-pages').value);
      try {
        const resp = await fetch(`${API}/api/pdf-split`, { method: 'POST', body: fd });
        const r = await resp.json();
        if (r.success) {
          for (const url of r.downloadUrls) {
            const dl = await fetch(`${API}${url}`);
            download(URL.createObjectURL(await dl.blob()), url.split('/').pop());
          }
          this.toast.show(`已拆分为 ${r.files.length} 个文件`, 'success');
        }
      } catch (err) { this.toast.show('拆分失败', 'error'); }
    });
  }

  // ==================== Tab 4: PDF 工具 ====================

  initPdfTools() {
    // 通用单文件上传 → 处理
    const tools = [
      { zoneId: 'compress-zone', inputId: 'compress-input', btnId: 'btn-compress-convert', infoId: 'compress-info', api: '/api/pdf-compress', btnLabel: '压缩 PDF', suffix: '_compressed', hasExtra: false },
      { zoneId: 'encrypt-zone', inputId: 'encrypt-input', btnId: 'btn-encrypt-convert', infoId: null, api: '/api/pdf-encrypt', btnLabel: '加密', suffix: '_encrypted', hasExtra: true, extra: () => ({ password: document.getElementById('encrypt-password').value || '123456' }) },
      { zoneId: 'decrypt-zone', inputId: 'decrypt-input', btnId: 'btn-decrypt-convert', infoId: null, api: '/api/pdf-decrypt', btnLabel: '解密', suffix: '_decrypted', hasExtra: true, extra: () => ({ password: document.getElementById('decrypt-password').value || '' }) },
      { zoneId: 'watermark-zone', inputId: 'watermark-input', btnId: 'btn-watermark-convert', infoId: null, api: '/api/pdf-watermark', btnLabel: '加水印', suffix: '_watermarked', hasExtra: true, extra: () => ({ text: document.getElementById('watermark-text').value, opacity: (document.getElementById('watermark-opacity').value / 100).toString(), color: document.getElementById('watermark-color').value }) }
    ];

    for (const tool of tools) {
      const zone = document.getElementById(tool.zoneId);
      const input = document.getElementById(tool.inputId);
      const btn = document.getElementById(tool.btnId);
      const uploadBtn = zone?.querySelector('.btn-primary');
      let file = null;

      if (uploadBtn) uploadBtn.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
      if (zone) zone.addEventListener('click', (e) => { if (!e.target.closest('button') && e.target !== input) input.click(); });

      input.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!validatePdfFile(f)) { input.value = ''; return; }
        file = f;
        btn.style.display = 'inline-flex';
        input.value = '';
      });
      this.setupDragDrop(zone, (f) => {
        if (!validatePdfFile(f)) return;
        file = f; btn.style.display = 'inline-flex';
      });

      btn.addEventListener('click', async () => {
        if (!file) return;
        this.toast.show('处理中...', 'success');
        const fd = new FormData();
        fd.append('file', file);
        if (tool.hasExtra) {
          const extra = tool.extra();
          for (const [k, v] of Object.entries(extra)) fd.append(k, v);
        }
        try {
          const resp = await fetch(`${API}${tool.api}`, { method: 'POST', body: fd });
          const r = await resp.json();
          if (r.success) {
            const dl = await fetch(`${API}${r.downloadUrl}`);
            const blob = await dl.blob();
            download(URL.createObjectURL(blob), (file.name.replace(/\.[^.]+$/, '') + (tool.suffix || '') + '.pdf'));

            let msg = '处理完成';
            if (r.originalSize) msg = `压缩完成 (${formatSize(r.originalSize)} → ${formatSize(r.compressedSize)}, ${r.ratio}%)`;
            this.toast.show(msg, 'success');

            if (tool.infoId && r.originalSize) {
              document.getElementById(tool.infoId).innerHTML = `<div class="doc-result-info">原始: ${formatSize(r.originalSize)} → 压缩后: <span class="success">${formatSize(r.compressedSize)}</span> (${r.ratio}%)</div>`;
              document.getElementById(tool.infoId).style.display = 'block';
            }
          } else throw new Error(r.error);
        } catch (err) { this.toast.show(err.message || '处理失败', 'error'); }
      });
    }

    // 水印透明度滑块
    const opacitySlider = document.getElementById('watermark-opacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        document.getElementById('watermark-opacity-val').textContent = opacitySlider.value + '%';
      });
    }
  }

  // ==================== 工具方法 ====================

  setupDragDrop(zone, onFile) {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length === 1) onFile(files[0]);
      else if (files.length > 1) {
        for (const f of files) onFile(f);
      }
    });
  }

  // ==================== 纯前端 Markdown 转换 ====================

  async convertToMarkdown(file, ext) {
    // PDF 走后端 pymupdf（文字结构好），其他格式前端处理
    if (ext === 'pdf') {
      this.toast.show('正在上传并提取 PDF 文字...', 'success');
      const formData = new FormData();
      formData.append('file', file);
      try {
        const resp = await fetch(`${API}/api/to-markdown`, { method: 'POST', body: formData });
        const result = await resp.json();
        if (!result.success) throw new Error(result.error);

        const dlResp = await fetch(`${API}${result.downloadUrl}`);
        const blob = await dlResp.blob();
        const url = URL.createObjectURL(blob);
        const outName = file.name.replace(/\.[^.]+$/, '') + '.md';
        download(url, outName);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        this.toast.show('PDF → Markdown 完成！', 'success');
      } catch (err) {
        this.toast.show('PDF 转换失败: ' + err.message, 'error');
      }
      return;
    }

    // 前端转换（Word/HTML/其他）
    this.toast.show('正在提取内容...', 'success');
    try {
      let md = '';

      if (ext === 'docx' || ext === 'doc') {
        const buffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        md = this.htmlToMarkdown(result.value);
      } else if (ext === 'html' || ext === 'htm') {
        md = this.htmlToMarkdown(await file.text());
      } else {
        md = await file.text();
      }

      md = md.replace(/\n{3,}/g, '\n\n').trim();

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      download(url, file.name.replace(/\.[^.]+$/, '') + '.md');
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast.show('Markdown 转换完成！', 'success');
    } catch (err) {
      this.toast.show('转换失败: ' + err.message, 'error');
    }
  }

  /**
   * HTML → Markdown 简易转换
   */
  htmlToMarkdown(html) {
    let md = html;

    // 去掉 style/script 标签
    md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    // 标题 h1-h6
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, t) => `\n# ${this.stripHtml(t)}\n`);
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, t) => `\n## ${this.stripHtml(t)}\n`);
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, t) => `\n### ${this.stripHtml(t)}\n`);
    md = md.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, (_, t) => `\n#### ${this.stripHtml(t)}\n`);

    // 粗体/斜体
    md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
    md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');

    // 链接
    md = md.replace(/<a[^>]*href="(.*?)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

    // 图片
    md = md.replace(/<img[^>]*src="(.*?)"[^>]*alt="(.*?)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*src="(.*?)"[^>]*\/?>/gi, '![]($1)');

    // 列表项
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, t) => `- ${this.stripHtml(t)}`);

    // 段落
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, (_, t) => `\n${this.stripHtml(t)}\n`);

    // 换行
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // 表格 → Markdown 表格
    md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
      const rows = [];
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(content)) !== null) {
        const cells = [];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
          cells.push(this.stripHtml(cellMatch[1]).replace(/\|/g, '\\|').trim());
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length === 0) return '';
      let table = '\n| ' + rows[0].join(' | ') + ' |\n';
      table += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < rows.length; i++) {
        table += '| ' + rows[i].join(' | ') + ' |\n';
      }
      return table;
    });

    // 去掉剩余 HTML 标签
    md = md.replace(/<[^>]+>/g, '');

    // 解码 HTML 实体
    md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

    return md;
  }

  stripHtml(html) {
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
               .replace(/&nbsp;/g, ' ').trim();
  }
}

// ==================== 全局工具 ====================

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== 文件格式校验 ====================

const DOC_ALLOWED = ['docx', 'doc', 'pdf', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'ods', 'html', 'htm'];
const IMG_ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg'];
const PDF_ALLOWED = ['pdf'];

function validateDocFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!DOC_ALLOWED.includes(ext)) {
    // toast 需要从全局拿，用 window._toastInstance
    // 措辞明确是"源文件"格式不支持（2026-10-08 审计：原文案容易被理解成目标格式有问题）
    if (window._toastInstance) window._toastInstance.show(`暂不支持 ${ext ? ext.toUpperCase() : '该'} 作为源文件（支持 ${DOC_ALLOWED.join('/')}），请改用其它工具`, 'error');
    return false;
  }
  return true;
}

function validateImageFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!IMG_ALLOWED.includes(ext) && !file.type.startsWith('image/')) {
    if (window._toastInstance) window._toastInstance.show(`不支持的图片格式 .${ext}`, 'error');
    return false;
  }
  return true;
}

function validatePdfFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!PDF_ALLOWED.includes(ext) && file.type !== 'application/pdf') {
    if (window._toastInstance) window._toastInstance.show(`仅支持 PDF 格式，当前为 .${ext}`, 'error');
    return false;
  }
  return true;
}

function download(url, filename) {
  const a = document.createElement('a');
  a.download = filename; a.href = url;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
}

/**
 * 根据源文件格式，只显示真正能转换的目标格式
 *
 * 转换可行性矩阵（LibreOffice 实际能力）：
 *   docx/doc → pdf, xlsx, html, csv
 *   xlsx/xls → pdf, csv, html
 *   pptx/ppt → pdf, html
 *   csv/ods  → pdf, xlsx, html
 *   pdf      → docx, xlsx, html（效果取决于 PDF 内容）
 *   html     → pdf, docx, xlsx
 */
function updateTargetOptions(sourceExt) {
  const select = document.getElementById('doc-target-format');

  // 每个源格式能转的目标列表（Markdown 全支持）
  const targetMap = {
    docx: ['pdf', 'xlsx', 'html', 'csv', 'md'],
    doc:  ['pdf', 'xlsx', 'html', 'csv', 'md'],
    xlsx: ['pdf', 'csv', 'html', 'md'],
    xls:  ['pdf', 'csv', 'html', 'md'],
    pptx: ['pdf', 'html', 'md'],
    ppt:  ['pdf', 'html', 'md'],
    pdf:  ['docx', 'xlsx', 'html', 'md'],
    csv:  ['pdf', 'xlsx', 'html', 'md'],
    ods:  ['pdf', 'xlsx', 'html', 'md'],
    html: ['pdf', 'docx', 'xlsx', 'md']
  };

  const labels = {
    pdf: 'PDF',
    docx: 'Word (.docx)',
    xlsx: 'Excel (.xlsx)',
    html: 'HTML',
    csv: 'CSV',
    md: 'Markdown (.md)'
  };

  const targets = targetMap[sourceExt] || ['pdf'];
  const tipMap = {
    pdf:   '📄 转为 PDF — 通用格式，推荐',
    docx:  '📝 转为 Word — 可编辑文档',
    xlsx:  '📊 转为 Excel — 表格数据',
    html:  '🌐 转为 HTML — 网页格式',
    csv:   '📋 转为 CSV — 纯文本表格',
    md:    '📝 转为 Markdown — 保留标题/段落/表格结构'
  };

  select.innerHTML = targets.map(t =>
    `<option value="${t}">${labels[t] || t.toUpperCase()}</option>`
  ).join('');

  // 显示转换提示
  const tip = tipMap[targets[0]] || '';
  const existingTip = document.getElementById('format-tip');
  if (existingTip) {
    existingTip.textContent = tip;
  } else {
    const tipEl = document.createElement('div');
    tipEl.id = 'format-tip';
    tipEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;';
    tipEl.textContent = tip;
    select.parentElement.appendChild(tipEl);
  }

  // PDF → Word 时显示模式选择
  const modeRow = document.getElementById('docx-mode-row');
  if (modeRow) {
    modeRow.style.display = (sourceExt === 'pdf' && targets.includes('docx')) ? 'flex' : 'none';
  }

  // 监听目标格式变化
  select.onchange = () => {
    if (modeRow) {
      modeRow.style.display = (sourceExt === 'pdf' && select.value === 'docx') ? 'flex' : 'none';
    }
  };
}

function renderImgList(files, container) {
  container.innerHTML = files.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="convert-item">
      <img class="item-preview" src="${url}" />
      <button class="item-remove" data-idx="${i}">×</button>
      <div class="item-info"><div class="item-name">${f.name}</div><div class="item-meta"><span>${formatSize(f.size)}</span></div></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.item-remove').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(b.dataset.idx);
      files.splice(idx, 1);
      renderImgList(files, container);
    });
  });
}

function renderMergeList(files, container) {
  container.innerHTML = files.map((f, i) => `<div class="convert-item">
    <div class="item-info" style="padding:12px;"><div class="item-name">${i + 1}. ${f.name}</div><div class="item-meta"><span>${formatSize(f.size)}</span></div></div>
    <button class="item-remove" data-idx="${i}">×</button>
  </div>`).join('');
  container.querySelectorAll('.item-remove').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      files.splice(parseInt(b.dataset.idx), 1);
      renderMergeList(files, container);
    });
  });
}
