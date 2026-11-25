const api = require("../config/api");
const { delivery } = require("../config/delivery");

// A page owns visibility; this module owns the single request for this process.
const pages = new Set();
let state = null;
let label = "";
const clean = (value) => String(value || "request:fail")
  .replace(/https?:\/\/\S+/g, "[测试地址]")
  .replace(/[\r\n\t]+/g, " ").slice(0, 240);
const errorDetail = (error = {}) => `${clean(error.errMsg || error.message)}${Number.isFinite(error.errno) ? `（errno ${error.errno}）` : ""}`;
const sdkCode = (message) => {
  if (/domain.*(?:list|valid)|url.*domain|合法域名/i.test(message)) return "SDK_DOMAIN";
  if (/timed?\s*out|timeout/i.test(message)) return "SDK_TIMEOUT";
  if (/ssl|tls|certificate|证书/i.test(message)) return "SDK_TLS";
  if (/dns|resolve|name.*resolution/i.test(message)) return "SDK_DNS";
  if (/abort|cancel/i.test(message)) return "SDK_ABORT";
  return "SDK_FAILURE";
};
const render = (page) => {
  if (state) page.setData({ deliveryLabel: label, trialDiagnostic: { ...state } });
};
const publish = (patch) => {
  state = { ...state, ...patch };
  pages.forEach(render);
};

const startOnce = () => {
  if (state) return;
  let envVersion = "unknown", environmentError = "", baseUrl = "", targetError = "";
  try {
    const info = wx.getAccountInfoSync();
    envVersion = info && info.miniProgram && info.miniProgram.envVersion || "unknown";
  } catch (error) { environmentError = errorDetail(error); }
  try { baseUrl = api.getApiBaseUrl(); }
  catch (error) { targetError = errorDetail(error); }
  // The frozen overlay identifies a preview even if its runtime lookup fails.
  // Ordinary production routing remains silent and never probes staging.
  if (!api.isPinnedStagingPreview && !(envVersion === "develop" && baseUrl === delivery.apiBaseUrl)) return;
  label = `${delivery.displayId} · 目标 staging · 后端 ${delivery.knownServerSource}（未联合验收）`;
  state = { visible: true, phase: "blocked", envVersion, code: "", message: "", detail: "" };
  if (environmentError || envVersion === "unknown") {
    publish({ code: "ENV_UNAVAILABLE", message: "无法读取运行环境，未发送探测。", detail: environmentError });
    return;
  }
  if (envVersion !== "develop" && !(api.isPinnedStagingTrial === true && envVersion === "trial")) {
    publish({ code: "ENV_NOT_DEVELOP", message: "当前不是允许的隔离测试渠道，未发送探测。" });
    return;
  }
  if (targetError || baseUrl !== delivery.apiBaseUrl) {
    publish({ code: "TARGET_MISMATCH", message: "测试目标不一致，未发送探测。", detail: targetError });
    return;
  }
  publish({ phase: "pending", code: "PENDING", message: "正在检查测试站连接…" });
  const finish = (patch) => { if (state.phase === "pending") publish({ phase: "done", ...patch }); };
  try {
    wx.request({
      url: delivery.apiBaseUrl + "/api/health?trial_probe=wx-mini-ui33-20261030-9a62fcd81b04&env=" + encodeURIComponent(envVersion),
      method: "GET",
      timeout: 5000,
      success: (response) => finish({ code: "HTTP_" + response.statusCode, message: `测试站返回 HTTP ${response.statusCode}。`, detail: "此结果不表示已登录。" }),
      fail: (error = {}) => finish({ code: sdkCode(String(error.errMsg || "")), message: "连接探测失败。", detail: errorDetail(error) })
    });
  } catch (error) {
    finish({ code: "SDK_THROW", message: "探测未能启动。", detail: errorDetail(error) });
  }
};

const attach = (page) => {
  pages.add(page);
  startOnce();
  render(page);
};
const detach = (page) => { pages.delete(page); };

module.exports = { attach, detach };
