# MINIAPP_QA_CHECKLIST

## 登录

- [ ] 未登录进入“小记”时提示先登录。
- [ ] 未登录进入“慢慢说”时提示先登录，且不显示旧消息。
- [ ] 微信登录成功后，“我的”显示已登录。
- [ ] 微信登录失败时，可以用游客模式继续体验。
- [ ] 关闭并重新打开小程序后，能通过已保存 token 自动恢复登录。
- [ ] token 失效或后端返回 401 时，本机登录态被清空。

## 小记

- [ ] 空内容点击“收好”不会提交，并显示提示。
- [ ] 超长内容不会提交，并显示提示。
- [ ] 连续快速点击“收好”只创建一条小记。
- [ ] 新建一条小记后，进入“我的小记”能看到。
- [ ] 点击列表项进入详情，内容与刚才保存一致。
- [ ] 编辑详情后保存，返回列表再进入能看到更新内容。
- [ ] 删除小记后，列表不再显示该记录。
- [ ] 退出登录后，小记列表、详情和日历不显示旧用户数据。

## 慢慢说

- [ ] 登录后首次进入聊天页，会自动创建或恢复会话。
- [ ] 先未登录进入聊天页，再去登录并返回聊天页，会自动拉取会话和消息。
- [ ] 空消息点击发送不会提交，并显示提示。
- [ ] 超长消息不会提交，并显示提示。
- [ ] 连续快速点击发送只提交一条用户消息。
- [ ] 发送消息后能看到用户消息。
- [ ] 后端返回后能看到 AI/mock 回复。
- [ ] 重新进入聊天页能看到历史消息。
- [ ] 退出登录后，聊天页不显示旧用户消息。

## Calendar

- [ ] 有小记的日期在历史页“心情日历”区域展示。
- [ ] 删除该日期所有小记后，日历摘要更新。
- [ ] 退出登录后，日历摘要恢复为空状态。

## 弱网和接口失败

- [ ] 后端未启动时，请求显示“网络连接失败”或“请先配置 API 地址”等可理解提示。
- [ ] API 地址为空时，请求显示“请先配置 API 地址”。
- [ ] 后端返回 `ok:false` 时，页面显示后端错误信息。
- [ ] 请求中按钮显示 loading，重复点击不会重复提交。

## API 地址

- [ ] 开发者工具模拟器使用正确的本机或局域网 API 地址。
- [ ] 真机调试使用局域网 IP 或 HTTPS 测试域名。
- [ ] 体验版和正式版使用微信后台已配置的 HTTPS 合法域名。
- [ ] 外网访问 `https://manliaoxiaoji.com/api/health` 已解除 DNSPod webblock 拦截。

## 2026-07-02 上线前自动化复核记录

- [x] `npm run lint` 通过；已从 `next lint` 迁移为非交互式 `eslint .`。
- [x] `npm run audit:prelaunch` 通过；已检查默认 API、伪登录 token、Web mock 登录默认关闭、开发测试入口 guard。
- [x] `npm run check:ai-base` 通过；base-model prompt、旧历史过滤、debug 路由和旧架构防回归通过。
- [x] `npm run check:launch` 通过；lint、audit、AI base、Prisma、小程序 JS、Next build 一次跑通。
- [x] `npm run build` 通过，Next 生产构建成功。
- [x] `npx prisma validate` 通过，Prisma schema 有效。
- [x] 小程序所有 `.js` 文件通过 `node --check` 语法检查。
- [x] `miniprogram-project/config/api.js` 默认环境已为 `prod`，体验版/正式版 API 地址均指向 `https://manliaoxiaoji.com`。
- [x] 小程序“我的”页微信登录失败不再写入 `local_demo_` 假 token，失败后保持未登录并进入游客模式提示。
- [x] `npm run smoke:local-api` 通过；匿名鉴权、验证码登录、小记 CRUD、图片上传、聊天、搜索、日历、退出登录主链路通过。
- [x] 本地生产构建服务 `http://127.0.0.1:3300` 通过 `SMOKE_BASE_URL=http://127.0.0.1:3300 npm run smoke:prod`。
- [ ] 服务器执行 `PROD_ENV_FILE=/var/www/manliaoxiaoji/shared/.env npm run audit:prod-env` 通过。
- [x] 慢慢说 AI 会话理解评测通过：场景评测 `120/120`，直接探针 `3/3`，`qualityWarnings: 0`。
- [ ] `npm run smoke:prod` 未通过：`manliaoxiaoji.com` DNS 解析失败；直连服务器 IP 带 Host 返回 DNSPod webblock 跳转。

## 2026-06-23 本地自动化测试记录

- [x] `npm run build` 通过，Next 页面和 API 路由可完成生产构建。
- [x] `npx prisma validate` 通过，Prisma schema 有效。
- [x] 小程序所有 `.js` 文件通过 `node --check` 语法检查。
- [x] 本地 dev server 页面 200 检查通过：`/`、`/chat`、`/chat/search`、`/chat/calendar`、`/note`、`/note/history`、`/note/search`、`/note/calendar`、`/note/detail`、`/me`、`/me/settings`、`/me/settings/privacy`、`/me/settings/feedback`、`/me/settings/cancel`、`/me/insights`。
- [x] 未登录鉴权检查通过：`/api/notes`、`/api/calendar`、`/api/chat/sessions`、`/api/chat/search`、`/api/uploads/notes` 均返回 401。
- [x] 微信登录接口空请求体校验通过，返回 400 validation error。
- [x] 已修复本机开发数据库账号认证，`/api/health` 返回 database connected。
- [x] 已应用 Prisma migration `20260608154611_init_backend`。
- [x] 登录、小记创建/删除、图片上传成功路径、上传文件静态访问、聊天发送、搜索、日历数据聚合、退出登录完整接口闭环通过。
- [x] 意见反馈 API 创建和数据库写入通过，测试反馈已清理。
- [x] 生产域名 `https://manliaoxiaoji.com` HTTPS/API 可达性检查通过，未登录鉴权和反馈参数校验正常。

## 2026-06-24 账号注销本地测试记录

- [x] `npm run build` 通过，新增 `/api/auth/cancel` 可完成生产构建。
- [x] 小程序所有 `.js` 文件通过 `node --check` 语法检查。
- [x] 匿名请求注销验证码被拒绝，返回 401。
- [x] 已登录用户请求非本人手机号注销验证码被拒绝，返回 403。
- [x] 当前登录用户请求本人手机号注销验证码成功。
- [x] 验证码注销成功后，旧 token 访问 `/api/auth/me` 返回 401。
- [x] 注销后用户状态变为 `CANCELLED`，手机号和微信 openid 已清空。
- [x] 注销后 session、验证码、小记、聊天会话、AI 生成记录、AI 审核记录均已清理。
- [x] 注销后意见反馈保留为匿名记录，`userId` 已置空。
- [x] 生产环境部署完成，PM2 `manliaoxiaoji` 重启成功，`https://manliaoxiaoji.com/api/health` 返回 `production` 且数据库 connected。
- [x] 生产 HTTPS 注销闭环通过：生产验证码接口不返回 `devCode`，注销成功后旧 token 失效，测试用户数据已清理。

## 2026-06-24 短信验证码预留记录

- [x] 已添加腾讯云短信 SDK 依赖 `tencentcloud-sdk-nodejs`。
- [x] 已新增短信服务层，生产环境调用腾讯云 `SendSms`，开发环境保持 `devCode`。
- [x] 已补充腾讯云短信环境变量示例。
- [x] 验证码接口已加 60 秒发送冷却，同手机号同场景重复发送返回 429。
- [x] `npm run build` 通过，短信服务类型和 Next 构建通过。
- [x] 因个人认证无法新增腾讯云短信自用资质，本轮上线手机号验证码登录暂缓，前端优先使用微信登录。
- [ ] 腾讯云短信签名审核通过。
- [ ] 腾讯云短信正文模板审核通过。
- [ ] 生产服务器配置腾讯云短信环境变量后，完成真实手机号收码测试。

## 2026-06-25 微信登录优先调整记录

- [x] Web 原型登录面板已隐藏手机号验证码入口，直接进入微信登录确认。
- [x] 隐私文案已移除当前版本手机号验证码登录说明。
- [x] 小程序登录入口保持微信登录，未展示手机号验证码入口。
- [x] `npm run build` 通过，小程序所有 `.js` 文件通过 `node --check`。
