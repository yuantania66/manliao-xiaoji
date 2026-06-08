# 新晴 2.0 小程序第一版

这是新晴第一版上线方向的小程序实现，当前采用微信原生小程序结构。

## 打开方式

1. 打开微信开发者工具。
2. 选择「导入项目」。
3. 项目目录选择 `miniprogram-project`。
4. AppID 可先使用测试号，正式上线前替换 `project.config.json` 里的 `appid`。

## 页面

- `pages/home/home`：此刻首页
- `pages/chat/chat`：聊天
- `pages/note/note`：小记
- `pages/note-history/note-history`：我的小记
- `pages/me/me`：我的
- `pages/settings/settings`：设置

当前 Next.js 版本仍保留在项目根目录，可继续作为高保真网页预览和设计调试版本。
