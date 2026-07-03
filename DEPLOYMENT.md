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

## 已完成

- [x] 独立生产目录已创建，不影响旧的 `xinqing.studio` 测试服务。
- [x] 生产 `.env` 已写入服务器受限目录，未进入 git。
- [x] 生产 PostgreSQL 账号和数据库已创建。
- [x] Prisma migration 已部署。
- [x] Next.js 生产构建通过。
- [x] PM2 进程 `manliaoxiaoji` 已启动并保存。
- [x] Nginx HTTP 站点已配置。
- [ ] DNS / HTTPS 当前需复核：2026-07-02 从本地检查 `manliaoxiaoji.com` 解析失败，直连服务器 IP 带 Host 返回 DNSPod webblock。
- [x] HTTPS 证书历史记录：Let's Encrypt 曾签发并启用，解除 DNSPod webblock 后需重新验证证书链和跳转。
- [ ] 生产健康检查当前需复核：域名恢复后确认 `/api/health` 返回 `database: connected`。
- [x] `/uploads/` 静态文件映射已验证。

## 待完成

- [ ] HTTPS 生效后，在微信公众平台配置合法域名。
- [ ] 配置生产数据库备份。
- [ ] 配置生产 AI Provider，例如 `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`，或 `AI_PROVIDER=zhipu` + `ZHIPU_API_KEY`。
- [ ] 解除 DNSPod webblock 后运行 `npm run smoke:prod`。

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

`smoke:prod` 会检查生产健康检查、匿名鉴权和微信登录参数校验。2026-07-02 当前失败原因为 `ENOTFOUND manliaoxiaoji.com`，属于域名解析 / DNSPod webblock 阻塞。

## HTTPS 证书命令

已执行：

```bash
sudo certbot --nginx -d manliaoxiaoji.com -d www.manliaoxiaoji.com
```
