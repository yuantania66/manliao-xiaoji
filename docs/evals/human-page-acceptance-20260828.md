# 15 页面真人视角验收记录 — 2026-08-28

## 结论

本轮按视觉报告中的 15 页面索引逐页检查，当前结果为：

- **通过：15 页**
- **发现问题：0 页**
- **暂未执行：0 页**

15 页都能在本地生产版本正常打开，首屏没有发现明显重叠、裁切或错位；逐页采集时浏览器控制台均为 `0 error / 0 warning`。

第一轮发现的 6 个问题页已经完成修复，并使用隔离数据库中的合成账号与合成小记重新验收。观察、日历、历史、详情和搜索现在只展示当前账号的真实接口数据；游客设置页不再显示“退出登录”。账号注销也已使用一次性合成账号完成风险确认、手机验证码、最终注销和注销后游客态验收。15 页本地真人视角验收现已全部通过，但这仍不替代真实微信、真实短信、生产等价环境和双端真机发布门。

## 逐页记录

| # | 页面 | 路由 | 结果 | 真人视角检查 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 1 | 首页 | `/` | **通过** | 日期、主入口、登录/游客选择显示正常；点击“游客模式”后弹层关闭，可进入主页。 | [首屏](./screenshots/human-acceptance-20260828/home.jpg) · [游客进入](./screenshots/human-acceptance-20260828/home-guest-entry.jpg) |
| 2 | 聊天 | `/chat` | **通过** | 空白态可见且输入框立即可用；菜单可展开，聊天日历和搜索入口可见；输入文字正常，本轮未发送真实消息。 | [首屏](./screenshots/human-acceptance-20260828/chat.jpg) · [菜单与输入](./screenshots/human-acceptance-20260828/chat-menu-input.jpg) |
| 3 | 聊天日历 | `/chat/calendar` | **通过** | 2026 年 8 月六行日期完整，“31”与未登录提示不重叠；上一月/下一月切换正常。 | [首屏](./screenshots/human-acceptance-20260828/chat-calendar.jpg) · [月份切换](./screenshots/human-acceptance-20260828/chat-calendar-navigation.jpg) |
| 4 | 聊天搜索 | `/chat/search` | **通过** | 搜索框可输入；无匹配内容时显示明确空结果。 | [首屏](./screenshots/human-acceptance-20260828/chat-search.jpg) · [空结果](./screenshots/human-acceptance-20260828/chat-search-empty.jpg) |
| 5 | 我的 | `/me` | **通过** | 游客状态、设置和观察入口显示正常；未同意协议点击登录时会弹出协议确认，不会直接登录。 | [首屏](./screenshots/human-acceptance-20260828/me.jpg) · [协议拦截](./screenshots/human-acceptance-20260828/me-agreement-guard.jpg) |
| 6 | 观察授权 | `/me/insights` | **通过** | 授权后只整理当前账号最近 7/30/90 天的真实聊天与已保存小记；范围切换会改变词频结果。页面明确说明“不做判断、不做诊断”，颜色只用于区分词语。 | [修复后真实词频](./screenshots/human-acceptance-20260828-fixed/06-insights-real-data.png) |
| 7 | 设置 | `/me/settings` | **通过** | 登录态显示“退出登录”；退出后同一路由不再显示该按钮，隐私、注销和反馈入口保持正常。 | [登录态](./screenshots/human-acceptance-20260828-fixed/07-settings-authenticated.png) · [游客态](./screenshots/human-acceptance-20260828-fixed/07-settings-guest.png) |
| 8 | 账号注销 | `/me/settings/cancel` | **通过** | 使用隔离库合成账号完成不可逆风险提示、绑定手机验证码、最终注销和游客态回落。目标账号、会话、小记、聊天、反馈及受管媒体均清除；另一个合成账号及其小记保留。验证码输入态未截图，所有截图均不含 OTP、token 或真实手机号。 | [风险确认](./screenshots/human-acceptance-20260828-fixed/08-cancel-risk.png) · [手机验证](./screenshots/human-acceptance-20260828-fixed/08-cancel-sms.png) · [注销完成](./screenshots/human-acceptance-20260828-fixed/08-cancel-success.png) · [游客态](./screenshots/human-acceptance-20260828-fixed/08-cancel-post-logout.png) |
| 9 | 意见反馈 | `/me/settings/feedback` | **通过** | 类型切换、文字输入、计数和按钮启用状态正常；本轮填写“验收测试，不提交”，未向后端提交。 | [首屏](./screenshots/human-acceptance-20260828/feedback.jpg) · [填写态](./screenshots/human-acceptance-20260828/feedback-filled.jpg) |
| 10 | 隐私政策 | `/me/settings/privacy` | **通过** | 标题、正文层级和返回入口正常，长文阅读未发现遮挡或截断。 | [页面](./screenshots/human-acceptance-20260828/privacy.jpg) |
| 11 | 新建小记 | `/note` | **通过** | 当前日期正确；文字输入、字数变化和心情选择入口正常；本轮未保存、未上传媒体。 | [首屏](./screenshots/human-acceptance-20260828/note.jpg) · [填写态](./screenshots/human-acceptance-20260828/note-compose.jpg) |
| 12 | 心情日历 | `/note/calendar` | **通过** | 默认显示上海当前月份；左右箭头可连续切月。8 月显示当前账号 15、28 日的真实小记标记，切到 7 月后显示 20 日的真实标记。 | [2026 年 8 月](./screenshots/human-acceptance-20260828-fixed/12-note-calendar-august.png) · [切到 2026 年 7 月](./screenshots/human-acceptance-20260828-fixed/12-note-calendar-july.png) |
| 13 | 小记详情 | `/note/detail` | **通过** | 通过本人 `noteId` 展示真实日期、心情和正文；随机或他人的 `noteId` 不泄露记录，显示“没有找到这篇小记”。 | [真实详情](./screenshots/human-acceptance-20260828-fixed/14-note-detail-real-data.png) |
| 14 | 小记历史 | `/note/history` | **通过** | 列表按真实月份分组，展示当前账号三条合成小记；输入“会议”后只保留匹配的 8 月 15 日记录，详情链接使用真实 `noteId`。 | [真实历史列表](./screenshots/human-acceptance-20260828-fixed/13-note-history-real-data.png) |
| 15 | 小记搜索 | `/note/search` | **通过** | 初始状态不展示样例；搜索“公园”后只返回当前账号 7 月 20 日的真实小记，并可进入真实详情。 | [真实搜索结果](./screenshots/human-acceptance-20260828-fixed/15-note-search-real-data.png) |

## 修复复验记录

### 已修复：个人观察使用固定演示数据

- 新增受认证保护的观察接口，只读取当前用户的 `USER` 聊天和非草稿小记。
- 结果最多 6 个 `word/count`，不返回原文、记录 ID、情绪、诊断或人格判断。
- 7/30/90 天范围、无数据、游客、错误和账号切换均有明确状态。

### 已修复：小记回看链路使用固定演示数据

- 日历、历史、详情和搜索统一使用小记 API，并在每个数据库查询中限制当前 `userId`。
- 日历按真实月份生成并可跨月；历史和搜索不再回退固定样例。
- 详情缺少 ID、记录不存在或越权时均显示同样的未找到状态。
- 公共日期校验已严格拒绝非闰年 2 月 29 日、2 月 31 日、13 月和非标准格式。

### 已修复：游客设置页显示“退出登录”

- `/me/settings` 按实际登录状态展示或隐藏退出按钮，登录和游客截图均已复核。

### 已完成：账号注销最终确认

- 使用专用隔离 PostgreSQL 和一次性合成账号执行完整 Web 注销，不接触真实账号、真实手机号或生产数据。
- 手机验证码发送后，页面只显示“验证码已发送”；开发验证码默认隐藏，验证码输入态不进入截图。
- 注销后目标 `User / Session / Note / ChatSession / ChatMessage / Feedback` 计数均为 `0`，受管媒体和私有暂存均清空。
- 另一个合成用户及其小记各保留 `1` 条，证明注销没有越过数据主体边界。
- 页面完成态准确显示“账号与数据已清空”，随后访问 `/me` 显示游客模式；浏览器控制台为 `0 error / 0 warning`。

### Remaining：搜索关键词仍在 URL 中

- 历史页与独立搜索页仍通过 GET 查询参数发送关键词。
- 敏感搜索词可能进入浏览器历史、代理或访问日志；本项不影响本轮 6 页功能验收，但应作为独立隐私修复项处理。

## 本轮边界

- 环境：15 页基线使用本地生产构建 `http://127.0.0.1:3102`；账号注销最终复验使用同一最终代码重新构建并运行于 `http://127.0.0.1:3103`。两次均连接专用隔离 PostgreSQL，仅含合成账号、合成小记和合成媒体。
- 已覆盖：15 页可达性、首屏视觉、控制台错误/警告、观察范围切换、日历跨月、历史筛选、详情 404、真实搜索、登录/游客设置状态、账号注销最终确认及逐页截图。
- 自动化补充：唯一必跑入口 `check:release:required` 在隔离数据库、禁用外部模型凭据的环境下完整通过（退出码 0），包含生产构建 40/40；隔离数据库 API smoke 7/7、注销专项数据库 E2E、Web 缓存和小程序缓存/重试门均通过。覆盖 A/B 用户隔离、草稿/未来/Assistant 排除、匿名 401、越权详情 404、非法参数、OTP 边界、微信主体校验、媒体回滚及私有残留清理。
- 未执行：真实模型回复、真实微信登录、真实短信、反馈提交、生产对象存储上传，以及微信体验版和 iOS/Android 真机。
- 因此，本报告是**第一轮真人视角页面验收记录**，不是完整发布验收签字。
