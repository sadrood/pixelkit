# 电台 2.0：RoamDial 高保真复刻移植说明

## 来源与目标
- 复刻来源：`D:\aaa\work\roamdial-clone`（Next.js + React + Three.js，35,699 台真实数据）
- 目标：整体接管 PixelKit 的世界电台页 `#page-radio`，保留站点外壳、部署链路与其它工具

## 结构
```
src/radio2/
├─ mount.jsx              # 挂载入口：Shadow DOM + 字体 + 样式 + React root
├─ components/            # Workspace / SceneCanvas / Intro / RecordView / PhonePlayer / Standby / StationSheet / InstallPrompt / dragSort
├─ lib/                   # stations（数据加载）/ audio（播放+FFT+代理重试）/ i18n / storage / motion
└─ styles/
   ├─ roamdial-raw.css     # 源站样式原样拷贝
   ├─ roamdial-shadow.css  # :root/body → :host 的 Shadow DOM 版本（脚本生成）
   └─ roamdial.css         # 早期作用域版本（保留备查）
public/roamdial/
├─ globe_core.json  (1.0MB)   # 坐标/流派/国家/语言/码率（列式）
├─ globe_rest.json  (4.4MB)   # 台名/流地址/标签/州/时区索引
├─ land-dots.json   (245KB)   # 陆地小点
└─ fonts/                     # Inter / JetBrains Mono / Instrument Serif
scripts/
├─ build-roamdial-shadow-css.mjs   # 生成 Shadow DOM 样式
└─ scope-roamdial-css.mjs          # 生成 #roamdial-root 作用域样式（备查）
```

## 为什么用 Shadow DOM
PixelKit 站点全局 CSS 有 `#app .btn` 等高优先级规则，会把复刻版按钮变成白底黑字、标题变黑。Shadow DOM 隔离后样式完全可控；字体通过 shadow 内 `<link>` 加载。

## 接入点
- `index.html`：`#page-radio` 只保留 `<div id="roamdial-root">`
- `src/main.js`：`showPage('radio')` → `import('./radio2/mount.jsx').mountRadio()`
- `src/styles/main.css`：`#roamdial-root` 绝对定位容器

## 数据与性能
- nginx 对 `application/json` 开 gzip：`globe_core` 1MB→339KB，`globe_rest` 4.4MB→1.79MB
- 首页电台卡片悬停/聚焦时预热三个 JSON：移动端进入电台页加载 **8.8s → 2.9s**
- 低端设备（窄屏 / ≤4 核 / ≤4GB）默认开省电模式

## 播放与兜底
- 直连播放（保留 CORS 以获取真实 FFT）
- 失败链条：
  1. 引擎层：直连失败 → 本站代理 `/api/radio/stream?u=` 重试一次
  2. 工作区层：代理失败 → 同台再换代理线路一次 → 仍失败自动跳过（最多连跳 3 次）
- 代理白名单 `radioAllowedHosts` 已纳入 `public/roamdial/globe_rest.json` 的全部主机
- 100 台抽样（服务器网络）：直连 81/100，代理 97/100，并集 **98/100**

## 定位（听本地）
- 顶部「📍 听本地」按钮：先尝试浏览器 GPS（仅 HTTPS/localhost 等安全上下文可用）
- HTTP 站点或 GPS 被拒时，自动走 `/api/geo/locate`（服务器用 ip-api.com 按客户端 IP 做城市级定位）
- 命中后按 haversine 找最近的可播电台并 `enterWorkspace` 播放，Toast 提示距离与定位方式
- 实测（HTTP 生产）：IP 定位到「深圳/广东」，自动播放「深圳新闻广播（1 km）」

## 音频 VPN 兜底
- 服务器常驻 mihomo（systemd，配置在 `/etc/mihomo/config.yaml`，节点凭据不入库）
- `/api/radio/stream` 先直连，失败（超时/拒绝/HTML/空流）时自动改用 `127.0.0.1:7890` 的 VPN 重试
- 两者都失败返回 502，播放器据此自动换台；响应头 `X-Radio-Route: direct|vpn` 可排查
- 实测 300 台抽样：直连 248，失败 52；其中 VPN 可救回 38（73%），等效可播率 82.7% → 95.3%

## 构建注意
- 服务器 1.7GB 内存构建大包会被 OOM 杀死：默认改为**本地构建 + 上传产物**（`scripts/deploy-prebuilt.ps1`），hook 检测到 `/tmp/pk-dist-<branch>.tgz` 即跳过构建，仅按 lockfile 变化运行 `npm install`

## 已知边界
- 唱片视图「按流派」风格是波形/山脊画法，切到「圆盘」才是唱片盘（与源站一致）
- headless 无声卡，FFT 的真实低音值无法在自动化里验证（`__rdAudio.isReal()` 可确认真实频谱链路）
- 旧电台渲染器（`src/pages/Radio*.js`，约 4,600 行）已删除；`main.css` 中历史 radio 覆盖样式尚未清理

## 部署（本地构建 → 云端发布）

服务器只有 1.7GB 内存，`vite build` 会在 `rendering chunks` 阶段被内核 OOM 杀死（hook 静默保留旧 dist，容易误判"部署成功"）。
因此默认改为**本地构建、只上传产物**：

```powershell
pwsh scripts/deploy-prebuilt.ps1 -Target both -Message "改动说明"
# 或 -Target test / -Target main
```

流程：本地 `npm run build` → 打 tar → scp 到 `/tmp/pk-dist-{test,main}.tgz` → push 触发 hook →
hook 检测到预构建产物后**跳过 vite build**（仅按 package-lock 变化执行 `npm install`），直接发布。

## 回滚
- 部署失败/需要回退：服务器 `/opt/pixelkit-prod/releases/` 保留最近若干版本，可把 `live/index.html` 指回旧版；hook 构建失败也会保留旧 dist
- 旧版 hook 行为：`git push deploy test` / `test:main`（无预构建产物时仍会尝试服务器构建，可能 OOM）
- 如需回到旧电台页：恢复 `index.html` 的旧 `#page-radio` 标记与 `src/main.js` 的 `RadioPage` 引用（旧文件已删除，可从 GitHub 历史 `9a89244` 之前找回）
