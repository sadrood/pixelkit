/**
 * Toast - 消息提示组件
 */
export class Toast {
  constructor(element) {
    this.element = element;
    this.timer = null;
    // 暴露到全局给 ExportManager 使用
    window._toastInstance = this;
  }

  show(message, type = '') {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.element.textContent = message;
    this.element.className = 'toast show ' + type;

    this.timer = setTimeout(() => {
      this.element.classList.remove('show');
      this.timer = null;
    }, 2500);
  }

  hide() {
    if (this.timer) clearTimeout(this.timer);
    this.element.className = 'toast';
    this.timer = null;
  }
}
