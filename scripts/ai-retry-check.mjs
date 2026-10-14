#!/usr/bin/env node
/**
 * 上游限流/重试工具的回归自检。
 *
 * 用法：
 *   node scripts/ai-retry-check.mjs          # 离线单测（不联网、不烧额度）
 *   node scripts/ai-retry-check.mjs --live   # 额外打真实网关，验证退避与恢复（会消耗配额）
 *
 * 背景见 lib/ai-retry.js 顶部注释。离线部分覆盖的正是"改了却看不出坏"的地方：
 * 分钟边界对齐、retry-after 优先级与上限、熔断阈值、并发闸门。
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isQuotaText, isMinuteQuotaText, isRpsQuotaText, backoffMs, msToNextMinute, parseRetryAfterMs,
  quotaWaitMs, createBreaker, createPacer, describeWait,
} from '../lib/ai-retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

/* ---------- ① 真实错误体识别（取自 2026-09-12 网关实测响应） ---------- */
section('① 限流错误识别（用网关真实返回体）');
const TPM_BODY = '{"error":{"message":"inference exceeds tpm/rpm limit","type":"rate_limit_error","code":"insufficient_quota"}}';
const RPM_BODY = '{"error":{"message":"rpm exhausted","type":"quota_exceeded_error","code":"8"}}';
const RPS_BODY = '{"error":{"message":"rps exhausted","type":"quota_exceeded_error","code":"8"}}';
ok(isQuotaText(TPM_BODY), 'tpm/rpm 变体识别为限流');
ok(isQuotaText(RPM_BODY), 'rpm exhausted 识别为限流');
ok(isQuotaText('HTTP 429'), '裸 429 识别为限流');
ok(isMinuteQuotaText(TPM_BODY) && isMinuteQuotaText(RPM_BODY), '两种变体都判为分钟级配额');
ok(!isQuotaText('invalid api key'), '鉴权错误不会被误判为限流');
ok(!isMinuteQuotaText('502 bad gateway'), '502 不触发分钟对齐（只走普通退避）');
// 每秒级(RPS)：网关真实存在，必须与分钟级区分开（实测预检+正式请求背靠背会撞它）
ok(isRpsQuotaText(RPS_BODY) && isQuotaText(RPS_BODY), 'rps exhausted 识别为限流·每秒级');
ok(!isMinuteQuotaText(RPS_BODY), 'rps 不会被误判成分钟窗口（否则会白等一分钟）');
{
  const w = quotaWaitMs({ attempt: 0, errText: RPS_BODY });
  ok(w >= 1000 && w <= 6000, `rps 只等 1~2 秒就重试（${describeWait(w)}）`);
}

/* ---------- ② 退避与分钟对齐 ---------- */
section('② 退避与分钟边界对齐');
{
  const t = 1_700_000_000_000 - (1_700_000_000_000 % 60000);   // 对齐到整分钟
  const early = quotaWaitMs({ attempt: 0, errText: TPM_BODY, now: t + 5000 });    // 分钟内第 5s
  const late = quotaWaitMs({ attempt: 0, errText: TPM_BODY, now: t + 58000 });    // 分钟内第 58s
  ok(early >= 50000 && early <= 65000, `分钟初段等到窗口结束（${describeWait(early)}）`);
  ok(late < 10000, `临近边界只等一会儿（${describeWait(late)}）`);
  ok(msToNextMinute(t + 58000, 0) === 2000, 'msToNextMinute 计算正确');

  const ra = quotaWaitMs({ attempt: 0, errText: TPM_BODY, retryAfterMs: 30000, now: t + 5000 });
  ok(ra === 30000, `retry-after 优先于分钟对齐（${describeWait(ra)}）`);
  const raCap = quotaWaitMs({ attempt: 0, errText: TPM_BODY, retryAfterMs: 120000, now: t + 5000 });
  ok(raCap === 65000, `retry-after 超长时被上限截断（${describeWait(raCap)}）`);

  const plain = quotaWaitMs({ attempt: 0, errText: '502 bad gateway', now: t + 5000 });
  ok(plain < 10000, `非分钟级错误不触发分钟对齐（${describeWait(plain)}）`);

  const b0 = backoffMs(0, { baseMs: 1000, quota: false, jitter: 0 });
  const b1 = backoffMs(1, { baseMs: 1000, quota: false, jitter: 0 });
  const bq = backoffMs(0, { baseMs: 1000, quota: true, jitter: 0 });
  ok(b1 === b0 * 2, '指数退避按 2 次方增长');
  ok(bq === b0 * 3, '限流类退避起点 ×3');
}

/* ---------- ③ retry-after 头解析 ---------- */
section('③ retry-after 头解析');
const hdr = (v) => ({ get: (k) => (String(k).toLowerCase() === 'retry-after' ? v : null) });
ok(parseRetryAfterMs(hdr('30')) === 30000, '秒数形式');
ok(parseRetryAfterMs(hdr('0')) === null, '0 视为无效');
ok(parseRetryAfterMs(hdr(new Date(Date.now() + 20000).toUTCString())) > 15000, 'HTTP 日期形式');
ok(parseRetryAfterMs({ get: () => null }) === null, '没有该头时返回 null —— 这正是本网关的实际情况');

/* ---------- ④ 熔断器 ---------- */
section('④ 熔断器');
{
  let nowMs = 1_000_000;
  const br = createBreaker({ threshold: 3, cooldownMs: 60000, now: () => nowMs });
  ok(br.check().ok, '初始为闭合');
  br.fail(); br.fail();
  ok(br.check().ok, '未到阈值仍然放行');
  ok(br.fail() === true, '第 3 次失败触发熔断');
  const open = br.check();
  ok(!open.ok && open.retryAfterMs === 60000, `熔断期内拒绝并给出剩余时间（${open.retryAfterMs}ms）`);
  nowMs += 61000;
  ok(br.check().ok, '冷却结束自动半开');
  br.ok();
  ok(br.state.failures === 0, '成功后计数清零');
}

/* ---------- ⑤ 并发闸门 ---------- */
section('⑤ 并发闸门');
{
  const pacer = createPacer({ maxConcurrent: 2 });
  const p1 = pacer.acquire(), p2 = pacer.acquire(), p3 = pacer.acquire();
  const r1 = await p1, r2 = await p2;                    // 前两个拿到名额
  ok(pacer.state.active === 2 && pacer.state.queued === 1, `最多 2 个在飞、第 3 个排队（active=${pacer.state.active}, queued=${pacer.state.queued}）`);
  r1();                                                  // 释放一个
  const r3 = await p3;
  ok(pacer.state.active === 2, '释放后排队者被放行');
  r2(); r3();
}
// 最小间隔：两次上游调用不能背靠背（防 rps exhausted）
{
  const pacer = createPacer({ maxConcurrent: 2, minGapMs: 300 });
  const t0 = Date.now();
  const r1 = await pacer.acquire();
  await pacer.acquire();
  const gap = Date.now() - t0;
  ok(gap >= 290, `两次 acquire 之间至少隔 ${300}ms（实测 ${gap}ms）`);
  r1();
}

/* ---------- ⑥ server.js 真的接上了这套逻辑 ---------- */
section('⑥ server.js 接线检查（静态文本断言）');
{
  const src = readFileSync(path.join(repo, 'server.js'), 'utf8');
  ok(src.includes("from './lib/ai-retry.js'"), 'server.js 已 import 工具模块');
  ok(src.includes('AI_QUOTA_BREAKER') && src.includes('AI_PACER'), '熔断器与闸门已实例化');
  ok(/handleQuotaHit\(\{[^}]*label: 'book-ai'/.test(src), 'book-ai 两条链路都走 handleQuotaHit');
  ok(src.includes('armStall'), '流式已改用断流看门狗（替代 40s 总超时）');
  ok(!/Math\.pow\(2, attempt\) \* 500/.test(src), '旧的秒级退避已全部替换');
  ok(src.includes('retryAfterMs: Math.round'), '错误响应里带上了 retryAfterMs');
}

/* ---------- ⑦ 可选：真实网关压测 ---------- */
if (process.argv.includes('--live')) {
  section('⑦ 真实网关压测（--live）');
  const envPath = process.env.PK_ENV || path.join(repo, '.env');
  if (!existsSync(envPath)) { console.log(`  ! 找不到 ${envPath}，跳过`); }
  else {
    const env = readFileSync(envPath, 'utf8');
    const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
    const baseUrl = pick('OPENAI_BASE_URL') || 'https://token.sensenova.cn/v1';
    const model = pick('OPENAI_MODEL') || 'deepseek-v4-flash';
    const keys = (pick('MAIN_KEY_POOL') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!keys.length) { console.log('  ! .env 里没有 MAIN_KEY_POOL，跳过'); }
    else {
      const burst = Number(process.env.PK_BURST || 4);
      console.log(`  端点 ${baseUrl}  模型 ${model}  key 数 ${keys.length}  并发 ${burst}`);
      let saw429 = 0, sawRetryAfter = 0, succeeded = 0;
      const one = async (i) => {
        const key = keys[i % keys.length];
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: '回一个字：好' }], max_tokens: 4, reasoning_effort: 'none' }),
          signal: AbortSignal.timeout(30000),
        }).catch((e) => ({ status: 'ERR', headers: { get: () => null }, text: async () => e.message }));
        const body = await res.text().catch(() => '');
        if (res.status === 'ERR') return { status: 'ERR', body };
        if (parseRetryAfterMs(res.headers)) sawRetryAfter++;
        if (res.status === 429) { saw429++; return { status: 429, body, wait: quotaWaitMs({ attempt: 0, errText: body, retryAfterMs: parseRetryAfterMs(res.headers) }) }; }
        if (res.ok) succeeded++;
        return { status: res.status, body };
      };
      const rs = await Promise.all(Array.from({ length: burst }, (_, i) => one(i)));
      rs.forEach((r, i) => console.log(`   #${i} -> ${r.status}${r.wait ? `  建议等待 ${describeWait(r.wait)}` : ''} ${r.status === 429 ? r.body.slice(0, 80) : ''}`));
      console.log(`  汇总：成功 ${succeeded} / 429 ${saw429} / 带 retry-after ${sawRetryAfter}`);
      ok(sawRetryAfter === 0 ? true : true, '记录：本网关' + (sawRetryAfter ? '本次出现了 retry-after（应优先采用）' : '本次仍未返回 retry-after（故必须靠分钟对齐）'));
    }
  }
}

console.log(`\n=========== 汇总 ===========\n  通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
