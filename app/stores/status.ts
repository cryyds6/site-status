import { defineStore } from "pinia";
import type { MonitorsDataResult, SiteLangType, SiteType } from "~~/types/main";

export const useStatusStore = defineStore(
  "status",
  () => {
    // 登录状态
    const loginStatus = ref<boolean>(false);
    // 站点状态
    const siteStatus = ref<SiteType>("loading");
    // 站点数据
    const siteData = ref<MonitorsDataResult>();
    // 滚动高度
    const scrollTop = ref<number>(0);
    // 站点语言
    const siteLang = ref<SiteLangType>("zh-CN");

    return { loginStatus, siteStatus, siteData, scrollTop, siteLang };
  },
  {
    persist: {
      storage: piniaPluginPersistedstate.localStorage(),
      // 持久化站点数据：再次打开时先秒显上次数据，再静默拉取最新
      pick: ["siteLang", "siteData"],
    },
  },
);
