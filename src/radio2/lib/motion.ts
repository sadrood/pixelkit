/* CSS 侧的 prefers-reduced-motion 已在 globals.css 里逐字移植，
   这里给 canvas 动画用：JS 驱动的地球自转与唱片动画要自己判断。
   结果缓存住，渲染循环里每帧读取不产生 matchMedia 分配。 */

let cached = false;

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  cached = mq.matches;
  mq.addEventListener?.("change", (e) => {
    cached = e.matches;
  });
}

export function reducedMotion(): boolean {
  return cached;
}
