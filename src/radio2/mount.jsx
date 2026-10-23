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
@media (max-width:560px){
  .hints, .hint, .ann { display:none !important; }
  .rd-back { left:12px !important; top:56px !important; transform:none !important; width:34px !important; height:34px !important; padding:0 !important; font-size:0 !important; display:flex; align-items:center; justify-content:center; }
  .rd-back::after { content:'←'; font-size:17px; color:rgba(245,241,232,.8); }
  .rd-locate-btn { left:54px !important; top:56px !important; width:34px !important; height:34px !important; padding:0 !important; font-size:0 !important; display:flex; align-items:center; justify-content:center; }
  .rd-locate-btn::after { content:'📍'; font-size:15px; }
}`;
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

  // 定位并播放最近的电台
  if (!shadow.querySelector('.rd-locate-btn')) {
    const loc = document.createElement('button');
    loc.className = 'rd-locate-btn';
    loc.type = 'button';
    loc.textContent = '📍 听本地';
    loc.setAttribute('aria-label', '定位并播放附近电台');
    Object.assign(loc.style, {
      position: 'absolute', top: '14px', left: 'calc(50% + 74px)',
      zIndex: '20', padding: '7px 14px', borderRadius: '999px',
      border: '1px solid rgba(245,241,232,0.18)', background: 'rgba(16,31,29,0.55)',
      color: 'rgba(245,241,232,0.72)', font: '400 12px/1 Inter, "PingFang SC", sans-serif',
      letterSpacing: '0.02em', cursor: 'pointer', backdropFilter: 'blur(6px)',
      transition: 'color .2s, border-color .2s',
    });
    loc.addEventListener('mouseenter', () => { loc.style.color = '#f5f1e8'; loc.style.borderColor = 'rgba(245,241,232,0.45)'; });
    loc.addEventListener('mouseleave', () => { loc.style.color = 'rgba(245,241,232,0.72)'; loc.style.borderColor = 'rgba(245,241,232,0.18)'; });
    loc.addEventListener('click', () => {
      const finish = (lat, lon, source, city) => {
        try { localStorage.setItem('rd2.geo', JSON.stringify({ lat, lon, city: city || '', source, t: Date.now() })); } catch { /* ignore */ }
        loc.textContent = '📍 听本地';
        window.dispatchEvent(new CustomEvent('rd-locate', { detail: { lat, lon, source, city } }));
      };
      const fail = (msg) => {
        loc.textContent = '📍 听本地';
        window.dispatchEvent(new CustomEvent('rd-locate-error', { detail: { message: msg } }));
      };
      const ipLocate = async (silent) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch('/api/geo/locate', { cache: 'no-store' });
            const j = await r.json();
            if (j && j.success && isFinite(j.lat) && isFinite(j.lon)) { if (!silent) finish(j.lat, j.lon, 'ip', j.city || ''); return; }
            if (attempt === 1) { fail(j?.error || '定位失败'); return; }
          } catch {
            if (attempt === 1) { fail('网络定位失败'); return; }
          }
          await new Promise((r2) => setTimeout(r2, 1200));
        }
      };
      loc.textContent = '定位中…';
      // 24 小时内的上次定位：立即响应，同时后台刷新
      try {
        const cached = JSON.parse(localStorage.getItem('rd2.geo') || 'null');
        if (cached && Date.now() - cached.t < 86400000 && isFinite(cached.lat) && isFinite(cached.lon)) {
          finish(cached.lat, cached.lon, 'cache', cached.city || '');
          ipLocate(true);
          return;
        }
      } catch { /* ignore */ }
      // 浏览器 GPS 只在 HTTPS/localhost 下可用；HTTP 站点直接走 IP 定位
      const canGps = window.isSecureContext && !!navigator.geolocation;
      if (canGps) {
        navigator.geolocation.getCurrentPosition(
          (pos) => finish(pos.coords.latitude, pos.coords.longitude, 'gps', ''),
          () => { ipLocate(); },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
        );
      } else {
        ipLocate();
      }
    });
    shadow.appendChild(loc);
  }

  const root = createRoot(mountEl);
  root.render(<Workspace />);
  console.log('[radio2] 世界电台已挂载（Shadow DOM）');
  return () => { try { root.unmount(); } catch { /* ignore */ } };
}
