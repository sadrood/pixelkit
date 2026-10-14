/**
 * QuoridorLLMAI — 大模型人机对战客户端
 *
 * 大模型的出招由服务端 /api/agent/quoridor-move 完成：
 *   服务端调用大模型 → 引擎校验合法性 → 非法/异常自动回退首个合法着法。
 * 前端只负责把棋盘状态发给服务端，并把返回的动作交给引擎执行。
 */
export class QuoridorLLMAI {
  /**
   * @param {import('./QuoridorEngine.js').QuoridorEngine} engine
   * @param {number} playerIndex
   * @returns {Promise<{type:'move'|'fence', col, row, dir?}|null>}
   */
  async chooseAction(engine, playerIndex) {
    const resp = await fetch('/api/agent/quoridor-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: engine.toState() }),
    });
    if (!resp.ok) {
      throw new Error(`大模型服务异常 (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    return data?.move || null;
  }
}
