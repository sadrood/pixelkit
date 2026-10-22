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
  style.textContent = cssText;
  shadow.appendChild(style);

  // React 挂载点
  const mountEl = document.createElement('div');
  mountEl.setAttribute('data-roamdial-app', '1');
  mountEl.style.cssText = 'position:absolute;inset:0;';
  shadow.appendChild(mountEl);

  const root = createRoot(mountEl);
  root.render(<Workspace />);
  console.log('[radio2] RoamDial 复刻已挂载（Shadow DOM）');
  return () => { try { root.unmount(); } catch { /* ignore */ } };
}
