/**
 * PixelKit - 计时工具（秒表 + 倒计时）
 */
export class TimerPage {
  constructor(toast) {
    this.toast = toast;
    this._inited = false;
    this.mode = 'stopwatch';
    this.running = false;
    this.startTime = 0;
    this.elapsed = 0;
    this.timerId = null;
    this.laps = [];
    this.countdownTotal = 0;
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    const root = document.getElementById('timer-root');
    if (!root) return;
    root.innerHTML = this.render();
    this.bindEvents();
    this.tick();
  }

  render() {
    return `
      <div class="timer-container">
        <div class="timer-tabs">
          <button class="timer-tab active" data-mode="stopwatch">⏱ 秒表</button>
          <button class="timer-tab" data-mode="countdown">⏲ 倒计时</button>
        </div>
        <div class="timer-display" id="timer-display">00:00.00</div>
        <div class="timer-controls" id="timer-controls">
          <button class="btn btn-primary timer-btn" id="timer-start">▶ 开始</button>
          <button class="btn timer-btn" id="timer-lap" disabled>🏁 计次</button>
          <button class="btn timer-btn" id="timer-reset">↺ 重置</button>
        </div>
        <div class="timer-countdown-setup" id="timer-cd-setup" style="display:none;">
          <div class="timer-cd-inputs">
            <div class="timer-cd-field"><input type="number" id="cd-min" min="0" max="99" value="5" placeholder="分"><span>分</span></div>
            <div class="timer-cd-field"><input type="number" id="cd-sec" min="0" max="59" value="0" placeholder="秒"><span>秒</span></div>
          </div>
        </div>
        <div class="timer-laps" id="timer-laps"></div>
      </div>`;
  }

  bindEvents() {
    document.querySelectorAll('.timer-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.stop();
        document.querySelectorAll('.timer-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.mode = tab.dataset.mode;
        this.elapsed = 0;
        this.laps = [];
        document.getElementById('timer-display').textContent = '00:00.00';
        document.getElementById('timer-laps').innerHTML = '';
        document.getElementById('timer-cd-setup').style.display = this.mode === 'countdown' ? '' : 'none';
        document.getElementById('timer-start').textContent = '▶ 开始';
        document.getElementById('timer-lap').disabled = true;
      });
    });

    document.getElementById('timer-start').addEventListener('click', () => this.toggle());
    document.getElementById('timer-lap').addEventListener('click', () => this.lap());
    document.getElementById('timer-reset').addEventListener('click', () => this.reset());
  }

  formatTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const c = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }

  tick() {
    if (!this.running) {
      this.rafId = null;
      return;
    }
    const now = performance.now();
    const delta = now - this.startTime + this.elapsed;
    if (this.mode === 'countdown') {
      const remaining = Math.max(0, this.countdownTotal - delta);
      document.getElementById('timer-display').textContent = this.formatTime(remaining);
      if (remaining <= 0) {
        this.stop();
        this.toast?.show('⏰ 时间到！', 'success');
        document.getElementById('timer-display').textContent = '00:00.00';
        document.getElementById('timer-start').textContent = '▶ 开始';
        return;
      }
    } else {
      document.getElementById('timer-display').textContent = this.formatTime(delta);
    }
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  toggle() {
    if (this.running) {
      this.stop();
      document.getElementById('timer-start').textContent = '▶ 继续';
      document.getElementById('timer-lap').disabled = true;
    } else {
      this.start();
      document.getElementById('timer-start').textContent = '⏸ 暂停';
      document.getElementById('timer-lap').disabled = false;
    }
  }

  start() {
    this.startTime = performance.now();
    this.elapsed = this.elapsed;
    if (this.mode === 'countdown' && this.elapsed === 0) {
      const min = parseInt(document.getElementById('cd-min').value) || 0;
      const sec = parseInt(document.getElementById('cd-sec').value) || 0;
      this.countdownTotal = (min * 60 + sec) * 1000;
      if (this.countdownTotal <= 0) { this.toast?.show('请设置时间', 'error'); return; }
    }
    this.running = true;
    if (!this.rafId) this.rafId = requestAnimationFrame(() => this.tick());
  }

  stop() {
    if (this.running) {
      this.elapsed += performance.now() - this.startTime;
      this.running = false;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  reset() {
    this.stop();
    this.elapsed = 0;
    this.laps = [];
    this.countdownTotal = 0;
    document.getElementById('timer-display').textContent = '00:00.00';
    document.getElementById('timer-laps').innerHTML = '';
    document.getElementById('timer-start').textContent = '▶ 开始';
    document.getElementById('timer-lap').disabled = true;
  }

  lap() {
    if (!this.running) return;
    const now = performance.now();
    const total = now - this.startTime + this.elapsed;
    this.laps.unshift(total);
    const fastest = Math.min(...this.laps);
    const html = this.laps.map((t, i) => `
      <div class="timer-lap-row">
        <span class="timer-lap-num">#${this.laps.length - i}</span>
        <span class="timer-lap-time">${this.formatTime(t)}</span>
        ${t === fastest && this.laps.filter(x => x === fastest).length === 1 ? '<span class="timer-lap-diff">🏆 最快</span>' : ''}
      </div>
    `).join('');
    document.getElementById('timer-laps').innerHTML = html;
  }
}
