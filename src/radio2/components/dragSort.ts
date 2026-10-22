"use client";

/* 列表拖拽排序：对齐原站行为 —— 鼠标移动 5px 即进入排序，触摸需长按；
   排序中根节点加 dsorting（全局 grabbing 光标）、当前行加 .drag 高亮，
   指针靠近容器上下边缘时自动滚动，松手才提交顺序并吞掉随之而来的 click。 */

import { useCallback, useEffect, useRef, useState } from "react";

const EDGE = 44; // 距上下边缘多少像素开始自动滚动
const HOLD = 380; // 触摸长按判定（ms）
const SLOP_MOUSE = 5;
const SLOP_TOUCH = 8;

export interface DragSortResult {
  /** 排序中的行 key；null 表示没在拖 */
  dragKey: string | null;
  /** 排序过程中的实时顺序，渲染时优先用它 */
  order: string[];
  /** 绑定到每一行的 pointerdown */
  onRowDown: (key: string, e: React.PointerEvent) => void;
}

export function useDragSort(args: {
  keys: string[];
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  commit: (next: string[], from: number, to: number) => void;
}): DragSortResult {
  const { keys, enabled, containerRef, commit } = args;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(keys);

  const s = useRef<{
    key: string;
    id: number;
    x: number;
    y: number;
    py: number;
    mouse: boolean;
    on: boolean;
    timer: number;
    raf: number;
    base: string[];
  } | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const orderRef = useRef(keys);
  // 拖拽进行中保留实时顺序，否则跟随外部顺序
  if (!s.current) orderRef.current = keys;

  const stop = useCallback((apply: boolean) => {
    const st = s.current;
    if (!st) return;
    s.current = null;
    clearTimeout(st.timer);
    cancelAnimationFrame(st.raf);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    removeEventListener("touchmove", touchMove);
    const wasOn = st.on;
    if (wasOn) {
      document.documentElement.classList.remove("dsorting");
      setDragKey(null);
      const from = st.base.indexOf(st.key);
      const to = orderRef.current.indexOf(st.key);
      setOrder(keysRef.current);
      if (apply && from >= 0 && to >= 0 && from !== to) {
        commitRef.current(orderRef.current, from, to);
      }
    }
    // 长按/拖拽结束后浏览器仍会派发 click，吞掉它避免误触换台
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    addEventListener("click", swallow, true);
    setTimeout(() => removeEventListener("click", swallow, true), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollTick = useCallback(() => {
    const st = s.current;
    const box = containerRef.current;
    if (!st || !st.on || !box) return;
    const r = box.getBoundingClientRect();
    let d = 0;
    if (st.py < r.top + EDGE) d = -Math.ceil((r.top + EDGE - st.py) / 4);
    else if (st.py > r.bottom - EDGE) d = Math.ceil((st.py - (r.bottom - EDGE)) / 4);
    if (d) box.scrollTop += d;
    // 指针落在哪一行，就把拖拽行挪到那一行的位置（挪完后指针即落在自己身上，不会来回抖）
    const rows = Array.from(box.querySelectorAll<HTMLElement>("[data-dkey]"));
    const cur = orderRef.current;
    const from = cur.indexOf(st.key);
    if (from < 0) return;
    for (const row of rows) {
      const k = row.dataset.dkey;
      if (!k || k === st.key) continue;
      const rr = row.getBoundingClientRect();
      if (st.py < rr.top || st.py > rr.bottom) continue;
      const to = cur.indexOf(k);
      if (to >= 0 && to !== from) {
        const next = cur.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        orderRef.current = next;
        setOrder(next);
      }
      break;
    }
    st.raf = requestAnimationFrame(scrollTick);
  }, [containerRef]);

  const activate = useCallback(() => {
    const st = s.current;
    if (!st || st.on) return;
    st.on = true;
    document.documentElement.classList.add("dsorting");
    setDragKey(st.key);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* 不支持振动的设备忽略 */
    }
    scrollTick();
  }, [scrollTick]);

  const cancel = useCallback(() => {
    const st = s.current;
    if (!st) return;
    st.on = false;
    stop(false);
  }, [stop]);

  // —— 事件处理器需保持稳定引用，用普通函数挂在 ref 上 ——
  const handlers = useRef<{
    move?: (e: PointerEvent) => void;
    up?: (e: PointerEvent) => void;
    touchMove?: (e: TouchEvent) => void;
  }>({});
  handlers.current.move = (e: PointerEvent) => {
    const st = s.current;
    if (!st || e.pointerId !== st.id) return;
    st.py = e.clientY;
    if (!st.on) {
      const d = Math.hypot(e.clientX - st.x, e.clientY - st.y);
      if (st.mouse) {
        if (d > SLOP_MOUSE) activate();
      } else if (d > SLOP_TOUCH) cancel();
    }
  };
  handlers.current.up = (e: PointerEvent) => {
    const st = s.current;
    if (st && e.pointerId === st.id) stop(e.type === "pointerup");
  };
  handlers.current.touchMove = (e: TouchEvent) => {
    if (s.current?.on) e.preventDefault();
  };

  const move = useCallback((e: PointerEvent) => handlers.current.move?.(e), []);
  const up = useCallback((e: PointerEvent) => handlers.current.up?.(e), []);
  const touchMove = useCallback((e: TouchEvent) => handlers.current.touchMove?.(e), []);

  useEffect(() => () => stop(false), [stop]);

  // 未在拖拽时，实时顺序跟随外部列表（初始为空数组的那次渲染也要跟上）
  useEffect(() => {
    if (!s.current) setOrder(keys);
  }, [keys]);

  const onRowDown = useCallback(
    (key: string, e: React.PointerEvent) => {
      if (!enabled || e.button > 0 || s.current) return;
      const mouse = e.pointerType === "mouse";
      const st = {
        key,
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        py: e.clientY,
        mouse,
        on: false,
        timer: 0,
        raf: 0,
        base: keysRef.current,
      };
      s.current = st;
      setOrder(keysRef.current);
      st.timer = mouse ? 0 : window.setTimeout(activate, HOLD);
      addEventListener("pointermove", move, { passive: false });
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
      addEventListener("touchmove", touchMove, { passive: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, activate],
  );

  return { dragKey, order: enabled ? order : keys, onRowDown };
}
