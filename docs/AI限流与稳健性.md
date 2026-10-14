# AI 限流与稳健性（多家供应商）

> 2026-09-12 首版实测 + 改造；2026-09-30 复核（新增 RPS 分类、预检保护、模型切换、
> 聊天界面重设计、**多供应商 + 自动兜底**）。相关代码：`lib/ai-retry.js`（限流工具）、
> `server.js`（接线/供应商层）、`scripts/ai-retry-check.mjs`（限流自检）、
> `scripts/ui-contrast-check.mjs`（对比度巡检）。
> 前端：`src/pages/AgentPage.js` + `src/styles/agent.css`（聊天页）、
> `src/pages/LifeBookPage.js`（生成物）、`src/pages/LifeSimPage.js`。

## 0.2 多供应商（2026-09-30 追加）

站点现在同时接两家，按**模型 id 里有没有 `/`** 路由（`vendor/model` → OpenRouter，其余 → 商汤）：

| 供应商 | 端点 | key 来源 | 承担 |
| --- | --- | --- | --- |
| 商汤 SenseNova | `token.sensenova.cn/v1` | `MAIN_KEY_POOL` / `DUAL_KEY_POOL` | 识图（多模态）、文生图、研究子代理、人生之书、画图优化 + **兜底** |
| OpenRouter | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | 主对话模型（可换任意 OpenRouter 模型） |

- `endpointFor(model, keyKind)` / `upstream(model, keyKind)` 统一解析端点、key 与请求头；
  OpenRouter 还会带上 `HTTP-Referer` / `X-Title`（OpenRouter 建议的来源信息）。
- **推理参数按供应商适配**（`reasoningParams`）：商汤用顶层 `reasoning_effort: none|low|…`；
  OpenRouter 用 `reasoning: { enabled: false }` / `{ effort }`。否则短输出会把 max_tokens 烧在思考上。
- **自动兜底**：主模型端点不可用（404/no endpoints/guardrail/未开通）或被限流到快速失败时，
  自动改用 `OPENAI_FALLBACK_MODEL`（默认商汤 `deepseek-flash`）；流式与非流式两条路都做了。
  实测日志：`[provider] nvidia/…:free 端点不可用（HTTP 404）→ 改用兜底模型 deepseek-flash`。

### OpenRouter 实测结论（2026-09-30）

| 事项 | 结果 |
| --- | --- |
| key 是否可用 | ✅ `/key` 返回 200；付费模型可直接出文 |
| `nvidia/nemotron-3-ultra-550b-a55b`（付费） | ✅ 200，约 2.5s；1M 上下文；支持 tools/reasoning |
| `nvidia/nemotron-3-ultra-550b-a55b:free`（免费） | ✅ **200（用户已开启免费端点后实测）**：1.7s、69 字、`cost = 0`；流式 21 块、工具调用 `finish=tool_calls` 均正常 |
| 其它 `:free` 模型 | 同一账号设置放开后也可用（`nvidia/nemotron-3.5-lightning:free` 等） |
| 账户额度 | `limit = 0.01` USD，`usage = 0` —— 付费模型只能试跑几次；免费模型不受额度限制，但按 OpenRouter 政策（充值 < $10）约 **20 次/分钟、50 次/天** |

**要让免费模型真的能用，只需一步**：打开 https://openrouter.ai/settings/privacy
把「允许免费端点使用/训练我的提示词」（Free model training）打开。开完**无需改代码**：
聊天页模型下拉里直接选 `Nemotron 3 Ultra (free)` 即可（状态会从 `guardrail` 变成 `available`）。

### 站点策略：只允许免费模型（硬约束，用户明确要求）

主模型只能用免费模型、不得动用付费额度。代码里两道闸（均已实测）：

1. `resolveModel()`：`/api/agent/chat`、`/api/agent/chat-stream` 传来的**收费模型一律拒绝**
   （日志 `[free-only] 拒绝收费模型「…」，回退到 …:free`），回退到当前默认（免费）模型；
2. `upstream()`：**最后防线** —— 任何代码路径若拿到收费模型，就地降级成免费主模型，
   保证收费模型永远不出网。判定：OpenRouter 模型（id 含 `/`）不以 `:free` 结尾即为收费；
   兜底模型同样判定（`safeFallbackModel()`，防止 `.env` 被配成收费模型）。

`GET /api/agent/models` 返回 `freeOnly: true`，收费模型标为 `status: 'billable_disabled'` +
`disabled: true`（前端下拉显示「收费·已禁用」且不可选）。

**费用自查**：`curl -H "Authorization: Bearer $OR_KEY" https://openrouter.ai/api/v1/key` 看 `usage`。
免费模型 `cost = 0` 不扣额度（2026-09-30 记录：`usage = 0.00127` USD 全部来自接入前的付费版连通性测试，
此后全部走免费模型）。

### 免费端点会抖，已纳入降级

`nvidia/nemotron-3-ultra-550b-a55b:free` 跑在共享免费端点上，实测出现过
`503 Upstream error from Nvidia: Service temporarily overloaded`。
因此 `isEndpointUnavailable()` 把 **5xx / overloaded** 也算"端点不可用"，直接切兜底供应商
（商汤 `deepseek-flash`），而不是原地重试。

## 0. 2026-09-30 复核：三种限流不是一回事

复核时又踩到新错误体，之前把它当"分钟窗口"处理是错的：

| 错误体 | 含义 | 正确处理 |
| --- | --- | --- |
| `inference exceeds tpm/rpm limit`（`rate_limit_error` / `insufficient_quota`） | 分钟级 token/请求额度 | **等到下一个分钟边界**（上限 65s） |
| `rpm exhausted`（`quota_exceeded_error` / code 8） | 分钟级请求数 | 同上 |
| **`rps exhausted`**（`quota_exceeded_error` / code 8） | **每秒级**请求数 | **等 1~2 秒重试**；按分钟对齐会白等一分钟（已修） |
| `model is not available in the current token plan`（`permission_denied_error`） | **套餐未开通**（如 `deepseek-v4.1-flash`） | **不要重试**，明确提示去控制台开通 |

同时发现两处「自己把自己打限流」的问题，均已修：

1. **工具预检 + 正式请求背靠背**会撞 `rps exhausted` → 并发闸门加了 `minGapMs`（默认 1200ms），
   任意两次上游调用之间至少隔 1.2 秒；
2. **预检的 429 会把主熔断器打开**，导致用户这一条消息直接被熔断掉（本地实测复现）→ 预检现在：
   熔断中 / 冷却中直接跳过；撞限流就冷却 5 分钟不再预检；失败**不计入**主熔断器。
   预检本身是额外一次上游调用，在 ~3 次/分钟的额度下必须省着用。

**最重要的背景**：额度是**账号级**的，而本机上跑着的 `my_agent`（rollouts 持续写入）与站点
**共用同一个 key**。也就是说"网站被限流"里有一半是自己的 agent 在抢。代码只能让失败变优雅，
要真正稳定必须给站点单独账号/额度。

## 0.1 模型切换（2026-09-30）

- 站点默认模型改为 **`deepseek-flash`**（服务器 `.env` 的 `OPENAI_MODEL` / `DUAL_MODEL` /
  `RESEARCH_MODEL` / `QUORIDOR_MODEL` 同步改，`pm2 restart --update-env` 生效；代码默认值也改了）。
- 新增 `GET /api/agent/models`：候选模型 + 可用性状态（`available` / `plan_denied` /
  `not_found` / `unknown`）。状态**不额外花配额探测**，而是用真实请求学习（403→未开通、
  200→可用、429→有权限但被限流）；要强刷用 `?probe=1`（会消耗配额）。
- `/api/agent/chat` 与 `/api/agent/chat-stream` 支持前端传 `model`（**白名单校验**，非法回退默认）；
  选到未开通的模型直接拦下并给明确提示，不打上游。
- 聊天页顶部有模型下拉：未开通的项置灰标注「未开通」，选择记忆在 `localStorage.pk_agent_model`。
- **`deepseek-v4.1-flash` 实测结论**：模型目录里存在（1M 上下文、支持工具/推理），但当前
  token plan **未开通**（403 `permission_denied_error`，主池与内测池 key 都一样）。
  在控制台开通后无需改代码，下拉里直接可选。

## 1. 实测到的事实（不是推测）

用探针脚本在服务器上直接打网关（`scripts/ai-retry-check.mjs --live` 可复现同类观测）：

| 观测 | 结果 |
| --- | --- |
| 429 是否带 `retry-after` / `x-ratelimit-*` | **一个都没有**（`hdr: {}`），无法靠响应头感知配额 |
| 错误体形态 | ① `inference exceeds tpm/rpm limit`（`rate_limit_error` / `insufficient_quota`）② `rpm exhausted`（`quota_exceeded_error` / `code:8`） |
| 换 key 是否有用 | **没用**：同一分钟窗口内成功 3 次后，换第 2、3 条 key 依旧 429 —— 三条 key 共用同一账号额度 |
| 窗口重置粒度 | **按分钟的整点边界**：06:34:02 起成功 3 次 → 06:35:02 恢复可用 |
| 单窗口容量 | 约 **3 次请求/分钟**（账号级，含本站 + 其它项目 + 你的 agent） |
| 429 响应耗时 | 40~800ms（快速拒绝，所以"快速失败 + 稍后重试"的成本很低） |

结论：**在这个网关上，秒级退避（0.5s/1s/2s）等于白等** —— 三次重试全落在同一个分钟窗口里。
必须跨过分钟边界才有意义。

## 2. 改造后的行为

### 2.1 四个部件（`lib/ai-retry.js`）

| 部件 | 作用 |
| --- | --- |
| `isQuotaText` / `isMinuteQuotaText` | 按**错误文本**识别限流（本网关会把配额错误包装成 4xx，只看状态码会漏判） |
| `quotaWaitMs` | 等待时长：`retry-after` 头 > **对齐下一个分钟边界** > 指数退避；上限 65s |
| `createBreaker` | 连续 3 次失败 → 熔断 60s，期间直接快速失败（不再空转上游、不把窗口摁死） |
| `createPacer` | 同时在飞的上游请求 ≤ 2（一个页面可能同时触发多个 AI 调用，避免自己打自己） |

### 2.2 已接线的位置（`server.js`）

- `fetchAIStream`（Agent 对话/工具循环）：熔断检查 → 闸门 → 限流时按分钟边界等待，**等不起就快速失败**
- `streamBookAi`（人生之书 SSE）：同上；错误 JSON 里带 `retryAfterMs`
- `book-ai` 非流式：同上，`retryAfterMs` 一起返回
- 预检（precheck）：429 只短等一次就放弃预检（返回 null = 不启用工具，优雅降级），并把这次失败计入熔断
- 文生图（主 + 备用）：429 改走分钟边界退避，上限 `AI_IMAGE_MAX_WAIT_MS`（默认 65s，画图有进度提示，可以等）

### 2.3 流式超时的语义修正

旧实现给流式请求设了 **40s 总超时**，长一点的结算散文会在中途被 `abort`，表现为「生成中断」。
现在拆成两段：

- **TTFB 超时**（`BOOK_AI_TIMEOUT_MS`，默认 40s）：只卡"等第一个字节"；
- **断流看门狗**（`BOOK_AI_STALL_MS`，默认 45s）：收到数据就续期，只有"长时间一个字节都没有"才中止。

也就是 agent 建议的「连接超时与读取超时分开」，并额外避免了"长文被总超时切断"。

### 2.4 前端行为

服务端在失败时返回 `retryAfterMs`。两个前端（人生之书、成长模拟器旧版）都会：
**等待 ≤30s 就自动重试一次**（状态提示"上游额度紧张，约 N 秒后自动重试…"），
更久或再失败才显示「↻ 重试」按钮 —— 玩家不会看到一闪而过的失败。

## 3. 环境变量旋钮

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_INTERACTIVE_MAX_WAIT_MS` | 20000 | 交互式请求最长硬等；超过就快速失败并把 `retryAfterMs` 交给前端 |
| `AI_BREAKER_THRESHOLD` | 3 | 连续失败多少次触发熔断 |
| `AI_BREAKER_COOLDOWN_MS` | 60000 | 熔断时长（≈一个配额窗口） |
| `AI_MAX_CONCURRENT` | 2 | 同时在飞的上游请求数 |
| `AI_IMAGE_MAX_WAIT_MS` | 65000 | 文生图 429 等待上限 |
| `BOOK_AI_TIMEOUT_MS` | 40000 | 流式/TTFB 超时 |
| `BOOK_AI_STALL_MS` | 45000 | 断流看门狗 |

## 4. 自检

```bash
node scripts/ai-retry-check.mjs          # 离线单测（32 项，不联网、不烧额度）
node scripts/ai-retry-check.mjs --live   # 额外打真实网关，观察 429 与建议等待
```

离线部分覆盖了最容易改坏的地方：分钟边界对齐、`retry-after` 优先级与上限、熔断阈值与冷却、
并发闸门、以及"server.js 是否还接着这套逻辑"的静态断言。

## 5. 还没解决的（真正决定容量上限的三件事）

1. **账号是共享的**：`MAIN_KEY_POOL`/`DUAL_KEY_POOL` 与你的 agent（`my_agent/.env` 的 `LLM_API_KEY`）
   是**同一个账号**，一分钟约 3 次的额度要分给所有调用方。代码只能让失败更优雅，
   想要真正的余量必须**换账号/单独申请额度**，或给站点与 agent 各自独立配额。
2. **预检让请求数翻倍**：`/api/agent/chat-stream` 在正式调用前会先做一次工具预检（`doPrecheck`），
   即一轮对话消耗 2 次配额。若额度紧张，可考虑合并成一次调用（让正式请求直接带 tools），
   或对预检结果做短时缓存。
3. **合并请求是最省额度的做法**：RPM 按"请求数"计，`reasoning_effort: none` 已把 TPM 压到最低；
   把 N 个小请求合成 1 个大请求（例如一次改写多条选项）比任何重试都有效。
   现有缓存（`data/book-rewrite-cache.json`）已经在摊薄重复内容。

## 6. 设计取舍

- 交互式请求**不硬等一分钟**：等待 >20s 就快速失败 + 让前端在建议时间点自动重试，
  而不是把用户挂在转圈里（同时避免占满 nginx 的 `proxy_read_timeout`）。
- 熔断期间所有文本 AI 调用一起快速失败：这是刻意的 —— 配额按账号算，
  继续重试只会让窗口一直处于耗尽状态。
