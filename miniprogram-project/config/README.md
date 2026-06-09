# 小程序 API 地址配置

`config/api.js` 不再写死 `localhost`。小程序请求地址按以下优先级读取：

1. 本机缓存 `xinqing_api_base_url`
2. 本机缓存 `xinqing_api_env` 对应的 `API_BASE_URLS`
3. `DEFAULT_API_ENV`

## 开发调试

在 `miniprogram-project/config/api.js` 中按实际情况填写：

```js
const API_BASE_URLS = {
  local: "http://127.0.0.1:3000",
  lan: "http://你的局域网IP:3000",
  trial: "https://xinqing.studio",
  production: "https://xinqing.studio"
};
```

当前默认环境是 `trial`，会请求 `https://xinqing.studio`。

微信开发者工具模拟器如需连接本机服务，可临时设置 `local` 或直接覆盖 API 地址。真机调试建议使用 HTTPS 测试域名。

也可以在调试控制台临时覆盖：

```js
wx.setStorageSync("xinqing_api_base_url", "https://xinqing.studio")
```

清除覆盖：

```js
wx.removeStorageSync("xinqing_api_base_url")
```

上线前必须确认：

- 使用 HTTPS 正式域名。
- 域名已配置到微信公众平台合法 request 域名。
- 不提交任何真实 token、key、数据库密码。
