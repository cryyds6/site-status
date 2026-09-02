// https://uptimerobot.com/api/#methods
import dayjs from "dayjs";
import {
  dedupe,
  getFresh,
  getStale,
  kvGet,
  kvSet,
  setCache,
} from "../utils/cache-server";
import { formatSiteData } from "~/utils/format";
import type { MonitorsDataResult, MonitorsResult } from "~~/types/main";

// 缓存键
const CACHE_KEY = "site-data";
// 新鲜期：1 分钟内直接返回缓存
const FRESH_TTL = 1000 * 60;
// 兜底保留期：24 小时内的旧数据可在上游故障时返回
const STALE_TTL = 1000 * 60 * 60 * 24;
// 上游请求超时
const UPSTREAM_TIMEOUT = 10000;

const getRanges = ():
  | {
      dates: dayjs.Dayjs[];
      start: number;
      end: number;
      ranges: string;
    }
  | undefined => {
  try {
    const dates = [];
    const config = useRuntimeConfig();
    const days = config.public.countDays;
    const today = dayjs(new Date().setHours(0, 0, 0, 0));
    // 生成日期范围数组
    for (let d = 0; d < days; d++) dates.push(today.subtract(d, "day"));
    // 生成自定义历史数据范围
    const ranges = dates.map(
      (date) => `${date.unix()}_${date.add(1, "day").unix()}`,
    );
    const start = dates[dates.length - 1].unix();
    const end = dates[0].add(1, "day").unix();
    ranges.push(`${start}_${end}`);
    return { dates, start, end, ranges: ranges.join("-") };
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

/**
 * 获取站点数据
 */
export default defineEventHandler(async (event): Promise<MonitorsResult> => {
  // 从上游拉取最新数据（写入两级缓存）
  const fetchUpstream = async (): Promise<MonitorsDataResult> => {
    const config = useRuntimeConfig();
    const { apiUrl, apiKey } = config;
    if (!apiUrl || !apiKey) throw new Error("Missing API url or API key");
    const rangesData = getRanges();
    if (!rangesData) throw new Error("Missing");
    const { dates, ranges, start, end } = rangesData;
    // 构造请求体
    const body = {
      // API key
      api_key: apiKey,
      // json
      format: "json",
      // 显示日志
      logs: 1,
      // 日志类型
      log_types: "1-2",
      // 日期范围
      logs_start_date: start,
      logs_end_date: end,
      custom_uptime_ranges: ranges,
    };
    const result = await $fetch(apiUrl + "getMonitors", {
      method: "POST",
      body,
      timeout: UPSTREAM_TIMEOUT,
    });
    const data = formatSiteData(result, dates);
    setCache(CACHE_KEY, data, FRESH_TTL, STALE_TTL);
    void kvSet(CACHE_KEY, data);
    return data;
  };

  try {
    const config = useRuntimeConfig();
    const { sitePassword, siteSecretKey } = config;
    // 若登录-验证 token
    if (sitePassword && siteSecretKey) {
      const token = getCookie(event, "authToken");
      if (!token) throw new Error("Please log in first");
      // 验证 Token
      const isLogin = await verifyJwt(token);
      if (!isLogin) throw new Error("Invalid or expired token");
    }

    // 1. 新鲜缓存：直接返回
    const fresh = getFresh<MonitorsDataResult>(CACHE_KEY);
    if (fresh) {
      return { code: 200, message: "success", source: "cache", data: fresh };
    }

    // 2. KV 缓存：Cloudflare isolate 内存缓存会随请求销毁，KV 是可靠的跨请求层
    const kvEntry = await kvGet<MonitorsDataResult>(CACHE_KEY);
    if (kvEntry) {
      const age = Date.now() - kvEntry.storedAt;
      setCache(CACHE_KEY, kvEntry.value, FRESH_TTL, STALE_TTL);
      if (age <= FRESH_TTL) {
        return {
          code: 200,
          message: "success",
          source: "cache",
          data: kvEntry.value,
        };
      }
      // 陈旧：立即返回旧数据，后台静默刷新（SWR）
      void dedupe(CACHE_KEY, fetchUpstream).catch((error) =>
        console.error("background refresh failed:", error),
      );
      return {
        code: 200,
        message: "success",
        source: "stale",
        data: kvEntry.value,
      };
    }

    // 3. 内存陈旧缓存：立即返回 + 后台刷新
    const stale = getStale<MonitorsDataResult>(CACHE_KEY);
    if (stale) {
      void dedupe(CACHE_KEY, fetchUpstream).catch((error) =>
        console.error("background refresh failed:", error),
      );
      return { code: 200, message: "success", source: "stale", data: stale };
    }

    // 4. 无任何缓存：等待拉取（并发请求自动合并，只打一次上游）
    const data = await dedupe(CACHE_KEY, fetchUpstream);
    return { code: 200, message: "success", source: "api", data };
  } catch (error) {
    // 5. 上游故障兜底：返回保留期内的旧数据，避免整页报错
    const fallback =
      getStale<MonitorsDataResult>(CACHE_KEY) ??
      (await kvGet<MonitorsDataResult>(CACHE_KEY))?.value;
    if (fallback) {
      return { code: 200, message: "success", source: "stale", data: fallback };
    }
    setResponseStatus(event, 500);
    return {
      code: 500,
      message: error instanceof Error ? error.message : "Unknown error",
      source: "api",
      data: undefined,
    };
  }
});
