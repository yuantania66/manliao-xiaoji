# 微信发布候选证据 — 2026-08-31

## 当前判定

**本地候选已改为短信延后方案；仍未部署或提交微信审核。**

当前短信延后候选的 21 个数据库迁移、完整发布门和生产构建均已通过。公开登录范围已收窄为微信登录、微信手机号登录和游客模式，短信入口暂缓；线上仍运行旧 release `5625262` 和 19 个迁移。因此，本记录只封存本地证据，不把旧线上 Smoke、旧二维码或本地 PASS 写成已经部署。

## 候选身份

- 源码分支：`codex/release-main-integration-20260828`
- 主线基线：`00a3301bd1abf3ddfd482a36746231f3159abe7d`
- 原小程序源码与本地发布门候选：`aeccacd0238bf36be00d6cde90eefb1e6a07bd1c`；本次登录范围变更后该 commit 与二维码均已失效，须在新提交上重新封存。
- 当前工作候选包含统一登录、微信手机号、暂缓公开但保留实现的短信登录、必填资料、头像、小记、聊天、观察、注销及持久删除队列。
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

该结果只属于上述 commit 与隔离数据库，不继承 2026-08-28 旧脏工作区的 13-migration 证据。

## 微信开发者工具预览

微信开发者工具已对 `aeccacd0238bf36be00d6cde90eefb1e6a07bd1c` 对应源码成功生成预览包。预览编译过程中已经修复两项真实工具链问题：超出 2 MB 的登录背景资源，以及微信 WXSS 不支持的通配选择器。

本地临时证据（不提交仓库）：

| 文件 | SHA-256 | 大小 |
| --- | --- | ---: |
| `/private/tmp/xinqing-preview-aeccacd.png` | `1dc1320773c5275cab57cad9fa359458e62f31f8e4f43ab6c02d571510810a09` | 46,689 bytes |
| `/private/tmp/xinqing-preview-aeccacd.json` | `72ef0878bf45341abd06b6f80d84e9d00b8b10a0407c9471db707bbb339202ff` | 130 bytes |

开发者工具报告的小程序包大小为 1,821,179 bytes。该二维码只绑定本地候选；在后端迁移和部署完成前，不得把它作为上线体验版交付。

## 生产只读核验

- 当前生产应用 release：`5625262`；不是本候选。
- 当前生产数据库：19 个 migration，schema up to date；本候选需要 21 个。
- PM2 应用、数据库健康检查、账号注销清理 timer 和备份 timer 当前在线/成功。
- Qwen、数据库、Session、微信、上传和账号注销清理密钥均只核验为已设置；没有读取或记录其值。
- 腾讯云短信生产参数当前全部缺失：Secret ID/Key、SMS SDK App ID、签名和验证码模板均未配置。

统一登录页已不再公开或提供可达的短信入口。微信身份账号（包括同时绑定手机号的账号）注销时重新验证微信身份；只有真正的 phone-only 账号仍保留短信注销。生产短信配置全缺失对当前候选不再是硬阻断，但一旦出现部分短信配置，环境审计仍必须失败。

## 尚未完成

1. 提交当前已通过完整发布门的短信延后候选，并重新生成与精确 commit 绑定的微信预览二维码。
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
