# Cloud Nine — 开发文档

## 项目概述

基于 Telegram Bot API 的无限容量多用户云盘。前端 React SPA (Cloudflare Pages)，后端 Hono (Cloudflare Worker)，存储 Telegram 超级群组（Forum Topic 用户隔离）。**文件系统元数据主存 KV，文件列表/搜索/存储统计/回收站走 D1。**

## 部署地址

- **统一域名**: `<your-domain.com>`（Pages + Worker 同域）
- **Pages**: `<your-domain.com>/`（前端 SPA）
- **App 页面**: `<your-domain.com>/app`（文件管理器）
- **Worker 路由**: `<your-domain.com>/api/*`（API + WebSocket）

## 项目结构

```
TG DRIVE/
├── worker/
│   ├── src/
│   │   ├── index.ts              # 主入口 Hono + WebSocket + 自定义HTTP handler + scheduled()
│   │   ├── types/index.ts        # 全部类型 (Env/User/JwtPayload/FileMetadata/ChunkInfo/ShareInfo...)
│   │   ├── utils/
│   │   │   ├── common.ts         # retryWithBackoff/hash/format/getMimeType
│   │   │   ├── jwt.ts            # JWT HS256 (Web Crypto)
│   │   │   └── password.ts       # PBKDF2 密码哈希 (格式: iterations:salt:hash)
│   │   ├── middleware/
│   │   │   └── auth.ts           # JWT Bearer 认证 + type=access 检查 + KV 黑名单吊销
│   │   ├── routes/
│   │   │   ├── auth.ts           # 注册/登录/刷新/me/登出 (速率限制 + KV 吊销)
│   │   │   ├── admin.ts          # 管理后台 (D1 索引统计 + KV 扫描文件列表 + 下载)
│   │   │   ├── user.ts           # 存储统计/个人信息/改密码
│   │   │   ├── files.ts          # 文件列表/CRUD/回收站/搜索 (文件列表走 D1)
│   │   │   ├── shares.ts         # 分享链接 (KV + D1，含 stream 预览端点)
│   │   │   └── preview.ts        # 预览 token 端点 (GET /api/files/:id/preview)
│   │   ├── handlers/
│   │   │   ├── upload.ts         # uploadSmallFile/uploadLargeFile/uploadFile + UploadSession
│   │   │   ├── download.ts       # streamMergedDownload + directDownload + serveChunkRange(轻量Range) + Range
│   │   │   ├── list.ts           # (遗留)
│   │   │   ├── share.ts          # (遗留)
│   │   │   └── auth.ts           # (遗留)
│   │   ├── bot/
│   │   │   ├── telegram.ts       # sendDocument/caption/getFile/getFileStream/editMessageCaption/ForumTopic
│   │   │   └── webhook.ts
│   │   ├── storage/
│   │   │   └── kv.ts             # KV CRUD + D1 双写 (await 同步，不再 fire-and-forget)
│   │   └── services/
│   │       └── telegram.ts       # TelegramService (多用户路由用)
│   ├── migrations/
│   │   ├── 0001_init.sql         # D1: users/shares/upload_sessions (原始)
│   │   └── 0002_admin_index.sql  # D1: files(重建kv_id PK) + 索引
│   ├── dist/worker.js            # esbuild 打包产物
│   ├── package.json              # hono + esbuild + typescript
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx / App.tsx
│   │   ├── lib/
│   │   │   ├── api.ts              # ApiClient (auto 401 refresh + rawFetch 二进制下载)
│   │   │   └── utils.ts            # fmtSize / fmtDate / kindLabel
│   │   ├── types/
│   │   │   └── ui.ts               # PageView / ViewMode / SortKey / SortDir
│   │   ├── hooks/
│   │   │   └── useIsMobile.ts      # 移动端断点检测 (<768px)
│   │   ├── stores/
│   │   │   ├── authStore.ts        # JWT login/register/autoLogin/logout
│   │   │   ├── fileStore.ts        # 文件 CRUD + 乐观更新
│   │   │   └── transferStore.ts    # 传输状态 (uploadedBytes/speed/chunksDone)
│   │   ├── components/
│   │   │   ├── FileIcon.tsx        # 文件类型图标 (小/大)
│   │   │   ├── ContextMenu.tsx     # 右键菜单 (单选+多选批量操作：下载/分享/移动/删除)
│   │   │   ├── PreviewModal.tsx    # 图片/视频预览 (小文件流式, 大文件 serveChunkRange)
│   │   │   ├── ShareModal.tsx      # 分享弹窗
│   │   │   ├── RenameModal.tsx     # 重命名弹窗
│   │   │   ├── MoveModal.tsx       # 移动到弹窗
│   │   │   ├── SettingsModal.tsx   # 设置弹窗
│   │   │   ├── TransferManager.tsx # 传输管理器浮窗
│   │   │   ├── UploadZone.tsx      # 上传区域 (拖拽 + WS/HTTP)
│   │   │   ├── Sidebar.tsx         # 侧边栏 (存储用量 + 导航)
│   │   │   ├── FileTable.tsx       # 桌面表格视图
│   │   │   └── FileGrid.tsx        # 桌面网格视图
│   │   ├── pages/
│   │   │   ├── Landing.tsx         # 着陆页
│   │   │   ├── Login.tsx           # 登录/注册
│   │   │   ├── FileManager.tsx     # 主文件管理器 (~400行, 状态 + 布局编排, 双轨渲染)
│   │   │   ├── TrashPage.tsx       # 回收站
│   │   │   ├── SharesPage.tsx      # 我的分享
│   │   │   ├── ShareAccessPage.tsx # 公开分享访问页 (/s/:token)
│   │   │   └── AdminPanel.tsx      # 管理后台
│   │   └── styles/globals.css      # Tailwind + 123云盘设计系统
│   ├── public/_redirects / _headers
│   ├── package.json              # react + zustand + framer-motion + lucide + jszip + tailwind + wrangler
│   └── tsconfig.json
├── .github/workflows/
│   └── deploy.yml                # GitHub Actions 自动部署 (push main 触发)
├── deploy.bat                    # 本地一键部署脚本
└── DEVDOC.md
```

## 前端 API 配置

`frontend/src/lib/api.ts` 中 `API_BASE`：
```ts
const API_BASE = import.meta.env.VITE_API_BASE || "https://<your-domain.com>/api";
```

`frontend/.env` 可覆盖，Cloudflare Pages Dashboard 环境变量 `VITE_API_BASE` 也可覆盖。

WebSocket URL 为 `wss://<your-domain.com>/api/ws/upload`。

## 构建命令

```bash
# Worker
cd worker && npm install
npm run build   # esbuild → dist/worker.js

# 前端
cd frontend && npm install
npm run build   # tsc --noEmit && vite build → dist/
```

## 部署

### 自动部署 (GitHub Actions)

`git push` 到 `main` 分支自动触发，`.github/workflows/deploy.yml`。

**首次部署前置步骤（仅一次）**：

```bash
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHANNEL_ID
npx wrangler secret put JWT_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put WEBHOOK_SECRET
```

然后设置 GitHub Secret `CLOUDFLARE_API_TOKEN`（Cloudflare API Token → "编辑 Workers" 模板）。

之后每次 `git push main` 自动执行：
1. 构建并部署 Worker (`tgdrive`) → `wrangler deploy`
2. 构建并部署前端 (`muleng-frontend`) → `wrangler pages deploy`

### 手动部署 (本地脚本)

```bash
# 项目根目录 .env 中设置:
# CLOUDFLARE_API_TOKEN=xxx

deploy.bat   # 依次构建并部署 Worker + 前端
```

或单步部署：

```bash
# Worker
cd worker && npm run build && npm run deploy

# 前端
cd frontend && npm run build && npm run deploy
```

---

## 前端设计系统（123云盘风格）

### 设计令牌

| Token | 色值 | 用途 |
|-------|------|------|
| `--brand-blue` | `#1677FF` | 品牌主色：按钮、链接、选中态 |
| `--brand-blue-hover` | `#4096FF` | 主色悬停 |
| `--brand-blue-active` | `#0958D9` | 主色按下 |
| `--brand-blue-light` | `#E8F3FF` | 主色浅底 |
| `--brand-red` | `#F53F3F` | 危险操作 |
| `--brand-green` | `#00B578` | 成功/音频 |
| `--brand-orange` | `#FF8F1F` | 警告/压缩包 |
| `--bg-primary` | `#F5F6F7` | 页面背景 |
| `--bg-secondary` | `#FAFBFC` | 表头/状态栏背景 |
| `--text-primary` | `#1F2329` | 主要文字 |
| `--text-secondary` | `#646A73` | 次要文字 |
| `--text-tertiary` | `#8F959E` | 辅助文字 |
| `--text-disabled` | `#BCC0C6` | 禁用/占位 |
| `--border-light` | `#E5E6EB` | 轻边框 |
| `--border-default` | `#DCDEE0` | 默认边框 |

字体栈：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`

### CSS 组件类（`@layer components`）

| 类名 | 用途 |
|------|------|
| `.btn-primary` | 主按钮：蓝底白字、`rounded-md`、`hover:bg-brand-blue-hover`、`active:scale-[0.98]` |
| `.btn-secondary` | 次要按钮：白底边框、hover 蓝边框 + 蓝字 |
| `.btn-ghost` | 幽灵按钮：透明、hover 浅灰背景 |
| `.btn-danger` | 危险按钮：红底白字 |
| `.input-primary` | 输入框：白底 + `border-default`、focus 蓝色边框 + 光晕 |
| `.sidebar-nav-item` | 侧边栏导航项：左侧 3px 透明边框、active 态蓝色竖条 + 浅蓝背景 |
| `.data-table` | 表格：交替行色 (`bg-white`/`bg-secondary`)、hover 蓝底、selected 深蓝底 |
| `.card` | 卡片：白底 + 圆角 + 浅边框 |
| `.card-hover` | 卡片悬停：加深边框 + 阴影 |
| `.modal-overlay` | 模态框遮罩：半透明黑底 |
| `.modal-panel` | 模态框面板：白底 + 圆角 + 阴影 + 边框 |
| `.tab-item` | 标签页：底部 2px 透明边框、active 态蓝色底边 |

### 响应式策略

- **断点**：`md:` (768px) 用于桌面/移动切换
- **双轨渲染**：`useIsMobile()` hook 返回 boolean，FileManager 用 `if/else` 两套 JSX（非 CSS 切换）
- 移动端：卡片列表 + 底部 TabBar（文件/最近/分享/回收站）
- 桌面端：侧边栏 (w-56) + 表格/网格视图 + 顶部工具栏

### 组件架构

FileManager.tsx 从 1275 行瘦身至 ~400 行，子组件独立：

```
FileManager (状态管理 + 布局编排)
├── Sidebar          # 侧边栏：存储用量进度条 + 导航
├── FileTable        # 表格视图：复选框 + 4列排序 + 交替行色 + 多选
├── FileGrid         # 网格视图：卡片 + hover 阴影 + 复选框多选
├── UploadZone       # 拖拽上传 + WS/HTTP 双模式
├── TransferManager  # 右下角传输进度浮窗
├── ContextMenu      # 右键菜单 (单选:重命名/预览/下载/分享/移动/删除, 多选:下载/分享/移动/删除, 支持多文件夹分享)
├── ShareModal       # 分享弹窗 (支持文件/文件夹/多文件/多文件夹分享, 直接 React 树渲染)
├── RenameModal      # 重命名弹窗
├── MoveModal        # 移动到弹窗 (支持批量移动+结果展示)
├── SettingsModal    # 设置弹窗（个人信息 + 改密码）
├── TrashPage        # 回收站页面
├── SharesPage       # 我的分享页面 (显示文件数量)
└── ShareAccessPage  # 公开分享访问页 (/s/:token, 支持文件列表/文件夹浏览/多文件夹+全部下载.zip+←返回)
```

### 存储空间进度条

- Sidebar 挂载时调用 `GET /api/user/storage` 获取真实用量
- 进度条满值：**10 TB**（`10 × 1024⁴` 字节），仅作视觉参考
- 传输完成时自动重新获取并刷新（通过 `transferStore` 的 `done` 计数触发）
- 请求使用 `AbortController`，组件卸载时取消

---

## 环境变量

### Worker Secrets
| 变量 | 说明 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot Token |
| `JWT_SECRET` | access_token 签名密钥 |
| `JWT_REFRESH_SECRET` | refresh_token 签名密钥 |
| `ADMIN_PASSWORD` | 管理后台密码 |
| `WEBHOOK_SECRET` | Telegram Webhook 验证 |

### Worker 普通变量
| 变量 | 说明 |
|---|---|
| `TELEGRAM_CHANNEL_ID` | 超级群组 Chat ID |
| `ENVIRONMENT` | `production` |

### 绑定
| 类型 | 变量名 | 值 |
|---|---|---|
| KV | `METADATA_KV` | 文件系统元数据/JWT吊销/分享/会话/配置 |
| D1 | `DB` | `tgdrive-db` — admin 索引/回收站/分享持久化/用户/上传会话 |

### D1 初始化
1. 执行 `worker/migrations/0001_init.sql`（建 users/shares/upload_sessions 表）
2. 执行 `worker/migrations/0002_admin_index.sql`（重建 files 表 + 索引）
3. 部署后访问 `GET /api/admin/migrate` 回填现有 KV 数据到 D1

---

## 存储架构：KV 主存 + D1 读查询

### 设计原则

KV 是文件系统的唯一 System of Record（元数据写入权威）。**D1 是读查询路径**：文件列表、搜索、存储统计均走 D1，避免 KV 串行读取的性能瓶颈和配额消耗。不一致时以 KV 为准。

### 数据分布

| 数据 | 主存 | D1 同步 | 说明 |
|------|------|---------|------|
| 文件元数据 | KV `file:{id}` | `files` 表 | 写时 **await** 双写（不再 fire-and-forget） |
| 文件夹元数据 | KV `folder:{id}` | `files` 表 | 同上 |
| 父子关系 | KV `child:{parent}:{child}` | `files.parent_kv_id` | addChild/removeChild await 同步 |
| 文件列表 | — | **纯 D1** | `SELECT … WHERE parent_kv_id= ? AND deleted=0` |
| 搜索 | — | **纯 D1** | `SELECT … WHERE name LIKE ? AND deleted=0` |
| 存储统计 | — | **纯 D1** | `SELECT SUM(size) … WHERE user_id=? AND deleted=0` |
| 回收站 | ❌ KV | `files.deleted=1` | 软删除只改 D1，KV 元数据保留用于恢复。**删除时 D1 兜底：KV 查不到直查 D1** |
| 分享 | KV `share:{token}` (TTL) | `shares` 表 | 创建/计数更新写 KV+D1 |
| 用户根目录 | KV `user_root:{id}` | `users.root_folder_id` | 注册时写入 |
| 系统配置 | KV `config:*` | `system_config` 表 | 初始化时写入 |
| JWT 吊销 | KV `revoked:{sub}:{iat}` (TTL 900s) | ❌ | KV TTL 自动过期 |
| 登录限流 | KV `login_limit:{user}` (TTL 60s) | ❌ | KV TTL 自动过期 |
| 上传会话 | KV `upload_session:{id}` (TTL 3600s) | D1 `upload_sessions` 表 | KV TTL + D1 备用 |

### 为什么文件列表走 D1 而非 KV

- KV 列出文件夹需要 `getChildren()` + 循环 `getFileMeta()`，N 个文件 = N+1 次 KV 操作
- D1 一次 `SELECT` 即可，性能远优于 KV 串行
- KV 免费配额 10 万次/天，D1 500 万行/天——列表查询频率高，D1 配额充裕得多

### D1 `files` 表结构

```sql
CREATE TABLE files (
  kv_id         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  parent_kv_id  TEXT,          -- NULL 表示根目录文件
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('file', 'folder')),
  size          INTEGER DEFAULT 0,
  mime_type     TEXT,
  is_chunks     INTEGER DEFAULT 0,
  deleted       INTEGER DEFAULT 0,
  deleted_at    TEXT,
  created_at    TEXT,
  updated_at    TEXT
);
```

> **注意**：根目录文件的 `parent_id` 在 KV 中为 `null`，D1 同步后 `parent_kv_id` 为 NULL。文件列表查询根目录时额外加 `OR parent_kv_id IS NULL` 来包含这些文件。新上传的文件已修正为写入真实 root folder id。

### `created_at` 类型

D1 `files.created_at` 列为 TEXT，存储 epoch 毫秒数字。查询时用 `parseInt()` 转回数字。D1 同步错误通过 `console.error` 输出到 Worker 日志（不再静默吞错）。

---

## 预览功能（图片/视频）

### 架构

```
用户双击 → PreviewModal → getPreviewStreamUrl()
  → GET /api/files/:id/preview (auth) → 签发 30 分钟 preview JWT
  → <img>/<video> src="/api/files/:id/stream?token=xxx"
  → handleFileStream:
      小文件 → directDownload → 浏览器直接播放
      大文件 → serveChunkRange → 按需下载 chunk + 提取精确字节范围
```

### 认证方案

`<img>` 和 `<video>` 标签无法发送 `Authorization` 头。通过**短期 JWT token（30 分钟）**作为 URL 查询参数传给 `/stream` 端点。

### 小文件（`is_chunks=false`）

`directDownload`：`Content-Disposition: inline` + `Accept-Ranges: bytes`，浏览器直接播放。

### 大文件（`is_chunks=true`）

`serveChunkRange`（`handlers/download.ts`）：

1. 初始请求（无 Range 或 `bytes=0-`）→ 强制返回首个 chunk（206，~8MB）
2. 浏览器检测 moov atom：
   - 在开头（fast-start MP4）→ 直接播放
   - 在末尾 → 发 `bytes=N-` → serveChunkRange 精确定位末尾 chunk
3. 拖动进度条 → 浏览器发 `bytes=X-Y` → serveChunkRange 按需下载

特点：
- 绕过 `streamMergedDownload` 的重流逻辑，直接下载 + 裁剪
- 子请求数：每请求 ≤16 次（8 chunk × 2），远低于 50 限制
- 内存：边下载边提取字节片段，丢弃原始 chunk 数据，峰值 ~8MB
- 末尾请求取最后 12 chunk 兜底（moov atom 4KB，子请求 24 次）
- 非末尾请求最多 8 chunk + ±5 buffer

### 分享预览

`GET /api/s/:token/stream`（shares.ts）同样走 `serveChunkRange`，不计下载次数。

### 预览 Token

| 属性 | 值 |
|------|-----|
| 类型 | JWT HS256 |
| 有效期 | 30 分钟 |
| Payload | `{ sub, type:"preview", file_id }` |
| 签发 | `POST /api/files/:id/preview` |
| 验证 | `verifyPreviewToken()` 在 `/stream` 端点 |

---

## 上传架构

> ⚠️ **以下为旧版概要。当前真实逻辑（流式 sendDocument、complete 零子请求、双层完整性校验等）见 [UPLOAD_DOWNLOAD_ARCH.md](./UPLOAD_DOWNLOAD_ARCH.md)。**

- **≤10MB**：HTTP multipart 直传 → 一个 TG 消息
- **>10MB ≤100MB**：Blob.slice(10MB) → 多条 TG 消息 + JSON record
- **>100MB**：前排 45MB 卷 → WebSocket → Worker 10MB flush → TG → `/complete`

前端排队串行上传，避免多文件并发触发 20 条/分钟频率限制。WS 分卷参数：256KB 帧、65ms 间隔、2 卷并发、15s 心跳。详见上述架构文档。

### Telegram 消息 Caption

| 场景 | 格式 |
|---|---|
| 上传 | `[用户名]-上传时间:[2025-07-29 15:30:45]` |
| 删除 | `[用户名]-上传时间:[2025-07-29 15:30:45]-删除时间:[2025-07-29 16:20:10]` |

---


## 下载架构

> ⚠️ **以下为旧版概要。当前真实逻辑（/chunk/:index 字节校验、前端双层校验等）见 [UPLOAD_DOWNLOAD_ARCH.md](./UPLOAD_DOWNLOAD_ARCH.md)。**

- **小文件** (`is_chunks=false`)：`GET /api/files/:id/download` → 流式转发 TG CDN。图片/视频/音频 `Content-Disposition: inline`，其他 `attachment`
- **大文件** (`is_chunks=true`)：获取 chunk 元数据 → 串行下载 `/chunk/:index`（失败重试 3 次，指数退避）→ Blob 拼接
- **流式合并** (`streamMergedDownload`)：用于 `/download` Range 请求。惰性模式 >20 chunk 时按需解析
- **轻量 Range** (`serveChunkRange`)：用于 `/stream` 预览，绕过重流逻辑直接定位 chunk 提取字节范围
- **批量下载**：`downloadFileBlob` + JSZip 打包 `.zip`

`downloadFileBlob` 和 `handleDownload` 使用 `api.rawFetch` 自动 401 刷新。

---

## 回收站（D1 实现）

软删除时不移除 KV 元数据，只修改 D1 `files.deleted=1`。恢复时从 KV 读取元数据重建父子关系。

| 操作 | 实现 |
|------|------|
| 删除 | removeChild(KV) + UPDATE files SET deleted=1 |
| 查看 | SELECT FROM files WHERE user_id=? AND deleted=1 |
| 恢复 | addChild(KV) + UPDATE files SET deleted=0 |
| 彻底删除 | deleteFileMeta(KV+D1) |
| 清空 | 批量 deleteFileMeta + DELETE FROM files WHERE deleted=1 |

---

## 分享功能

### 分享创建

- Token 长度 12 字符（~69 bit 熵），字符集去除易混淆字符（`0OIl`）
- 密码使用 SHA-256 哈希存储（D1 + KV），校验时比对哈希
- D1 INSERT 先于 KV 写入，失败则阻止 KV 写入避免孤儿数据
- 分享列表不返回密码哈希（仅 `has_password: boolean`）

### 分享安全性

所有分享端点（包括 chunk 下载）均含安全检查：

| 检查项 | `GET /s/:token` | `POST /s/:token/download` | `GET /s/:token/chunks` | `GET /s/:token/chunk/:index` |
|--------|-----------------|---------------------------|------------------------|------------------------------|
| 过期 | ✅ | ✅ | ✅ | ✅ |
| 最大下载次数 | ✅ (只读) | ✅ (D1 原子递增) | ✅ (D1 原子递增) | ✅ (只读) |
| 密码 | ✅ (`?pw=` 参数) | ✅ (body) | ✅ (`?pw=` 或 Header) | ✅ (`?pw=` 或 Header) |

- `GET /s/:token` 有密码分享返回 `{ need_password: true }`（200），密码正确后返回文件元数据
- 旧版 `/s/*` 和 `/api/share/*` 路由已移除，全部由 Hono `sharesRouter` 处理

### 下载计数（D1 原子更新防 TOCTOU）

| 下载路径 | 计数逻辑 |
|----------|----------|
| 小文件直接下载 | `POST /s/:token/download` (verify_only=false) → D1 `UPDATE … WHERE download_count < max_downloads` (原子) → +1 |
| 大文件分块下载 | `GET /s/:token/chunks` → D1 原子递增 +1（入口门控） → 返回分块元数据 → `GET /s/:token/chunk/:index` 仅校验不计数 |
| 仅验证密码 | `POST /s/:token/download` (verify_only=true) → 不计数 |

计数策略确保 `max_downloads=N` 即 N 次完整文件下载，不会因分块下载而消耗多次配额。

### 多文件分享（批量分享）

`POST /api/shares` 支持 `file_ids: string[]`（向后兼容单文件 `file_id`）。多文件共享同一个分享链接，接收方看到文件列表并逐个下载。

| 变更点 | 说明 |
|--------|------|
| `POST /shares` | 接受 `file_ids` 数组，D1 `file_id` 列存 JSON 数组，KV 存 `target_ids` |
| `GET /s/:token` | 返回 `files: [{index, name, size, mime_type, is_chunks}]` 数组 |
| 下载/chunk/stream | 新增 `file_index` 参数指定下载哪个文件 |
| `GET /shares` (列表) | `file_name` 自动解析 JSON 数组，多文件显示 "N 个文件" |

前端的 `ShareAccessPage` 展示文件列表，每个文件独立预览/下载。多文件分享时额外显示 **"全部下载 (.zip)"** 按钮，使用 JSZip 逐个下载后打包为 ZIP 推送浏览器下载，带 500MB 警告和进度条。

### 文件夹分享（动态实时同步）

与多文件分享（静态快照）不同，文件夹分享**不拍快照**：每次访问分享链接时实时查询 D1，分享者对文件夹内文件的增删即时反映到分享页面。

| 变更点 | 说明 |
|--------|------|
| `POST /shares` | 接受 `folder_id`（单文件夹）或 `folder_ids`（多文件夹数组），KV 存 `target_type: "folder"\|"folders"` + `target_id`/`target_ids` |
| `GET /s/:token` | 单文件夹返回 `is_folder: true` + 内容；多文件夹根层级返回 `is_folders: true` + 文件夹列表，点击进入后与单文件夹浏览一致 |
| `GET /s/:token?folder_id=` | 浏览子文件夹，后端验证子文件夹是分享根文件夹的后代（防止越权）；多文件夹时验证在任一共享根文件夹范围内 |
| 下载/chunk/stream | 新增 `folder_id` 参数，配合 `file_index` 定位子文件夹中的文件；多文件夹根层级无文件，仅可浏览文件夹 |
| `GET /shares` (列表) | 单文件夹显示 "文件夹: xxx"，多文件夹显示 "文件夹 (N 个): xxx、yyy"，`file_type: "folder"` |

**核心后端逻辑**：
- `resolveFolderContents(env, folderId, userId)`：D1 查询 `WHERE parent_kv_id=? AND deleted=0 ORDER BY type DESC, name ASC`，实时反映当前文件夹内容
- `resolveShareFileByIndex(env, shareInfo, fileIndex, folderId?)`：统一文件/文件夹分享（含 `target_type: "folders"`）的文件索引解析，文件夹分享从 D1 动态查询；多文件夹需携带 `folderId`
- `getFolderBreadcrumbs(env, folderId)`：沿 `parent_id` 链向上遍历（最多 20 层），生成面包屑路径
- `getTargetFileId`：仅处理 `target_type !== "folder" && !== "folders"` 的文件分享路径

**安全措施**：
- 子文件夹浏览时验证 `user_id` 匹配分享者 + 沿 `parent_id` 链确认是分享根文件夹的后代
- 多文件夹分享：验证 `subFolderId` 自身或祖先链中包含任一 `sharedFolderIds` 中的 ID
- 批量下载前检查 `max_downloads` 配额（前端提示超出限制）

**前端适配**：
- `ShareAccessPage` 新增面包屑导航、文件夹可点击进入子文件夹、全部下载只打包当前层级文件（跳过子文件夹）；多文件夹根层级显示 "N 个共享文件夹"；子文件夹页面新增 "← 返回" 按钮回到文件夹列表（`handleBackToFolderList` 清空 `currentFolderId` 重新加载根层级）
- `ContextMenu` 文件夹也显示"分享"菜单项（不再仅限 `type === "file"`）
- `FileManager.handleShareSelected` / `handleMoveSelected`：使用 store 原始 `files` 而非 `filteredFiles` 查找选中项，避免搜索/分类页面过滤导致选中项丢失；纯文件夹多选 → 多文件夹分享，混选文件+文件夹 → 仅文件
- `ShareModal` 检测所有文件类型：多文件夹时发送 `folder_ids`；直接 React 树渲染（移除 `createPortal` + `AnimatePresence`），`modal-overlay` 使用 `z-index: 9999` 确保层叠正确
- `SharesPage` 多文件夹时显示 "文件夹 (N 个): xxx、yyy"，不重复显示文件数量

---

## 批量操作（多选）

FileTable 和 FileGrid 均支持复选框多选。选中多个文件后右键菜单提供批量操作：

| 操作 | 实现 |
|------|------|
| 下载 N 项 | 逐个下载文件（`downloadFileBlob` → `api.rawFetch`）→ JSZip 前端打包 `.zip` → 自动下载 |
| 分享 N 项 | 单选文件夹 → `folder_id`；多选文件夹 → `folder_ids`；多选文件 → `file_ids`；混选 → 仅文件 |
| 移动到 N 项 | 逐个调用 `PUT /files/:id/move`，结果列表展示成功/失败 |
| 删除 N 项 | 逐个调用 `DELETE /files/:id` |

批量下载带 500MB 大小警告（`window.confirm`），底部状态栏显示蓝色进度条：`文件名 · 第 i/N · 进度%` → `打包中...`。

### 多选 UI

- **FileTable**：表头全选复选框 + 每行复选框 + 选中行蓝色高亮
- **FileGrid**：顶部全选栏 + 每张卡片 hover 时显示复选框 + 选中卡片蓝色边框和浅蓝背景
- **移动端**：列表视图始终显示复选框，网格视图选中态蓝色高亮
- **ContextMenu**：`multi` 检测（`selectedCount > 1 && selected.has(item.id)`）切换多选菜单

---

## ApiClient — `rawFetch` 方法

`frontend/src/lib/api.ts` 中 `ApiClient` 的 `rawFetch` 方法用于大文件下载场景，解决 Token 过期导致 401 的问题。

```ts
// 与 request() 共享同一套 tryRefresh 逻辑
// 返回原始 Response（不解析 JSON），适用于二进制下载
async rawFetch(path: string, options?: {
  method?: string; body?: BodyInit | null;
  headers?: Record<string, string>; skipAuth?: boolean;
}): Promise<Response>
```

`handleDownload` 中的 `downloadFileBlob` 使用 `api.rawFetch` 替代原生 `fetch`：
- 401 → 自动 `tryRefresh()` → 用新 token 重试
- 非 401 错误 → 由调用方的指数退避重试逻辑处理（`fetchChunk` retries=3）

---

## Workers 限制

| 限制项 | 免费版 | 对策 |
|---|---|---|
| 请求体 | 100MB | >95MB 走 WebSocket |
| 子请求 | 50/请求 | `serveChunkRange` 每请求 ≤24 次；上传分 6 批各 10 并发 |
| 内存 | 128MB | `serveChunkRange` 边下载边提取，峰值 ~8MB；flush 5MB 阈值 |
| CPU 时间 | 10ms/请求 | `serveChunkRange` 只做 arrayBuffer + slice，无复杂流处理 |
| WebSocket Hung | 检测 | setTimeout(0) 让出控制权 |
| 并发请求 | 100 | 每个 WS 连接占 1 槽位，正常使用远低于限制 |

> **注意**：以上是 Cloudflare Workers 平台限制。实际更容易触发的瓶颈是 **Telegram Bot API 的频率限制**，见下文。

## 多用户并发 & Telegram 频率限制

### Telegram Bot API 限制

| 限制 | 值 | 影响 |
|------|-----|------|
| 同一群组消息频率 | ~20 条/分钟 | **核心瓶颈** — 所有用户共享同一个超级群组 |
| 全局消息频率 | 30 条/秒 | 通常不触发 |

每个 `flush`（5~16MB）发一条 `sendDocument` 消息到 TG。一个大文件的上传消息量：

| 文件大小 | 约 flush 次数 | 单用户耗时（理想） |
|----------|:-----------:|-------------------|
| 100MB | 10 次 | ~30 秒 |
| 1GB | 100 次 | ~5 分钟 |
| 10GB | 1000 次 | ~50 分钟 |

### 多用户同时上传的冲突

多个用户同时上传大文件时，所有 `sendDocument` 发送到**同一个群组**，共享 20 条/分钟配额。TG 会返回 `429 Too Many Requests`，Bot API 内置 `retry_after` 参数指示等待秒数。

当前对策：
- 单用户上传已有**自然节流**：5MB flush 阈值 + `setTimeout(0)` + 每批 2 卷并发前端调速(~4MB/s)
- 多文件上传采用**前端串行队列**：所有文件排队逐个上传，避免短时间内密集 `sendDocument`
- `grammY`/`node-telegram-bot-api` 等库的 `sendDocument` 底层通常自带 `429` 重试
- 如果确实需要多人同时上传，建议：**队列化上传请求**或**错峰使用**

> **实际影响**：日常使用（非同时上传 GB 级文件）通常不会触发。只有在 2+ 人同时上传大文件时才会出现较慢的 `retry_after` 等待。

---

## 域名架构

```
<your-domain.com>/          → Cloudflare Pages（前端 SPA）
<your-domain.com>/api/*     → Cloudflare Worker（API + WebSocket）
                              → Worker 收到完整 path（如 /api/auth/login）
                              → index.ts 自定义 handler 精确匹配 path
                              → WebSocket: /api/ws/upload, /api/ws/download
```

Worker 的 WebSocket 路由在 `index.ts` 中同时兼容两种 path 格式：
```ts
(path === "/ws/upload" || path === "/api/ws/upload")
(path === "/ws/download" || path === "/api/ws/download")
```

---

## API 路由表

### 认证
| 方法 | 路径 | 认证 |
|---|---|---|
| POST | `/api/auth/register` | ❌ |
| POST | `/api/auth/login` | ❌ |
| POST | `/api/auth/refresh` | ❌ |
| GET | `/api/auth/me` | JWT |
| POST | `/api/auth/logout` | JWT |

### 文件
| 方法 | 路径 | 认证 |
|---|---|---|
| GET | `/api/files?parent_id=` | JWT |
| POST | `/api/files/folder` | JWT |
| PUT | `/api/files/:id/rename` | JWT |
| PUT | `/api/files/:id/move` | JWT |
| DELETE | `/api/files/:id` | JWT |
| GET | `/api/files/trash` | JWT |
| POST | `/api/files/trash/:id/restore` | JWT |
| DELETE | `/api/files/trash/:id` | JWT |
| DELETE | `/api/files/trash` | JWT |
| GET | `/api/files/search?q=` | JWT |

> **路由顺序注意**：`DELETE /trash` 必须在 `DELETE /:id` 之前注册，否则 `/:id` 会捕获 `trash` 字面值导致清空回收站返回 404。

### 上传
| 方法 | 路径 | 认证 |
|---|---|---|
| POST | `/api/files/upload` | JWT |
| POST | `/api/files/upload/chunk` | JWT |
| POST | `/api/files/upload/complete` | JWT |
| WS | `/api/ws/upload?token=` | JWT |

### 下载
| 方法 | 路径 | 认证 |
|---|---|---|
| GET | `/api/files/:id/download` | JWT |
| GET | `/api/files/:id/chunks` | JWT |
| GET | `/api/files/:id/chunk/:index` | JWT |

### 预览
| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/files/:id/preview` | JWT | 签发 30 分钟预览 token |
| GET | `/api/files/:id/stream?token=` | ❌ (preview JWT) | 流式传输，支持 Range |

### 分享
| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/shares` | JWT | 创建分享，支持 `file_id` (单文件) / `file_ids` (多文件) / `folder_id` (单文件夹) / `folder_ids` (多文件夹) |
| GET | `/api/shares` | JWT | 我的分享列表，多文件显示 "N 个文件"，文件夹显示 "文件夹: xxx" 或 "文件夹 (N 个): xxx" |
| DELETE | `/api/shares/:id` | JWT | 取消分享 |
| GET | `/api/s/:token` | ❌ | 访问分享，返回 `files[]`；单文件夹分享返回 `is_folder`+`breadcrumbs`，多文件夹返回 `is_folders`+文件夹列表，支持 `?folder_id=` 子文件夹浏览 |
| POST | `/api/s/:token/download` | ❌ (密码可选) | 下载文件，body 可带 `file_index` + `folder_id` |
| GET | `/api/s/:token/chunks` | ❌ (密码可选) | 分块元数据，query `?file_index=` + `?folder_id=` |
| GET | `/api/s/:token/chunk/:index` | ❌ (密码可选) | 单 chunk 下载，query `?file_index=` + `?folder_id=` |
| GET | `/api/s/:token/stream` | ❌ (密码可选) | 预览流，不计下载次数，query `?file_index=` + `?folder_id=` |

### 用户
| 方法 | 路径 | 认证 |
|---|---|---|
| GET | `/api/user/storage` | JWT |
| PUT | `/api/user/profile` | JWT |
| PUT | `/api/user/password` | JWT |

### 管理
| 方法 | 路径 | 认证 |
|---|---|---|
| POST | `/api/admin/login` | ❌ (密码) |
| GET | `/api/admin/stats` | Admin JWT |
| GET | `/api/admin/users` | Admin JWT |
| GET | `/api/admin/users/:id/files` | Admin JWT |
| DELETE | `/api/admin/users/:id` | Admin JWT |
| GET | `/api/admin/files` | Admin JWT |
| DELETE | `/api/admin/files/:id` | Admin JWT |
| GET | `/api/admin/files/:id/download` | Admin JWT |
| GET | `/api/admin/files/:id/chunks` | Admin JWT |
| GET | `/api/admin/files/:id/chunk/:index` | Admin JWT |
| GET | `/api/admin/shares` | Admin JWT |
| DELETE | `/api/admin/shares/:id` | Admin JWT |
| GET | `/api/admin/migrate` | Admin JWT (一次性 KV→D1 回填) |

> **`created_at` 类型**：D1 `files` 表 `created_at` 列为 TEXT，但 KV 同步存入 epoch 毫秒数字。Admin 文件列表端点（`/users/:id/files` 和 `/files`）响应中用 `parseInt` 转回数字，避免前端 `new Date("数字字符串")` 返回 Invalid Date。D1 同步错误现通过 `console.error` 输出到 Worker 日志（不再静默吞错）。

---

## 前端注意事项

### 组件拆分

主文件管理器已从单文件 1275 行重构为模块化架构：
- `FileManager.tsx` (~400行) 仅负责状态管理 + 布局编排
- 子组件在 `components/` 目录下，页面在 `pages/` 目录下
- 共享类型 (`PageView`, `ViewMode`, `SortKey`, `SortDir`) 定义在 `types/ui.ts`
- 工具函数 (`fmtSize`, `fmtDate`, `kindLabel`) 在 `lib/utils.ts`

### 下载逻辑复用

`FileManager.tsx` 中 `downloadFileBlob(item: FileItem, onChunk?): Promise<Blob>` 是 `handleDownload` 和 `handleDownloadSelected`（批量下载）共享的核心函数。它使用 `api.rawFetch` 自动处理 Token 刷新，支持小文件直接下载和大文件分块下载。

### 拖拽上传 parent_id 陈旧闭包

`UploadZone` 组件在 `useEffect([], [])` 中注册拖拽事件，`onDrop` 闭包中 `currentFolder` 被冻结为挂载时的值。**修复**：使用 `useRef(currentFolder)` + 每次渲染 `folderRef.current = currentFolder`，上传路径从 ref 读取。

### 分享访问页面

`ShareAccessPage` 先 `GET /s/:token`（不带密码）→ 若返回 `{ need_password: true }` → 展示密码输入 UI → 用户提交后 `GET /s/:token?pw=xxx` → 获取完整文件信息 → 正常下载流程。

**文件夹分享浏览流程**：若 `data.is_folder` → 面包屑导航（顶部层级路径可点击跳回）→ 文件夹条目点击进入子文件夹（`?folder_id=`）→ 文件条目正常下载/预览。多文件夹分享根层级先显示文件夹列表，点击后流程与单文件夹一致。下载/stream 请求均携带 `folder_id` 参数定位当前文件夹。全部下载 (.zip) 只打包当前层级文件，跳过子文件夹。批量下载前检查 `max_downloads` 配额。详见 [分享功能 > 文件夹分享](#文件夹分享动态实时同步)。

### 存储空间进度条

- 挂载时调用 `GET /api/user/storage` 获取真实用量（used/files/folders）
- 传输任务完成时通过 `transferStore.done` 计数变化自动触发重新获取
- 使用 `AbortController` 管理请求生命周期，组件卸载时取消
- 进度条满值 10 TB，仅作视觉参考，实际容量无限（显示 `∞`）

---

## 首次部署检查清单

1. D1 执行 `migrations/0001_init.sql`
2. D1 执行 `migrations/0002_admin_index.sql`
3. 设置 GitHub Secret `CLOUDFLARE_API_TOKEN`
4. `git push main` 触发自动部署（或运行 `deploy.bat`）
5. 访问 `GET /api/admin/migrate` 回填 KV 数据到 D1（一次性）
6. 验证管理后台概览数字正常
