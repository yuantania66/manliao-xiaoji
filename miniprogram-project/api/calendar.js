const { request } = require("../utils/request");

const getCalendar = (month) =>
  request({
    url: `/api/calendar?month=${encodeURIComponent(month)}&type=all`
  });

module.exports = {
  getCalendar
};
