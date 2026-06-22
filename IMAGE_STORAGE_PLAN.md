# 新晴图片存储方案

## 当前结论

当前小程序已经支持选择图片、最多 9 张、详情页宫格展示和预览，但“图片上传/持久化”还没有真正闭环。

后端 `Note` 模型已有 `mediaUrls` 字段，`POST /api/notes` 也只接受 `mediaUrls` 数组；小程序当前提交小记时仍在传 `images`，因此登录用户的小记图片不会按后端契约持久化。

## P0 内测方案

先采用服务端中转上传，避免一次性接入复杂对象存储：

1. 新增 `POST /api/uploads/notes`
2. 小程序使用 `wx.uploadFile` 上传图片
3. 后端校验登录态、文件类型、大小和数量
4. 后端保存到服务器持久目录
5. 接口返回可访问的 HTTPS 图片 URL
6. 小程序创建小记时把这些 URL 写入 `mediaUrls`
7. 历史页和详情页统一读取 `mediaUrls`

建议环境变量：

- `UPLOAD_DIR`: 服务器本地持久化目录，例如 `/var/www/xinqing/uploads`
- `UPLOAD_PUBLIC_BASE_URL`: 图片访问根地址，例如 `https://xinqing.studio/uploads`
- `MAX_NOTE_MEDIA_COUNT`: 默认 `9`
- `MAX_NOTE_IMAGE_SIZE_MB`: 默认 `10`

## 接口契约

上传：

```http
POST /api/uploads/notes
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

返回：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "url": "https://xinqing.studio/uploads/notes/xxx.jpg",
        "type": "image",
        "size": 123456
      }
    ]
  }
}
```

创建小记：

```json
{
  "content": "今天的一句话",
  "moodName": "晴晴",
  "moodIcon": "sun",
  "mediaUrls": [
    "https://xinqing.studio/uploads/notes/xxx.jpg"
  ]
}
```

## 安全要求

- 上传接口必须要求登录
- 游客模式只允许本地临时图片，不上传服务器
- 不信任原始文件名，后端生成随机文件名
- 只允许图片 MIME 类型
- 限制单文件大小和总数量
- 不在日志中打印 token、图片原始路径或用户敏感内容

## 后续升级

5-20 人内测可以先用服务器本地存储。进入更大规模测试前，建议迁移到对象存储，例如腾讯云 COS 或阿里云 OSS，并改为服务端签名上传。

## 下一步实施清单

1. 新增后端上传接口
2. 小程序新增 upload API client
3. 小程序保存小记前先上传图片
4. `api/notes.js` 从 `images` 改为 `mediaUrls`
5. 历史页/详情页统一读取 `mediaUrls`
6. 真机验证上传、预览、保存图片和弱网失败提示
