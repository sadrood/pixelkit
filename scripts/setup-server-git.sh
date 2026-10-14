#!/bin/bash
# ============================================================
# 服务器端一次性初始化脚本（只需运行一次）
# 功能：
#   1. 安装 git / pm2（如缺失）
#   2. 创建裸仓库 /home/pixelkit/pixelkit.git
#   3. 安装 post-receive hook（push 后自动部署）
#   4. 创建站点目录 /var/www/pixelkit
#
# 用法: bash setup-server-git.sh
# 如需自定义路径，改下面两个变量即可
# ============================================================
set -e

REPO="/home/pixelkit/pixelkit.git"   # 裸仓库路径
TARGET="/var/www/pixelkit"           # 站点部署目录

echo "===== 初始化 PixelKit Git 部署环境 ====="

# 0. 安装 git（如缺失）
if ! command -v git &> /dev/null; then
    echo "[0/3] 安装 git ..."
    sudo apt-get update
    sudo apt-get install -y git
else
    echo "[0/3] git 已安装: $(git --version)"
fi

# 1. 创建裸仓库
mkdir -p "$(dirname "$REPO")"
if [ ! -d "$REPO" ]; then
    echo "[1/3] 创建裸仓库 $REPO ..."
    git init --bare "$REPO"
else
    echo "[1/3] 裸仓库已存在: $REPO"
fi

# 2. 安装 post-receive hook（用 sed 替换成实际路径）
echo "[2/3] 安装 post-receive hook ..."
if [ -f "scripts/post-receive" ]; then
    HOOK_SRC="scripts/post-receive"
elif [ -f "$(dirname "$0")/post-receive" ]; then
    HOOK_SRC="$(dirname "$0")/post-receive"
else
    echo "!! 未找到 post-receive 文件，请将 setup-server-git.sh 和 post-receive 放在同一目录"
    exit 1
fi
sed -e "s|GIT_DIR=\"/home/pixelkit/pixelkit.git\"|GIT_DIR=\"$REPO\"|" \
    -e "s|TARGET=\"/var/www/pixelkit\"|TARGET=\"$TARGET\"|" \
    "$HOOK_SRC" > "$REPO/hooks/post-receive"
chmod +x "$REPO/hooks/post-receive"
echo "     hook 已安装: $REPO/hooks/post-receive"

# 3. 创建站点部署目录
mkdir -p "$TARGET/data"
echo "[3/3] 站点目录已创建: $TARGET (含 data/ 数据目录)"

echo ""
echo "===== 配置完成 ====="
echo ""
echo "接下来在【本地电脑】执行："
echo ""
echo "  1) git init && git add . && git commit -m \"初始提交\""
echo "  2) git remote add deploy root@你的服务器IP:$REPO"
echo "  3) git push deploy master"
echo ""
echo "以后每次更新只需: git add -A && git commit -m \"xxx\" && git push deploy"
