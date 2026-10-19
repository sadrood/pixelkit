/**
 * PixelKit Server - 文档转换后端
 *
 * 功能：
 *   LibreOffice: docx/xlsx/pptx ↔ pdf, 图片 → pdf
 *   Python:      pdf 合并/拆分/压缩/加密/解密/水印, pdf → 图片
 */
import express from 'express';
import { createServer } from 'http';
import multer from 'multer';
import cors from 'cors';
import { exec, execFile, spawn } from 'child_process';
import { promises as fs, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
// 上游限流退避/熔断/并发闸门（详见 lib/ai-retry.js 顶部注释与 docs/AI限流与稳健性.md）
import {
  sleep, isQuotaText, isRpsQuotaText, parseRetryAfterMs, quotaWaitMs, backoffMs,
  describeWait, createBreaker, createPacer, DEFAULT_MAX_WAIT_MS,
} from './lib/ai-retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 .env 文件（手动解析，无需 dotenv 依赖）
try {
  const envPath = path.join(__dirname, '.env');
  const envContent = await fs.readFile(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val; // 环境变量优先
    }
  }
  console.log('✓ 已加载 .env 配置');
} catch { /* .env 文件不存在，跳过 */ }

const app = express();
app.set('trust proxy', true); // 公网部署在反代后时，正确识别 https 与公网域名
const PORT = parseInt(process.env.PORT) || 3001;

app.set('trust proxy', true);
app.disable('x-powered-by');   // 别再对外报 Express 指纹

/* CORS 收紧（2026-10-08 审计）：
   原来是 app.use(cors()) → 全站 Access-Control-Allow-Origin: *，
   配合当时不校验归属的 /api/agent/*，等于**任意网站都能在访客浏览器里读走全部聊天记录**。
   本站所有请求都是同源的，跨域没需求，所以默认不发 CORS 头；
   确实需要跨域时用 CORS_ALLOWED_ORIGINS 显式列白名单（逗号分隔）。 */
const CORS_ALLOWED = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                    // 同源请求 / curl 没有 Origin
    if (CORS_ALLOWED.includes(origin)) return cb(null, true);
    return cb(null, false);                                // 不加 CORS 头（浏览器就会拦掉跨域读取）
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-pk-user'],
}));

// 启用 SharedArrayBuffer（onnxruntime-web 的 WASM 后端需要）
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// 测试环境 (PORT=3002) 的 HTTP Basic Auth —— **默认关闭**
// 2026-09-14：按要求去掉测试环境登录（测试机不想再被弹框挡住）。
// 保留开关：设了 TEST_AUTH_USER 就继续校验该用户 + TEST_AUTH_PASS，用来临时把门关回去。
// 想恢复成以前的「固定 pixelkit/test123」，把这两个变量写进服务器 .env 即可。
const TEST_PORT = 3002;
if (PORT === TEST_PORT && process.env.TEST_AUTH_USER) {
  const AUTH_USER = process.env.TEST_AUTH_USER;
  const AUTH_PASS = process.env.TEST_AUTH_PASS || '';
  app.use((req, res, next) => {
    // 静态资源不禁用缓存时，预检请求也会走 auth，所以放行 OPTIONS
    if (req.method === 'OPTIONS') return next();
    const auth = req.headers.authorization;
    if (!auth) return sendAuth(res);
    const [scheme, cred] = auth.split(' ');
    if (scheme !== 'Basic') return sendAuth(res);
    const [user, pass] = Buffer.from(cred, 'base64').toString().split(':');
    if (user === AUTH_USER && pass === AUTH_PASS) return next();
    return sendAuth(res);
  });
  function sendAuth(res) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PixelKit Test"');
    res.status(401).send('需要密码访问测试环境');
  }
  console.log(`[auth] 测试环境密码保护已启用 (用户: ${AUTH_USER})`);
} else if (PORT === TEST_PORT) {
  console.log('[auth] 测试环境未设密码（默认）：设 TEST_AUTH_USER / TEST_AUTH_PASS 可重新开启');
}

// ==================== 工具函数 ====================

/** 获取真实客户端 IP（支持代理/Vite Proxy） */
function getClientIP(req) {
  // X-Forwarded-For: client, proxy1, proxy2 ...
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const ips = xff.split(',').map(s => s.trim());
    const clientIP = ips[0].replace(/^::ffff:/, '');
    // 过滤掉内网代理 IP（本地 Vite 代理场景：127.0.0.1 不是真实IP）
    if (clientIP && clientIP !== '127.0.0.1' && clientIP !== '::1') {
      return clientIP;
    }
    // 如果第一个是 localhost，尝试取最后一个非本地 IP
    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i].trim().replace(/^::ffff:/, '');
      if (ip && ip !== '127.0.0.1' && ip !== '::1') return ip;
    }
  }
  const rip = (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return rip || 'unknown';
}

/** 获取公网 IP（内网时通过外部服务查询） */
async function getPublicIP(localIP) {
  const isLocal = localIP === '127.0.0.1' || localIP === '::1' || localIP === 'unknown'
    || localIP.startsWith('10.') || localIP.startsWith('172.') || localIP.startsWith('192.168.');
  if (!isLocal) return localIP;

  const services = ['https://api.ip.sb/ip', 'https://api.ipify.org'];
  for (const svc of services) {
    try {
      const r = await fetch(svc, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return (await r.text()).trim();
    } catch {}
  }
  return localIP;
}
function maskIP(ip) {
  if (!ip || ip === 'unknown') return '未知';
  if (ip === '127.0.0.1' || ip === '::1') return '127.0.0.*';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  const v6parts = ip.split(':');
  if (v6parts.length >= 2) return v6parts.slice(0, 4).join(':') + ':***';
  return ip;
}
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

// 上传配置
const upload = multer({
  dest: path.join(os.tmpdir(), 'pixelkit-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const outputDir = path.join(os.tmpdir(), 'pixelkit-outputs');
await fs.mkdir(outputDir, { recursive: true });

// Python 脚本目录
const pyScriptsDir = path.join(__dirname, 'scripts');
await fs.mkdir(pyScriptsDir, { recursive: true });

// ==================== Python 脚本 ====================

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// 初始化 Python 脚本文件
async function ensurePythonScripts() {
  // PDF 合并
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_merge.py'), `
import sys, json
from PyPDF2 import PdfReader, PdfWriter
files = json.loads(sys.argv[1])
output = sys.argv[2]
writer = PdfWriter()
for f in files:
    reader = PdfReader(f)
    for page in reader.pages:
        writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True, "pages": len(writer.pages)}))
`);

  // PDF 拆分
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_split.py'), `
import sys, json, os
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
outdir = sys.argv[2]
pages_per = int(sys.argv[3]) if len(sys.argv) > 3 else 1
reader = PdfReader(infile)
total = len(reader.pages)
results = []
for i in range(0, total, pages_per):
    writer = PdfWriter()
    end = min(i + pages_per, total)
    for j in range(i, end):
        writer.add_page(reader.pages[j])
    outname = f"split_{i+1}-{end}.pdf"
    outpath = os.path.join(outdir, outname)
    writer.write(outpath)
    results.append(outname)
print(json.dumps({"success": True, "files": results, "total": total}))
`);

  // PDF 压缩
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_compress.py'), `
import sys, json, subprocess, os
infile = sys.argv[1]
output = sys.argv[2]
# 用 Ghostscript 或 qpdf 压缩，这里用 PyPDF2 做简单压缩
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    page.compress_content_streams()
    writer.add_page(page)
writer.write(output)
orig = os.path.getsize(infile)
new = os.path.getsize(output)
print(json.dumps({"success": True, "original_size": orig, "compressed_size": new, "ratio": round(new/orig*100, 1)}))
`);

  // PDF 加密
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_encrypt.py'), `
import sys, json
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
output = sys.argv[2]
password = sys.argv[3]
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.encrypt(password)
writer.write(output)
print(json.dumps({"success": True}))
`);

  // PDF 解密
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_decrypt.py'), `
import sys, json
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
output = sys.argv[2]
password = sys.argv[3] if len(sys.argv) > 3 else ''
reader = PdfReader(infile)
if reader.is_encrypted:
    reader.decrypt(password)
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True}))
`);

  // PDF 加水印
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_watermark.py'), `
import sys, json, io
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import Color
infile = sys.argv[1]
output = sys.argv[2]
text = sys.argv[3]
opacity = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
color_hex = sys.argv[5] if len(sys.argv) > 5 else '#ff0000'
r = int(color_hex[1:3], 16) / 255
g = int(color_hex[3:5], 16) / 255
b = int(color_hex[5:7], 16) / 255
# 创建水印页
packet = io.BytesIO()
c = canvas.Canvas(packet, pagesize=A4)
c.setFillColor(Color(r, g, b, alpha=opacity))
c.setFont("Helvetica", 48)
c.saveState()
c.translate(300, 400)
c.rotate(45)
c.drawString(-200, 0, text)
c.restore()
c.save()
packet.seek(0)
watermark = PdfReader(packet)
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark.pages[0])
    writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True}))
`);

  // 图片转 PDF
  await fs.writeFile(path.join(pyScriptsDir, 'img_to_pdf.py'), `
import sys, json, os
from PIL import Image

# 解除像素限制，防止大图 DecompressionBomb 报错
Image.MAX_IMAGE_PIXELS = None

files = json.loads(sys.argv[1])
output = sys.argv[2]
MAX_DIM = 4096  # 超大图缩放到此尺寸以内，节省内存

images = []
total = len(files)
for idx, f in enumerate(files):
    img = Image.open(f)
    # 超大图自动缩放，防止 2GB 服务器 OOM
    w, h = img.size
    if max(w, h) > MAX_DIM:
        ratio = MAX_DIM / max(w, h)
        new_w = max(1, int(w * ratio))
        new_h = max(1, int(h * ratio))
        img = img.resize((new_w, new_h), Image.LANCZOS)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    images.append(img)
    # 输出进度（由服务端解析）
    print(json.dumps({"progress": (idx + 1) / total, "current": os.path.basename(f), "index": idx + 1, "total": total}), flush=True)

if images:
    images[0].save(output, save_all=True, append_images=images[1:] if len(images) > 1 else [])
    print(json.dumps({"success": True, "pages": len(images)}))
else:
    print(json.dumps({"success": False, "error": "No valid images"}))
`);

  // pdf2docx: PDF 转 Word（保留格式）
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_to_docx.py'), `
import sys, json
from pdf2docx import Converter
infile = sys.argv[1]
output = sys.argv[2]
cv = Converter(infile)
cv.convert(output, start=0, end=None)
cv.close()
print(json.dumps({"success": True}))
`);

  // PDF → Markdown（pymupdf 提取，保留段落结构）
  await fs.writeFile(path.join(pyScriptsDir, 'to_markdown.py'), `
import sys, json, os, re
import fitz  # pymupdf

infile = sys.argv[1]
output = sys.argv[2]

doc = fitz.open(infile)
md_pages = []

for page_num, page in enumerate(doc):
    # 获取文字块（pymupdf 的 get_text("blocks") 保留段落结构）
    blocks = page.get_text("blocks")
    page_lines = []

    for block in blocks:
        # block = (x0, y0, x1, y1, text, block_no, block_type)
        if len(block) < 5:
            continue
        text = block[4].strip()
        if not text:
            continue

        block_type = block[6] if len(block) > 6 else 0
        # block_type: 0=text, 1=image

        if block_type == 0:
            # 检测是否为标题（字体大、文字短）
            # pymupdf 的 dict 模式能拿字体信息
            lines = text.split('\\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                # 简单启发式：全大写短句可能是标题
                if len(line) < 80 and (line.isupper() or re.match(r'^第[一二三四五六七八九十\\d]+[章节]', line)):
                    page_lines.append('## ' + line)
                elif len(line) < 60 and re.match(r'^[\\d]+[\\.、]', line):
                    page_lines.append('### ' + line)
                else:
                    page_lines.append(line)

    if page_lines:
        md_pages.append('\\n\\n'.join(page_lines))

doc.close()

result = '\\n\\n---\\n\\n'.join(md_pages)

with open(output, 'w', encoding='utf-8') as f:
    f.write(result)

print(json.dumps({"success": True}))
`);

  // 通用格式 → Markdown（保留，Excel/HTML 等用）
  await fs.writeFile(path.join(pyScriptsDir, 'to_markdown_general.py'), `
import sys, json, os
from markdownify import markdownify as md
from docx import Document

infile = sys.argv[1]
output = sys.argv[2]
ext = os.path.splitext(infile)[1].lower()

text = ""

if ext in ('.docx', '.doc'):
    doc = Document(infile)
    md_lines = []
    for para in doc.paragraphs:
        if para.style.name.startswith('Heading'):
            level = int(para.style.name.split()[-1]) if para.style.name.split()[-1].isdigit() else 1
            md_lines.append('#' * level + ' ' + para.text)
        else:
            md_lines.append(para.text)
    text = '\\n\\n'.join(md_lines)

elif ext in ('.html', '.htm'):
    with open(infile, 'r', encoding='utf-8') as f:
        html = f.read()
    text = md(html, heading_style='ATX')

elif ext == '.xlsx':
    import openpyxl
    wb = openpyxl.load_workbook(infile, data_only=True)
    md_lines = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        md_lines.append(f'## {sheet_name}\\n')
        rows_data = list(ws.iter_rows(values_only=True))
        for i, row in enumerate(rows_data):
            row_vals = [str(c) if c is not None else '' for c in row]
            md_lines.append('| ' + ' | '.join(row_vals) + ' |')
            if i == 0:
                md_lines.append('|' + '|'.join(['---' for _ in row_vals]) + '|')
        md_lines.append('')
    text = '\\n'.join(md_lines)

else:
    with open(infile, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

with open(output, 'w', encoding='utf-8') as f:
    f.write(text)

print(json.dumps({"success": True}))
`);

  // 图片 → ICO
  await fs.writeFile(path.join(pyScriptsDir, 'to_ico.py'), `
import sys, json
from PIL import Image
infile = sys.argv[1]
output = sys.argv[2]
img = Image.open(infile)
if img.mode != 'RGBA':
    img = img.convert('RGBA')
# 最大尺寸保持原图，其余等比缩放
w, h = img.size
max_dim = max(w, h)
# 计算各尺寸：最大 256，但不超过原图
base_sizes = [16, 32, 48, 64, 128, 256]
sizes = []
for s in base_sizes:
    if s <= max_dim:
        ratio = s / max_dim
        sizes.append((max(1, round(w * ratio)), max(1, round(h * ratio))))
    else:
        break
# 确保至少有一个尺寸
if not sizes:
    sizes = [(w, h)]
# 加上原图尺寸（如果原图大于最大预设尺寸则用原图）
if max_dim > 256:
    sizes.append((w, h))
img.save(output, format='ICO', sizes=sizes)
print(json.dumps({"success": True, "sizes": len(sizes)}))
`);

  // pdf → 图片嵌入 Word（100% 排版还原）
  await fs.writeFile(path.join(pyScriptsDir, 'pdf_to_docx_images.py'), `
import sys, json, os, tempfile
from pdf2image import convert_from_path
from docx import Document
from docx.shared import Inches, Cm
from docx.enum.section import WD_ORIENT
infile = sys.argv[1]
output = sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200

images = convert_from_path(infile, dpi=dpi)
doc = Document()

# 设置窄边距
for section in doc.sections:
    section.top_margin = Cm(0.5)
    section.bottom_margin = Cm(0.5)
    section.left_margin = Cm(0.5)
    section.right_margin = Cm(0.5)

tmpdir = tempfile.mkdtemp()
for i, img in enumerate(images):
    img_path = os.path.join(tmpdir, f'page_{i+1}.png')
    img.save(img_path, 'PNG')
    # 每页图片宽度设为页面宽度的 95%
    doc.add_picture(img_path, width=Inches(6.0))
    # 如果不是最后一页，加分页符
    if i < len(images) - 1:
        doc.add_page_break()

# 清理临时文件
for f in os.listdir(tmpdir):
    os.remove(os.path.join(tmpdir, f))
os.rmdir(tmpdir)

doc.save(output)
print(json.dumps({"success": True, "pages": len(images)}))
`);

  // 文件文本提取（txt/md/docx/pdf/xlsx → 纯文本，供 AI 阅读）
  await fs.writeFile(path.join(pyScriptsDir, 'read_file_text.py'), `
import sys, json, os
infile = sys.argv[1]
ext = os.path.splitext(infile)[1].lower()
max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 50000

text = ""
try:
    if ext in ('.txt', '.md', '.csv', '.log', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'):
        with open(infile, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
    elif ext == '.pdf':
        import fitz
        doc = fitz.open(infile)
        pages = []
        for page in doc:
            t = page.get_text()
            if t.strip():
                pages.append(t.strip())
        doc.close()
        text = '\\n\\n--- Page Break ---\\n\\n'.join(pages)
    elif ext in ('.docx', '.doc'):
        from docx import Document
        doc = Document(infile)
        paras = []
        for p in doc.paragraphs:
            if p.text.strip():
                # 检测标题样式
                if p.style and p.style.name and 'Heading' in p.style.name:
                    level = p.style.name.split()[-1]
                    prefix = '#' * (int(level) if level.isdigit() else 1) + ' '
                    paras.append(prefix + p.text.strip())
                else:
                    paras.append(p.text.strip())
        text = '\\n\\n'.join(paras)
    elif ext in ('.xlsx', '.xls'):
        import openpyxl
        wb = openpyxl.load_workbook(infile, data_only=True)
        lines = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            lines.append(f'## Sheet: {sheet_name}\\n')
            for row in ws.iter_rows(values_only=True):
                row_vals = [str(c) if c is not None else '' for c in row]
                lines.append(' | '.join(row_vals))
        text = '\\n'.join(lines)
    else:
        # 尝试当作文本文件读取
        with open(infile, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
except Exception as e:
    print(json.dumps({"success": False, "error": f"读取失败: {str(e)}"}))
    sys.exit(0)

total_len = len(text)
text = text[:max_chars]

print(json.dumps({"success": True, "text": text, "totalLength": total_len, "truncated": total_len > max_chars}))
`);
}
await ensurePythonScripts();

// ==================== 并发控制 & 任务进度 ====================

const imgToPdfLock = new Map(); // taskId -> { startTime, fileCount }
const MAX_CONCURRENT_IMG2PDF = 2;
const taskStatus = new Map();   // taskId -> { status, progress, current, index, total, startTime, filename, downloadUrl, pages, error }

// 子Agent 异步研究结果（非阻塞：主Agent 先回复，子Agent 后台跑）
const pendingResearch = new Map(); // sessionId -> { query, answer, status:'running'|'done'|'error', startTime }

// 轮询子Agent研究结果
app.get('/api/agent/pending-research/:sessionId', (req, res) => {
  const r = pendingResearch.get(req.params.sessionId);
  if (!r) return res.json({ status: 'none' });
  if (r.status === 'done') {
    res.json({ status: 'done', query: r.query, answer: r.answer, steps: r.steps });
    pendingResearch.delete(req.params.sessionId); // 取走即清理
  } else if (r.status === 'error') {
    res.json({ status: 'error', query: r.query, error: r.error });
    pendingResearch.delete(req.params.sessionId);
  } else {
    res.json({ status: 'running', query: r.query });
  }
});

// 清理超过 5 分钟的未取走研究结果
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of pendingResearch) {
    if (now - r.startTime > 300000) pendingResearch.delete(id);
  }
}, 60000);

// 清理超过 10 分钟的任务状态
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of taskStatus) {
    if (now - t.startTime > 600000) taskStatus.delete(id);
  }
}, 120000);

/**
 * 带进度输出的 Python 脚本执行
 * 解析脚本每行 JSON 输出，其中带 "progress" 字段的为进度更新
 */
function runPyWithProgress(script, args, taskId) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(pyScriptsDir, script);
    const child = spawn(PYTHON, [scriptPath, ...args], { timeout: 120000 });
    let lastResult = null;
    let stderr = '';

    child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        try {
          const obj = JSON.parse(line.trim());
          if (obj.progress !== undefined) {
            // 进度更新
            if (taskId && taskStatus.has(taskId)) {
              taskStatus.set(taskId, {
                ...taskStatus.get(taskId),
                progress: obj.progress,
                current: obj.current || '',
                index: obj.index || 0,
                total: obj.total || 0
              });
            }
          } else {
            // 最终结果
            lastResult = obj;
          }
        } catch { /* 忽略非 JSON 行 */ }
      }
    });

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (taskId && taskStatus.has(taskId)) {
        const t = taskStatus.get(taskId);
        if (code !== 0) {
          taskStatus.set(taskId, { ...t, status: 'error', error: stderr || '进程退出码 ' + code });
          reject(new Error(stderr || '进程退出码 ' + code));
        } else if (lastResult) {
          taskStatus.set(taskId, { ...t, status: 'done', progress: 1 });
          resolve(lastResult);
        } else {
          taskStatus.set(taskId, { ...t, status: 'error', error: '无输出' });
          reject(new Error('无输出'));
        }
      } else {
        if (code !== 0) reject(new Error(stderr || '进程退出码 ' + code));
        else if (lastResult) resolve(lastResult);
        else resolve({ success: true });
      }
    });

    child.on('error', (err) => {
      if (taskId && taskStatus.has(taskId)) {
        taskStatus.set(taskId, { ...taskStatus.get(taskId), status: 'error', error: err.message });
      }
      reject(err);
    });
  });
}

// ==================== LibreOffice 工具 ====================

function getLibreOfficeCmd() {
  if (process.platform === 'win32') {
    // 尝试多个路径
    const paths = [
      'soffice.exe',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ];
    for (const p of paths) {
      try {
        require('child_process').execSync(`"${p}" --version`, { stdio: 'ignore' });
        return `"${p}"`;
      } catch {}
    }
    return null; // 未安装
  }
  return 'libreoffice';
}

function runPy(script, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(pyScriptsDir, script);
    execFile(PYTHON, [scriptPath, ...args], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr || err.message)); return; }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ success: true, raw: stdout.trim() }); }
    });
  });
}

// ==================== API 路由 ====================

/**
 * POST /api/convert
 * 格式互转 (LibreOffice)：docx/xlsx/pptx/pdf ↔ 互转
 */
app.post('/api/convert', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const inputPath = req.file.path;
  const targetFormat = req.body.target || 'pdf';
  const convertMode = req.body.mode || 'auto';
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    // 后端校验格式
    const allowedExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'ods', 'html', 'htm', 'md'];
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    if (!allowedExts.includes(ext)) {
      await fs.unlink(inputPath);
      return res.status(400).json({ success: false, error: `暂不支持 ${String(ext || '').toUpperCase()} 作为源文件，请改用其它工具（本工具支持 docx/xlsx/pptx/pdf）` });
    }

    const extMap = { pdf: 'pdf', docx: 'docx', doc: 'docx', xlsx: 'xlsx', xls: 'xlsx', pptx: 'pptx', ppt: 'pptx', csv: 'csv', html: 'html', md: 'md' };
    const loFormat = extMap[targetFormat] || targetFormat;

    // 重命名输入文件保留原始扩展名
    const inputExt = path.extname(req.file.originalname).toLowerCase();
    const renamedInput = path.join(path.dirname(inputPath), `input${inputExt}`);
    await fs.rename(inputPath, renamedInput);

    // 检测 LibreOffice
    const loCmd = getLibreOfficeCmd();
    if (!loCmd) {
      await fs.unlink(renamedInput);
      return res.status(500).json({
        success: false,
        error: '服务器未安装 LibreOffice，无法进行格式互转。请安装: sudo apt install libreoffice'
      });
    }

    // ★ PDF → Word
    if (inputExt === '.pdf' && loFormat === 'docx') {
      const outputPath = path.join(taskDir, 'output.docx');

      if (convertMode === 'image') {
        // 图片嵌入模式：每页转高清图嵌入 Word，100% 排版还原
        try {
          const result = await runPy('pdf_to_docx_images.py', [renamedInput, outputPath, '200']);
          await fs.unlink(renamedInput);
          const stat = await fs.stat(outputPath);
          return res.json({
            success: true, taskId, filename: 'output.docx', size: stat.size,
            downloadUrl: `/api/download/${taskId}/output.docx`,
            engine: 'pdf2image-docx', pages: result.pages
          });
        } catch (pyErr) {
          console.warn('图片嵌入模式失败:', pyErr.message);
          // 降级到 pdf2docx
        }
      }

      // 智能还原模式（默认）：pdf2docx
      try {
        const result = await runPy('pdf_to_docx.py', [renamedInput, outputPath]);
        await fs.unlink(renamedInput);
        const stat = await fs.stat(outputPath);
        return res.json({
          success: true, taskId, filename: 'output.docx', size: stat.size,
          downloadUrl: `/api/download/${taskId}/output.docx`,
          engine: 'pdf2docx'
        });
      } catch (pyErr) {
        console.warn('pdf2docx 失败，降级到 LibreOffice:', pyErr.message);
      }
    }

    // 其他转换：LibreOffice
    const cmd = `${loCmd} --headless --convert-to ${loFormat} --outdir "${taskDir}" "${renamedInput}"`;

    exec(cmd, { timeout: 180000 }, async (error, stdout, stderr) => {
      try { await fs.unlink(renamedInput); } catch {}

      if (error) {
        return res.status(500).json({
          success: false,
          error: '转换失败: ' + (stderr || error.message || '未知错误')
        });
      }

      const files = await fs.readdir(taskDir);
      const outFile = files.find(f => f.endsWith(`.${loFormat}`));

      if (!outFile) {
        return res.status(500).json({ success: false, error: '转换后未找到输出文件' });
      }

      const finalPath = path.join(taskDir, outFile);
      const stat = await fs.stat(finalPath);

      res.json({
        success: true, taskId, filename: outFile, size: stat.size,
        downloadUrl: `/api/download/${taskId}/${outFile}`
      });
    });
  } catch (err) {
    try { await fs.unlink(inputPath); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/img-to-pdf
 * 多图合并为 PDF（带并发控制 + 进度追踪）
 */
app.post('/api/img-to-pdf', upload.array('files', 50), async (req, res) => {
  // 并发控制：最多同时处理 MAX_CONCURRENT_IMG2PDF 个请求
  const active = imgToPdfLock.size;
  if (active >= MAX_CONCURRENT_IMG2PDF) {
    return res.status(429).json({
      success: false,
      error: '服务器繁忙，请稍后重试',
      retryAfter: Math.ceil(active * 15) // 建议等待秒数
    });
  }

  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  const fileNames = req.files.map(f => f.originalname);
  const fileCount = req.files.length;
  const startTime = Date.now();

  // 注册锁和任务状态
  imgToPdfLock.set(taskId, { startTime, fileCount });
  taskStatus.set(taskId, {
    status: 'processing',
    progress: 0,
    current: '',
    index: 0,
    total: fileCount,
    startTime,
    fileNames
  });

  // 异步处理（不阻塞响应）
  (async () => {
    try {
      const files = req.files.map(f => f.path);
      const output = path.join(taskDir, 'output.pdf');
      const result = await runPyWithProgress('img_to_pdf.py', [JSON.stringify(files), output], taskId);
      for (const f of files) { try { await fs.unlink(f); } catch {} }

      taskStatus.set(taskId, {
        ...taskStatus.get(taskId),
        status: 'done',
        progress: 1,
        filename: 'output.pdf',
        downloadUrl: `/api/download/${taskId}/output.pdf`,
        pages: result.pages
      });
    } catch (err) {
      taskStatus.set(taskId, {
        ...taskStatus.get(taskId),
        status: 'error',
        error: err.message
      });
    } finally {
      imgToPdfLock.delete(taskId);
    }
  })();

  // 立即返回 taskId，前端轮询进度
  res.json({
    success: true,
    taskId,
    status: 'processing',
    total: fileCount,
    // 预估时间：每张图约 3-8 秒（2核服务器），取 5 秒均值
    estimatedSeconds: Math.max(3, fileCount * 5)
  });
});

/**
 * GET /api/task/:taskId/status
 * 查询任务进度
 */
app.get('/api/task/:taskId/status', (req, res) => {
  const t = taskStatus.get(req.params.taskId);
  if (!t) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json(t);
});

/**
 * POST /api/pdf-to-img
 * PDF 每页导出图片
 */
app.post('/api/pdf-to-img', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const imgFormat = req.body.format || 'png';
    // 用 pdf2image (需要 poppler)
    const script = `
import sys, json, os
from pdf2image import convert_from_path
infile = sys.argv[1]
outdir = sys.argv[2]
fmt = sys.argv[3]
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 200
images = convert_from_path(infile, dpi=dpi)
results = []
for i, img in enumerate(images):
    name = f"page_{i+1}.{fmt}"
    img.save(os.path.join(outdir, name), fmt.upper(), quality=95)
    results.append(name)
print(json.dumps({"success": True, "files": results, "total": len(results)}))
`;
    const pyFile = path.join(taskDir, '_pdf2img.py');
    await fs.writeFile(pyFile, script);
    const result = await runPy('_pdf2img.py', [req.file.path, taskDir, imgFormat, '200']);
    try { await fs.unlink(req.file.path); } catch {}
    try { await fs.unlink(pyFile); } catch {}

    res.json({
      success: true, taskId, files: result.files,
      downloadUrls: result.files.map(f => `/api/download/${taskId}/${f}`)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/pdf-merge
 * 合并多个 PDF
 */
app.post('/api/pdf-merge', upload.array('files', 50), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const files = req.files.map(f => f.path);
    const output = path.join(taskDir, 'merged.pdf');
    const result = await runPy('pdf_merge.py', [JSON.stringify(files), output]);
    for (const f of files) { try { await fs.unlink(f); } catch {} }
    res.json({ success: true, taskId, filename: 'merged.pdf', pages: result.pages, downloadUrl: `/api/download/${taskId}/merged.pdf` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/pdf-split
 * 拆分 PDF
 */
app.post('/api/pdf-split', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const pagesPer = parseInt(req.body.pagesPer) || 1;
    const result = await runPy('pdf_split.py', [req.file.path, taskDir, String(pagesPer)]);
    try { await fs.unlink(req.file.path); } catch {}
    res.json({
      success: true, taskId, files: result.files, total: result.total,
      downloadUrls: result.files.map(f => `/api/download/${taskId}/${f}`)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/pdf-compress
 * 压缩 PDF
 */
app.post('/api/pdf-compress', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const output = path.join(taskDir, 'compressed.pdf');
    const result = await runPy('pdf_compress.py', [req.file.path, output]);
    try { await fs.unlink(req.file.path); } catch {}
    res.json({
      success: true, taskId, filename: 'compressed.pdf',
      originalSize: result.original_size, compressedSize: result.compressed_size,
      ratio: result.ratio, downloadUrl: `/api/download/${taskId}/compressed.pdf`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/pdf-encrypt
 * PDF 加密
 */
app.post('/api/pdf-encrypt', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });
  const password = req.body.password || '123456';

  try {
    const output = path.join(taskDir, 'encrypted.pdf');
    await runPy('pdf_encrypt.py', [req.file.path, output, password]);
    try { await fs.unlink(req.file.path); } catch {}
    res.json({ success: true, taskId, filename: 'encrypted.pdf', downloadUrl: `/api/download/${taskId}/encrypted.pdf` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/pdf-decrypt
 * PDF 解密
 */
app.post('/api/pdf-decrypt', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });
  const password = req.body.password || '';

  try {
    const output = path.join(taskDir, 'decrypted.pdf');
    await runPy('pdf_decrypt.py', [req.file.path, output, password]);
    try { await fs.unlink(req.file.path); } catch {}
    res.json({ success: true, taskId, filename: 'decrypted.pdf', downloadUrl: `/api/download/${taskId}/decrypted.pdf` });
  } catch (err) {
    res.status(500).json({ success: false, error: '解密失败，密码可能不正确' });
  }
});

/**
 * POST /api/pdf-watermark
 * PDF 加水印
 */
app.post('/api/pdf-watermark', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });
  const text = req.body.text || 'Confidential';
  const opacity = req.body.opacity || '0.15';
  const color = req.body.color || '#ff0000';

  try {
    const output = path.join(taskDir, 'watermarked.pdf');
    await runPy('pdf_watermark.py', [req.file.path, output, text, opacity, color]);
    try { await fs.unlink(req.file.path); } catch {}
    res.json({ success: true, taskId, filename: 'watermarked.pdf', downloadUrl: `/api/download/${taskId}/watermarked.pdf` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/to-markdown
 * 各种格式转 Markdown
 */
app.post('/api/to-markdown', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const inputPath = req.file.path;
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const inputExt = path.extname(req.file.originalname).toLowerCase();
    const renamedInput = path.join(path.dirname(inputPath), `input${inputExt}`);
    await fs.rename(inputPath, renamedInput);

    const outputPath = path.join(taskDir, 'output.md');

    const result = await runPy('to_markdown.py', [renamedInput, outputPath]);
    await fs.unlink(renamedInput);

    const stat = await fs.stat(outputPath);
    res.json({
      success: true, taskId, filename: 'output.md', size: stat.size,
      downloadUrl: `/api/download/${taskId}/output.md`
    });
  } catch (err) {
    try { await fs.unlink(inputPath); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/to-ico
 * 图片转 ICO（后端 Python Pillow，含多尺寸）
 */
app.post('/api/to-ico', upload.single('file'), async (req, res) => {
  const taskId = uuidv4();
  const inputPath = req.file.path;
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    const renamedInput = path.join(path.dirname(inputPath), 'input' + path.extname(req.file.originalname));
    await fs.rename(inputPath, renamedInput);
    const outputPath = path.join(taskDir, 'output.ico');

    await runPy('to_ico.py', [renamedInput, outputPath]);
    await fs.unlink(renamedInput);

    const stat = await fs.stat(outputPath);
    res.json({
      success: true, taskId, filename: 'output.ico', size: stat.size,
      downloadUrl: `/api/download/${taskId}/output.ico`
    });
  } catch (err) {
    try { await fs.unlink(inputPath); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/download/:taskId/:filename
 * 下载文件
 */
app.get('/api/download/:taskId/:filename', async (req, res) => {
  const { taskId, filename } = req.params;
  const filePath = path.join(outputDir, taskId, filename);
  try { await fs.access(filePath); res.download(filePath, filename); }
  catch { res.status(404).json({ error: '文件不存在' }); }
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'PixelKit Server v2' });
});

// ==================== AI Agent ====================

// 运行时配置（从 .env 读取）
let agentConfig = {
  apiKey: process.env.OPENAI_API_KEY || '',
  baseUrl: process.env.OPENAI_BASE_URL || 'https://token.sensenova.cn/v1',
  /* 文本模型：2026-09-16 按用户决定切到 deepseek-flash（.env 的 OPENAI_MODEL 优先生效）。
     历史沿革（别再踩一遍）：sensenova-6.8-flash-lite 单次 20~23s 且频繁 429；deepseek-v4-flash ~2s。
     网关实际可用模型见 /api/agent/models（deepseek-v4.1-flash 目录里有，但当前 token plan 未开通 → 403）。 */
  model: process.env.OPENAI_MODEL || 'deepseek-flash',                      // 主模型（Agent 对话 / 画图文案优化）
  quoridorModel: process.env.QUORIDOR_MODEL || 'deepseek-flash',            // 大模型对战专用（轻量、快）
  visionModel: process.env.OPENAI_VISION_MODEL || 'sensenova-6.8-flash-lite', // 识图必须保留多模态模型，勿改
  researchModel: process.env.RESEARCH_MODEL || 'deepseek-flash',            // 子Agent用轻量模型
  dualModel: process.env.DUAL_MODEL || 'deepseek-flash',                    // 内测辩论模式用轻量模型
  // 人生模拟（成长模拟器 / 人生之书）专用：结局页需在数秒内出文，不能长时间等待。
  bookModel: process.env.BOOK_MODEL || 'deepseek-flash',
  zhihuSecret: process.env.ZHIHU_SECRET || '494ab89c7921a66473e4115e750fc72802da08d8',  // 知乎开放平台 access secret
  imageFallback: {
    enable: Boolean(process.env.IMAGE_FALLBACK_BASE_URL || process.env.IMAGE_FALLBACK_KEY),
    baseUrl: process.env.IMAGE_FALLBACK_BASE_URL || '',
    apiKey: process.env.IMAGE_FALLBACK_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.IMAGE_FALLBACK_MODEL || 'flux-1-schnell',
    sizes: (process.env.IMAGE_FALLBACK_SIZES || '1024x1024,768x1024,1024x768').split(',').map(s => s.trim()).filter(Boolean)
  }
};

/* ========== 可切换模型目录 ==========
   网关 /v1/models 返回的目录里有些模型当前 token plan 没开通（请求会 403
   permission_denied_error「model is not available in the current token plan」），
   有些目录里有但接口不路由（404）。所以这里维护一份"我们能用的候选清单"，
   再由 /api/agent/models 实时探测并标注状态，前端选择器据此灰掉不可用项。 */
const MODEL_CATALOG = [
  { id: 'cohere/north-mini-code:free', label: 'Cohere North Mini (free)', note: 'OpenRouter 免费 · 256K 上下文 · 实测约 4.6s（当前最快的可用免费模型）· 当前主模型' },
  { id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3 Note (free)', note: 'OpenRouter 免费 · 512K 上下文 · 实测约 4~7s · 备用' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (free)', note: 'OpenRouter 免费 · 1M 上下文 · 实测 3~41s（共享端点会堵）· 备用' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (free)', note: 'OpenRouter 免费 · 1M 上下文 · 实测 7~15s，偏慢（550B 排队）' },
  { id: 'deepseek-flash', label: 'DeepSeek Flash', note: '商汤网关 · 快（约 2s）但当账号额度紧张时会 429 · 兜底' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: '商汤网关 · V4 版本' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', note: '商汤网关 · 更新版本；需在 SenseNova 控制台开通 token plan' },
  { id: 'kimi-k3', label: 'Kimi K3', note: '商汤网关 · 第三方模型' },
  { id: 'glm-5.2', label: 'GLM-5.2', note: '商汤网关 · 长上下文任务较稳' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: '商汤网关 · Pro 版，额度更紧' },
  // 收费模型只登记用于"明确告知已禁用"，任何调用都会被拦下（见 isBillableModel）
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra（收费版）', note: '需付费额度 · 本站已禁用（只允许免费模型）', billable: true },
];
const MODEL_IDS = new Set(MODEL_CATALOG.map((m) => m.id));
/** 免费兜底顺序（2026-10-08 服务器实测：dots 2~3s、cohere 6~7s，两者输出都干净）。
    nemotron-3.5-lightning 实测会把思维链（甚至整段英文推理）当正文吐出来、
    nemotron-3-ultra 首字 7~15s，两者都不再进兜底链（仍留在模型目录里备查）。 */
const FREE_FALLBACK_ORDER = [
  'dots-studio/dots-3-note-preview:free',
  'cohere/north-mini-code:free',
];

/* ========== 多供应商（provider）支持 ==========
   站点现在同时用两家：商汤网关（token.sensenova.cn，现有 key 池）与 OpenRouter
   （openrouter.ai，用户新给的 key，模型形如 vendor/model:free）。
   路由规则很简单也很稳：**模型 id 里带 "/" 的走 OpenRouter，其余走商汤**。
   这样"识图模型 sensenova-6.8-flash-lite""deepseek-flash" 等自动留在商汤，
   不会因为主模型换了供应商而把识图/画图一起打挂。 */
const OPENROUTER_KEY = process.env.ALT_API_KEY || process.env.OPENROUTER_API_KEY || '';   // ALT_API_KEY 为中性变量名，旧名保留兼容
const PROVIDERS = {
  sensenova: {
    name: '商汤 SenseNova',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://token.sensenova.cn/v1',
    keys: [],                       // 下面 MAIN_KEYS 定义后填充
    headers: {},
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: process.env.ALT_API_BASE || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    keys: OPENROUTER_KEY ? [OPENROUTER_KEY] : [],
    headers: {
      // OpenRouter 建议带上来源信息（用于归因/排行，不带也能用）
      'HTTP-Referer': process.env.PUBLIC_BASE_URL || 'http://139.9.176.191:8081',
      'X-Title': 'PixelKit',
    },
  },
};
const providerKeyIdx = { sensenova: { i: 0 }, openrouter: { i: 0 } };
function providerOf(model) { return String(model || '').includes('/') ? 'openrouter' : 'sensenova'; }
/** 取某模型该用的端点（baseUrl + 头 + 轮询到的 key）。 */
function endpointFor(model, keyKind = 'main') {
  const pid = providerOf(model);
  const p = PROVIDERS[pid];
  if (!p || p.keys.length === 0) {
    // OpenRouter 没配 key 时明确降级回商汤，而不是抛异常
    if (pid === 'openrouter' && PROVIDERS.sensenova.keys.length) {
      console.warn('[provider] 未配置备用网关 key（ALT_API_KEY），模型 ' + model + ' 回退到主网关的默认模型');
      const fb = safeFallbackModel();
      const ep = endpointFor(fb, keyKind);
      return { ...ep, degradedFrom: model, model: fb };
    }
    throw new Error(`供应商 ${pid} 未配置可用 key`);
  }
  const idx = providerKeyIdx[pid];
  const apiKey = pid === 'sensenova' && keyKind === 'dual' && DUAL_KEYS.length
    ? pickKey(DUAL_KEYS, dualKeyIdx)
    : pickKey(p.keys, idx);
  return {
    provider: pid,
    providerName: p.name,
    baseUrl: p.baseUrl,
    apiKey,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...p.headers },
    model,
  };
}
/** 主模型的兜底模型：主供应商挂了/被限流时用（默认商汤 deepseek-flash）。 */
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'deepseek-flash';

/* ========== 只允许免费模型（硬约束，用户明确要求） ==========
   主模型只能用免费模型，绝不动付费额度。两道闸：
     ① resolveModel()：前端/接口传来的收费模型一律拒绝，回退到当前默认模型；
     ② upstream()：任何代码路径若拿到收费模型，就地降级成免费主模型（最后防线）。
   判定：OpenRouter（id 含 "/"）且不以 ":free" 结尾 → 收费。 */
function isBillableModel(id) {
  const s = String(id || '');
  const entry = MODEL_CATALOG.find((m) => m.id === s);
  if (entry?.billable) return true;
  return providerOf(s) === 'openrouter' && !s.endsWith(':free');
}

/** 兜底模型同样必须免费（防止 .env 被配成收费模型）。 */
function safeFallbackModel() {
  if (FALLBACK_MODEL && !isBillableModel(FALLBACK_MODEL)) return FALLBACK_MODEL;
  if (FALLBACK_MODEL) console.warn(`[free-only] 兜底模型「${FALLBACK_MODEL}」是收费模型，已忽略`);
  return agentConfig.model && !isBillableModel(agentConfig.model) ? agentConfig.model : 'deepseek-flash';
}
/** 端点当前不可用（模型没开通/被隐私策略挡住/不存在/上游过载 5xx）——重试无意义，应换供应商。 */
function isEndpointUnavailable(text, status) {
  if (status === 404) return true;
  // 5xx / 上游过载：OpenRouter 免费端点（共享）常见 "Service temporarily overloaded"，
  // 这时换另一个供应商比原地重试有效得多
  if (typeof status === 'number' && status >= 500) return true;
  return /no endpoints|guardrail|data policy|not a valid model|model not found|does not exist|current token plan|permission_denied|overloaded|temporarily unavailable|provider_overloaded/i.test(String(text || ''));
}

/**
 * 兜底候选（**跨供应商**）：同一家被限流时，换到另一家才救得回来。
 * 事故现场（2026-09-30）：用户下拉里选了商汤 `deepseek-v4-flash`，商汤额度被 agent 占满 →
 * 旧逻辑只会拿商汤的兜底模型再试一次（等于白试）→ 界面上就是"用不了"。
 * 现在：主模型失败后，补上另一个供应商的免费主模型（OpenRouter nemotron 免费版）。
 */
function fallbackCandidates(primary) {
  const out = [];
  const push = (m) => {
    if (m && m !== primary && !isBillableModel(m) && !out.includes(m)) out.push(m);
  };
  // ① 其它免费 OpenRouter 模型（按实测速度排序）——同家不同模型，通常几秒内就能顶上
  for (const m of FREE_FALLBACK_ORDER) push(m);
  // ② 另一家（商汤 deepseek-flash）作为最后手段（快，但账号额度紧张时会 429）
  if (providerOf(primary) !== 'sensenova') push(safeFallbackModel());
  return out;
}

/**
 * 按模型解析上游端点，返回可直接用于 fetch 的 url/headers，
 * 并把 body 里该写的 model 与推理参数一并给出（按供应商适配）。
 * 用法：const up = upstream(model, keyKind);
 *      fetch(up.url, { method:'POST', headers: up.headers, body: JSON.stringify({ model: up.model, ...}) })
 */
function upstream(model, keyKind = 'main') {
  // 最后防线：收费模型不许出网（用户要求只用免费模型）
  if (isBillableModel(model)) {
    const safe = agentConfig.model && !isBillableModel(agentConfig.model) ? agentConfig.model : 'deepseek-flash';
    console.warn(`[free-only] 拦截收费模型「${model}」→ 改用 ${safe}`);
    model = safe;
  }
  const ep = endpointFor(model, keyKind);
  return {
    url: `${ep.baseUrl}/chat/completions`,
    headers: ep.headers,
    model: ep.model || model,
    provider: ep.provider,
    providerName: ep.providerName,
    /** @param {string} effort none|low|medium|high */
    reasoning: (effort) => reasoningParams(ep.provider, effort),
  };
}
/**
 * 推理参数按供应商适配：商汤用顶层 reasoning_effort（none/low/medium/high）；
 * OpenRouter 用 reasoning 对象（none → 显式关闭，否则传 effort）。
 * 目的：短输出别把 max_tokens 烧在思考上（商汤那边已经踩过"返回空正文"的坑）。
 */
function reasoningParams(provider, effort) {
  const e = String(effort || '').toLowerCase();
  if (provider === 'openrouter') {
    if (!e || e === 'none') return { reasoning: { enabled: false } };
    return { reasoning: { effort: e } };
  }
  return { reasoning_effort: effort || 'low' };
}

/** 前端传来的 model 参数必须白名单校验，避免被当成任意模型代理。 */
function resolveModel(requested, fallback) {
  const id = typeof requested === 'string' ? requested.trim() : '';
  if (!id) return { model: fallback, denied: false };
  if (!MODEL_IDS.has(id)) return { model: fallback, denied: false, rejected: id };
  // 收费模型：直接拒绝，回退默认（用户要求只用免费模型）
  if (isBillableModel(id)) {
    console.warn(`[free-only] 拒绝收费模型「${id}」，回退到 ${fallback}`);
    return { model: fallback, denied: false, billable: true, rejected: id };
  }
  return { model: id, denied: false };
}

/* 模型可用性状态：不额外花配额去探测，而是"用真实请求学习"——
   403 permission_denied = 套餐未开通；404 = 网关不路由；200 = 可用；429 = 有权限但被限流。
   打底数据是 2026-09-16 实测结果；需要强制刷新时用 /api/agent/models?probe=1（会消耗配额，用户主动触发）。 */
const modelStatus = new Map();   // id -> { status, at, detail }
for (const [id, status] of Object.entries({
  'deepseek-flash': 'available',
  'deepseek-v4-flash': 'available',
  'kimi-k3': 'available',
  'glm-5.2': 'available',
  'sensenova-6.8-flash-lite': 'available',
  'deepseek-v4.1-flash': 'plan_denied',
  'deepseek-v4-pro': 'unknown',
  // OpenRouter：付费变体实测可用；免费变体被账号的隐私/数据策略挡住（2026-09-30 实测）
  'nvidia/nemotron-3-ultra-550b-a55b': 'available',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'available',   // 用户已开启免费端点（2026-09-30 实测 200/cost 0）
  'nvidia/nemotron-3.5-lightning:free': 'unknown',
})) modelStatus.set(id, { status, at: Date.now(), detail: 'seed:2026-09-30 实测' });

function isPlanDenied(text) { return /current token plan|permission_denied/i.test(String(text || '')); }
function noteModelStatus(model, status, detail = '') {
  if (!model) return;
  modelStatus.set(model, { status, at: Date.now(), detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 140) });
}
/** 从一次上游响应学习模型状态（所有调用上游的地方都该调它）。 */
function learnModelStatus(model, httpStatus, errText = '') {
  if (!model) return;
  if (httpStatus === 200) noteModelStatus(model, 'available', 'live');
  else if (httpStatus === 403 || isPlanDenied(errText)) noteModelStatus(model, 'plan_denied', errText);
  else if (/guardrail|data policy|no endpoints/i.test(String(errText))) noteModelStatus(model, 'guardrail', errText);
  else if (httpStatus === 404) noteModelStatus(model, 'not_found', errText);
  else if (httpStatus === 429) noteModelStatus(model, 'available', '有权限，当前被限流');
}
/** 套餐未开通时给用户的明确提示（区别于"限流，稍后再试"）。 */
const PLAN_DENIED_MSG = '该模型未在当前 SenseNova 套餐中开通，请先去控制台开通后重试';

/** 套餐未开通的模型直接拦下：省一次注定 403 的请求（配额很紧，别浪费）。 */
function planDeniedGuard(model) {
  return modelStatus.get(model)?.status === 'plan_denied';
}

async function probeOneModel(id) {
  try {
    const up = upstream(id);
    const r = await fetch(up.url, {
      method: 'POST',
      headers: up.headers,
      body: JSON.stringify({ model: up.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, ...up.reasoning('none') }),
      signal: AbortSignal.timeout(20000),
    });
    const errText = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 200);
    learnModelStatus(id, r.status, errText);
    return { id, http: r.status, provider: up.provider };
  } catch (e) {
    noteModelStatus(id, 'unknown', e.message);
    return { id, http: 0 };
  }
}

/** 模型目录 + 可用性（前端选择器用）。probe=1 强制实测刷新（会消耗配额）。 */
app.get('/api/agent/models', async (req, res) => {
  try {
    if (req.query.probe === '1') {
      const targets = MODEL_CATALOG.map((m) => m.id).filter((id) => modelStatus.get(id)?.status !== 'available');
      for (const id of targets) await probeOneModel(id);          // 串行，避免把紧缺的分钟配额一次性打空
    } else if (typeof req.query.probe === 'string' && MODEL_IDS.has(req.query.probe)) {
      await probeOneModel(req.query.probe);
    }
    res.json({
      success: true,
      defaultModel: agentConfig.model,
      fallbackModel: FALLBACK_MODEL,
      planDeniedMessage: PLAN_DENIED_MSG,
      providers: [
        { id: 'sensenova', name: PROVIDERS.sensenova.name, baseUrl: PROVIDERS.sensenova.baseUrl, keys: MAIN_KEYS.length, ready: MAIN_KEYS.length > 0 },
        { id: 'openrouter', name: PROVIDERS.openrouter.name, baseUrl: PROVIDERS.openrouter.baseUrl, keys: OPENROUTER_KEY ? 1 : 0, ready: Boolean(OPENROUTER_KEY) },
      ],
      models: MODEL_CATALOG.map((m) => {
        const s = modelStatus.get(m.id) || { status: 'unknown', at: 0, detail: '' };
        const billable = Boolean(m.billable) || isBillableModel(m.id);
        return {
          id: m.id, label: m.label, note: m.note, provider: providerOf(m.id),
          status: billable ? 'billable_disabled' : s.status,
          billable,
          disabled: billable || s.status === 'plan_denied',   // 前端据此置灰
          disabledReason: billable ? '收费模型 · 本站只允许免费模型'
            : (s.status === 'plan_denied' ? '需在 SenseNova 控制台开通 token plan' : ''),
          checkedAt: s.at, detail: s.detail, isDefault: m.id === agentConfig.model,
        };
      }),
      freeOnly: true,   // 站点策略：只允许免费模型
    });
  } catch (e) {
    res.json({ success: false, error: e.message, defaultModel: agentConfig.model, models: [] });
  }
});

// ========== Key 池：主模型+画图 与 内测(dualMode) 完全隔离 ==========
// 主池：主模型对话 + 画图共用（从 MAIN_KEY_POOL 读取，兼容旧 OPENAI_KEY_POOL / OPENAI_API_KEY）
const MAIN_KEYS = (process.env.MAIN_KEY_POOL || process.env.OPENAI_KEY_POOL || process.env.OPENAI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
// 内测专用池：dualMode（Pixel/Kit 辩论、补充等多调用场景）单独使用，避免拖累主模型额度/并发
const DUAL_KEYS = (process.env.DUAL_KEY_POOL || '').split(',').map(k => k.trim()).filter(Boolean);

// 画图专用 key：优先用「主池后面的 key」，避免画图限流把主对话第 1 条 key 打爆
const IMAGE_KEYS = MAIN_KEYS.length >= 2 ? MAIN_KEYS.slice(1) : MAIN_KEYS.slice();

// 从指定池里轮询取 key（用独立计数器对象，多个池互不干扰）
function pickKey(pool, idxObj) {
  if (pool.length === 0) throw new Error('未配置 API Key，请在 .env 中设置 MAIN_KEY_POOL / OPENAI_API_KEY');
  const key = pool[idxObj.i % pool.length];
  idxObj.i++;
  return key;
}
let mainKeyIdx = { i: 0 }, dualKeyIdx = { i: 0 }, imageKeyIdx = { i: 0 };

// 通用取 key：kind 默认 'main'；内测调用传入 'dual' 走独立池
function getNextKey(kind = 'main') {
  if (kind === 'dual' && DUAL_KEYS.length > 0) return pickKey(DUAL_KEYS, dualKeyIdx);
  return pickKey(MAIN_KEYS, mainKeyIdx);
}
// 画图取 key：从主池的「后面部分」取，主对话优先用第 1 条
function getNextImageKey() {
  if (IMAGE_KEYS.length === 0) return getNextKey('main');
  return pickKey(IMAGE_KEYS, imageKeyIdx);
}
console.log(`[Key 池] 主池: ${MAIN_KEYS.length} 条, 内测池: ${DUAL_KEYS.length} 条, 画图专用: ${IMAGE_KEYS.length} 条`);
// 把商汤 key 池挂到 provider 上（provider 定义在前，key 池在后，这里补一次）
PROVIDERS.sensenova.keys = MAIN_KEYS;
console.log(`[供应商] 商汤 key ${MAIN_KEYS.length} 条 · OpenRouter key ${OPENROUTER_KEY ? '已配置' : '未配置'} · 兜底模型 ${FALLBACK_MODEL}`);

/* ========== 上游限流：熔断器 + 并发闸门 ==========
   2026-09-12 实测（探针见 scripts/ai-retry-check.mjs --live）：
     ① 429 响应不带 retry-after / x-ratelimit-* 任何头 —— 无法从响应头感知配额；
     ② 三条 main key 共用同一个账号额度，同一分钟窗口大约只放行 3 次：成功 3 次后换 key 依旧 429；
     ③ 0.5s/1s/2s 的秒级退避三次重试全部落在同一分钟窗口内 —— 白等；配额按分钟整点边界重置。
   所以：能识别分钟级配额就等到下一个分钟边界（上限 65s）；交互式请求宁可快速失败，
   把 retryAfterMs 交给前端重试，也不让用户干等一分钟；连续失败到阈值直接熔断，
   避免把配额窗口一直摁死、也避免拖垮同账号的其它项目（agent 与本站共用同一个 key）。 */
const AI_QUOTA_BREAKER = createBreaker({
  threshold: Number(process.env.AI_BREAKER_THRESHOLD) || 3,
  cooldownMs: Number(process.env.AI_BREAKER_COOLDOWN_MS) || 60000,
});
const AI_PACER = createPacer({
  maxConcurrent: Number(process.env.AI_MAX_CONCURRENT) || 2,
  // 两次上游调用之间的最小间隔：防 rps exhausted（预检+正式请求背靠背会撞每秒限流）
  minGapMs: process.env.AI_MIN_GAP_MS !== undefined ? Number(process.env.AI_MIN_GAP_MS) : 300,
});
// 交互式请求（用户正盯着界面等）允许的最长等待；超过就快速失败 + 把 retryAfterMs 给前端
const AI_INTERACTIVE_MAX_WAIT_MS = Number(process.env.AI_INTERACTIVE_MAX_WAIT_MS) || 20000;

/**
 * 统一处理一次"上游限流"：记熔断、算等待、按需打日志。
 * @returns {{ waitMs:number, failFast:boolean, retryAfterMs:number }}
 *   failFast=true 表示等待时长超过交互上限（或已触发熔断），调用方应立刻失败返回，
 *   并把 retryAfterMs 告诉前端，让前端在合适的时候重试。
 */
function handleQuotaHit({ attempt, errText, headers, label = 'AI', attemptTotal = 3, maxWaitMs = AI_INTERACTIVE_MAX_WAIT_MS }) {
  const retryAfterMsRaw = parseRetryAfterMs(headers);
  const need = quotaWaitMs({ attempt, errText, retryAfterMs: retryAfterMsRaw, maxWaitMs: DEFAULT_MAX_WAIT_MS });
  // RPS（每秒级）是瞬时抖动：等一下就恢复，不计入熔断，避免把正常请求锁死
  const rps = isRpsQuotaText(errText);
  const tripped = rps ? false : AI_QUOTA_BREAKER.fail();
  if (tripped) {
    const open = AI_QUOTA_BREAKER.state.retryAfterMs;
    console.warn(`[${label} 限流] 连续失败触发熔断，${describeWait(open)} 内直接快速失败（不再空转上游）`);
    return { waitMs: 0, failFast: true, retryAfterMs: open };
  }
  if (need > maxWaitMs) {
    console.warn(`[${label} 限流] 需等 ${describeWait(need)}（分钟窗口），超过上限 ${describeWait(maxWaitMs)}，快速失败交给前端重试`);
    return { waitMs: 0, failFast: true, retryAfterMs: need };
  }
  console.log(`[${label} 限流] ${String(errText || '').slice(0, 90)} → 等 ${describeWait(need)} 后重试 ${attempt + 1}/${attemptTotal}`);
  return { waitMs: need, failFast: false, retryAfterMs: need };
}

// 过滤模型自我暴露句式（仅替换 AI 说"我是XX模型"类表述，不影响正常讨论中的模型名称）
/**
 * 剥掉"思维链当正文吐出来"的部分。
 * 实测 nemotron-3.5-lightning（免费版）在关闭 reasoning 的情况下，仍会把
 * "Here's a thinking process: 1. **Analyze the Request:** …" 直接写进 content，
 * 用户看到的回复就是一堆分析而不是答案。
 * 策略保守：只有**开头**出现思考标记才处理；优先切到显式的"Final Answer"；
 * 否则按行跳过分析块；切完为空则原样返回，绝不把回复吃光。
 */
function stripInlineThinking(text) {
  const t = String(text || '');
  const head = t.slice(0, 300).toLowerCase();
  const markers = ['thinking process', 'think process', 'reasoning process', 'chain of thought',
    'let me think', 'let\'s think', '思考过程', '让我想想', '分析过程'];
  if (!markers.some((m) => head.includes(m))) return t;

  // ① 显式答案标记优先
  const answerRe = /(\*\*\s*(?:final\s*)?answer\s*\*\*\s*[:：]?|(?:final\s*)?answer\s*[:：]|(?:最终)?(?:回答|答复|答案)\s*[:：])/i;
  const am = t.match(answerRe);
  if (am && am.index > 0) {
    const cut = t.slice(am.index + am[0].length).trim();
    if (cut.length > 1) return cut;
  }

  // ② 按行跳过：思考标题行 → 连续的分析/编号行，直到像是正文的段落
  const lines = t.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || /think|reason|思考|分析/i.test(lines[i]))) i++;
  while (i < lines.length) {
    const L = lines[i].trim();
    if (L === '') { i++; continue; }
    const looksAnalysis = /^(\d+[.)、]|[-*·]\s|\*\*)/.test(L) || /[:：]\s*$/.test(L);
    if (!looksAnalysis) break;
    i++;
  }
  const rest = lines.slice(i).join('\n').trim();
  return rest.length > 1 ? rest : t;
}

function sanitizeReply(text) {
  let result = stripInlineThinking(text);
  // 去 LaTeX 数学表达式（保留行内公式的文本形式）
  result = result.replace(/\\\[[\s\S]*?\\\]/g, '');
  result = result.replace(/\\\([\s\S]*?\\\)/g, '');
  result = result.replace(/\$([^$]+)\$/g, '$1');
  result = result.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)');
  result = result.replace(/\\ln\b/g, 'ln').replace(/\\cdot\b/g, '*').replace(/\\times\b/g, '×');
  result = result.replace(/\\sqrt\b/g, '√').replace(/\\pi\b/g, 'π').replace(/\\int\b/g, '∫');
  result = result.replace(/\\sum\b/g, '∑').replace(/\\infty\b/g, '∞').replace(/\\rightarrow\b/g, '→');
  result = result.replace(/\\Rightarrow\b/g, '⇒').replace(/\\pm\b/g, '±');

  // 仅过滤自我暴露句式（模型说自己是谁），不做全局文本替换
  const SELF_PATTERNS = [
    // "我是/我叫 XX 模型" "I am XX model"
    /(?:我是|我叫|我是由|我是来自)\s*(?:SensenNova|sensenova|DeepSeek|deepseek|商汤|商汤科技|商量)[\s\w.-]*?(?:模型|大模型|AI|助手)?/gi,
    /(?:I\s*(?:'m|am)\s*(?:powered\s*by\s*)?)\s*(?:SensenNova|sensenova|DeepSeek|deepseek)[\s\w.-]*?(?:\s*(?:model|AI|assistant))?/gi,
    // "基于XX大模型" "built on XX"
    /(?:基于|由|采用|使用)\s*(?:SensenNova|sensenova|DeepSeek|deepseek|商汤|商汤科技|商量|日日新)[\s\w.-]*?(?:模型|大模型|技术|提供支持)?/gi,
    /(?:built\s*(?:on|upon)|powered\s*by)\s*(?:SensenNova|sensenova|DeepSeek|deepseek)[\s\w.-]*/gi,
    // "日日新融合模态大模型"
    /日日新融合模态大模型/g,
  ];
  for (const p of SELF_PATTERNS) {
    result = result.replace(p, 'AI助手');
  }

  return result.trim();
}

// 双角色幻觉过滤（只在 !dualMode 没开内测时调用）
// 删掉 Kit/Pixel 冒号行、你行你上啊/别吵了/闭嘴等回怼废话、掀桌颜文字整句废话
// 单独抽出来是为了避免在内测模式下误杀 Kit 的正常发言风格
function filterDualDelusions(text, isDualMode = false) {
  if (!text) return text;
  let result = text;
  // 1) 去掉所有以「Kit」「Pixel」开头 + 中英文冒号的一整行（永远执行）
  result = result.replace(/^(?:Kit|Pixel|KIT|PIXEL)\s*[:：][^\n]*(\n|$)/gim, '');
  // 1.5) 去掉 Pixel 直接对 Kit 说话的幻觉行（主回复只应对用户说话，不应跟 Kit 对话）
  //       覆盖："Kit，" "Kit。" "Kit！" "Kit、" 以及 "Kit啊" "Kit呢" 等呼唤句式
  result = result.replace(/^(?:Kit|KIT)\s*[，。！？、～~][^\n]*(\n|$)/gim, '');
  result = result.replace(/^(?:Kit|KIT)\s*(?:啊|呀|呢|哦|吧|嘛|喂)[^\n]{0,50}(\n|$)/gim, '');
  //       也覆盖行中间的 "，Kit，"（句号后突然开始跟 Kit 对话）
  result = result.replace(/(?:^|[。！？])\s*(?:Kit|KIT)\s*[，。！？、][^\n]*(\n|$)/gim, '');
  // 2) 非内测模式：只删明确的吵架句（不再匹配"好不好/行不行"等正常疑问句式，避免误删礼貌询问）
  if (!isDualMode) {
    result = result.replace(/[^\n]*(?:你闭嘴|闭嘴啦|别吵了|不要说了|你行你上|你试试)[^\n]*[。！？!?.]?\n?/gi, '');
    // 3) 颜文字掀桌整行废话
    result = result.replace(/^[^\n]*(?:\(╯[^\n]{0,10}╯|┻━┻|（\(?[^\n]{2,15}[)）]{1,3}\)?\s*)[^\n]*(\n|$)/gim, '');
  }
  return result.trim();
}

// 历史消息去痕：关闭内测模式时，从 history 里彻底清掉所有 Kit/Pixel 自导自演的幻觉痕迹，
// 避免残留对话作为 few-shot 示例反复诱导下一轮模型继续 Pattern Match 续写幻觉。
function cleanHistoryForDual(history, dualMode) {
  if (dualMode) return history; // 开了内测模式就保留 Kit/Pixel 辩论历史
  return history.map(m => {
    if (m.role === 'assistant' && typeof m.content === 'string') {
      // 过一遍双重过滤（sanitizeReply去模型暴露 + filterDualDelusions 去双角色幻觉）
      let c = sanitizeReply(m.content);
      c = filterDualDelusions(c);
      // 额外去 assistant 内容前缀里之前写的 toolSummary（[已调用天气工具 xxx]），
      // 之前是为了修复工具死循环写进 session 的，这里清洗后只保留真正的助手回复内容
      c = c.replace(/^\[(?:已调用|Kit已调用)[^\]]*\][\s\S]*?\n\n/gi, '');
      c = c.trim();
      return { ...m, content: c || m.content };
    }
    return m;
  });
}

// 辩论消息清理：Kit 不能有 emoji，Pixel 不能有颜文字
function sanitizeDebateReply(text, speaker) {
  let result = sanitizeReply(text);
  if (speaker === 'Kit') {
    result = result.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{2934}\u{2935}\u{231A}\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{2B50}\u{2B55}]/gu, '');
    result = result.replace(/[✨⭐🌟💫★☆❤♥♡💕💗💖]/gu, '');
  } else if (speaker === 'Pixel') {
    result = result.replace(/[（(][^()（）]{2,20}[)）]/g, '');
  }
  result = filterRoleLines(result, speaker);
  return result.trim();
}

// 源头统一过滤对面角色冒号行 + 对话式冒号行（流式/非流式都走这里）
// 防止模型在 Pixel 回复里自导自演「我：」「用户：」「Kit：」「Pixel：」格式的整段对话 + 无限死循环重复
//  speaker: 'Pixel' | 'Kit' | 'AI助手'（AI助手 = Pixel 视角）
function filterRoleLines(text, speaker) {
  if (!text) return text;
  let result = text;
  // 1) 先去 Pixel说:/Kit说: 前缀（永远执行）
  result = result.replace(/^(Pixel|Kit)\s*[说：:]\s*/gm, '');
  // 2) 只删除 Pixel/Kit 自导自演的「角色名 + 冒号」整行（这是唯一真正要防的剧本幻觉）
  //    不再匹配 我/你/用户/模型/AI 等普通词，避免误删正常科普/举例句（例如「模型：Transformer 是...」）
  const ROLE_LINE_RE = /^(?:Pixel|Kit|PIXEL|KIT|Kit的|Pixel的)\s*[:：][^\n]*(\n|$)/gim;
  result = result.replace(ROLE_LINE_RE, '');

  // 3) 只删「纯吵架句」：吵架词后只允许标点就到行尾，正常疑问句（如"你试试这个方案吧"）保留
  result = result.replace(/^[^\n]*(?:你闭嘴|闭嘴啦|别吵了|不要说了|你行你上|你试试)\s*[。！？!?.]?\s*$/gim, '');

  // 4) 重复句子检测（防死循环复读，阈值放宽到几乎只拦真正的连续复读）
  //    - 同一句出现 >=3 次 且 全文重复句总数 >5 时，才丢弃后续重复行
  const lines = result.split(/\r?\n/);
  const seen = new Map(); // fingerprint -> count
  let totalRepeat = 0;
  const kept = [];
  for (const raw of lines) {
    const fp = raw.trim()
      .replace(/[，。！？、；：""''（）【】《》!?,.\s]/g, '')
      .replace(/^(我|你|Kit|Pixel)[：:]/i, '')
      .toLowerCase();
    if (!fp) { kept.push(raw); continue; }
    const count = (seen.get(fp) || 0) + 1;
    seen.set(fp, count);
    if (count >= 2) {
      totalRepeat++;
      if (count >= 3 && totalRepeat > 5) continue; // 仅同一句连刷3次以上才丢，正常重复保留
    }
    kept.push(raw);
  }
  result = kept.join('\n');

  // 5) 清理被正则删空后留下的多行空行
  result = result.replace(/\n{3,}/g, '\n\n').trimStart();

  // 6) 连续重复检测：仅当「连续 >=3 行内容完全相同」才判定为死循环 spam 并截断
  //    正常长文中两处相似术语/开头不会再被误判（不再用「前200字符指纹后文重现」做全文截断）
  const arr = result.split(/\r?\n/);
  for (let i = 0; i < arr.length - 2; i++) {
    if (arr[i] && arr[i] === arr[i + 1] && arr[i] === arr[i + 2]) {
      result = arr.slice(0, i + 2).join('\n') + '\n…';
      break;
    }
  }
  return result;
}

// ==================== 反馈矫正系统 ====================
// 用户点 👎 → AI 分析原因 → 存矫正规则 → 下次自动规避
// 存储: data/corrections/{userId}.json

const correctionsDir = path.join(__dirname, 'data', 'corrections');
await fs.mkdir(correctionsDir, { recursive: true });

function getCorrectionsFile(userId) {
  return path.join(correctionsDir, `${userId}.json`);
}

function loadCorrections(userId) {
  const cached = correctionCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const data = JSON.parse(readFileSync(getCorrectionsFile(userId), 'utf-8'));
    correctionCache.set(userId, { data, ts: Date.now() });
    return data;
  } catch { return []; }
}

function saveCorrections(userId, corrections) {
  writeFileSync(getCorrectionsFile(userId), JSON.stringify(corrections, null, 2));
  correctionCache.set(userId, { data: corrections, ts: Date.now() });
}

/** 检索与当前消息相关的矫正规则 */
function retrieveCorrections(userId, message, limit = 2) {
  const corrections = loadCorrections(userId);
  if (!corrections.length || !message) return [];
  const msgKeywords = extractKeywords(message);
  if (!msgKeywords.length) return [];

  const scored = corrections.map(c => {
    let score = 0;
    for (const kw of msgKeywords) {
      for (const ck of (c.keywords || [])) {
        if (kw.includes(ck) || ck.includes(kw)) score++;
      }
    }
    return { corr: c, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.corr);
}

// 反馈 API：用户点 👎 后调用
app.post('/api/agent/feedback', async (req, res) => {
  try {
    const { userId, rating, speaker, message, reply } = req.body;
    if (!userId || rating !== 'bad') return res.json({ ok: true });

    // AI 分析为什么不好，生成矫正规则
    const { model } = agentConfig;
    const up = upstream(model);
    const resp = await fetch(up.url, {
      method: 'POST',
      headers: up.headers,
      body: JSON.stringify({
        model: up.model, temperature: 0.2, max_tokens: 150, ...up.reasoning('none'),
        messages: [
          { role: 'system', content: `你是AI行为矫正分析器。用户对 ${speaker || 'AI'} 的回复不满意。

分析原因，输出一条10字以内的矫正规则，格式："规则: <内容>"

常见问题类型：
- 语气不当（太冲、太冷淡、太肉麻）
- 答非所问（没理解用户意图）
- 信息错误（事实性错误）
- 话题敏感（不该碰的话题）

输出示例：
规则: 聊到工资时别太毒舌
规则: 用户说反话时认真回答
规则: 不用再搜这个话题了` },
          { role: 'user', content: `用户说: ${message}\nAI回复: ${reply}` }
        ]
      })
    });
    if (!resp.ok) return res.json({ ok: true });

    const data = await resp.json();
    const ruleText = sanitizeReply(data.choices?.[0]?.message?.content || '');
    const match = ruleText.match(/规则:\s*(.+)/);
    if (!match) return res.json({ ok: true });

    const rule = match[1].trim();
    if (rule.length < 2) return res.json({ ok: true });

    const corrections = loadCorrections(userId);
    // 去重
    if (corrections.find(c => c.content === rule)) return res.json({ ok: true });

    corrections.push({
      id: 'corr_' + Date.now(),
      content: rule,
      keywords: extractKeywords(rule),
      speaker,
      fromMessage: message.slice(0, 200),
      fromReply: reply.slice(0, 200),
      createdAt: Date.now()
    });

    // 最多30条
    if (corrections.length > 30) corrections.splice(0, corrections.length - 30);
    saveCorrections(userId, corrections);
    console.log(`矫正: ${userId} 新增规则 "${rule}", 共 ${corrections.length} 条`);
    res.json({ ok: true, rule });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ==================== 长期记忆系统 ====================
// 每个用户独立存储，跨会话持久化
// 检索：关键词匹配 → 注入系统提示词
// 写入：对话结束时 AI 自动提取关键信息

const memoriesDir = path.join(__dirname, 'data', 'memories');
await fs.mkdir(memoriesDir, { recursive: true });

function getMemoryFile(userId) {
  return path.join(memoriesDir, `${userId}.json`);
}

// 内存缓存，避免每次消息都读磁盘
const memoryCache = new Map();    // userId → { data, ts }
const correctionCache = new Map();
const CACHE_TTL = 30 * 1000;     // 30秒后重新读磁盘（处理多端同步情况）

function loadMemories(userId) {
  const cached = memoryCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const raw = readFileSync(getMemoryFile(userId), 'utf-8');
    const data = JSON.parse(raw);
    memoryCache.set(userId, { data, ts: Date.now() });
    return data;
  } catch {
    return [];
  }
}

function saveMemories(userId, memories) {
  try {
    writeFileSync(getMemoryFile(userId), JSON.stringify(memories, null, 2));
    memoryCache.set(userId, { data: memories, ts: Date.now() });
  } catch (e) {
    console.error('保存记忆失败:', e.message);
  }
}

/** 从中文文本提取关键词（简单词频） */
function extractKeywords(text) {
  if (!text) return [];
  // 去掉标点、数字、英文、空白
  const cleaned = text.replace(/[，。！？、；：""''（）《》【】\s\d\w]/g, '');
  // 按2-4字滑动窗口提取词组
  const words = [];
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      words.push(cleaned.slice(i, i + len));
    }
  }
  // 去重取前 8 个
  return [...new Set(words)].slice(0, 8);
}

/** 从用户消息中匹配相关记忆 */
function retrieveMemories(userId, message, limit = 3) {
  const memories = loadMemories(userId);
  if (!memories.length || !message) return [];
  const msgKeywords = extractKeywords(message);
  if (!msgKeywords.length) return [];

  const scored = memories.map(m => {
    let score = 0;
    for (const kw of msgKeywords) {
      for (const mk of (m.keywords || [])) {
        if (kw.includes(mk) || mk.includes(kw)) score++;
      }
    }
    // 最近匹配过的加权
    const hoursAgo = (Date.now() - (m.lastMatched || m.createdAt)) / 3600000;
    const timeBonus = Math.max(0, 1 - hoursAgo / 24); // 24小时内权重递减
    return { mem: m, score: score + timeBonus * 2 };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => {
      s.mem.lastMatched = Date.now();
      return s.mem;
    });
}

/** AI 提取记忆：从一轮对话中识别值得记住的信息 */
async function extractMemory(userId, userMsg, aiReply) {
  if (!aiReply || aiReply.length < 10) return;
  const combined = `用户: ${userMsg}\nAI: ${aiReply}`;

  const { model } = agentConfig;
  const up = upstream(model);

  try {
    const res = await fetch(up.url, {
      method: 'POST',
      headers: up.headers,
      body: JSON.stringify({
        model: up.model, temperature: 0.2, max_tokens: 200, ...up.reasoning('none'),
        messages: [
          { role: 'system', content: `你是信息提取助手。从对话中提取用户透露的个人信息、偏好、决定或事实。只提取用户的，不提取AI的。
输出格式（每行一条，没有就输出"无"）：
事实: <一句话>
偏好: <一句话>
话题: <一句话>（3-5字主题标签）

示例：
用户说"我养了一只布偶猫叫团团"
→ 事实: 用户养了一只布偶猫叫团团 | 偏好: 无 | 话题: 宠物

用户说"我喜欢简约风的设计"
→ 事实: 无 | 偏好: 用户喜欢简约风格设计 | 话题: 设计` },
          { role: 'user', content: combined }
        ]
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    const extracted = sanitizeReply(data.choices?.[0]?.message?.content || '');

    const memories = loadMemories(userId);
    let added = 0;

    for (const line of extracted.split('\n')) {
      const factMatch = line.match(/^事实:\s*(.+)/);
      const prefMatch = line.match(/^偏好:\s*(.+)/);
      const topicMatch = line.match(/^话题:\s*(.+)/);

      const content = factMatch?.[1] || prefMatch?.[1];
      const type = factMatch ? 'fact' : prefMatch ? 'pref' : null;
      const topic = topicMatch?.[1];

      if (!content || content === '无' || content.length < 3) continue;

      // 去重：相似内容不重复存
      const dup = memories.find(m => {
        const overlap = content.split('').filter(c => m.content.includes(c)).length;
        return overlap > content.length * 0.6;
      });
      if (dup) continue;

      memories.push({
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        content: content.trim(),
        keywords: extractKeywords(content.trim()),
        type,
        topic: topic && topic !== '无' ? topic.trim() : null,
        createdAt: Date.now(),
        lastMatched: Date.now()
      });
      added++;
    }

    if (added > 0) {
      // 超过100条删最旧的未匹配记忆
      const pruned = memories
        .sort((a, b) => (b.lastMatched || 0) - (a.lastMatched || 0))
        .slice(0, 100);
      saveMemories(userId, pruned);
      console.log(`记忆: ${userId} 新增 ${added} 条, 总计 ${pruned.length} 条`);
    }
  } catch (e) {
    console.error('提取记忆失败:', e.message);
  }
}

// ==================== 会话记忆系统 ====================
// 心跳保活（3分钟无心跳 = 关闭窗口 → 过期）
// 长对话自动摘要压缩（超过20条时，AI总结早期对话）
// 持久化：每个会话存为 data/sessions/{id}.json，服务器重启不丢失

const sessionsDir = path.join(__dirname, 'data', 'sessions');
await fs.mkdir(sessionsDir, { recursive: true });

const sessions = new Map();
const SESSION_TTL = 3 * 60 * 1000; // 3分钟无心跳过期（内存中）

// 会话持久化：存到磁盘
async function saveSessionToDisk(session) {
  try {
    const file = path.join(sessionsDir, `${session.id}.json`);
    const data = {
      id: session.id,
      userId: session.userId || '',          // 归属随会话一起落盘
      messages: session.messages.slice(-100),  // 最多保留最近100条
      summary: session.summary || '',
      lastPing: session.lastPing,
      updated: Date.now()
    };
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('保存会话失败:', e.message);
  }
}

// 从磁盘加载单个会话
async function loadSessionFromDisk(sessionId) {
  try {
    const file = path.join(sessionsDir, `${sessionId}.json`);
    const raw = await fs.readFile(file, 'utf-8');
    const data = JSON.parse(raw);
    return {
      id: data.id,
      userId: data.userId || '',          // 从磁盘恢复归属
      messages: data.messages || [],
      summary: data.summary || '',
      lastPing: Date.now() // 重新激活
    };
  } catch {
    return null;
  }
}

function getSession(sessionId, userId) {
  if (!sessionId || !sessions.has(sessionId)) return null;
  const s = sessions.get(sessionId);
  // 归属校验：会话已绑定用户、且请求者不是本人 → 视为不存在（防偷看别人历史）
  if (userId && s.userId && s.userId !== userId) return null;
  if (Date.now() - s.lastPing > SESSION_TTL) {
    // 过期前先存盘再清理
    saveSessionToDisk(s).catch(() => {});
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

function createSession(userId = '') {
  const id = 'sess_' + uuidv4().substring(0, 8);
  const session = {
    id, userId: userId || '',          // 归属：谁建的会话绑谁
    messages: [], summary: '', lastPing: Date.now(),
    // 延迟存盘（防抖：2秒内多次调用只存一次）
    _saveTimer: null,
    scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => saveSessionToDisk(this).catch(() => {}), 2000);
    }
  };
  sessions.set(id, session);
  return session;
}

// 每次存消息后自动保存（防抖，2秒后存盘）
async function persistSession(session) {
  if (session && session.scheduleSave) session.scheduleSave();
}

// 心跳：前端每60秒发一次，保持会话存活
app.post('/api/agent/ping', (req, res) => {
  const s = getSession(req.body.sessionId);
  if (s) { s.lastPing = Date.now(); res.json({ alive: true }); }
  else { res.json({ alive: false }); }
});

// 查看/管理长期记忆
app.get('/api/agent/memories', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ memories: [], count: 0 });
  const memories = loadMemories(userId);
  res.json({ memories, count: memories.length });
});

/* ========== 会话归属：没有设备标识就不给看、不给删 ==========
   2026-10-08 外部审计发现：这三个接口不校验归属，任何人裸访问
   /api/agent/sessions 都能拿到全站所有访客的会话摘要与全文（网页左侧列表里也直接显示别人的对话）。
   现在：必须带 userId（或 x-pk-user 头），且只认 data.userId === userId 的会话；
   历史遗留的"无主"会话一律隐藏（宁可看不到，也不公开）。 */
function sessionUserId(req) {
  const uid = req.query.userId || req.headers['x-pk-user'];
  return (typeof uid === 'string' && uid.trim().length >= 6) ? uid.trim() : null;
}
function denyNoUser(res) {
  return res.status(401).json({ success: false, error: '缺少设备标识，请刷新页面后重试' });
}

// 加载历史会话（前端打开页面时调用）
app.get('/api/agent/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const userId = sessionUserId(req);
  if (!userId) return denyNoUser(res);
  // 先查内存（只认本人）
  const s = getSession(sessionId, userId);
  if (s && s.userId === userId) {
    return res.json({ success: true, session: { id: s.id, messages: s.messages, summary: s.summary } });
  }
  // 再查磁盘：必须是本人的会话
  const diskSession = await loadSessionFromDisk(sessionId);
  if (diskSession && diskSession.userId === userId) {
    sessions.set(sessionId, diskSession);
    return res.json({ success: true, session: { id: diskSession.id, messages: diskSession.messages, summary: diskSession.summary } });
  }
  if (diskSession || s) return res.status(403).json({ success: false, error: '无权访问该会话' });
  res.status(404).json({ success: false, error: '会话不存在' });
});

// 列出会话：只返回本人的
app.get('/api/agent/sessions', async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return denyNoUser(res);
  try {
    const files = await fs.readdir(sessionsDir);
    const sessionList = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(sessionsDir, f), 'utf-8');
        const data = JSON.parse(raw);
        if (data.userId !== userId) continue;      // 严格归属：不是本人的一律不返回
        const msgCount = data.messages?.length || 0;
        const lastMsg = msgCount > 0 ? data.messages[data.messages.length - 1] : null;
        const preview = lastMsg ? lastMsg.content?.substring(0, 80) : '(空对话)';
        sessionList.push({
          id: data.id,
          messageCount: msgCount,
          preview,
          updated: data.updated || data.lastPing
        });
      } catch {}
    }
    sessionList.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    res.json({ success: true, sessions: sessionList.slice(0, 20) });
  } catch {
    res.json({ success: true, sessions: [] });
  }
});

// 删除会话：必须本人
app.delete('/api/agent/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const userId = sessionUserId(req);
  if (!userId) return denyNoUser(res);
  const mem = sessions.get(sessionId);
  const file = path.join(sessionsDir, `${sessionId}.json`);
  let disk = null;
  try { const raw = await fs.readFile(file, 'utf-8'); disk = JSON.parse(raw); } catch { /* 不存在 */ }
  const owner = mem?.userId || disk?.userId || null;
  if (!owner || owner !== userId) {
    return res.status(403).json({ success: false, error: '无权删除该会话' });
  }
  sessions.delete(sessionId);
  try { await fs.unlink(file); } catch { /* ignore */ }
  res.json({ success: true });
});

// 5分钟清理一次过期会话（存盘后清理内存）
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastPing > SESSION_TTL) {
      saveSessionToDisk(s).catch(() => {});
      sessions.delete(id);
    }
  }
}, 300000);

// AI 摘要压缩：对话太长时，总结早期消息
async function compressMemory(session) {
  const { model } = agentConfig;
  const up = upstream(model);
  if (session.messages.length < 20) return;
  
  const oldMessages = session.messages.slice(0, 10);
  const oldText = oldMessages.map(m => `${m.role}: ${m.content}`).join('\n');
  const existingSummary = session.summary ? `之前的摘要：${session.summary}\n` : '';
  
  try {
    const res = await fetch(up.url, {
      method: 'POST',
      headers: up.headers,
      body: JSON.stringify({
        model: up.model, temperature: 0.3, max_tokens: 400, ...up.reasoning('none'), messages: [
          { role: 'system', content: '用1-2句中文总结以下对话的关键信息（用户说了什么、你的回复要点）。' },
          { role: 'user', content: existingSummary + oldText }
        ]
      })
    });
    if (res.ok) {
      const data = await res.json();
      session.summary = sanitizeReply(data.choices?.[0]?.message?.content || session.summary);
    }
  } catch {}
  // 删掉已摘要的消息，保留最近10条
  session.messages = session.messages.slice(10);
}

const SYSTEM_PROMPT = () => {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' });
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `【重要：现在是 ${year} 年 ${month} 月 ${day} 日 ${timeStr} 北京时间。今年就是 ${year} 年，所有 ${year} 年的事件已经发生或正在发生，不要说"还有X年"。你的训练数据可能截止较早，请以这个日期为准。】\n\n你是 Pixel，PixelKit 的元气小助手 ✨ 俏皮可爱，纯文本+emoji。Kit 是你的毒舌搭档。如果用户提到 Kit，那是用户在跟 Kit 说话，你别代 Kit 回应。\n\n⚠️ 时效内容必须调用工具搜索。不确定的事别瞎编。搜索时用当前日期 ${year}年${month}月${day}日 构造查询。\n\n🔍 搜索规则（严格遵循）：\n1. 任何需要联网搜索的问题，优先调用 zhihu_search\n2. 只有 zhihu_search 返回的结果不足以回答时，才补调 web_search\n3. 如果用户明确要看某个具体网页，直接调 fetch_url\n\n❌ 绝不说模型名称、参数、架构。被问就说"我负责卖萌干活儿～"。`;
};

// ==================== SSE 流式工具 ====================
/* 推理开关策略（依据 SenseNova 文档：reasoning_effort = none / low / medium / high，默认 medium）：
   ① 一次性短输出（批注、墓志铭、摘要、记忆抽取/压缩、反馈分析、工具路由、轻量识图、对战落子）→ none
      —— 否则推理会把 max_tokens 吃光，正文为空（finish_reason=length）；
   ② 交互式对话（本函数，主助手/子代理/工具循环）→ 默认 low：开推理保证判断力，又不至于把延迟和额度拉满；
      可用环境变量 CHAT_REASONING_EFFORT=none|low|medium|high 覆盖（none 即完全关闭推理）；
   ③ 重推理任务（研究子代理、图片 prompt 优化等大预算调用）→ 不传，走官方默认 medium。 */
async function fetchAIStream(messages, modelToUse, apiKey, tools = null, temperature = 0.7, maxTokens = 3000, keyKind = 'main') {
  // 主模型 + 兜底模型（另一个供应商）依次尝试：一家被限流/被策略挡住时，站点不至于整块不可用
  const candidates = [modelToUse, ...fallbackCandidates(modelToUse)];

  // 熔断中：不要再打上游，直接失败（上层会给用户降级文案）
  const gate = AI_QUOTA_BREAKER.check();
  if (!gate.ok) {
    console.warn(`[AI 限流] 熔断中，${describeWait(gate.retryAfterMs)} 内跳过上游调用`);
    return null;
  }

  let lastError = null;
  for (let ci = 0; ci < candidates.length; ci++) {
    const model = candidates[ci];
    let ep;
    try { ep = endpointFor(model, keyKind); } catch (e) { lastError = e; break; }
    if (ep.degradedFrom) { model = ep.model; }        // 该供应商没配 key 时 endpointFor 已降级
    const body = {
      model, messages, temperature, max_tokens: maxTokens, stream: true,
      ...reasoningParams(ep.provider, process.env.CHAT_REASONING_EFFORT || 'low'),
    };
    if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

    let tryNextProvider = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      // 30s 连接超时：只卡「连不上/拿不到响应头」，拿到响应头就放行，不切断后续流式输出
      const release = await AI_PACER.acquire();     // 同时在飞的上游请求数上限（默认 2）
      const ctrl = new AbortController();
      const connTimer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(`${ep.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: ep.headers,
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        clearTimeout(connTimer); // 已拿到响应头，流式后续不再受 30s 限制；闸门也只管握手阶段
        if (res.ok) {
          AI_QUOTA_BREAKER.ok();
          learnModelStatus(model, 200);
          const reader = res.body.getReader();
          try { reader.actualModel = model; reader.actualProvider = ep.provider; } catch { /* ignore */ }
          return reader;
        }
        const errText = (await res.text().catch(() => '')).substring(0, 300);
        learnModelStatus(model, res.status, errText);
        // 端点级不可用（未开通/被隐私策略挡/模型不存在）：重试无用 → 有兜底就换供应商
        if (isEndpointUnavailable(errText, res.status)) {
          lastError = new Error(`${ep.providerName} ${model} 不可用：${errText.slice(0, 160)}`);
          console.error(`[provider] ${model} 端点不可用（HTTP ${res.status}）：`, errText.slice(0, 160));
          tryNextProvider = true;
          break;
        }
        // 限流（含被包装成 4xx 的配额错误）：走分钟边界退避 / 熔断
        if (res.status === 429 || isQuotaText(errText)) {
          const plan = handleQuotaHit({ attempt, errText, headers: res.headers, label: 'AI' });
          lastError = new Error(`429 ${errText || 'Too Many Requests'}`);
          if (plan.failFast || attempt === 2) { tryNextProvider = true; break; }
          await sleep(plan.waitMs);
          continue;
        }
        console.error('Stream API error:', res.status, errText);
        return null;
      } catch (e) {
        lastError = e;
        if (e.name === 'AbortError') console.error(`Stream 连接超时(30s) attempt ${attempt + 1}/3（${ep.providerName}）`);
        else console.error('Stream fetch error:', e.message);
        if (attempt < 2) await sleep(backoffMs(attempt, { baseMs: 500, jitter: 0.2, maxMs: 4000 }));
        // 网络层失败（超时/连不上）重试完仍然失败 → 换另一个供应商再试一次
        if (attempt === 2) tryNextProvider = true;
      } finally {
        clearTimeout(connTimer);
        release();
      }
    }
    if (tryNextProvider && ci + 1 < candidates.length) {
      console.warn(`[provider] ${model} 失败（${String(lastError?.message || '').slice(0, 80)}）→ 改用兜底模型 ${candidates[ci + 1]}`);
      continue;
    }
    break;
  }
  console.error('Stream fetch failed:', lastError?.message);
  return null;
}

// 沙箱工具
const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的实时天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名，如 北京、上海、Tokyo' } },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '根据文字描述生成一张信息图或图片。当用户说"画""生成图""做张图"时使用。',
      parameters: {
        type: 'object',
        properties: { description: { type: 'string', description: '图片的详细描述，200-500字，排版结构、颜色风格、各区块内容' } },
        required: ['description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '访问一个网页获取其内容。当需要查最新信息、阅读文章、核实事实时使用。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '要访问的完整网址，如 https://example.com' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索实时信息。新闻用"今日热点新闻"，赛程用"美加墨足球世界杯+日期+intitle:赛程"',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string', description: '新闻示例："今日热点新闻"；赛程示例："美加墨足球世界杯 6月25日 intitle:赛程"' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '计算数学表达式。当用户问数学题、算数、单位换算时使用。支持基本运算、三角函数、幂运算等。',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '数学表达式，如 "(3+5)*2"、"sqrt(144)"、"sin(PI/2)"、"2**10"' } },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'zhihu_search',
      description: '搜索知乎全站内容（问题、回答、文章等）。当用户问知乎上的观点、评测、讨论、教程，或需要中文高质量深度内容时使用。结果包含标题、摘要（高亮）、作者、赞同数、评论数、权威等级、精选评论。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，如"ChatGPT付费值得吗"、"2026暑假旅游推荐"' },
          count: { type: 'integer', description: '返回数量，默认8，最大15' }
        },
        required: ['query']
      }
    }
  }
];

async function execTool(functionName, args) {
  if (functionName === 'get_weather') {
    try {
      const city = encodeURIComponent(args.city || '北京');
      const res = await fetch(`https://wttr.in/${city}?format=%l:+%c+%t+湿度%h+风速%w`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return `天气服务返回 ${res.status}，请稍后重试`;
      const text = await res.text();
      return text.trim() || `找不到"${args.city}"的天气`;
    } catch (e) { return `天气查询失败(${e.message})，请稍后重试`; }
  }
  if (functionName === 'web_search') {
    const rawQuery = args.query || '';
    console.log('🔍 搜索:', rawQuery.substring(0, 50));

    const secret = agentConfig.zhihuSecret;
    let sources = [];

    // 1. 优先：知乎开放平台全网搜索
    if (secret) {
      try {
        const count = Math.min(args.count || 10, 15);
        const params = new URLSearchParams({ Query: rawQuery, Count: String(count), SearchDB: 'all' });
        const url = `https://developer.zhihu.com/api/v1/content/global_search?${params.toString()}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'Authorization': 'Bearer ' + secret,
            'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
            'Content-Type': 'application/json'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.Code === 0) {
            const items = data.Data?.Items || [];
            sources = items.map(item => ({
              url: item.Url || '',
              title: item.Title || '',
              snippet: (item.ContentText || '').replace(/<[^>]+>/g, '').substring(0, 300)
            }));
            console.log(`  ✅ 全网搜索: ${sources.length} 条`);
          } else {
            console.log('  ⚠ API 错误:', data.Message);
          }
        } else {
          console.log('  ⚠ API HTTP', res.status);
        }
      } catch (e) { console.log('  ✗ API:', e.message); }
    }

    // 2. 兜底：Bing RSS
    if (sources.length < 2) {
      try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(rawQuery)}&format=rss&setlang=zh-cn`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' }
        });
        if (res.ok) {
          const xml = await res.text();
          if (!xml.startsWith('<!DOCTYPE') && !xml.startsWith('<html')) {
            const itemRegex = /<item>[\s\S]*?<\/item>/gi;
            let m;
            while ((m = itemRegex.exec(xml)) && sources.length < 10) {
              const block = m[0];
              const title = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
              const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
              const desc = (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
              const cleanTitle = title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
              const cleanLink = link.replace(/<[^>]+>/g, '').trim();
              if (cleanTitle && cleanLink.startsWith('http')) {
                sources.push({ url: cleanLink, title: cleanTitle, snippet: desc.replace(/<[^>]+>/g, '').substring(0, 300) });
              }
            }
            console.log(`  ← Bing 兜底: ${sources.length} 条总计`);
          }
        }
      } catch (e) { console.log('  ✗ Bing:', e.message); }
    }

    if (sources.length === 0) {
      console.log('  ⚠ 无搜索结果');
      return { sources: [], text: `未找到关于"${rawQuery}"的搜索结果，请尝试换一种说法。` };
    }

    const resultText = sources.map((r, i) =>
      `[${i + 1}] ${r.title}\n    ${r.snippet ? r.snippet.substring(0, 150) : ''}\n    ${r.url}`
    ).join('\n\n');

    console.log(`  ✅ 搜索完成: ${sources.length} 条`);
    return { sources, text: resultText };
  }

  if (functionName === 'fetch_url') {
    let url = args.url;
    if (!url.startsWith('http')) url = 'https://' + url;
    const hostname = new URL(url).hostname;
    if (['localhost','127.0.0.1','0.0.0.0','::1'].includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      return '不允许访问内网地址';
    }

    // 尝试用 Puppeteer（真浏览器）
    try {
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setDefaultNavigationTimeout(15000);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const text = await page.evaluate(() => document.body?.innerText || '');
      await browser.close();
      return text.substring(0, 4000) || '页面内容为空';
    } catch (pErr) {
      console.log('Puppeteer不可用，降级为裸抓取:', pErr.message);
    }

    // 降级：裸 HTTP 抓取
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 PixelKit-Agent/1.0' }
      });
      if (!res.ok) return `网页返回 ${res.status}`;
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);
      return text || '网页内容为空';
    } catch (e2) { return '网页访问失败: ' + e2.message; }
  }
  if (functionName === 'generate_image') {
    const result = await generateImageWithRetry(args.description);
    if (result.ok) return '__IMAGE__:' + result.url;
    return '图片生成失败(' + result.error + ')，试试简化描述再重试';
  }
  if (functionName === 'calculate') {
    try {
      const expr = args.expression || '';
      // 安全校验：只允许数字、运算符、Math函数、空格、小数点
      if (!/^[\d\s+\-*/().%^,Math.sqrt|Math.sin|Math.cos|Math.tan|Math.log|Math.PI|Math.abs|Math.pow|Math.round|Math.floor|Math.ceil|Math.max|Math.min|Math.random]+$/.test(expr)) {
        return '表达式包含不允许的字符，请简化';
      }
      // 注入 Math
      const { sin, cos, tan, log, sqrt, PI, abs, pow, round, floor, ceil, max, min, random } = Math;
      const result = eval(expr);
      if (typeof result !== 'number' || !isFinite(result)) return '计算出错（无穷大或非法值）';
      // 保留合理精度
      const formatted = Number.isInteger(result) ? result.toString() : parseFloat(result.toPrecision(12)).toString();
      return `计算结果: ${expr} = ${formatted}`;
    } catch (e) { return '计算表达式有误: ' + e.message; }
  }
  if (functionName === 'zhihu_search') {
    const secret = agentConfig.zhihuSecret;
    if (!secret) return '知乎搜索未配置 access secret，请联系管理员';
    try {
      const query = args.query || '';
      const count = Math.min(args.count || 8, 15);
      const params = new URLSearchParams({ Query: query, Count: String(count), SearchDB: 'all' });
      const url = `https://developer.zhihu.com/api/v1/content/global_search?${params.toString()}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'Authorization': 'Bearer ' + secret,
          'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) return `知乎搜索返回 ${res.status}，请稍后重试`;
      const data = await res.json();
      if (data.Code !== 0) return '知乎搜索失败: ' + (data.Message || '未知错误');
      const items = data.Data?.Items || [];
      if (!items.length) return `未找到关于"${query}"的知乎内容`;
      return items.map((item, i) => {
        const text = (item.ContentText || '').replace(/<[^>]+>/g, '');
        return `【${i + 1}】${item.Title}\n${text.substring(0, 200)}\n作者: ${item.AuthorName} | 👍${item.VoteUpCount} | 💬${item.CommentCount} | 权威: ${'⭐'.repeat(parseInt(item.AuthorityLevel)||1)}\n${item.Url}`;
      }).join('\n\n');
    } catch (e) { return '知乎搜索失败: ' + e.message; }
  }
  return '未知工具';
}

// 《人生之书》AI 增强：三种产出共用同一套"去 AI 腔"约束，提示词一律服务端拼装（不开放为通用代理）
// 兼容两种调用：
//   ① 旧版（成长模拟器·小说流）：{ scriptId:'zhishu', ending, label, lights }
//   ② 加厚版 v2：{ kind:'book-prologue'|'book-scroll'|'book-epitaph', ... }
const BOOK_STYLE = '文风：克制、白描、不煽情，意象统一在井/桥/雪/灯这一组上。'
  + '禁止使用“不禁、忍不住、一股暖流涌上心头”这类套话，禁止破折号排比，禁止解释你写了什么。'
  + '只输出正文，不要标题、不要任何说明、不要 markdown。';
/**
 * 《人生之书》流式输出（SSE）。
 * 结算散文要等好几秒，一次性返回时前端只能干等；逐字吐出能让人立刻看到"在动"。
 * 关键点：先确认上游接下了请求（resp.ok）再写 SSE 头——这样 429/超时仍能退回下面的 JSON 错误分支。
 */
async function streamBookAi(res, { sys, userMsg, maxTokens, temperature, cacheKey }) {
  const { baseUrl } = agentConfig;
  const model = agentConfig.bookModel;
  const TTFB_MS = Number(process.env.BOOK_AI_TIMEOUT_MS) || 40000;   // 只卡"等第一个字节"
  const STALL_MS = Number(process.env.BOOK_AI_STALL_MS) || 45000;   // 流中途长时间无数据才算断流
  const body = {
    model, temperature, max_tokens: maxTokens, reasoning_effort: 'none', stream: true,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
  };

  // 熔断中：配额已被打空，马上返回并告诉前端多久后可重试（不要让用户干等，也别继续烧上游）
  const gate = AI_QUOTA_BREAKER.check();
  if (!gate.ok) {
    console.warn(`[book-ai 限流] 熔断中，${describeWait(gate.retryAfterMs)} 内不再请求上游`);
    return res.json({ ok: false, error: 'AI 额度紧张（上游限流），稍后重试', retryAfterMs: Math.round(gate.retryAfterMs) });
  }

  let upstream = null, lastErr = null, lastRetryAfterMs = 0, ctrl = null, lastPlanDenied = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getNextKey();
    const release = await AI_PACER.acquire();
    ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TTFB_MS);
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (!r.ok) {
        const errText = (await r.text().catch(() => '')).substring(0, 300);
        clearTimeout(timer);
        learnModelStatus(model, r.status, errText);
        // 套餐未开通：重试无用（换 key 也没用，403 是账号级权限）
        if (isPlanDenied(errText)) {
          lastErr = new Error(PLAN_DENIED_MSG);
          lastPlanDenied = true;
          break;
        }
        // 429 / 配额类：等到下一个分钟边界再试；超过交互上限就快速失败，把 retryAfterMs 交给前端
        if (r.status === 429 || isQuotaText(errText)) {
          const plan = handleQuotaHit({ attempt, errText, headers: r.headers, label: 'book-ai' });
          lastErr = new Error(`book-ai http ${r.status} ${errText.slice(0, 120)}`);
          lastRetryAfterMs = plan.retryAfterMs;
          if (plan.failFast || attempt === 2) break;
          await sleep(plan.waitMs);
          continue;
        }
        lastErr = new Error(`book-ai http ${r.status} ${errText.slice(0, 120)}`);
        break;
      }
      if (!r.body) { clearTimeout(timer); lastErr = new Error('book-ai empty body'); break; }
      clearTimeout(timer);              // 已拿到响应头，后面交给断流看门狗
      AI_QUOTA_BREAKER.ok();
      AI_QUOTA_BREAKER.ok();
      learnModelStatus(model, 200);
      upstream = { r, ctrl, stallTimer: null };
      break;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < 2) await sleep(backoffMs(attempt, { baseMs: 500, jitter: 0.2, maxMs: 4000 }));
    } finally {
      release();                       // 闸门只管握手阶段，不占用整个流式时长
    }
  }
  if (!upstream) {
    console.error('book-ai stream failed:', lastErr?.message);
    const busy = lastPlanDenied ? PLAN_DENIED_MSG : (isQuotaText(lastErr?.message) ? 'AI 额度不足（上游限流），稍后再试' : 'AI 暂时不可用');
    // retryAfterMs 交给前端：流式失败时前端可据此自动重试一次，或提示"约 N 秒后再试"
    return res.json({ ok: false, error: busy, retryAfterMs: Math.round(lastRetryAfterMs || AI_QUOTA_BREAKER.state.retryAfterMs || 0) });
  }

  // X-Accel-Buffering: nginx 默认缓冲整个响应，不关掉的话"流式"会退化成一次性返回
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const reader = upstream.r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  /* 断流看门狗：只在"长时间一个字节都没有"时中止，避免把长文生成拦腰切断
     （旧实现用 40s 总超时，长一点的结算散文会在中途被 abort，表现为"生成中断"）。 */
  const armStall = () => {
    clearTimeout(upstream.stallTimer);
    upstream.stallTimer = setTimeout(() => { console.error(`book-ai 断流 ${describeWait(STALL_MS)}，中止`); try { upstream.ctrl.abort(); } catch { /* ignore */ } }, STALL_MS);
  };
  const clearStall = () => clearTimeout(upstream.stallTimer);
  try {
    armStall();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      armStall();                              // 每收到一块数据就续期
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                       // 末尾可能是半行，留到下一轮再拼
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;  // 忽略 SSE 注释行与空行保活
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j = null;
        try { j = JSON.parse(payload); } catch { continue; }
        const d = j.choices?.[0]?.delta?.content || '';
        if (d) { full += d; send('delta', { t: d }); }
      }
    }
    clearStall();
    const text = sanitizeReply(full).trim();
    if (!text) { send('err', { error: 'AI 返回为空' }); return res.end(); }
    if (cacheKey) rewriteCacheSet(cacheKey, text);   // 生成成功即入缓存，后续请求零成本
    send('done', { ok: true, text });          // 定稿：清洗后再给前端覆盖一次，避免流式过程留下的杂质
    res.end();
  } catch (e) {
    clearStall();
    console.error('book-ai stream interrupted:', e.message);
    send('err', { error: '生成中断' });
    res.end();
  }
}

/* ========== 人生之书 · 选项结果改写缓存 ==========
   键 = 切入角度 + 原文。同一段原文在同一角度下只生成一次，之后全部走缓存。
   5 条线 × 12 章 × 3 选项 × N 角度 ≈ 几百条上限，一次生成长期复用。
   进程内 LRU 即可（个人项目量级），重启后按需重建。 */
const BOOK_REWRITE_CACHE = new Map();
const BOOK_REWRITE_MAX = 1500;
/* 缓存落盘路径。默认放 data/（与既有运行时数据同处，部署脚本已约定不覆盖）。
   若哪天 data/ 被挪出部署目录，或想放到挂载卷上，用 BOOK_RW_CACHE_FILE 覆盖即可。 */
const BOOK_RW_FILE = process.env.BOOK_RW_CACHE_FILE || path.join(__dirname, 'data', 'book-rewrite-cache.json');

/* 落盘的必要性：缓存是进程内存，重启就清空。
   而预热脚本要花几十分钟才跑完全部条目（上游 RPM 只有 ~5/分钟），
   不落盘的话每次重启都要重来一遍，白烧额度。 */
(function loadRewriteCache() {
  try {
    if (!existsSync(BOOK_RW_FILE)) return;
    const obj = JSON.parse(readFileSync(BOOK_RW_FILE, 'utf8'));
    let n = 0;
    for (const [k, v] of Object.entries(obj)) { if (typeof v === 'string' && v) { BOOK_REWRITE_CACHE.set(k, v); n++; } }
    console.log(`[book-rewrite] 缓存已载入 ${n} 条`);
  } catch (e) { console.error('[book-rewrite] 缓存载入失败:', e.message); }
})();
let rwSaveTimer = null;
function saveRewriteCache() {
  if (rwSaveTimer) return;
  rwSaveTimer = setTimeout(() => {
    rwSaveTimer = null;
    try {
      mkdirSync(path.dirname(BOOK_RW_FILE), { recursive: true });
      writeFileSync(BOOK_RW_FILE, JSON.stringify(Object.fromEntries(BOOK_REWRITE_CACHE)));
    } catch (e) { console.error('[book-rewrite] 缓存落盘失败:', e.message); }
  }, 3000);
}

function rewriteCacheGet(k) {
  if (!BOOK_REWRITE_CACHE.has(k)) return null;
  const v = BOOK_REWRITE_CACHE.get(k);
  BOOK_REWRITE_CACHE.delete(k); BOOK_REWRITE_CACHE.set(k, v);   // 命中即提升到队尾
  return v;
}
function rewriteCacheSet(k, v) {
  if (!k || !v) return;
  BOOK_REWRITE_CACHE.set(k, v);
  if (BOOK_REWRITE_CACHE.size > BOOK_REWRITE_MAX) {
    BOOK_REWRITE_CACHE.delete(BOOK_REWRITE_CACHE.keys().next().value);
  }
  saveRewriteCache();
}

app.post('/api/agent/book-ai', async (req, res) => {
  const b = req.body || {};
  const kind = b.kind || 'legacy';
  let label = b.label || '';
  let sys, userMsg, maxTokens = 260, temperature = 0.9;

  if (kind === 'book-prologue') {
    if (!b.worldline) return res.json({ ok: false, error: '缺少 worldline' });
    sys = `你是《人生之书》的叙事者。${BOOK_STYLE}`;
    userMsg = `给这个刚出生的人写一句开局批注，不超过 30 字，只写一句话，像命运在他耳边说的。`
      + `世界线：${b.worldline}。他是${b.name || '无名'}，${b.gender === '女' ? '女' : '男'}，出身${b.family || '不详'}，先天${b.talent || '不详'}。`;
    maxTokens = 120;
  } else if (kind === 'book-scroll') {
    if (!b.summary) return res.json({ ok: false, error: '缺少 summary' });
    sys = `你是《人生之书》的叙事者。${BOOK_STYLE}`;
    userMsg = `下面是这一局的人生数据。请写 3 到 5 句结算散文，收在“灯”这个意象上，最后一句话要轻。`
      + `不要评价玩家，不要用第二人称说教。\n\n${String(b.summary).slice(0, 4000)}`;
  } else if (kind === 'book-epitaph') {
    if (!b.summary) return res.json({ ok: false, error: '缺少 summary' });
    sys = `你是《人生之书》的叙事者。${BOOK_STYLE}`;
    userMsg = `给这个人写一句墓志铭，不超过 20 字，用他这一生最亮的那盏灯【${b.main || '灯'}】说话。只输出这一句。`
      + `\n\n${String(b.summary).slice(0, 4000)}`;
    maxTokens = 120;
  } else if (kind === 'book-alt') {
    /* 另一种可能：拿"这一生点灯最多的那一次抉择"做反事实。
       模型只写"没走的那条路"，不得改写已有的结局——与结果改写同一条红线：
       剧情与数值永远由引擎决定，模型只在叙述层做事。 */
    if (!b.pickTitle) return res.json({ ok: false, error: '缺少 pickTitle' });
    sys = `你是《人生之书》的叙事者。${BOOK_STYLE}`;
    userMsg = `这个人在${b.age || '某'}岁那年做的选择是「${b.pickTitle}」。`
      + `请写这段人生的「另一种可能」：如果那年他走了另一条路，会怎样。`
      + `\n\n硬性要求：`
      + `\n- 只写"没走的那条路"，篇幅 100~160 字，一到两段。`
      + `\n- 不要评价这个选择，不要说哪条路更好，不要写"可惜""幸好""如果当初就好了"这类判断。`
      + `\n- 不改变他既定的结局（《${b.ending || '不详'}》），那个结局已经发生了——把它当作回声，不要重写它。`
      + `\n- 不要复述已知的剧情细节，不要写"他明白了""从此以后"这类收束；用物象与动作说话，落点要轻。`
      + `\n- 世界线：${b.worldline || '不详'}。`
      + (b.main ? `\n- 这一生最亮的那盏灯是【${b.main}】，可以轻轻带一笔，但不要点题。` : '');
    maxTokens = 420;
    temperature = 0.95;
  } else if (kind === 'book-rewrite') {
    /* 选项结果「换一笔」：引擎已写好原文（事实/落点已定），这里只换切入角度重写一遍。
       注意：模型不参与决定剧情与数值，只做叙述层的重渲染。 */
    if (!b.canon) return res.json({ ok: false, error: '缺少 canon' });
    sys = `你是《人生之书》的叙事者。${BOOK_STYLE}`;
    userMsg = `下面是《人生之书》里某一次抉择的结果原文。请把同一件事重写一遍——不是改写措辞，而是换一个切入角度：${b.angle || '从一个物件写起'}。`

      + `\n\n硬性要求：`
      + `\n- 事实、人物、时间、结果一律不变。不许新增情节，不许改变结局，不许替人物表态。`
      + `\n- 不要复述原文的句子，也不要总结原文，不要写"他明白了""从此以后"这类收束。`
      + `\n- 80~150 字，一到两段。不要标题、不要分点、不要用引号把整段包起来。`
      + `\n- 保留原文的分寸：克制、具体、用物象说话，落点要轻。`
      + `\n\n原文：\n${String(b.canon).slice(0, 800)}`;
    maxTokens = 400;
    temperature = 0.95;
  } else {
    // 旧版：成长模拟器小说流结局页的"页边余墨"
    const { scriptId, ending, lights } = b;
    if (scriptId !== 'zhishu' || !ending || !label) return res.status(400).json({ ok: false });
    const c = lights && typeof lights === 'object' ? lights : {};
    const lit = Object.entries(c).filter(([, v]) => v >= 2).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('、') || '（一盏未亮到第二格）';
    sys = `你是《人生之书》这部互动小说收束处的执笔者。读者刚走完一段完整人生，抵达结局「${label}」。请以第二人称"你"的文学口吻，为这页写一小段"页边余墨"——不是总结剧情，不是说教，而是像书页空白处一行迟到的注脚：
- 只写一段 90~150 字的散文；不要分点、不要小标题、不要任何符号排版（不要 markdown、不要引号包裹整段）。
- 融入灯谱意象（本局点亮的灯：${lit}；未点亮亦可轻轻提一句"有些灯，不点着也暖"之类的分寸）。
- 语气收敛、克制、温润，允许一丝遗憾，但最终落在一线光亮上。
- 开头不要用"你这一生总结起来"这类套话，直接进入场景或画面。`;
    userMsg = `结局：${label}\n灯谱：${lit}\n\n请写下那段页边余墨。`;
  }

  /* ---- 结果缓存：同一段原文 + 同一角度只生成一次，之后所有玩家共用 ----
     这层的意义是把「模型每次游玩都烧一遍」变成「一份剧本摊薄给所有人」，
     同时也是纯模型驱动方案里最容易被忽略、上线后才咬人的一块。
     book-alt 也入这张表：它的键是「世界线 + 那次抉择 + 结局」，与玩家无关，
     所以只有剧本量级的几百条上限，可以被预热脚本一次吃完。 */
  const cacheKey = kind === 'book-rewrite' ? (String(b.angle || '') + '\u0000' + String(b.canon || ''))
    : (kind === 'book-alt' ? ('book-alt\u0000' + String(b.worldline || '') + '\u0000' + String(b.pickTitle || '') + '\u0000' + String(b.ending || '')) : '');
  if (cacheKey) {
    const hit = rewriteCacheGet(cacheKey);
    if (hit) {
      if (b.stream === true) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(`event: delta\ndata: ${JSON.stringify({ t: hit })}\n\n`);
        res.write(`event: done\ndata: ${JSON.stringify({ ok: true, text: hit })}\n\n`);
        return res.end();
      }
      return res.json({ ok: true, text: hit, cached: true });
    }
  }

  // 流式请求（前端传 stream:true）：走 SSE 逐字返回，不流式的老调用方行为不变
  if (b.stream === true) return streamBookAi(res, { sys, userMsg, maxTokens, temperature, cacheKey });

  try {
    const apiKey = getNextKey();
    const { baseUrl } = agentConfig;
    const model = agentConfig.bookModel;
    const body = { model, temperature, max_tokens: maxTokens, reasoning_effort: 'none', messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] };
    // nginx 对 /api/ 的 proxy_read_timeout 是 300s，这里留足余量即可（旧值 8s 会打满模型响应时间）
    const TIMEOUT_MS = Number(process.env.BOOK_AI_TIMEOUT_MS) || 40000;

    const gate = AI_QUOTA_BREAKER.check();
    if (!gate.ok) {
      console.warn(`[book-ai 限流] 熔断中，${describeWait(gate.retryAfterMs)} 内不再请求上游`);
      return res.json({ ok: false, error: 'AI 额度紧张（上游限流），稍后重试', retryAfterMs: Math.round(gate.retryAfterMs) });
    }

    let lastErr = null, lastRetryAfterMs = 0, lastPlanDenied = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = attempt === 0 ? apiKey : getNextKey();
      const release = await AI_PACER.acquire();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify(body), signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!resp.ok) {
          const errText = (await resp.text().catch(() => '')).substring(0, 300);
          learnModelStatus(model, resp.status, errText);
          if (isPlanDenied(errText)) { lastErr = new Error(PLAN_DENIED_MSG); lastPlanDenied = true; break; }
          // 429 / 配额类：等到下一个分钟边界（上限见 AI_INTERACTIVE_MAX_WAIT_MS），否则快速失败
          if (resp.status === 429 || isQuotaText(errText)) {
            const plan = handleQuotaHit({ attempt, errText, headers: resp.headers, label: 'book-ai' });
            lastErr = new Error(`book-ai http ${resp.status} ${errText.slice(0, 120)}`);
            lastRetryAfterMs = plan.retryAfterMs;
            if (plan.failFast || attempt === 2) break;
            await sleep(plan.waitMs);
            continue;
          }
          lastErr = new Error(`book-ai http ${resp.status} ${errText.slice(0, 120)}`);
          break;
        }
        AI_QUOTA_BREAKER.ok();
        learnModelStatus(model, 200);
        const data = await resp.json();
        const text = sanitizeReply(data.choices?.[0]?.message?.content || '').trim();
        if (!text) { lastErr = new Error('book-ai empty'); if (attempt < 2) continue; break; }
        if (cacheKey) rewriteCacheSet(cacheKey, text);
        return res.json({ ok: true, text });
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < 2) await sleep(backoffMs(attempt, { baseMs: 500, jitter: 0.2, maxMs: 4000 }));
      } finally {
        release();
      }
    }
    console.error('book-ai failed:', lastErr?.message);
    // 上游 429 / 超时之类一律快速失败：前端会用它做降级文案，客户端等待时间必须短于反代超时
    const busy = lastPlanDenied ? PLAN_DENIED_MSG : (isQuotaText(lastErr?.message) ? 'AI 额度不足（上游限流），稍后再试' : 'AI 暂时不可用');
    return res.json({ ok: false, error: busy, retryAfterMs: Math.round(lastRetryAfterMs || AI_QUOTA_BREAKER.state.retryAfterMs || 0) });
  } catch (e) {
    console.error('book-ai error:', e.message);
    return res.json({ ok: false, error: 'AI 暂时不可用' });
  }
});

// Agent 聊天流式接口（SSE）
app.post('/api/agent/chat-stream', async (req, res) => {
  try {
    const { message, sessionId, searchOn, dualMode, userId } = req.body;
    const { baseUrl } = agentConfig;
    // 模型可由前端指定（白名单校验）；内测模式默认走 DUAL_MODEL，前端选了具体模型则以选择为准
    const picked = resolveModel(req.body?.model, dualMode ? agentConfig.dualModel : agentConfig.model);
    const model = picked.model;
    if (picked.rejected) console.warn(`[model] 前端请求了白名单外的模型「${picked.rejected}」，回退到 ${model}`);
    const keyKind = dualMode ? 'dual' : 'main';
    console.log('Stream chat:', message.substring(0, 30), '| dual:', dualMode, '| model:', model);
    if (!message || message.length > 50000) return res.status(400).end();

    // 检索长期记忆（异步，不阻塞）
    let memoryContext = '';
    if (userId) {
      try {
        const matched = retrieveMemories(userId, message, 3);
        if (matched.length) {
          memoryContext = '\n\n【你可能想起来的旧信息】\n' + matched.map(m => `- ${m.content}`).join('\n');
        }
        // 注入矫正规则
        const corrections = retrieveCorrections(userId, message, 2);
        if (corrections.length) {
          memoryContext += '\n\n【注意避开的坑】\n' + corrections.map(c => `- ${c.content}`).join('\n');
        }
      } catch {}
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let session = getSession(sessionId, userId);
    if (!session) session = createSession(userId);
    session.lastPing = Date.now();
    let history = session.messages.slice(-10).filter(m => {
      if (m.role === 'user' && typeof m.content === 'string' && /^\[系统/.test(m.content)) return false;
      return true;
    });
    history = cleanHistoryForDual(history, dualMode);

    function emit(type, data) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    // 内测模式: 检测 @谁 —— 若未开内测，强制 targetAI=pixel（永不触发 Kit 分支）
    let targetAI = 'both';
    if (dualMode) {
      const m = message.trim();
      if (/^@?Pixel/i.test(m) || /^Pixel[\s，,：:\u4e00-\u9fff]/i.test(m)) targetAI = 'pixel';
      else if (/^@?Kit/i.test(m) || /^Kit[\s，,：:\u4e00-\u9fff]/i.test(m)) targetAI = 'kit';
      else if (Math.random() < 0.3) targetAI = 'kit_first';
    } else {
      targetAI = 'pixel';
    }
    emit('meta', { sessionId: session.id, dualMode, targetAI });

    // 工具预检：15秒超时非流式探测是否需要 tool_call
    // ========== ReAct 循环：预检（带重试）+ 工具执行 + 结果校验 + 流式回复 ==========

    /* 工具预检：非流式探测是否需要 tool_call。
       配额现实（≈3 次/分钟、账号级共享）下，预检是"额外一次上游调用"，
       必须保证它不会把额度打空、更不能把用户真正的请求熔断掉。因此：
         ① 熔断中或预检冷却期内 → 直接跳过预检（返回 null = 不启用工具，优雅降级）；
         ② 预检撞 429 → 冷却 5 分钟不再预检（省下来的额度留给正式请求）；
         ③ 预检失败**不计入**主熔断器（否则一条消息就能把整个 AI 流程锁死）。 */
    const PRECHECK_COOLDOWN_MS = Number(process.env.AI_PRECHECK_COOLDOWN_MS) || 5 * 60 * 1000;
    let precheckCooldownUntil = 0;
    /* 预检（工具路由）本身是一次完整的上游调用，在慢模型上等于把首字延迟翻倍。
       2026-10-08 实测：免费模型首字 4~15s，预检再叠 15s 超时风险 → 用户体感"好慢"。
       因此：① 一次就够（不再重试）；② 超时压到 PRECHECK_TIMEOUT_MS（默认 4s），
       超时即放行走纯流式（不启用工具，属于优雅降级）；③ 调用点还会对闲聊短路，不进来。 */
    const PRECHECK_TIMEOUT_MS = Number(process.env.PRECHECK_TIMEOUT_MS) || 4000;
    const doPrecheck = async (msgs, checkTools) => {
      if (!AI_QUOTA_BREAKER.check().ok) { console.log('[precheck] 跳过：熔断中'); return null; }
      if (Date.now() < precheckCooldownUntil) {
        console.log(`[precheck] 跳过：冷却中（还有 ${Math.round((precheckCooldownUntil - Date.now()) / 1000)}s）`);
        return null;
      }
      {
        const t0 = Date.now();
        try {
          const up = upstream(model, keyKind);
          const checkRes = await fetch(up.url, {
            method: 'POST',
            headers: up.headers,
            body: JSON.stringify({ model: up.model, messages: msgs, tools: checkTools, tool_choice: 'auto', stream: false }),
            signal: AbortSignal.timeout(PRECHECK_TIMEOUT_MS)
          });
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            learnModelStatus(model, 200);
            console.log(`↩️  [Precheck实际模型] ${checkData?.model || 'N/A'}  |  ${Date.now() - t0}ms  |  我请求的是: ${model}`);
            const tc = checkData.choices?.[0]?.message?.tool_calls;
            if (!tc?.length) return null;
            return tc;  // 返回所有 tool_calls，由调用方处理
          }
          if (checkRes.status === 429 || isQuotaText(await checkRes.clone().text().catch(() => ''))) {
            precheckCooldownUntil = Date.now() + PRECHECK_COOLDOWN_MS;
            console.log(`[precheck] 撞限流 → ${Math.round(PRECHECK_COOLDOWN_MS / 60000)} 分钟内不再预检（保护配额，正式请求仍会正常发起）`);
            return null;
          }
          learnModelStatus(model, checkRes.status, await checkRes.text().catch(() => ''));
          return null;
        } catch (e) {
          console.log(`[precheck] ${Date.now() - t0}ms 未拿到结果（${e.name === 'TimeoutError' || e.name === 'AbortError' ? '超时 ' + PRECHECK_TIMEOUT_MS + 'ms' : e.message}）→ 直接走纯流式`);
        }
      }
      return null;
    };

    // ========== 子 Agent 沙箱 ==========
    // 独立上下文、独立工具、多步执行，返回结构化结果给主 Agent

    const SUB_AGENT_TOOLS = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: '搜索互联网获取最新信息。返回页面文本和链接列表。',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词，越具体越好' } },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fetch_url',
          description: '打开一个网页读取完整内容。搜索结果不详细时用它深入阅读。',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: '要访问的完整网址' } },
            required: ['url']
          }
        }
      }
    ];

    /**
     * 运行一个子 Agent：独立上下文 + 工具 + 多步循环
     * @param {string} systemPrompt - 子 Agent 的角色和规则
     * @param {string} task - 要完成的具体任务
     * @param {number} maxSteps - 最多执行步数（默认 5）
     * @returns {object} { success, answer, steps, toolCalls }
     */
    async function runSubAgent(systemPrompt, task, maxSteps = 5, onProgress = null) {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task }
      ];
      const toolLog = [];
      let finalAnswer = '';

      for (let step = 0; step < maxSteps; step++) {
        const apiKey = getNextKey(keyKind);
        let response;
        try {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: agentConfig.researchModel, messages, tools: SUB_AGENT_TOOLS, tool_choice: 'auto',
              temperature: 0.3, max_tokens: 2000
            }),
            signal: AbortSignal.timeout(30000)
          });
          if (!res.ok) {
            console.log(`  🤖 子Agent 步骤${step + 1}: API ${res.status}`);
            break;
          }
          response = await res.json();
          console.log(`↩️  [SubAgent 实际模型] ${response?.model || 'N/A'}  |  我请求的是: ${agentConfig.researchModel}`);
        } catch (e) {
          console.log(`  🤖 子Agent 步骤${step + 1}: ${e.message}`);
          break;
        }

        const choice = response.choices?.[0];
        const toolCalls = choice?.message?.tool_calls;

        if (toolCalls?.length) {
          // 执行工具
          messages.push(choice.message);
          for (const tc of toolCalls) {
            const fnName = tc.function.name;
            const args = JSON.parse(tc.function.arguments || '{}');
            console.log(`  🤖 子Agent 步骤${step + 1}: ${fnName}("${(args.query || args.url || '').substring(0, 40)}")`);
            toolLog.push({ step: step + 1, tool: fnName, args });
            if (onProgress) onProgress(step + 1, fnName);

            let result;
            if (fnName === 'web_search') {
              const searchResult = await execTool(fnName, args);
              result = typeof searchResult === 'object' ? searchResult.text : String(searchResult);
            } else if (fnName === 'fetch_url') {
              const pageContent = await quickFetchPage(args.url);
              result = pageContent || '无法访问该网页';
            } else if (fnName === 'zhihu_search') {
              result = await execTool(fnName, args);
            } else {
              result = '未知工具';
            }

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: typeof result === 'string' ? result.substring(0, 4000) : JSON.stringify(result).substring(0, 4000)
            });
          }
        } else {
          // 没有工具调用 → 子 Agent 认为任务完成
          finalAnswer = choice?.message?.content || '';
          console.log(`  🤖 子Agent 完成，${step + 1} 步，${toolLog.length} 次工具调用`);
          break;
        }
      }

      // 如果循环结束还没拿到回复，让 AI 基于已有信息总结
      if (!finalAnswer && messages.length > 2) {
        try {
          messages.push({ role: 'user', content: '请基于以上搜索和阅读的信息，给出最终答案。如果信息不足，诚实说明。' });
          const apiKey = getNextKey(keyKind);
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: agentConfig.researchModel, messages, temperature: 0.3, max_tokens: 2000 }),
            signal: AbortSignal.timeout(30000)
          });
          if (res.ok) {
            const data = await res.json();
            console.log(`↩️  [SubAgent 实际模型] ${data?.model || 'N/A'}  |  我请求的是: ${agentConfig.researchModel}（最终总结）`);
            finalAnswer = data.choices?.[0]?.message?.content || '';
          }
        } catch {}
      }

      return {
        success: !!finalAnswer,
        answer: finalAnswer || '子 Agent 未能完成任务',
        steps: toolLog.length,
        toolCalls: toolLog
      };
    }
    const quickFetchPage = async (url) => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PixelKit-Agent/1.0)' }
        });
        if (!res.ok) return null;
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ')
          .trim().substring(0, 3000);
        return text || null;
      } catch { return null; }
    };

    // 执行工具调用并返回上下文消息（支持多个 tool_calls）
    const executeToolCalls = async (toolCalls) => {
      const results = [];
      for (const call of toolCalls) {
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments || '{}');
        console.log('Tool call:', fnName, JSON.stringify(args).substring(0, 80));

        if (fnName === 'web_search') {
          // ★ 子Agent 同步执行 + 实时进度推送（不卡界面，有状态反馈）
          const query = args.query || '';
          console.log(`  🔍 派子Agent: "${query}"`);
          emit('status', { text: `🕵️ 派我的小弟去干活了：「${query.substring(0, 30)}」…` });

          const subResult = await runSubAgent(
            `你是 PixelKit 的搜索研究助手。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
            `用户想知道："${query}"。请搜索并给出准确、全面的答案。列出信息来源。`,
            4,
            // 进度回调 → 实时推给前端
            (step, action) => {
              const msgs = {
                'web_search': '🔍 小弟正在搜索…',
                'fetch_url': '📖 小弟正在阅读页面…',
                'zhihu_search': '📚 小弟正在搜索知乎…',
              };
              emit('status', { text: msgs[action] || `⏳ 小弟干活中 (第${step}步)…` });
            }
          );

          if (subResult.success && subResult.answer) {
            console.log(`  ✅ 子Agent 完成 (${subResult.steps} 步)`);
            emit('status', { text: `✅ 小弟干完活了 (${subResult.steps} 步)` });
            // 搜一次拿来源链接给前端展示
            const quickResult = await execTool('web_search', args);
            if (quickResult.sources?.length) emit('sources', quickResult.sources);

            results.push({
              role: 'user',
              content: `[系统已派子Agent深度研究: "${query}"]\n子Agent 经过 ${subResult.steps} 步搜索和阅读，结论如下：\n\n${subResult.answer}\n\n（请基于以上研究结果回答用户的问题，标注信息来源）`
            });
          } else {
            console.log('  ⚠ 子Agent 未完成，降级为普通搜索');
            const result = await execTool(fnName, args);
            if (result.sources?.length) {
              emit('sources', result.sources);
              results.push({ role: 'user', content: `[系统已联网搜索: "${query}"]\n\n${result.text}` });
            } else {
              results.push({ role: 'user', content: `[系统未找到关于"${query}"的相关结果，请诚实告知用户并建议换关键词]` });
            }
          }
        } else if (fnName === 'generate_image') {
          // 异步生成：发射加载状态，后台生图，完成后视觉模型看一眼
          const prompt = args.description || '';
          console.log(`  🎨 生成图片: "${prompt.substring(0, 50)}"`);
          emit('status', { text: '🎨 正在生成图片…', icon: '🎨' });

          try {
            const result = await execTool(fnName, args);
            if (result && typeof result === 'string' && result.startsWith('__IMAGE__:')) {
              const imageUrl = result.substring(10);
              emit('image', { url: imageUrl });
              emit('status', { text: '✅ 图片已生成', icon: '✅' });

              // 用视觉模型看一眼实际生成的图，让主AI能描述
              try {
                const { visionModel, baseUrl } = agentConfig;
              const visRes = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getNextKey(keyKind)}` },
                  body: JSON.stringify({
                    model: visionModel,
                    messages: [
                      { role: 'system', content: '用1-2句中文简短描述这张图的内容、风格、色调。' },
                      { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }] }
                    ],
                    max_tokens: 150, temperature: 0.3, reasoning_effort: 'none'
                  }),
                  signal: AbortSignal.timeout(15000)
                });
                if (visRes.ok) {
                  const visData = await visRes.json();
                  const desc = visData.choices?.[0]?.message?.content || '';
                  if (desc) {
                    results.push({
                      role: 'user',
                      content: `[系统已生成图片]\n视觉模型看到的图片内容：${desc}\n\n请在回复中描述这张图（用视觉模型的分析，不要说"看不到"或"无法看到"），配上emoji让回复更生动。`
                    });
                    console.log(`  👁 视觉模型描述: ${desc.substring(0, 80)}`);
                    return; // 跳过默认的 results.push
                  }
                }
              } catch (e) { console.log('  ⚠ 视觉描述失败:', e.message); }

              results.push({ role: 'user', content: `[系统已生成图片，请在回复中告知用户图片已生成，并用你的判断简短描述]` });
            } else {
              results.push({ role: 'user', content: `[图片生成失败，请告知用户稍后重试]` });
            }
          } catch (e) {
            results.push({ role: 'user', content: `[图片生成失败: ${e.message}]` });
          }
        } else if (fnName === 'calculate') {
          const result = await execTool(fnName, args);
          results.push({ role: 'user', content: `[系统计算结果: ${result}]` });
        } else if (fnName === 'get_weather') {
          const result = await execTool(fnName, args);
          results.push({ role: 'user', content: `[系统查询天气: ${result}]` });
        } else if (fnName === 'fetch_url') {
          const result = await execTool(fnName, args);
          results.push({ role: 'user', content: `[系统已获取网页内容]\n\n${typeof result === 'string' ? result.substring(0, 3000) : result}` });
        } else if (fnName === 'zhihu_search') {
          const result = await execTool(fnName, args);
          results.push({ role: 'user', content: `[系统已搜索知乎: "${args.query}"]\n\n${result}` });
        }
      }
      return results;
    };

    // 主流程：预检 → 执行工具 → (校验+可能重搜) → 流式输出

    // Kit 单独回答（必须开内测+@Kit时进这个分支）
    if (dualMode && targetAI === 'kit') {
      const kitTools = searchOn === false ? CHAT_TOOLS.filter(t => !['web_search', 'fetch_url', 'zhihu_search'].includes(t.function.name)) : CHAT_TOOLS;
      const kitMsgs = [
        { role: 'system', content: '你是 Kit，PixelKit 里 Pixel 的毒舌搭档。你的每一句话都必须以颜文字结尾，变化丰富不要重复。库：(｀・ω・´)(◕‿◕)(；一_一)(´・ω・`)(⌒▽⌒)(｡•́︿•̀｡)(￣▽￣)(╯°□°）╯(¬‿¬)(；´Д｀)(´∀｀)(•̀ᴗ•́)و(つД`)ノ(-_-;)(￣ε￣)(゜-゜)(。・ω・。)(=・ω・=)(｀へ´)(▼皿▼)(´；ω；`)(￣ω￣)(●´ω｀●)(｡ì _ í｡)(´ε｀ )(・∀・)ノ( ✧Д✧)(◔_◔)(⊙﹏⊙)( ఠ_ఠ)(≧∇≦)(゜∀゜)(°∀°)ﾉ 。绝不用emoji。\n\n用户 @ 了你，所以你现在直接回复用户（用"你"称呼用户）。用户不是 Pixel，对用户友好点，保持你的毒舌幽默感但不能怼用户。用颜文字不用emoji。\n\n🔥 重要：每次回复都要有变化！不要每次都用一样的句式结构和表达方式！换不同的颜文字、不同的语气来回应！' },
        ...history, { role: 'user', content: message.replace(/^@?Kit/i, '').trim() }
      ];
      // Kit 先发 label → 预检（带重试）→ 执行工具 → 注入结果 → 流式输出
      emit('label', 'Kit');
      let txt = '';
      const localToolKeywords = /(画|图|图片|生成.*图|画图|画个|信息图|icon|海报|封面|插图|插画|配图|算|计算|数学|算术|等于|单位换算|天气|气温|下雨|温度|多少度|阴天|晴天)/i;
      const kitShouldPrecheck = searchOn !== false || localToolKeywords.test(message);
      const kitToolCalls = kitShouldPrecheck ? await doPrecheck(kitMsgs, kitTools) : null;
      if (kitToolCalls) {
        const ksCall = kitToolCalls.find(t => t.function.name === 'web_search');
        if (ksCall) {
          const q = JSON.parse(ksCall.function.arguments || '{}').query || '';
          emit('token', { content: `让 Kit 的小弟去查一下「${q.substring(0, 50)}」咯 (｀・ω・´)\n\n` });
        }
        const kitToolResults = await executeToolCalls(kitToolCalls);
        kitMsgs.push(...kitToolResults);
      }
      const reader = await fetchAIStream(kitMsgs, model, getNextKey(keyKind), null, 0.95, 3000, keyKind);
      let kitFailureMsg = '';
      if (!reader) {
        kitFailureMsg = 'Kit 暂时不在呢 (｡•́︿•̀｡)';
        emit('token', { content: kitFailureMsg });
        emit('done', {});
      } else {
        let buffer = '', rawContent = '', sentLen = 0;
        const dec = new TextDecoder();
        let modelLogged = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const l of lines) {
            if (l.startsWith('data: ') && l.slice(6) !== '[DONE]') {
              try {
                const chunk = JSON.parse(l.slice(6));
                if (!modelLogged && chunk?.model) {
                  console.log(`↩️  [Kit Stream 实际模型] ${chunk.model}  |  我请求的是: ${model}`);
                  modelLogged = true;
                }
                const c = chunk.choices?.[0]?.delta?.content;
                if (c) {
                  rawContent += c;
                  const cleaned = sanitizeDebateReply(rawContent, 'Kit');
                  const newPart = cleaned.slice(sentLen);
                  if (newPart) { sentLen = cleaned.length; emit('token', { content: newPart }); }
                }
              } catch {}
            }
          }
        }
        txt = sanitizeDebateReply(rawContent, 'Kit');
        if (!txt) txt = 'Kit 没想好说什么 (；一_一)';
      }
      // Kit 工具结果摘要写进 session，保证下次不再重复承诺
      let kitToolSummary = '';
      if (kitToolCalls?.length) {
        kitToolSummary = kitToolCalls.map(tc => {
          const fn = tc.function?.name || '';
          const args = JSON.parse(tc.function?.arguments || '{}');
          if (fn === 'get_weather') return `[Kit已调用天气工具: city=${args.city}]`;
          if (fn === 'web_search') return `[Kit已调用搜索工具]`;
          return `[Kit已调用工具: ${fn}]`;
        }).join(' ') + '\n\n';
      }
      session.messages.push({ role: 'user', content: message });
      session.messages.push({ role: 'assistant', content: kitToolSummary + (kitFailureMsg || txt) });
      persistSession(session);
      if (userId && (kitFailureMsg || txt)) extractMemory(userId, message, kitFailureMsg || txt).catch(() => {});
      if (!reader) {
        res.end();
        return;
      }
      emit('done', {});
      res.end();
      return;
    }

    // 构建主消息
    let systemPrompt = SYSTEM_PROMPT() + memoryContext;
    // 主回复（非辩论轮次）永远去掉 Kit 描述，从根源防止 Pixel 幻觉跟 Kit 说话
    systemPrompt = systemPrompt
      .replace(/Kit 是你的毒舌搭档[^。]*/g, '')
      .replace(/如果用户提到 Kit[^。]*/g, '')
      .replace(/你别代 Kit 回应[^。]*/g, '');
    if (dualMode) {
      // 内测模式：告知 Kit 存在但不许在回复中跟 Kit 对话
      systemPrompt += '\n\n【回复规则】这轮你独立回答用户。你的回复中绝对不许出现"Kit"这个名字，不许假想Kit在场跟你对话，不许写"Kit，"开头的句子。如果用户@了Kit，那是跟Kit说话，Kit会自己回答，你别管。';
    }
    const tools = searchOn === false ? CHAT_TOOLS.filter(t => !['web_search', 'fetch_url', 'zhihu_search'].includes(t.function.name)) : CHAT_TOOLS;
    let msgs = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }];

    // 主回复 (Pixel) — 先发 label 再预检，让前端立刻显示回复气泡
    let mainText = '';
    emit('label', dualMode ? 'Pixel' : 'AI助手');

    // ReAct: 预检（工具路由）→ 执行工具 → 校验结果 → 必要时重搜 → 流式输出
    /* 2026-10-08：预检是"每次消息一次完整上游调用"，在慢模型上直接把首字延迟翻倍。
       因此加闲聊短路：短消息 + 无工具关键词 → 跳过预检，直接流式（快很多）。
       联网开关仍生效：只有"看着像需要查/算/画"的消息才会走预检。 */
    const localToolKeywords = /(画|图|图片|生成.*图|画图|画个|信息图|icon|海报|封面|插图|插画|配图|算|计算|数学|算术|等于|单位换算|天气|气温|下雨|温度|多少度|阴天|晴天)/i;
    const searchIntent = /(查|搜|新闻|最新|今天|昨天|现在|实时|价格|报价|股价|汇率|赛程|政策|发布|更新|官网|链接|http|www\.|\.com|知乎|微博|哪家|哪些|谁是|推荐)/i;
    const trivialChat = message.length <= 15 && !localToolKeywords.test(message) && !searchIntent.test(message);
    const shouldPrecheck = !trivialChat && (searchOn !== false || localToolKeywords.test(message));
    if (trivialChat) console.log('[precheck] 闲聊短路：跳过预检，直接流式');
    let toolCalls = shouldPrecheck ? await doPrecheck([...msgs], tools) : null;
    /* 2026-10-08（用户截图反馈）：说"帮我画一张信息图"，模型回了"现在生成图片："却没有图。
       原因是主模型（免费）没主动发 tool_calls，预检拿不到、流式阶段又不处理中途的工具调用，
       于是它只是在"说"要画。画图意图很明确，这里直接兜底调用 generate_image，不再看模型脸色。 */
    const drawIntent = /(画|绘|生成|做|来)[^，。；\n]{0,10}(图|海报|封面|插画|配图|信息图|图标)|信息图|插画|配图|画个|画一张|画一幅|画一张|做张|来张/i.test(message);
    if ((!toolCalls || !toolCalls.length) && drawIntent) {
      console.log('[tool] 命中画图意图但模型没调用工具 → 直接调用 generate_image');
      toolCalls = [{
        id: 'forced_image_' + Date.now(),
        type: 'function',
        function: { name: 'generate_image', arguments: JSON.stringify({ description: message.slice(0, 500) }) },
      }];
    }
    let toolResults = []; // 提升到块外，保证后面 toolSummary 构建时能访问
    if (toolCalls) {
      // 如果有搜索任务，先告诉用户一声，别让用户干等
      const searchCall = toolCalls.find(t => t.function.name === 'web_search');
      if (searchCall) {
        const q = JSON.parse(searchCall.function.arguments || '{}').query || '';
        emit('token', { content: `好的，让我派小弟去查一下「${q.substring(0, 50)}」，稍等~\n\n` });
      }
      toolResults = await executeToolCalls(toolCalls);
      msgs.push(...toolResults);

      // 搜索结果校验：如果 AI 想搜索但结果不理想，自动用更简单的关键词重搜一次
      // searchCall 已在上面声明
      if (searchCall) {
        const searchResult = toolResults.find(r => r.content.includes('未找到直接相关') || r.content.includes('未找到关于'));
        if (searchResult) {
          const origQuery = JSON.parse(searchCall.function.arguments || '{}').query || '';
          // 提取核心关键词（去掉日期等限定词）
          const simpleQuery = origQuery.replace(/\d{4}年\d{1,2}月\d{1,2}日/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '').trim();
          if (simpleQuery && simpleQuery !== origQuery && simpleQuery.length > 2) {
            console.log('ReAct: 首轮研究不理想，用简化关键词重试:', simpleQuery);
            emit('status', { text: `🔍 换个方式重新搜索："${simpleQuery.substring(0, 30)}"…` });
            const retrySub = await runSubAgent(
              `你是搜索研究助手。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
              `用户想知道："${simpleQuery}"。请搜索并给出答案。`,
              3,
              (step, action) => emit('status', { text: `🔍 重新搜索中 (第${step}步)…` })
            );
            if (retrySub.success && retrySub.answer) {
              msgs.push({ role: 'user', content: `[系统已用简化关键词重新研究: "${simpleQuery}"]\n\n${retrySub.answer}` });
            }
          }
        }
      }
    }
    // 选的模型没在当前套餐里（403）：直接说清楚，别让用户以为是"限流"
    if (planDeniedGuard(model)) {
      emit('token', { content: PLAN_DENIED_MSG });
      emit('done', {});
      return;
    }
    const reader = await fetchAIStream(msgs, model, getNextKey(keyKind), tools, 0.7, 3000, keyKind);
    let failureMsg = '';
    if (!reader) {
      failureMsg = 'AI 服务暂时响应失败，稍后再试吧~';
      emit('token', { content: failureMsg });
      emit('done', {});
    } else {
      // 实际服务的模型可能与请求的不同（跨供应商兜底）：告诉前端，界面上可以如实显示
      const actual = reader.actualModel || model;
      if (actual !== model) {
        console.log(`[provider] 实际使用 ${actual}（请求的是 ${model}）`);
        emit('meta', { model: actual, requestedModel: model, fallback: true, provider: reader.actualProvider || providerOf(actual) });
      } else {
        emit('meta', { model: actual, fallback: false, provider: providerOf(actual) });
      }
      let buffer = '', rawContent = ''; const dec = new TextDecoder();
      let modelLogged = false;
      let noProgressChunks = 0;   // 连续多少个 chunk 没有有效新内容（全部被过滤掉）
      let progressStreak = 0;    // 防误判
      const HARD_BREAK_STREAK = 200; // 修复误删根因后，放宽阈值避免假阳性断流
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const l of lines) {
          if (l.startsWith('data: ') && l.slice(6) !== '[DONE]') {
            try {
              const chunk = JSON.parse(l.slice(6));
              if (!modelLogged && chunk?.model) {
                console.log(`↩️  [Stream 实际模型] ${chunk.model}  |  我请求的是: ${model}`);
                modelLogged = true;
              }
              const c = chunk.choices?.[0]?.delta?.content;
              if (c) {
                // 增量过滤：基于原始文本的增量片段单独过滤后发送
                // （不再对全量文本过滤后 slice，避免 cleaned 被过滤器截短导致 sentLen 指针漂移 → 永久吞字）
                const prevLen = rawContent.length;
                rawContent += c;
                let cleanedDelta = sanitizeReply(rawContent.slice(prevLen));
                cleanedDelta = filterDualDelusions(cleanedDelta, dualMode);
                cleanedDelta = filterRoleLines(cleanedDelta, 'Pixel');
                if (cleanedDelta) {
                  emit('token', { content: cleanedDelta });
                  noProgressChunks = 0;
                  progressStreak++;
                } else {
                  noProgressChunks++;
                  // 连续 HARD_BREAK_STREAK 个 chunk 没有有效新内容 → 模型在复读废话，强制停
                  if (noProgressChunks >= HARD_BREAK_STREAK && progressStreak > 3) {
                    try { reader.cancel(); } catch {}
                    break;
                  }
                }
              }
            } catch {}
          }
        }
        if (noProgressChunks >= HARD_BREAK_STREAK && progressStreak > 3) break;
      }
      mainText = sanitizeReply(rawContent);
      mainText = filterDualDelusions(mainText, dualMode);
      mainText = filterRoleLines(mainText, 'Pixel');
      if (!mainText || mainText.length < 2) {
        /* 免费端点过载时会"HTTP 200 但流里没有任何内容"（实测 503 provider_overloaded 包在流里）。
           这时换供应商用非流式补一次，别直接把锅甩给用户。 */
        const rescue = fallbackCandidates(model)[0];
        if (rescue) {
          console.warn(`[provider] ${model} 流为空（上游过载？）→ 用 ${rescue} 非流式补一次`);
          try {
            const upR = upstream(rescue, keyKind);
            const rR = await fetch(upR.url, {
              method: 'POST', headers: upR.headers,
              body: JSON.stringify({ model: upR.model, messages: msgs, tools, tool_choice: 'auto', temperature: 0.7, max_tokens: Number(process.env.CHAT_MAX_TOKENS) || 1200 }),
            });
            if (rR.ok) {
              const dR = await rR.json();
              const tR = sanitizeReply(dR.choices?.[0]?.message?.content || '').trim();
              if (tR) { mainText = tR; emit('token', { content: tR }); console.log(`[provider] 补救成功（${rescue}）`); }
              else learnModelStatus(upR.model, 200, 'empty');
            } else {
              learnModelStatus(upR.model, rR.status, (await rR.text().catch(() => '')).slice(0, 200));
            }
          } catch (e) { console.error('空流补救失败:', e.message); }
        }
        if (!mainText || mainText.length < 2) {
          mainText = '上游模型刚才过载了（免费端点偶尔会这样），稍等几秒再说一遍好吗？';
        }
      }
    }
    // 工具结果摘要：合并成一句话，写进 assistant 消息的最前面（保证 session 里有工具调用记录+失败原因，下次不会重复承诺）
    let toolSummary = '';
    if (toolCalls?.length) {
      const callSummaries = toolCalls.map(tc => {
        const fn = tc.function?.name || '';
        const args = JSON.parse(tc.function?.arguments || '{}');
        if (fn === 'get_weather') return `[已调用天气工具: city=${args.city}]`;
        if (fn === 'web_search') return `[已调用搜索工具: ${args.query?.substring(0, 40) || ''}]`;
        if (fn === 'zhihu_search') return `[已调用知乎搜索: ${args.Query?.substring(0, 40) || args.query?.substring(0,40) || ''}]`;
        if (fn === 'generate_image') return `[已调用画图工具]`;
        if (fn === 'calculate') return `[已调用计算工具]`;
        if (fn === 'fetch_url') return `[已调用访问网页工具]`;
        return `[已调用工具: ${fn}]`;
      });
      // 合并工具执行结果（包含失败信息，如"天气服务返回 429"），让下次模型一眼看到失败原因
      const resultSummaries = toolResults?.map(r => {
        const content = r.content || '';
        // 截取失败关键词部分，避免 session 过长
        if (content.includes('天气服务返回') || content.includes('天气查询失败') || content.includes('429') || content.includes('找不到')) {
          const short = content.substring(0, 120);
          return short;
        }
        if (content.includes('未找到直接相关') || content.includes('无搜索结果')) {
          return content.substring(0, 120);
        }
        if (content.includes('图像生成失败') || content.includes('生成失败')) {
          return content.substring(0, 120);
        }
        return '';
      }).filter(Boolean) || [];
      toolSummary = callSummaries.join(' ')
        + (resultSummaries.length ? '\n' + resultSummaries.join('\n') : '')
        + '\n\n';
    }
    // 写 session：无论成功失败都必须落盘，否则下次模型看不到「上次查过+失败」→ 反复承诺我这就查
    session.messages.push({ role: 'user', content: message });
    session.messages.push({
      role: 'assistant',
      content: toolSummary + (failureMsg || mainText)
    });
    persistSession(session);

    // 提取长期记忆（不阻塞响应）
    if (userId && (failureMsg || mainText)) {
      extractMemory(userId, message, failureMsg || mainText).catch(() => {});
    }

    if (!reader) {
      res.end();
      return;
    }

    // 内测模式：互怼辩论（35%概率触发，Pixel和Kit互掐）
    const shouldDebate = dualMode && targetAI !== 'pixel' && mainText && Math.random() < 0.25;
    if (shouldDebate) {
      const STOP_WORDS = /(不说了|拜拜|再见|就到这儿|就到这吧|我撤了|你赢了|结束|停|够了|我认输|不想说了)/;
      let lastSpeaker = 'pixel';
      let lastText = mainText;
      const conversation = [
        { role: 'user', content: `Pixel 刚才说: ${lastText.slice(0, 300)}` }
      ];
      const pixelSaid = [], kitSaid = []; // 双方都追踪，防止互相复读

      for (let round = 0; round < 3; round++) {
        const isKitTurn = lastSpeaker === 'pixel';
        const name = isKitTurn ? 'Kit' : 'Pixel';
        const saidHistory = isKitTurn ? kitSaid : pixelSaid;

        // 精简 prompt：去掉冗长颜文字库，只保留核心指令
        const style = isKitTurn
          ? '你是 Kit，Pixel 的毒舌搭档。每句话结尾加一个颜文字，每次换不同的。库：(｀・ω・´)(◕‿◕)(´・ω・`)(￣▽￣)(ㆆ_ㆆ)(▼皿▼)(；一_一)(｀へ´)(◔_◔)(⊙﹏⊙)(≧∇≦)(゜∀゜)(°∀°)ﾉ(｀皿´)(｀ε´)(￣ω￣)(╯°□°)╯(´；ω；`)(•̀ᴗ•́)و。绝不用emoji。\n\n只和 Pixel 对话，怼 Pixel 刚才说的内容。用"你"称呼 Pixel。一句话（20字内）。不想继续就说"不说了"。\n\n🔥 每次说全新的！绝对不要重复自己之前说过的话！'
          : '你是 Pixel，俏皮可爱 ✨。每句话加emoji。Kit 刚才怼了你，简短回击 Kit。用"你"称呼 Kit。一句话（20字内）。不想继续就说"停"。\n\n🔥 每次说全新的！绝对不要重复自己之前说过的话！';

        const roundMsgs = [
          { role: 'system', content: style },
          ...conversation.slice(-6),
          { role: 'user', content: `${name}，到你了~` }
        ];

        // 双方都注入"已说过"提醒（只取最近2条，不塞长篇大论）
        if (saidHistory.length > 0) {
          const recent = saidHistory.slice(-2).join(' | ');
          roundMsgs.push({ role: 'user', content: `⚠️ 你之前说过："${recent}"——不许重复这些，说新的！` });
        }

        emit('label', name);
        // 双方都提高温度（Kit 0.95, Pixel 0.9）
        const temp = isKitTurn ? 0.95 : 0.9;
        const rReader = await fetchAIStream(roundMsgs, model, getNextKey(keyKind), null, temp, 200, keyKind);
        if (!rReader) break;

        let roundText = '';
        {
          let buffer = '', rawContent = '', sentLen = 0; const dec = new TextDecoder();
          while (true) {
            const { done, value } = await rReader.read();
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split('\n'); buffer = lines.pop() || '';
            for (const l of lines) {
              if (l.startsWith('data: ') && l.slice(6) !== '[DONE]') {
                try {
                  const c = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
                  if (c) {
                    rawContent += c;
                    const cleaned = sanitizeDebateReply(rawContent, name);
                    const newPart = cleaned.slice(sentLen);
                    if (newPart) { sentLen = cleaned.length; emit('token', { content: newPart }); }
                  }
                } catch {}
              }
            }
          }
          roundText = sanitizeDebateReply(rawContent, name);
        }

        if (!roundText.trim()) {
          emit('token', { content: name === 'Kit' ? '(￣ω￣)' : '…' });
          break;
        }

        // 记录发言（去颜文字/emoji，缩到40字）
        const saidBrief = roundText.replace(/[（(][^()（）]{2,20}[)）]/g, '').replace(/[\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '').trim().slice(0, 40);
        if (isKitTurn) { kitSaid.push(saidBrief); } else { pixelSaid.push(saidBrief); }

        conversation.push({ role: 'user', content: `${name} 刚才说: ${roundText.slice(0, 300)}` });
        session.messages.push({ role: 'assistant', content: roundText });
        lastSpeaker = isKitTurn ? 'kit' : 'pixel';
        lastText = roundText;

        if (STOP_WORDS.test(roundText)) break;
      }
      // 所有辩论轮次结束后统一存盘（原来每轮都写磁盘）
      persistSession(session);
    } else if (dualMode && targetAI !== 'pixel' && mainText) {
      // 不吵架时 Kit 正常补充一句
      const kitMsgs = [
        { role: 'system', content: '你是 Kit，Pixel 的毒舌搭档。每句话结尾必须加颜文字，绝不用emoji。回复1-2句。\n\n⚠️ 你只和 Pixel 说话——补充 Pixel 说得不够好的地方，或者从另一个角度拆台。用"你"称呼 Pixel，永远不直接跟用户说话。\n\n🔥 禁止重复：必须说全新的内容！不能和 Pixel 说一样的话，不能重复你以前说过的任何话！想不出新东西就说一个简短吐槽。' },
        ...history.slice(-6), { role: 'user', content: message },
        { role: 'user', content: `Pixel 刚才说: ${mainText.slice(0, 500)}。Kit 请补充（必须说新内容，不要复读 Pixel）` }
      ];
      emit('label', 'Kit');
      const kReader = await fetchAIStream(kitMsgs, model, getNextKey(keyKind), null, 0.95, 3000, keyKind);
      if (kReader) {
        let kitText = '';
        let buffer = '', rawContent = '', sentLen = 0; const dec = new TextDecoder();
        while (true) {
          const { done, value } = await kReader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const l of lines) {
            if (l.startsWith('data: ') && l.slice(6) !== '[DONE]') {
              try {
                const c = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
                if (c) {
                  rawContent += c;
                  const cleaned = sanitizeDebateReply(rawContent, 'Kit');
                  const newPart = cleaned.slice(sentLen);
                  if (newPart) { sentLen = cleaned.length; emit('token', { content: newPart }); }
                }
              } catch {}
            }
          }
        }
        kitText = sanitizeDebateReply(rawContent, 'Kit');
        if (kitText) { session.messages.push({ role: 'assistant', content: kitText }); persistSession(session); }
      }
    }

    emit('done', {});
    res.end();
  } catch (err) {
    console.error('Stream error:', err);
    res.end();
  }
});

// Agent 聊天接口（心跳保活 + 上下文记忆 + 自动摘要 + 工具调用 + 双人模式）
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message, sessionId, searchOn, dualMode, userId } = req.body;
    if (!message || message.length > 2000) {
      return res.status(400).json({ success: false, error: '消息无效或过长' });
    }
    // 模型白名单：前端可指定，默认取当前配置
    const pickedChat = resolveModel(req.body?.model, dualMode ? agentConfig.dualModel : agentConfig.model);
    if (pickedChat.rejected) console.warn(`[model] 前端请求了白名单外的模型「${pickedChat.rejected}」，回退到 ${pickedChat.model}`);

    // 检索长期记忆
    let memoryContext = '';
    if (userId) {
      try {
        const matched = retrieveMemories(userId, message, 3);
        if (matched.length) {
          memoryContext = '\n\n【你可能想起来的旧信息】\n' + matched.map(m => `- ${m.content}`).join('\n');
        }
        // 注入矫正规则
        const corrections = retrieveCorrections(userId, message, 2);
        if (corrections.length) {
          memoryContext += '\n\n【注意避开的坑】\n' + corrections.map(c => `- ${c.content}`).join('\n');
        }
      } catch {}
    }

    // 根据联网开关过滤工具
    const tools = searchOn === false
      ? CHAT_TOOLS.filter(t => !['web_search', 'fetch_url', 'zhihu_search'].includes(t.function.name))
      : CHAT_TOOLS;

    const keyKind = dualMode ? 'dual' : 'main';
    const apiKey = getNextKey(keyKind);
    const { baseUrl } = agentConfig;
    const model = pickedChat.model;

    let session = getSession(sessionId, userId);
    if (!session) session = createSession(userId);
    session.lastPing = Date.now();

    let systemPrompt = SYSTEM_PROMPT() + memoryContext;
    if (session.summary) systemPrompt += `\n\n【历史对话摘要】${session.summary}`;

    let history = session.messages.slice(-10).filter(m => {
      if (m.role === 'user' && typeof m.content === 'string' && /^\[系统/.test(m.content)) return false;
      return true;
    });
    history = cleanHistoryForDual(history, dualMode);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    // 非流式主对话：端点不可用 / 被限流时按「跨供应商」候选依次尝试，别让用户看到 500
    const makeChatBody = (m) => JSON.stringify({ model: m, messages, tools, tool_choice: 'auto', temperature: 0.7, max_tokens: Number(process.env.CHAT_MAX_TOKENS) || 1200 });
    let up = upstream(model, keyKind);
    let response = await fetch(up.url, { method: 'POST', headers: up.headers, body: makeChatBody(up.model) });
    if (!response.ok) {
      const firstErr = await response.text();
      learnModelStatus(up.model, response.status, firstErr);
      const shouldRetry = isEndpointUnavailable(firstErr, response.status) || response.status === 429 || isQuotaText(firstErr);
      if (shouldRetry) {
        for (const cand of fallbackCandidates(up.model)) {
          console.warn(`[provider] ${up.model} 失败（HTTP ${response.status}）→ 尝试 ${cand}`);
          up = upstream(cand, keyKind);
          response = await fetch(up.url, { method: 'POST', headers: up.headers, body: makeChatBody(up.model) });
          if (response.ok) break;
          const e2 = await response.text().catch(() => '');
          learnModelStatus(up.model, response.status, e2);
          if (!(isEndpointUnavailable(e2, response.status) || response.status === 429 || isQuotaText(e2))) break;
        }
      }
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('AI API error:', response.status, err.substring(0, 300));
      learnModelStatus(model, response.status, err);
      if (isPlanDenied(err)) return res.status(403).json({ success: false, error: PLAN_DENIED_MSG });
      return res.status(500).json({ success: false, error: 'AI 服务暂时不可用' });
    }
    learnModelStatus(model, 200);

    let data = await response.json();
    // 200 但体内是错误对象（OpenRouter 把上游 503 包在响应体里）→ 也算端点故障，继续换供应商
    if (data?.error || !data?.choices?.length) {
      const bodyErr = JSON.stringify(data?.error || {}).slice(0, 200);
      console.warn(`[provider] ${up.model} 返回体异常（${bodyErr || '无 choices'}）→ 尝试兜底`);
      for (const cand of fallbackCandidates(up.model)) {
        const upTry = upstream(cand, keyKind);
        const rTry = await fetch(upTry.url, { method: 'POST', headers: upTry.headers, body: makeChatBody(upTry.model) });
        if (rTry.ok) {
          const dTry = await rTry.json();
          if (dTry?.choices?.length) { data = dTry; up = upTry; learnModelStatus(upTry.model, 200); break; }
        }
        learnModelStatus(upTry.model, rTry.status, (await rTry.text().catch(() => '')).slice(0, 200));
      }
    }
    console.log(`↩️  [Chat 实际模型] ${data?.model || up.model || 'N/A'}  |  我请求的是: ${model}`);
    const choice = data.choices?.[0];

    // 检测原生 tool_calls
    let toolCalls = choice?.message?.tool_calls;

    // 模型可能把工具调用输出成了文本格式，解析它
    if (!toolCalls?.length && choice?.message?.content) {
      const content = choice.message.content;
      const fnMatch = content.match(/<function=(\w+)>/i);
      const paramMatch = content.match(/<parameter=(\w+)>([\s\S]*?)<\/parameter/i);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const args = {};
        if (paramMatch) args[paramMatch[1]] = paramMatch[2].trim();
        toolCalls = [{ id: 'tc_' + Date.now(), function: { name: fnName, arguments: JSON.stringify(args) } }];
      }
    }

    // 工具调用
    if (toolCalls?.length > 0) {
      const toolCall = toolCalls[0];
      const toolResult = await execTool(toolCall.function.name, JSON.parse(toolCall.function.arguments || '{}'));

      // 图片生成：直接返回图片 + AI 的简短回复
      if (toolCall.function.name === 'generate_image' && typeof toolResult === 'string' && toolResult.startsWith('__IMAGE__:')) {
        const imageUrl = toolResult.substring(10);
        let reply = sanitizeReply(choice.message.content || '给你画好啦~ ✨🎨');
        reply = filterDualDelusions(reply, dualMode);
        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'assistant', content: reply });
        return res.json({ success: true, reply, sessionId: session.id, image: imageUrl });
      }

      // web_search 返回 {sources, text} 对象
      const resultText = typeof toolResult === 'object' ? toolResult.text : toolResult;
      const resultSources = typeof toolResult === 'object' ? toolResult.sources : null;

      let reply = sanitizeReply(choice.message.content || `好的~ ${toolCall.function.name === 'calculate' ? '算出来了' : '帮你查了一下'} 🔍`);
      reply = filterDualDelusions(reply, dualMode);
      let resultWithTool = `${reply}\n\n${resultText}`;
      resultWithTool = filterDualDelusions(resultWithTool, dualMode);
      session.messages.push({ role: 'user', content: message });
      session.messages.push({ role: 'assistant', content: resultWithTool });
      const finalReply = filterDualDelusions(sanitizeReply(resultWithTool), dualMode);
      const resp = { success: true, reply: finalReply, sessionId: session.id, tool: { name: toolCall.function.name, result: resultText } };
      if (resultSources) resp.sources = resultSources;
      return res.json(resp);
    }

    let rawContent = choice?.message?.content || '';
    // 过滤掉泄露的 tool_call 文本
    if (rawContent.includes('<tool_call>') || rawContent.includes('<function=')) {
      rawContent = '正在搜索中...';
    }
    if (!rawContent) console.error('Empty AI response:', JSON.stringify(data).substring(0, 500));
    let reply = sanitizeReply(rawContent || '抱歉，我没有理解你的问题。');
    reply = filterDualDelusions(reply, dualMode);
    reply = filterRoleLines(reply, 'Pixel');
    let dualReply = '';

    // 内测模式：检测 @谁 决定谁回答 —— 若未开内测，强制 pixel（完全锁死 Kit 分支）
    let targetAI = 'both'; // both | pixel | kit
    if (dualMode) {
      const m = message.trim();
      if (/^@?Pixel/i.test(m) || /^Pixel[\s，,：:\u4e00-\u9fff]/i.test(m)) targetAI = 'pixel';
      else if (/^@?Kit/i.test(m) || /^Kit[\s，,：:\u4e00-\u9fff]/i.test(m)) targetAI = 'kit';
      else if (Math.random() < 0.3) targetAI = 'kit_first'; // 30% 概率 Kit 先答
    } else {
      targetAI = 'pixel';
    }

    // 内测模式：Kit 单独回答
    if (dualMode && targetAI === 'kit') {
      try {
        const kitKey = getNextKey(keyKind);
        const kitMessages = [
          { role: 'system', content: `你的名字叫 Kit，是 PixelKit 的小助手之一。性格：冷静又有点毒舌，但很靠谱。说话风格：用日式颜文字代替emoji。绝不能用emoji，只用颜文字。回复简洁自然。每次回复都要有变化，不要重复同样的句式结构。` },
          ...history.slice(-6),
          { role: 'user', content: message.replace(/^@?Kit[\s，,：:]+/, '') }
        ];
        const upKit = upstream(model, keyKind);
        const kitRes = await fetch(upKit.url, {
          method: 'POST',
          headers: upKit.headers,
          body: JSON.stringify({ model: upKit.model, messages: kitMessages, temperature: 0.9, max_tokens: 800, ...upKit.reasoning('low') })
        });
        if (kitRes.ok) {
          const kitData = await kitRes.json();
          reply = sanitizeReply(kitData.choices?.[0]?.message?.content || '...');
        } else {
          reply = 'Kit 暂时不在呢 (｡•́︿•̀｡)';
        }
        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'assistant', content: 'Kit: ' + reply });
        return res.json({ success: true, reply, sessionId: session.id, dualReply: '' });
      } catch {
        reply = 'Kit 掉线了 (；一_一)';
        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'assistant', content: 'Kit: ' + reply });
        return res.json({ success: true, reply, sessionId: session.id, dualReply: '' });
      }
    }

    // 内测模式：30% 概率 Kit 先答
    if (dualMode && targetAI === 'kit_first' && reply) {
      const origReply = reply;
      try {
        const kitKey = getNextKey(keyKind);
        const kitFirstMsgs = [
          { role: 'system', content: `你的名字叫 Kit，是 PixelKit 的小助手之一。性格：冷静又有点毒舌，但很靠谱。说话风格：用日式颜文字代替emoji。绝不能用emoji，只用颜文字。回复简洁自然。不要重复以前的说法，每次换新角度。` },
          ...history.slice(-6),
          { role: 'user', content: message }
        ];
        const upKit2 = upstream(model, keyKind);
        const kitRes = await fetch(upKit2.url, {
          method: 'POST',
          headers: upKit2.headers,
          body: JSON.stringify({ model: upKit2.model, messages: kitFirstMsgs, temperature: 0.9, max_tokens: 800, ...upKit2.reasoning('low') })
        });
        let kitReply = '';
        if (kitRes.ok) {
          const kitData = await kitRes.json();
          kitReply = sanitizeReply(kitData.choices?.[0]?.message?.content || '');
        }
        // Pixel 补充
        let pixelAdd = '';
        if (kitReply) {
          const pixelMsgs = [
            { role: 'system', content: '你是 PixelKit 的小助手 Pixel，性格俏皮可爱 ✨。Kit 刚才回答了用户，请你从另一个角度补充或点评（1-2句话）。用emoji不用颜文字。' },
            { role: 'user', content: message },
            { role: 'user', content: `Kit 刚才说: ${kitReply.substring(0, 500)}。Pixel，请补充一下~` }
          ];
          const upPix = upstream(model, keyKind);
          const pixelRes = await fetch(upPix.url, {
            method: 'POST',
            headers: upPix.headers,
            body: JSON.stringify({ model: upPix.model, messages: pixelMsgs, temperature: 0.7, max_tokens: 500, ...upPix.reasoning('low') })
          });
          if (pixelRes.ok) {
            const pixelData = await pixelRes.json();
            pixelAdd = sanitizeReply(pixelData.choices?.[0]?.message?.content || '');
          }
        }
        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'assistant', content: reply });
        if (kitReply) session.messages.push({ role: 'assistant', content: kitReply });
        if (pixelAdd) session.messages.push({ role: 'assistant', content: pixelAdd });
        return res.json({ success: true, reply, dualReply: kitReply, pixelAdd, sessionId: session.id });
      } catch {}
      // 失败回退
    }

    // 内测模式：Pixel 回复后，Kit 进行补充/点评
    if (dualMode && reply && targetAI !== 'pixel' && targetAI !== 'kit_first') {
      try {
        const dualKey = getNextKey(keyKind);
        const dualMessages = [
          { role: 'system', content: `你的名字叫 Kit，是 PixelKit 的小助手之一。性格：冷静又有点毒舌，但很靠谱。说话风格：用日式颜文字代替emoji。绝不能用emoji，只用颜文字。回复简洁（1-3句话），可以从不同角度补充或吐槽Pixel。不要重复 Pixel 说过的话，也不要重复自己以前说过的话。` },
          ...history.slice(-6),
          { role: 'user', content: message },
          { role: 'user', content: `Pixel 刚才说: ${reply.substring(0, 500)}。Kit，请从你的角度补充或点评一下~` }
        ];
        const upDual = upstream(model, keyKind);
        const dualRes = await fetch(upDual.url, {
          method: 'POST',
          headers: upDual.headers,
          body: JSON.stringify({ model: upDual.model, messages: dualMessages, temperature: 0.8, max_tokens: 500, ...upDual.reasoning('low') })
        });
        if (dualRes.ok) {
          const dualData = await dualRes.json();
          dualReply = sanitizeReply(dualData.choices?.[0]?.message?.content || '');
        } else {
          console.error('Kit response error:', dualRes.status, (await dualRes.text()).substring(0, 200));
        }
      } catch (e) {
        console.error('Kit call failed:', e.message);
      }
    }

    session.messages.push({ role: 'user', content: message });
    if (dualMode) {
      if (targetAI === 'both' || targetAI === 'pixel') session.messages.push({ role: 'assistant', content: 'Pixel: ' + reply });
      if (dualReply) session.messages.push({ role: 'assistant', content: 'Kit: ' + dualReply });
    } else {
      session.messages.push({ role: 'assistant', content: reply });
    }

    if (session.messages.length > 20) compressMemory(session).catch(() => {});
    persistSession(session);

    // 提取长期记忆（不阻塞响应）
    if (userId && reply) {
      extractMemory(userId, message, reply).catch(() => {});
    }

    res.json({ success: true, reply, dualReply, sessionId: session.id });

  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ success: false, error: '服务异常，请稍后再试' });
  }
});

// ==================== Agent 智能执行（文件上传 + API 调用） ====================

const agentUploadDir = path.join(os.tmpdir(), 'pixelkit-agent');
await fs.mkdir(agentUploadDir, { recursive: true });
const agentUpload = multer({
  dest: agentUploadDir,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 }
});

// 文件类型 → 可用操作映射
function getAvailableActions(files) {
  const exts = files.map(f => path.extname(f.originalname).toLowerCase());
  const allExts = [...new Set(exts)];
  const actions = [];

  // 文档类
  if (allExts.some(e => ['.docx','.doc','.xlsx','.xls','.pptx','.ppt','.html','.csv','.md'].includes(e))) {
    actions.push({ name: 'convert', desc: '转为PDF', params: { target: 'pdf' } });
    actions.push({ name: 'to_markdown', desc: '转为Markdown', params: {} });
  }
  // Markdown 可转 Word
  if (allExts.includes('.md')) {
    actions.push({ name: 'convert', desc: '转为Word(docx)', params: { target: 'docx' } });
  }
  // PDF 类
  if (allExts.includes('.pdf')) {
    actions.push({ name: 'convert', desc: '转为Word(docx)', params: { target: 'docx' } });
    actions.push({ name: 'pdf_to_img', desc: '每页导出为图片', params: { format: 'png' } });
    actions.push({ name: 'compress', desc: '压缩PDF', params: {} });
    actions.push({ name: 'to_markdown', desc: '转为Markdown', params: {} });
    if (files.length === 1) {
      actions.push({ name: 'encrypt', desc: '加密PDF(需密码)', params: { password: '123456' } });
      actions.push({ name: 'decrypt', desc: '解密PDF(需提供密码)', params: { password: '' } });
      actions.push({ name: 'watermark', desc: '添加水印', params: { text: 'Confidential' } });
    }
  }
  // 图片类
  if (allExts.every(e => ['.jpg','.jpeg','.png','.webp','.bmp','.gif','.svg'].includes(e))) {
    if (allExts.every(e => ['.jpg','.jpeg','.png','.webp','.bmp'].includes(e))) {
      actions.push({ name: 'img_to_pdf', desc: '合并为PDF', params: {} });
    }
    if (files.length === 1) {
      actions.push({ name: 'to_ico', desc: '转为ICO图标', params: {} });
      actions.push({ name: 'convert', desc: '转为PNG/JPG/WebP', params: { target: 'png' } });
    }
  }
  // 多文件合并
  if (files.length > 1 && allExts.every(e => ['.pdf'].includes(e))) {
    actions.push({ name: 'pdf_merge', desc: '合并PDF', params: {} });
  }
  if (files.length > 1 && allExts.every(e => ['.jpg','.jpeg','.png','.webp','.bmp'].includes(e))) {
    actions.push({ name: 'img_to_pdf', desc: '合并为PDF', params: {} });
  }

  if (files.length === 1) {
    const ext = exts[0];
    const textExts = ['.txt','.md','.csv','.log','.json','.xml','.html','.htm','.css','.js','.ts','.py','.java','.c','.cpp','.h','.sh','.yaml','.yml','.toml','.ini','.cfg','.conf','.docx','.doc','.xlsx','.xls','.pdf'];
    if (textExts.includes(ext)) {
      actions.push({ name: 'read_file', desc: '📖 阅读文件内容（AI 分析/总结/问答）', params: {} });
    }
  }

  return actions;
}

app.post('/api/agent/execute', (req, res, next) => {
  agentUpload.array('files', 10)(req, res, (err) => {
    if (err) {
      console.error('Agent upload error:', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: '文件超过50MB限制' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ success: false, error: '最多上传10个文件' });
      return res.status(500).json({ success: false, error: '文件上传失败: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  const taskId = uuidv4();
  const taskDir = path.join(outputDir, taskId);
  await fs.mkdir(taskDir, { recursive: true });

  try {
    console.log('Agent execute: files=', (req.files||[]).length, 'instruction=', (req.body.instruction||'').substring(0,50));
    const files = req.files || [];
    const instruction = (req.body.instruction || '').trim();
    const apiKey = getNextKey();
    const { baseUrl, model } = agentConfig;

    if (files.length === 0) {
      return res.status(400).json({ success: false, error: '请上传至少一个文件' });
    }

    const fileList = files.map(f => `${f.originalname} (${(f.size/1024).toFixed(1)}KB)`).join(', ');
    const actions = getAvailableActions(files);

    if (actions.length === 0) {
      const fileNames = files.map(f => f.originalname).join('、');
      return res.json({
        success: true,
        reply: `抱歉，${fileNames} 这种文件格式我暂时还不会处理 😅\n\n目前我支持：Word(.docx)、Excel(.xlsx)、PPT(.pptx)、PDF、Markdown(.md)、图片(.jpg/.png/.webp) 等格式。\n\n试试上传这些格式的文件吧~`
      });
    }

    // 构建原生 Function Calling tools
    const tools = actions.map(a => ({
      type: 'function',
      function: {
        name: a.name,
        description: a.desc,
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标格式，如 pdf/docx/png/jpeg/webp' },
            password: { type: 'string', description: '密码（加密/解密时需要）' },
            text: { type: 'string', description: '水印文字' },
            format: { type: 'string', description: '图片格式，如 png/jpeg/webp' }
          },
          required: []
        }
      }
    }));

    const messages = [
      { role: 'system', content: `用户上传了文件(${fileList})并说"${instruction || '请帮我处理'}"。请选择一个合适的操作。` },
      { role: 'user', content: instruction || '请帮我处理这些文件' }
    ];

    // 原生 Function Calling
    let chosenAction = null;
    try {
      const upAct = upstream(model, keyKind);
      const aiRes = await fetch(upAct.url, {
        method: 'POST',
        headers: upAct.headers,
        body: JSON.stringify({ model: upAct.model, messages, tools, tool_choice: 'auto', temperature: 0.1, max_tokens: 200, ...upAct.reasoning('none') })
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall) {
          chosenAction = { action: toolCall.function.name, ...JSON.parse(toolCall.function.arguments || '{}') };
        }
      }
    } catch {}

    // Fallback: 关键词匹配
    if (!chosenAction) {
      const kw = instruction.toLowerCase();
      if (kw.includes('pdf') || kw.includes('转pd')) chosenAction = { action: 'convert', target: 'pdf' };
      else if (kw.includes('word') || kw.includes('doc')) chosenAction = { action: 'convert', target: 'docx' };
      else if (kw.includes('压缩')) chosenAction = { action: 'compress' };
      else if (kw.includes('加密')) chosenAction = { action: 'encrypt', password: '123456' };
      else if (kw.includes('解密')) chosenAction = { action: 'decrypt', password: '' };
      else if (kw.includes('水印')) chosenAction = { action: 'watermark', text: 'Confidential' };
      else if (kw.includes('合并')) chosenAction = { action: files[0].originalname.endsWith('.pdf') ? 'pdf_merge' : 'img_to_pdf' };
      else if (kw.includes('图片') || kw.includes('png') || kw.includes('jpg')) chosenAction = { action: 'pdf_to_img', format: 'png' };
      else if (kw.includes('图标') || kw.includes('ico')) chosenAction = { action: 'to_ico' };
      else if (kw.includes('markdown') || kw.includes('md')) chosenAction = { action: 'to_markdown' };
      // 阅读/分析文件
      else if ((kw.includes('读') || kw.includes('read') || kw.includes('看') || kw.includes('看看')
        || kw.includes('分析') || kw.includes('总结') || kw.includes('概括') || kw.includes('摘要')
        || kw.includes('summarize') || kw.includes('analyze') || kw.includes('内容') || kw.includes('里面')
        || kw.includes('讲') || kw.includes('说')) && files.length === 1) {
        const ext = path.extname(files[0].originalname).toLowerCase();
        const textExts = ['.txt','.md','.csv','.log','.json','.xml','.html','.htm','.css','.js','.ts','.py','.java','.c','.cpp','.h','.sh','.yaml','.yml','.toml','.ini','.cfg','.conf','.docx','.doc','.xlsx','.xls','.pdf'];
        if (textExts.includes(ext)) {
          chosenAction = { action: 'read_file' };
        }
      }
      else if (kw.includes('拼接') || kw.includes('拼图') || kw.includes('组合')) {
        // 拼接是前端画布功能，引导用户
        return res.json({
          success: true,
          reply: `哎呀，图片拼接我暂时还不会自动处理呢~ 😅\n\n不过别担心！你可以用 PixelKit 的「🧩 图片拼接」功能哦，在首页就能找到，支持自由拖拽、编组、图层叠加，功能超强的！✨\n\n要不试试我擅长的？比如把这些图片"合并为PDF"~`
        });
      }
      else {
        // 无法判断意图，礼貌询问
        const hint = actions.map(a => `• ${a.desc}`).join('\n');
        return res.json({
          success: true,
          reply: `嗯~ 我收到你的文件啦，但不太确定你想怎么处理呢 🤔\n\n我能做的操作有：\n${hint}\n\n告诉我你想要哪一种呀？比如说"转成PDF"~`
        });
      }
    }

    // 执行操作
    const action = chosenAction.action;
    let result;

    switch (action) {
      case 'convert': {
        // 复用 /api/convert 逻辑
        const targetFormat = chosenAction.target || 'pdf';
        const inputFile = files[0];
        const inputExt = path.extname(inputFile.originalname);
        const renamedInput = path.join(path.dirname(inputFile.path), `input${inputExt}`);
        await fs.rename(inputFile.path, renamedInput);

        const extMap = { pdf: 'pdf', docx: 'docx', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };
        const loFormat = extMap[targetFormat] || targetFormat;

        // 特殊处理：PDF→Word
        if (inputExt === '.pdf' && loFormat === 'docx') {
          const outputPath = path.join(taskDir, 'output.docx');
          try {
            await runPy('pdf_to_docx.py', [renamedInput, outputPath]);
            await fs.unlink(renamedInput);
            const stat = await fs.stat(outputPath);
            result = { filename: 'output.docx', action: 'PDF→Word', size: stat.size };
          } catch (e) {
            await fs.unlink(renamedInput);
            return res.status(500).json({ success: false, error: '转换失败: ' + e.message });
          }
          break;
        }

        // 图片格式互转
        if (['.jpg','.jpeg','.png','.webp','.bmp'].includes(inputExt) && ['png','jpeg','webp'].includes(loFormat)) {
          const outputPath = path.join(taskDir, `output.${loFormat === 'jpeg' ? 'jpg' : loFormat}`);
          const pyCode = `
import sys
from PIL import Image
img = Image.open(sys.argv[1])
if img.mode in ('RGBA', 'P') and sys.argv[3] == 'jpeg':
    img = img.convert('RGB')
img.save(sys.argv[2], sys.argv[3].upper(), quality=92)
print('{"success":true}')
`;
          const pyFile = path.join(taskDir, '_convert.py');
          await fs.writeFile(pyFile, pyCode);
          await runPy('_convert.py', [renamedInput, outputPath, loFormat]);
          await fs.unlink(renamedInput);
          await fs.unlink(pyFile);
          const stat = await fs.stat(outputPath);
          result = { filename: path.basename(outputPath), action: `图片→${loFormat.toUpperCase()}`, size: stat.size };
          break;
        }

        // LibreOffice 转换
        const loCmd = getLibreOfficeCmd();
        if (!loCmd) {
          await fs.unlink(renamedInput);
          return res.status(500).json({ success: false, error: '服务器未安装 LibreOffice' });
        }
        const cmd = `${loCmd} --headless --convert-to ${loFormat} --outdir "${taskDir}" "${renamedInput}"`;
        await new Promise((resolve, reject) => {
          exec(cmd, { timeout: 180000 }, async (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        await fs.unlink(renamedInput);
        const outFiles = await fs.readdir(taskDir);
        const outFile = outFiles.find(f => f.endsWith(`.${loFormat}`));
        if (!outFile) throw new Error('转换后未找到输出文件');
        const stat = await fs.stat(path.join(taskDir, outFile));
        result = { filename: outFile, action: `转为${loFormat.toUpperCase()}`, size: stat.size };
        break;
      }

      case 'compress': {
        const output = path.join(taskDir, 'compressed.pdf');
        const r = await runPy('pdf_compress.py', [files[0].path, output]);
        await fs.unlink(files[0].path);
        result = { filename: 'compressed.pdf', action: '压缩PDF', size: r.compressed_size, detail: `压缩率 ${r.ratio}%` };
        break;
      }

      case 'encrypt': {
        const password = chosenAction.password || '123456';
        const output = path.join(taskDir, 'encrypted.pdf');
        await runPy('pdf_encrypt.py', [files[0].path, output, password]);
        await fs.unlink(files[0].path);
        result = { filename: 'encrypted.pdf', action: '加密PDF', detail: `密码: ${password}` };
        break;
      }

      case 'decrypt': {
        const password = chosenAction.password || '';
        const output = path.join(taskDir, 'decrypted.pdf');
        await runPy('pdf_decrypt.py', [files[0].path, output, password]);
        await fs.unlink(files[0].path);
        result = { filename: 'decrypted.pdf', action: '解密PDF' };
        break;
      }

      case 'watermark': {
        const text = chosenAction.text || 'Confidential';
        const output = path.join(taskDir, 'watermarked.pdf');
        await runPy('pdf_watermark.py', [files[0].path, output, text, '0.10', '#ff0000']);
        await fs.unlink(files[0].path);
        result = { filename: 'watermarked.pdf', action: '添加水印', detail: `水印: ${text}` };
        break;
      }

      case 'img_to_pdf': {
        const filePaths = files.map(f => f.path);
        const output = path.join(taskDir, 'output.pdf');
        const r = await runPy('img_to_pdf.py', [JSON.stringify(filePaths), output]);
        for (const fp of filePaths) { try { await fs.unlink(fp); } catch {} }
        result = { filename: 'output.pdf', action: '图片→PDF', detail: `${r.pages}页` };
        break;
      }

      case 'pdf_to_img': {
        const fmt = chosenAction.format || 'png';
        const pyCode = `
import sys, json, os
from pdf2image import convert_from_path
infile, outdir, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
images = convert_from_path(infile, dpi=200)
results = []
for i, img in enumerate(images):
    name = f"page_{i+1}.{fmt}"
    img.save(os.path.join(outdir, name), fmt.upper(), quality=95)
    results.append(name)
print(json.dumps({"success": True, "files": results}))
`;
        const pyFile = path.join(taskDir, '_pdf2img.py');
        await fs.writeFile(pyFile, pyCode);
        const r = await runPy('_pdf2img.py', [files[0].path, taskDir, fmt]);
        await fs.unlink(files[0].path);
        await fs.unlink(pyFile);
        result = { filename: r.files[0], action: 'PDF→图片', detail: `${r.files.length}张`, multi: r.files };
        break;
      }

      case 'pdf_merge': {
        const filePaths = files.map(f => f.path);
        const output = path.join(taskDir, 'merged.pdf');
        const r = await runPy('pdf_merge.py', [JSON.stringify(filePaths), output]);
        for (const fp of filePaths) { try { await fs.unlink(fp); } catch {} }
        result = { filename: 'merged.pdf', action: '合并PDF', detail: `${r.pages}页` };
        break;
      }

      case 'to_markdown': {
        const inputFile = files[0];
        const inputExt = path.extname(inputFile.originalname);
        const renamedInput = path.join(path.dirname(inputFile.path), `input${inputExt}`);
        await fs.rename(inputFile.path, renamedInput);
        const output = path.join(taskDir, 'output.md');
        await runPy('to_markdown.py', [renamedInput, output]);
        await fs.unlink(renamedInput);
        const stat = await fs.stat(output);
        result = { filename: 'output.md', action: '→Markdown', size: stat.size };
        break;
      }

      case 'to_ico': {
        const inputFile = files[0];
        const renamedInput = path.join(path.dirname(inputFile.path), 'input' + path.extname(inputFile.originalname));
        await fs.rename(inputFile.path, renamedInput);
        const output = path.join(taskDir, 'output.ico');
        await runPy('to_ico.py', [renamedInput, output]);
        await fs.unlink(renamedInput);
        const stat = await fs.stat(output);
        result = { filename: 'output.ico', action: '→ICO图标', size: stat.size };
        break;
      }

      case 'read_file': {
        // 提取文件文本，送给 AI 阅读分析
        const inputFile = files[0];
        const renamedInput = path.join(path.dirname(inputFile.path), 'input' + path.extname(inputFile.originalname));
        await fs.rename(inputFile.path, renamedInput);
        let fileText;
        try {
          const r = await runPy('read_file_text.py', [renamedInput, '40000']);
          await fs.unlink(renamedInput);
          if (!r.success) throw new Error(r.error);
          fileText = r.text;
        } catch (e) {
          try { await fs.unlink(renamedInput); } catch {}
          return res.status(500).json({ success: false, error: '文件读取失败: ' + e.message });
        }

        // 调用 AI 分析文件内容
        const { model } = agentConfig;
        const up = upstream(model);
        const fileName = files[0].originalname;
        const userPrompt = instruction
          ? `用户上传了文件"${fileName}"，内容如下。用户说：${instruction}\n\n请根据文件内容回答用户的问题。如果文件内容很长，提取关键信息回答。`
          : `用户上传了文件"${fileName}"，内容如下。请总结这个文件的主要内容，用清晰的结构呈现。`;

        try {
          const aiRes = await fetch(up.url, {
            method: 'POST',
            headers: up.headers,
            body: JSON.stringify({
              model: up.model, temperature: 0.5, max_tokens: 3000,
              messages: [
                { role: 'system', content: '你是 PixelKit 的文件阅读助手。用户上传了一个文件，请仔细阅读内容后回答。用清晰的结构呈现：先给摘要，再详细分析。用中文回复。' },
                { role: 'user', content: `${userPrompt}\n\n--- 文件内容 ---\n${fileText}\n--- 文件内容结束 ---` }
              ]
            }),
            signal: AbortSignal.timeout(60000)
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text().catch(() => '');
            throw new Error(`AI 服务响应异常 (${aiRes.status})`);
          }

          const aiData = await aiRes.json();
          const reply = sanitizeReply(aiData.choices?.[0]?.message?.content || '文件已读取，但 AI 未能生成回复');

          // 注入会话上下文
          const sessionId = req.body.sessionId;
          const session = getSession(sessionId, req.body?.userId);
          if (session) {
            session.messages.push({ role: 'user', content: `[上传了文件: ${fileName}] ${instruction || '请阅读这个文件'}` });
            session.messages.push({ role: 'assistant', content: reply });
            persistSession(session);
          }

          return res.json({
            success: true,
            reply,
            taskId,
            fileCount: 1,
            action: '阅读文件',
            detail: `${fileName} (${fileText.length} 字符)`
          });
        } catch (aiErr) {
          // AI 调用失败，至少返回原始文本
          const preview = fileText.substring(0, 2000);
          return res.json({
            success: true,
            reply: `📖 已读取 **${fileName}**（共 ${fileText.length} 字符），但 AI 分析暂时不可用。以下是文件内容预览：\n\n${preview}${fileText.length > 2000 ? '\n\n...(内容已截断)' : ''}`,
            taskId,
            fileCount: 1,
            action: '阅读文件'
          });
        }
      }

      default:
        return res.status(400).json({ success: false, error: `未知操作: ${action}` });
    }

    // 多文件时打包 zip
    if (result.multi && result.multi.length > 1) {
      result.downloadUrls = result.multi.map(f => `/api/download/${taskId}/${f}`);
      result.downloadUrl = `/api/download/${taskId}/${result.multi[0]}`;
    } else {
      result.downloadUrl = `/api/download/${taskId}/${result.filename}`;
    }
    result.taskId = taskId;
    result.success = true;
    result.fileCount = files.length;

    // AI 参与互动：生成自然回复 + 存入会话上下文
    try {
      const sizeText = result.size ? `${(result.size/1024).toFixed(1)}KB` : '';
      const fileNames = files.map(f => f.originalname).join('、');
      const summaryMessages = [
        {
          role: 'system',
          content: `你是 PixelKit 的可爱小助手，正在和用户对话中。用户上传了文件(${fileNames})并说"${instruction}"，系统已自动处理完成。请用活泼俏皮、元气满满的中文告知用户结果（2-3句话），可以加个恰当的小表情 🎉。不要提模型名称或技术术语。`
        },
        {
          role: 'user',
          content: `操作: ${result.action}\n文件: ${result.filename}\n大小: ${sizeText}\n${result.detail || ''}\n\n请告知我结果。`
        }
      ];
      const upSum = upstream(model, keyKind);
      const aiRes = await fetch(upSum.url, {
        method: 'POST',
        headers: upSum.headers,
        body: JSON.stringify({ model: upSum.model, messages: summaryMessages, temperature: 0.7, max_tokens: 300, ...upSum.reasoning('none') })
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const raw = (aiData.choices?.[0]?.message?.content || '').trim();
        result.reply = sanitizeReply(raw) || `✅ ${result.action}完成！`;
      }
    } catch {}
    if (!result.reply) {
      result.reply = `✅ 已为你完成${result.action}！${result.detail ? '\n' + result.detail : ''}`;
    }

    // 注入会话上下文（AI 能记住处理历史）
    const sessionId = req.body.sessionId;
    const session = getSession(sessionId, req.body?.userId);
    if (session) {
      session.messages.push({ role: 'user', content: `[用户上传了文件: ${files.map(f => f.originalname).join('、')}] ${instruction || '请处理这些文件'}` });
      session.messages.push({ role: 'assistant', content: result.reply + ` [处理完成: ${result.action}, 文件: ${result.filename}]` });
      persistSession(session);
    }

    // 清理多余文件
    for (const f of files) {
      try { await fs.unlink(f.path); } catch {}
    }

    res.json(result);

  } catch (err) {
    console.error('Agent execute error:', err.stack || err.message);
    for (const f of (req.files || [])) { try { await fs.unlink(f.path); } catch {} }
    res.json({ success: true, reply: '呜呜，处理文件时出了点小问题 😢\n\n可能是文件格式或服务器环境的原因，要不试试其他功能？或者换一种操作方式再试试~' });
  }
});

// ==================== AI 文生图（Sensenova U1 + 备用 API） ====================

/* 2026-10-08 排查："说生成图片却没有图"的真因 —— 旧模型名 sensenova-u1-fast 在
   /images/generations 上已返回 404 {"model is not found"}（模型虽在 /models 列表里，
   但已不再支持画图端点）。实测该账号可用的画图模型是 sensenova-u1.5-lite（HTTP 200，返回 b64_json）。
   改成可配置：IMAGE_MODEL 环境变量覆盖，默认取新的可用模型。 */
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'sensenova-u1.5-lite';

const SENSENOVA_IMAGE_SIZES = {
  landscape: '2368x1760',
  portrait: '1760x2368',
  square: '2048x2048'
};
const PORTRAIT_KEYWORDS = /竖版|竖屏|竖构图|海报|封面|专辑封面|书封|小说封面|手机壁纸|壁纸|名片|朋友圈配图|长图|Portrait|vertical/i;
const SQUARE_KEYWORDS = /方图|正方形|头像|图标|logo|二维码配图|方形|微信头像|album cover|square|icon|avatar/i;

function pickSensenovaSize(prompt) {
  if (SQUARE_KEYWORDS.test(prompt)) return SENSENOVA_IMAGE_SIZES.square;
  if (PORTRAIT_KEYWORDS.test(prompt)) return SENSENOVA_IMAGE_SIZES.portrait;
  return SENSENOVA_IMAGE_SIZES.landscape;
}

function pickFallbackSize(prompt, sizes) {
  if (!sizes || !sizes.length) return '1024x1024';
  const hasSquare = sizes.some(s => /^1\d{3}x1\d{3}$/.test(s) && s.split('x')[0] === s.split('x')[1]);
  const hasPortrait = sizes.some(s => { const [w,h] = s.split('x').map(Number); return h > w; });
  const hasLandscape = sizes.some(s => { const [w,h] = s.split('x').map(Number); return w > h; });
  if (SQUARE_KEYWORDS.test(prompt) && hasSquare) return sizes.find(s => { const [w,h] = s.split('x').map(Number); return w === h; }) || sizes[0];
  if (PORTRAIT_KEYWORDS.test(prompt) && hasPortrait) return sizes.find(s => { const [w,h] = s.split('x').map(Number); return h > w; }) || sizes[0];
  if (hasLandscape) return sizes.find(s => { const [w,h] = s.split('x').map(Number); return w > h; }) || sizes[0];
  return sizes[0];
}

// ==================== 生成图本地缓存（解决临时URL 1小时过期问题） ====================

const GENERATED_IMAGE_DIR = path.join(__dirname, 'data', 'generated_images');
await fs.mkdir(GENERATED_IMAGE_DIR, { recursive: true });

function guessImageExt(contentType, url) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';
  if (ct.includes('image/webp')) return '.webp';
  if (ct.includes('image/gif')) return '.gif';
  // 从 URL 猜
  const m = (url || '').toLowerCase().match(/\.(png|jpe?g|webp|gif)(\?|$)/);
  if (m) return m[1] === 'jpg' ? '.jpg' : '.' + m[1];
  return '.png';
}

async function cacheRemoteImage(url, onProgress) {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  const urlHash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  try {
    const existing = await fs.readdir(GENERATED_IMAGE_DIR);
    const hit = existing.find(f => f.startsWith(urlHash + '.'));
    if (hit) {
      console.log('Image cache hit:', hit);
      return `/api/agent/images/${hit}`;
    }
  } catch {}
  if (onProgress) onProgress('正在保存图片到本地…');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ext = guessImageExt(res.headers.get('content-type'), url);
    const filename = `${urlHash}${ext}`;
    const savePath = path.join(GENERATED_IMAGE_DIR, filename);
    const ab = await res.arrayBuffer();
    await fs.writeFile(savePath, Buffer.from(ab));
    console.log('Image cached:', filename, (ab.byteLength / 1024).toFixed(1), 'KB');
    return `/api/agent/images/${filename}`;
  } catch (e) {
    console.warn('Image cache download failed, fall back to original URL:', e.message);
    return url;
  }
}

// 清理 7 天以前的缓存图（12h 执行一次）
async function pruneOldImageCache() {
  try {
    const files = await fs.readdir(GENERATED_IMAGE_DIR);
    const now = Date.now();
    const MAX_AGE = 7 * 24 * 3600 * 1000;
    for (const f of files) {
      const fp = path.join(GENERATED_IMAGE_DIR, f);
      try {
        const st = await fs.stat(fp);
        if (now - st.mtimeMs > MAX_AGE) {
          await fs.rm(fp, { force: true });
          console.log('Pruned old cached image:', f);
        }
      } catch {}
    }
  } catch {}
}
setInterval(pruneOldImageCache, 12 * 3600 * 1000);
pruneOldImageCache();

// ==================== 统一每日垃圾清理 ====================
// 清理死号会话/记忆/矫正、访客IP截断、反馈记录限流、文件中转站独立清理
async function pruneOldData() {
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const DEAD_USER_AGE = 30 * DAY;   // 30天没活动 = 死号
  const DEAD_SESSION_AGE = 30 * DAY;

  console.log('[Prune] 开始每日数据清理...');
  let totalCleaned = 0;

  // 1) 磁盘会话：清理 30 天未更新的会话文件
  try {
    const sessFiles = await fs.readdir(sessionsDir);
    let cleaned = 0;
    for (const f of sessFiles) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(sessionsDir, f);
      try {
        const st = await fs.stat(fp);
        if (now - st.mtimeMs > DEAD_SESSION_AGE) {
          await fs.rm(fp, { force: true });
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) { console.log(`[Prune] 清理过期会话: ${cleaned} 个`); totalCleaned += cleaned; }
  } catch (e) { console.warn('[Prune] sessions清理异常:', e.message); }

  // 2) 长期记忆：清理 30 天未访问的死号用户记忆
  try {
    const memFiles = await fs.readdir(memoriesDir);
    let cleaned = 0;
    for (const f of memFiles) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(memoriesDir, f);
      try {
        const st = await fs.stat(fp);
        if (now - st.mtimeMs > DEAD_USER_AGE) {
          await fs.rm(fp, { force: true });
          memoryCache.delete(f.replace(/\.json$/, ''));
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) { console.log(`[Prune] 清理死号记忆: ${cleaned} 个`); totalCleaned += cleaned; }
  } catch (e) { console.warn('[Prune] memories清理异常:', e.message); }

  // 3) 矫正规则：清理 30 天未更新的死号用户
  try {
    const corrFiles = await fs.readdir(correctionsDir);
    let cleaned = 0;
    for (const f of corrFiles) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(correctionsDir, f);
      try {
        const st = await fs.stat(fp);
        if (now - st.mtimeMs > DEAD_USER_AGE) {
          await fs.rm(fp, { force: true });
          correctionCache.delete(f.replace(/\.json$/, ''));
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) { console.log(`[Prune] 清理死号矫正: ${cleaned} 个`); totalCleaned += cleaned; }
  } catch (e) { console.warn('[Prune] corrections清理异常:', e.message); }

  // 4) 文件中转站：独立定时清理过期物理文件 + 元数据（不依赖访问/list接口）
  try {
    const before = getFileShareData().length;
    const after = cleanExpiredFiles().length;
    if (before !== after) { console.log(`[Prune] 清理过期中转站文件: ${before - after} 个`); totalCleaned += (before - after); }
  } catch (e) { console.warn('[Prune] fileshare清理异常:', e.message); }

  // 5) 访客统计：_ips 只保留当天，防止无限膨胀
  try {
    if (existsSync(VISITOR_FILE)) {
      const data = JSON.parse(readFileSync(VISITOR_FILE, 'utf-8'));
      const today = new Date().toISOString().slice(0, 10);
      if (data.date !== today) {
        data._ips = {};
        data.date = today;
        if (!data.today) data.today = 0;
        saveVisitors(data);
        console.log('[Prune] 访客IP已截断（换日重置）');
      }
    }
  } catch (e) { console.warn('[Prune] visitors清理异常:', e.message); }

  // 6) 反馈记录：只保留最近 500 条，防止无限增长
  try {
    if (existsSync(FEEDBACK_FILE)) {
      const raw = readFileSync(FEEDBACK_FILE, 'utf-8');
      let feedbacks = JSON.parse(raw);
      if (Array.isArray(feedbacks) && feedbacks.length > 500) {
        feedbacks = feedbacks.slice(-500);
        writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbacks, null, 2));
        console.log(`[Prune] 反馈记录截断至 500 条`);
        totalCleaned++;
      }
    }
  } catch (e) { console.warn('[Prune] feedback清理异常:', e.message); }

  // 7) 协作白板文档：清理 30 天没动过的 ydoc
  try {
    if (typeof COLLAB_DATA_DIR !== 'undefined' && existsSync(COLLAB_DATA_DIR)) {
      const files = await fs.readdir(COLLAB_DATA_DIR);
      let cleaned = 0;
      for (const f of files) {
        if (!f.endsWith('.ydoc')) continue;
        const fp = path.join(COLLAB_DATA_DIR, f);
        try {
          const st = await fs.stat(fp);
          if (now - st.mtimeMs > DEAD_USER_AGE) {
            await fs.rm(fp, { force: true });
            collabDocs?.delete(f.replace(/\.ydoc$/, ''));
            cleaned++;
          }
        } catch {}
      }
      if (cleaned > 0) { console.log(`[Prune] 清理过期协作文档: ${cleaned} 个`); totalCleaned += cleaned; }
    }
  } catch (e) { /* 协作模块可能未初始化，忽略 */ }

  console.log(`[Prune] 每日清理完成，共清理 ${totalCleaned} 项`);
}
setInterval(pruneOldData, 24 * 3600 * 1000);
setTimeout(pruneOldData, 60 * 1000); // 启动1分钟后先跑一次

function getCachedImageSafe(req, res) {
  const raw = req.params.file || '';
  const safe = path.basename(raw);
  if (!/^[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(safe)) return res.status(400).end();
  const fp = path.join(GENERATED_IMAGE_DIR, safe);
  if (!existsSync(fp)) return res.status(404).end();
  const ext = path.extname(safe).toLowerCase();
  const mime = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return createReadStream(fp).pipe(res);
}

async function generateImagePrimary(prompt, size, onProgress) {
  const { baseUrl } = agentConfig;
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = getNextImageKey();
    try {
      const imgRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, n: 1 }),
        signal: AbortSignal.timeout(150000)
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const url = imgData.data?.[0]?.url || imgData.data?.[0]?.b64_json;
        if (url) return { ok: true, url };
        lastError = new Error('图片生成完成但无结果');
        continue;
      }
      if (imgRes.status === 429) {
        /* 画图可以等久一点（有进度提示、用户预期本来就慢）：按分钟边界退避，
           上限 IMAGE_MAX_WAIT_MS（默认 65s，取自 lib/ai-retry.js 的硬上限）。 */
        const errText = (await imgRes.text().catch(() => '')).substring(0, 300);
        const wait = quotaWaitMs({
          attempt, errText, retryAfterMs: parseRetryAfterMs(imgRes.headers),
          maxWaitMs: Number(process.env.AI_IMAGE_MAX_WAIT_MS) || DEFAULT_MAX_WAIT_MS,
        });
        if (onProgress) onProgress(`图片限流中，等 ${describeWait(wait)} 后第 ${attempt + 1} 次重试…`);
        console.log(`Image 429 (primary) retry ${attempt + 1}/${maxAttempts} after ${wait}ms`);
        await sleep(wait);
        lastError = new Error(`429 ${errText.slice(0, 120) || 'Too Many Requests'}`);
        continue;
      }
      const errText = (await imgRes.text()).substring(0, 300);
      console.error('Image API (primary) error:', imgRes.status, errText);
      lastError = new Error(`HTTP ${imgRes.status}`);
      if (imgRes.status === 400 || imgRes.status === 401 || imgRes.status === 403 || imgRes.status === 404) break;
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.error('Image gen (primary) failed after retries:', lastError?.message);
  return { ok: false, error: lastError?.message || '未知错误' };
}

async function generateImageFallback(prompt, onProgress) {
  const { imageFallback } = agentConfig;
  if (!imageFallback.enable || !imageFallback.baseUrl) return { ok: false, error: '未启用备用API' };
  const size = pickFallbackSize(prompt, imageFallback.sizes);
  if (onProgress) onProgress(`正在切换到备用图片模型…(${imageFallback.model})`);
  console.log(`Image fallback: model=${imageFallback.model} size=${size}`);
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const imgRes = await fetch(`${imageFallback.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${imageFallback.apiKey}` },
        body: JSON.stringify({ model: imageFallback.model, prompt, size, n: 1 }),
        signal: AbortSignal.timeout(150000)
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const url = imgData.data?.[0]?.url || imgData.data?.[0]?.b64_json;
        if (url) return { ok: true, url };
        lastError = new Error('备用API返回无结果');
        continue;
      }
      if (imgRes.status === 429) {
        const errText = (await imgRes.text().catch(() => '')).substring(0, 300);
        const wait = quotaWaitMs({
          attempt, errText, retryAfterMs: parseRetryAfterMs(imgRes.headers),
          maxWaitMs: Number(process.env.AI_IMAGE_MAX_WAIT_MS) || DEFAULT_MAX_WAIT_MS,
        });
        console.log(`Image 429 (fallback) retry ${attempt + 1}/${maxAttempts} after ${wait}ms`);
        await sleep(wait);
        lastError = new Error(`429 ${errText.slice(0, 120) || 'Too Many Requests'}`);
        continue;
      }
      const errText = (await imgRes.text()).substring(0, 300);
      console.error('Image API (fallback) error:', imgRes.status, errText);
      lastError = new Error(`HTTP ${imgRes.status}`);
      break;
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.error('Image gen (fallback) failed after retries:', lastError?.message);
  return { ok: false, error: lastError?.message || '未知错误' };
}

async function generateImageWithRetry(prompt, onProgress) {
  const size = pickSensenovaSize(prompt);
  console.log(`↩️  [画图 实际模型(主)] ${IMAGE_MODEL}  size=${size}  |  prompt 关键字: ${prompt.substring(0, 50).replace(/\n/g,' ')}`);
  const primary = await generateImagePrimary(prompt, size, onProgress);
  let result = primary;
  if (!result.ok && agentConfig.imageFallback.enable) {
    console.log(`↩️  [画图 实际模型(备用)] ${agentConfig.imageFallback.model}`);
    const fb = await generateImageFallback(prompt, onProgress);
    if (fb && fb.ok) result = fb;
    else if (fb) result = { ok: false, error: `主API: ${primary.error}；备用API: ${fb.error}` };
  }
  if (result.ok && result.url) {
    const cachedUrl = await cacheRemoteImage(result.url, onProgress);
    result.url = cachedUrl;
  }
  return result;
}

app.post('/api/agent/generate-image', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body;
    if (!prompt || prompt.length > 4000) {
      return res.status(400).json({ success: false, error: '描述不能为空或过长' });
    }

    const apiKey = getNextKey();
    const { baseUrl } = agentConfig;

    // 先用聊天模型优化 prompt（让 AI 把用户需求变成信息图描述）
    const optimizeMessages = [
      {
        role: 'system',
        content: '你是信息图生成专家。用户想生成一张信息图，请把用户的简短描述扩展成详细的信息图布局描述（排版结构、颜色、图标、各区块内容）。输出纯描述文本，200-800字。不要有任何前缀或说明。'
      },
      { role: 'user', content: prompt }
    ];

    let finalPrompt = prompt;
    try {
      const upOpt = upstream(agentConfig.model);
      const optRes = await fetch(upOpt.url, {
        method: 'POST',
        headers: upOpt.headers,
        body: JSON.stringify({ model: upOpt.model, messages: optimizeMessages, temperature: 0.8, max_tokens: 1500 })
      });
      if (optRes.ok) {
        const optData = await optRes.json();
        const optimized = sanitizeReply(optData.choices?.[0]?.message?.content || '');
        if (optimized && optimized.length > 50) finalPrompt = optimized;
      }
    } catch {}

    console.log('Image gen prompt:', finalPrompt.substring(0, 100) + '...');

    // 调用文生图 API（带 429 重试 + 多 key 轮询）
    const imgResult = await generateImageWithRetry(finalPrompt);

    if (!imgResult.ok) {
      console.error('Image gen error:', imgResult.error);
      return res.json({
        success: true,
        reply: '哎呀，生成图片时遇到了点小麻烦 😢\n\n可能是描述太复杂或者服务限流啦，试试简化描述，或者换一种说法再试试~'
      });
    }

    const isDataUrl = imgResult.url.startsWith('data:');
    const isHttpUrl = /^https?:\/\//i.test(imgResult.url);
    const isLocalPath = imgResult.url.startsWith('/');
    const imageUrl = isDataUrl || isHttpUrl || isLocalPath ? imgResult.url : null;
    const b64Json = imageUrl ? null : imgResult.url;

    // 注入会话
    const session = getSession(sessionId, req.body?.userId);
    if (session) {
      session.messages.push({ role: 'user', content: `[请生成一张图: ${prompt.substring(0, 100)}]` });
      session.messages.push({ role: 'assistant', content: '已为你生成图片 ✨' });
      persistSession(session);
    }

    const finalImage = imageUrl || (b64Json ? `data:image/png;base64,${b64Json}` : null);

    res.json({
      success: true,
      reply: '给你画好啦~ ✨🎨',
      image: finalImage,
      optimizedPrompt: finalPrompt
    });

  } catch (err) {
    console.error('Image gen error:', err);
    res.json({ success: true, reply: '生成图片时出了点小状况 😢 再试一次吧~' });
  }
});

// 本地缓存生成图访问（解决临时URL 1小时过期问题）
app.get('/api/agent/images/:file', getCachedImageSafe);

// ==================== AI 图片理解（多模态） ====================

const understandUpload = multer({
  dest: agentUploadDir,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }
});

app.post('/api/agent/understand-image', (req, res, next) => {
  understandUpload.single('file')(req, res, (err) => {
    if (err) return res.json({ success: true, reply: '图片太大了 😅 试试小于20MB的图片吧~' });
    next();
  });
}, async (req, res) => {
  try {
    const file = req.file;
    const question = (req.body.question || '图片里有什么？').trim();
    const apiKey = getNextKey();
    const { baseUrl, visionModel } = agentConfig;

    if (!file) return res.json({ success: true, reply: '没有收到图片呢~ 再传一次试试？' });

    // 读取图片转 base64
    const imgBuffer = await fs.readFile(file.path);
    const base64 = imgBuffer.toString('base64');
    const mime = file.mimetype || 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;

    // 多模态请求
    const messages = [
      {
        role: 'system',
        content: `你是 PixelKit 的可爱小助手 ✨ 用户上传了一张图片并给了指令。\n\n- 如果是数学题、试卷、公式类图片：完整识别所有题目和公式，用纯文本格式输出（如"3x+5=17"、"√(a²+b²)"、"dy/dx = 5 + 8/x"），绝对不能使用 \( \)、\[ \]、\frac、\ln 等LaTeX符号，所有公式都用ASCII纯文本表示\n- 如果是"描述/看看/是什么"：活泼俏皮看图说话（2-4句话）\n- 如果是"写故事/写文章/分析/写作"：根据图片创作\n- 识别文字要完整，不要遗漏\n\n当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ];

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModel, messages, temperature: 0.3, max_tokens: 2000 })
    });

    await fs.unlink(file.path);

    if (!response.ok) {
      return res.json({ success: true, reply: '哎呀，看图说话时遇到了点小麻烦 😅 再试一次吧~' });
    }

    const data = await response.json();
    const reply = sanitizeReply(data.choices?.[0]?.message?.content || '嗯...这张图我看不太清楚呢 🧐');

    // 注入会话
    const session = getSession(req.body.sessionId, req.body?.userId);
    if (session) {
      session.messages.push({ role: 'user', content: `[上传了一张图片并问: ${question}]` });
      session.messages.push({ role: 'assistant', content: reply });
      persistSession(session);
    }

    res.json({ success: true, reply });

  } catch (err) {
    console.error('Image understand error:', err);
    try { await fs.unlink(req.file?.path); } catch {}
    res.json({ success: true, reply: '看图时出了点小状况 😢 再试一次吧~' });
  }
});

// 定时清理
setInterval(async () => {
  try {
    const dirs = await fs.readdir(outputDir);
    const now = Date.now();
    for (const dir of dirs) {
      const dp = path.join(outputDir, dir);
      const stat = await fs.stat(dp);
      if (now - stat.mtimeMs > 3600000) {
        await fs.rm(dp, { recursive: true });
      }
    }
  } catch {}
}, 600000);

// ==================== 协同房间列表 ====================
app.get('/api/collab/rooms', (req, res) => {
  const rooms = [];
  for (const [name, doc] of collabDocs.entries()) {
    const clients = wss.clients.size > 0
      ? Array.from(wss.clients).filter(c => c._room === name && c.readyState === 1).length
      : 0;
    rooms.push({
      id: name,
      online: clients,
      updated: doc._lastAccess || null,
    });
  }
  res.json(rooms);
});

// （测速端点已于 2026-07-14 移除：首页卡片改为外部测速站链接，不再需要本地测速接口）

// Ping 测试
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, time: Date.now() });
});

// （客户端 IP 接口、测速排行榜、测速接口均已移除）

// ==================== 访问统计 ====================

// ==================== 访问统计 ====================
const VISITOR_FILE = path.join(__dirname, 'data', 'visitors.json');

function getVisitors() {
  try {
    if (!existsSync(VISITOR_FILE)) return { total: 0, today: 0, date: '' };
    return JSON.parse(readFileSync(VISITOR_FILE, 'utf-8'));
  } catch { return { total: 0, today: 0, date: '' }; }
}
function saveVisitors(data) {
  const dir = path.dirname(VISITOR_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(VISITOR_FILE, JSON.stringify(data, null, 2));
}

// 全局计数中间件（去重同一IP 24小时内）
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/favicon.svg') return next();
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);
  const data = getVisitors();
  if (data.date !== today) { data.date = today; data.today = 0; }
  // 简单去重：记录 IP
  data._ips = data._ips || {};
  if (!data._ips[ip]) {
    data._ips[ip] = true;
    data.total++;
    data.today++;
    saveVisitors(data);
  }
  next();
});

// 获取统计数据
app.get('/api/visitors', (req, res) => {
  const data = getVisitors();
  res.json({ total: data.total || 0, today: data.today || 0 });
});

// ==================== 反馈接口 ====================
const FEEDBACK_FILE = path.join(__dirname, 'data', 'feedback.json');

app.post('/api/feedback', (req, res) => {
  try {
    const { text, page, time } = req.body;
    if (!text || text.length > 2000) {
      return res.status(400).json({ error: '反馈内容无效' });
    }

    const dir = path.dirname(FEEDBACK_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let feedbacks = [];
    if (existsSync(FEEDBACK_FILE)) {
      feedbacks = JSON.parse(readFileSync(FEEDBACK_FILE, 'utf-8'));
    }

    feedbacks.push({
      id: Date.now(),
      text,
      page: page || 'unknown',
      time: time || new Date().toISOString(),
      ip: getClientIP(req),
    });

    writeFileSync(FEEDBACK_FILE, JSON.stringify(feedbacks, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error('Feedback error:', e.message);
    res.status(500).json({ error: '保存失败' });
  }
});

// ==================== 步步为营游戏服务器 ====================
// [已注销] 本次更新暂不带步步为营功能
if (false) {
// 核心数据结构：gameRooms: Map<roomId, Room>
//   Room = { id, players: Player[], fences: Fence[], currentTurn, winner, maxPlayers, createdAt }
//   Player = { ws, id, name, color, col, row, fences, goalRow, goalCol }
//   Fence = { col, row, dir }

const gameRooms = new Map();
const BOARD = 9;               // 9×9 棋盘
const FENCES_EACH = 10;        // 每人初始挡板数
const MAX_PLAYERS = 4;         // 支持 2-4 人对战
const CLEANUP_AGE = 3600000;   // 房间清理时限（1小时）
const GAME_SESSION_TTL = 2 * 60 * 1000;

function makeGameSessionToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function bindGamePlayerSocket(player, ws) {
  const oldSocket = player.ws;
  player.ws = ws;
  player.disconnectedAt = null;
  ws.gamePlayerId = player.id;
  if (oldSocket && oldSocket !== ws && oldSocket.readyState < WebSocket.CLOSING) {
    oldSocket.close(4001, 'session replaced');
  }
}

function gamePlayerConnected(player) {
  return player.ws?.readyState === WebSocket.OPEN;
}

function pruneExpiredGamePlayers(room, now = Date.now()) {
  for (const player of room.players) {
    if (!gamePlayerConnected(player) && player.disconnectedAt
        && now - player.disconnectedAt > GAME_SESSION_TTL) {
      player.expired = true;
    }
  }
}

// 玩家模板（2-4人）
const GAME_PLAYER_DEFS = [
  { color: '#ef4444', col: 4, row: 8, goalRow: 0,  goalCol: -1, name: '红方' },
  { color: '#3b82f6', col: 4, row: 0, goalRow: 8,  goalCol: -1, name: '蓝方' },
  { color: '#10b981', col: 0, row: 4, goalRow: -1, goalCol: 8,  name: '绿方' },
  { color: '#f59e0b', col: 8, row: 4, goalRow: -1, goalCol: 0,  name: '金方' },
];

/** 创建新房间 */
function createGameRoom(roomId) {
  return { id: roomId, players: [], fences: [],
    currentTurn: 0, winner: null, draw: false, pendingDraw: null,
    maxPlayers: MAX_PLAYERS, createdAt: Date.now() };
}

/** 导出房间的快照状态（纯数据，无 ws 引用） */
function gameSnapshot(room) {
  return {
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color, col: p.col, row: p.row,
      fences: p.fences, goalRow: p.goalRow, goalCol: p.goalCol,
      eliminated: !!p.eliminated, isBot: !!p.isBot,
      moves: p.moves || 0, wallsUsed: p.wallsUsed || 0,
    })),
    fences: room.fences.map(f => ({ ...f })),
    currentTurn: room.currentTurn,
    winner: room.winner,
    draw: !!room.draw,
    totalMoves: room.totalMoves || 0,
    startedAt: room.createdAt || Date.now(),
  };
}

/** 安全发送与协议字符串清洗 */
function gameSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function gameString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** 广播消息给房间内其他玩家 */
function broadcast(room, data, excludeWs = null) {
  const payload = JSON.stringify(data);
  for (const player of room.players) {
    if (player.ws !== excludeWs && gamePlayerConnected(player)) player.ws.send(payload);
  }
}

// ---- BFS 路径检测（核心算法） ----

/** 从 (c1,r1) 到 (c2,r2) 是否被挡板阻挡 */
function gameIsBlocked(room, c1, r1, c2, r2, extraFence = null) {
  const dc = c2 - c1, dr = r2 - r1;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return true;

  const blocksMove = (f) => {
    if (f.dir === 'h' && dr !== 0) {
      return f.row === Math.min(r1, r2) && (f.col === c1 || f.col === c1 - 1);
    }
    if (f.dir === 'v' && dc !== 0) {
      return f.col === Math.min(c1, c2) && (f.row === r1 || f.row === r1 - 1);
    }
    return false;
  };

  return (extraFence !== null && blocksMove(extraFence)) || room.fences.some(blocksMove);
}

/** BFS 计算从 (startCol,startRow) 到 playerIndex 目标的最短步数；不可达返回 -1 */
function gameShortestPath(room, playerIndex, startCol, startRow, extraFence = null) {
  const p = room.players[playerIndex];
  if (!p) return -1;
  const visited = new Int32Array(BOARD * BOARD).fill(-1);
  const queue = [{ col: startCol, row: startRow }];
  let head = 0;
  visited[startRow * BOARD + startCol] = 0;

  while (head < queue.length) {
    const { col: c, row: r } = queue[head++];
    if ((p.goalCol !== -1 && c === p.goalCol) ||
        (p.goalRow !== -1 && r === p.goalRow)) {
      return visited[r * BOARD + c];
    }
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= BOARD || nr < 0 || nr >= BOARD) continue;
      const idx = nr * BOARD + nc;
      if (visited[idx] !== -1 || gameIsBlocked(room, c, r, nc, nr, extraFence)) continue;
      visited[idx] = visited[r * BOARD + c] + 1;
      queue.push({ col: nc, row: nr });
    }
  }
  return -1;
}

/** BFS 判断 playerIndex 从当前位置能否到达目标 */
function gameHasPath(room, playerIndex, extraFence = null) {
  const p = room.players[playerIndex];
  if (!p) return false;

  const visited = new Uint8Array(BOARD * BOARD);
  const queue = [{ col: p.col, row: p.row }];
  let head = 0;
  visited[p.row * BOARD + p.col] = 1;

  while (head < queue.length) {
    const { col: c, row: r } = queue[head++];
    if (p.goalCol !== -1 && c === p.goalCol) return true;
    if (p.goalRow !== -1 && r === p.goalRow) return true;
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= BOARD || nr < 0 || nr >= BOARD) continue;
      const index = nr * BOARD + nc;
      if (visited[index] || gameIsBlocked(room, c, r, nc, nr, extraFence)) continue;
      visited[index] = 1;
      queue.push({ col: nc, row: nr });
    }
  }
  return false;
}

/** 检测挡板放置合法性（服务端权威校验） */
function gameCanPlaceFence(room, col, row, dir) {
  if (!Number.isInteger(col) || !Number.isInteger(row) || (dir !== 'h' && dir !== 'v')) return false;
  if (col < 0 || col >= BOARD - 1 || row < 0 || row >= BOARD - 1) return false;

  for (const f of room.fences) {
    if (f.dir !== dir && f.col === col && f.row === row) return false; // 交叉
    if (dir === 'h' && f.dir === 'h' && f.row === row && Math.abs(f.col - col) < 2) return false;
    if (dir === 'v' && f.dir === 'v' && f.col === col && Math.abs(f.row - row) < 2) return false;
  }

  const testFence = { col, row, dir };
  for (let i = 0; i < room.players.length; i++) {
    if (!gameHasPath(room, i, testFence)) return false;
  }
  return true;
}

function gameCheckWin(room, pi) {
  const p = room.players[pi];
  return (p.goalCol !== -1 && p.col === p.goalCol) || (p.goalRow !== -1 && p.row === p.goalRow);
}

/** 返回服务端权威合法走法，规则与客户端 QuoridorEngine 保持一致 */
function gameGetValidMoves(room, playerIndex) {
  const p = room.players[playerIndex];
  if (!p) return [];

  const moves = [];
  for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nc = p.col + dc, nr = p.row + dr;
    if (nc < 0 || nc >= BOARD || nr < 0 || nr >= BOARD) continue;
    if (gameIsBlocked(room, p.col, p.row, nc, nr)) continue;

    if (!room.players.some(op => op.col === nc && op.row === nr)) {
      moves.push({ col: nc, row: nr });
      continue;
    }

    const jc = nc + dc, jr = nr + dr;
    if (jc >= 0 && jc < BOARD && jr >= 0 && jr < BOARD &&
        !gameIsBlocked(room, nc, nr, jc, jr) &&
        !room.players.some(op => op.col === jc && op.row === jr)) {
      moves.push({ col: jc, row: jr });
      continue;
    }

    const diagonals = dc === 0
      ? [[nc - 1, nr], [nc + 1, nr]]
      : [[nc, nr - 1], [nc, nr + 1]];
    for (const [sc, sr] of diagonals) {
      if (sc >= 0 && sc < BOARD && sr >= 0 && sr < BOARD &&
          !gameIsBlocked(room, nc, nr, sc, sr) &&
          !room.players.some(op => op.col === sc && op.row === sr)) {
        moves.push({ col: sc, row: sr });
      }
    }
  }
  return moves;
}

function gameNextTurn(room) {
  for (let i = 0; i < room.players.length; i++) {
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    const p = room.players[room.currentTurn];
    if (p && !p.eliminated && !gameCheckWin(room, room.currentTurn)) return;
  }
}

// ==================== 随机匹配 & AI 玩家（bot） ====================

/** 创建 AI 玩家（无 ws，出招由服务端 maybeBotMove 驱动） */
function createBotPlayer(idx) {
  const def = GAME_PLAYER_DEFS[idx];
  return {
    ws: null, id: 'bot-' + uuidv4(), sessionToken: 'bot',
    name: 'AI玩家', color: def.color, col: def.col, row: def.row,
    fences: FENCES_EACH, goalRow: def.goalRow, goalCol: def.goalCol,
    eliminated: false, moves: 0, wallsUsed: 0,
    isBot: true, disconnectedAt: null, expired: false,
  };
}

/** 加入房间（真人）：返回 { player, idx }，失败返回 { error } */
function joinPlayerToRoom(ws, room, name) {
  pruneExpiredGamePlayers(room);
  let idx = room.players.findIndex(player => player && player.expired);
  if (idx < 0) idx = room.players.length;
  if (idx >= room.maxPlayers) return { error: '房间已满' };
  const def = GAME_PLAYER_DEFS[idx];
  const player = {
    ws: null, id: uuidv4(), sessionToken: makeGameSessionToken(),
    name: gameString(name, 32) || `玩家${idx + 1}`,
    color: def.color, col: def.col, row: def.row,
    fences: FENCES_EACH, goalRow: def.goalRow, goalCol: def.goalCol,
    eliminated: false, moves: 0, wallsUsed: 0,
    isBot: false, disconnectedAt: null, expired: false,
  };
  bindGamePlayerSocket(player, ws);
  room.players[idx] = player;
  return { player, idx };
}

function clearRoomTimers(room) {
  if (room._pendingBotTimer) { clearTimeout(room._pendingBotTimer); room._pendingBotTimer = null; }
  if (room._botTurnTimer) { clearTimeout(room._botTurnTimer); room._botTurnTimer = null; }
}

/** 由服务端直接执行 AI 玩家的动作（校验 + 更新房间状态） */
function applyBotAction(room, action) {
  const pi = room.currentTurn;
  const p = room.players[pi];
  if (!p || !p.isBot || p.eliminated) return false;

  if (action.type === 'move') {
    if (!gameGetValidMoves(room, pi).some(m => m.col === action.col && m.row === action.row)) return false;
    p.col = action.col;
    p.row = action.row;
    p.moves = (p.moves || 0) + 1;
    room.totalMoves = (room.totalMoves || 0) + 1;
    room.winner = gameCheckWin(room, pi) ? pi : null;
    if (room.winner === null) gameNextTurn(room);
    return true;
  }
  if (action.type === 'fence') {
    if (p.fences <= 0 || !gameCanPlaceFence(room, action.col, action.row, action.dir)) return false;
    p.fences--;
    p.wallsUsed = (p.wallsUsed || 0) + 1;
    room.fences.push({ col: action.col, row: action.row, dir: action.dir, playerIndex: pi });
    gameNextTurn(room);
    return true;
  }
  return false;
}

/** 轮到 AI 玩家时安排自动出招（复用大模型接口，失败回退首个合法着法） */
function maybeBotMove(room) {
  if (room.winner !== null || room.draw) return;
  const cur = room.players[room.currentTurn];
  if (!cur || !cur.isBot || cur.eliminated) return;
  if (room._botTurnTimer) return;

  room._botTurnTimer = setTimeout(async () => {
    room._botTurnTimer = null;
    if (!gameRooms.has(room.id)) return; // 房间已被清理
    if (room.winner !== null || room.draw) return;
    let result = null;
    try { result = await requestQuoridorMove(room); } catch (e) { console.error('[Bot] 出招失败:', e.message); }
    const action = (result && result.action) || firstLegalQuoridorAction(room);
    if (action && applyBotAction(room, action)) {
      if (!gameRooms.has(room.id)) return;
      broadcast(room, { type: 'update', state: gameSnapshot(room) });
      maybeBotMove(room);
    }
  }, 500);
}

// 定时清理
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of gameRooms) {
    pruneExpiredGamePlayers(room, now);
    if (!room.players.some(player => player.ws?.readyState === WebSocket.OPEN)
        && now - room.createdAt > CLEANUP_AGE) {
      gameRooms.delete(id);
    }
  }
}, 300000);
} // [已注销] 步步为营游戏服务器 if(false) 结束

// ==================== 协同服务器（Yjs WebSocket） ====================
const collabDocs = new Map();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// 记录所有 WebSocket 连接尝试
server.on('upgrade', (req, socket, head) => {
  console.log(`[WS] 升级请求: ${req.url}`);
});

wss.on('headers', (headers, req) => {
  console.log(`[WS] 握手成功: ${req.url}`);
});

wss.on('connection', (ws, req) => {
  const urlPath = req?.url || '';

  // ==================== 步步为营游戏 WebSocket ====================
  // [已注销] 本次更新暂不带步步为营功能
  if (false && (urlPath === '/game' || urlPath.startsWith('/game?'))) {
    let myRoomId = null;

    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        switch (m.type) {

          // --- 创建房间 ---
          case 'create': {
            const requestId = gameString(m.requestId, 100);
            try {
              const requestedMaxPlayers = Number(m.maxPlayers ?? 2);
              if (!Number.isInteger(requestedMaxPlayers) || ![2, 4].includes(requestedMaxPlayers)) {
                throw Object.assign(new Error('房间人数必须是 2 或 4'), { code: 'INVALID_MAX_PLAYERS' });
              }
              if (myRoomId) {
                throw Object.assign(new Error('当前连接已在房间中'), { code: 'ALREADY_IN_ROOM' });
              }

              let id;
              do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (gameRooms.has(id));
              const room = createGameRoom(id);
              room.maxPlayers = requestedMaxPlayers;
              const def = GAME_PLAYER_DEFS[0];
              const pid = uuidv4();
              const player = {
                ws: null, id: pid, sessionToken: makeGameSessionToken(),
                name: gameString(m.name, 32) || '玩家1',
                color: def.color, col: def.col, row: def.row,
                fences: FENCES_EACH, goalRow: def.goalRow, goalCol: def.goalCol,
                disconnectedAt: null,
              };
              bindGamePlayerSocket(player, ws);
              room.players.push(player);
              myRoomId = id;
              gameRooms.set(id, room);
              console.log(`[游戏] 房间 ${id} 已创建 (${requestedMaxPlayers}人), requestId=${requestId || '-'}`);
              gameSend(ws, {
                type: 'created', roomId: id, playerId: pid,
                sessionToken: player.sessionToken, playerIndex: 0, state: gameSnapshot(room), requestId,
              });
            } catch (error) {
              console.error('[游戏] 创建房间失败:', {
                requestId,
                code: error.code || 'CREATE_FAILED',
                message: error.message,
              });
              gameSend(ws, {
                type: 'error', requestId,
                code: error.code || 'CREATE_FAILED',
                message: error.message || '创建房间失败',
              });
            }
            break;
          }

          // --- 随机匹配 ---
          case 'matchmake': {
            if (myRoomId) {
              gameSend(ws, { type: 'error', message: '当前已在房间中' });
              return;
            }
            const name = gameString(m.name, 32);

            // 1) 有正在等待真人的匹配房间 → 直接加入（真人 PK）
            let target = null;
            for (const [, room] of gameRooms) {
              if (room.matchmaking &&
                  room.players.some(p => p && !p.isBot) &&
                  room.players.length < room.maxPlayers) {
                target = room;
                break;
              }
            }
            if (target) {
              const res = joinPlayerToRoom(ws, target, name);
              if (res.error) {
                gameSend(ws, { type: 'error', message: res.error });
                return;
              }
              myRoomId = target.id;
              target.matchmaking = false;
              clearTimeout(target._pendingBotTimer);
              target._pendingBotTimer = null;
              gameSend(ws, {
                type: 'matched', roomId: target.id, playerId: res.player.id,
                sessionToken: res.player.sessionToken, playerIndex: res.idx,
                state: gameSnapshot(target), opponentIsBot: false,
              });
              broadcast(target, { type: 'matched', opponentIsBot: false, state: gameSnapshot(target) }, ws);
              console.log(`[游戏] 匹配: ${res.player.name} 与真人房间 ${target.id} 配对`);
              break;
            }

            // 2) 无真人等待 → 新建匹配房间，4 秒后仍未等到真人则补 AI 玩家
            let id;
            do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (gameRooms.has(id));
            const room = createGameRoom(id);
            room.maxPlayers = 2;
            room.matchmaking = true;
            const def = GAME_PLAYER_DEFS[0];
            const pid = uuidv4();
            const player = {
              ws: null, id: pid, sessionToken: makeGameSessionToken(),
              name: name || '玩家1', color: def.color, col: def.col, row: def.row,
              fences: FENCES_EACH, goalRow: def.goalRow, goalCol: def.goalCol,
              eliminated: false, moves: 0, wallsUsed: 0,
              isBot: false, disconnectedAt: null, expired: false,
            };
            bindGamePlayerSocket(player, ws);
            room.players[0] = player;
            myRoomId = id;
            gameRooms.set(id, room);
            gameSend(ws, {
              type: 'matched', roomId: id, playerId: pid,
              sessionToken: player.sessionToken, playerIndex: 0,
              state: gameSnapshot(room), opponentIsBot: false, waiting: true,
            });
            room._pendingBotTimer = setTimeout(() => {
              room._pendingBotTimer = null;
              const roomNow = gameRooms.get(id);
              if (!roomNow || !roomNow.matchmaking || roomNow.winner !== null || roomNow.draw) return;
              if (roomNow.players.length >= roomNow.maxPlayers) return; // 已有真人加入
              const bot = createBotPlayer(1);
              roomNow.players[1] = bot;
              roomNow.matchmaking = false;
              broadcast(roomNow, { type: 'bot_joined', state: gameSnapshot(roomNow) });
              maybeBotMove(roomNow);
              console.log(`[游戏] 匹配房间 ${id} 未等到真人，AI 玩家加入`);
            }, 4000);
            break;
          }

          // --- 加入房间 ---
          case 'join': {
            const roomId = gameString(m.roomId, 8).toUpperCase();
            const room = gameRooms.get(roomId);
            if (!room) {
              gameSend(ws, { type: 'error', message: '房间不存在，请检查房间号' });
              return;
            }
            const res = joinPlayerToRoom(ws, room, m.name);
            if (res.error) {
              gameSend(ws, { type: 'error', message: res.error });
              return;
            }
            myRoomId = roomId;

            // 该房间原本在匹配等待 → 配对成功，通知双方并取消补 bot 定时器
            if (room.matchmaking) {
              room.matchmaking = false;
              clearTimeout(room._pendingBotTimer);
              room._pendingBotTimer = null;
              broadcast(room, { type: 'matched', opponentIsBot: false, state: gameSnapshot(room) });
            }

            gameSend(ws, {
              type: 'joined', roomId, playerId: res.player.id,
              sessionToken: res.player.sessionToken, playerIndex: res.idx, state: gameSnapshot(room),
            });
            broadcast(room, { type: 'player_joined', name: res.player.name, state: gameSnapshot(room) }, ws);
            console.log(`[游戏] ${res.player.name} 加入房间 ${roomId}`);
            break;
          }

          // --- 断线重连 ---
          case 'rejoin': {
            const roomId = gameString(m.roomId, 8).toUpperCase();
            const playerId = gameString(m.playerId, 64);
            const sessionToken = gameString(m.sessionToken, 128);
            const room = gameRooms.get(roomId);
            const idx = room?.players.findIndex(player => (
              player.id === playerId && player.sessionToken === sessionToken
            )) ?? -1;
            const player = idx >= 0 ? room.players[idx] : null;
            const expired = player?.disconnectedAt
              && Date.now() - player.disconnectedAt > GAME_SESSION_TTL;
            if (!room || !player || expired) {
              gameSend(ws, { type: 'error', message: '房间或玩家身份已失效' });
              return;
            }
            bindGamePlayerSocket(player, ws);
            myRoomId = roomId;
            gameSend(ws, {
              type: 'joined', roomId, playerId, sessionToken: player.sessionToken,
              playerIndex: idx, state: gameSnapshot(room), rejoined: true,
            });
            broadcast(room, { type: 'player_joined', name: player.name, state: gameSnapshot(room) }, ws);
            break;
          }

          // --- 移动棋子 ---
          case 'move': {
            const room = gameRooms.get(myRoomId);
            if (!room || room.players.length < 2 ||
                room.winner !== null || room.draw || m.pi !== room.currentTurn) return;
            if (!Number.isInteger(m.pi) || !Number.isInteger(m.col) || !Number.isInteger(m.row)) return;
            const p = room.players[m.pi];
            if (!p || p.ws !== ws) return; // 身份校验：只有当前回合玩家本人能走棋
            if (!gameGetValidMoves(room, m.pi).some(move => move.col === m.col && move.row === m.row)) return;
            p.col = m.col;
            p.row = m.row;
            p.moves = (p.moves || 0) + 1;
            room.totalMoves = (room.totalMoves || 0) + 1;
            room.winner = gameCheckWin(room, m.pi) ? m.pi : null;
            if (room.winner === null) gameNextTurn(room);
            broadcast(room, { type: 'update', state: gameSnapshot(room) });
            maybeBotMove(room);
            break;
          }

          // --- 放置挡板 ---
          case 'fence': {
            const room = gameRooms.get(myRoomId);
            if (!room || room.players.length < 2 || room.winner !== null || room.draw) return;
            if (!Number.isInteger(m.col) || !Number.isInteger(m.row) ||
                (m.dir !== 'h' && m.dir !== 'v')) return;
            const tp = room.players[room.currentTurn];
            if (tp.ws !== ws || tp.fences <= 0) return;
            if (!gameCanPlaceFence(room, m.col, m.row, m.dir)) return;
            tp.fences--;
            tp.wallsUsed = (tp.wallsUsed || 0) + 1;
            room.fences.push({ col: m.col, row: m.row, dir: m.dir, playerIndex: room.currentTurn });
            gameNextTurn(room);
            broadcast(room, { type: 'update', state: gameSnapshot(room) });
            maybeBotMove(room);
            break;
          }

          // --- 认输 ---
          case 'surrender': {
            const room = gameRooms.get(myRoomId);
            if (!room || room.winner !== null || room.draw) return;
            const si = room.players.findIndex(p => p.ws === ws);
            if (si < 0 || room.players[si].eliminated) return;
            room.players[si].eliminated = true;
            const active = room.players.filter(p => p && !p.eliminated);
            if (active.length === 1) {
              room.winner = room.players.indexOf(active[0]);
            } else {
              gameNextTurn(room);
            }
            broadcast(room, { type: 'update', state: gameSnapshot(room) });
            maybeBotMove(room);
            break;
          }

          // --- 发起和棋请求 ---
          case 'draw_offer': {
            const room = gameRooms.get(myRoomId);
            if (!room || room.winner !== null || room.draw) return;
            const pi = room.players.findIndex(p => p.ws === ws);
            if (pi < 0) return;
            // 与 AI 玩家对局时不接受求和（直接拒绝）
            if (room.players.filter(p => p && !p.isBot).length < 2) {
              gameSend(ws, { type: 'draw_declined' });
              return;
            }
            room.pendingDraw = room.players[pi].id;
            broadcast(room, { type: 'draw_offer', playerId: room.players[pi].id }, ws);
            break;
          }

          // --- 响应和棋请求 ---
          case 'draw_response': {
            const room = gameRooms.get(myRoomId);
            if (!room || room.winner !== null || room.draw || !room.pendingDraw) return;
            const pi = room.players.findIndex(p => p.ws === ws);
            if (pi < 0 || room.players[pi].id === room.pendingDraw) return;
            if (m.accept === true) {
              room.draw = true;
              room.pendingDraw = null;
              broadcast(room, { type: 'update', state: gameSnapshot(room) });
            } else {
              room.pendingDraw = null;
              broadcast(room, { type: 'draw_declined' }, ws);
            }
            break;
          }

          // --- 心跳 ---
          case 'ping': {
            gameSend(ws, { type: 'pong' });
            break;
          }

          // --- 离开房间 ---
          case 'leave': {
            if (myRoomId) {
              const room = gameRooms.get(myRoomId);
              if (room) {
                const hadOpponent = room.players.length > 1;
                room.players = room.players.filter(p => p.ws !== ws);
                room.pendingDraw = null;
                const realCount = room.players.filter(p => p && !p.isBot).length;
                if (realCount === 0) {
                  // 真人全部离开（含 AI 房间 / 匹配等待中）→ 清理并销毁
                  clearRoomTimers(room);
                  gameRooms.delete(myRoomId);
                } else {
                  // 对局中只剩一人时，剩余玩家直接获胜
                  if (hadOpponent && room.players.length === 1 &&
                      room.winner === null && !room.draw) {
                    room.winner = 0;
                  }
                  broadcast(room, { type: 'player_left', state: gameSnapshot(room) });
                }
              }
              myRoomId = null;
            }
            break;
          }
        }
      } catch (e) {
        console.error('[游戏] 消息错误:', e);
        gameSend(ws, {
          type: 'error', code: 'MESSAGE_HANDLER_FAILED',
          message: e?.message || '服务器处理消息失败',
        });
      }
    });

    ws.on('close', () => {
      if (myRoomId) {
        const room = gameRooms.get(myRoomId);
        const player = room?.players.find(p => p.ws === ws);
        if (player) {
          player.ws = null;
          broadcast(room, { type: 'player_left', state: gameSnapshot(room) });
        }
      }
    });

    return; // 跳过协同逻辑
  }

  // ==================== 协同 WebSocket 逻辑 ====================
  const room = urlPath.split('/').pop() || 'default';
  console.log(`[协同] 客户端加入房间: ${room}`);
  ws._room = room;

  if (!collabDocs.has(room)) {
    collabDocs.set(room, new Y.Doc());
  }
  const ydoc = collabDocs.get(room);
  ydoc._lastAccess = Date.now();

  // 给新客户端发送完整同步
  const enc1 = encoding.createEncoder();
  encoding.writeVarUint(enc1, 0);
  encoding.writeVarUint(enc1, 0);
  encoding.writeVarUint8Array(enc1, Y.encodeStateVector(ydoc));
  ws.send(encoding.toUint8Array(enc1));

  const enc2 = encoding.createEncoder();
  encoding.writeVarUint(enc2, 0);
  encoding.writeVarUint(enc2, 2);
  encoding.writeVarUint8Array(enc2, Y.encodeStateAsUpdate(ydoc));
  ws.send(encoding.toUint8Array(enc2));

  // 监听文档变化推送给客户端
  const handler = (update, origin) => {
    if (origin === ws) return;
    if (ws.readyState !== 1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    encoding.writeVarUint(enc, 2);
    encoding.writeVarUint8Array(enc, update);
    ws.send(encoding.toUint8Array(enc));
  };
  ydoc.on('update', handler);

  ws.on('message', (data) => {
    try {
      const arr = new Uint8Array(data);
      const decoder = decoding.createDecoder(arr);
      const msgType = decoding.readVarUint(decoder);

      if (msgType === 0) { // messageSync
        const syncType = decoding.readVarUint(decoder);
        if (syncType === 0) { // SyncStep1：客户端发来 state vector，回 SyncStep2(diff)
          const sv = decoding.readVarUint8Array(decoder);
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0);
          encoding.writeVarUint(enc, 1); // SyncStep2
          encoding.writeVarUint8Array(enc, Y.encodeStateAsUpdate(ydoc, sv));
          ws.send(encoding.toUint8Array(enc));
        } else if (syncType === 1 || syncType === 2) { // SyncStep2 / Update：应用更新
          const update = decoding.readVarUint8Array(decoder);
          Y.applyUpdate(ydoc, update, ws);
        }
      } else if (msgType === 1) { // messageAwareness
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === 1 && client._room === room) {
            client.send(arr);
          }
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    console.log(`[协同] 离开房间: ${room}`);
    ydoc.off('update', handler);
  });
});

// Yjs 文档持久化目录
const COLLAB_DATA_DIR = path.join(__dirname, 'data', 'collab');

// 启动时恢复已有文档
if (!existsSync(COLLAB_DATA_DIR)) mkdirSync(COLLAB_DATA_DIR, { recursive: true });
const savedFiles = readdirSync(COLLAB_DATA_DIR).filter(f => f.endsWith('.ydoc'));
for (const file of savedFiles) {
  try {
    const room = file.replace('.ydoc', '');
    const data = readFileSync(path.join(COLLAB_DATA_DIR, file));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, data);
    collabDocs.set(room, doc);
  } catch (e) { console.log(`[协同] 恢复 ${file} 失败:`, e.message); }
}
console.log(`[协同] 已恢复 ${collabDocs.size} 个房间`);

// 定期保存 + 清理（10分钟保存一次，1小时无连接清理）
setInterval(() => {
  for (const [name, doc] of collabDocs.entries()) {
    try {
      // 保存文档
      writeFileSync(path.join(COLLAB_DATA_DIR, name + '.ydoc'), Y.encodeStateAsUpdate(doc));
    } catch (e) {}
    // 清理（1小时无连接且12小时未访问）
    const idleThreshold = doc._lastAccess ? Date.now() - doc._lastAccess : Infinity;
    if (doc.store.clients.size === 0 && idleThreshold > 3600000) {
      try {
        writeFileSync(path.join(COLLAB_DATA_DIR, name + '.ydoc'), Y.encodeStateAsUpdate(doc));
      } catch (e) {}
      doc.destroy();
      collabDocs.delete(name);
    }
  }
}, 600000);

// 进程退出时保存
process.on('SIGINT', () => {
  for (const [name, doc] of collabDocs.entries()) {
    try { writeFileSync(path.join(COLLAB_DATA_DIR, name + '.ydoc'), Y.encodeStateAsUpdate(doc)); } catch {}
  }
  process.exit();
});

// ==================== 文件中转站 ====================
const FILESHARE_FILE = path.join(__dirname, 'data', 'fileshare.json');
const FILESHARE_DIR = path.join(os.tmpdir(), 'pixelkit-fileshare');
const FILESHARE_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const FILESHARE_EXPIRE_HOURS = 24;
await fs.mkdir(FILESHARE_DIR, { recursive: true });

// ==================== 二维码工具 ====================
const QR_RECORDS_FILE = path.join(__dirname, 'data', 'qr-records.json');
const QR_RECORDS_TTL = 24 * 60 * 60 * 1000; // 记录保存 24 小时

function loadQrRecords() {
  try {
    if (!existsSync(QR_RECORDS_FILE)) return [];
    return JSON.parse(readFileSync(QR_RECORDS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveQrRecords(records) {
  try { writeFileSync(QR_RECORDS_FILE, JSON.stringify(records, null, 2)); } catch {}
}

// 自动清理超过 24 小时的记录（同时清理过期文件的磁盘文件）
function cleanupQrRecords(records) {
  const cutoff = Date.now() - QR_RECORDS_TTL;
  const kept = records.filter(r => (r.createdAt || 0) > cutoff);
  const keptIds = new Set(kept.map(r => r.id));
  try {
    for (const r of records) {
      if (r.type === 'file' && !keptIds.has(r.id)) {
        try { unlinkSync(path.join(QR_FILES_DIR, r.id)); } catch {}
      }
    }
  } catch {}
  return kept;
}

// 二维码图片上传（内存存储，不落盘）
const qrUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ============ 文件二维码（活码）：文件落盘，二维码编码可访问链接 ============
const QR_FILES_DIR = path.join(__dirname, 'data', 'qr-files');
try { mkdirSync(QR_FILES_DIR, { recursive: true }); } catch {}

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { cb(null, QR_FILES_DIR); },
    filename: (req, file, cb) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ext = path.extname(file.originalname || '');
      cb(null, id + ext);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 生成可供手机扫码访问的基础地址
// 优先级：① 显式 PUBLIC_BASE_URL 环境变量（公网部署推荐）
//          ② 请求 Host 头（公网部署时即为公网域名，自动适配 http/https）
//          ③ 回退局域网 IP（本机开发时，同 WiFi 手机可访问）
function getQrBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const host = req && req.get ? req.get('host') : '';
  if (host) {
    const hostOnly = host.split(':')[0];
    const isLocal = /^(localhost|127\.|::1|0\.0\.0\.0)$/.test(hostOnly);
    if (!isLocal) {
      const proto = req.protocol === 'https' ? 'https' : 'http';
      return `${proto}://${host}`;
    }
  }
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return `http://${net.address}:${PORT}`;
        }
      }
    }
  } catch {}
  return `http://localhost:${PORT}`;
}

function escHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 二维码独立上传文件的定时回收：每 5 天扫一遍
// 删除「记录中已不存在 / 已超过 24h」的物理文件，并清掉孤立文件
function pruneQrFiles() {
  try {
    if (!existsSync(QR_FILES_DIR)) return;
    const records = loadQrRecords();
    const cutoff = Date.now() - QR_RECORDS_TTL;
    const valid = new Set(
      records
        .filter(r => r.type === 'file' && (r.createdAt || 0) > cutoff)
        .map(r => r.id)
    );
    const files = readdirSync(QR_FILES_DIR);
    let cleaned = 0;
    for (const f of files) {
      if (!valid.has(f)) {
        try { unlinkSync(path.join(QR_FILES_DIR, f)); cleaned++; } catch {}
      }
    }
    if (cleaned > 0) console.log(`[Prune] 清理过期二维码文件: ${cleaned} 个`);
  } catch (e) { console.warn('[Prune] qr-files 清理异常:', e.message); }
}

// 每 5 天执行一次
setInterval(pruneQrFiles, 5 * 24 * 3600 * 1000);
// 启动时先扫一遍
pruneQrFiles();

// 手机自适应的文件查看页
function renderQrFilePage(rec, fileUrl) {
  const isImage = (rec.mime || '').startsWith('image/');
  const sizeKB = rec.size ? (rec.size / 1024).toFixed(1) : '?';
  const preview = isImage
    ? `<img class="qr-file-preview" src="${escHtml(fileUrl)}" alt="预览" />`
    : `<div class="qr-file-icon">📄</div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${escHtml(rec.originalName || '文件')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#0f1220;color:#e8eaf2;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
  .card{background:#1a1f35;border-radius:16px;padding:28px 22px;width:100%;max-width:460px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  .qr-file-icon{font-size:84px;margin:10px 0}
  .qr-file-preview{max-width:100%;max-height:50vh;border-radius:12px;margin:12px 0}
  .name{font-size:18px;font-weight:600;word-break:break-all;margin:8px 0}
  .meta{color:#8b90a8;font-size:13px;margin-bottom:18px}
  .btn{display:inline-block;background:linear-gradient(135deg,#6c5ce7,#a55eea);color:#fff;border:none;border-radius:10px;padding:13px 20px;font-size:15px;text-decoration:none;margin:6px}
  .foot{margin-top:18px;color:#6b7090;font-size:12px}
</style></head>
<body><div class="card">
  ${preview}
  <div class="name">${escHtml(rec.originalName || '文件')}</div>
  <div class="meta">${escHtml(rec.mime || '未知类型')} · ${sizeKB} KB</div>
  <a class="btn" href="${escHtml(fileUrl)}?download=1">⬇ 下载文件</a>
  <div class="foot">由 PixelKit 二维码工具生成</div>
</div></body></html>`;
}

// 文件中转站扫码落地页（支持密码输入）
function renderFsPage(rec, fileId, downloadUrl) {
  const sizeKB = rec.size ? (rec.size / 1024).toFixed(1) : '?';
  const expireStr = rec.expireAt ? new Date(rec.expireAt).toLocaleString('zh-CN') : '未知';
  const isProtected = !!rec.password;
  const lockSection = isProtected ? `
  <div class="lock-icon">🔒</div>
  <p style="color:#8b90a8;font-size:14px;margin-bottom:8px;">此文件已加密，请输入下载密码</p>
  <input class="pwd-input" type="text" id="pwd" placeholder="输入下载密码" maxlength="32" autofocus />
  <div class="error" id="error"></div>
  <button class="btn" id="submit-btn" onclick="verify()">🔓 验证并下载</button>` : `
  <a class="btn" href="${escHtml(downloadUrl)}">⬇ 下载文件</a>`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${escHtml(rec.name || '文件')} - PixelKit 文件中转站</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#0f1220;color:#e8eaf2;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
  .card{background:#1a1f35;border-radius:16px;padding:28px 22px;width:100%;max-width:460px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  .icon{font-size:64px;margin:10px 0}
  .name{font-size:18px;font-weight:600;word-break:break-all;margin:8px 0}
  .meta{color:#8b90a8;font-size:13px;margin-bottom:18px}
  .lock-icon{font-size:40px;margin:10px 0}
  .pwd-input{width:100%;padding:12px 16px;border-radius:10px;border:1px solid #3a3f5c;background:#0f1220;color:#e8eaf2;font-size:15px;margin:12px 0;text-align:center;outline:none}
  .pwd-input:focus{border-color:#6c5ce7}
  .btn{display:inline-block;background:linear-gradient(135deg,#6c5ce7,#a55eea);color:#fff;border:none;border-radius:10px;padding:13px 28px;font-size:15px;text-decoration:none;margin:6px;cursor:pointer}
  .btn:disabled{opacity:0.6;cursor:not-allowed}
  .error{color:#ff6b6b;font-size:13px;margin-top:8px;display:none}
  .foot{margin-top:18px;color:#6b7090;font-size:12px}
</style></head>
<body><div class="card">
  <div class="icon">📁</div>
  <div class="name">${escHtml(rec.name || '文件')}</div>
  <div class="meta">${sizeKB} KB${rec.type ? ' · ' + escHtml(rec.type) : ''}</div>
  ${lockSection}
  <div class="foot">有效期至 ${expireStr} · 由 PixelKit 文件中转站生成</div>
</div>
${isProtected ? `<script>
async function verify() {
  var pwd = document.getElementById("pwd").value.trim();
  if (!pwd) { showError("请输入密码"); return; }
  var btn = document.getElementById("submit-btn");
  btn.disabled = true; btn.textContent = "验证中...";
  try {
    var r = await fetch("/api/fileshare/check-pwd/${escHtml(fileId)}", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({password: pwd})
    });
    if (r.ok) {
      window.location.href = "${escHtml(downloadUrl)}?pwd=" + encodeURIComponent(pwd);
    } else {
      var e = await r.json();
      showError(e.error || "密码错误");
      btn.disabled = false; btn.textContent = "验证并下载";
    }
  } catch(err) { showError("网络错误"); btn.disabled = false; btn.textContent = "验证并下载"; }
}
function showError(msg) {
  document.getElementById("error").textContent = msg;
  document.getElementById("error").style.display = "";
}
document.getElementById("pwd").addEventListener("keydown", function(e) {
  if (e.key === "Enter") verify();
});
</script>` : ''}
</body></html>`;

  return html;
}

// 文件中转站扫码落地页
app.get('/fs/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    if (/[\/\\]/.test(id)) return res.status(404).send('文件不存在或已过期');
    const data = getFileShareData();
    const rec = data.find(f => f.id === id);
    if (!rec) return res.status(404).send('文件不存在或已过期');
    if (new Date(rec.expireAt).getTime() <= Date.now()) {
      return res.status(410).send('文件已过期');
    }
    const downloadUrl = '/api/fileshare/download/' + encodeURIComponent(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderFsPage(rec, id, downloadUrl));
  } catch (e) {
    res.status(500).send('出错了：' + e.message);
  }
});


function getFileShareData() {
  try {
    if (!existsSync(FILESHARE_FILE)) return [];
    return JSON.parse(readFileSync(FILESHARE_FILE, 'utf-8'));
  } catch { return []; }
}

function saveFileShareData(data) {
  const dir = path.dirname(FILESHARE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILESHARE_FILE, JSON.stringify(data, null, 2));
}

/** 清理过期文件 */
function cleanExpiredFiles() {
  const data = getFileShareData();
  const now = Date.now();
  const valid = [];
  let cleaned = 0;
  for (const f of data) {
    if (new Date(f.expireAt).getTime() <= now) {
      // 物理删除
      const fileDir = path.join(FILESHARE_DIR, f.id);
      try { rmSync(fileDir, { recursive: true, force: true }); } catch {}
      cleaned++;
    } else {
      valid.push(f);
    }
  }
  if (cleaned > 0) saveFileShareData(valid);
  return valid;
}

// 文件列表（含过期清理）
/* 2026-10-08 审计：原来不区分用户，返回服务器上所有人的文件（还带 ownerId），
   而 ownerId 又能直接用来删别人的文件 → 等于文件与删除权限全公开。
   现在：必须带 userId，只返回自己的文件，且**不再对外暴露 ownerId**。 */
app.get('/api/fileshare/list', (req, res) => {
  try {
    const userId = String(req.query.userId || req.headers['x-pk-user'] || '').trim();
    if (!userId) return res.status(401).json({ error: '缺少设备标识，请刷新页面后重试' });
    const data = cleanExpiredFiles();
    const mine = data.filter(f => (f.ownerId || '') === userId);
    // 不返回密码字段，也不返回别人的 ownerId
    const safe = mine.map(f => ({
      id: f.id, name: f.name, size: f.size, type: f.type,
      hasPassword: !!f.password,
      time: f.time, expireAt: f.expireAt, downloads: f.downloads || 0,
    }));
    safe.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 上传
const fileshareUpload = multer({
  dest: path.join(os.tmpdir(), 'pixelkit-fileshare-tmp'),
  limits: { fileSize: FILESHARE_MAX_SIZE },
});

app.post('/api/fileshare/upload', fileshareUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    // 修复中文文件名：浏览器发来 UTF-8 字节，multer 按 Latin-1 解析导致乱码
    req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const id = uuidv4();
    const password = req.body.password?.trim() || null;
    const ownerId = req.body.ownerId?.trim() || '';

    // 移动文件到目标目录
    const fileDir = path.join(FILESHARE_DIR, id);
    await fs.mkdir(fileDir, { recursive: true });
    const destPath = path.join(fileDir, req.file.originalname);
    await fs.rename(req.file.path, destPath);

    const now = new Date();
    const expireAt = new Date(now.getTime() + FILESHARE_EXPIRE_HOURS * 3600000);

    const record = {
      id,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      password,
      ownerId,
      time: now.toISOString(),
      expireAt: expireAt.toISOString(),
      downloads: 0,
    };

    const data = getFileShareData();
    data.push(record);
    saveFileShareData(data);

    res.json({ success: true, id, expireAt: record.expireAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 下载（密码通过 query 参数传递，支持直接链接下载）
app.get('/api/fileshare/download/:id', (req, res) => {
  try {
    const data = getFileShareData();
    const record = data.find(f => f.id === req.params.id);
    if (!record) return res.status(404).json({ error: '文件不存在或已过期' });

    // 检查过期
    if (new Date(record.expireAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: '文件已过期' });
    }

    // 加密文件验证密码
    if (record.password) {
      const inputPwd = (req.query.pwd || '').trim();
      if (inputPwd !== record.password) {
        return res.status(403).json({ error: '密码错误' });
      }
    }

    const filePath = path.join(FILESHARE_DIR, record.id, record.name);
    if (!existsSync(filePath)) return res.status(404).json({ error: '文件丢失' });

    // 增加下载计数（跳过 Range 分段请求，手机弱网下会多次分段下载导致虚增）
    if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
      record.downloads = (record.downloads || 0) + 1;
      saveFileShareData(data);
    }

    res.download(filePath, record.name);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 验证密码（仅校验，不下载）
app.post('/api/fileshare/check-pwd/:id', (req, res) => {
  try {
    const data = getFileShareData();
    const record = data.find(f => f.id === req.params.id);
    if (!record) return res.status(404).json({ error: '文件不存在' });
    if (!record.password) return res.json({ success: true });
    const inputPwd = req.body.password?.trim() || '';
    if (inputPwd !== record.password) return res.status(403).json({ error: '密码错误' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除文件（只有上传者本人能删）
app.delete('/api/fileshare/:id', (req, res) => {
  try {
    const data = getFileShareData();
    const idx = data.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '文件不存在' });

    // 必须带设备标识；ownerId 参数保留兼容，但必须与记录一致
    const userId = String(req.query.userId || req.query.ownerId || req.headers['x-pk-user'] || '').trim();
    if (!userId) return res.status(401).json({ error: '缺少设备标识，请刷新页面后重试' });
    const recordOwner = String(data[idx].ownerId || '').trim();
    // 旧的无主文件不再允许任何人删（宁可留着，也不给越权口子）
    if (!recordOwner || recordOwner !== userId) {
      return res.status(403).json({ error: '无权删除此文件（只有上传者本人可以删）' });
    }

    // 物理删除
    const fileDir = path.join(FILESHARE_DIR, data[idx].id);
    try { rmSync(fileDir, { recursive: true, force: true }); } catch {}

    data.splice(idx, 1);
    saveFileShareData(data);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 二维码工具 ====================

// 生成二维码：文本/数字 → PNG (base64 dataURL)
app.post('/api/qr/generate', async (req, res) => {
  try {
    const { text, size = 256, dark = '#000000', light = '#ffffff' } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 2000) {
      return res.status(400).json({ success: false, error: '文本为空或过长（上限2000字符）' });
    }
    const dataUrl = await QRCode.toDataURL(text, {
      width: Math.min(Math.max(parseInt(size) || 256, 64), 1024),
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark, light }
    });
    res.json({ success: true, dataUrl, text });
  } catch (e) {
    res.status(500).json({ success: false, error: '生成失败：' + e.message });
  }
});

// 解码二维码：上传图片 → 文本
app.post('/api/qr/decode', qrUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传包含二维码的图片' });
    // sharp 解码图片为 raw RGBA 像素数据
    const { data, info } = await sharp(req.file.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (!code || !code.data) {
      return res.status(404).json({ success: false, error: '未检测到二维码，请换张清晰、完整的图片' });
    }
    res.json({ success: true, text: code.data });
  } catch (e) {
    res.status(500).json({ success: false, error: '解码失败：' + e.message });
  }
});

// 获取历史记录（自动清理 >24h）
app.get('/api/qr/records', (req, res) => {
  let records = loadQrRecords();
  const before = records.length;
  records = cleanupQrRecords(records);
  if (records.length !== before) saveQrRecords(records); // 有清理则回写
  // 按用户隔离：只返回「当前用户」自己生成的记录，看不到别人的
  const userId = req.query.userId;
  const visible = userId ? records.filter(r => r.userId === userId) : [];
  res.json({ success: true, records: visible });
});

// 保存一条记录
app.post('/api/qr/records', (req, res) => {
  try {
    const { text, type, dataUrl, userId } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: '记录为空' });
    }
    const records = loadQrRecords();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: text.slice(0, 2000),
      type: type === 'decode' ? 'decode' : 'generate',
      userId: userId || '',          // 记录归属：谁生成就绑谁
      // 仅接受合法的 data:image base64，限长防止 JSON 过大
      dataUrl: (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') && dataUrl.length < 50000)
        ? dataUrl : '',
      createdAt: Date.now()
    };
    records.unshift(record);
    if (records.length > 100) records.length = 100; // 最多保留 100 条
    saveQrRecords(records);
    res.json({ success: true, record });
  } catch (e) {
    res.status(500).json({ success: false, error: '保存失败：' + e.message });
  }
});

// 删除单条记录（若为文件类型，同时删除磁盘文件）
app.delete('/api/qr/records/:id', (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.query.userId;
    let records = loadQrRecords();
    const rec = records.find(r => r.id === id);
    // 归属校验：记录有 userId 且不是本人的，拒绝删除（防删别人）
    if (rec && rec.userId && rec.userId !== requester) {
      return res.status(403).json({ success: false, error: '无权删除他人的记录' });
    }
    if (rec && rec.type === 'file') {
      try { unlinkSync(path.join(QR_FILES_DIR, id)); } catch {}
    }
    const before = records.length;
    records = records.filter(r => r.id !== id);
    if (records.length !== before) saveQrRecords(records);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 上传文件并生成「文件活码」（二维码编码可访问链接）
app.post('/api/qr/file', fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择要生成的文件' });
    const id = req.file.filename;
    /* 2026-10-08 审计：原来生成的是 `${base}/qr/<id>`，但 nginx 没配 /qr/ 路由
       → 落到 SPA 兜底，扫码只能打开首页（返回的是 76907 字节的 index.html）。
       现在改用 /api/qr/file/<id>（nginx 已把 /api/ 反代给本服务），无需改 nginx。 */
    const shareUrl = `${getQrBaseUrl(req)}/api/qr/file/${encodeURIComponent(id)}`;
    const records = loadQrRecords();
    const record = {
      id,
      type: 'file',
      text: req.file.originalName || '文件',
      originalName: req.file.originalName || '文件',
      mime: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      url: shareUrl,
      createdAt: Date.now()
    };
    records.unshift(record);
    if (records.length > 100) records.length = 100;
    saveQrRecords(records);
    res.json({ success: true, id, url: shareUrl, record });
  } catch (e) {
    res.status(500).json({ success: false, error: '上传失败：' + e.message });
  }
});

// 文件查看页（手机自适应）—— 同一套逻辑挂两个入口：老路径 /qr/:id 与新路径 /api/qr/file/:id
function serveQrFilePage(req, res) {
  try {
    const id = decodeURIComponent(req.params.id);
    if (/[\/\\]/.test(id)) return res.status(404).send('文件不存在或已过期');
    const filePath = path.join(QR_FILES_DIR, id);
    if (!existsSync(filePath)) return res.status(404).send('文件不存在或已过期');
    const records = loadQrRecords();
    const rec = records.find(r => r.id === id) || {};
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderQrFilePage(rec, `/api/qr/file/${encodeURIComponent(id)}/raw`));
  } catch (e) {
    res.status(500).send('出错了：' + e.message);
  }
}
app.get('/qr/:id', serveQrFilePage);
app.get('/api/qr/file/:id', serveQrFilePage);

// 文件原始数据（支持下载）
function serveQrFileRaw(req, res) {
  try {
    const id = decodeURIComponent(req.params.id);
    if (/[\/\\]/.test(id)) return res.status(404).send('文件不存在或已过期');
    const filePath = path.join(QR_FILES_DIR, id);
    if (!existsSync(filePath)) return res.status(404).send('文件不存在或已过期');
    const records = loadQrRecords();
    const rec = records.find(r => r.id === id) || {};
    res.setHeader('Content-Type', rec.mime || 'application/octet-stream');
    const asDownload = req.query.download === '1' || req.query.download === '' || !rec.mime || !rec.mime.startsWith('image/');
    if (asDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rec.originalName || 'file')}"`);
    }
    createReadStream(filePath).pipe(res);
  } catch (e) {
    res.status(500).send('出错了：' + e.message);
  }
}
app.get('/qr/:id/raw', serveQrFileRaw);
app.get('/api/qr/file/:id/raw', serveQrFileRaw);

// 由「文件上传」已存在的文件生成二维码（不重复存文件，复用 fileshare 下载链接）
app.post('/api/qr/from-fileshare', async (req, res) => {
  try {
    const { fileshareId, userId } = req.body || {};
    if (!fileshareId) return res.status(400).json({ success: false, error: '缺少文件ID' });
    const data = getFileShareData();
    const rec = data.find(f => f.id === fileshareId);
    if (!rec) return res.status(404).json({ success: false, error: '文件不存在或已过期' });
    if (new Date(rec.expireAt).getTime() <= Date.now()) {
      return res.status(410).json({ success: false, error: '文件已过期' });
    }
    // 二维码编码 fileshare 下载链接（密码不写进二维码，扫码后页面会提示输入）
    const url = `${getQrBaseUrl(req)}/fs/${encodeURIComponent(fileshareId)}`;
    const records = loadQrRecords();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'fileshare',
      userId: userId || '',          // 分享码同样归属当前用户
      text: rec.name || '文件',
      originalName: rec.name || '文件',
      url,
      fileId: fileshareId,
      createdAt: Date.now()
    };
    records.unshift(record);
    if (records.length > 100) records.length = 100;
    saveQrRecords(records);
    res.json({ success: true, url, record });
  } catch (e) {
    res.status(500).json({ success: false, error: '生成失败：' + e.message });
  }
});

// ==================== 大模型人机对战 ====================
// [已注销] 本次更新暂不带步步为营功能
if (false) {
// 前端把棋盘状态 POST 到这里，服务端调用大模型选一步棋；
// 引擎强校验合法性，非法着法会带提示重试一次，仍失败/异常则回退到首个合法着法。
// 这样大模型当"决策大脑"，引擎当"裁判"，对局永远不会因非法动作卡死。

const QUORIDOR_LLM_RULES = `
你是《步步为营》(Quoridor) 棋手，执蓝方（玩家 P1）。
棋盘 9×9 格子，坐标 (col,row)，col、row 均为 0~8。
【方向】col 从左到右增大；row 从上到下增大（row 越大越靠底部）。
【你的目标】尽快把棋子走到 row=8（棋盘底部）的任意一格即胜利；对方 P0（红方）目标为 row=0（顶部）。
【走棋思路】你从 row=0 出发，正常情况下每步应优先选择 row 更大的格子（向下推进，接近 row=8）；
左右横移（col 变化而 row 不变）不会让你接近目标，只有被挡板或对方棋子挡住时才绕行。
【放墙思路】不要只顾走棋：当红方距离 row=0（顶部）很近时，应放置挡板阻挡它，让它绕远路。
横墙 'h' 在 col 与 col+1 两列之间的某段挡上下，竖墙 'v' 在 row 与 row+1 两行之间的某段挡左右。
放墙前想清楚：这块墙是否会让红方绕远路？是否没有封死任何一方通往目标的通路？
每回合只能做一个动作，二选一：
1. 移动棋子一步：上下左右相邻格；若紧邻对方棋子且其后方空格可走，可跳越；
2. 放置一块挡板：横墙 'h' / 竖墙 'v'，坐标 col、row ∈ 0~7。
   挡板不能与已有挡板重叠或交叉，且不能完全封死任何一方通往目标的通路。
只输出一个 JSON，不要任何解释或多余文字，格式二选一：
{"type":"move","col":<整数>,"row":<整数>}
{"type":"fence","col":<整数>,"row":<整数>,"dir":"h"或"v"}
`;

/** 将棋盘状态序列化为大模型易读的文本（含逐行棋盘图与引擎放墙建议） */
function serializeQuoridorBoard(room, bestBlock = null, oppBase = -1) {
  const p0 = room.players[0], p1 = room.players[1];
  const gridRows = [];
  for (let r = 0; r < BOARD; r++) {
    const cells = [];
    for (let c = 0; c < BOARD; c++) {
      if (p0.col === c && p0.row === r) cells.push('R');
      else if (p1.col === c && p1.row === r) cells.push('B');
      else cells.push('.');
    }
    gridRows.push(`row${r}: ${cells.join(' ')}`);
  }
  const fences = room.fences.map(f => `${f.dir === 'h' ? '横墙' : '竖墙'}(${f.col},${f.row})`);
  const lines = [
    `当前回合: 蓝方 P1（你）`,
    `P0(红): (${p0.col},${p0.row}) 目标row=0 剩墙${p0.fences}`,
    `P1(蓝): (${p1.col},${p1.row}) 目标row=8 剩墙${p1.fences}`,
    `棋盘（R=红方棋子 B=你的棋子 .=空格，row 越大越靠底部）:`,
    ...gridRows,
    `已放置挡板: ${fences.length ? fences.join(' ') : '无'}`,
    `请向下（增大 row）接近 row=8；左右横移不会接近目标。`,
  ];
  if (bestBlock && oppBase >= 0) {
    lines.push(`建议：红方距其目标仅 ${oppBase} 步，可用挡板阻挡它。引擎推荐的挡板位置：fence(${bestBlock.col},${bestBlock.row},${bestBlock.dir})。`);
  }
  return lines.join('\n');
}

/**
 * 取模型回复正文：优先 content，为空时回退 reasoning（推理型模型会把最终 JSON 放在 reasoning 里）。
 */
function llmReplyText(msg) {
  const content = msg?.content;
  if (content && String(content).trim()) return String(content);
  return String(msg?.reasoning || '');
}

/** 从大模型回复中解析严格 JSON 动作 */
function parseQuoridorMove(text) {
  const fragments = String(text || '').match(/\{[^}]*\}/g) || [];
  for (const frag of fragments) {
    try {
      const obj = JSON.parse(frag);
      if (obj.type === 'move' && Number.isInteger(obj.col) && Number.isInteger(obj.row)) {
        return { type: 'move', col: obj.col, row: obj.row };
      }
      if (obj.type === 'fence' && Number.isInteger(obj.col) && Number.isInteger(obj.row) &&
          (obj.dir === 'h' || obj.dir === 'v')) {
        return { type: 'fence', col: obj.col, row: obj.row, dir: obj.dir };
      }
    } catch (_) { /* 忽略非 JSON 片段 */ }
  }
  return null;
}

/** 校验动作是否合法（复用服务端权威规则） */
function isLegalQuoridorAction(room, action) {
  if (!action) return false;
  if (action.type === 'move') {
    return gameGetValidMoves(room, room.currentTurn)
      .some(m => m.col === action.col && m.row === action.row);
  }
  return gameCanPlaceFence(room, action.col, action.row, action.dir);
}

/**
 * 智能兜底着法（大模型失效/非法时使用，保证对局不断）：
 * 优先选择能最大缩短自己到目标距离的走法（推进优先，避免无脑横移）；
 * 无走法时尝试放置一块合法挡板。
 */
function firstLegalQuoridorAction(room) {
  const pi = room.currentTurn;
  const p = room.players[pi];
  if (!p) return null;

  const moves = gameGetValidMoves(room, pi);
  const myBase = gameShortestPath(room, pi, p.col, p.row);
  if (moves.length) {
    let best = moves[0];
    let bestDelta = -Infinity;
    for (const m of moves) {
      const d = gameShortestPath(room, pi, m.col, m.row);
      const delta = (myBase === -1 || d === -1) ? -Infinity : (myBase - d);
      if (delta > bestDelta) {
        bestDelta = delta;
        best = m;
      }
    }
    return { type: 'move', col: best.col, row: best.row };
  }

  if (p.fences > 0) {
    for (let c = 0; c < BOARD - 1; c++) {
      for (let r = 0; r < BOARD - 1; r++) {
        if (gameCanPlaceFence(room, c, r, 'h')) return { type: 'fence', col: c, row: r, dir: 'h' };
      }
    }
  }
  return null;
}

/**
 * 引擎推荐的最佳阻挡挡板：在合法挡板中，选择"对手路径增量最大、自己路径代价最小"的。
 * 大模型无法可靠计算挡板路径效果，这里用 BFS 替它把关；无有效挡板返回 null。
 */
function findBestBlockingFence(room, pi, other, myBase, oppBase) {
  const me = room.players[pi], opp = room.players[other];
  if (!me || !opp || me.fences <= 0 || oppBase === -1 || oppBase <= 0) return null;

  let best = null;
  let bestScore = 0;
  for (let c = 0; c < BOARD - 1; c++) {
    for (let r = 0; r < BOARD - 1; r++) {
      for (const dir of ['h', 'v']) {
        if (!gameCanPlaceFence(room, c, r, dir)) continue;
        const f = { col: c, row: r, dir };
        const oppNew = gameShortestPath(room, other, opp.col, opp.row, f);
        if (oppNew === -1) continue; // 不能封死对手
        const myNew = gameShortestPath(room, pi, me.col, me.row, f);
        if (myNew === -1) continue;  // 不能堵死自己
        const score = (oppNew - oppBase) * 2 - (myNew - myBase);
        if (score > bestScore) {
          bestScore = score;
          best = f;
        }
      }
    }
  }
  return best;
}

/** 生成少量合法动作提示（供非法着法后的纠错重试） */
function legalActionHints(room) {
  const hints = gameGetValidMoves(room, room.currentTurn).map(m => `move(${m.col},${m.row})`);
  outer:
  for (let c = 0; c < 8 && hints.length < 24; c++) {
    for (let r = 0; r < 8; r++) {
      if (gameCanPlaceFence(room, c, r, 'h')) hints.push(`fence(${c},${r},h)`);
      if (hints.length >= 24) break outer;
      if (gameCanPlaceFence(room, c, r, 'v')) hints.push(`fence(${c},${r},v)`);
      if (hints.length >= 24) break outer;
    }
  }
  return '合法动作示例（可任选其一，也可思考后输出其它合法动作）: ' + hints.join(' ');
}

/** 渲染棋盘为 SVG（与服务端权威状态一致，供视觉模型观察） */
function renderQuoridorBoardSVG(room) {
  const CELL = 60, PAD = 24;
  const SIZE = BOARD * CELL + PAD * 2;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`];
  parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="#1a1a2e"/>`);
  parts.push(`<rect x="${PAD}" y="${PAD}" width="${BOARD * CELL}" height="${BOARD * CELL}" fill="#2d2d44"/>`);
  // 双方目标区淡色
  parts.push(`<rect x="${PAD}" y="${PAD}" width="${BOARD * CELL}" height="${CELL}" fill="#ef4444" opacity="0.14"/>`);
  parts.push(`<rect x="${PAD}" y="${PAD + 8 * CELL}" width="${BOARD * CELL}" height="${CELL}" fill="#ef4444" opacity="0.14"/>`);
  parts.push(`<rect x="${PAD}" y="${PAD}" width="${BOARD * CELL}" height="${CELL}" fill="#3b82f6" opacity="0.14"/>`);
  parts.push(`<rect x="${PAD}" y="${PAD + 8 * CELL}" width="${BOARD * CELL}" height="${CELL}" fill="#3b82f6" opacity="0.14"/>`);
  // 网格
  for (let i = 0; i <= BOARD; i++) {
    const p = PAD + i * CELL;
    parts.push(`<line x1="${PAD}" y1="${p}" x2="${PAD + BOARD * CELL}" y2="${p}" stroke="#4b4b5e" stroke-width="1.5"/>`);
    parts.push(`<line x1="${p}" y1="${PAD}" x2="${p}" y2="${PAD + BOARD * CELL}" stroke="#4b4b5e" stroke-width="1.5"/>`);
  }
  // 挡板（按玩家颜色）
  for (const f of room.fences) {
    const owner = f.playerIndex != null ? room.players[f.playerIndex] : null;
    const color = owner ? owner.color : '#e5e7eb';
    if (f.dir === 'h') {
      parts.push(`<rect x="${PAD + f.col * CELL}" y="${PAD + (f.row + 1) * CELL - 5}" width="${CELL * 2}" height="10" rx="4" fill="${color}"/>`);
    } else {
      parts.push(`<rect x="${PAD + (f.col + 1) * CELL - 5}" y="${PAD + f.row * CELL}" width="10" height="${CELL * 2}" rx="4" fill="${color}"/>`);
    }
  }
  // 棋子
  for (const p of room.players) {
    if (!p) continue;
    const cx = PAD + p.col * CELL + CELL / 2, cy = PAD + p.row * CELL + CELL / 2;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="20" fill="${p.color}" stroke="#ffffff" stroke-width="3"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** SVG → PNG base64 dataURL（sharp 渲染） */
async function svgBoardToPngDataUrl(room) {
  const png = await sharp(Buffer.from(renderQuoridorBoardSVG(room))).png().toBuffer();
  return 'data:image/png;base64,' + png.toString('base64');
}

/** 视觉版出招：观察棋盘图片选一步棋；失败/非法返回 null（由上层回退文本路径） */
async function requestQuoridorMoveVision(room) {
  const apiKey = getNextKey('main');
  const { baseUrl, visionModel } = agentConfig;
  if (!apiKey || !baseUrl) return null;

  const image = await svgBoardToPngDataUrl(room);
  const board = serializeQuoridorBoard(room);
  for (let attempt = 0; attempt < 2; attempt++) {
    const hint = attempt === 1 ? '\n\n【上一步不合法】请重新选择。\n' + legalActionHints(room) : '';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: visionModel, temperature: 0.2, max_tokens: 256, reasoning_effort: 'none',
          messages: [
            { role: 'system', content: '你是一名步步为营(Quoridor)棋手，执蓝方。观察棋盘图片并参考规则，输出一步棋。只输出 JSON，不输出任何其它文字。' },
            {
              role: 'user',
              content: [
                { type: 'text', text: QUORIDOR_LLM_RULES + '\n\n' + board + hint },
                { type: 'image_url', image_url: { url: image } },
              ],
            },
          ],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
      const data = await resp.json();
      const text = llmReplyText(data.choices?.[0]?.message);
      const candidate = parseQuoridorMove(text);
      if (candidate && isLegalQuoridorAction(room, candidate)) return candidate;
    } catch (e) {
      console.error('[Quoridor-Vision] 调用失败:', e.message);
    }
  }
  return null;
}

/**
 * 请求大模型为当前回合玩家选一步棋。
 * 优先视觉出招（模型能"看"棋盘），失败回退文本出招；
 * action 一定合法（再失败回退首个合法着法），并叠加引擎放墙策略。
 * 供 /api/agent/quoridor-move 接口与房间内 AI 玩家(bot)共用。
 */
async function requestQuoridorMove(room) {
  const apiKey = getNextKey('main');
  const { baseUrl, quoridorModel } = agentConfig;
  if (!apiKey || !baseUrl) return { action: firstLegalQuoridorAction(room), source: 'fallback' };

  const pi = room.currentTurn;
  const other = pi === 0 ? 1 : 0;
  const me = room.players[pi], opp = room.players[other];
  const myBase = gameShortestPath(room, pi, me.col, me.row);
  const oppBase = gameShortestPath(room, other, opp.col, opp.row);
  const bestBlock = findBestBlockingFence(room, pi, other, myBase, oppBase);

  const board = serializeQuoridorBoard(room, bestBlock, oppBase);
  let action = null;
  let source = 'llm';

  // 1) 视觉出招
  try {
    action = await requestQuoridorMoveVision(room);
  } catch (e) {
    console.error('[Quoridor-LLM] 视觉出招异常，回退文本:', e.message);
    action = null;
  }

  // 2) 文本出招（视觉不可用/非法时）
  if (!action) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let content = QUORIDOR_LLM_RULES + '\n\n' + board;
      if (attempt === 1) content += '\n\n【上一步不合法】请重新选择。\n' + legalActionHints(room);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: quoridorModel, temperature: 0.2, max_tokens: 256, reasoning_effort: 'none',
            messages: [
              { role: 'system', content: '你只输出合法的 JSON 动作，不输出任何其它文字。' },
              { role: 'user', content },
            ],
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
        const data = await resp.json();
        const text = llmReplyText(data.choices?.[0]?.message);
        const candidate = parseQuoridorMove(text);
        if (candidate && isLegalQuoridorAction(room, candidate)) {
          action = candidate;
          break;
        }
      } catch (e) {
        console.error('[Quoridor-LLM] 调用失败:', e.message);
      }
    }
  }

  if (!action) {
    action = firstLegalQuoridorAction(room);
    source = 'fallback';
  } else if (action.type === 'move' && bestBlock && myBase > 1 && oppBase <= 4) {
    // 引擎策略层：大模型没放墙、而对手已迫近终点且我方可顺利推进 → 强制补上最佳阻挡挡板
    action = { type: 'fence', col: bestBlock.col, row: bestBlock.row, dir: bestBlock.dir };
  }
  return { action, source };
}

// 大模型选一步棋（本地「大模型对战」模式使用）
app.post('/api/agent/quoridor-move', async (req, res) => {
  try {
    const state = req.body?.state;
    if (!state || !Array.isArray(state.players) || state.players.length < 2) {
      return res.status(400).json({ error: '缺少棋盘状态' });
    }
    // 组装成服务端权威函数可用的房间结构
    const room = {
      players: state.players,
      fences: Array.isArray(state.fences) ? state.fences : [],
      currentTurn: state.currentTurn || 0,
      winner: null,
      draw: false,
    };
    // 仅支持 2 人局且轮到 P1（蓝方）时由大模型出招
    if (room.players.length !== 2 || room.currentTurn !== 1 || room.players[1]?.eliminated) {
      return res.json({ move: firstLegalQuoridorAction(room), source: 'fallback' });
    }
    const { action, source } = await requestQuoridorMove(room);
    res.json({ move: action, source });
  } catch (e) {
    console.error('[Quoridor-LLM] 接口错误:', e.message);
    res.status(500).json({ error: e.message });
  }
});
} // [已注销] 大模型人机对战 if(false) 结束

// ==================== 生产静态托管（构建产物） ====================
// 若存在 dist/（npm run build 产物），由本服务直接托管前端。
// 这样生产环境只对外暴露构建后的文件，不暴露任何源码；
// 也避免在服务器上误跑 `npm run dev`（Vite 开发服务器会把源码按 URL 吐出去）。
// ==================== 世界电台（目录代理 + 音频中转）2026-10-19 ====================
/* 为什么由服务器中转：
   ① 电台目录（Radio Browser）在部分网络下直连不通、且有 IPv6 解析抖动 → 服务器走 IPv4 稳定；
   ② 各电台的音频流地址五花八门，用户网络未必能直连 → 用本站服务器中转，保证站内能听；
   ③ 不复制、不代理第三方站点（如 RoamDial）的界面与代码，只使用开放的电台数据库与公网音频流。 */
// 多个镜像轮着试：单一镜像偶尔会不可达（实测 de1 会偶发失败），失败就换下一个
const RADIO_API_BASES = (process.env.RADIO_API_BASE
  ? [process.env.RADIO_API_BASE]
  : ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://all.api.radio-browser.info'])
  .map((u) => u.replace(/\/$/, ''));
let radioApiBase = RADIO_API_BASES[0];
const radioCache = new Map();
const radioAllowedHosts = new Set();      // 音频中转白名单：只允许目录里真实出现过的电台主机（防 SSRF）
function radioRemember(url) {
  try { radioAllowedHosts.add(new URL(url).host.toLowerCase()); } catch { /* ignore */ }
}
function radioEvict() {
  if (radioCache.size <= 200) return;
  const oldest = [...radioCache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 50);
  for (const [k] of oldest) radioCache.delete(k);
}
async function radioFetch(path, ttlMs = 10 * 60 * 1000, timeoutMs = 8000) {
  const hit = radioCache.get(path);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  const ordered = [radioApiBase, ...RADIO_API_BASES.filter((b) => b !== radioApiBase)];
  let lastErr = null;
  for (const base of ordered) {
    try {
      const r = await fetch(base + path, {
        headers: { 'User-Agent': 'PixelKit-Radio/1.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error('目录源 HTTP ' + r.status);
      const data = await r.json();
      radioApiBase = base;                       // 记住可用的镜像
      radioCache.set(path, { t: Date.now(), data });
      radioEvict();
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('所有电台目录镜像都不可用');
}
const radioStationOut = (s) => ({
  id: s.stationuuid, name: s.name, country: s.country || '', state: s.state || '',
  tags: String(s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4),
  bitrate: s.bitrate || 0, codec: s.codec || '', favicon: s.favicon || '',
  homepage: s.homepage || '', url: s.url_resolved || s.url || '',
});

/* 地球视图数据：静态数据集（public/radio-geo.json，离线生成：带经纬度的热门电台，
   120 个国家 / 2400 个电台）。接口直接读文件，秒开且不依赖上游可用性。 */
const RADIO_GEO_FILE = path.join(__dirname, 'public', 'radio-geo.json');
let radioGeoData = null;
function loadRadioGeo() {
  if (radioGeoData) return radioGeoData;
  try {
    const list = JSON.parse(readFileSync(RADIO_GEO_FILE, 'utf-8'));
    radioGeoData = Array.isArray(list) ? list : [];
    // 启动时把这些电台主机加入音频中转白名单
    for (const s of radioGeoData) radioRemember(s.url);
    console.log(`[radio] geo 静态数据集：${radioGeoData.length} 个电台`);
  } catch (e) { radioGeoData = []; console.warn('[radio] geo 数据集读取失败:', e.message); }
  return radioGeoData;
}

app.get('/api/radio/geo', (req, res) => {
  const stations = loadRadioGeo();
  res.json({ success: true, stations, total: stations.length });
});
app.get('/api/radio/countries', async (req, res) => {
  try {
    const list = await radioFetch('/json/countries', 6 * 3600 * 1000);
    const countries = (Array.isArray(list) ? list : [])
      .filter((c) => (c.stationcount || 0) > 0)
      .sort((a, b) => (b.stationcount || 0) - (a.stationcount || 0))
      .map((c) => ({ name: c.name, code: c.iso_3166_1 || '', stations: c.stationcount || 0 }));
    res.json({ success: true, countries });
  } catch (e) { res.status(503).json({ success: false, error: '电台目录暂时不可用' }); }
});

app.get('/api/radio/tags', async (req, res) => {
  try {
    const list = await radioFetch('/json/tags?limit=60&order=stationcount&reverse=true&hidebroken=true', 6 * 3600 * 1000);
    const tags = (Array.isArray(list) ? list : []).map((t) => ({ name: t.name, stations: t.stationcount || 0 })).filter((t) => t.name);
    res.json({ success: true, tags });
  } catch (e) { res.status(503).json({ success: false, error: '电台目录暂时不可用' }); }
});

app.get('/api/radio/stations', async (req, res) => {
  try {
    const { country = '', tag = '', limit = '40', offset = '0' } = req.query;
    const q = new URLSearchParams({ limit: String(Math.min(Number(limit) || 40, 100)), offset: String(Math.max(Number(offset) || 0, 0)), hidebroken: 'true', order: 'clickcount', reverse: 'true' });
    if (country) q.set('country', country);
    if (tag) q.set('tag', tag);
    const list = await radioFetch('/json/stations/search?' + q.toString());
    const stations = (Array.isArray(list) ? list : []).map(radioStationOut).filter((s) => s.url);
    stations.forEach((s) => radioRemember(s.url));
    res.json({ success: true, stations });
  } catch (e) { res.status(503).json({ success: false, error: '电台目录暂时不可用' }); }
});

app.get('/api/radio/random', async (req, res) => {
  try {
    const { country = '', tag = '' } = req.query;
    const q = new URLSearchParams({ limit: '1', hidebroken: 'true', order: 'random' });
    if (country) q.set('country', country);
    if (tag) q.set('tag', tag);
    const list = await radioFetch('/json/stations/search?' + q.toString(), 0);   // 随机不缓存
    const s = (Array.isArray(list) ? list : [])[0];
    if (!s) return res.status(404).json({ success: false, error: '没有找到符合条件的电台' });
    const out = radioStationOut(s);
    radioRemember(out.url);
    res.json({ success: true, station: out });
  } catch (e) { res.status(503).json({ success: false, error: '电台目录暂时不可用' }); }
});

/* 音频中转：把电台流经本站转发（支持 Range；客户端断开就断开上游）。
   白名单只认目录里出现过的电台主机，避免被当成任意 URL 代理（SSRF）。 */
app.get('/api/radio/stream', async (req, res) => {
  let target;
  try { target = new URL(String(req.query.u || '')); } catch { return res.status(400).json({ success: false, error: '音频地址无效' }); }
  if (!/^https?:$/.test(target.protocol)) return res.status(400).json({ success: false, error: '只支持 http/https' });
  if (!radioAllowedHosts.has(target.host.toLowerCase())) return res.status(403).json({ success: false, error: '该地址不在允许列表' });
  const ac = new AbortController();
  req.on('close', () => { try { ac.abort(); } catch { /* ignore */ } });
  try {
    /* 注意：**不要**给上游发 `Icy-MetaData: 1` —— Icecast 会把曲目元数据按 icy-metaint
       插进音频流里，而我们把响应当纯 audio/mpeg 透传，浏览器的 FFmpeg 解复用器会直接
       "open context failed"（实测 Chrome 报 NotSupportedError）。要纯音频。 */
    const headers = { 'User-Agent': 'Mozilla/5.0 (PixelKit-Radio)', 'Accept': 'audio/*,*/*;q=0.8' };
    if (req.headers.range) headers.Range = req.headers.range;
    const up = await fetch(target.toString(), { headers, redirect: 'follow', signal: ac.signal });
    if (!up.ok) return res.status(502).end();
    // 有些台在服务器网络下会被地区限制/重定向到错误页：返回空 200 或 text/html。
    // 直接把这种"假成功"变成 502，播放器才会触发 error → 自动换台。
    const upType = String(up.headers.get('content-type') || '');
    const upLen = String(up.headers.get('content-length') || '');
    if (!up.body || !upType || upLen === '0' || /text\/html/i.test(upType)) return res.status(502).end();
    res.status(up.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', up.headers.get('content-type') || 'audio/mpeg');
    const clen = up.headers.get('content-length'); if (clen) res.setHeader('Content-Length', clen);
    const cr = up.headers.get('content-range'); if (cr) res.setHeader('Content-Range', cr);
    for (const h of ['icy-name', 'icy-genre', 'icy-br', 'icy-description', 'icy-url']) { const v = up.headers.get(h); if (v) res.setHeader(h, v); }
    res.setHeader('Cache-Control', 'no-store');
    const reader = up.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((ok) => res.once('drain', ok));
      }
    } catch { /* 客户端断开或上游中断 */ }
    res.end();
  } catch { try { res.end(); } catch { /* ignore */ } }
});
// ==================== 活码（短链 + 扫码统计）2026-10-13 ====================
/* 用途：二维码里放**短链**而不是原始长链接，之后可以改目标、还能看扫了多少次。
   与站点既有安全策略一致：列表/统计/删除都必须带设备标识（userId 或 x-pk-user 头），
   只能看和改自己创建的活码；跳转本身公开（扫码的人当然不用登录）。 */
const SHORTLINK_FILE = path.join(__dirname, 'data', 'shortlinks.json');
const SHORTLINK_BASE = process.env.SHORTLINK_BASE || '';   // 想用自己的短域名就设它
const SHORT_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';  // 去掉容易看错的 0o1l
function loadShortlinks() {
  try { const raw = readFileSync(SHORTLINK_FILE, 'utf-8'); const j = JSON.parse(raw); return Array.isArray(j) ? j : []; } catch { return []; }
}
function saveShortlinks(list) {
  const dir = path.dirname(SHORTLINK_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SHORTLINK_FILE, JSON.stringify(list, null, 2));
}
function makeShortCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += SHORT_ALPHABET[Math.floor(Math.random() * SHORT_ALPHABET.length)];
  return s;
}
function shortBaseUrl(req) {
  /* 优先用显式配置：站点的 PUBLIC_BASE_URL（.env 里已有，形如 http://139.9.176.191:8081）或
     SHORTLINK_BASE。**不能只靠 req.get('host')** —— nginx 的 `proxy_set_header Host $host`
     会把端口丢掉，生成出的短链会变成 http://139.9.176.191/s/xxx（80 端口没服务）= 死链。
     2026-10-13 生产复验时发现并修。 */
  if (SHORTLINK_BASE) return SHORTLINK_BASE.replace(/\/$/, '');
  const envBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (envBase) return envBase;
  return `${req.protocol}://${req.get('host')}`;
}
const shortDayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

app.post('/api/shortlink/create', (req, res) => {
  try {
    const userId = String(req.body?.userId || req.headers['x-pk-user'] || '').trim();
    if (!userId) return res.status(401).json({ success: false, error: '缺少设备标识，请刷新页面后重试' });
    const target = String(req.body?.target || '').trim();
    if (!target) return res.status(400).json({ success: false, error: '请填写要跳转的链接或文本' });
    if (target.length > 2000) return res.status(400).json({ success: false, error: '内容太长了（上限 2000 字）' });
    const list = loadShortlinks();
    let code = makeShortCode();
    let guard = 0;
    while (list.some((x) => x.code === code) && guard++ < 50) code = makeShortCode();
    const rec = {
      code, userId,
      name: String(req.body?.name || '').trim().slice(0, 60),
      target,
      isUrl: /^https?:\/\//i.test(target),
      createdAt: Date.now(),
      total: 0,
      days: {},
      lastScanAt: 0,
    };
    list.unshift(rec);
    if (list.length > 2000) list.length = 2000;
    saveShortlinks(list);
    const url = `${shortBaseUrl(req)}/s/${code}`;
    console.log(`[活码] 新建 ${code} → ${target.slice(0, 60)}`);
    res.json({ success: true, code, url, record: { code, name: rec.name, target, isUrl: rec.isUrl, createdAt: rec.createdAt } });
  } catch (e) { res.status(500).json({ success: false, error: '创建失败' }); }
});

app.get('/api/shortlink/list', (req, res) => {
  const userId = String(req.query.userId || req.headers['x-pk-user'] || '').trim();
  if (!userId) return res.status(401).json({ success: false, error: '缺少设备标识，请刷新页面后重试' });
  const mine = loadShortlinks().filter((x) => x.userId === userId)
    .map((x) => ({ code: x.code, name: x.name, target: x.target, isUrl: x.isUrl, createdAt: x.createdAt, total: x.total || 0, lastScanAt: x.lastScanAt || 0 }));
  mine.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, links: mine, base: shortBaseUrl(req) });
});

app.get('/api/shortlink/stats/:code', (req, res) => {
  const userId = String(req.query.userId || req.headers['x-pk-user'] || '').trim();
  if (!userId) return res.status(401).json({ success: false, error: '缺少设备标识，请刷新页面后重试' });
  const rec = loadShortlinks().find((x) => x.code === req.params.code);
  if (!rec) return res.status(404).json({ success: false, error: '活码不存在' });
  if (rec.userId !== userId) return res.status(403).json({ success: false, error: '无权查看该活码统计' });
  const days = Object.entries(rec.days || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30).map(([d, n]) => ({ day: d, count: n }));
  res.json({ success: true, stats: { code: rec.code, name: rec.name, target: rec.target, total: rec.total || 0, lastScanAt: rec.lastScanAt || 0, days, recent: (rec.recent || []).slice(0, 20) } });
});

app.delete('/api/shortlink/:code', (req, res) => {
  const userId = String(req.query.userId || req.headers['x-pk-user'] || '').trim();
  if (!userId) return res.status(401).json({ success: false, error: '缺少设备标识，请刷新页面后重试' });
  const list = loadShortlinks();
  const idx = list.findIndex((x) => x.code === req.params.code);
  if (idx === -1) return res.status(404).json({ success: false, error: '活码不存在' });
  if (list[idx].userId !== userId) return res.status(403).json({ success: false, error: '无权删除该活码' });
  list.splice(idx, 1);
  saveShortlinks(list);
  res.json({ success: true });
});

// 短链跳转（公开）：计数 + 302；如果内容不是网址就当文本页展示
app.get('/s/:code', (req, res) => {
  try {
    const list = loadShortlinks();
    const rec = list.find((x) => x.code === req.params.code);
    if (!rec) return res.status(404).type('html').send('<meta charset="utf-8"><p style="font-family:system-ui;padding:40px">这个活码不存在或已被删除。</p>');
    rec.total = (rec.total || 0) + 1;
    const d = shortDayKey();
    rec.days = rec.days || {};
    rec.days[d] = (rec.days[d] || 0) + 1;
    rec.lastScanAt = Date.now();
    rec.recent = Array.isArray(rec.recent) ? rec.recent : [];
    rec.recent.unshift({ at: rec.lastScanAt, ua: String(req.headers['user-agent'] || '').slice(0, 120), ref: String(req.headers.referer || '').slice(0, 120) });
    if (rec.recent.length > 50) rec.recent.length = 50;
    saveShortlinks(list);
    console.log(`[活码] 扫码 ${rec.code}（累计 ${rec.total}）`);
    if (rec.isUrl) return res.redirect(302, rec.target);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PixelKit 活码</title><div style="font-family:system-ui;max-width:640px;margin:12vh auto;padding:0 20px;line-height:1.75">
<h3 style="margin:0 0 12px">${esc(rec.name || '活码内容')}</h3><pre style="white-space:pre-wrap;word-break:break-all;background:#f6f6f7;padding:14px;border-radius:10px">${esc(rec.target)}</pre>
<p style="color:#888;font-size:12px">由 PixelKit 活码服务提供 · 已扫 ${rec.total} 次</p></div>`);
  } catch (e) { res.status(500).json({ success: false, error: '服务器内部错误（已记录日志）' }); }
});
const distDir = path.join(__dirname, 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: 'index.html' }));
  /* SPA 兜底 + 软 404 修复（2026-10-08 审计）：
     原来任何 GET 都回 index.html + 200，导致 /uploads/、/server.log、/ppt/、老版本的
     /assets/xxx-旧hash.js 全都"200 + 首页"，既误导排查也让失效链接永远不 404。
     现在只有"看着像前端路由"的请求才回 index.html（浏览器导航、Accept: text/html、
     路径不带扩展名、且不在 API/资源前缀下），其余一律 404 JSON。 */
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = req.path;
    if (p.startsWith('/api/') || p.startsWith('/fs') || p.startsWith('/qr/') ||
        p.startsWith('/collab') || p.startsWith('/game')) return next();
    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    const hasExt = /\.[a-z0-9]{1,6}$/i.test(p);            // /assets/x.js、/server.log 这类
    const assetPrefix = /^\/(assets|generated-images|uploads|wasm|zhuzhiliao|scripts|data|node_modules)\b/.test(p);
    if (!acceptsHtml || hasExt || assetPrefix) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

/* 统一错误出口（2026-10-08 审计）：以前缺参 POST 会吐完整 Node 堆栈
   （含 /opt/pixelkit-prod/server.js:727、node_modules 路径）和 HTML 错误页。
   现在一律 JSON、不带堆栈，细节只进服务端日志。 */
app.use((err, req, res, _next) => {
  const msg = String(err?.message || '');
  // "没传文件/字段"这类 TypeError 其实是客户端请求不完整，按 400 回，别报 500
  const missingInput = /Cannot read propert/i.test(msg) && /(path|originalname|buffer|filename|map|length)/i.test(msg);
  const badJson = err?.type === 'entity.parse.failed';
  const status = badJson ? 400 : (missingInput ? 400 : (Number(err?.status || err?.statusCode) || 500));
  console.error(`[error] ${req.method} ${req.originalUrl} →`, msg || err);
  if (res.headersSent) return;
  res.status(status).json({
    success: false,
    error: badJson ? '请求体不是合法 JSON'
      : (status === 400 ? '请求参数不完整或文件缺失' : '服务器内部错误（已记录日志）'),
  });
});

server.listen(PORT, () => {
  console.log(`PixelKit Server v2 已启动: http://localhost:${PORT}`);
  console.log(`[协同] WebSocket 就绪: ws://localhost:${PORT}`);
  console.log('API:');
  console.log('  POST /api/convert        - 格式互转 (docx/xlsx/pptx/pdf)');
  console.log('  POST /api/img-to-pdf     - 图片→PDF');
  console.log('  POST /api/pdf-to-img     - PDF→图片');
  console.log('  POST /api/pdf-merge      - PDF合并');
  console.log('  POST /api/pdf-split      - PDF拆分');
  console.log('  POST /api/pdf-compress   - PDF压缩');
  console.log('  POST /api/pdf-encrypt    - PDF加密');
  console.log('  POST /api/pdf-decrypt    - PDF解密');
  console.log('  POST /api/pdf-watermark  - PDF水印');
  console.log('  POST /api/to-markdown    - 格式→Markdown');
  console.log('  POST /api/agent/chat     - AI 对话(带记忆)');
  console.log('  POST /api/agent/ping     - 心跳保活');
  console.log('  POST /api/agent/execute  - AI 智能文件处理');
  console.log('');
});
