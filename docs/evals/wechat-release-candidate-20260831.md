# 微信发布候选证据 — 2026-08-31

## 当前判定

**本地候选已改为短信延后方案；仍未部署或提交微信审核。**

当前短信延后候选的 21 个数据库迁移、完整发布门和生产构建均已通过。公开登录范围已收窄为微信登录、微信手机号登录和游客模式，短信入口暂缓；线上仍运行旧 release `5625262` 和 19 个迁移。因此，本记录只封存本地证据，不把旧线上 Smoke、旧二维码或本地 PASS 写成已经部署。

## 候选身份

- 源码分支：`codex/release-main-integration-20260828`
- 主线基线：`00a3301bd1abf3ddfd482a36746231f3159abe7d`
- 当前方案二源码候选：`f05ef0ad14bb70a5ad090e73c56a3b68e7726108`
- 提交前候选校验：基线 `cedcc6080cac02444e9c8ea58703c8be14a679f7` 加 21 个 tracked 修改；排除本证据文档后的 canonical `git diff` SHA-256 为 `06f228abe8a1ca8ae4243e81b36cbd1fc09145703a17f159d0ceb8401c1e240c`。该内容现已封存于上述 commit。
- 上一版短信延后候选：`647851712af78aaf46c2e8a1a819060b3b48f18e`；其二维码和发布门证据均已被方案二取代，不得用于当前验收。
- 原小程序源码与本地发布门候选：`aeccacd0238bf36be00d6cde90eefb1e6a07bd1c`；本次登录范围变更后该 commit 与二维码均已失效，须在新提交上重新封存。
- 当前工作候选包含统一登录、微信手机号、暂缓公开但保留实现的短信登录、可选个人资料、头像、小记、聊天、观察、注销及持久删除队列。
- 测试数据：仅隔离 PostgreSQL 与仓库合成 fixtures；未读取或写入真实用户数据。

## 本地发布门

在全新隔离 PostgreSQL 16 数据库 `xinqing_limited_release_test` 上正式应用 21 个 migration 后执行：

```bash
npm run check:release:required
```

结果：**PASS，退出码 0**。

覆盖证据：

- 21 个 migration 全部应用，`prisma migrate status` 返回 schema up to date；
- 高风险增量门、账号注销、头像、资料完成、微信手机号、统一登录、Chat、Safety、Memory 和既有 `check:launch` 全部通过；
- `prisma validate` 与 `prisma generate` 通过；
- 小程序 JavaScript 语法检查通过，共 34 个文件；
- Next.js 生产构建通过，共生成 44 个页面/路由，无构建失败。

该结果只属于上述 21-file 方案二候选与隔离数据库，不继承 `6478517…`、2026-08-28 旧脏工作区或 13-migration 证据。

## 微信开发者工具预览

微信开发者工具已对方案二候选 `5ca4e17` 成功生成新的预览包，报告包大小为 1,821,377 bytes。`647851712af78aaf46c2e8a1a819060b3b48f18e` 与 `aeccacd0238bf36be00d6cde90eefb1e6a07bd1c` 的二维码均已失效，不再用于验收。

本地临时证据（不提交仓库）：

| 文件 | SHA-256 | 大小 |
| --- | --- | ---: |
| `/private/tmp/xinqing-preview-5ca4e17.png` | `4e54cc6bebc91e7b418fc4b3c0443de0e603189071873f2d82a70d988b995f1a` | 47,002 bytes |
| `/private/tmp/xinqing-preview-5ca4e17.json` | `789515f263db694db5ed55716851ab726ee27d97305b3d0818196dad3ac5047f` | 130 bytes |
| `/private/tmp/xinqing-preview-6478517.png` | `93aaa50799130975b08de6533603b3f0741f380871677419c4c1b37aafa5e786` | 46,975 bytes |
| `/private/tmp/xinqing-preview-6478517.json` | `127c3817ece9b7309c8ca48f2d56e997d43dfb8b509987c9422a768486a2a13c` | 130 bytes |

旧候选包大小为 1,820,659 bytes，只是历史记录。新二维码虽已绑定当前候选，但在配套后端部署和真机回归完成前，仍不得作为上线体验版交付。

## 登录页视觉与 Figma 复核

登录选择页已取消固定 18% 黑色遮罩，并显式让两枚主要登录按钮在纵向布局中横向撑满。微信开发者工具通过官方自动化接口直接导出 390×844 逻辑尺寸截图，未经过系统屏幕裁剪，也不包含 Codex 或桌面通知浮层。

真机复核发现背景拱窗与刘海/胶囊相交后，候选改为读取每台设备的状态栏、窗口宽度和微信胶囊底边，按背景原图拱顶位置计算顶部留白；普通屏、刘海屏和较宽设备的反例均要求拱顶至少低于胶囊 8px。背景图使用等宽缩放，避免不同屏幕比例再次把拱窗裁回系统区域。

同一轮截图又发现安全留白原先使用固定米色，黄昏背景顶部实际为更暖的桃色，形成明显横向色带。候选现按清晨、白天、黄昏、夜间及各登录步骤背景分别绑定原图顶部实测色，并在背景图起点加入 28px 同色渐隐；刘海/胶囊安全距离不变。微信开发者工具重新导出的无遮挡截图中，安全留白与黄昏图起始区域保持同色连续。

同轮真机还发现预览包连接的旧生产后端尚无 `/api/auth/profile-abandon`：2026-08-31 无凭据探测返回 HTTP 404，而旧后端 `/api/auth/logout` 返回 HTTP 401，证明后者存在且正常鉴权。客户端因此只在精确 404 时退回注销当前会话，使“放弃登录”能退出旧后端；新版接口成功时仍执行完整临时账号/文件清理，任何 500 或网络失败都不会被回退掩盖。

后续卡页复核进一步确认旧生产同样没有资料完成能力：无凭据 `POST /api/uploads/profile-avatar` 返回 404，`PATCH /api/auth/me` 返回 405，而 `GET /api/auth/me` 正常返回鉴权 401。候选不会假装资料已经保存；遇到这两个精确版本不匹配状态时会提示用户点击“放弃登录”返回。若旧会话本身已经失效，注销回退的 401 视为已退出并清理本机认证状态；500 与网络错误仍保持可重试，不冒充服务端清理成功。真正完成头像昵称仍须部署配套后端。

真机再次证明等待服务端清理仍会把用户留在必填资料页后，“放弃登录”改为本机立即生效：点击时先使正在进行的资料操作失效、清除本机认证并回到登录选择页，再使用已捕获 token 后台尽力清理服务端临时会话/账号。按钮不再因头像上传或资料保存的 `busy` 状态禁用；后台 404、401、超时或 500 都不能把用户重新锁回资料页。该行为只保证退出当前登录流程，不把后台清理失败写成服务端账号已删除。

以上“必填资料/放弃登录”记录属于方案变更前的真机问题证据，现已由 2026-08-31 冻结的方案二取代：微信或微信手机号经服务端验证成功后，账号立即成为持久注册账号并进入产品；头像和昵称不再是注册或普通功能的前置条件，只作为之后可选编辑的个人资料。注册用户数以服务端成功创建或识别的 `ACTIVE` 持久账号为准，不统计游客、登录按钮点击或失败授权。旧的未完善持久账号也可直接恢复使用；历史临时账号在再次成功登录时转为正式账号。

本次方案二实现同时移除了服务端普通业务接口的资料完整度门、首页和“我的”页面的资料缺失重定向，以及统一登录成功后的必填资料跳转。资料编辑入口仍保留头像私有上传、账号隔离和取消能力。前述绑定旧必填流程的二维码与截图均不再代表当前候选，必须在本候选封存后重新生成。

Figma 文件 `慢聊小记 · 登录注册流程` 的当前夜间稿以及清晨、白天、黄昏、月夜四个时段稿已同步为当前公开方案：`同意《隐私政策》`、`微信登录`、`微信手机号登录`、`游客模式`。短信登录实现仍保留，但没有出现在这些公开入口稿中。

本地临时视觉证据（不提交仓库）：

| 文件 | SHA-256 | 用途 |
| --- | --- | --- |
| `/private/tmp/xinqing-figma-login-day-current.png` | `767990d2bf886fb569b3304e4715df926d31e9ea4e5dde460da9304229326a37` | 同步后的 Figma 白天稿 |
| `/private/tmp/xinqing-login-figma-vs-simulator.png` | `26deec36c734991e57b3764fde993e96708afbf23f19968e2e842af91887b515` | Figma（左）与模拟器（右）等尺寸并排复核图 |
| `/private/tmp/xinqing-login-visual-preview-20260831.png` | `187b28198aea1cde324e1f4f95040cb8499e25a0bf00704fe0948dceef6c3dcb` | 当前未提交视觉候选的物理真机预览二维码 |
| `/private/tmp/xinqing-login-simulator-clean.png` | `651ec9aa717bcebaba236b4b6f3c716bd21adacb19daf46f4cdae10ddd7bba83` | 胶囊安全区与动态顶色接缝修复后的无遮挡模拟图（覆盖同路径旧文件） |
| `/private/tmp/xinqing-login-safe-preview-20260831.png` | `956cf700a6774c6eb1bf40dadbf9e2cc1487fa0fcfcfcfe2ebc3a05beea9d0c6` | 胶囊安全区与旧后端放弃登录兼容候选二维码 |
| `/private/tmp/xinqing-login-safe-preview-20260831.json` | `d67c4318a1d8e663c62404f2a75071ece51ab4909c4da9809721d532a0f00c7e` | 新二维码的微信开发者工具信息 |
| `/private/tmp/xinqing-login-color-blend-preview-20260831.png` | `6f27c33543ad2fb8ca03608eeef333285876833cb2947884120d75400a00ea88` | 动态顶色接缝修复二维码，已被资料退出修复包替代 |
| `/private/tmp/xinqing-login-color-blend-preview-20260831.json` | `fd6aa338be1346d19e3fbad9fc03ae41ce8f88949cea3290142bd8e4c1a63feb` | 被替代二维码信息，包大小 1,822,560 bytes |
| `/private/tmp/xinqing-profile-exit-preview-20260831.png` | `359c6b74832ac2092de8e2cea91cd941246543b7ea7b11631e7faa3a2d4659c0` | 资料服务版本不匹配提示二维码，已被本机立即退出修复包替代 |
| `/private/tmp/xinqing-profile-exit-preview-20260831.json` | `fe889c604a7f6548d59e80646604bb8a0f3bb2c91dcf687e6850f5f90be9fb77` | 被替代二维码信息，包大小 1,822,931 bytes |
| `/private/tmp/xinqing-profile-local-exit-preview-20260831.png` | `d510480748edcf41c22c605c872e9694a0dd4db40271dc77f7ef6fca41c808a8` | “放弃登录”本机立即退出的最新预览二维码 |
| `/private/tmp/xinqing-profile-local-exit-preview-20260831.json` | `48b173a9d3b80308da1d6e44148b3679bfc81498f9ce7e1da2edeb82b6971978` | 最新二维码信息，包大小 1,822,602 bytes |

并排复核确认：登录弹层起点、24px 左右内边距、342px 主按钮宽度、按钮顺序和背景亮度同真。微信原生 checkbox 在模拟器中仍为方形，而 Figma 画稿使用圆形同意控件；该差异不影响同意语义，未在本次仅限按钮宽度、背景亮度和文案同步的切片中重做控件。

### 当前登录流程与设置页逐页验收（2026-09-01）

Figma 文件 `慢聊小记 · 登录注册流程` 已按当前公开方案完整同步：微信登录、微信手机号登录、游客模式；头像和昵称为登录后的可选资料，资料页使用“稍后再说”；短信登录仍保留在代码中，但当前入口不展示。Figma 新增并补齐了“已登录设置”和“游客设置”两页，分别对应账号连接/个人资料/注销/退出，以及游客模式/隐私/反馈的真实页面状态。

小程序同步修复三处弹层主按钮宽度：微信手机号授权、游客确认、游客身份确认。三者现在都清除原生按钮的左右 margin，并在弹层内容宽度内横向撑满；专项检查对该规则做了固定断言。

微信开发者工具中实际走通并截图的本地合成流程为：登录选择 → 微信登录直达“我的” → 已登录设置 → 可选资料 → “稍后再说”返回 → 退出登录回到登录选择；以及登录选择 → 游客确认 → 游客身份 → 游客“我的” → 游客设置。所有下列截图均从模拟器设备区域直接截取，不含 Codex、桌面通知或调试浮层：

| 页面 | Figma 文件（SHA-256） | 开发者工具文件（SHA-256） | 结论 |
| --- | --- | --- | --- |
| 登录选择 | `/private/tmp/figma-current-login.png` (`161e9635ae73e72e282b61721c87ff4925e0eb00628f4ca0b19ac443a4a905e2`) | `/private/tmp/xinqing-devtools-registration-flow/01-choice-after-logout.png` (`8a7e14bee28c1e9ccdf97683c64a122c6df32b3ca8b9b732a00d9b4e3d68a38e`) | 文案、顺序、背景和按钮宽度同真 |
| 微信手机号 | `/private/tmp/figma-current-phone.png` (`d17066a0cb845a2e7f82015e08691147b9bd06161d527ad6ad95f0700731f625`) | `/private/tmp/xinqing-devtools-registration-flow/05-wechat-phone.png` (`9033b57aa96a1f934fa0ce9313682309071b6080e12c1a94e940a460565cfbd4`) | 授权按钮全宽；真实手机号凭证仍需真机 |
| 可选资料 | `/private/tmp/figma-current-profile.png` (`2aba313985318582693425ecc54a3d7900a9c6f43b0e8c455c61e7244bb12e63`) | `/private/tmp/xinqing-devtools-registration-flow/03-optional-profile.png` (`27dc9bc7d82988b84696d8aecf2931fd65b89d3657f0e8b1042c047384fb6b6d`) | 可选语义和“稍后再说”同真 |
| 已登录“我的” | `/private/tmp/figma-current-auth-me.png` (`a1ce5e2db34ca8b73788252a9aab7202bf17f2a79cc9e49e64a44dc68068a4e6`) | `/private/tmp/xinqing-devtools-registration-flow/02-wechat-direct-me.png` (`3249e2d9598d15bc3814c8546ad85c993cf7f1df173c5e4d6272374c1d682b28`) | 登录证据、设置入口、观察入口和层级同真 |
| 已登录设置 | `/private/tmp/figma-current-auth-settings.png` (`39fb397252d150d86f49854ec438584bf5d266442db3dde2b93bf277394794e9`) | `/private/tmp/xinqing-devtools-registration-flow/04-settings-authenticated.png` (`eb0c435bd857884e288e3f6d97a53328a25812bf1343574d8cdf6e62c45f6554`) | 账号连接、资料、隐私、反馈、注销和退出同真 |
| 游客确认 | `/private/tmp/figma-current-guest-warning.png` (`42e4a88158382f1ba146f07eb9e4fa4b95a301754de85bd74203d61a08a72dd2`) | `/private/tmp/xinqing-devtools-registration-flow/07-guest-warning.png` (`73c49fb7b98e97d8edf50389943eacf86d989ae32a1c0a49f2d25b329995262c`) | 两个动作与全宽主按钮同真 |
| 游客身份 | `/private/tmp/figma-current-guest-identity.png` (`57929296e059665f660513a17d46edafb1e9115f4c717a151474cd326be66205`) | `/private/tmp/xinqing-devtools-registration-flow/08-guest-identity.png` (`58e861da6b64893720b8fdd2f0e08eed3a03a2bf3e15a60953baab4f1b43f8a0`) | 本地身份、返回入口与全宽主按钮同真 |
| 游客“我的” | `/private/tmp/figma-current-guest-me.png` (`d804642380fdc75dd8692b3bc1039298324f5ea621a5a475299f26447a8fbcb0`) | `/private/tmp/xinqing-devtools-registration-flow/09-guest-me.png` (`f15be1fe251a6ff44ea2b1ef84d4f8c6d43c337b6c6ffe13c243b07f40050bf7`) | 本地保存提示、设置入口和观察入口同真 |
| 游客设置 | `/private/tmp/figma-current-guest-settings.png` (`e5b774647cb8c79ee0bef46f60794ac62e32d83aa547f1f53caebfba05201480`) | `/private/tmp/xinqing-devtools-registration-flow/10-settings-guest.png` (`35df4d6fec8fe80ab9cb15accbefcd28f6282386c8c4a18aaada54388a694d8b`) | 游客状态、隐私和反馈同真 |

逐页复核允许微信原生状态栏、胶囊和字体栅格化造成的设备差异；不允许内容、状态、操作顺序或按钮宽度偏离。已登录设置在真实小程序中沿用现有紧凑分组，Figma 使用相同信息层级的设计稿表达，未发现遮挡、横向溢出或不可达操作。

微信开发者工具不能签发真实 `getPhoneNumber` 动态凭证，因此本轮只能证明微信手机号页面、授权按钮和错误恢复状态正确，不能替代 iOS/Android 真机上的真实手机号授权成功证据。

## 生产只读核验

- 当前生产应用 release：`5625262`；不是本候选。
- 当前生产数据库：19 个 migration，schema up to date；本候选需要 21 个。
- PM2 应用、数据库健康检查、账号注销清理 timer 和备份 timer 当前在线/成功。
- Qwen、数据库、Session、微信、上传和账号注销清理密钥均只核验为已设置；没有读取或记录其值。
- 腾讯云短信生产参数当前全部缺失：Secret ID/Key、SMS SDK App ID、签名和验证码模板均未配置。

统一登录页已不再公开或提供可达的短信入口。微信身份账号（包括同时绑定手机号的账号）注销时重新验证微信身份；只有真正的 phone-only 账号仍保留短信注销。生产短信配置全缺失对当前候选不再是硬阻断，但一旦出现部分短信配置，环境审计仍必须失败。

## 尚未完成

1. 使用新二维码完成微信、微信手机号、游客三条当前公开登录路径的真机复核，并确认页面没有可达的短信登录入口。
2. 部署前确认可恢复备份；在生产应用 21 个 migration，构建并切换到本候选，再核对 migration、PM2、health、cleanup timer 和错误日志。
3. 部署后运行基础 Smoke 与微信/微信手机号登录、资料完成、头像、小记、聊天、观察、注销、文件清理和跨账号隔离的合成主链路 Smoke。
4. 在微信公众平台核对 request/upload/download 合法域名、隐私保护指引、服务类目和体验成员；上传精确候选开发版并保存版本/包绑定证据。
5. iOS 与 Android 各至少一台真机执行 `docs/RELEASE_TEST_CHECKLIST.md` 第 5.2 节完整矩阵，之后才可提交审核。
6. 后续启用短信登录时，单独完成腾讯云短信应用、签名、登录/注销模板、生产凭据和真实收码验证。
7. Composer 三自然日、至少 200 次 Hot streaming 延迟门仍为延后监控项；当前只有 Day 1 的 70 次成功样本，不得写成三日 PASS。

## 证据边界

- 未提交或输出 API Key、Base URL、数据库 DSN、短信密钥、微信 code/openid/session key、手机号、OTP、Cookie 或 token。
- 未使用真实用户聊天、小记、图片或生产用户记录。
- 未执行生产 migration、部署、微信开发版上传或审核提交。
