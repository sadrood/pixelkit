import React from 'react';
import { createRoot } from 'react-dom/client';
import Workspace from './components/Workspace';
import cssText from './styles/roamdial-shadow.css?inline';

/**
 * 把 RoamDial 高清复刻挂载到 PixelKit 的 #page-radio，使用 Shadow DOM 隔离站点全局样式。
 */
export function mountRadio() {
  const page = document.getElementById('page-radio');
  if (!page) return null;

  let host = document.getElementById('roamdial-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'roamdial-root';
    page.appendChild(host);
  }

  let shadow = host.shadowRoot;
  if (!shadow) shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';

  // 字体（与源站一致：Inter / JetBrains Mono / Instrument Serif）
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = '/roamdial/fonts/fonts.css';
  shadow.appendChild(fontLink);

  // 样式（Shadow 内生效，外部站点 CSS 不影响）
  const style = document.createElement('style');
  style.textContent = cssText + `
/* mobile-hints: 手机上隐藏键盘快捷键提示，避免压住台名 */
@media (max-width:560px){ .hints, .hint { display:none !important; } }`;
  shadow.appendChild(style);

  // React 挂载点
  const mountEl = document.createElement('div');
  mountEl.setAttribute('data-roamdial-app', '1');
  mountEl.style.cssText = 'position:absolute;inset:0;';
  shadow.appendChild(mountEl);

  // 返回主站：派发 PixelKit 的页面跳转事件
  if (!shadow.querySelector('.rd-back')) {
    const back = document.createElement('button');
    back.className = 'rd-back';
    back.type = 'button';
    back.textContent = '← 返回主站';
    back.setAttribute('aria-label', '返回主站');
    Object.assign(back.style, {
      position: 'absolute', top: '14px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '20', padding: '7px 14px', borderRadius: '999px',
      border: '1px solid rgba(245,241,232,0.18)', background: 'rgba(16,31,29,0.55)',
      color: 'rgba(245,241,232,0.72)', font: '400 12px/1 Inter, "PingFang SC", sans-serif',
      letterSpacing: '0.02em', cursor: 'pointer', backdropFilter: 'blur(6px)',
      transition: 'color .2s, border-color .2s, background .2s',
    });
    back.addEventListener('mouseenter', () => { back.style.color = '#f5f1e8'; back.style.borderColor = 'rgba(245,241,232,0.45)'; });
    back.addEventListener('mouseleave', () => { back.style.color = 'rgba(245,241,232,0.72)'; back.style.borderColor = 'rgba(245,241,232,0.18)'; });
    back.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('pk-goto', { detail: 'home' }));
    });
    shadow.appendChild(back);
  }

  const root = createRoot(mountEl);
  root.render(<Workspace />);
  console.log('[radio2] 世界电台已挂载（Shadow DOM）');
  return () => { try { root.unmount(); } catch { /* ignore */ } };
}
