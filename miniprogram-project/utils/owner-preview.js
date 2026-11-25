const api = require("../config/api");
const STAGING_ORIGIN = "https://staging.manliaoxiaoji.com";
const isOwnerPreview = () => api.isPinnedStagingPreview === true &&
  (api.getRuntimeEnvVersion() === "develop" ||
    (api.isPinnedStagingTrial === true && api.getRuntimeEnvVersion() === "trial")) &&
  api.getApiBaseUrl() === STAGING_ORIGIN;
module.exports = { STAGING_ORIGIN, isOwnerPreview };
