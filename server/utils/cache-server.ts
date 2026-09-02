/* eslint-disable @typescript-eslint/no-explicit-any */
import { LRUCache } from "lru-cache";

/**
 * 缓存条目：fresh（新鲜）与 stale（陈旧但可用）双过期
 * - age <= freshTtl  : 新鲜数据，直接返回
 * - age <= staleTtl  : 陈旧数据，先返回再后台刷新（SWR），或在上游故障时兜底
 */
interface CacheEntry<T> {
  value: T;
  storedAt: number;
  freshTtl: number;
}

const memoryCache = new LRUCache<string, CacheEntry<any>>({
  // 最大缓存条目数
  max: 100,
  // 条目最长保留时间（= 默认 stale 上限 24h）
  ttl: 1000 * 60 * 60 * 24,
});

/**
 * 并发请求合并：同一 key 的并发调用只执行一次 fn
 * 避免缓存过期瞬间多个请求同时打到上游（UptimeRobot 限流 10 req/min）
 */
const inflight = new Map<string, Promise<any>>();

export const dedupe = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/**
 * 获取新鲜缓存（未过期）
 */
export const getFresh = <T>(key: string): T | undefined => {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  const age = Date.now() - entry.storedAt;
  return age <= entry.freshTtl ? (entry.value as T) : undefined;
};

/**
 * 获取陈旧缓存（仅过期 fresh，仍在保留期内），用于 SWR 与故障兜底
 */
export const getStale = <T>(key: string): T | undefined => {
  const entry = memoryCache.get(key);
  return entry ? (entry.value as T) : undefined;
};

/**
 * 写入内存缓存
 * @param freshTtl 新鲜期（毫秒）
 * @param staleTtl 兜底保留期（毫秒），需 <= LRU 自身 ttl（24h）
 */
export const setCache = <T>(
  key: string,
  value: T,
  freshTtl: number,
  staleTtl = 1000 * 60 * 60 * 24,
): void => {
  void staleTtl;
  memoryCache.set(key, { value, storedAt: Date.now(), freshTtl });
};

export const deleteCache = (key: string): boolean => memoryCache.delete(key);

export const clearCache = (): void => memoryCache.clear();

/**
 * KV 持久缓存层（nitro data 存储）
 * - NuxtHub 部署时挂载到 Cloudflare KV，跨 isolate 持久有效
 * - 其他平台退化为内存驱动（无害），核心缓存逻辑不受影响
 */
const KV_MOUNT = "data";

/**
 * 读取 KV（返回 { value, storedAt } 结构或 undefined）
 */
export const kvGet = async <T>(
  key: string,
): Promise<{ value: T; storedAt: number } | undefined> => {
  try {
    const entry = await useStorage(KV_MOUNT).getItem(key);
    if (!entry?.storedAt) return undefined;
    return entry as { value: T; storedAt: number };
  } catch {
    return undefined;
  }
};

/**
 * 写入 KV（静默失败，KV 不可用时不影响主流程）
 */
export const kvSet = async (key: string, value: any): Promise<void> => {
  try {
    await useStorage(KV_MOUNT).setItem(key, { value, storedAt: Date.now() });
  } catch {
    // ignore
  }
};
