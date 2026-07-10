# 慢聊小记测试报告

> 2026-07-02 说明：本文件是 2026-06-24 的历史测试记录。最新上线就绪状态见 `LAUNCH_READINESS_2026-07-02.md`；其中正式域名健康检查当前已复核为 P0 阻塞。

测试日期：2026-06-24  
测试环境：本地开发环境，Asia/Shanghai  
项目路径：`/Users/yuanyuanyuan/projects/xinqing 2.0`  
本地服务：`http://127.0.0.1:3001`，测试后已停止  

## 结论

本次本地自动化和接口冒烟测试结论：核心后端闭环通过，可继续进入小程序真机/体验版测试。

已通过的核心路径包括：验证码登录、小记创建/查询/编辑/删除、图片上传、聊天会话、AI/mock 回复、聊天搜索、综合日历、小记日历、退出登录、跨用户数据隔离和危机表达 fallback。

当前不建议直接发布正式版，主要阻塞点是小程序默认 API 环境仍指向本地地址；另外 lint 工具链不可用，正式 OpenAI、正式微信登录、正式域名和真机体验版仍需复测。

## 测试范围

已覆盖：

- Next.js 生产构建和 TypeScript 检查
- Prisma schema 校验
- 小程序 `.js` 文件语法检查
- Web 页面 HTTP 200 冒烟
- 未登录接口鉴权
- 登录后 API 主链路
- 字段边界和错误处理
- 上传接口类型校验
- 跨用户数据隔离
- AI 安全 fallback 本地路径
- 发布前静态风险扫描

未覆盖：

- 微信开发者工具编译预览
- iOS 真机、Android 真机
- 体验版/正式版 HTTPS 合法域名请求
- 真实微信 `code2Session` 线上链路
- 真实短信验证码服务
- 真实 OpenAI API 调用，本地未配置 `OPENAI_API_KEY`，当前走 mock/fallback
- 真实图片对象存储/CDN
- 视觉截图逐页比对和无障碍测试

## 执行结果

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `npm run build` | 通过 | Next.js 15.5.19 生产构建成功，31 个页面/路由生成完成 |
| `npx tsc --noEmit` | 通过 | TypeScript 检查无报错 |
| `npx prisma validate` | 通过 | `prisma/schema.prisma` 有效 |
| 小程序 JS 语法检查 | 通过 | `find miniprogram-project -name '*.js' ... node --check` 无报错 |
| `npm run lint` | 未通过 | `next lint` 进入 ESLint 初始化交互并退出，未完成 lint 扫描 |
| `/api/health` | 通过 | 返回 database connected |
| Web 页面冒烟 | 通过 | 15 个页面均返回 200 |
| 未登录鉴权 | 通过 | 受保护 API 返回 401；上传接口 POST 未登录返回 401 |
| 登录后接口闭环 | 通过 | 19 项主链路检查全部通过 |
| 边界/隔离/安全 | 通过 | 15 项边界、跨用户和 crisis fallback 检查全部通过 |

## 页面冒烟

以下页面均返回 200：

- `/`
- `/chat`
- `/chat/search`
- `/chat/calendar`
- `/note`
- `/note/history`
- `/note/search`
- `/note/calendar`
- `/note/detail`
- `/me`
- `/me/settings`
- `/me/settings/privacy`
- `/me/settings/feedback`
- `/me/settings/cancel`
- `/me/insights`

## API 主链路

使用临时测试手机号完成以下检查，测试结束后已删除测试用户和本次上传文件：

- 发送验证码：200
- 获取开发环境验证码：通过 `devCode`
- 手机号验证码登录：200
- 查询登录态：200
- 图片上传：200
- 创建小记：201
- 按日期查询小记列表：200
- 查看小记详情：200
- 编辑小记：200
- 小记日历聚合：200
- 创建聊天会话：201
- 发送聊天并收到回复：201
- 查询聊天历史：200
- 聊天搜索：200
- 综合日历聚合：200
- 删除小记：200
- 删除后详情不可见：404
- 退出登录：200
- 退出后登录态失效：401

## 边界、隔离和安全

以下检查通过：

- 小记空内容返回 400
- 小记超过 500 字返回 400
- 小记非法日期返回 400
- 小记图片超过 9 个返回 400
- 非图片文件上传返回 400
- 用户 B 访问用户 A 小记返回 404
- 聊天空内容返回 400
- 聊天超过 2000 字返回 400
- 聊天搜索超过 80 字返回 400
- 用户 B 访问用户 A 聊天会话返回 404
- 危机表达触发 fallback，返回 `riskLevel=crisis`、`assistantMessage.status=fallback`

## 发现的问题和风险

### P0：小程序默认 API 环境仍是本地

`miniprogram-project/config/api.js` 中 `DEFAULT_API_ENV = "local"`，对应 `http://127.0.0.1:3002`。如果不改配置直接上传体验版/正式版，真机请求会打到用户手机本机，核心登录、小记、聊天都会失败。

建议：上传体验版/正式版前将默认环境切到 `trial` 或 `prod`，或引入明确的构建时环境配置。

### P1：lint 工具链不可用

`npm run lint` 当前执行 `next lint`，Next.js 15 下会进入 ESLint 初始化交互，CI/自动化场景无法完成扫描。

建议：迁移到 ESLint CLI，并补一个非交互式 lint 脚本。

### P1：仍有演示/开发 fallback 逻辑

静态扫描发现以下开发痕迹需要上线前确认：

- Web 首页微信登录失败后保存 `local_demo_` token
- 小程序“我的”页登录失败后保存 `local_demo_` token
- Web 手机验证码页在非生产环境展示 `开发环境验证码`
- 小程序小记页开发态显示“生成 9 张图片测试”
- 小程序历史页开发态会写入媒体测试小记

建议：生产/体验版明确关闭 demo fallback 和测试入口，避免审核人员或真实用户进入伪登录/测试数据路径。

### P1：生产真实服务未覆盖

本次本地环境未配置 `OPENAI_API_KEY`，AI 服务走 mock/fallback；验证码也使用开发环境 `devCode`。这证明本地降级链路可用，但不能代表正式 OpenAI、短信、微信登录和域名配置全部可用。

建议：在体验版环境补测真实 `APP_ENV=production`、真实 HTTPS 域名、真实微信登录、真实短信验证码、真实 OpenAI API。

### P2：上传存储仍需生产方案确认

当前上传接口可写入本地 `public/uploads` 并返回 URL，本地测试通过。生产如部署到无状态平台或多实例环境，需要对象存储，否则可能出现文件丢失、实例间不可见或备份困难。

## 建议的下一轮测试

1. 用微信开发者工具打开 `miniprogram-project`，确认编译、预览、合法域名配置。
2. 将小程序默认 API 环境改为体验版域名后，跑 iOS 和 Android 真机主链路。
3. 在生产等价环境配置 `APP_ENV=production`、真实微信密钥、短信服务和 `OPENAI_API_KEY`，重跑登录、聊天、上传。
4. 补 CI 脚本：build、tsc、Prisma validate、小程序 JS check、ESLint CLI、API 集成测试。
