const API_ENV_KEY = "xinqing_api_env";
const API_BASE_URL_KEY = "xinqing_api_base_url";

const API_BASE_URLS = {
  local: "",
  lan: "",
  trial: "https://xinqing.studio",
  production: "https://xinqing.studio"
};

const DEFAULT_API_ENV = "trial";

const getStorageValue = (key) => {
  try {
    return wx.getStorageSync(key) || "";
  } catch {
    return "";
  }
};

const getApiBaseUrl = () => {
  const override = getStorageValue(API_BASE_URL_KEY);
  if (override) return override;

  const env = getStorageValue(API_ENV_KEY) || DEFAULT_API_ENV;
  return API_BASE_URLS[env] || "";
};

module.exports = {
  API_BASE_URL_KEY,
  API_BASE_URLS,
  API_ENV_KEY,
  DEFAULT_API_ENV,
  getApiBaseUrl
};
