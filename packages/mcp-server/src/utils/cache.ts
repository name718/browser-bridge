/**
 * 页面观察结果缓存
 *
 * 为 browser_get_page_model、browser_observe、browser_list_tabs 等
 * 高频只读工具提供短 TTL 缓存，写操作自动失效。
 */

export class ObservationCache {
  private cache = new Map<string, { data: unknown; time: number }>();
  private readonly ttl: number;

  /**
   * @param ttl 缓存有效期（毫秒），默认 2000ms
   */
  constructor(ttl = 2000) {
    this.ttl = ttl;
  }

  /**
   * 获取缓存值，过期返回 null
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < this.ttl) {
      return entry.data as T;
    }
    return null;
  }

  /**
   * 写入缓存
   */
  set(key: string, data: unknown): void {
    this.cache.set(key, { data, time: Date.now() });
  }

  /**
   * 清除所有缓存（任何写操作 click/type/scroll 后调用）
   */
  invalidate(): void {
    this.cache.clear();
  }

  /**
   * 清除特定 key 的缓存
   */
  invalidateKey(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 获取缓存统计信息
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
