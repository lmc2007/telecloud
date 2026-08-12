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
| 部署 | Cloudflare Pages + Workers + GitHub Actions（同域 `<your-domain.com>`） |

## 🚀 自动部署 (CI/CD)

项目已配置 GitHub Actions，`git push main` 自动触发部署。

> ⚠️ **首次部署需完成以下三步**，之后每次 `git push` 即可自动部署：

### 第一步：配置 Worker Secrets（仅首次，本地执行）

Worker 运行需要以下密钥，必须先上传到 Cloudflare：

```bash
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHANNEL_ID
npx wrangler secret put JWT_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put WEBHOOK_SECRET
```

> 提示：执行每条命令后会提示输入值。`TELEGRAM_BOT_TOKEN` 从 @BotFather 获取，`JWT_SECRET` 用 `openssl rand -hex 32` 生成。

### 第二步：设置 GitHub Secret（仅首次）

1. 打开 https://dash.cloudflare.com/profile/api-tokens → **创建令牌** → 使用 "编辑 Cloudflare Workers" 模板
2. 创建后复制 Token
3. 打开你的 GitHub 仓库 → Settings → Secrets and variables → Actions → **New repository secret**
4. Name：`CLOUDFLARE_API_TOKEN`，值：粘贴 Token

### 第三步：推送即部署

```bash
git push main
```

Workflow 自动执行：
1. 构建并部署 Worker → `tgdrive`
2. 构建并部署前端 → `muleng-frontend`

也可本地运行 `deploy.bat` 一键部署（需在项目根目录 `.env` 中设置 `CLOUDFLARE_API_TOKEN`）。

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

## 🚀 手把手部署教程

> **预计耗时**：15~30 分钟 ｜ **费用**：完全免费（Telegram 免费 + Cloudflare 免费额度足够日常使用）

---

### 准备工作

#### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)，打开对话
2. 发送 `/newbot`，按提示输入 Bot 名称（如 `我的云盘`）和用户名（如 `mycloud_bot`，必须以 `bot` 结尾）
3. 创建成功后 BotFather 会返回一串 Token，格式类似 `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`，**复制保存**，这就是 `TELEGRAM_BOT_TOKEN`

#### 2. 创建 Telegram 超级群组

1. 在 Telegram 中点击左上角菜单 → **新建群组**
2. 随便拉一个好友进来（创建后可以踢掉），群组名称随意
3. 进入群组 → 点击群名 → **编辑（铅笔图标）** → **群组类型** → 改为 **私人群组**，同时开启 **话题模式（Topics）**
4. 群组设置中 → **管理员** → **添加管理员** → 搜索你刚创建的 Bot，设为管理员（权限全开）
5. 在 Web 版 TG（https://web.telegram.org）打开群组，浏览器地址栏中的数字就是 **Chat ID**，格式 `-100xxxxxxxxxx`。或者访问 `https://api.telegram.org/bot<你的TOKEN>/getUpdates`，在返回的 JSON 中找到 `chat.id`

#### 3. 注册 Cloudflare

1. 打开 [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) 注册账号
2. 登录后进入 [Cloudflare Dashboard](https://dash.cloudflare.com)

> Cloudflare Workers 免费版每天 10 万次请求，KV 每天 10 万次读写，D1 每天 500 万行查询——个人使用完全够用。

---

### 第一步：下载项目

**如果直接从 Release 下载（推荐，无需 Node.js 构建）：**

1. 打开 [Releases 页面](../../releases)，下载最新版 `cloud-nine-vX.X.X.zip`
2. 解压后得到 `worker/` 和 `frontend/` 两个目录，直接跳到 **第二步**

**如果从源码构建：**

```bash
git clone https://github.com/<你的用户名>/telecloud.git
cd telecloud
```

> 需要 Node.js ≥ 18，没有的话去 [nodejs.org](https://nodejs.org) 下载安装。

#### 源码配置文件说明

项目中有两个示例配置文件，部署前需要复制并填入你自己的信息：

**前端配置文件 `frontend/.env`：**

```bash
# 复制示例文件
cp frontend/.env.example frontend/.env
```

编辑 `frontend/.env`，把 `<your-domain.com>` 换成你的 Worker 域名或自定义域名：

```
VITE_API_BASE=https://你的域名/api
```

**Worker 配置文件 `worker/wrangler.jsonc`（可选）：**

```bash
# 复制示例文件
cp worker/wrangler.example.jsonc worker/wrangler.jsonc
```

编辑 `worker/wrangler.jsonc`，把两处占位符换成你在第二步创建的 KV 和 D1 ID。这个文件仅在使用 `wrangler deploy` 命令行部署时需要，Dashboard 手动部署可跳过。




### 第二步：创建 Cloudflare 资源

#### 2.1 创建 KV 命名空间

1. Cloudflare Dashboard → 左侧菜单 **Workers & Pages** → 顶部标签 **KV**
2. 点击 **Create namespace**
3. 名称填 `tgdrive-kv`（随意），点击 **Add**
4. 创建后会看到 ID，如 `e93083a3832c412fab0ba9a371fb0aa5`，**记录下来**，等下要用

#### 2.2 创建 D1 数据库

1. Cloudflare Dashboard → 左侧 **Workers & Pages** → 顶部标签 **D1**
2. 点击 **Create database**
3. 名称填 `tgdrive-db`，点击 **Create**
4. 创建后看到 ID，如 `50be523a-7cef-41fb-b30c-2f5758b5be39`，**记录下来**
5. 点击数据库名进入详情 → 顶部标签 **Console**
6. 在 SQL 输入框中依次执行两个迁移文件的内容：
   - 打开项目中的 `worker/migrations/0001_init.sql`，**复制全部内容** → 粘贴到 Console → 点击 **Execute**
   - 打开 `worker/migrations/0002_admin_index.sql`，**复制全部内容** → 粘贴 → 点击 **Execute**

---

### 第三步：部署后端（Worker）

#### 3.1 构建（Release 用户可跳过）

```bash
cd worker
npm install
npx esbuild src/index.ts --bundle --format=esm --target=es2022 \
  --outfile=dist/worker.js --platform=browser --external:cloudflare:workers
```

#### 3.2 创建 Worker

1. Cloudflare Dashboard → 左侧 **Workers & Pages** → 点击 **Create** 按钮
2. 选择 **Create Worker**
3. 名称填 `tgdrive-api`（随意），点击 **Deploy**（先不管代码，后面覆盖）

#### 3.3 上传代码

1. 进入刚创建的 Worker → 顶部标签 **Settings** → 右侧 **Edit Code**（或顶部 **Quick Edit**）
2. 如果从 Release 下载：打开 `worker/worker.js`，复制全部代码，粘贴覆盖编辑器中的内容
3. 如果从源码构建：复制 `worker/dist/worker.js` 的内容同上操作
4. 点击右上角 **Save and Deploy**

#### 3.4 配置环境变量和密钥

Worker → **Settings** → **Variables and Secrets**

**添加普通变量（Variables）：**

点击 **+ Add** → 选择 **Plain text**：

| 变量名 | 值 |
|--------|-----|
| `TELEGRAM_CHANNEL_ID` | 你的群组 Chat ID（如 `-100xxxxxxxxxx`） |
| `ENVIRONMENT` | `production` |

**添加密钥（Secrets）：**

点击 **+ Add** → 选择 **Secret**：

| 变量名 | 值 / 生成方式 |
|--------|------|
| `TELEGRAM_BOT_TOKEN` | 第一步从 BotFather 获取的 Token |
| `JWT_SECRET` | 运行 `openssl rand -hex 32` 生成，或随便打一串 64 位随机字符 |
| `JWT_REFRESH_SECRET` | 同上，另一个不同的随机字符串 |
| `ADMIN_PASSWORD` | 管理后台登录密码，自己设一个 |
| `WEBHOOK_SECRET` | 同上，随机字符串 |

> 所有 Secrets 填完后，点击 **Save**。

#### 3.5 绑定 KV 和 D1

Worker → **Settings** → **Bindings**

1. 点击 **+ Add** → 选择 **KV Namespace**
   - 变量名：`METADATA_KV`
   - 选择第二步创建的 KV（`tgdrive-kv`）

2. 点击 **+ Add** → 选择 **D1 Database**
   - 变量名：`DB`
   - 选择第二步创建的 D1（`tgdrive-db`）

> 点击 **Save** 保存所有绑定。

---

### 第四步：部署前端（Pages）

#### 4.1 构建（Release 用户可跳过）

```bash
cd frontend
npm install
npm run build   # 生成 dist/ 目录
```

#### 4.2 创建 Pages 项目

1. Cloudflare Dashboard → 左侧 **Workers & Pages** → 点击 **Create** → 选择 **Pages**
2. 选择 **Upload assets**（直接上传）
3. 项目名称填 `tgdrive`（随意），点击 **Create project**

#### 4.3 上传文件

1. 在 **Upload assets** 页面，拖入整个文件夹：
   - Release 用户：拖入 `frontend/` 目录
   - 源码用户：拖入 `frontend/dist/` 目录
2. 点击 **Deploy**，等待部署完成（约 10 秒）

#### 4.4 配置环境变量

部署完成后 → 顶部标签 **Settings** → **Environment variables**

点击 **Add variable**：

| 变量名 | 值 |
|--------|-----|
| `VITE_API_BASE` | `https://<你的Worker域名>/api` |

> Worker 域名在 Worker 详情页顶部，格式为 `tgdrive-api.你的用户名.workers.dev`。如果后面配置了自定义域名，这里填自定义域名。

点击 **Save** → 回到 **Deployments** 标签 → 点击最新的部署右侧的 **...** → **Retry deployment**（让新环境变量生效）。

---

### 第五步：配置自定义域名（强烈推荐）

让前端 Pages 和 API Worker 共享同一域名，避免跨域问题：

**前置条件**：Cloudflare 管理的域名（域名 DNS 服务器托管在 Cloudflare）

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入子域名如 `drive.你的域名.com`，点击 **Continue** → **Activate domain**
3. 进入 Worker → **Settings** → **Triggers** → **Routes** → **Add route**
4. Route 填 `drive.你的域名.com/api/*`，Zone 选你的域名，点击 **Add route**
5. 回到 Pages → **Settings** → **Environment variables**，把 `VITE_API_BASE` 改为 `https://drive.你的域名.com/api`
6. 重新部署一次 Pages 使变量生效

---

### 第六步：验证部署

1. 浏览器打开 Pages 域名（或你的自定义域名）
2. 看到登录/注册页面 → 注册一个账号
3. 登录后进入文件管理器 → 点击 **上传** 按钮，随便上传一个文件
4. 去 Telegram 群组中确认能看到 Bot 发了一条文件消息
5. 回到网页刷新，确认文件出现在列表中

> ⚠️ **首次部署后**，访问 `https://<你的Worker域名>/api/admin/login` 用 Admin 密码登录，然后访问 `/api/admin/migrate` 完成 KV→D1 数据回填（之后无需再操作）。

🎉 至此部署完成！享受无限容量的 Telegram 云盘吧。

## 📖 开发文档

详见 [DEVDOC.md](./DEVDOC.md) — 包含完整 API 路由表、存储架构、上传/下载架构、设计系统文档。

## 🌐 中国访问优化

- 自定义域名绑定 Pages + Workers

## 📄 许可

MIT License
