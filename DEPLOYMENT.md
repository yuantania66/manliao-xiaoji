# 慢聊小记生产部署记录

## 当前生产服务器

- 云厂商：腾讯云 CVM
- 公网 IP：`106.54.21.202`
- 系统：Ubuntu 24.04.4 LTS
- SSH 用户：`ubuntu`
- 应用目录：`/var/www/manliaoxiaoji/app`
- 共享环境变量：`/var/www/manliaoxiaoji/shared/.env`
- 上传目录：`/var/www/manliaoxiaoji/uploads`
- PM2 进程：`manliaoxiaoji`
- 应用端口：`3100`
- Nginx：`manliaoxiaoji.com` / `www.manliaoxiaoji.com` 反代到 `127.0.0.1:3100`
- HTTPS 证书：Let's Encrypt，路径 `/etc/letsencrypt/live/manliaoxiaoji.com/`
- 数据库：本机 PostgreSQL，库名 `manliaoxiaoji`

## 2026-08-27 当前发布

- 生产版本：`dcb5515`（PR #33）
- 当前目录：`/var/www/manliaoxiaoji/releases/dcb5515`
- 回滚版本：`/var/www/manliaoxiaoji/releases/e8e109a`
- Next.js Build ID：`5-sFv3DLAWfG_fKqzMNZ6`
- 生产数据库：19 个 migration 已应用，无待执行 migration
- PM2：`manliaoxiaoji` 已切换并重启，`/api/health` 返回 production / database connected
- 线上 smoke：健康检查、匿名鉴权、微信空参数、游客主动问候、真实 Qwen 合成“你好”均通过
- 注销文件清理：`manliaoxiaoji-account-cancellation-cleanup.timer` 已启用，最近一次执行成功
- 数据库备份：`manliaoxiaoji-postgres-backup.timer` 已启用，每日执行；首份备份已通过 `pg_restore --list` 完整性检查
- 小程序预览：合入 main 的体验版编译通过，包体 164.4 KB

## 已完成

- [x] 独立生产目录已创建，不影响旧的 `xinqing.studio` 测试服务。
- [x] 生产 `.env` 已写入服务器受限目录，未进入 git。
- [x] 生产 PostgreSQL 账号和数据库已创建。
- [x] Prisma migration 已部署。
- [x] Next.js 生产构建通过。
- [x] PM2 进程 `manliaoxiaoji` 已启动并保存。
- [x] Nginx HTTP 站点已配置。
- [x] DNS / HTTPS 已恢复并复核，`https://manliaoxiaoji.com` 可访问。
- [x] HTTPS 证书已启用；线上 smoke 通过域名 HTTPS 完成。
- [x] 生产健康检查已复核，`/api/health` 返回 `database: connected`。
- [x] `/uploads/` 静态文件映射已验证。

## 待完成

- [x] 生产域名 `https://manliaoxiaoji.com` 已启用 HTTPS；微信公众平台合法域名仍需在提审前由管理员最终核对。
- [x] 已配置每日生产数据库备份与生成后完整性检查；当前不自动删除旧备份，保留周期另行确认。
- [x] 生产 AI Provider 已配置为 Qwen；不记录密钥或 Base URL。真实合成游客问候与聊天已通过。
- [x] 已运行 `npm run smoke:prod`，3/3 通过。
- [x] 已配置注销文件清理 secret 与 systemd timer。
- [ ] 腾讯云短信签名与正文模板尚未配置；当前版本隐藏手机号登录，审核材料明确按微信登录上线。
- [ ] 完成微信体验版真机人工验收并提交审核。
- [ ] Composer 第 3 个自然日延迟采样完成前，按已批准的限量上线方案保持 pending 并监控。

## 常用命令

```bash
ssh ubuntu@106.54.21.202

pm2 status
pm2 logs manliaoxiaoji --lines 100
pm2 restart manliaoxiaoji

curl http://127.0.0.1:3100/api/health
curl -H "Host: manliaoxiaoji.com" http://127.0.0.1/api/health
```

## 上线前自动化

本地代码侧发布检查：

```bash
npm run check:launch
npm run smoke:local-api
```

服务器生产环境变量审计：

```bash
PROD_ENV_FILE=/var/www/manliaoxiaoji/shared/.env npm run audit:prod-env
```

域名恢复后的生产 smoke：

```bash
npm run smoke:prod
```

`smoke:prod` 会检查生产健康检查、匿名鉴权和微信登录参数校验。2026-08-27 已在 `dcb5515` 上通过；另以纯合成数据验证了游客主动问候和真实 Qwen “你好”聊天链路，检查输出不含回复正文、密钥或 Base URL。

## HTTPS 证书命令

已执行：

```bash
sudo certbot --nginx -d manliaoxiaoji.com -d www.manliaoxiaoji.com
```
