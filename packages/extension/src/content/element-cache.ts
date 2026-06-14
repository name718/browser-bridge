/**
 * 请求级元素缓存
 *
 * getActionableElements() 在一次 MCP 请求中被调用 7+ 次，
 * 每次执行完整的 Shadow DOM 遍历。此缓存通过短 TTL 和 MutationObserver
 * 失效机制避免重复遍历。
 *
 * 失效边界：
 * - 每个 MCP 工具调用开始创建 request context，调用结束后清理
 * - click/type/scroll/hover/select/open/waitFor 等写操作后立即 invalidate
 * - resize、scroll、visibilitychange、MutationObserver 都触发失效
 * - iframe/shadow DOM 无法完整感知时以短 TTL 兜底
 */

type ElementCollector = (options?: { visibleOnly?: boolean; viewportOnly?: boolean }) => HTMLElement[];

/**
 * 请求级元素缓存
 *
 * 设计为单例，在 content.ts 中初始化。
 * Feature Flag 控制是否启用。
 */
export class RequestScopedElementCache {
  private entries = new Map<string, { elements: HTMLElement[]; timestamp: number }>();
  private timestamp = 0;
  private readonly ttl: number;
  private invalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private collector: ElementCollector | null = null;

  /**
   * @param ttl 缓存有效期（毫秒），默认 500ms
   */
  constructor(ttl = 500) {
    this.ttl = ttl;
  }

  /**
   * 初始化缓存，绑定元素收集器和 MutationObserver
   *
   * @param collectElements 获取所有可交互元素的函数
   */
  init(collectElements: ElementCollector): void {
    this.collector = collectElements;

    // MutationObserver 自动失效
    if (document.body) {
      this.observer = new MutationObserver(() => this.invalidate());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "disabled"],
      });
    }

    // 其他失效事件
    window.addEventListener("resize", () => this.invalidate());
    document.addEventListener("visibilitychange", () => this.invalidate());
  }

  /**
   * 获取缓存的元素列表
   *
   * 如果缓存有效则返回缓存，否则重新收集。
   */
  get(options: { visibleOnly?: boolean; viewportOnly?: boolean } = {}): HTMLElement[] {
    const key = JSON.stringify({
      visibleOnly: options.visibleOnly !== false,
      viewportOnly: options.viewportOnly === true
    });
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.timestamp > this.ttl) {
      this.entries.set(key, {
        elements: this.collector ? this.collector(options) : [],
        timestamp: Date.now()
      });
      this.timestamp = Date.now();
    }
    return this.entries.get(key)?.elements ?? [];
  }

  /**
   * 使缓存失效
   *
   * 带 debounce：避免高频 MutationObserver 回调导致缓存永远失效。
   */
  invalidate(): void {
    if (this.invalidateTimer) return;
    this.invalidateTimer = setTimeout(() => {
      this.invalidateNow();
      this.invalidateTimer = null;
    }, 100); // 100ms debounce
  }

  invalidateNow(): void {
    this.entries.clear();
  }

  /**
   * 销毁缓存，清理 Observer 和事件监听
   */
  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.invalidateTimer) {
      clearTimeout(this.invalidateTimer);
      this.invalidateTimer = null;
    }
    this.entries.clear();
  }
}

/**
 * 全局缓存实例
 *
 * 在 content.ts 中通过 Feature Flag 控制是否启用。
 */
export const elementCache = new RequestScopedElementCache();
