# Cloud Nine — 无限容量云盘

基于 **Telegram Bot API** 的免费无限容量多用户云盘。文件存储在 Telegram 超级群组中，前端 React SPA 部署在 Cloudflare Pages，后端 Hono 运行在 Cloudflare Workers。

## ✨ 特性

- **无限容量** — 文件存储在 Telegram，免费且无容量上限
- **多用户隔离** — Telegram Forum Topic 天然隔离每个用户的数据
- **大文件分卷上传** — WebSocket 实时上传，45MB/卷，支持任意大小文件
- **流式下载** — 分块下载 + 自动 Token 刷新 + 指数退避重试，带进度条
- **分享链接** — 支持单文件/多文件/文件夹分享，提取码+有效期+下载次数保护
- **文件夹分享** — 动态实时同步，分享者增删文件即时反映；支持子文件夹浏览
- **批量操作** — 多选文件后一键分享/下载(.zip)/移动/删除
- **文件管理** — 文件夹、回收站、搜索、重命名、移动、拖拽上传
- **图片/视频预览** — 大文件流式预览，支持 Range 拖动进度条
- **管理后台** — 用户管理、存储统计
- **现代 Web UI** — 123云盘风格设计系统，桌面表格/网格双视图 + 移动端适配

## 🛠 技术架构

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     Bot API      ┌──────────┐
│  React SPA  │ ◄──────────────► │  Hono Worker  │ ◄──────────────► │ Telegram │
│  (Pages)    │                  │  (Workers)    │                  │  (文件)   │
└─────────────┘                  └──────┬───────┘                  └──────────┘
                                       │
                                  ┌────┴────┐
                                  │ KV + D1 │
                                  │ (元数据) │
                                  └─────────┘
```

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript 5 + Zustand + Tailwind CSS 3 + Framer Motion + Lucide Icons + JSZip |
| 后端 | Hono (CF Workers) + TypeScript + WebSocket |
| 存储 | Telegram Supergroup + Cloudflare KV + D1 |
| 认证 | JWT (HS256) + PBKDF2 密码哈希 + 自动 Token 刷新 |
| 部署 | Cloudflare Pages + Workers（同域 `<your-domain.com>`） |

## 📦 大文件上传架构

```
多文件串行队列 → 逐个上传
    ↓
≤10MB → HTTP 直传 → sendDocument → TG
>10MB → HTTP 分块(10MB) → 多个 sendDocument + record → TG
>95MB → WebSocket 分卷(45MB) → Worker flush(5~16MB) → sendDocument → TG
        全部卷完成 → complete → record → KV 元数据
```

- 多文件上传采用**前端串行队列**：全部显示在 TransferManager，逐个执行，避免并行打爆 TG 20条/分钟限制
- 分卷大小 45MB，帧大小 256KB，发送间隔 65ms（~4MB/s）
- 每个 flush 限制 5~16MB，setTimeout(0) 防止 Worker Hung

## 🔒 下载架构

```
小文件(≤10MB): 直接流式转发 Telegram CDN
大文件(>10MB): 分 chunk 串行下载 + Blob 拼接 + 进度条
              每个 chunk 支持指数退避重试 + api.rawFetch 自动 Token 刷新
多选下载:     逐个文件下载 → JSZip 前端打包 .zip → 自动保存
分享批量下载: 同上，走分享 API 认证
```

## 🚀 部署

### 前置准备

1. **Telegram Bot** — 在 [@BotFather](https://t.me/BotFather) 创建 Bot，获取 `TELEGRAM_BOT_TOKEN`
2. **Telegram 超级群组** — 创建一个 Supergroup，将 Bot 拉入并设为管理员，获取 Chat ID（格式 `-100xxxxxxxxxx`）。Chat ID 可在 Web 版 TG 的 URL 中看到，或通过 `https://api.telegram.org/bot<TOKEN>/getUpdates` 查看
3. **Cloudflare 账号** — 开通 Workers 和 Pages（免费额度足够日常使用）
4. **域名**（可选） — 绑定自定义域名到 Pages + Workers，实现同域部署

### 1. 创建 Cloudflare 资源

在 [Cloudflare Dashboard](https://dash.cloudflare.com) 依次创建：

**KV 命名空间：**
- 进入 **Workers & Pages → KV**，点击 **Create namespace**
- 名称随意（如 `tgdrive-kv`），记录生成的 `namespace_id`

**D1 数据库：**
- 进入 **Workers & Pages → D1**，点击 **Create database**
- 名称填 `tgdrive-db`，记录生成的 `database_id`
- 创建后进入数据库 → **Console**，依次执行以下 SQL：
  ```sql
  -- 粘贴 worker/migrations/0001_init.sql 的全部内容
  ```
  ```sql
  -- 粘贴 worker/migrations/0002_admin_index.sql 的全部内容
  ```

### 2. 部署 Worker（后端）

```bash
cd worker
npm install

# 构建
npx esbuild src/index.ts --bundle --format=esm --target=es2022 \
  --outfile=dist/worker.js --platform=browser --external:cloudflare:workers
```

然后在 Cloudflare Dashboard：
- **Workers & Pages → Create → Create Worker**，名称随意（如 `tgdrive-api`）
- 上传 `dist/worker.js`（或通过 CLI `npx wrangler deploy`）
- 进入 Worker → **Settings → Variables**，添加以下内容：

**普通变量（Variables）：**

| 变量名 | 值 |
|--------|-----|
| `TELEGRAM_CHANNEL_ID` | 超级群组 Chat ID（如 `-100xxxxxxxxxx`） |
| `ENVIRONMENT` | `production` |

**密钥（Secrets）：**

| 变量名 | 说明 |
|--------|------|
| `TELEGRAM_BOT_TOKEN` | Bot Token（BotFather 获取） |
| `JWT_SECRET` | access_token 签名密钥（随机字符串，如 `openssl rand -hex 32`） |
| `JWT_REFRESH_SECRET` | refresh_token 签名密钥（同上，另一个随机串） |
| `ADMIN_PASSWORD` | 管理后台登录密码 |
| `WEBHOOK_SECRET` | Webhook 验证密钥（随机字符串） |

**绑定（Bindings）：**
- 添加 **KV Namespace** → 变量名 `METADATA_KV` → 选择前面创建的 KV
- 添加 **D1 Database** → 变量名 `DB` → 选择 `tgdrive-db`

> 也可以用 `wrangler.jsonc` + `npx wrangler deploy` 一键部署，参考 `worker/wrangler.jsonc`（记得替换 KV/D1 的 ID）。

### 3. 部署 Pages（前端）

```bash
cd frontend
npm install
npm run build   # 产物在 dist/ 目录
```

在 Cloudflare Dashboard：
- **Workers & Pages → Create → Pages → Upload assets**
- 上传 `frontend/dist/` 目录
- 项目名称随意（如 `tgdrive`）
- 部署完成后 → **Settings → Environment variables**，添加：

| 变量名 | 值 |
|--------|-----|
| `VITE_API_BASE` | `https://<your-domain.com>/api`（或 Worker 默认域名 `/api`） |

### 4. 同域配置（可选）

让前端和 API 共享同一域名，避免跨域问题：
- 在 Pages 的 **Custom domains** 中添加你的域名（如 `drive.example.com`）
- 在 Worker 的 **Triggers → Routes** 中添加路由：`drive.example.com/api/*`
- 前端会自动通过相对路径 `/api/*` 访问 Worker

### 5. 验证

1. 浏览器打开 Pages 域名 → 注册账号 → 登录
2. 上传一个文件 → 确认能在 Telegram 群组中看到对应消息
3. 访问 `GET /api/admin/migrate`（需 Admin 认证）回填 KV 数据到 D1（仅首次）

## 📖 开发文档

详见 [DEVDOC.md](./DEVDOC.md) — 包含完整 API 路由表、存储架构、上传/下载架构、设计系统文档。

## 🌐 中国访问优化

- 自定义域名绑定 Pages + Workers

## 📄 许可

MIT License
