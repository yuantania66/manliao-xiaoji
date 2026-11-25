const { getApiBaseUrl, getRuntimeEnvVersion, isPinnedStagingTrial } = require("./api");

const delivery = Object.freeze({
  packageId: "MLXJ-20261112-UI3.26-TRIAL-ISOLATED",
  displayId: "1112-UI3.26-TRIAL-ISOLATED",
  appId: "wx1ae47edde7eb61e8",
  apiBaseUrl: "https://staging.manliaoxiaoji.com",
  knownServerSource: "0846a5b30996",
  knownServerBuild: "i8XPI6ZET-RtGX4Bs7LLf",
  serverReverified: false
});

const isIsolatedDelivery = () =>
  (getRuntimeEnvVersion() === "develop" ||
    (isPinnedStagingTrial === true && getRuntimeEnvVersion() === "trial")) &&
  getApiBaseUrl() === delivery.apiBaseUrl;

// Authorized numeric-only timing for this exact isolated develop/trial build.
const isTrialDelivery = () => isIsolatedDelivery();

const getDeliveryLabel = () => isIsolatedDelivery()
  ? `${delivery.displayId} · staging · 后端 ${delivery.knownServerSource}（未联合验收）`
  : "";

module.exports = { delivery, isTrialDelivery, isIsolatedDelivery, getDeliveryLabel };
