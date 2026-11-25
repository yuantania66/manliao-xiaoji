// Dedicated isolated experience-build flag. Never selected by device storage.
const STAGING_TRIAL_BUILD = true;

const API_ENV_KEY = "xinqing_api_env";
const API_BASE_URL_KEY = "xinqing_api_base_url";

const API_BASE_URLS = {
  local: "http://127.0.0.1:3002",
  lan: "http://192.168.1.96:3002",
  trial: "https://manliaoxiaoji.com",
  prod: "https://manliaoxiaoji.com"
};

const getRuntimeVersion = () => {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (error) {
    return "release";
  }
};
const API_TIMEOUT = 15000;

const getStorageValue = (key) => {
  try {
    return wx.getStorageSync(key) || "";
  } catch (error) {
    return "";
  }
};

const getApiEnv = () => {
  if (getRuntimeVersion() !== "develop") return "prod";
  return getStorageValue(API_ENV_KEY) || "prod";
};

const getRuntimeEnvVersion = () => {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (error) {
    return "unknown";
  }
};

const getApiBaseUrl = () => {
  const env = getRuntimeEnvVersion();
  if (env !== "develop" && !(STAGING_TRIAL_BUILD && env === "trial")) return "";
  return "https://staging.manliaoxiaoji.com";
};

module.exports = {
  isPinnedStagingPreview: true,
  isPinnedStagingTrial: STAGING_TRIAL_BUILD,
  API_ENV_KEY,
  API_BASE_URL_KEY,
  API_BASE_URLS,
  API_TIMEOUT,
  getRuntimeEnvVersion,
  getApiEnv,
  getApiBaseUrl
};
