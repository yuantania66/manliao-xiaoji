const { request } = require("../utils/request");

const authorizeInsights = () => request({ url: "/api/insights", method: "POST" });
const getInsights = (days, consentToken) => request({
  url: `/api/insights?days=${days}`,
  headers: { "x-insights-consent": consentToken }
});

module.exports = { authorizeInsights, getInsights };
