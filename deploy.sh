#!/bin/bash
# PixelKit 部署脚本 - 华为云 Linux 服务器
# 使用方法: bash deploy.sh
#
# ⚠️ 数据保护：data/ 目录存储运行时数据（排行榜/访客统计/文件），部署不会覆盖
# ⚠️ 如需完整清除数据：rm -rf data/*

set -e

echo "=== PixelKit 部署开始 ==="

# 0. 保护数据目录
echo "[0/5] 保护数据目录..."
mkdir -p data
# 记录当前数据文件列表，部署完成后对比
BEFORE=$(ls data/ 2>/dev/null | wc -l)

# 1. 安装系统依赖 (LibreOffice)
echo "[1/5] 安装 LibreOffice..."
if ! command -v libreoffice &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress
fi

# 2. 安装 Node.js 依赖
echo "[2/5] 安装 Node.js 依赖..."
npm install --production

# 3. 构建前端
echo "[3/5] 构建前端..."
npm run build

# 4. 启动服务 (使用 PM2)
echo "[4/5] 启动服务..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

# 用 Nginx 托管前端，后端用 PM2
# 前端静态文件: dist/
# 后端 API: server.js (端口 3001)

# 启动后端
pm2 delete pixelkit-server 2>/dev/null || true
pm2 start server.js --name pixelkit-server

# Nginx 配置示例:
# server {
#     listen 80;
#     server_name 你的域名;
#     root /path/to/pixelkit/dist;
#     index index.html;
#     location / {
#         try_files $uri $uri/ /index.html;
#     }
#     location /api/ {
#         proxy_pass http://127.0.0.1:3001;
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#     }
#     # WebSocket 协同
#     location /collab {
#         proxy_pass http://127.0.0.1:3001;
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection "upgrade";
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_read_timeout 86400;
#     }
# }
#
# HTTPS 配置（推荐）:
# server {
#     listen 443 ssl http2;
#     server_name 你的域名;
#     ssl_certificate /path/to/cert.pem;
#     ssl_certificate_key /path/to/key.pem;
#     # 其余同上...
# }
# server { listen 80; server_name 你的域名; return 301 https://$host$request_uri; }

AFTER=$(ls data/ 2>/dev/null | wc -l)
echo "  数据文件保留: $AFTER 个"

echo "=== 部署完成 ==="
echo "前端静态文件: dist/"
echo "后端服务: pm2 status"
echo "请配置 Nginx 反向代理 /api/ → http://127.0.0.1:3001"
echo ""
echo "⚠️ 上传代码时务必排除 data/ 目录，否则会覆盖服务器数据:"
echo "   rsync -av --exclude 'data/' --exclude 'node_modules/' ./ user@server:/path/"
