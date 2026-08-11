# Telegram 网盘 AI 开发文档

> 部分内容由豆包生成
> 
> 

# 一、项目概述

## 1\.1 项目名称

Telegram Cloud Drive（TCD）— 基于 Telegram 的免费无限容量网盘系统

## 1\.2 项目目标

利用 Telegram 作为免费底层存储，自建前后端负责文件目录管理、用户交互与流量中转，本质是将 Telegram 频道/聊天当成一个无上限的对象存储桶。前端后端全部通过 Cloudflare Workers / Cloudflare Pages 完成，实现零服务器成本、零运维的个人云盘解决方案。

## 1\.3 核心价值

- **零成本存储**：利用 Telegram 免费无限容量，无需购买云存储

- **零服务器运维**：全栈运行在 Cloudflare 边缘网络，无需维护服务器

- **完整网盘体验**：支持目录浏览、上传下载、分享、预览等完整功能

- **私密安全**：文件存储在私密 Telegram 群组中，对外不可见

## 1\.4 适用场景

- 个人文件备份与同步

- 大文件分享（突破网盘限速）

- 静态资源托管（图床、文件直链）

- 团队文件协作（多人共享空间）

# 二、技术架构

## 2\.1 整体架构

系统分为四层，Telegram 只负责存原始文件，目录、权限、交互都由自建服务维护：

|层级|技术方案|职责|
|---|---|---|
|存储层|Telegram 私密超级群组（话题模式）|存储原始文件数据，每个话题对应一个一级文件夹|
|元数据层|Cloudflare KV|维护目录结构、文件名、文件大小、file\_id、消息 ID 映射|
|中转层|Cloudflare Workers|接收上传并转发到 Telegram、下载时代理拉取文件返回|
|前端层|Cloudflare Pages|网页网盘界面，提供目录浏览、上传下载、分享、预览交互|

## 2\.2 数据流图

```text
浏览器 ──上传──▶ CF Worker ──sendDocument──▶ Telegram 群组（话题）
浏览器 ◀─下载── CF Worker ◀──getFile/CDN── Telegram CDN
浏览器 ──浏览──▶ CF Worker ──读取KV──▶ 目录元数据
```

## 2\.3 技术栈选型

|模块|技术选型|说明|
|---|---|---|
|后端运行时|Cloudflare Workers|边缘计算，全球 CDN，免费额度充足|
|前端框架|原生 HTML/CSS/JS 或 Vue/React|轻量优先，推荐原生 \+ 少量框架|
|元数据存储|Cloudflare KV|键值存储，适合读多写少的元数据|
|Bot 框架|grammY 或原生 fetch|推荐 grammY（TypeScript，支持 Workers）|
|部署平台|Cloudflare Pages \+ Workers|一体化部署，自动 CI/CD|
|开发语言|TypeScript|类型安全，全栈统一|

## 2\.4 文件大小限制与解决方案

# 三、前置准备

## 3\.1 账号准备

|账号/服务|用途|获取方式|
|---|---|---|
|Cloudflare 账号|部署 Workers 和 Pages|cloudflare\.com 免费注册|
|Telegram 账号|创建 Bot 和群组|Telegram 客户端注册|
|Bot Token|Bot API 调用凭证|@BotFather 创建 Bot 获取|
|域名（可选）|自定义访问域名|任意域名注册商，绑定到 Cloudflare|

## 3\.2 Telegram 侧准备

### 3\.2\.1 创建 Bot

1. 在 Telegram 中搜索 @BotFather

2. 发送 /newbot 命令，按提示设置 Bot 名称和用户名

3. 记录生成的 Bot Token（格式：123456:ABC\-DEF1234ghIkl\-zyx57W2v1u123ew11）

### 3\.2\.2 创建存储群组

## 3\.3 Cloudflare 侧准备

1. 注册 Cloudflare 账号

2. 安装 Wrangler CLI：`npm install -g wrangler`

3. 登录 Cloudflare：`wrangler login`

4. 创建 KV 命名空间：`wrangler kv:namespace create TCD_METADATA`

5. 记录 KV Namespace ID

## 3\.4 开发环境

|工具|版本要求|说明|
|---|---|---|
|Node\.js|≥ 18\.x|运行时环境|
|Wrangler CLI|≥ 3\.x|Cloudflare 开发工具|
|TypeScript|≥ 5\.x|开发语言|
|Git|最新版|版本控制|

# 四、项目结构

## 4\.1 目录结构

```text
telegram-cloud-drive/
├── worker/                      # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.ts             # 入口文件，路由分发
│   │   ├── bot/
│   │   │   ├── telegram.ts      # Telegram Bot API 封装
│   │   │   ├── webhook.ts       # Webhook 处理
│   │   │   └── commands.ts      # Bot 命令处理
│   │   ├── storage/
│   │   │   ├── kv.ts            # KV 元数据操作
│   │   │   ├── files.ts         # 文件元数据管理
│   │   │   └── folders.ts       # 目录树管理
│   │   ├── handlers/
│   │   │   ├── upload.ts        # 上传处理（分片）
│   │   │   ├── download.ts      # 下载处理（流式合并）
│   │   │   ├── list.ts          # 文件列表
│   │   │   ├── share.ts         # 分享功能
│   │   │   └── preview.ts       # 预览功能
│   │   ├── auth/
│   │   │   └── auth.ts          # 认证鉴权
│   │   ├── utils/
│   │   │   ├── stream.ts        # 流处理工具
│   │   │   ├── crypto.ts        # 加密工具
│   │   │   └── common.ts        # 通用工具
│   │   └── types/
│   │       └── index.ts         # TypeScript 类型定义
│   ├── wrangler.toml            # Worker 配置
│   └── package.json
├── frontend/                    # Cloudflare Pages 前端
│   ├── public/
│   │   ├── index.html           # 主页面
│   │   ├── css/
│   │   │   └── style.css        # 样式
│   │   └── js/
│   │       ├── app.js           # 主应用逻辑
│   │       ├── uploader.js      # 分片上传组件
│   │       ├── file-manager.js  # 文件管理
│   │       └── preview.js       # 预览组件
│   └── functions/               # Pages Functions（可选，或统一用 Worker）
└── docs/                        # 项目文档
    └── README.md
```

## 4\.2 模块职责说明

|模块|核心职责|关键依赖|
|---|---|---|
|telegram\.ts|封装所有 Telegram Bot API 调用：上传文件、下载文件、管理话题、删除消息|fetch API|
|kv\.ts|KV 存储的 CRUD 封装：文件元数据、目录结构、分享令牌|Cloudflare KV|
|upload\.ts|处理文件上传：分片接收、转发到 Telegram、元数据写入|telegram\.ts, kv\.ts|
|download\.ts|处理文件下载：元数据查询、分片拉取、流式合并、Range 支持|telegram\.ts, kv\.ts|
|folders\.ts|目录树管理：创建/重命名/移动/删除文件夹，路径解析|kv\.ts|
|auth\.ts|用户认证：密码登录、Session 管理、权限校验|Web Crypto API|
|share\.ts|分享功能：生成分享链接、设置过期时间、访问统计|kv\.ts|

# 五、核心模块详细设计

## 5\.1 存储层 — Telegram Bot API 封装

### 5\.1\.1 模块概述

封装所有与 Telegram Bot API 的交互，向上层提供统一的文件存储和话题管理接口。屏蔽 Telegram API 的复杂性，包括分片、重试、错误处理等。

### 5\.1\.2 核心接口定义

```typescript
// src/bot/telegram.ts

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  file_path?: string;
}

export interface ForumTopic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

export interface ITelegramStorage {
  // 文件上传
  uploadDocument(
    chatId: string,
    file: File | Blob,
    filename: string,
    messageThreadId?: number
  ): Promise<{ message_id: number; file_id: string; file_size: number }>;

  // 文件下载
  getFile(fileId: string): Promise<TelegramFile>;
  getFileStream(filePath: string): Promise<ReadableStream<Uint8Array>>;

  // 话题（文件夹）管理
  createForumTopic(chatId: string, name: string): Promise<ForumTopic>;
  editForumTopic(chatId: string, messageThreadId: number, name: string): Promise<boolean>;
  deleteForumTopic(chatId: string, messageThreadId: number): Promise<boolean>;

  // 消息管理
  deleteMessage(chatId: string, messageId: number): Promise<boolean>;
  deleteMessages(chatId: string, messageIds: number[]): Promise<boolean>;
}
```

### 5\.1\.3 关键实现要点

**文件上传：**

- 使用 `sendDocument` API，通过 FormData 上传文件

- 上传到指定话题时携带 `message_thread_id` 参数

- 从返回的 Message 对象中提取 `document.file_id` 和 `message_id`

- 单文件上限 50MB，超过需在客户端分片

**文件下载：**

- 先用 `getFile` API 获取 `file_path`

- 再通过 `https://api.telegram.org/file/bot<token>/<file_path>` 下载文件流

- 标准 Bot API 下载上限 20MB，超过需分片下载后合并

- 支持流式返回，直接 pipe 到 Response

**话题管理：**

- `createForumTopic`：创建新话题（一级文件夹）

- `editForumTopic`：重命名话题

- `deleteForumTopic`：删除话题（会删除话题内所有消息）

- Bot 需要 `can_manage_topics` 管理员权限

## 5\.2 元数据层 — Cloudflare KV 设计

### 5\.2\.1 KV Key 设计

|Key 模式|Value 类型|说明|
|---|---|---|
|`file:{fileId}`|FileMetadata|文件元数据|
|`folder:{folderId}`|FolderMetadata|文件夹元数据|
|`path:{path}`|\{ type: "file"\|"folder", id: string \}|路径到 ID 的映射|
|`children:{folderId}`|string\[\] \(子节点ID列表\)|文件夹子节点列表|
|`share:{shareToken}`|ShareInfo|分享信息|
|`session:{sessionId}`|SessionData|用户会话|
|`config:root`|RootConfig|根目录配置|

### 5\.2\.2 文件元数据结构

```typescript
export interface FileMetadata {
  id: string;                    // 文件唯一 ID (UUID)
  name: string;                  // 文件名
  size: number;                  // 文件总大小（字节）
  mime_type: string;             // MIME 类型
  created_at: number;            // 创建时间戳
  updated_at: number;            // 更新时间戳
  parent_id: string;             // 父文件夹 ID
  is_chunks: boolean;            // 是否分片存储
  chunks?: ChunkInfo[];          // 分片信息（仅 is_chunks=true 时）
  telegram_message_id?: number;  // Telegram 消息 ID（单文件时）
  telegram_file_id?: string;     // Telegram file_id（单文件时）
  topic_id?: number;             // 所属话题 ID（一级文件夹）
  hash?: string;                 // 文件哈希（可选，用于去重）
}

export interface ChunkInfo {
  index: number;                 // 分片索引（从 0 开始）
  size: number;                  // 分片大小
  telegram_file_id: string;      // 该分片的 Telegram file_id
  telegram_message_id: number;   // 该分片的消息 ID
}
```

### 5\.2\.3 文件夹元数据结构

```typescript
export interface FolderMetadata {
  id: string;                    // 文件夹唯一 ID
  name: string;                  // 文件夹名
  parent_id: string | null;      // 父文件夹 ID（根目录为 null）
  created_at: number;            // 创建时间戳
  updated_at: number;            // 更新时间戳
  topic_id?: number;             // 对应 Telegram 话题 ID（仅一级文件夹）
  path: string;                  // 完整路径（如 /documents/work）
  child_count: number;           // 子节点数量
}
```

## 5\.3 中转层 — API 路由设计

### 5\.3\.1 路由总览

|方法|路径|功能|认证|
|---|---|---|---|
|POST|/api/auth/login|登录|否|
|POST|/api/auth/logout|登出|是|
|GET|/api/files/list|获取文件列表|是|
|POST|/api/files/upload|上传文件（分片）|是|
|POST|/api/files/upload/complete|完成分片上传|是|
|GET|/api/files/\{id\}/download|下载文件|是/分享令牌|
|DELETE|/api/files/\{id\}|删除文件|是|
|PATCH|/api/files/\{id\}|重命名/移动文件|是|
|POST|/api/folders|创建文件夹|是|
|DELETE|/api/folders/\{id\}|删除文件夹|是|
|PATCH|/api/folders/\{id\}|重命名/移动文件夹|是|
|POST|/api/share|创建分享链接|是|
|GET|/api/share/\{token\}|获取分享信息|否|
|GET|/api/share/\{token\}/download|分享文件下载|否|
|POST|/webhook/telegram|Telegram Webhook|Webhook Secret|

### 5\.3\.2 Worker 入口路由

```typescript
// src/index.ts

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    // Webhook 路由
    if (path === "/webhook/telegram" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    // 分享下载路由（无需登录）
    if (path.startsWith("/s/") || path.startsWith("/share/")) {
      return handleShareDownload(request, env);
    }

    // API 路由
    if (path.startsWith("/api/")) {
      // 认证检查（登录接口除外）
      if (!path.startsWith("/api/auth/")) {
        const authResult = await checkAuth(request, env);
        if (!authResult.valid) {
          return json({ error: "Unauthorized" }, 401);
        }
      }
      return handleApiRoute(request, env);
    }

    // 前端静态资源（或由 Pages 处理）
    return handleStaticAssets(request, env);
  },
};
```

## 5\.4 前端层 — 界面设计

### 5\.4\.1 页面结构

- **登录页**：密码输入框，登录按钮

- **主界面**：  

    - 顶部导航栏：面包屑路径、搜索框、上传按钮、用户菜单

    - 左侧边栏：快速访问（根目录、收藏、最近、分享）

    - 主内容区：文件/文件夹网格或列表视图

    - 底部状态栏：选中文件数、总大小

- **预览弹窗**：图片/视频/音频/PDF/文本预览

- **上传面板**：上传进度、分片状态、暂停/继续

- **分享弹窗**：生成分享链接、设置过期时间、复制链接

### 5\.4\.2 核心前端组件

|组件|功能|关键技术|
|---|---|---|
|FileUploader|分片上传、并发控制、进度显示、断点续传|File API, Blob\.slice\(\), XHR/fetch|
|FileManager|文件列表渲染、拖拽排序、多选、右键菜单|原生 DOM 或轻量框架|
|PreviewPlayer|图片预览、视频播放、音频播放、PDF 查看|HTML5 Video/Audio, PDF\.js|
|Breadcrumb|路径导航、点击跳转|路径解析|
|ContextMenu|右键菜单：下载、重命名、移动、删除、分享|事件委托|

1. 在 Telegram 中创建一个新的超级群组（Supergroup）

2. 将群组设为私密（Private）

3. 开启「话题模式」（Topics）：群组设置 → 话题 → 启用

4. 将 Bot 邀请进群组，并授予管理员权限

5. 确保 Bot 拥有以下权限：删除消息、管理话题、发送消息、上传媒体

6. 记录群组 Chat ID（可通过 @userinfobot 或 Bot API 获取，格式：\-1001234567890）

## 5\.5 Bot 交互层

### 5\.5\.1 Bot 命令列表

|命令|功能|权限|
|---|---|---|
|/start|欢迎信息，使用说明|所有用户|
|/list \[路径\]|列出指定目录的文件|管理员|
|/search \<关键词\>|搜索文件|管理员|
|/get \<文件路径\>|获取文件下载链接|管理员|
|/delete \<文件路径\>|删除文件|管理员|
|/stats|统计信息：文件数、总大小|管理员|
|/help|帮助信息|所有用户|

### 5\.5\.2 Webhook 处理

Telegram Webhook 用于接收 Bot 消息和回调，实现命令交互。同时支持「直接发文件到群组自动入库」功能：用户直接往 Telegram 群组发文件，Bot 通过 Webhook 收到消息后自动将文件元数据写入 KV，实现快速上传。

```typescript
// src/bot/webhook.ts

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // 验证 Webhook Secret
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== env.WEBHOOK_SECRET) {
    return json({ error: "Invalid secret" }, 403);
  }

  const update = await request.json();

  // 处理命令消息
  if (update.message?.text?.startsWith("/")) {
    await handleCommand(update.message, env);
  }
  // 处理直接上传的文件（自动入库）
  else if (update.message?.document || update.message?.photo || update.message?.video) {
    await handleAutoIndex(update.message, env);
  }
  // 处理回调按钮
  else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
  }

  return json({ ok: true });
}
```

# 六、关键技术方案

## 6\.1 分片上传与下载

### 6\.1\.1 分片上传流程

由于 Telegram Bot API 单文件上传上限为 50MB，下载上限为 20MB，需要对大文件进行分片处理。分片在客户端完成，每片大小约 19\.5MB（预留安全余量）。

1. **初始化上传**：客户端计算文件总大小和分片数量，向服务端申请上传会话

2. **逐片上传**：客户端按顺序上传每个分片，服务端接收后转发到 Telegram，记录每个分片的 file\_id 和 message\_id

3. **并发控制**：支持 3 并发上传，提高速度

4. **断点续传**：记录已上传分片索引，中断后可从断点继续

5. **完成上传**：所有分片上传完毕后，客户端发送 complete 请求，服务端合并元数据并写入 KV

### 6\.1\.2 分片下载流程

1. **元数据查询**：根据文件 ID 从 KV 获取分片信息

2. **流式合并**：按分片顺序从 Telegram CDN 拉取，通过 TransformStream 实时合并

3. **Range 支持**：计算 Range 请求落在哪个分片，只拉取需要的分片和字节范围

4. **预取优化**：提前预取下一个分片，消除分片间的卡顿

```typescript
// 流式合并下载示例
export async function streamMergedDownload(
  chunks: ChunkInfo[],
  range?: { start: number; end: number }
): Promise<Response> {
  const { readable, writable } = new TransformStream();

  (async () => {
    const writer = writable.getWriter();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const file = await telegramApi.getFile(chunk.telegram_file_id);
      const stream = await telegramApi.getFileStream(file.file_path!);
      await stream.pipeTo(new WritableStream({
        write(chunkData) {
          return writer.write(chunkData);
        }
      }), { preventClose: true });
    }
    writer.close();
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="file"',
    },
  });
}
```

## 6\.2 目录树管理

### 6\.2\.1 设计思路

Telegram 本身无目录概念，但群组有话题模式，可将一个话题作为一个一级文件夹。更深层的目录结构通过 KV 中的虚拟目录树维护。

- **一级文件夹**：对应 Telegram 群组的一个 Forum Topic，文件直接存在该话题下

- **二级及以下文件夹**：纯虚拟目录，文件仍存储在对应一级文件夹的话题中，通过 KV 维护路径关系

- **文件移动**：跨一级文件夹移动时，需要重新上传文件到新话题（Telegram 不支持跨话题移动消息）

### 6\.2\.2 路径解析

```typescript
// 路径解析函数
export async function resolvePath(path: string, env: Env): Promise<{
  type: "file" | "folder";
  id: string;
  metadata: FileMetadata | FolderMetadata;
}> {
  // 规范化路径
  const normalizedPath = normalizePath(path);

  // 从 path 映射中查找
  const pathInfo = await env.METADATA_KV.get(`path:${normalizedPath}`, "json");
  if (!pathInfo) {
    throw new Error("Path not found");
  }

  if (pathInfo.type === "file") {
    const file = await env.METADATA_KV.get(`file:${pathInfo.id}`, "json");
    return { type: "file", id: pathInfo.id, metadata: file };
  } else {
    const folder = await env.METADATA_KV.get(`folder:${pathInfo.id}`, "json");
    return { type: "folder", id: pathInfo.id, metadata: folder };
  }
}
```

### 6\.2\.3 文件夹操作

**创建文件夹：**

- 一级文件夹：调用 Telegram API 创建 Forum Topic，同时在 KV 中创建文件夹元数据

- 子文件夹：仅在 KV 中创建虚拟目录节点

**删除文件夹：**

- 递归删除所有子文件和子文件夹

- 一级文件夹：删除 Telegram Topic（自动删除话题内所有消息）

- 子文件夹：删除 KV 中的元数据，并删除对应文件的 Telegram 消息

**移动/重命名：**

- 更新 KV 中的 parent\_id 和 path 映射

- 跨一级文件夹移动文件：需要重新上传到新话题（性能开销大，建议限制或异步处理）

## 6\.3 分享功能

### 6\.3\.1 分享机制

1. 用户选择文件/文件夹，点击「分享」

2. 生成随机分享令牌（32 位随机字符串）

3. 在 KV 中存储分享信息：关联文件 ID、过期时间、下载次数限制、访问密码（可选）

4. 生成分享链接：`https://your-domain.com/s/{token}`

5. 访问分享链接时，验证令牌有效性，展示文件信息并提供下载

### 6\.3\.2 分享数据结构

```typescript
export interface ShareInfo {
  token: string;                 // 分享令牌
  target_type: "file" | "folder"; // 分享类型
  target_id: string;             // 目标文件/文件夹 ID
  created_at: number;            // 创建时间
  expires_at?: number;           // 过期时间（可选）
  max_downloads?: number;        // 最大下载次数（可选）
  download_count: number;        // 已下载次数
  password?: string;             // 访问密码（可选，bcrypt 哈希）
  creator_id: string;            // 创建者 ID
}
```

## 6\.4 认证与权限

### 6\.4\.1 认证方案

采用简单的密码认证 \+ Session 机制：

- 用户输入密码，服务端验证后生成 Session ID

- Session ID 存储在 HttpOnly Cookie 中

- Session 数据存储在 KV 中，设置过期时间

- 每次请求验证 Session 有效性

```typescript
// 认证中间件
export async function checkAuth(request: Request, env: Env): Promise<{
  valid: boolean;
  userId?: string;
}> {
  const cookie = request.headers.get("Cookie");
  const sessionId = parseCookie(cookie)["session_id"];

  if (!sessionId) {
    return { valid: false };
  }

  const session = await env.METADATA_KV.get(`session:${sessionId}`, "json");
  if (!session || session.expires_at < Date.now()) {
    return { valid: false };
  }

  return { valid: true, userId: session.user_id };
}
```

### 6\.4\.2 权限模型

初期采用单用户模型（管理员），后续可扩展为多用户：

- **管理员**：拥有所有权限（上传、下载、删除、管理分享、管理用户）

- **普通用户**（可选）：仅可浏览和下载公开/分享文件

- **匿名用户**：仅可通过分享链接访问

## 6\.5 错误处理与重试

### 6\.5\.1 Telegram API 错误处理

|错误码|说明|处理策略|
|---|---|---|
|429|请求过于频繁|指数退避重试，读取 retry\_after 头|
|400|请求参数错误|记录日志，返回客户端错误|
|401|Bot Token 无效|致命错误，告警通知|
|403|权限不足|检查 Bot 权限设置|
|500/502/503|服务端错误|重试 3 次，指数退避|

### 6\.5\.2 重试机制

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;

      // 429 错误使用服务器指定的重试时间
      const delay = error.parameters?.retry_after 
        ? error.parameters.retry_after * 1000 
        : baseDelay * Math.pow(2, i);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
```

# 七、部署指南

## 7\.1 环境变量配置

### 7\.1\.1 Worker 环境变量

|变量名|必填|说明|示例|
|---|---|---|---|
|TELEGRAM\_BOT\_TOKEN|是|Telegram Bot Token（Secret）|123456:ABC\-DEF\.\.\.|
|STORAGE\_CHAT\_ID|是|存储群组 Chat ID|\-1001234567890|
|WEB\_PASSWORD|是|网页登录密码（Secret）|your\-password|
|WEBHOOK\_SECRET|是|Webhook 验证密钥（Secret）|random\-secret\-string|
|COOKIE\_SECRET|否|Cookie 签名密钥|auto\-derived|
|CHUNK\_SIZE|否|分片大小（字节）|20447232 \(19\.5MB\)|
|MAX\_UPLOAD\_SIZE|否|最大单文件大小|2147483648 \(2GB\)|

**安全提示：**敏感变量（Token、密码、Secret）必须使用 `wrangler secret put` 方式设置，不要明文写在 wrangler\.toml 中。

### 7\.1\.2 wrangler\.toml 配置示例

```toml
name = "telegram-cloud-drive"
main = "src/index.ts"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "METADATA_KV", id = "your-kv-namespace-id" }
]

[vars]
STORAGE_CHAT_ID = "-1001234567890"
CHUNK_SIZE = "20447232"

[env.production]
name = "telegram-cloud-drive-prod"
```

## 7\.2 部署步骤

### 7\.2\.1 后端 Worker 部署

1. **克隆项目**

    ```bash
    git clone <repo-url>
    cd telegram-cloud-drive/worker
    npm install
    ```

2. **创建 KV 命名空间**

    ```bash
    npx wrangler kv:namespace create METADATA_KV
    # 记录返回的 ID，填入 wrangler.toml
    ```

3. **设置 Secrets**

    ```bash
    npx wrangler secret put TELEGRAM_BOT_TOKEN
    npx wrangler secret put WEB_PASSWORD
    npx wrangler secret put WEBHOOK_SECRET
    ```

4. **配置 wrangler\.toml**将 KV Namespace ID 和 STORAGE\_CHAT\_ID 填入 wrangler\.toml

5. **部署**

    ```bash
    npx wrangler deploy
    ```

6. **设置 Telegram Webhook**

    ```bash
    curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
      -F "url=https://your-worker.workers.dev/webhook/telegram" \
      -F "secret_token=<WEBHOOK_SECRET>"
    ```

### 7\.2\.2 前端 Pages 部署

1. **进入前端目录**

    ```bash
    cd ../frontend
    ```

2. **配置 API 地址**修改 js/config\.js 中的 API\_BASE\_URL 为你的 Worker 地址

3. **部署到 Cloudflare Pages**

    ```bash
    npx wrangler pages deploy public --project-name telegram-cloud-drive
    ```

4. **绑定自定义域名（可选）**在 Cloudflare Pages 控制台设置自定义域名

## 7\.3 初始化配置

### 7\.3\.1 初始化根目录

首次部署后，需要初始化根目录结构：

```bash
# 调用初始化接口
curl -X POST "https://your-worker.workers.dev/api/admin/init" \
  -H "Authorization: Bearer <WEB_PASSWORD>"
```

初始化操作会：

- 创建根目录元数据

- 验证 Bot Token 和群组权限

- 创建默认的「我的文件」话题文件夹

- 写入系统配置

### 7\.3\.2 验证部署

1. 访问前端页面，输入密码登录

2. 上传一个小文件测试上传功能

3. 下载刚才上传的文件，验证下载功能

4. 创建文件夹，测试目录管理

5. 生成分享链接，测试分享功能

6. 在 Telegram 群组中发送文件，测试自动入库

# 八、开发任务拆分

## 8\.1 开发阶段划分

|阶段|任务|优先级|预估工时|
|---|---|---|---|
|P0 \- MVP|基础文件上传下载 \+ 目录浏览|最高|3 天|
|P0 \- MVP|分片上传下载|最高|2 天|
|P0 \- MVP|基础前端界面|最高|2 天|
|P1 \- 核心|目录管理（创建/重命名/删除）|高|1 天|
|P1 \- 核心|文件管理（重命名/移动/删除）|高|1 天|
|P1 \- 核心|分享功能|高|1 天|
|P1 \- 核心|Telegram Bot 命令|高|1 天|
|P2 \- 增强|文件预览（图片/视频/音频/PDF）|中|2 天|
|P2 \- 增强|搜索功能|中|1 天|
|P2 \- 增强|Webhook 自动入库|中|1 天|
|P3 \- 优化|断点续传|低|1 天|
|P3 \- 优化|拖拽上传|低|0\.5 天|
|P3 \- 优化|批量操作|低|1 天|
|P3 \- 优化|暗色主题|低|0\.5 天|

## 8\.2 P0 MVP 详细任务

### 任务 1：项目脚手架搭建

* [ ] 初始化 Worker 项目（TypeScript \+ Wrangler）

* [ ] 配置 KV 命名空间绑定

* [ ] 配置环境变量和 Secrets

* [ ] 搭建基础路由框架

* [ ] 实现统一响应格式和错误处理

### 任务 2：Telegram API 封装

* [ ] 实现 sendDocument 上传文件

* [ ] 实现 getFile 和文件下载流

* [ ] 实现 deleteMessage 删除消息

* [ ] 实现 createForumTopic / editForumTopic / deleteForumTopic

* [ ] 添加重试机制和错误处理

### 任务 3：KV 元数据层

* [ ] 实现文件元数据 CRUD

* [ ] 实现文件夹元数据 CRUD

* [ ] 实现路径映射和解析

* [ ] 实现子节点列表管理

### 任务 4：文件上传接口

* [ ] 实现单文件上传（\< 20MB）

* [ ] 实现分片上传接口

* [ ] 实现上传完成合并接口

* [ ] 写入文件元数据到 KV

### 任务 5：文件下载接口

* [ ] 实现单文件下载

* [ ] 实现分片文件流式合并下载

* [ ] 支持 Content\-Disposition 文件名

* [ ] 支持 Range 请求（断点续传）

### 任务 6：文件列表接口

* [ ] 实现目录列表查询

* [ ] 支持分页和排序

* [ ] 返回文件和文件夹混合列表

### 任务 7：认证系统

* [ ] 实现密码登录接口

* [ ] 实现 Session 管理

* [ ] 实现认证中间件

* [ ] 实现登出接口

### 任务 8：前端基础界面

* [ ] 实现登录页面

* [ ] 实现文件列表页面（网格/列表视图）

* [ ] 实现面包屑导航

* [ ] 实现上传按钮和简单上传

* [ ] 实现下载功能

## 8\.3 P1 核心功能任务

### 任务 9：目录管理

* [ ] 创建文件夹（一级文件夹创建 Topic）

* [ ] 重命名文件夹

* [ ] 删除文件夹（递归删除）

* [ ] 移动文件夹

### 任务 10：文件管理

* [ ] 重命名文件

* [ ] 移动文件

* [ ] 删除文件（同步删除 Telegram 消息）

* [ ] 批量删除

### 任务 11：分享功能

* [ ] 创建分享链接

* [ ] 设置过期时间

* [ ] 设置下载次数限制

* [ ] 分享页面展示

* [ ] 分享文件下载

### 任务 12：Telegram Bot 命令

* [ ] 实现 /start 欢迎命令

* [ ] 实现 /list 文件列表命令

* [ ] 实现 /get 获取下载链接命令

* [ ] 实现 /delete 删除文件命令

* [ ] 实现 /stats 统计命令

* [ ] 配置 Webhook

## 8\.4 P2 增强功能任务

### 任务 13：文件预览

* [ ] 图片预览

* [ ] 视频播放（支持拖动）

* [ ] 音频播放

* [ ] PDF 预览

* [ ] 文本文件预览

### 任务 14：搜索功能

* [ ] 文件名搜索

* [ ] 搜索结果分页

* [ ] 高级搜索（按类型、大小、时间）

### 任务 15：Webhook 自动入库

* [ ] 监听群组文件消息

* [ ] 自动提取文件元数据

* [ ] 自动写入 KV

* [ ] 入库成功通知

# 九、代码规范

## 9\.1 TypeScript 规范

- 使用严格模式（strict: true）

- 所有函数必须定义返回类型

- 所有接口使用 interface 定义

- 使用 ESLint \+ Prettier 统一代码风格

- 避免使用 any 类型，必要时用 unknown 替代

## 9\.2 命名规范

|类型|规范|示例|
|---|---|---|
|变量/函数|camelCase|getFileMetadata|
|类/接口/类型|PascalCase|FileMetadata|
|常量|UPPER\_SNAKE\_CASE|MAX\_CHUNK\_SIZE|
|文件名|kebab\-case|file\-upload\.ts|

## 9\.3 错误处理规范

- 所有 API 错误统一格式：`{ error: string, code?: string, details?: any }`

- 使用 HTTP 状态码表达错误类型：400（参数错误）、401（未认证）、403（无权限）、404（不存在）、500（服务端错误）

- 内部错误使用自定义 Error 子类，携带错误码

- 所有外部 API 调用必须有 try\-catch 和重试

## 9\.4 安全规范

- 所有用户输入必须验证和转义

- 密码使用 bcrypt 或 PBKDF2 哈希存储

- Session ID 使用加密安全的随机数生成

- 分享令牌使用 32 位以上随机字符串

- 设置合理的 CORS 策略

- 敏感操作（删除、分享）需要二次确认

# 十、测试计划

## 10\.1 单元测试

- 工具函数测试（路径解析、文件名处理、大小格式化）

- 认证逻辑测试

- 元数据操作测试（使用 KV mock）

## 10\.2 集成测试

- 完整上传下载流程（小文件、大文件分片）

- 目录操作（创建、重命名、移动、删除）

- 分享功能（创建、访问、过期）

- Bot 命令测试

## 10\.3 边界测试

- 超大文件（2GB\+）分片上传下载

- 大量文件（1000\+）的列表性能

- 网络中断后的断点续传

- 并发上传（多文件同时上传）

- 特殊字符文件名

- 空文件、零字节文件

## 10\.4 手动测试清单

* [ ] 登录/登出功能正常

* [ ] 上传小文件（\< 1MB）成功

* [ ] 上传中等文件（10\-20MB）成功

* [ ] 上传大文件（\> 50MB）分片成功

* [ ] 下载文件完整，MD5 校验一致

* [ ] Range 请求正常（视频拖动）

* [ ] 创建一级文件夹（Topic）成功

* [ ] 创建子文件夹成功

* [ ] 重命名文件/文件夹成功

* [ ] 移动文件/文件夹成功

* [ ] 删除文件/文件夹成功，Telegram 消息同步删除

* [ ] 生成分享链接成功

* [ ] 分享链接可访问和下载

* [ ] 分享过期后无法访问

* [ ] Bot 命令响应正常

* [ ] 直接发文件到群组自动入库成功

* [ ] 图片/视频/音频预览正常

* [ ] 搜索功能正常

> （注：部分内容可能由 AI 生成）
