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

```bash
# Worker
cd worker && npm install
npx esbuild src/index.ts --bundle --format=esm --target=es2022 \
  --outfile=dist/worker.js --platform=browser --external:cloudflare:workers

# 前端
cd frontend && npm install
npm run build   # tsc --noEmit && vite build → dist/
```

## 📖 开发文档

详见 [DEVDOC.md](./DEVDOC.md) — 包含完整 API 路由表、存储架构、上传/下载架构、设计系统文档。

## 🌐 中国访问优化

- 自定义域名绑定 Pages + Workers

## 📄 许可

MIT License
