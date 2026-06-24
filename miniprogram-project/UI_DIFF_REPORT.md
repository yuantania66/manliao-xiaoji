# UI_DIFF_REPORT

## 对比基准

- Web 基准页面：`http://localhost:3002/chat`
- Web 源文件：`/Users/yuanyuanyuan/projects/xinqing 2.0/app/chat/chat-client.tsx`
- 小程序页面：`/Users/yuanyuanyuan/projects/xinqing 2.0/miniprogram-project/pages/chat/chat.wxml`
- 小程序样式：`/Users/yuanyuanyuan/projects/xinqing 2.0/miniprogram-project/pages/chat/chat.wxss`
- 换算方式：Web 390px 画布约等于小程序 750rpx，1px 约等于 1.923rpx。

## 差异项

| 项目 | 原值 | 修改值 | 修改原因 |
| --- | --- | --- | --- |
| 顶部返回位置 | 动态 `backTop`，受胶囊安全区影响，视觉上比 Web 更低 | 固定 `top: 96rpx; left: 42rpx` | 对齐 Web `top: 50px; left: 22px` |
| 标题位置 | 普通流布局，`margin-top: titleOffset`，受页面 padding 和安全区影响 | 固定 `top: 158rpx; left: 42rpx` | 对齐 Web `top: 82px; left: 22px`，避免标题下沉 |
| 标题字体大小 | `56rpx` | `54rpx` | 对齐 Web `28px` |
| 标题字体粗细 | `700` | `600` | 对齐 Web `font-semibold` |
| 标题行高 | `76rpx` | `73rpx` | 对齐 Web `38px` |
| 三点菜单位置 | 动态 `actionTop/actionRight`，受胶囊安全区影响，真实截图中偏中间；按 Web 固定 `150rpx` 后又与微信胶囊距离过近 | 固定 `top: 192rpx; right: 42rpx` | 小程序端优先避让微信胶囊，保持标题右侧关系 |
| 三点菜单尺寸 | 视觉值 `80rpx x 44rpx`，实际 `button` 盒子被小程序默认样式撑到约 `184px` 宽 | 改为 `view.menu-button`，`77rpx x 42rpx` | 对齐 Web `40px x 22px`，避免隐形点击区域过大 |
| 三点菜单字重 | `700` | `600` | 对齐 Web `font-semibold` |
| 菜单面板位置 | 动态 `panelTop`，跟随安全区 | 固定 `top: 250rpx; right: 42rpx` | 跟随三点菜单下移，避免弹层贴近微信胶囊 |
| 菜单面板尺寸 | `388rpx x 252rpx` | `373rpx x 242rpx` | 对齐 Web `194px x 126px` |
| 消息区域顶部 | 动态 `messagesTop = layout.titleTop + 68` | 固定 `top: 288rpx` | 对齐 Web `top: 150px`，让消息从标题下方正确开始 |
| 消息区域左右边距 | `left/right: 44rpx`，实测 `scroll-view` 仍为 `390px` 宽，右侧气泡超出屏幕 | `left: 42rpx; width: 673rpx; box-sizing: border-box` | 对齐 Web `left: 22px; width: 350px`，避免右侧气泡越界 |
| 消息间距 | `margin-bottom: 26rpx` | `margin-bottom: 15rpx` | 对齐 Web `gap-2` |
| 时间字体大小 | `22rpx` | `19rpx` | 对齐 Web `10px` |
| 时间行高 | `32rpx` | `31rpx` | 对齐 Web `16px` |
| 时间上下间距 | 仅 `margin-bottom: 12rpx` | `margin-top: 8rpx; margin-bottom: 15rpx` | 对齐 Web `mt-1 mb-2` |
| AI 气泡宽度 | `max-width: 548rpx` | `max-width: 588rpx` | 对齐 Web AI 气泡 `max-width: 306px` |
| 用户气泡宽度 | 与 AI 共用 `548rpx` | `max-width: 527rpx` | 对齐 Web 用户气泡 `max-width: 274px` |
| 气泡圆角 | `30rpx` | `35rpx` | 对齐 Web `18px` |
| 气泡内边距 | `24rpx 28rpx` | `23rpx 27rpx` | 对齐 Web `py-3 px-3.5` |
| 气泡字体大小 | `28rpx` | `25rpx` | 对齐 Web `13px` |
| 气泡行高 | `46rpx` | `42rpx` | 对齐 Web `22px` |
| 输入框左右位置 | `left/right: 36rpx` | `left: 35rpx; right: 34rpx` | 对齐 Web `left: 18px; width: 354px` |
| 输入框高度 | `108rpx` | `104rpx` | 对齐 Web `54px` |
| 输入框圆角 | `32rpx` | `31rpx` | 对齐 Web `16px` |
| 输入文字位置 | `left: 32rpx; top: 34rpx` | `left: 38rpx; top: 33rpx` | 对齐 Web `left: 20px; top: 17px` |
| 输入文字大小 | `26rpx` | `25rpx` | 对齐 Web `13px` |
| 发送按钮尺寸 | `112rpx x 76rpx` | `104rpx x 77rpx` | 对齐 Web `54px x 40px` |
| 发送按钮位置 | `right: 16rpx; top: 16rpx` | `right: 19rpx; top: 13rpx` | 对齐 Web `right: 10px; top: 7px` |
| 发送按钮圆角 | `28rpx` | `31rpx` | 对齐 Web `16px` |

## Review

- 第一轮修改已只覆盖聊天页视觉布局。
- 未新增设计。
- 未修改聊天发送、菜单、登录、接口等业务逻辑。
- JS 语法检查：`node --check pages/chat/chat.js` 通过。
- 小程序预览编译：`wechatwebdevtools cli preview --project ... --compile-condition pages/chat/chat` 通过，包体 `64.9 KB`。
- 第二轮静态 Review：已按 Web 390px 画布换算到 750rpx 复核标题、消息区、气泡和输入框。预计相似度约 90%-93%。
- 第二轮真实截图 Review：已拿到微信开发者工具模拟器截图 `/tmp/manliao-xiaoji-miniapp-chat-real.png`。发现三点菜单因为动态安全区偏向中间，已改为 Web 固定坐标。
- 第三轮坐标 Review：通过 `miniprogram-automator` 测到三点按钮实际盒子约 `184px` 宽、消息容器约 `401px` 宽，均明显偏离 Web。已清除 button 默认盒模型，并修正消息容器盒模型，避免右侧气泡被挤出屏幕。
- 第四轮坐标 Review：清除 button 默认盒模型后，三点按钮在小程序中仍被强制撑宽，因此改为 `view` 保留 `bindtap`；`scroll-view` left/right 收缩不稳定，因此改为 Web 等价固定宽度 `673rpx`。
- 第五轮真实机安全区 Review：用户截图显示三点菜单与微信胶囊距离过近。由于 Web 无微信胶囊，小程序端优先避让系统胶囊，将三点菜单从 `top: 150rpx` 调整到 `top: 192rpx`，菜单面板从 `top: 208rpx` 调整到 `top: 250rpx`。
