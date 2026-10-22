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

## 构建注意
- 服务器 1.7GB 内存构建大包会被 OOM 杀死：已加 4GB swap，hook 构建使用 `BUILD_LIGHT=1`（关闭压缩）并限制 `--max-old-space-size=1536`

## 已知边界
- 唱片视图「按流派」风格是波形/山脊画法，切到「圆盘」才是唱片盘（与源站一致）
- headless 无声卡，FFT 的真实低音值无法在自动化里验证（`__rdAudio.isReal()` 可确认真实频谱链路）
- 旧电台渲染器（`src/pages/Radio*.js`，约 4,600 行）已删除；`main.css` 中历史 radio 覆盖样式尚未清理

## 回滚
- 部署：`git push deploy test` / `test:main`，hook 构建失败会保留旧 dist
- 如需回到旧电台页：恢复 `index.html` 的旧 `#page-radio` 标记与 `src/main.js` 的 `RadioPage` 引用（旧文件已删除，可从 GitHub 历史 `9a89244` 之前找回）
