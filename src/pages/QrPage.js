import JsBarcode from 'jsbarcode';
import jsQR from 'jsqr';

/* ============================================================================
   2026-10-21：二维码物理尺寸（打印口径）
   用户诉求：能定制「10mil / 20mil」这种打印尺寸。打印店说尺寸一般按两种口径：
     · 单模块（basis=module）：一个二维码小方块 10mil，整码大小 = 10mil × 总模块数
     · 整码宽（basis=whole）：整个二维码宽 20mm，再反推每个模块多大
   1 mil = 0.0254 mm，1 inch = 25.4 mm；total = 模块数 + 2×margin（margin=4，即 8 个模块）。
   栅格像素要保证「每模块整数像素」否则边缘发虚：
     px = round((整码mm / 25.4 × dpi) / total) × total
   最低 total（即 1px/模块），上限 4096；被夹取时只给 warning 提示，不阻断生成。
   抽成纯函数并导出，方便自检脚本 import 直接验证换算数值。
   ============================================================================ */
export const QR_PHYS_UNIT_MM = { mil: 0.0254, mm: 1, inch: 25.4 };
export const QR_PHYS_MAX_PX = 4096;
// 屏幕校准基准：银行卡 / 身份证短边 54mm（手机上比 85.6mm 长边好放）
const QR_CALIB_MM = 54;

export function qrPhysGeometry({ modules, value, unit = 'mil', basis = 'module', dpi = 600, margin = 4 } = {}) {
  const n = Math.max(1, Math.round(Number(modules) || 21));
  const total = n + margin * 2;
  const dpiN = Number(dpi) || 600;
  const unitKey = Object.prototype.hasOwnProperty.call(QR_PHYS_UNIT_MM, unit) ? unit : 'mil';
  const basisKey = basis === 'whole' ? 'whole' : 'module';
  const inputMm = Math.max(0, Number(value) || 0) * QR_PHYS_UNIT_MM[unitKey];
  let moduleMm, wholeMm;
  if (basisKey === 'whole') { wholeMm = inputMm; moduleMm = wholeMm / total; }
  else { moduleMm = inputMm; wholeMm = moduleMm * total; }

  const warnings = [];
  // 每模块像素先算再取整（整码宽 basis 下由整码像素反推）
  let modulePx = Math.round((wholeMm / 25.4) * dpiN / total);
  if (modulePx < 1) {
    modulePx = 1;
    warnings.push(`输出像素已压到最低 ${total}×${total}px（每模块 1px）`);
  }
  let px = modulePx * total;
  if (px > QR_PHYS_MAX_PX) {
    modulePx = Math.max(1, Math.floor(QR_PHYS_MAX_PX / total));
    px = modulePx * total;
    warnings.push(`输出像素超过 ${QR_PHYS_MAX_PX}，已限制为 ${px}×${px}px`);
  }
  // 下面三条是可扫性提示（白色小字，不阻断）；数值按打印经验给的阈值
  if (moduleMm < 0.25) warnings.push(`模块仅 ${moduleMm.toFixed(3)}mm（<0.25mm），打印后可能扫不出`);
  if (modulePx < 3) warnings.push(`每模块仅 ${modulePx}px（<3px），建议降低 DPI 或加大尺寸`);
  if (wholeMm < 10) warnings.push(`整码仅 ${wholeMm.toFixed(2)}mm（<10mm），太小可能扫不出`);

  const valueNum = Number(Number(value).toFixed(4));   // 去掉 10.0 这种尾巴，文件名/提示更干净
  const label = `${Number.isFinite(valueNum) ? valueNum : 0}${unitKey}${basisKey === 'whole' ? '-whole' : ''}-${dpiN}dpi`;
  return { n, total, value: Number.isFinite(valueNum) ? valueNum : 0, unit: unitKey, basis: basisKey, dpi: dpiN, wholeMm, moduleMm, modulePx, px, warnings, label };
}

/* 2026-10-21：PNG 物理 DPI 元数据（pHYs 块）。
   canvas.toDataURL() 生成的 PNG 不写 DPI，打印软件只能按 96dpi 猜，10mil/模块就会印错尺寸；
   这里手写 pHYs 块把 DPI 写进去（单位：像素/米）。CRC32 按 PNG 规范（反射多项式 0xEDB88320）。
   只处理 PNG；JPG/WebP 不写，并在结果提示里说明。 */
function pngCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bytesToBase64(bytes) {
  // 大图（4096²）的字节数组分块转字符串，避免 String.fromCharCode.apply 参数过多爆栈
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function pngDataUrlWithDpi(dataUrl, dpi) {
  try {
    const prefix = 'data:image/png;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return dataUrl;
    const ppuOfMeter = Math.max(1, Math.round(Number(dpi) / 0.0254));   // 每米像素数：600dpi ≈ 23622
    const bin = atob(dataUrl.slice(prefix.length));
    const src = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i);
    if (src.length < 33) return dataUrl;
    // PNG 签名（8 字节）+ 第一个块必须是 IHDR（长度 13 → 块共 25 字节，33 字节处结束）
    if (!(src[0] === 0x89 && src[1] === 0x50 && src[2] === 0x4e && src[3] === 0x47)) return dataUrl;
    if (src[12] !== 0x49 || src[13] !== 0x48 || src[14] !== 0x44 || src[15] !== 0x52) return dataUrl;  // 'IHDR'
    const chunk = new Uint8Array(21);                     // 4 长度 + 4 类型 + 9 数据 + 4 CRC
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 9);                                  // pHYs 数据长度固定 9
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);                // 'pHYs'
    view.setUint32(8, ppuOfMeter);                         // 水平像素/米
    view.setUint32(12, ppuOfMeter);                        // 垂直像素/米
    chunk[16] = 1;                                         // 单位：1 = 米
    view.setUint32(17, pngCrc32(chunk.subarray(4, 17)));   // CRC 覆盖「类型 + 数据」
    const out = new Uint8Array(src.length + chunk.length);
    out.set(src.subarray(0, 33), 0);                       // 签名 + IHDR
    out.set(chunk, 33);
    out.set(src.subarray(33), 33 + chunk.length);
    return prefix + bytesToBase64(out);
  } catch {
    return dataUrl;   // 任何异常都回退原图，保证「生成」不因元数据失败
  }
}

/** 弹层打开时锁滚动；全屏只显示二维码 / 屏幕校准 / 整屏背景图任一打开都算 */
function syncQrBodyLock() {
  const open = document.getElementById('qr-zoom')?.classList.contains('open')
    || document.getElementById('qr-calib')?.classList.contains('open')
    || document.getElementById('qr-bg')?.classList.contains('open');
  document.body.style.overflow = open ? 'hidden' : '';
}

/**
 * PixelKit - 二维码/一维码工具
 * 生成（文字/数字 → 二维码/一维码）、解码（图片 → 文字）、历史记录（24h 保存）
 */
export class QrPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
    this.records = [];
    this._lastModules = 21;   // 最近一次生成的二维码模块数（单独显示按物理尺寸换算要用）
    this._lastTotal = 29;     // 最近一次的整码模块数（模块 + 白边）
    // 浏览器用户标识：与 AgentPage / FileSharePage 共用同一套，保证「谁的记录展示给谁」
    this.userId = localStorage.getItem('pixelkit_user_id');
    if (!this.userId) {
      this.userId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pixelkit_user_id', this.userId);
    }
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    const root = document.getElementById('qr-root');
    if (!root) return;
    root.innerHTML = this.render();
    this.bindEvents();
    this.loadRecords();
    this.initBatch();
    this.initShortlink();
    // 2026-10-21：物理尺寸提示要实时算模块数，打开二维码页就先预加载 qrcode（原来是点「生成」才加载）
    this._loadQrLib().catch(() => {});
  }

  render() {
    return `
      <div class="qr-tabs">
        <button class="qr-tab active" data-tab="generate">🔳 二维码</button>
        <button class="qr-tab" data-tab="barcode">📊 一维码</button>
        <button class="qr-tab" data-tab="decode">🔍 解码</button>

        <button class="qr-tab" data-tab="batch">🔢 批量</button>


        <button class="qr-tab" data-tab="shortlink">🔗 活码</button>
        <button class="qr-tab" data-tab="file">📁 文件</button>
        <button class="qr-tab" data-tab="records">📑 记录</button>
        <button class="qr-tab" data-tab="scantest">🧪 扫码测试</button>
      </div>

      <!-- 生成 -->
      <div class="qr-panel active" id="qr-generate">
        <div class="qr-input-wrap">
          <textarea id="qr-text" placeholder="输入文字、网址或数字即可生成二维码" rows="4"></textarea>
          <div class="qr-options">
            <label>尺寸口径：
              <select id="qr-size-mode">
                <option value="px" selected>像素尺寸</option>
                <option value="phys">物理尺寸（打印）</option>
              </select>
            </label>
            <span id="qr-size-px-wrap" class="qr-size-group">
              <label>输出尺寸：
                <select id="qr-size">
                  <option value="256">256</option>
                  <option value="512" selected>512</option>
                  <option value="1024">1024</option>
                  <option value="custom">自定义…</option>
                </select>
              </label>
              <label id="qr-size-custom-wrap" style="display:none;">宽
                <input type="number" id="qr-size-custom" min="16" max="4096" step="1" value="60" /> px
              </label>
            </span>
            <!-- 2026-10-21：物理尺寸（打印常用 10mil/20mil 单模块，也支持整码宽 mm/inch） -->
            <span id="qr-size-phys-wrap" class="qr-size-group" style="display:none;">
              <label>物理尺寸：
                <input type="number" id="qr-phys-value" value="10" min="0.01" step="1" inputmode="decimal" />
              </label>
              <label>单位：
                <select id="qr-phys-unit">
                  <option value="mil" selected>mil（密耳）</option>
                  <option value="mm">mm（毫米）</option>
                  <option value="inch">inch（英寸）</option>
                </select>
              </label>
              <label>口径：
                <select id="qr-phys-basis">
                  <option value="module" selected>单模块</option>
                  <option value="whole">整码宽</option>
                </select>
              </label>
              <label>DPI：
                <select id="qr-phys-dpi">
                  <option value="300">300</option>
                  <option value="600" selected>600</option>
                  <option value="1200">1200</option>
                  <option value="2400">2400</option>
                </select>
              </label>
              <label title="勾选后页面预览也按物理尺寸显示（需先校准屏幕），10/15/20mil 能直接看出大小差别">
                <input type="checkbox" id="qr-phys-preview" /> 预览按物理尺寸
              </label>
              <span class="qr-presets">
                <button type="button" class="btn btn-sm qr-preset" data-qr-preset="10,mil">10 mil</button>
                <button type="button" class="btn btn-sm qr-preset" data-qr-preset="20,mil">20 mil</button>
                <button type="button" class="btn btn-sm qr-preset" data-qr-preset="1,mm">1 mm</button>
                <button type="button" class="btn btn-sm qr-preset" data-qr-preset="2,mm">2 mm</button>
              </span>
              <span class="qr-hint" id="qr-phys-hint"></span>
            </span>
            <!-- 2026-10-21：预览显示大小（只影响页面上看到的二维码大小，不改变下载像素/打印尺寸） -->
            <label title="只影响页面预览显示大小，不改变下载图片的像素和打印尺寸">显示大小：
              <select id="qr-display-size">
                <option value="128">128 px</option>
                <option value="192">192 px</option>
                <option value="256" selected>256 px（默认）</option>
                <option value="320">320 px</option>
                <option value="384">384 px</option>
                <option value="512">512 px</option>
                <option value="640">640 px</option>
                <option value="custom">自定义…</option>
              </select>
            </label>
            <label id="qr-display-custom-wrap" style="display:none;">宽：
              <input type="number" id="qr-display-custom" value="256" min="32" max="1024" step="8" />
            </label>
            <span class="qr-hint" id="qr-display-hint">仅影响预览显示，不改变下载像素</span>
            <label>格式：
              <select id="qr-format">
                <option value="png" selected>PNG（无损·推荐）</option>
                <option value="jpg">JPG（体积小·无透明）</option>
                <option value="webp">WebP（更小）</option>
                <option value="svg">SVG（矢量·可无限放大）</option>
              </select>
            </label>
            <label title="二维码四周留白（模块数）。0 = 无白边最省空间；打印或深色背景建议 2–4">留白：
              <select id="qr-margin">
                <option value="0" selected>0（无白边）</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4（标准）</option>
              </select>
            </label>
            <label>容错：
              <select id="qr-ecc">
                <option value="L">L（7%）</option>
                <option value="M" selected>M（15%）</option>
                <option value="Q">Q（25%）</option>
                <option value="H">H（30%·放 logo 选它）</option>
              </select>
            </label>
            <label>样式：
              <select id="qr-style">
                <option value="square" selected>经典方块</option>
                <option value="rounded">圆角方块</option>
                <option value="dots">圆点（太阳码风格）</option>
              </select>
            </label>
            <label>定位点：
              <select id="qr-eye">
                <option value="square" selected>方形</option>
                <option value="circle">圆形</option>
              </select>
            </label>
            <label>前景：<input type="color" id="qr-dark" value="#000000" /></label>
            <label>背景：<input type="color" id="qr-light" value="#ffffff" /></label>
            <label>渐变到：<input type="checkbox" id="qr-gradient" /> <input type="color" id="qr-dark2" value="#c2401d" /></label>
          </div>
          <div class="qr-actions">
            <button class="btn btn-primary" id="qr-gen-btn">生成二维码</button>
            <span class="qr-hint" id="qr-gen-hint"></span>
          </div>
        </div>
        <div class="qr-result" id="qr-gen-result" style="display:none;">
          <img id="qr-img" class="qr-img" alt="二维码" title="点击单独显示 / 调整显示大小" />
          <div class="qr-result-actions">
            <button class="btn btn-sm" id="qr-download">⬇ 下载 PNG</button>
            <button class="btn btn-sm" id="qr-save-gen">💾 存记录</button>
            <button class="btn btn-sm" id="qr-zoom-open">⛶ 单独显示</button>
            <button class="btn btn-sm" id="qr-bg-open" title="整屏画布，二维码保持当前显示大小，其余填白/黑背景">🖼 背景画布</button>
          </div>
        </div>
      </div>

      <!-- 一维码 -->
      <div class="qr-panel" id="qr-barcode">
        <div class="qr-input-wrap">
          <textarea id="barcode-text" placeholder="输入数字或字母即可生成一维码（CODE128 支持字母+数字，EAN-13 需 13 位数字）" rows="3"></textarea>
          <div class="qr-options">
            <label>格式：
              <select id="barcode-format">
                <option value="CODE128" selected>CODE128（通用）</option>
                <option value="EAN13">EAN-13（商品）</option>
                <option value="EAN8">EAN-8</option>
                <option value="UPC">UPC-A</option>
                <option value="CODE39">CODE39</option>
                <option value="ITF14">ITF-14</option>
                <option value="MSI">MSI</option>
              </select>
            </label>
            <label>宽度：<input type="number" id="barcode-width" value="2" min="1" max="4" style="width:50px;" /></label>
            <label>高度：<input type="number" id="barcode-height" value="100" min="40" max="300" style="width:60px;" /></label>
            <label>前景：<input type="color" id="barcode-dark" value="#000000" /></label>
            <label>背景：<input type="color" id="barcode-light" value="#ffffff" /></label>
          </div>
          <div class="qr-actions">
            <button class="btn btn-primary" id="barcode-gen-btn">生成一维码</button>
            <span class="qr-hint" id="barcode-gen-hint"></span>
          </div>
        </div>
        <div class="qr-result" id="barcode-gen-result" style="display:none;">
          <img id="barcode-img" class="qr-img" alt="一维码" style="object-fit:contain; background:#fff; padding:12px;" />
          <div class="qr-result-actions">
            <button class="btn btn-sm" id="barcode-download">⬇ 下载 PNG</button>
            <button class="btn btn-sm" id="barcode-save">💾 存记录</button>
          </div>
        </div>
      </div>

      <!-- 解码 -->
      <div class="qr-panel" id="qr-decode">
        <div class="qr-upload-zone" id="qr-upload-zone">
          <div class="upload-zone-content">
            <div class="upload-zone-icon">🖼️</div>
            <p>拖拽含二维码的图片到此处，或点击上传</p>
            <p class="upload-zone-hint">支持 PNG / JPG / WebP，自动识别</p>
            <button class="btn btn-primary" id="qr-pick">选择图片</button>
          </div>
          <input type="file" id="qr-file-input" accept="image/*" hidden />
        </div>
        <div class="qr-decode-preview" id="qr-decode-preview" style="display:none;">
          <img id="qr-decode-img" class="qr-img" alt="待解码" />
          <div class="qr-decode-result" id="qr-decode-result"></div>
          <div class="qr-result-actions" id="qr-decode-actions" style="display:none;">
            <button class="btn btn-sm" id="qr-copy-decode">📋 复制</button>
            <button class="btn btn-sm" id="qr-save-decode">💾 存记录</button>
            <button class="btn btn-sm" id="qr-repick">📷 换一张</button>
          </div>
        </div>
      </div>

      <!-- 文件活码 -->
      <!-- 批量解码 / 批量扫码（2026-10-13 参考草料二维码增补）-->
      <div class="qr-panel" id="qr-batch">
        <div class="qr-batch-modes">
          <button class="btn btn-sm active" id="qr-batch-mode-decode">🖼 批量解码（多张图片）</button>
          <button class="btn btn-sm" id="qr-batch-mode-scan">📷 批量扫码（摄像头连续扫）</button>
          <button class="btn btn-sm" id="qr-batch-mode-gen">📦 批量生成（CSV / 每行一条）</button>
        </div>
        <div id="qr-batch-decode-pane" class="qr-batch-sub active">
          <div class="qr-upload-zone" id="qr-batch-zone">
            <div class="upload-zone-content">
              <div class="upload-icon">🗂</div>
              <p>拖入或选择多张二维码图片（一次可几十张）</p>
              <button class="btn btn-primary" id="qr-batch-pick">选择多张图片</button>
              <input type="file" id="qr-batch-input" accept="image/*" multiple hidden />
            </div>
          </div>
          <div class="qr-batch-summary" id="qr-batch-summary"></div>
          <div class="qr-batch-list" id="qr-batch-list"></div>
          <div class="qr-result-actions" id="qr-batch-actions" style="display:none;">
            <button class="btn btn-sm" id="qr-batch-copy">📋 复制全部</button>
            <button class="btn btn-sm" id="qr-batch-csv">⬇ 导出 CSV</button>
            <button class="btn btn-sm" id="qr-batch-clear">🗑 清空</button>
          </div>
        </div>
        <div id="qr-batch-gen-pane" class="qr-batch-sub">
          <div class="qr-batch-gen-input">
            <textarea id="qr-batch-lines" rows="6" placeholder="每行一条内容，例如：&#10;https://example.com/a&#10;https://example.com/b&#10;也可以直接上传 CSV / TXT（Excel 里另存为 CSV 即可）"></textarea>
            <div class="qr-actions">
              <button class="btn btn-sm" id="qr-batch-file-pick">📄 上传 CSV / TXT</button>
              <input type="file" id="qr-batch-file" accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
              <label class="qr-inline-check"><input type="checkbox" id="qr-batch-skip-head" /> 首行是表头，跳过</label>
              <label class="qr-inline-check">文件名前缀：<input type="text" id="qr-batch-prefix" value="qr" style="width:70px" /></label>
            </div>
            <p class="qr-hint">样式 / 颜色 / 容错 / 输出格式**跟随"二维码"标签页的设置**；最多 300 条。</p>
          </div>
          <div class="qr-actions">
            <button class="btn btn-primary" id="qr-batch-gen-btn">📦 生成并打包 ZIP</button>
            <span class="qr-hint" id="qr-batch-gen-hint"></span>
          </div>
          <div class="qr-batch-preview" id="qr-batch-preview"></div>
          <div class="qr-result-actions" id="qr-batch-gen-actions" style="display:none;">
            <button class="btn btn-sm" id="qr-batch-zip-again">⬇ 再下一次 ZIP</button>
            <button class="btn btn-sm" id="qr-batch-gen-clear">🗑 清空预览</button>
          </div>
        </div>
        <div id="qr-batch-scan-pane" class="qr-batch-sub">
          <video id="qr-scan-video" playsinline muted class="qr-scan-video"></video>
          <div class="qr-actions">
            <button class="btn btn-primary" id="qr-scan-toggle">▶ 开始连续扫码</button>
            <span class="qr-hint" id="qr-scan-hint">对准二维码即可：扫到就自动记一条并继续扫（相同内容 3 秒内只记一次）</span>
          </div>
          <div class="qr-batch-summary" id="qr-scan-summary"></div>
          <div class="qr-batch-list" id="qr-scan-list"></div>
          <div class="qr-result-actions" id="qr-scan-actions" style="display:none;">
            <button class="btn btn-sm" id="qr-scan-copy">📋 复制全部</button>
            <button class="btn btn-sm" id="qr-scan-clear">🗑 清空</button>
          </div>
        </div>
      </div>
      <!-- 活码：短链 + 扫码统计（2026-10-13）-->
      <div class="qr-panel" id="qr-shortlink">
        <div class="qr-batch-gen-input">
          <label class="qr-inline-check" style="display:block;margin-bottom:6px;">目标链接 / 文本（二维码里放短链，之后改目标不用重印）</label>
          <textarea id="sl-target" rows="3" placeholder="https://example.com/very/long/url… 或一段文字"></textarea>
          <div class="qr-actions">
            <label class="qr-inline-check">名称（可选）：<input type="text" id="sl-name" placeholder="例如：门店A海报" style="width:160px" /></label>
            <button class="btn btn-primary" id="sl-create">🔗 生成活码</button>
            <span class="qr-hint" id="sl-hint"></span>
          </div>
        </div>

        <div id="sl-result" style="display:none;">
          <div class="qr-result">
            <img id="sl-qr" class="qr-img" alt="活码二维码" />
            <div class="qr-result-actions">
              <input type="text" id="sl-url" readonly style="flex:1;min-width:220px" />
              <button class="btn btn-sm" id="sl-copy">📋 复制短链</button>
              <button class="btn btn-sm" id="sl-download">⬇ 下载二维码</button>
            </div>
          </div>
        </div>

        <div class="qr-actions" style="margin-top:14px;">
          <button class="btn btn-sm" id="sl-refresh">🔄 刷新列表</button>
          <span class="qr-hint">列表 / 统计 / 删除都只认本机标识，别人看不到你的活码</span>
        </div>
        <div class="qr-batch-list" id="sl-list"></div>
        <div id="sl-stats" class="sl-stats"></div>
      </div>
      <div class="qr-panel" id="qr-file">
        <div class="qr-upload-zone" id="qr-file-zone">
          <div class="upload-zone-content">
            <div class="upload-zone-icon">📁</div>
            <p>拖拽文件到此处，或点击上传</p>
            <p class="upload-zone-hint">生成可扫码访问的「文件活码」（≤50MB，手机扫码即可打开/下载）</p>
            <button class="btn btn-primary" id="qr-file-pick">选择文件</button>
          </div>
          <input type="file" id="qr-file-input2" hidden />
        </div>
        <div class="qr-result" id="qr-file-result" style="display:none;">
          <img id="qr-file-img" class="qr-img" alt="文件二维码" />
          <div class="qr-link-box">
            <span id="qr-file-link" class="qr-link" title="手机扫码访问此链接"></span>
            <button class="btn btn-sm" id="qr-file-copy">📋 复制链接</button>
          </div>
          <div class="qr-result-actions">
            <button class="btn btn-sm" id="qr-file-download">⬇ 下载二维码</button>
            <button class="btn btn-sm" id="qr-file-reset">🔄 再生成</button>
          </div>
          <div class="qr-hint" id="qr-file-hint"></div>
        </div>
      </div>

      <!-- 记录 -->
      <div class="qr-panel" id="qr-records">
        <div class="qr-records-head">
          <span>📑 历史记录（保存 24 小时）</span>
          <button class="btn btn-sm btn-danger" id="qr-clear-records">清空</button>
        </div>
        <div class="qr-records-list" id="qr-records-list">
          <div class="qr-records-empty">暂无记录，去生成或解码一条吧～</div>
        </div>
      </div>

      <!-- 扫码测试：用例库 ↔ 测试码对应，点码图全屏展示供扫码枪/手机实测 -->
      <div class="qr-panel" id="qr-scantest">
        <div class="qr-scantest-bar">
          <div class="qr-scantest-tip">
            <b>扫码测试台</b>
            <span class="qr-hint">111 条扫码用例 · 632 个测试码，码值与用例一一对应；点码图可全屏展示，扫码枪/手机直接扫</span>
          </div>
          <a class="btn btn-sm" href="/scan-test/" target="_blank" rel="noopener">↗ 新窗口打开</a>
        </div>
        <iframe id="qr-scantest-frame" class="qr-scantest-frame" data-src="/scan-test/index.html"
          title="扫码测试台" allowfullscreen allow="fullscreen; clipboard-write"></iframe>
      </div>

      <!-- 2026-10-21：单独显示二维码（全屏只看二维码，可指定显示大小） -->
      <div class="qr-zoom" id="qr-zoom" aria-hidden="true">
        <button type="button" class="qr-zoom-close" id="qr-zoom-close" title="关闭（Esc）">✕</button>
        <div class="qr-zoom-stage" id="qr-zoom-stage">
          <div class="qr-zoom-frame" id="qr-zoom-frame">
            <img id="qr-zoom-img" class="qr-zoom-img" alt="二维码" />
          </div>
        </div>
        <div class="qr-zoom-bar">
          <button type="button" class="btn btn-sm" id="qr-zoom-back">← 返回</button>
          <span class="qr-zoom-title">单独显示</span>
          <label>大小
            <input type="range" id="qr-zoom-range" min="128" max="1024" step="8" value="512" />
          </label>
          <label><input type="number" id="qr-zoom-num" min="32" max="1024" step="8" value="512" /> px</label>
          <button type="button" class="btn btn-sm" id="qr-zoom-fit">适应屏幕</button>
          <label title="按「物理尺寸」设置显示真实大小；首次需用银行卡短边校准屏幕"><input type="checkbox" id="qr-zoom-phys" /> 按物理尺寸</label>
          <button type="button" class="btn btn-sm" id="qr-zoom-calib">校准屏幕</button>
          <span class="qr-zoom-note" id="qr-zoom-phys-note"></span>
          <span class="qr-zoom-note" id="qr-zoom-note">屏幕像素大小（不是打印物理尺寸）</span>
        </div>
      </div>

      <!-- 2026-10-21：整屏背景图导出（二维码保持显示大小，其余填背景色，相册/壁纸用） -->
      <div class="qr-bg" id="qr-bg" aria-hidden="true">
        <div class="qr-bg-box">
          <h3>导出整屏背景图</h3>
          <p id="qr-bg-desc"></p>
          <div class="qr-bg-row">
            <label>背景色 <input type="color" id="qr-bg-color" value="#ffffff" /></label>
            <button type="button" class="btn btn-sm" id="qr-bg-white">纯白</button>
            <button type="button" class="btn btn-sm" id="qr-bg-black">纯黑</button>
          </div>
          <div class="qr-bg-actions">
            <button type="button" class="btn btn-sm btn-primary" id="qr-bg-download">下载 PNG</button>
            <button type="button" class="btn btn-sm" id="qr-bg-cancel">取消</button>
          </div>
        </div>
      </div>

      <!-- 2026-10-21：屏幕校准（物体比对 / 按屏幕对角线推算），用于「按物理尺寸显示」 -->
      <div class="qr-calib" id="qr-calib" aria-hidden="true">
        <div class="qr-calib-box">
          <h3>校准屏幕</h3>
          <label class="qr-calib-mode-label">校准方式：
            <select id="qr-calib-mode">
              <option value="object" selected>物体比对（银行卡 / 硬币，最准）</option>
              <option value="screen">按屏幕尺寸推算（输入对角线英寸）</option>
            </select>
          </label>
          <div class="qr-calib-group" id="qr-calib-object">
            <p>把校准物贴在屏幕上，拖动滑块，让下面两条竖线正好卡住它的左右两边。</p>
            <label class="qr-calib-target-label">校准物：
              <select id="qr-calib-target">
                <option value="54" selected>银行卡 / 身份证 短边 54mm</option>
                <option value="85.6">银行卡 / 身份证 长边 85.6mm（屏幕够宽再选）</option>
                <option value="25">1 元硬币 直径 25mm</option>
              </select>
            </label>
            <div class="qr-calib-stage">
              <div class="qr-calib-bar" id="qr-calib-bar"></div>
            </div>
            <label class="qr-calib-range-label">宽度
              <input type="range" id="qr-calib-range" min="80" max="600" step="1" value="204" />
            </label>
            <div class="qr-calib-value" id="qr-calib-value"></div>
          </div>
          <div class="qr-calib-group" id="qr-calib-screen" style="display:none;">
            <p>不知道屏幕对角线时，可在「设置 → 关于手机」或电脑显示器参数里查（如 6.1、6.7、15.6、24）。浏览器缩放请保持 100%。</p>
            <label class="qr-calib-diag-label">屏幕对角线：
              <input type="number" id="qr-calib-diag" min="3" max="120" step="0.1" placeholder="如 6.1" list="qr-calib-diag-list" /> 英寸
            </label>
            <datalist id="qr-calib-diag-list">
              <option value="5.5"></option><option value="6.1"></option><option value="6.5"></option>
              <option value="6.7"></option><option value="6.8"></option><option value="11"></option>
              <option value="13.3"></option><option value="15.6"></option><option value="24"></option>
            </datalist>
            <div class="qr-calib-value" id="qr-calib-screen-value"></div>
          </div>
          <div class="qr-calib-actions">
            <button type="button" class="btn btn-sm btn-primary" id="qr-calib-save">保存校准</button>
            <button type="button" class="btn btn-sm" id="qr-calib-cancel">取消</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Tab 切换
    document.querySelectorAll('.qr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.qr-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`qr-${tab.dataset.tab}`).classList.add('active');
        // 扫码测试台按需加载，避免打开二维码页就预载 632 张码图
        if (tab.dataset.tab === 'scantest') {
          const f = document.getElementById('qr-scantest-frame');
          if (f && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
        }
      });
    });

    // 生成二维码
    document.getElementById('qr-gen-btn').addEventListener('click', () => this.generate());
    document.getElementById('qr-download').addEventListener('click', () => this.downloadCurrent());
    document.getElementById('qr-save-gen').addEventListener('click', () => this.saveRecord(this._lastText, 'generate'));

    // 2026-10-21：物理尺寸控件 —— 口径切换显隐两组，任意输入实时刷新提示
    // 2026-10-21：输出尺寸支持自定义像素（下载文件就是这么多 px，与「显示大小」无关）
    document.getElementById('qr-size')?.addEventListener('change', () => {
      const sel = document.getElementById('qr-size');
      const wrap = document.getElementById('qr-size-custom-wrap');
      if (wrap) wrap.style.display = sel?.value === 'custom' ? '' : 'none';
    });
    document.getElementById('qr-size-mode')?.addEventListener('change', () => this._applySizeMode());
    ['qr-phys-value', 'qr-phys-unit', 'qr-phys-basis', 'qr-phys-dpi'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this._refreshPhysHint());
      el.addEventListener('change', () => this._refreshPhysHint());
    });
    document.querySelectorAll('[data-qr-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [val, unit] = String(btn.dataset.qrPreset || '').split(',');
        const valueEl = document.getElementById('qr-phys-value');
        const unitEl = document.getElementById('qr-phys-unit');
        if (valueEl && val) valueEl.value = val;
        if (unitEl && unit) unitEl.value = unit;
        this._refreshPhysHint();
      });
    });
    document.getElementById('qr-phys-preview')?.addEventListener('change', (e) => {
      if (e.target.checked && !this._screenMmPerPx()) {
        e.target.checked = false;
        this._physPreviewPending = true;
        this.toast?.show('先校准屏幕，再按物理尺寸预览', 'error');
        this._openQrCalib();
        return;
      }
      this._applyDisplaySize();
    });
    // 文本 / 容错会改变模块数（总模块数 = 整码 / 单模块），提示跟着更新
    const physHintOnChange = () => { if (document.getElementById('qr-size-mode')?.value === 'phys') this._refreshPhysHint(); };
    document.getElementById('qr-text')?.addEventListener('input', physHintOnChange);
    document.getElementById('qr-ecc')?.addEventListener('change', physHintOnChange);
    this._applySizeMode();

    // 2026-10-21：预览显示大小 —— 只改页面上 <img> 的显示尺寸，不动下载像素/打印尺寸
    document.getElementById('qr-display-size')?.addEventListener('change', () => {
      this._applyDisplaySize();
      this._saveDisplaySize();
    });
    document.getElementById('qr-display-custom')?.addEventListener('input', () => {
      this._applyDisplaySize();
      this._saveDisplaySize();
    });
    this._restoreDisplaySize();

    // 2026-10-21：单独显示二维码 —— 全屏只看二维码，滑块/数字框指定显示大小（px）
    document.getElementById('qr-zoom-open')?.addEventListener('click', () => this._openQrZoom());
    document.getElementById('qr-img')?.addEventListener('click', () => this._openQrZoom());
    document.getElementById('qr-zoom-close')?.addEventListener('click', () => this._closeQrZoom());
    document.getElementById('qr-zoom-back')?.addEventListener('click', () => this._closeQrZoom());
    document.getElementById('qr-zoom')?.addEventListener('click', (e) => {
      if (e.target.id === 'qr-zoom' || e.target.id === 'qr-zoom-stage') this._closeQrZoom();
    });
    document.getElementById('qr-zoom-range')?.addEventListener('input', (e) => this._setDisplaySize(e.target.value));
    document.getElementById('qr-zoom-num')?.addEventListener('input', (e) => this._setDisplaySize(e.target.value));
    document.getElementById('qr-zoom-fit')?.addEventListener('click', () => this._fitQrZoom());
    // 2026-10-21：按物理尺寸显示（需先用银行卡短边 54mm 校准屏幕）
    document.getElementById('qr-zoom-phys')?.addEventListener('change', (e) => this._toggleQrPhys(e.target.checked));
    document.getElementById('qr-zoom-calib')?.addEventListener('click', () => this._openQrCalib());
    document.getElementById('qr-calib-range')?.addEventListener('input', () => this._updateCalibBar());
    document.getElementById('qr-calib-target')?.addEventListener('change', () => this._updateCalibBar());
    document.getElementById('qr-calib-mode')?.addEventListener('change', () => this._toggleCalibMode());
    document.getElementById('qr-calib-diag')?.addEventListener('input', () => this._updateCalibScreenPreview());
    document.getElementById('qr-calib-save')?.addEventListener('click', () => this._saveQrCalib());
    document.getElementById('qr-calib-cancel')?.addEventListener('click', () => this._closeQrCalib());
    document.getElementById('qr-calib')?.addEventListener('click', (e) => {
      if (e.target.id === 'qr-calib') this._closeQrCalib();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.getElementById('qr-bg')?.classList.contains('open')) { this._closeQrBg(); return; }
      if (document.getElementById('qr-calib')?.classList.contains('open')) { this._closeQrCalib(); return; }
      this._closeQrZoom();
    });
    // 浏览器 / 手机返回键：只退出「单独显示」，不离开当前页
    if (!window.__pkQrZoomPop) {
      window.__pkQrZoomPop = true;
      window.addEventListener('popstate', () => {
        const box = document.getElementById('qr-zoom');
        if (!box || !box.classList.contains('open')) return;
        box.classList.remove('open');
        box.setAttribute('aria-hidden', 'true');
        syncQrBodyLock();
      });
    }
    // 2026-10-21：整屏背景图（二维码保持显示大小，其余填白/黑背景，相册/壁纸用）
    document.getElementById('qr-bg-open')?.addEventListener('click', () => this._openQrBg());
    document.getElementById('qr-bg-cancel')?.addEventListener('click', () => this._closeQrBg());
    document.getElementById('qr-bg-download')?.addEventListener('click', () => this._downloadQrBg());
    document.getElementById('qr-bg')?.addEventListener('click', (e) => {
      if (e.target.id === 'qr-bg') this._closeQrBg();
    });
    document.getElementById('qr-bg-white')?.addEventListener('click', () => {
      const c = document.getElementById('qr-bg-color'); if (c) c.value = '#ffffff';
    });
    document.getElementById('qr-bg-black')?.addEventListener('click', () => {
      const c = document.getElementById('qr-bg-color'); if (c) c.value = '#000000';
    });

    // 生成一维码
    document.getElementById('barcode-gen-btn').addEventListener('click', () => this.generateBarcode());
    document.getElementById('barcode-download').addEventListener('click', () => this.downloadCurrent());
    document.getElementById('barcode-save').addEventListener('click', () => this.saveRecord(this._lastText, 'barcode'));

    // 解码上传
    const zone = document.getElementById('qr-upload-zone');
    const fileInput = document.getElementById('qr-file-input');
    document.getElementById('qr-pick').addEventListener('click', () => fileInput.click());
    zone.addEventListener('click', (e) => { if (e.target === zone || e.target.closest('.upload-zone-content')) fileInput.click(); });
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) this.handleDecodeFile(e.target.files[0]); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.handleDecodeFile(e.dataTransfer.files[0]);
    });

    document.getElementById('qr-copy-decode').addEventListener('click', () => {
      if (this._lastDecoded) this.copyText(this._lastDecoded);
    });
    document.getElementById('qr-save-decode').addEventListener('click', () => this.saveRecord(this._lastDecoded, 'decode'));

    // 换一张：重置上传区，可继续解码
    document.getElementById('qr-repick').addEventListener('click', () => {
      const fi = document.getElementById('qr-file-input');
      if (fi) fi.value = ''; // 允许重复选同一文件
      document.getElementById('qr-upload-zone').style.display = '';
      document.getElementById('qr-decode-preview').style.display = 'none';
    });

    // 文件活码
    const fzone = document.getElementById('qr-file-zone');
    const fInput = document.getElementById('qr-file-input2');
    document.getElementById('qr-file-pick').addEventListener('click', () => fInput.click());
    fzone.addEventListener('click', (e) => { if (e.target === fzone || e.target.closest('.upload-zone-content')) fInput.click(); });
    fInput.addEventListener('change', (e) => { if (e.target.files[0]) this.handleFileUpload(e.target.files[0]); });
    fzone.addEventListener('dragover', (e) => { e.preventDefault(); fzone.classList.add('dragover'); });
    fzone.addEventListener('dragleave', () => fzone.classList.remove('dragover'));
    fzone.addEventListener('drop', (e) => {
      e.preventDefault(); fzone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.handleFileUpload(e.dataTransfer.files[0]);
    });
    document.getElementById('qr-file-copy').addEventListener('click', () => this.copyText(this._lastFileUrl || ''));
    document.getElementById('qr-file-download').addEventListener('click', () => this.downloadCurrent());
    document.getElementById('qr-file-reset').addEventListener('click', () => this.resetFilePanel());

    // 清空记录
    document.getElementById('qr-clear-records').addEventListener('click', () => this.clearRecords());
  }

  // =================== 生成 ===================
  async generate() {
    const text = document.getElementById('qr-text').value.trim();
    const hint = document.getElementById('qr-gen-hint');
    if (!text) { this.toast?.show('请输入文字或数字', 'error'); return; }
    hint.textContent = '生成中…';
    const size = this._outputSizePx();
    // 2026-10-21：尺寸口径（px / 物理尺寸），phys 模式下用物理参数渲染并写 DPI 元数据
    const sizeMode = document.getElementById('qr-size-mode')?.value === 'phys' ? 'phys' : 'px';
    let phys = null;
    if (sizeMode === 'phys') {
      const rawPhys = Number(document.getElementById('qr-phys-value')?.value);
      if (!(rawPhys > 0)) {
        hint.textContent = '';
        this.toast?.show('请输入大于 0 的物理尺寸', 'error');
        return;
      }
      phys = { ...this._physSettings(), value: rawPhys };
    }
    const dark = document.getElementById('qr-dark').value;
    const light = document.getElementById('qr-light').value;
    const ecc = document.getElementById('qr-ecc')?.value || 'M';
    const style = document.getElementById('qr-style')?.value || 'square';
    const eye = document.getElementById('qr-eye')?.value || 'square';
    const format = document.getElementById('qr-format')?.value || 'png';
    const margin = Number(document.getElementById('qr-margin')?.value ?? 4) || 0;
    const useGradient = Boolean(document.getElementById('qr-gradient')?.checked);
    const dark2 = document.getElementById('qr-dark2')?.value || dark;
    try {
      /* 2026-10-13：改成**客户端**渲染（原来走后端 /api/qr/generate）。
         好处：① 不占服务器配额、零延迟；② 可以本地做样式/格式（后端只有纯黑方块 PNG）。
         qrcode 包提供 create() 拿到模块矩阵，剩下用 canvas 自己画。 */
      const out = await this._renderQr({ text, size, sizeMode, phys, margin, dark, light, ecc, style, eye, format, useGradient, dark2 });
      this._lastText = text;
      this._lastDataUrl = out.dataUrl;
      this._lastExt = out.ext;
      this._lastBarcode = false;   // 切回普通二维码时别沿用一维码的下载前缀
      this._lastPhys = out.phys || null;   // 物理尺寸信息（下载文件名 / 提示用）
      this._lastModules = out.modules || 21;
      this._lastTotal = out.total || (this._lastModules + margin * 2);
      const img = document.getElementById('qr-img');
      img.src = out.dataUrl;
      img.dataset.filename = out.phys
        ? `qrcode-${out.phys.label}.${out.ext}`
        : `qrcode-${Date.now()}.${out.ext}`;
      this._applyDisplaySize();   // 物理预览开启时按新的模块数/物理尺寸重算预览大小
      const dl = document.getElementById('qr-download');
      if (dl) dl.textContent = `⬇ 下载 ${out.ext.toUpperCase()}`;
      document.getElementById('qr-gen-result').style.display = '';
      hint.textContent = out.note || '';
    } catch (e) {
      hint.textContent = '';
      /* 生成失败时把上一次的结果清干净（2026-10-08 审计）：
         原来只弹 toast，旧的二维码还留在结果区，点下载会下到旧图。 */
      this._lastText = '';
      this._lastDataUrl = '';
      this._lastBarcode = false;
      this._lastPhys = null;
      const oldImg = document.getElementById('qr-img');
      if (oldImg) { oldImg.removeAttribute('src'); delete oldImg.dataset.filename; }
      const box = document.getElementById('qr-gen-result');
      if (box) box.style.display = 'none';
      this.toast?.show(e.message || '生成失败', 'error');
    }
  }

  /**
   * 画二维码：支持 经典方块 / 圆角方块 / 圆点（太阳码风格）、方形或圆形定位点、线性渐变，
   * 以及 PNG / JPG / WebP / SVG 四种输出格式。
   * 说明：这是"太阳码**风格**"的美化二维码（圆形点阵+圆形定位点），
   *      扫码内容由你填写；微信官方小程序码（真·太阳码）必须调微信接口，需要小程序 AppID/Secret。
   */
  async _renderQr({ text, size, sizeMode = 'px', phys = null, margin: marginOpt = 4, dark, light, ecc, style, eye, format, useGradient, dark2 }) {
    const QRCode = await this._loadQrLib();
    const qr = QRCode.create(text, { errorCorrectionLevel: ecc });
    const n = qr.modules.size;
    const data = qr.modules.data;          // 位矩阵：data[y * n + x]
    // 2026-10-21：白边（留白）可调，默认 0 不再强行加 4 模块白边；打印/深底可手动选 2/4
    const margin = Math.min(8, Math.max(0, Math.round(Number(marginOpt))));
    const total = n + margin * 2;
    // 2026-10-21：物理尺寸口径 → 用几何换算得到画布像素；px 模式 geom 为 null，完全走原有逻辑
    const geom = (sizeMode === 'phys' && phys && Number(phys.value) > 0) ? this._physGeometry(n, phys) : null;
    const isFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

    const paint = (ctx, cell, fill) => {
      const r = cell * 0.58;  // 略微重叠：孤立圆点(0.44/0.5)实测解码器二值化后读不出来，重叠才稳
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!data[y * n + x] || isFinder(x, y)) continue;
          const cx = (x + margin) * cell, cy = (y + margin) * cell;
          ctx.fillStyle = fill;
          /* 时序图案（x==6 或 y==6）必须保持实心直角方块：
             圆点/圆角会把它切碎，解码器定位失败 —— 2026-10-13 实测 dots 样式扫不出来就是这个原因。 */
          const isTiming = (x === 6 || y === 6);
          if (isTiming || style === 'square') {
            ctx.fillRect(cx, cy, cell, cell);
          } else if (style === 'dots') {
            ctx.beginPath();
            ctx.arc(cx + cell / 2, cy + cell / 2, r, 0, Math.PI * 2);
            ctx.fill();
          } else if (style === 'rounded') {
            const rr = cell * 0.3;
            ctx.beginPath();
            ctx.moveTo(cx + rr, cy);
            ctx.arcTo(cx + cell, cy, cx + cell, cy + cell, rr);
            ctx.arcTo(cx + cell, cy + cell, cx, cy + cell, rr);
            ctx.arcTo(cx, cy + cell, cx, cy, rr);
            ctx.arcTo(cx, cy, cx + cell, cy, rr);
            ctx.fill();
          } else {
            ctx.fillRect(cx, cy, cell, cell);
          }
        }
      }
      // 三个定位点（眼）
      const drawEye = (ox, oy) => {
        const px = (ox + margin) * cell, py = (oy + margin) * cell;
        ctx.fillStyle = fill;
        if (eye === 'circle') {
          const ring = (cx, cy, d, color) => { ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
          ring(px + cell * 3.5, py + cell * 3.5, cell * 7, fill);
          ring(px + cell * 3.5, py + cell * 3.5, cell * 5, light);
          ring(px + cell * 3.5, py + cell * 3.5, cell * 3, fill);
        } else {
          ctx.fillRect(px, py, cell * 7, cell * 7);
          ctx.fillStyle = light;
          ctx.fillRect(px + cell, py + cell, cell * 5, cell * 5);
          ctx.fillStyle = fill;
          ctx.fillRect(px + cell * 2, py + cell * 2, cell * 3, cell * 3);
        }
      };
      drawEye(0, 0);
      drawEye(n - 7, 0);
      drawEye(0, n - 7);
    };

    if (format === 'svg') {
      const cell = 10;
      const px = total * cell;
      // 2026-10-21：物理尺寸模式把 width/height 写成 mm（viewBox 保持像素单位），
      // 这样 SVG 按 100% 打印出来就是真实物理尺寸。
      const sizeAttr = geom ? `${geom.wholeMm.toFixed(3)}mm` : `${px}`;
      let body = '';
      const fill = useGradient ? 'url(#pkgrad)' : dark;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!data[y * n + x] || isFinder(x, y)) continue;
          const cx = (x + margin) * cell, cy = (y + margin) * cell;
          if (x === 6 || y === 6 || style === 'square') body += `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" fill="${fill}"/>`;
          else if (style === 'dots') body += `<circle cx="${cx + cell / 2}" cy="${cy + cell / 2}" r="${cell * 0.58}" fill="${fill}"/>`;
          else if (style === 'rounded') body += `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="${cell * 0.3}" fill="${fill}"/>`;
          else body += `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" fill="${fill}"/>`;
        }
      }
      const eyeSvg = (ox, oy) => {
        const x = (ox + margin) * cell, y = (oy + margin) * cell;
        if (eye === 'circle') {
          return `<circle cx="${x + cell * 3.5}" cy="${y + cell * 3.5}" r="${cell * 3.5}" fill="${fill}"/>`
            + `<circle cx="${x + cell * 3.5}" cy="${y + cell * 3.5}" r="${cell * 2.5}" fill="${light}"/>`
            + `<circle cx="${x + cell * 3.5}" cy="${y + cell * 3.5}" r="${cell * 1.5}" fill="${fill}"/>`;
        }
        return `<rect x="${x}" y="${y}" width="${cell * 7}" height="${cell * 7}" fill="${fill}"/>`
          + `<rect x="${x + cell}" y="${y + cell}" width="${cell * 5}" height="${cell * 5}" fill="${light}"/>`
          + `<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" fill="${fill}"/>`;
      };
      body += eyeSvg(0, 0) + eyeSvg(n - 7, 0) + eyeSvg(0, n - 7);
      const gradDef = useGradient
        ? `<defs><linearGradient id="pkgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${dark2}"/></linearGradient></defs>`
        : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeAttr}" height="${sizeAttr}" viewBox="0 0 ${px} ${px}">`
        + gradDef + `<rect width="${px}" height="${px}" fill="${light}"/>` + body + '</svg>';
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const note = geom ? this._physNote('svg', geom) : 'SVG 是矢量图，放大不糊';
      return { dataUrl, ext: 'svg', note, phys: geom || null, modules: n, total };
    }

    // 2026-10-21：物理尺寸模式用几何换算出的 px（每模块整数像素）；px 模式仍是原来的 size
    const outPx = geom ? geom.px : size;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = outPx;
    const ctx = canvas.getContext('2d');
    const cell = outPx / total;
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, outPx, outPx);
    let fill = dark;
    if (useGradient) {
      const g = ctx.createLinearGradient(0, 0, outPx, outPx);
      g.addColorStop(0, dark);
      g.addColorStop(1, dark2);
      fill = g;
    }
    paint(ctx, cell, fill);
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format] || 'image/png';
    let dataUrl = canvas.toDataURL(mime, 0.92);
    // 只有 PNG 能写 pHYs DPI 元数据；JPG/WebP 不写，note 里说明
    if (geom && format === 'png') dataUrl = pngDataUrlWithDpi(dataUrl, geom.dpi);
    const note = geom ? this._physNote(format, geom) : (format === 'jpg' ? 'JPG 不支持透明，背景已填色' : '');
    return { dataUrl, ext: format, note, phys: geom || null, modules: n, total };
  }

  /* ==================== 物理尺寸（2026-10-21）====================
     打印店说的 10mil/20mil 是「单模块」尺寸；也支持按「整码宽」反推。
     这里负责：控件读取、口径切换显隐、实时提示、结果 note、下载文件名。 */
  _loadQrLib() {
    // qrcode 包原来只在生成时动态 import；物理尺寸提示要实时算模块数，这里缓存一份
    if (!this._qrLibPromise) {
      this._qrLibPromise = import('qrcode').then((m) => {
        this._qrLib = m.default || m;
        return this._qrLib;
      });
    }
    return this._qrLibPromise;
  }

  _physGeometry(n, opts = {}) {
    return qrPhysGeometry({ modules: n, ...opts });
  }

  _physSettings() {
    const raw = Number(document.getElementById('qr-phys-value')?.value);
    const marginRaw = Number(document.getElementById('qr-margin')?.value);
    return {
      value: Number.isFinite(raw) && raw > 0 ? raw : 10,
      unit: document.getElementById('qr-phys-unit')?.value || 'mil',
      basis: document.getElementById('qr-phys-basis')?.value || 'module',
      dpi: Number(document.getElementById('qr-phys-dpi')?.value) || 600,
      margin: Number.isFinite(marginRaw) ? marginRaw : 4,
    };
  }

  _applySizeMode() {
    const mode = document.getElementById('qr-size-mode')?.value === 'phys' ? 'phys' : 'px';
    const pxWrap = document.getElementById('qr-size-px-wrap');
    const physWrap = document.getElementById('qr-size-phys-wrap');
    // 内联 display 直接切换，避免和 .qr-options 的 flex 布局打架
    if (pxWrap) pxWrap.style.display = mode === 'phys' ? 'none' : '';
    if (physWrap) physWrap.style.display = mode === 'phys' ? '' : 'none';
    this._refreshPhysHint();
  }

  _physPreviewModules() {
    const lib = this._qrLib;
    if (!lib) return 21;   // 库还没加载：按 version 1（21 模块，total=29）预览，加载完成后自动刷新
    const text = (document.getElementById('qr-text')?.value || '').trim() || 'PixelKit';
    const ecc = document.getElementById('qr-ecc')?.value || 'M';
    try { return lib.create(text, { errorCorrectionLevel: ecc }).modules.size; } catch { return 21; }
  }

  _physHintText(geom) {
    // 形如：整码 7.366 mm（290 mil）· 模块 0.254 mm · 174×174 px @ 600 DPI（6 px/模块）
    const whole = String(Number(geom.wholeMm.toFixed(3)));
    const wholeMil = Math.round(geom.wholeMm / 0.0254);
    const mod = String(Number(geom.moduleMm.toFixed(3)));
    const base = `整码 ${whole} mm（${wholeMil} mil）· 模块 ${mod} mm · ${geom.px}×${geom.px} px @ ${geom.dpi} DPI（${geom.modulePx} px/模块）`;
    return geom.warnings.length ? `${base}；⚠ ${geom.warnings.join('；')}` : base;
  }

  _refreshPhysHint() {
    const box = document.getElementById('qr-phys-hint');
    if (!box) return;
    if ((document.getElementById('qr-size-mode')?.value || 'px') !== 'phys') { box.textContent = ''; return; }
    const rawValue = Number(document.getElementById('qr-phys-value')?.value);
    if (!(rawValue > 0)) { box.textContent = '请输入大于 0 的物理尺寸'; return; }
    const geom = this._physGeometry(this._physPreviewModules(), { ...this._physSettings(), value: rawValue });
    box.textContent = this._physHintText(geom);
    // 预览按物理尺寸开启时，改 mil 值立即反映到主预览
    if (document.getElementById('qr-phys-preview')?.checked) this._applyDisplaySize();
    // 第一次切到物理尺寸时 qrcode 库可能还没加载：加载完用真实模块数再刷一次
    if (!this._qrLib && !this._physHintPending) {
      this._physHintPending = true;
      this._loadQrLib().then(() => {
        this._physHintPending = false;
        this._refreshPhysHint();
      }).catch(() => { this._physHintPending = false; });
    }
  }

  _physNote(format, geom) {
    // 生成成功后的 #qr-gen-hint：含物理尺寸 + DPI/格式说明（打印时知道该怎么用）
    const unitText = geom.unit === 'mil' ? 'mil' : geom.unit === 'mm' ? 'mm' : 'inch';
    const basisText = geom.basis === 'whole' ? `整码宽 ${geom.value}${unitText}` : `单模块 ${geom.value}${unitText}`;
    const whole = String(Number(geom.wholeMm.toFixed(3)));
    const wholeMil = Math.round(geom.wholeMm / 0.0254);
    const detail = `${geom.px}×${geom.px} px @ ${geom.dpi} DPI（${geom.modulePx} px/模块）`;
    let tail;
    if (format === 'svg') tail = 'SVG 用 mm 物理单位输出，按 100% 打印即真实尺寸';
    else if (format === 'png') tail = `PNG 已写入 ${geom.dpi} DPI 元数据，打印按实际尺寸`;
    else tail = `${String(format).toUpperCase()} 不含 DPI 元数据，打印时请按 ${whole}mm 设置尺寸`;
    const warn = geom.warnings.length ? `；⚠ ${geom.warnings.join('；')}` : '';
    return `已按${basisText}生成：整码 ${whole}mm（${wholeMil} mil）· ${detail} · ${tail}${warn}`;
  }

  /* ==================== 预览显示大小（2026-10-21）====================
     只改页面上 <img> 的 CSS 尺寸：下载文件仍按「输出尺寸 / 物理尺寸」生成，
     像素和打印尺寸都不变；窄屏由 CSS max-width 收窄，不撑破容器。 */
  /** 下载图片的实际像素：输出尺寸 select 或自定义输入（16–4096） */
  _outputSizePx() {
    const sel = document.getElementById('qr-size');
    if (sel?.value === 'custom') {
      const n = Math.round(Number(document.getElementById('qr-size-custom')?.value) || 512);
      return Math.min(4096, Math.max(16, n));
    }
    return Number(sel?.value) || 512;
  }

  _displaySizePx() {
    const mode = document.getElementById('qr-display-size')?.value || '256';
    if (mode !== 'custom') return Number(mode) || 256;
    const n = Math.round(Number(document.getElementById('qr-display-custom')?.value) || 256);
    return Math.min(1024, Math.max(32, n));
  }

  _applyDisplaySize() {
    const sel = document.getElementById('qr-display-size');
    const customWrap = document.getElementById('qr-display-custom-wrap');
    if (customWrap) customWrap.style.display = sel?.value === 'custom' ? '' : 'none';
    // 勾了「预览按物理尺寸」且已校准 → 主预览直接用物理像素，10/15/20mil 肉眼可见差别
    const physPreview = Boolean(document.getElementById('qr-phys-preview')?.checked) && this._screenMmPerPx() > 0;
    const px = physPreview ? this._qrExportPx() : this._displaySizePx();
    // 只调「生成结果」这几个图；解码预览、记录弹窗保持原样
    ['qr-img', 'sl-qr', 'qr-file-img'].forEach((id) => {
      const img = document.getElementById(id);
      if (!img) return;
      img.style.width = `${px}px`;
      img.style.height = 'auto';      // 保持二维码正方形比例，窄屏交给 max-width
    });
    // 单独显示开着时同步（滑块、图、数字框）；物理尺寸模式下由校准换算接管，不覆盖
    const zoom = document.getElementById('qr-zoom');
    if (zoom?.classList.contains('open') && !document.getElementById('qr-zoom-phys')?.checked) {
      this._applyZoomSize(px);
      this._syncZoomControls(px);
    }
  }

  _saveDisplaySize() {
    try {
      const sel = document.getElementById('qr-display-size');
      const custom = document.getElementById('qr-display-custom');
      localStorage.setItem('pixelkit_qr_display_size', JSON.stringify({
        mode: sel?.value || '256',
        custom: custom?.value || '256',
      }));
    } catch { /* 隐私模式 / 禁用存储时忽略 */ }
  }

  _restoreDisplaySize() {
    try {
      const raw = localStorage.getItem('pixelkit_qr_display_size');
      if (raw) {
        const saved = JSON.parse(raw) || {};
        const sel = document.getElementById('qr-display-size');
        const custom = document.getElementById('qr-display-custom');
        if (sel && ['128', '192', '256', '320', '384', '512', '640', 'custom'].includes(saved.mode)) sel.value = saved.mode;
        if (custom && saved.custom) custom.value = saved.custom;
      }
    } catch { /* ignore */ }
    this._applyDisplaySize();
  }

  /* ==================== 单独显示二维码（2026-10-21）====================
     生成后「单独显示」：全屏只看二维码 + 指定显示大小。
     · 不勾「按物理尺寸」：大小 = 屏幕 CSS 像素（32–1024），和「显示大小」共用设置；
     · 勾「按物理尺寸」：先用银行卡短边 54mm 校准屏幕得到 mm/px，再把「物理尺寸」设置
       换算成屏幕像素 —— 这是屏幕上近似 1:1 显示 10mil/20mil 的唯一办法（误差取决于校准）。 */
  _openQrZoom() {
    if (!this._lastDataUrl) { this.toast?.show('先生成二维码', 'error'); return; }
    const box = document.getElementById('qr-zoom');
    const img = document.getElementById('qr-zoom-img');
    if (!box || !img) return;
    img.src = this._lastDataUrl;
    const px = this._displaySizePx();
    this._syncZoomControls(px);
    this._applyZoomSize(px);
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    this._syncBodyLock();
    // 让浏览器 / 手机返回键只退出「单独显示」，而不是离开页面
    if (!(history.state && history.state.pkQrZoom)) {
      history.pushState({ pkQrZoom: true }, '', location.pathname + location.search + '#qr-zoom');
    }
    document.getElementById('qr-zoom-close')?.focus();
    this._refreshZoomPhys();     // 上次勾了「按物理尺寸」就继续按物理尺寸显示
  }

  _closeQrZoom(fromPop) {
    const box = document.getElementById('qr-zoom');
    if (!box || !box.classList.contains('open')) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    this._syncBodyLock();
    if (!fromPop && history.state && history.state.pkQrZoom) history.back();
  }

  _syncBodyLock() {
    syncQrBodyLock();
  }

  _syncZoomControls(px) {
    const range = document.getElementById('qr-zoom-range');
    const num = document.getElementById('qr-zoom-num');
    if (range) range.value = String(px);
    if (num && document.activeElement !== num) num.value = String(px);
  }

  _applyZoomSize(px) {
    const img = document.getElementById('qr-zoom-img');
    if (!img) return;
    img.style.width = `${px}px`;
    img.style.height = 'auto';      // 正方形按宽度走，窄屏由 CSS max-width 收
  }

  /** 单独显示里的滑块/数字框改大小：写回「显示大小」设置，主预览与单显一起变 */
  _setDisplaySize(raw) {
    if (document.getElementById('qr-zoom-phys')?.checked) return;  // 物理尺寸模式下不让滑块改写
    const n = Math.min(1024, Math.max(32, Math.round(Number(raw) || 256)));
    const sel = document.getElementById('qr-display-size');
    const custom = document.getElementById('qr-display-custom');
    if (sel) sel.value = 'custom';
    if (custom) custom.value = String(n);
    this._applyDisplaySize();   // 主预览 + 活码/文件结果 + 自定义框显隐 + 单显同步
    this._applyZoomSize(n);
    this._syncZoomControls(n);
    this._saveDisplaySize();
  }

  _fitQrZoom() {
    if (document.getElementById('qr-zoom-phys')?.checked) return;
    const px = Math.max(128, Math.min(1024, Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight * 0.72))));
    this._setDisplaySize(px);
  }

  /* ---------- 屏幕校准（银行卡短边 54mm，结果存 localStorage） ---------- */
  _screenMmPerPx() {
    const v = Number(localStorage.getItem('pixelkit_screen_mm_per_px'));
    return v > 0 ? v : 0;
  }

  _calibMm() {
    const v = Number(document.getElementById('qr-calib-target')?.value);
    return v > 0 ? v : QR_CALIB_MM;
  }

  _calibMode() {
    return document.getElementById('qr-calib-mode')?.value === 'screen' ? 'screen' : 'object';
  }

  _toggleCalibMode() {
    const mode = this._calibMode();
    const obj = document.getElementById('qr-calib-object');
    const scr = document.getElementById('qr-calib-screen');
    if (obj) obj.style.display = mode === 'screen' ? 'none' : '';
    if (scr) scr.style.display = mode === 'screen' ? '' : 'none';
    if (mode === 'screen') this._updateCalibScreenPreview();
  }

  /** 按屏幕对角线（英寸）+ screen.width/height（CSS px）推算 mm/CSS px，无需放物体 */
  _updateCalibScreenPreview() {
    const diag = Number(document.getElementById('qr-calib-diag')?.value);
    const sw = window.screen?.width || window.innerWidth;
    const sh = window.screen?.height || window.innerHeight;
    const val = document.getElementById('qr-calib-screen-value');
    if (!(diag > 0)) {
      if (val) val.textContent = `当前屏幕 ${sw}×${sh} CSS px，请输入对角线英寸（如 6.1）`;
      return 0;
    }
    const mmPerPx = diag * 25.4 / Math.hypot(sw, sh);
    if (val) {
      val.textContent = `当前屏幕 ${sw}×${sh} CSS px · ${diag}″ → 1 CSS px ≈ ${mmPerPx.toFixed(4)}mm（整屏约 ${Math.round(sw * mmPerPx)}×${Math.round(sh * mmPerPx)}mm）`;
    }
    return mmPerPx;
  }

  _openQrCalib() {
    const box = document.getElementById('qr-calib');
    if (!box) return;
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    this._toggleCalibMode();
    // 已有校准值就反推对角线预填，方便查看/微调
    const saved = this._screenMmPerPx();
    const diagEl = document.getElementById('qr-calib-diag');
    if (diagEl && saved > 0 && !diagEl.value) {
      const sw = window.screen?.width || window.innerWidth;
      const sh = window.screen?.height || window.innerHeight;
      diagEl.value = String(Number((saved * Math.hypot(sw, sh) / 25.4).toFixed(1)));
    }
    const boxEl = box.querySelector('.qr-calib-box');
    const range = document.getElementById('qr-calib-range');
    if (range) {
      // 校准条可以铺到弹窗能容纳的最大宽度（不再被固定 560px 的框住）
      const max = Math.max(160, Math.min(1400, Math.floor((boxEl?.clientWidth || window.innerWidth) - 8)));
      range.max = String(max);
      const mm = this._calibMm();
      const w = saved > 0 ? Math.round(mm / saved) : Math.round(mm / (25.4 / 96));
      range.value = String(Math.min(max, Math.max(60, w)));
    }
    this._updateCalibBar();
    this._syncBodyLock();
  }

  _closeQrCalib() {
    const box = document.getElementById('qr-calib');
    if (!box || !box.classList.contains('open')) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    this._syncBodyLock();
  }

  _updateCalibBar() {
    const w = Number(document.getElementById('qr-calib-range')?.value) || 204;
    const mm = this._calibMm();
    const bar = document.getElementById('qr-calib-bar');
    if (bar) bar.style.width = `${w}px`;
    const val = document.getElementById('qr-calib-value');
    if (val) val.textContent = `当前 ${w}px ↔ ${mm}mm（1 CSS px ≈ ${(mm / w).toFixed(4)}mm）`;
  }

  _saveQrCalib() {
    let mmPerPx = 0;
    if (this._calibMode() === 'screen') {
      mmPerPx = this._updateCalibScreenPreview();
      if (!(mmPerPx > 0)) { this.toast?.show('请输入屏幕对角线（英寸）', 'error'); return; }
    } else {
      const w = Number(document.getElementById('qr-calib-range')?.value) || 0;
      if (!(w > 40)) return;
      mmPerPx = this._calibMm() / w;
    }
    try { localStorage.setItem('pixelkit_screen_mm_per_px', String(mmPerPx)); } catch { /* ignore */ }
    this._closeQrCalib();
    this.toast?.show('屏幕已校准', 'success');
    if (this._physPreviewPending) {
      this._physPreviewPending = false;
      const cb = document.getElementById('qr-phys-preview');
      if (cb) cb.checked = true;
      this._applyDisplaySize();
    }
    this._refreshZoomPhys();
  }

  /* ---------- 单独显示：按物理尺寸（校准后把 mil/mm 换成屏幕 px） ---------- */
  _toggleQrPhys(on) {
    if (on && !this._screenMmPerPx()) {
      const cb = document.getElementById('qr-zoom-phys');
      if (cb) cb.checked = false;
      this.toast?.show('先校准屏幕，再按物理尺寸显示', 'error');
      this._openQrCalib();
      return;
    }
    this._refreshZoomPhys();
  }

  _refreshZoomPhys() {
    const cb = document.getElementById('qr-zoom-phys');
    const on = !!cb?.checked;
    const range = document.getElementById('qr-zoom-range');
    const num = document.getElementById('qr-zoom-num');
    const fit = document.getElementById('qr-zoom-fit');
    if (range) range.disabled = on;
    if (num) num.disabled = on;
    if (fit) fit.disabled = on;
    const note = document.getElementById('qr-zoom-phys-note');
    if (!on) {
      if (note) { note.textContent = ''; note.classList.remove('is-warn'); }
      this._applyZoomSize(this._displaySizePx());
      return;
    }
    const mmPerPx = this._screenMmPerPx();
    if (!mmPerPx) { if (cb) cb.checked = false; this._applyZoomSize(this._displaySizePx()); return; }
    const total = this._lastTotal || ((this._lastModules || 21) + 8);
    const s = this._physSettings();
    const unitMm = { mil: 0.0254, mm: 1, inch: 25.4 }[s.unit] || 0.0254;
    const inputMm = Math.max(0, Number(s.value) || 0) * unitMm;
    const wholeMm = s.basis === 'whole' ? inputMm : inputMm * total;
    const px = Math.max(1, Math.round(wholeMm / mmPerPx));
    this._applyZoomSize(px);
    const perModule = px / total;
    const shownPx = Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight * 0.72));
    let text = `${s.value}${s.unit}${s.basis === 'whole' ? ' 整码宽' : '/模块'} · 整码 ${wholeMm.toFixed(2)}mm · 屏幕 ${px}px`;
    let warn = false;
    if (px > shownPx) { text += ` · ⚠ 超出屏幕，已收窄到约 ${shownPx}px（不再 1:1）`; warn = true; }
    if (perModule < 1) { text += ' · ⚠ 每模块 <1 屏幕像素，无法显示/扫描'; warn = true; }
    else if (perModule < 2) { text += ' · ⚠ 每模块不足 2px，可能扫不出'; warn = true; }
    if (note) { note.textContent = text; note.classList.toggle('is-warn', warn); }
  }

  /* ---------- 整屏背景图导出（二维码保持大小，其余填背景色，相册/壁纸用） ---------- */
  _qrBgDims() {
    const dpr = window.devicePixelRatio || 1;
    return {
      dpr,
      w: Math.round((window.screen?.width || window.innerWidth) * dpr),
      h: Math.round((window.screen?.height || window.innerHeight) * dpr),
    };
  }

  /** 导出用的二维码屏幕 CSS px：物理尺寸模式且已校准时用物理尺寸，否则用「显示大小」 */
  _qrExportPx() {
    if (document.getElementById('qr-size-mode')?.value === 'phys') {
      const mmPerPx = this._screenMmPerPx();
      if (mmPerPx) {
        const total = this._lastTotal || ((this._lastModules || 21) + 8);
        const s = this._physSettings();
        const unitMm = { mil: 0.0254, mm: 1, inch: 25.4 }[s.unit] || 0.0254;
        const inputMm = Math.max(0, Number(s.value) || 0) * unitMm;
        const wholeMm = s.basis === 'whole' ? inputMm : inputMm * total;
        return Math.max(1, Math.round(wholeMm / mmPerPx));
      }
    }
    return this._displaySizePx();
  }

  _isDarkColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }

  _openQrBg() {
    if (!this._lastDataUrl) { this.toast?.show('先生成二维码', 'error'); return; }
    const box = document.getElementById('qr-bg');
    if (!box) return;
    const { w, h } = this._qrBgDims();
    const px = this._qrExportPx();
    const phys = document.getElementById('qr-size-mode')?.value === 'phys' && this._screenMmPerPx() > 0;
    const bg = document.getElementById('qr-bg-color')?.value || '#ffffff';
    const darkNote = this._isDarkColor(bg) && (Number(document.getElementById('qr-margin')?.value) || 0) === 0
      ? ' 深色背景下会自动在二维码外加 2 个模块的白边（静区），否则扫码器/解码器识别不了。'
      : '';
    const desc = document.getElementById('qr-bg-desc');
    if (desc) {
      desc.textContent = `画布 = 当前屏幕 ${w}×${h}px；二维码 ${px}px（${phys ? '按物理尺寸' : '按显示大小'}，居中），其余填充背景色。存相册全屏看时二维码保持这个大小${phys ? '（即 20mil 的物理大小）' : ''}。${darkNote}`;
    }
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    this._syncBodyLock();
  }

  _closeQrBg() {
    const box = document.getElementById('qr-bg');
    if (!box || !box.classList.contains('open')) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    this._syncBodyLock();
  }

  async _downloadQrBg() {
    if (!this._lastDataUrl) return;
    const { dpr, w, h } = this._qrBgDims();
    const px = this._qrExportPx();
    const qrDev = Math.max(1, Math.round(px * dpr));
    const img = await new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => no(new Error('二维码图片加载失败'));
      im.src = this._lastDataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const bg = document.getElementById('qr-bg-color')?.value || '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const x = Math.round((w - qrDev) / 2);
    const y = Math.round((h - qrDev) / 2);
    // 深色背景 + 无留白：二维码外面补 2 个模块白边（静区），否则解码器识别不了
    const marginVal = Number(document.getElementById('qr-margin')?.value) || 0;
    const totalModules = this._lastTotal || ((this._lastModules || 21) + 8);
    const quiet = this._isDarkColor(bg) && marginVal === 0
      ? Math.max(1, Math.round((qrDev / totalModules) * 2))
      : 0;
    if (quiet > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - quiet, y - quiet, qrDev + quiet * 2, qrDev + quiet * 2);
    }
    ctx.imageSmoothingEnabled = false;   // 保持二维码模块边缘清晰
    ctx.drawImage(img, x, y, qrDev, qrDev);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `qrcode-screen-${px}px-${String(bg).replace('#', '')}.png`;
    a.click();
    this.toast?.show(`已导出 ${w}×${h} 背景图（二维码 ${px}px）`, 'success');
    this._closeQrBg();
  }

  /* ==================== 批量解码 / 批量扫码（2026-10-13 参考草料二维码增补）====================
     全部在客户端跑（jsQR + canvas），不占服务器配额：
       · 批量解码：一次拖入多张图片，逐张解码，出表格，可复制全部 / 导出 CSV（带 BOM，Excel 不乱码）
       · 批量扫码：摄像头连续扫，扫到就记一条并继续，相同内容 3 秒内只记一次（避免一张码刷屏）*/
  initBatch() {
    const input = document.getElementById('qr-batch-input');
    const zone = document.getElementById('qr-batch-zone');
    if (!input || !zone) return;
    const pick = () => input.click();
    document.getElementById('qr-batch-pick')?.addEventListener('click', pick);
    zone.addEventListener('click', (e) => { if (e.target === zone || e.target.closest('.upload-zone-content')) pick(); });
    input.addEventListener('change', (e) => { if (e.target.files?.length) this.handleBatchDecode([...e.target.files]); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer?.files?.length) this.handleBatchDecode([...e.dataTransfer.files]);
    });
    document.getElementById('qr-batch-copy')?.addEventListener('click', () => this._copyBatch(this._batchRows || []));
    document.getElementById('qr-batch-csv')?.addEventListener('click', () => this._exportCsv(this._batchRows || []));
    document.getElementById('qr-batch-clear')?.addEventListener('click', () => { this._batchRows = []; this._renderBatch(); });
    document.getElementById('qr-batch-mode-decode')?.addEventListener('click', () => this._batchMode('decode'));
    document.getElementById('qr-batch-mode-scan')?.addEventListener('click', () => this._batchMode('scan'));
    document.getElementById('qr-batch-mode-gen')?.addEventListener('click', () => this._batchMode('gen'));
    document.getElementById('qr-scan-toggle')?.addEventListener('click', () => this._toggleScan());
    document.getElementById('qr-scan-copy')?.addEventListener('click', () => this._copyBatch(this._scanRows || []));
    document.getElementById('qr-scan-clear')?.addEventListener('click', () => { this._scanRows = []; this._renderScan(); });
    // 离开这个页面 / 切到别的标签页时关掉摄像头（这个页面没有 destroy 钩子，用观察器 + 可见性兜底）
    const page = document.getElementById('page-qr');
    if (page) {
      try {
        new MutationObserver(() => { if (!page.classList.contains('active')) this._stopScan(); })
          .observe(page, { attributes: true, attributeFilter: ['class'] });
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._stopScan(); });
    // 批量生成：上传 CSV/TXT、生成、再下一次 ZIP、清空
    const genFile = document.getElementById('qr-batch-file');
    document.getElementById('qr-batch-file-pick')?.addEventListener('click', () => genFile?.click());
    genFile?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      // .xlsx 直接解析（xlsx 本质是 zip + XML，用项目里已有的 JSZip 读，不额外加依赖）
      if (/\.xlsx$/i.test(f.name)) {
        try {
          const lines = await this._parseXlsx(f);
          if (!lines.length) throw new Error('表格里没读到内容');
          const ta0 = document.getElementById('qr-batch-lines');
          if (ta0) ta0.value = lines.join('\n');
          const skip = document.getElementById('qr-batch-skip-head');
          if (skip) skip.checked = true;    // Excel 一般都有表头
          this.toast?.show(`已读入 ${f.name}（${lines.length} 行，已勾选跳过表头）`, 'success');
          return;
        } catch (err) {
          this.toast?.show('读取 xlsx 失败：' + err.message + '（可另存为 CSV）', 'error');
          return;
        }
      }
      const text = await f.text();
      const ta = document.getElementById('qr-batch-lines');
      if (ta) ta.value = text;
      this.toast?.show(`已读入 ${f.name}（${text.split(/\r?\n/).filter(Boolean).length} 行）`, 'success');
    });
    document.getElementById('qr-batch-gen-btn')?.addEventListener('click', () => this._generateBatch());
    document.getElementById('qr-batch-zip-again')?.addEventListener('click', () => this._downloadZip(`pixelkit-qr-${Date.now()}.zip`));
    document.getElementById('qr-batch-gen-clear')?.addEventListener('click', () => {
      this._batchShots = []; this._batchTotal = 0; this._batchZip = null;
      const ta = document.getElementById('qr-batch-lines'); if (ta) ta.value = '';
      this._renderBatchPreview();
      document.getElementById('qr-batch-gen-actions').style.display = 'none';
      const h = document.getElementById('qr-batch-gen-hint'); if (h) h.textContent = '';
    });
  }

  _batchMode(mode) {
    const panes = { decode: 'qr-batch-decode-pane', scan: 'qr-batch-scan-pane', gen: 'qr-batch-gen-pane' };
    const btns = { decode: 'qr-batch-mode-decode', scan: 'qr-batch-mode-scan', gen: 'qr-batch-mode-gen' };
    for (const k of Object.keys(panes)) {
      const el = document.getElementById(panes[k]);
      // 用 class 切换（本页 qr-panel 系列就是靠 .active 控制显隐；内联 display 会被 CSS 压掉）
      if (el) { el.classList.toggle('active', k === mode); el.style.display = ''; }
      document.getElementById(btns[k])?.classList.toggle('active', k === mode);
    }
    if (mode !== 'scan') this._stopScan();     // 切走就关摄像头，别偷偷占着
  }

  /** 从一张图片里解一个二维码（返回文本或 null） */
  async _decodeImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => {
        const im = new Image();
        im.onload = () => ok(im); im.onerror = () => no(new Error('图片读不出来'));
        im.src = url;
      });
      // 大图缩到最长边 1400，既够解码又省时间
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h);
      const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
      return r?.data || null;
    } finally { URL.revokeObjectURL(url); }
  }

  async handleBatchDecode(files) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) { this.toast?.show('请选择图片文件', 'error'); return; }
    const sum = document.getElementById('qr-batch-summary');
    if (sum) sum.textContent = `共 ${images.length} 张，解码中…`;
    const rows = this._batchRows || (this._batchRows = []);
    let done = 0;
    for (const f of images) {
      let text = null, err = '';
      try { text = await this._decodeImage(f); } catch (e) { err = e.message; }
      rows.push({ name: f.name, text: text || '', ok: !!text, err: err || (text ? '' : '未检测到二维码') });
      done++;
      if (sum) sum.textContent = `共 ${images.length} 张，已处理 ${done} 张…`;
    }
    this._renderBatch();
    const okCount = rows.filter((r) => r.ok).length;
    if (sum) sum.textContent = `共 ${rows.length} 条：成功 ${okCount}，失败 ${rows.length - okCount}`;
  }

  _renderBatch() {
    const list = document.getElementById('qr-batch-list');
    const acts = document.getElementById('qr-batch-actions');
    const rows = this._batchRows || [];
    if (!list) return;
    if (!rows.length) { list.innerHTML = ''; if (acts) acts.style.display = 'none'; if (document.getElementById('qr-batch-summary')) document.getElementById('qr-batch-summary').textContent = ''; return; }
    list.innerHTML = '<table class="qr-batch-table"><thead><tr><th>#</th><th>文件</th><th>解码结果</th></tr></thead><tbody>'
      + rows.map((r, i) => `<tr class="${r.ok ? '' : 'is-bad'}"><td>${i + 1}</td><td class="qr-batch-name" title="${this._esc(r.name)}">${this._esc(r.name)}</td>`
        + `<td class="qr-batch-val">${r.ok ? this._esc(r.text) : '<span class="qr-batch-err">' + this._esc(r.err) + '</span>'}</td></tr>`).join('')
      + '</tbody></table>';
    if (acts) acts.style.display = '';
  }

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  _rowsText(rows) { return rows.filter((r) => r.ok).map((r) => r.text).join('\n'); }

  async _copyBatch(rows) {
    const text = this._rowsText(rows);
    if (!text) { this.toast?.show('还没有成功解码的内容', 'error'); return; }
    try { await navigator.clipboard.writeText(text); this.toast?.show(`已复制 ${rows.filter((r) => r.ok).length} 条`, 'success'); }
    catch { this.toast?.show('浏览器不允许剪贴板，请手动选中复制', 'error'); }
  }

  _exportCsv(rows) {
    if (!rows.length) { this.toast?.show('还没有内容', 'error'); return; }
    const csv = '\uFEFF' + '序号,文件,结果,状态\n' + rows.map((r, i) =>
      [i + 1, r.name, r.ok ? r.text : r.err, r.ok ? '成功' : '失败'].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-batch-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    this.toast?.show(`已导出 ${rows.length} 条（Excel 可直接打开）`, 'success');
  }

  async _toggleScan() {
    if (this._scanStream) { this._stopScan(); return; }
    const video = document.getElementById('qr-scan-video');
    const hint = document.getElementById('qr-scan-hint');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器不支持摄像头（需要 HTTPS 或 localhost）');
      this._scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = this._scanStream;
      await video.play();
      document.getElementById('qr-scan-toggle').textContent = '■ 停止扫码';
      if (hint) hint.textContent = '正在连续扫码…对准即可';
      this._scanRows = this._scanRows || [];
      this._scanLast = {};
      const c = document.createElement('canvas');
      const cx = c.getContext('2d', { willReadFrequently: true });
      this._scanTimer = setInterval(() => {
        if (!video.videoWidth) return;
        c.width = video.videoWidth; c.height = video.videoHeight;
        cx.drawImage(video, 0, 0, c.width, c.height);
        const d = cx.getImageData(0, 0, c.width, c.height);
        const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
        if (!r?.data) return;
        const now = Date.now();
        if (this._scanLast[r.data] && now - this._scanLast[r.data] < 3000) return;   // 同一张码 3 秒内不重复记
        this._scanLast[r.data] = now;
        this._scanRows.push({ name: this._scanRows.length + 1, text: r.data, ok: true, err: '' });
        this._renderScan();
        if (navigator.vibrate) navigator.vibrate(40);
      }, 220);
    } catch (e) {
      this._stopScan();
      if (hint) hint.textContent = '摄像头不可用：' + e.message;
      this.toast?.show('打不开摄像头：' + e.message, 'error');
    }
  }

  _stopScan() {
    if (this._scanTimer) { clearInterval(this._scanTimer); this._scanTimer = null; }
    if (this._scanStream) { this._scanStream.getTracks().forEach((t) => t.stop()); this._scanStream = null; }
    const v = document.getElementById('qr-scan-video');
    if (v) v.srcObject = null;
    const btn = document.getElementById('qr-scan-toggle');
    if (btn) btn.textContent = '▶ 开始连续扫码';
  }

  _renderScan() {
    const list = document.getElementById('qr-scan-list');
    const acts = document.getElementById('qr-scan-actions');
    const sum = document.getElementById('qr-scan-summary');
    const rows = this._scanRows || [];
    if (sum) sum.textContent = rows.length ? `已扫到 ${rows.length} 条` : '';
    if (!list) return;
    if (!rows.length) { list.innerHTML = ''; if (acts) acts.style.display = 'none'; return; }
    list.innerHTML = '<table class="qr-batch-table"><thead><tr><th>#</th><th>内容</th><th>时间</th></tr></thead><tbody>'
      + rows.map((r, i) => `<tr><td>${i + 1}</td><td class="qr-batch-val">${this._esc(r.text)}</td><td>${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</td></tr>`).join('')
      + '</tbody></table>';
    if (acts) acts.style.display = '';
  }
  /* ==================== 批量生成（2026-10-13 参考草料二维码增补）====================
     每行一条内容（或上传 CSV/TXT，Excel 可另存为 CSV），逐条按"二维码"标签页当前的
     样式/颜色/容错/输出格式生成，最后用 JSZip 打包成一个 ZIP 下载，并在页面预览前 24 张。*/
  _parseBatchLines(raw, skipHead) {
    let lines = String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (skipHead && lines.length > 1) lines = lines.slice(1);
    return lines.map((l) => {
      if (l.startsWith('"')) {                       // CSV 引号包裹：取第一个引号字段
        const m = l.match(/^"((?:[^"]|"")*)"/);
        if (m) return m[1].replace(/""/g, '"').trim();
      }
      const i = l.indexOf(',');
      return (i >= 0 ? l.slice(0, i) : l).trim();
    }).filter(Boolean);
  }

  _currentQrOpts() {
    const v = (id) => document.getElementById(id)?.value;
    // 2026-10-21：尺寸口径 + 物理尺寸参数跟着 opts 走，批量生成 / 活码自动继承
    const sizeMode = v('qr-size-mode') === 'phys' ? 'phys' : 'px';
    const margin = Number(v('qr-margin') ?? 4);
    return {
      size: this._outputSizePx(),
      sizeMode,
      phys: sizeMode === 'phys' ? this._physSettings() : null,
      margin: Number.isFinite(margin) ? margin : 4,
      dark: v('qr-dark') || '#000000',
      light: v('qr-light') || '#ffffff',
      ecc: v('qr-ecc') || 'M',
      style: v('qr-style') || 'square',
      eye: v('qr-eye') || 'square',
      format: v('qr-format') || 'png',
      useGradient: Boolean(document.getElementById('qr-gradient')?.checked),
      dark2: v('qr-dark2') || '#000000',
    };
  }

  async _generateBatch() {
    const hint = document.getElementById('qr-batch-gen-hint');
    const raw = document.getElementById('qr-batch-lines')?.value || '';
    const skipHead = Boolean(document.getElementById('qr-batch-skip-head')?.checked);
    let items = this._parseBatchLines(raw, skipHead);
    if (!items.length) { this.toast?.show('请先填入内容，或上传 CSV / TXT', 'error'); return; }
    if (items.length > 300) { items = items.slice(0, 300); this.toast?.show('最多 300 条，已只处理前 300 条', 'error'); }
    const opts = this._currentQrOpts();
    const prefix = String(document.getElementById('qr-batch-prefix')?.value || 'qr').replace(/[^\w.-]+/g, '') || 'qr';
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const shots = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const out = await this._renderQr({ text: items[i], ...opts });
        const blob = await (await fetch(out.dataUrl)).blob();
        const name = `${prefix}-${String(i + 1).padStart(3, '0')}.${out.ext}`;
        zip.file(name, blob);
        if (shots.length < 24) shots.push({ name, url: out.dataUrl, text: items[i] });
      } catch (e) {
        zip.file(`${prefix}-${String(i + 1).padStart(3, '0')}-失败.txt`, '生成失败：' + e.message);
      }
      if (hint) hint.textContent = `生成中… ${i + 1}/${items.length}`;
    }
    this._batchShots = shots;
    this._batchTotal = items.length;
    this._renderBatchPreview();
    this._batchZip = await zip.generateAsync({ type: 'blob' });
    this._downloadZip(`pixelkit-qr-${Date.now()}.zip`);
    if (hint) hint.textContent = `已生成 ${items.length} 张，ZIP 下载中（预览前 ${shots.length} 张）`;
    document.getElementById('qr-batch-gen-actions').style.display = '';
  }

  _renderBatchPreview() {
    const box = document.getElementById('qr-batch-preview');
    if (!box) return;
    const shots = this._batchShots || [];
    if (!shots.length && !this._batchTotal) { box.innerHTML = ''; return; }
    box.innerHTML = `<p class="qr-batch-summary">共 ${this._batchTotal || shots.length} 张，预览前 ${shots.length} 张</p>`
      + '<div class="qr-batch-grid">' + shots.map((s) =>
        `<figure class="qr-batch-thumb"><img src="${s.url}" alt="" /><figcaption title="${this._esc(s.text)}">${this._esc(s.name)}</figcaption></figure>`).join('') + '</div>';
  }

  _downloadZip(filename) {
    if (!this._batchZip) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(this._batchZip);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  /* ==================== 活码：短链 + 扫码统计（2026-10-13）====================
     二维码里放短链，之后改目标不用重新印；顺带能看扫了多少次、按天分布。 */
  _pkUid() {
    // 站点里有几处用了不同的键名，这里按优先级找，找不到就生成一个并记住
    for (const k of ['pixelkit_user_id', 'pk_user_id', 'pixelkit_uid', 'userId']) {
      const v = localStorage.getItem(k);
      if (v && v.length >= 6) return v;
    }
    const uid = 'u_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    try { localStorage.setItem('pixelkit_user_id', uid); } catch { /* ignore */ }
    return uid;
  }

  initShortlink() {
    document.getElementById('sl-create')?.addEventListener('click', () => this._slCreate());
    document.getElementById('sl-refresh')?.addEventListener('click', () => this._slLoad());
    document.getElementById('sl-copy')?.addEventListener('click', async () => {
      const url = document.getElementById('sl-url')?.value || '';
      if (!url) return;
      try { await navigator.clipboard.writeText(url); this.toast?.show('短链已复制', 'success'); }
      catch { document.getElementById('sl-url')?.select(); this.toast?.show('请手动复制（浏览器不允许剪贴板）', 'error'); }
    });
    document.getElementById('sl-download')?.addEventListener('click', () => {
      const url = document.getElementById('sl-qr')?.src;
      if (!url) return;
      const a = document.createElement('a');
      a.href = url; a.download = `huoma-${Date.now()}.png`; a.click();
    });
    // 切到活码标签时自动拉一次列表
    document.querySelector('.qr-tab[data-tab="shortlink"]')?.addEventListener('click', () => this._slLoad());
  }

  async _slCreate() {
    const hint = document.getElementById('sl-hint');
    const target = String(document.getElementById('sl-target')?.value || '').trim();
    if (!target) { this.toast?.show('请先填写目标链接或文本', 'error'); return; }
    if (hint) hint.textContent = '创建中…';
    try {
      const r = await fetch('/api/shortlink/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, name: document.getElementById('sl-name')?.value || '', userId: this._pkUid() }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '创建失败');
      document.getElementById('sl-url').value = d.url;
      // 用当前二维码设置给短链出一张码
      const out = await this._renderQr({ text: d.url, ...this._currentQrOpts() });
      const img = document.getElementById('sl-qr');
      img.src = out.dataUrl;
      document.getElementById('sl-result').style.display = '';
      if (hint) hint.textContent = '已生成：二维码里放的是短链，改目标不用重印';
      this.toast?.show('活码已生成', 'success');
      this._slLoad();
    } catch (e) {
      if (hint) hint.textContent = '';
      this.toast?.show(e.message, 'error');
    }
  }

  async _slLoad() {
    const box = document.getElementById('sl-list');
    if (!box) return;
    try {
      const r = await fetch(`/api/shortlink/list?userId=${encodeURIComponent(this._pkUid())}`);
      const d = await r.json();
      const list = d.links || [];
      if (!list.length) { box.innerHTML = '<p class="qr-batch-summary">还没有活码。填个链接点「生成活码」试试。</p>'; return; }
      box.innerHTML = '<table class="qr-batch-table"><thead><tr><th>名称</th><th>短链</th><th>目标</th><th>扫码</th><th>操作</th></tr></thead><tbody>'
        + list.map((x) => `<tr><td>${this._esc(x.name || '—')}</td>`
          + `<td class="qr-batch-val">/${this._esc(x.code)}</td>`
          + `<td class="qr-batch-name" title="${this._esc(x.target)}">${this._esc(x.target).slice(0, 60)}</td>`
          + `<td><b>${x.total || 0}</b></td>`
          + `<td><button class="btn btn-sm" data-sl-stats="${this._esc(x.code)}">📈 统计</button> `
          + `<button class="btn btn-sm" data-sl-del="${this._esc(x.code)}">🗑</button></td></tr>`).join('')
        + '</tbody></table>';
      box.querySelectorAll('[data-sl-stats]').forEach((b) => b.addEventListener('click', () => this._slStats(b.dataset.slStats)));
      box.querySelectorAll('[data-sl-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('删除这个活码？删除后原短链会失效。')) return;
        const r2 = await fetch(`/api/shortlink/${encodeURIComponent(b.dataset.slDel)}?userId=${encodeURIComponent(this._pkUid())}`, { method: 'DELETE' });
        const d2 = await r2.json().catch(() => ({}));
        this.toast?.show(d2.success ? '已删除' : (d2.error || '删除失败'), d2.success ? 'success' : 'error');
        this._slLoad();
        document.getElementById('sl-stats').innerHTML = '';
      }));
    } catch { box.innerHTML = '<p class="qr-batch-summary">列表加载失败</p>'; }
  }

  async _slStats(code) {
    const box = document.getElementById('sl-stats');
    if (!box) return;
    box.innerHTML = '<p class="qr-batch-summary">统计加载中…</p>';
    try {
      const r = await fetch(`/api/shortlink/stats/${encodeURIComponent(code)}?userId=${encodeURIComponent(this._pkUid())}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '读取失败');
      const s = d.stats;
      const max = Math.max(1, ...(s.days || []).map((x) => x.count));
      box.innerHTML = `<p class="qr-batch-summary">「${this._esc(s.name || s.code)}」累计扫码 <b>${s.total}</b> 次`
        + (s.lastScanAt ? `，最近 ${new Date(s.lastScanAt).toLocaleString('zh-CN')}` : '，还没有人扫过')
        + '　<button class="btn btn-sm" id="sl-stats-close">收起</button></p>'
        + ((s.days || []).length
          ? '<table class="qr-batch-table"><thead><tr><th>日期</th><th>扫码次数</th><th></th></tr></thead><tbody>'
            + s.days.map((x) => `<tr><td>${x.day}</td><td><b>${x.count}</b></td><td><span class="sl-bar" style="width:${Math.round((x.count / max) * 160)}px"></span></td></tr>`).join('')
            + '</tbody></table>'
          : '<p class="qr-batch-summary">还没有扫码记录</p>');
      document.getElementById('sl-stats-close')?.addEventListener('click', () => { box.innerHTML = ''; });
    } catch (e) { box.innerHTML = '<p class="qr-batch-summary">' + this._esc(e.message) + '</p>'; }
  }
  /** 解析 .xlsx 第一张表的第一列（xlsx = zip + XML，用 JSZip + DOMParser，无需新依赖） */
  async _parseXlsx(file) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sheetName = Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
      || Object.keys(zip.files).find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
    if (!sheetName) throw new Error('找不到工作表');
    const sheetXml = await zip.file(sheetName).async('string');
    let shared = [];
    const ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      const ssXml = await ssFile.async('string');
      shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    }
    const out = [];
    for (const row of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      let first = '';
      for (const c of row[1].matchAll(/<c[^>]*?(?:\st="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = c[1]; const inner = c[2];
        let val = '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        const inl = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        if (type === 's' && v) val = shared[Number(v[1])] || '';
        else if (inl) val = inl[1];
        else if (v) val = v[1];
        val = String(val).trim();
        if (val) { first = val; break; }     // 只取每行第一个非空单元格
      }
      if (first) out.push(first);
    }
    return out;
  }
  downloadCurrent() {
    if (!this._lastDataUrl) return;
    const a = document.createElement('a');
    a.href = this._lastDataUrl;
    const prefix = this._lastBarcode ? 'barcode' : 'qrcode';
    const ext = this._lastBarcode ? 'png' : (this._lastExt || 'png');
    // 2026-10-21：物理尺寸模式文件名带尺寸信息（如 qrcode-10mil-600dpi.png）；px 模式保持原样
    const stamp = (!this._lastBarcode && this._lastPhys) ? `-${this._lastPhys.label}` : `-${Date.now()}`;
    a.download = `${prefix}${stamp}.${ext}`;
    a.click();
  }

  // =================== 一维码生成（纯前端，JsBarcode） ===================
  generateBarcode() {
    const text = document.getElementById('barcode-text').value.trim();
    const hint = document.getElementById('barcode-gen-hint');
    if (!text) { this.toast?.show('请输入数字或字母', 'error'); return; }
    hint.textContent = '生成中…';

    const format = document.getElementById('barcode-format').value;
    const width = parseInt(document.getElementById('barcode-width').value) || 2;
    const height = parseInt(document.getElementById('barcode-height').value) || 100;
    const lineColor = document.getElementById('barcode-dark').value;
    const bgColor = document.getElementById('barcode-light').value;

    try {
      // 格式校验
      const fmtRules = {
        EAN13:  { re: /^\d{13}$/, msg: 'EAN-13 需要恰好 13 位数字' },
        EAN8:   { re: /^\d{8}$/,  msg: 'EAN-8 需要恰好 8 位数字' },
        UPC:    { re: /^\d{12}$/, msg: 'UPC-A 需要恰好 12 位数字' },
        ITF14:  { re: /^\d{14}$/, msg: 'ITF-14 需要恰好 14 位数字' },
        CODE128:{ re: /^[\x00-\x7F]+$/, msg: 'CODE128 只支持 ASCII 字符' },
        CODE39: { re: /^[A-Z0-9.\- $/+%]+$/i, msg: 'CODE39 只支持大写字母、数字和 . - $ / + % 空格' },
        MSI:    { re: /^\d+$/, msg: 'MSI 只支持纯数字' },
      };
      const rule = fmtRules[format];
      if (rule && !rule.re.test(text)) {
        hint.textContent = '';
        this.toast?.show(rule.msg, 'error');
        return;
      }

      // 用 Canvas 渲染一维码
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, text, {
        format,
        width,
        height,
        lineColor,
        background: bgColor,
        displayValue: true,
        fontSize: 14,
        margin: 10,
      });

      const dataUrl = canvas.toDataURL('image/png');
      this._lastText = text;
      this._lastDataUrl = dataUrl;
      this._lastBarcode = true;

      const img = document.getElementById('barcode-img');
      img.src = dataUrl;
      // 根据一维码实际尺寸调整图片显示
      img.style.width = 'auto';
      img.style.maxWidth = '100%';
      img.style.height = height + 40 + 'px';
      document.getElementById('barcode-gen-result').style.display = '';
      hint.textContent = '';
    } catch (e) {
      hint.textContent = '';
      // 一维码生成失败同样清掉旧结果，避免下载到上一次的图
      this._lastText = '';
      this._lastDataUrl = '';
      this._lastBarcode = false;
      const oldBar = document.getElementById('barcode-img');
      if (oldBar) oldBar.removeAttribute('src');
      const barBox = document.getElementById('barcode-gen-result');
      if (barBox) barBox.style.display = 'none';
      this.toast?.show(e.message || '生成失败', 'error');
      console.error('Barcode error:', e);
    }
  }

  // =================== 文件活码 ===================
  async handleFileUpload(file) {
    const hint = document.getElementById('qr-file-hint');
    if (file.size > 50 * 1024 * 1024) { this.toast?.show('文件超过 50MB 上限', 'error'); return; }
    hint.textContent = '上传中…';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('userId', this.userId);
    try {
      const r = await fetch('/api/qr/file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '上传失败');
      this._lastFileUrl = d.url;
      // 用链接生成二维码（活码）
      const gr = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: d.url, size: 512 })
      });
      const gd = await gr.json();
      if (!gd.success) throw new Error('二维码生成失败');
      this._lastDataUrl = gd.dataUrl;
      // 2026-10-21：文件活码走服务端 512px PNG，清掉上一次物理尺寸/格式的残留，下载文件名才对
      this._lastExt = 'png';
      this._lastBarcode = false;
      this._lastPhys = null;
      document.getElementById('qr-file-img').src = gd.dataUrl;
      document.getElementById('qr-file-link').textContent = d.url;
      document.getElementById('qr-file-result').style.display = '';
      hint.textContent = '已生成，手机扫码即可访问';
      const fi = document.getElementById('qr-file-input2');
      if (fi) fi.value = ''; // 允许再次选择同一文件
    } catch (e) {
      hint.textContent = '';
      this.toast?.show(e.message || '上传失败', 'error');
    }
  }

  resetFilePanel() {
    document.getElementById('qr-file-result').style.display = 'none';
    document.getElementById('qr-file-hint').textContent = '';
    this._lastFileUrl = '';
    this._lastDataUrl = '';
  }

  // =================== 解码 ===================
  async handleDecodeFile(file) {
    if (!file.type.startsWith('image/')) { this.toast?.show('请上传图片', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.getElementById('qr-decode-img');
      img.src = reader.result;
      document.getElementById('qr-upload-zone').style.display = 'none';
      document.getElementById('qr-decode-preview').style.display = '';
    };
    reader.readAsDataURL(file);

    const resultEl = document.getElementById('qr-decode-result');
    resultEl.innerHTML = '<div class="qr-decoding">识别中…</div>';

    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await fetch('/api/qr/decode', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '未识别');
      this._lastDecoded = d.text;
      resultEl.innerHTML = `<div class="qr-decode-text">${this.escapeHtml(d.text)}</div>`;
      document.getElementById('qr-decode-actions').style.display = '';
    } catch (e) {
      this._lastDecoded = null;
      resultEl.innerHTML = `<div class="qr-decode-error">${this.escapeHtml(e.message || '解码失败')}</div>`;
      document.getElementById('qr-decode-actions').style.display = 'none';
    }
    // 重置文件输入，允许再次选择同一张图片
    const fi = document.getElementById('qr-file-input');
    if (fi) fi.value = '';
  }

  // =================== 记录 ===================
  async loadRecords() {
    try {
      const r = await fetch('/api/qr/records?userId=' + encodeURIComponent(this.userId));
      const d = await r.json();
      if (d.success) { this.records = d.records || []; this.renderRecords(); }
    } catch {}
  }

  async saveRecord(text, type) {
    if (!text) { this.toast?.show('没有可保存的内容', 'error'); return; }
    try {
      // 组装二维码图片：生成类直接用当前图，解码类按解码文字重新生成
      let dataUrl = '';
      if ((type === 'generate' || type === 'barcode') && this._lastDataUrl) {
        dataUrl = this._lastDataUrl;
      } else if (type === 'decode') {
        try {
          const gr = await fetch('/api/qr/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, size: 512 })
          });
          const gd = await gr.json();
          if (gd.success) dataUrl = gd.dataUrl;
        } catch {}
      }
      const r = await fetch('/api/qr/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, type, dataUrl, userId: this.userId })
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.toast?.show('已保存到记录', 'success');
      // 切到记录 tab 并刷新
      document.querySelector('.qr-tab[data-tab="records"]')?.click();
      await this.loadRecords();
    } catch (e) {
      this.toast?.show(e.message || '保存失败', 'error');
    }
  }

  async deleteRecord(id) {
    try {
      await fetch(`/api/qr/records/${id}?userId=${encodeURIComponent(this.userId)}`, { method: 'DELETE' });
      this.records = this.records.filter(r => r.id !== id);
      this.renderRecords();
    } catch {}
  }

  async clearRecords() {
    if (!confirm('确定清空所有记录？')) return;
    for (const r of [...this.records]) await this.deleteRecord(r.id);
    this.toast?.show('已清空', 'success');
  }

  renderRecords() {
    const list = document.getElementById('qr-records-list');
    if (!list) return;
    if (!this.records.length) {
      list.innerHTML = '<div class="qr-records-empty">暂无记录，去生成或解码一条吧～</div>';
      return;
    }
    list.innerHTML = this.records.map(r => {
      const isFileLike = (r.type === 'file' || r.type === 'fileshare');
      const badge = r.type === 'barcode' ? '一维码' : (r.type === 'fileshare' ? '分享' : (r.type === 'file' ? '文件' : (r.type === 'decode' ? '解码' : '生成')));
      const copyVal = isFileLike ? (r.url || '') : r.text;
      const textShown = isFileLike ? (r.originalName || r.text) : r.text;
      return `
      <div class="qr-record-item" data-id="${r.id}" ${isFileLike ? `data-url="${this.escapeAttr(r.url || '')}"` : ''} title="点击查看二维码">
        <div class="qr-record-badge qr-record-${r.type}">${badge}</div>
        <div class="qr-record-text" title="${this.escapeAttr(textShown)}">${this.escapeHtml(textShown)}</div>
        <div class="qr-record-time">${this.timeAgo(r.createdAt)}</div>
        <div class="qr-record-actions">
          <button class="btn btn-sm" data-copy="${this.escapeAttr(copyVal)}">📋</button>
          <button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.qr-record-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 点复制/删除按钮不触发查看
        if (e.target.closest('[data-copy]') || e.target.closest('[data-del]')) return;
        const rec = this.records.find(r => r.id === item.dataset.id);
        if (rec) this.showRecordModal(rec);
      });
    });
    list.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => this.copyText(btn.dataset.copy));
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteRecord(btn.dataset.del));
    });
  }

  // 点击记录 → 弹窗查看当时的二维码
  showRecordModal(record) {
    let modal = document.getElementById('qr-record-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'qr-record-modal';
      modal.className = 'qr-record-modal-overlay';
      modal.innerHTML = `
        <div class="qr-record-modal">
          <button class="qr-record-modal-close" id="qr-record-modal-close">✕</button>
          <div class="qr-record-modal-img-wrap" id="qr-record-modal-img-wrap"></div>
          <div class="qr-record-modal-link" id="qr-record-modal-link" style="display:none;">
            <span class="qr-record-modal-link-text"></span>
          </div>
          <div class="qr-record-modal-text" id="qr-record-modal-text"></div>
          <div class="qr-record-modal-actions">
            <button class="btn btn-sm" id="qr-record-modal-copy">📋 复制</button>
            <button class="btn btn-sm" id="qr-record-modal-dl">⬇ 下载</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
      modal.querySelector('#qr-record-modal-close').addEventListener('click', () => modal.classList.remove('open'));
    }
    const imgWrap = modal.querySelector('#qr-record-modal-img-wrap');
    const linkBox = modal.querySelector('#qr-record-modal-link');
    const textEl = modal.querySelector('#qr-record-modal-text');
    const copyBtn = modal.querySelector('#qr-record-modal-copy');
    const dlBtn = modal.querySelector('#qr-record-modal-dl');

    // 文件类型：二维码编码链接，展示「复制链接」与下载文件
    if ((record.type === 'file' || record.type === 'fileshare') && record.url) {
      textEl.textContent = record.originalName || record.text;
      linkBox.style.display = '';
      linkBox.querySelector('.qr-record-modal-link-text').textContent = record.url;
      copyBtn.onclick = () => this.copyText(record.url);
      dlBtn.onclick = () => window.open(record.type === 'fileshare' ? record.url : `/qr/${encodeURIComponent(record.id)}/raw?download=1`, '_blank');
      imgWrap.innerHTML = '<div class="qr-decoding">生成中…</div>';
      this._genQrInto(imgWrap, record.url);
      modal.classList.add('open');
      return;
    }

    // 文本/解码类型：原逻辑
    linkBox.style.display = 'none';
    textEl.textContent = record.text;
    copyBtn.onclick = () => this.copyText(record.text);
    dlBtn.onclick = () => {
      if (record.dataUrl) {
        const a = document.createElement('a');
        a.href = record.dataUrl; a.download = `qrcode-${record.id}.png`; a.click();
      }
    };
    if (record.dataUrl) {
      imgWrap.innerHTML = `<img class="qr-record-modal-img" src="${record.dataUrl}" alt="二维码" />`;
    } else {
      imgWrap.innerHTML = '<div class="qr-decoding">生成中…</div>';
      this._genQrInto(imgWrap, record.text);
    }
    modal.classList.add('open');
  }

  // 把文字/链接生成二维码塞进指定容器
  _genQrInto(container, text) {
    fetch('/api/qr/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, size: 512 })
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) container.innerHTML = `<img class="qr-record-modal-img" src="${d.dataUrl}" alt="二维码" />`;
        else container.innerHTML = '<div class="qr-decode-error">生成失败</div>';
      })
      .catch(() => { container.innerHTML = '<div class="qr-decode-error">生成失败</div>'; });
  }

  // =================== 工具 ===================
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast?.show('已复制', 'success');
    } catch {
      // 降级方案
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); this.toast?.show('已复制', 'success'); } catch {}
      document.body.removeChild(ta);
    }
  }

  timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }

  escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  escapeAttr(s) {
    return this.escapeHtml(s).replace(/"/g, '&quot;');
  }
}
