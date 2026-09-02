/**
 * Jump to a link.
 * @param url The link to jump to.
 */
export const jumpLink = (url: string) => window.open(url, "_blank");

/**
 * Format a number.
 * @param num The number to format.
 * @returns The formatted number.
 */
export const formatNumber = (num: number) => Math.floor(num * 100) / 100;

/**
 * Sleep for a certain amount of time.
 * @param ms The amount of time to sleep in milliseconds.
 */
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get site data.
 * @param silent 静默刷新：已有数据时后台拉取，保留旧数据展示且不打扰用户
 */
export const getSiteData = async (silent = false) => {
  const statusStore = useStatusStore();
  try {
    if (!silent) statusStore.siteStatus = "loading";
    const result = await $fetch("/api/getMonitors", { method: "POST" });
    if (result.code !== 200 || !result.data) {
      throw new Error("Error to get site data");
    }
    // 更改数据
    const { status } = result.data;
    statusStore.$patch({
      siteData: result.data,
      siteStatus:
        status.count === status.ok
          ? "normal"
          : status.count === status.error
            ? "error"
            : "warn",
    });
  } catch (error) {
    console.error("error to get site data", error);
    // 静默刷新失败时保留旧数据，避免闪错误提示
    if (!silent) {
      statusStore.siteStatus = "unknown";
      window.$message.error("站点数据获取失败，请重试");
    }
  }
};
