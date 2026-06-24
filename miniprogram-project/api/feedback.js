const { request } = require("../utils/request");

const createFeedback = ({ type, content, contact = "" }) =>
  request({
    url: "/api/feedback",
    method: "POST",
    auth: false,
    data: {
      type,
      content,
      contact
    }
  });

module.exports = {
  createFeedback
};
