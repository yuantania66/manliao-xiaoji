const { request } = require("../utils/request");

const getCalendar = ({ month, type = "all" }) =>
  request({
    url: `/api/calendar?month=${encodeURIComponent(month)}&type=${encodeURIComponent(type)}`,
    method: "GET"
  });

module.exports = {
  getCalendar
};
