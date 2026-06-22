const API_ENV_KEY = "xinqing_api_env";
const API_BASE_URL_KEY = "xinqing_api_base_url";

const API_BASE_URLS = {
  local: "http://127.0.0.1:3002",
  lan: "http://192.168.1.96:3002",
  trial: "https://xinqing.studio",
  prod: "https://xinqing.studio"
};

const DEFAULT_API_ENV = "local";
const API_TIMEOUT = 15000;

const getStorageValue = (key) => {
  try {
    return wx.getStorageSync(key) || "";
  } catch (error) {
    return "";
  }
};

const getApiEnv = () => getStorageValue(API_ENV_KEY) || DEFAULT_API_ENV;

const getApiBaseUrl = () => {
  const override = getStorageValue(API_BASE_URL_KEY);
  if (override) return override;
  return API_BASE_URLS[getApiEnv()] || "";
};

module.exports = {
  API_ENV_KEY,
  API_BASE_URL_KEY,
  API_BASE_URLS,
  DEFAULT_API_ENV,
  API_TIMEOUT,
  getApiEnv,
  getApiBaseUrl
};
