# 慢聊小记上线就绪报告

日期：2026-07-02  
项目路径：`/Users/yuanyuanyuan/projects/xinqing 2.0`  
结论：代码侧主干自动化检查已恢复并通过；正式域名当前不可用，仍是上线 P0 阻塞。

## 总结

今天完成了四类上线前工作：修复伪登录兜底风险、恢复非交互式 lint 工具链、补强“慢慢说”对用户真实意图的理解层并跑通评测、把上线检查固化为脚本和 CI。当前最主要阻塞不在样式或单点补丁，而在外部生产域名：`manliaoxiaoji.com` 从当前环境无法解析，直连服务器 IP 并带 Host 会被 DNSPod webblock 拦截。

在正式域名健康检查恢复前，不建议上传正式版或提交审核。体验版也应先确认合法 request 域名和真机请求链路。

## 已完成

- 小程序 API 默认环境已是 `prod`，体验版/正式版均指向 `https://manliaoxiaoji.com`。
- 小程序“我的”页微信登录失败后不再写入 `local_demo_` 假 token，也不再展示伪已登录状态。
- Web 首页登录失败后不再写入 `local_demo_` 假 token；失败会清理登录态并转入游客模式。
- 聊天 AI 已回到 base-model 模式：产品底座 prompt + 清洗后的历史 + 当前输入，旧理解/策略/judge/rewrite/RAG 架构已从主链路移除。
- 历史上下文会按 `promptVersion` 过滤旧架构 assistant 回复，避免旧模板继续影响基模输出。
- `npm run lint` 已从废弃的 `next lint` 改为非交互式 `eslint .`，适合本地和 CI 执行。
- 已补齐 ESLint flat config，并排除 `.next`、`node_modules`、上传目录、小程序工程、发布包等非扫描目标。
- 新增 `npm run check:launch`，一次执行 lint、预发布审计、Prisma validate、小程序 JS 语法检查和 Next build。
- 新增 `npm run check:ai-base`，本地断言 base-model prompt、旧历史过滤、debug 路由和旧架构防回归。
- 新增 `npm run smoke:local-api`，自动启动本地生产服务并跑真实 API 主链路，结束后清理测试用户和上传文件。
- 新增 `npm run smoke:prod`，用于域名恢复后复核生产健康检查、匿名鉴权和微信登录参数校验。
- 新增 `npm run audit:prod-env`，用于服务器上检查生产 `.env` 是否仍有占位值、mock、短 `SESSION_SECRET`、本地上传路径等问题。
- 新增 GitHub Actions CI，PR 和 main/master push 会运行 `npm run check:launch`。

## 自动化结果

| 检查 | 结果 | 备注 |
| --- | --- | --- |
| `npm run lint` | 通过 | 已修复 React hooks 依赖和未使用代码 |
| `npm run audit:prelaunch` | 通过 | 检查小程序默认 API、伪登录 token、Web mock 登录默认关闭、开发测试入口 guard |
| `npm run check:ai-base` | 通过 | base-model prompt、旧历史过滤、debug 路由和旧架构防回归通过 |
| `npm run check:launch` | 通过 | lint、audit、AI base、Prisma、小程序 JS、build 一次跑通 |
| `npm run build` | 通过 | Next 生产构建成功 |
| `npx prisma validate` | 通过 | Prisma schema 有效 |
| 小程序 JS 语法检查 | 通过 | 所有 `miniprogram-project/**/*.js` 通过 `node --check` |
| AI 会话评测 | 通过 | 场景评测 `120/120`，直接探针 `3/3`，`qualityWarnings: 0` |
| `npm run smoke:local-api` | 通过 | 匿名鉴权、验证码登录、小记 CRUD、图片上传、聊天、搜索、日历、退出登录 |
| `npm run smoke:prod` | 未通过 | `ENOTFOUND manliaoxiaoji.com`，与正式域名 P0 阻塞一致 |
| `SMOKE_BASE_URL=http://127.0.0.1:3300 npm run smoke:prod` | 通过 | 本地生产构建服务通过 3 项 smoke，证明脚本可用 |
| `npm run audit:prod-env` | 本地预期失败 | 本地 `.env` 不是生产配置；服务器应使用 `PROD_ENV_FILE=/var/www/manliaoxiaoji/shared/.env` 复核 |

## 当前 P0 阻塞

### 正式域名不可用

复核命令：

```bash
curl -I https://manliaoxiaoji.com/api/health
curl -i -H 'Host: manliaoxiaoji.com' http://106.54.21.202/api/health
```

结果：

- `manliaoxiaoji.com` 和 `www.manliaoxiaoji.com` DNS 解析失败。
- 直连 `106.54.21.202` 并带 `Host: manliaoxiaoji.com` 返回 DNSPod webblock 跳转。
- `npm run smoke:prod` 三项全部失败，错误为 `code=ENOTFOUND, hostname=manliaoxiaoji.com`。
- 同一个 smoke 脚本指向本地生产构建服务 `http://127.0.0.1:3300` 可以通过，说明失败点在正式域名可达性。

上线影响：

- 小程序体验版/正式版无法可靠访问生产 API。
- 微信后台合法 request 域名即使已配置，也无法代表真实链路可用。
- 生产健康检查、微信登录、小记上传、慢慢说、注销等核心路径都不能算线上闭环通过。

建议处理：

1. 登录 DNSPod / 腾讯云检查域名状态、解析记录、备案接入和 webblock 原因。
2. 解除拦截后确认 `https://manliaoxiaoji.com/api/health` 返回 production 和 database connected。
3. 再用微信开发者工具与 iOS/Android 真机跑主链路。

## 仍需人工确认

- 小程序主体认证已完成。
- 服务类目与“日常陪伴与记录工具”一致，不误选医疗诊疗类目。
- 生产环境变量已在服务器配置：`DATABASE_URL`、`SESSION_SECRET`、`APP_ENV=production`、`AI_PROVIDER`、模型 API Key。
- 生产数据库日志、备份和恢复策略已确认。
- 真实 AI provider API Key 已验证，不只走 mock/fallback。
- 微信开发者工具能编译预览 `miniprogram-project`。
- iOS 和 Android 真机完整测试通过。

## 工具链备注

本机安装 ESLint 依赖时，`eslint-visitor-keys@5.0.1` 对当前 Node `v23.11.1` 给出 engine warning；安装成功且 lint/build 均通过。后续 CI 建议使用 Node 22 LTS 或满足依赖声明的 Node 24+，减少工具链噪音。

## AI 回复质量备注

本轮针对“机械接话”的核心问题做了两层处理：

- 规则层：新增会话理解断言，覆盖数字语境、纠正修复、边界、短回应、危机信号等 8 类用户动作。
- 行为层：优化本地 mock/fallback，避免危机场景过度官方命令、避免数字短答机械重复、避免历史里的“别编场景”让后续回复卡在修复模板。

最新 `AI_EVAL_BASE_URL=http://127.0.0.1:3200 AI_EVAL_SCENARIOS=12 AI_EVAL_TURNS=10 npm run eval:ai` 结果：`120/120` 通过，直接探针 `3/3` 通过，`qualityWarnings: 0`。

## 下一步建议

1. 先解正式域名 / DNSPod webblock，这是当前最短上线路径里的硬阻塞。
2. 域名恢复后跑生产健康检查和小程序真机主链路。
3. 域名恢复后运行 `npm run smoke:prod`，确认生产 API 至少通过健康检查、匿名鉴权和基础参数校验。
4. 在服务器上运行 `PROD_ENV_FILE=/var/www/manliaoxiaoji/shared/.env npm run audit:prod-env`，确认生产密钥、上传目录和 AI provider 不再是占位或本地配置。
5. 真实 AI Key 配好后补一轮“慢慢说”线上质量抽样，重点看是否能理解用户未说出口的需要，而不是机械接话。
