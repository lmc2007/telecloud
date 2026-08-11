# AGENTS.md — Cloud Nine 开发指引

## 项目概述

基于 Telegram Bot API 的无限容量多用户云盘。前端 React SPA (Cloudflare Pages)，后端 Hono (Cloudflare Worker)，文件存储于 Telegram 超级群组。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Zustand + Tailwind CSS + Framer Motion + Lucide |
| 后端 | Hono (CF Workers) + TypeScript + WebSocket + esbuild |
| 存储 | Telegram Supergroup (Forum Topic 隔离) + KV (元数据) + D1 (列表/搜索) |
| 认证 | JWT HS256 (Web Crypto) + PBKDF2 密码 |

## 项目结构

```
TG DRIVE/
├── worker/src/
│   ├── index.ts           # 主入口 + WS handler + handleUploadComplete
│   ├── types/index.ts      # 全部类型定义
│   ├── routes/             # Hono 路由 (auth/files/shares/user/admin)
│   ├── handlers/           # upload/download 核心逻辑
│   ├── bot/telegram.ts     # Telegram Bot API 封装
│   ├── storage/kv.ts       # KV CRUD + D1 双写同步
│   └── migrations/         # D1 SQL 初始化脚本
├── frontend/src/
│   ├── pages/              # FileManager / ShareAccessPage / AdminPanel ...
│   ├── components/         # FileTable / FileGrid / ContextMenu / ShareModal ...
│   ├── stores/             # Zustand: authStore / fileStore / transferStore
│   └── lib/api.ts          # ApiClient (auto 401 refresh)
└── DEVDOC.md               # 完整开发文档
```

## 构建命令

```bash
# Worker
cd worker && npm install
npx esbuild src/index.ts --bundle --format=esm --target=es2022 \
  --outfile=dist/worker.js --platform=browser --external:cloudflare:workers

# 前端
cd frontend && npm install
npm run build   # tsc --noEmit && vite build → dist/
```

## 核心架构原则

### KV 主存 + D1 读查询

KV 是文件系统元数据的唯一 System of Record。D1 是读查询路径（文件列表、搜索、存储统计均走 D1）。不一致时以 KV 为准。

- `setFileMeta` / `setFolderMeta` 写入 KV 后 **await** 同步到 D1（不再 fire-and-forget）
- `addChild` / `removeChild` 同时维护 KV 和 D1 的 `parent_kv_id`
- 回收站走 D1 软删除 (`deleted=1`)，KV 元数据保留用于恢复

### 文件夹分享（动态实时同步）

文件夹分享不拍快照：每次 `GET /s/:token` 实时查询 D1 当前子项。分享者增删文件即时反映。多文件/单文件分享仍是静态快照。

### 上传

- ≤10MB：HTTP multipart 直传 → 一个 TG 消息
- >10MB ≤95MB：HTTP 分块 → 多个 TG 消息 + JSON record
- >95MB：WebSocket 45MB 卷 → Worker 5~16MB flush → TG → `/complete`

WebSocket 上传已支持断点续传（不关页面范围内），失败后在 TransferManager 点"重试"可跳过已完成卷。

### 下载

- 小文件：流式转发 TG CDN
- 大文件：串行下载分块（失败重试 3 次，指数退避）+ Blob 拼接
- 预览：`serveChunkRange` 轻量 Range，绕过重流逻辑

## 代码约定

- **后端路由**：统一使用 Hono Router，路径 `/api/*`，认证走 `authGuard` 中间件
- **前端 API 调用**：使用 `api.get/post/put/delete` (自动 401 刷新)，二进制下载用 `api.rawFetch`
- **类型**：后端类型在 `worker/src/types/index.ts`，前后端共享接口命名一致
- **样式**：使用 Tailwind + CSS 变量设计系统 (`var(--brand-blue)`, `var(--text-primary)` 等)，组件类定义在 `globals.css` 的 `@layer components`
- **响应式**：`<768px` 为移动端，`useIsMobile()` hook，FileManager 和 ShareAccessPage 均采用 `if (isMobile) return <MobileUI>; return <DesktopUI>` 双轨渲染
- **分享页**：桌面端 Finder 风格全宽布局，移动端卡片列表；新功能需同时适配两端

## 注意事项

- Telegram 20 条/分钟频率限制是核心瓶颈，多文件上传采用前端串行队列
- Cloudflare Workers 子请求限制 50/请求，`serveChunkRange` 控制在 ≤24 次
- D1 同步错误通过 `console.error` 输出到 Worker 日志，不静默吞错
- KV/D1 写入使用 `await` 确保一致性，不依赖 `ctx.waitUntil`
- 敏感信息（域名、KV/D1 ID）已替换为 `<your-domain.com>` 占位符
