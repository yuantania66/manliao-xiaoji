# 页面视觉冒烟 — 2026-08-28

## 结论

**READY FOR HUMAN UI ACCEPTANCE**。15 个 Web 页面均能路由并保留基线截图；基线发现的 3 个可见问题已修复并完成本地生产构建复验。现在可以开始真人页面验收，但这不等于真实登录、真实模型、微信体验版或双端真机发布门已经通过。

## 已修复问题

1. 首屏日期和月份改为挂载后按上海时间解析，避免静态 HTML 与浏览器首次渲染不一致。本地生产版首页、小记、聊天日历和聊天页复验未记录到浏览器 error/warn；运行记录见 [runtime evidence](./page-visual-smoke-runtime-20260828.json)。
2. `/chat/calendar` 为六行日期网格预留独立空间；`31` 与“请先登录”不再重叠。
3. `/chat` 不再把 AI 欢迎语生成算成“恢复历史”。本次本地生产版样本在 637ms 路由载入后即可看到可输入的空白态；欢迎语继续在后台生成并随后追加。该数字是单次本地样本，不是性能承诺。

## 修复后关键截图

| 检查点 | 截图 |
| --- | --- |
| 首页日期与首屏 | [home after](./screenshots/release-20260828/home-after-20260828.png) |
| 小记日期与首屏 | [note after](./screenshots/release-20260828/note-after-20260828.png) |
| 聊天首屏立即可用 | [chat after](./screenshots/release-20260828/chat-after-20260828.png) |
| 欢迎语后台完成 | [chat settled after](./screenshots/release-20260828/chat-settled-after-20260828.png) |
| 六行聊天日历布局 | [chat calendar after](./screenshots/release-20260828/chat-calendar-after-20260828.png) |

## 截图索引

| 页面 | 路由 | 截图 |
| --- | --- | --- |
| 首页 | `/` | [home](./screenshots/release-20260828/home-20260828.png) |
| 聊天 | `/chat` | [chat](./screenshots/release-20260828/chat-20260828.png) |
| 聊天日历 | `/chat/calendar` | [chat-calendar](./screenshots/release-20260828/chat-calendar-20260828.png) |
| 聊天搜索 | `/chat/search` | [chat-search](./screenshots/release-20260828/chat-search-20260828.png) |
| 我的 | `/me` | [me](./screenshots/release-20260828/me-20260828.png) |
| 观察授权 | `/me/insights` | [me-insights](./screenshots/release-20260828/me-insights-20260828.png) |
| 设置 | `/me/settings` | [me-settings](./screenshots/release-20260828/me-settings-20260828.png) |
| 账号注销 | `/me/settings/cancel` | [cancel](./screenshots/release-20260828/me-settings-cancel-20260828.png) |
| 意见反馈 | `/me/settings/feedback` | [feedback](./screenshots/release-20260828/me-settings-feedback-20260828.png) |
| 隐私政策 | `/me/settings/privacy` | [privacy](./screenshots/release-20260828/me-settings-privacy-20260828.png) |
| 新建小记 | `/note` | [note](./screenshots/release-20260828/note-20260828.png) |
| 心情日历 | `/note/calendar` | [note-calendar](./screenshots/release-20260828/note-calendar-20260828.png) |
| 小记详情 | `/note/detail` | [note-detail](./screenshots/release-20260828/note-detail-20260828.png) |
| 小记历史 | `/note/history` | [note-history](./screenshots/release-20260828/note-history-20260828.png) |
| 小记搜索 | `/note/search` | [note-search](./screenshots/release-20260828/note-search-20260828.png) |

## 证据边界

- 环境：本地生产构建 `http://127.0.0.1:3102`。
- 覆盖：页面可达、稳定后可见文本、首屏截图。
- 未覆盖：真实登录、真实模型对话、表单提交、上传、删除、跨用户隔离、微信体验版、iOS/Android 真机、弱网和前后台恢复。
