/**
 * 上游模型（token.sensenova.cn）限流退避与熔断工具 —— 纯函数 + 两个小状态机，无外部依赖。
 *
 * 为什么需要它（2026-09-12 实测结论，探针脚本见 scripts/ai-retry-check.mjs --live）：
 *   ① 429 响应**不带** retry-after，也没有 x-ratelimit-* 任何头，无法靠响应头感知配额；
 *   ② 三条 key（MAIN_KEY_POOL）共用同一个账号额度：同一个分钟窗口里成功 3 次之后，
 *      换 key 照样 429 —— 所以"429 就换 key 立即重试"是无效动作；
 *   ③ 秒级退避（0.5s/1s/2s）三次重试全部落在同一分钟窗口内，等于白等白烧；
 *      配额按**分钟的整点边界**重置（06:34:02 起 3 次成功 → 06:35:02 又可用）；
 *   ④ 错误体有两种：`inference exceeds tpm/rpm limit`(rate_limit_error/insufficient_quota)
 *      与 `rpm exhausted`(quota_exceeded_error/code=8)，必须都按限流处理。
 *
 * 因此策略是：能识别分钟级配额 → **等到下一个分钟边界**再试（上限 65s）；
 * 供应商哪天给了 retry-after 就优先听它的；连续失败到阈值就**熔断**一段时间，
 * 期间直接快速失败并把"还有多少秒可重试"告诉前端，避免把配额窗口一直摁死。
 *
 * 逻辑移植自 my_agent/models/llm.py 的 _retry_delay / _quota_wait（已在生产验证），
 * 并加上 Web 场景需要的熔断与并发闸门。
 */

export const DEFAULT_MAX_WAIT_MS = 65000;        // 单次等待硬上限（与 Python 版一致）
export const DEFAULT_QUOTA_BASE_MS = 2000;       // 退避基数；限流类 ×3
export const MINUTE_MS = 60000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/* ---------------- ① 错误识别 ---------------- */

/** 是否为限流/配额类错误（包含被包装成 400/invalid_request_error 的 429 变体）。 */
export function isQuotaText(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('429')
    || t.includes('rate limit')
    || t.includes('rate_limit')
    || t.includes('too many requests')
    || t.includes('quota')
    || t.includes('exhausted')
    || t.includes('tpm')
    || t.includes('rpm');
}

/** 是否为**每秒**级限流（RPS）。这类只需等 1~2 秒重试即可，绝不该按分钟窗口处理。
    实测错误体：`rps exhausted`(quota_exceeded_error, code 8)、`RateLimitExceeded.EndpointRPSExceeded`。 */
export function isRpsQuotaText(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('rps') || t.includes('per second');
}

/** 是否为**按分钟窗口**重置的配额耗尽（这类必须跨分钟边界才有意义）。 */
export function isMinuteQuotaText(text) {
  if (isRpsQuotaText(text)) return false;      // RPS 走秒级重试，别误判成分钟窗口
  const t = String(text || '').toLowerCase();
  return t.includes('tpm')
    || t.includes('rpm')
    || t.includes('per minute')
    || t.includes('rate limit exceeded')
    || t.includes('rate_limit')
    || t.includes('quota_exceeded')
    || t.includes('exhausted');
}

/* ---------------- ② 退避与等待 ---------------- */

/** 指数退避 + 抖动；限流类起点 ×3（秒级退避对分钟窗口没用，但用于普通 5xx 仍合适）。 */
export function backoffMs(attempt, { baseMs = DEFAULT_QUOTA_BASE_MS, quota = false, jitter = 0.25, maxMs = DEFAULT_MAX_WAIT_MS } = {}) {
  const base = baseMs * (quota ? 3 : 1) * Math.pow(2, Math.max(0, attempt));
  const jittered = base * (1 + jitter * Math.random());
  return Math.min(Math.round(jittered), maxMs);
}

/** 距离下一个分钟整点边界的毫秒数（+margin 作为余量）。 */
export function msToNextMinute(now = Date.now(), marginMs = 1000) {
  return (MINUTE_MS - (now % MINUTE_MS)) + marginMs;
}

/** 解析 retry-after 响应头（秒数或 HTTP 日期），拿不到返回 null。 */
export function parseRetryAfterMs(headers) {
  try {
    if (!headers || typeof headers.get !== 'function') return null;
    const raw = headers.get('retry-after') ?? headers.get('Retry-After');
    if (!raw) return null;
    const asNum = Number(String(raw).trim());
    if (Number.isFinite(asNum)) return asNum > 0 ? asNum * 1000 : null;
    const at = Date.parse(raw);
    if (Number.isFinite(at)) { const d = at - Date.now(); return d > 0 ? d : null; }
  } catch { /* 头解析失败就当作没有 */ }
  return null;
}

/**
 * 限流等待时长（核心）。
 * 优先级：RPS(秒级，1~2s) > retry-after 头 > 分钟边界对齐（分钟级配额）> 指数退避；
 * 一律不超过 maxWaitMs（交互式请求应传更小的上限，宁可快速失败让前端重试）。
 */
export function quotaWaitMs({ attempt = 0, errText = '', retryAfterMs = null, now = Date.now(), maxWaitMs = DEFAULT_MAX_WAIT_MS, baseMs = DEFAULT_QUOTA_BASE_MS } = {}) {
  // 每秒级限流：等 1 秒多再试就好，成本极低且通常立刻成功（实测 rps exhausted 即此类）
  if (isRpsQuotaText(errText)) {
    const rpsWait = 1200 + attempt * 600 + Math.random() * 300;
    return Math.min(Math.round(rpsWait), Math.min(maxWaitMs, 6000));
  }
  const backoff = backoffMs(attempt, { baseMs, quota: true });
  let wait = backoff;
  if (retryAfterMs && retryAfterMs > 0) wait = Math.max(backoff, retryAfterMs);
  else if (isMinuteQuotaText(errText)) wait = Math.max(backoff, msToNextMinute(now));
  return Math.min(Math.round(wait), maxWaitMs);
}

/** 把等待时长变成人话，用于日志/前端提示。 */
export function describeWait(ms) {
  if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms)}ms`;
}

/* ---------------- ③ 熔断器 ---------------- */
/**
 * 连续 failureThreshold 次限流/失败后进入 open 状态，cooldownMs 内直接快速失败。
 * 目的：配额窗已经被摁死时，继续重试只会让情况更糟（也拖垮同账号的其它项目）。
 */
export function createBreaker({ threshold = 3, cooldownMs = 60000, now = Date.now } = {}) {
  let failures = 0, openUntil = 0, openedAt = 0;
  return {
    /** @returns {{ok:boolean, retryAfterMs:number}} */
    check() {
      const t = now();
      if (openUntil && t < openUntil) return { ok: false, retryAfterMs: openUntil - t };
      if (openUntil && t >= openUntil) { openUntil = 0; failures = 0; }   // 冷却结束，半开
      return { ok: true, retryAfterMs: 0 };
    },
    ok() { failures = 0; openUntil = 0; openedAt = 0; },
    fail() {
      failures++;
      if (failures >= threshold) {
        openUntil = now() + cooldownMs;
        openedAt = now();
        failures = 0;
        return true;      // 本次触发了熔断
      }
      return false;
    },
    get state() {
      const t = now();
      return { open: Boolean(openUntil && t < openUntil), retryAfterMs: openUntil ? Math.max(0, openUntil - t) : 0, failures, openedAt };
    },
  };
}

/* ---------------- ④ 并发闸门 ---------------- */
/**
 * 限制同时在飞的上游请求数（默认 2）并保证两次上游调用之间有最小间隔。
 * 为什么需要间隔：网关除了每分钟(RPM/TPM)还有**每秒**(RPS)限流，
 * 实测"预检 + 正式请求"背靠背发出时会撞 `rps exhausted`。
 * 排队而不是丢弃，队首按 FIFO 放行。
 */
export function createPacer({ maxConcurrent = 2, minGapMs = 0, now = Date.now } = {}) {
  let active = 0;
  let lastGrant = 0;
  const waiters = [];
  function drain() {
    while (active < maxConcurrent && waiters.length) {
      active++;
      const w = waiters.shift();
      w.resolve(() => { active--; drain(); });   // release
    }
  }
  return {
    /** @returns {Promise<function>} release 函数（等待最小间隔后才真正返回） */
    async acquire() {
      const release = await new Promise((resolve) => { waiters.push({ resolve }); drain(); });
      if (minGapMs > 0) {
        const gap = minGapMs - (now() - lastGrant);
        if (gap > 0) await sleep(gap);
        lastGrant = now();
      }
      return release;
    },
    get state() { return { active, queued: waiters.length, maxConcurrent, minGapMs }; },
  };
}
