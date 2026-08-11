# AGENTS.md — AI 开发流程

## 修改前必读

- `DEVDOC.md`：架构、API 路由表、存储设计
- `worker/src/types/index.ts`：后端全部类型
- `frontend/src/stores/fileStore.ts`：前端 FileItem 类型

## 修改后必跑

```bash
# 后端：改了 worker/src/ 下任何文件都要跑
cd worker && npx esbuild src/index.ts --bundle --format=esm --target=es2022 --outfile=dist/worker.js --platform=browser --external:cloudflare:workers

# 前端：改了 frontend/src/ 下任何文件都要跑
cd frontend && npm run build   # tsc --noEmit && vite build
```

两边都通过才算改完。

## 前端改动影响面

| 改了 | 可能影响 |
|------|---------|
| `api.ts` | 所有页面和组件的 API 调用 |
| `stores/*.ts` | 所有使用该 store 的组件 |
| `FileItem` 类型 | FileTable、FileGrid、FileIcon、ContextMenu、PreviewModal、ShareAccessPage |
| `globals.css` | 全局样式 |
| `ShareAccessPage` | 分享页桌面端 + 移动端（双轨渲染，两端都要改） |
| `FileManager` | `/app` 桌面端 + 移动端（两端都要改） |

## 后端改动影响面

| 改了 | 可能影响 |
|------|---------|
| `types/index.ts` | 全局类型，前端可能也有对应接口 |
| `routes/shares.ts` | 分享创建/访问/下载全链路 |
| `routes/files.ts` | 文件 CRUD + 回收站 + 搜索 |
| `storage/kv.ts` | 所有 route 和 handler 的持久化 |
| `handlers/upload.ts` | 上传会话 + WS 上传 |
| `handlers/download.ts` | 流式下载 + chunk/Range 处理 |
| `index.ts` | `handleUploadComplete`、WS 路由、自定义 HTTP handler |

## 常见陷阱

1. **前端 `FileItem.type`** 是 `"file" | "folder"`，新增属性要同步 `toFileItem()` 适配器（ShareAccessPage 用）
2. **分享页双轨**：ShareAccessPage 有 `isMobile` 分支，改桌面端也要改移动端
3. **文件夹分享**：D1 `file_id` 列存 JSON 数组 `["uuid"]`，解析要 `JSON.parse` + 检测 KV `target_type`
4. **D1 同步**：`setFileMeta`/`setFolderMeta` 内部 await 同步 D1，不要在外面再写一遍
5. **KV key 格式**：`file:{id}` / `folder:{id}` / `child:{parent}:{child}` / `share:{token}` / `user_root:{userId}`
6. **路由顺序**：`DELETE /files/trash` 必须在 `DELETE /files/:id` 前注册
7. **upload/complete**：`file_ids` 需要 `index` 字段排序，前端 wsVol 中的 `r.ids` 已按 index 排序
8. **敏感信息**：域名、KV/D1 ID 不要硬编码，用 `.env` / `wrangler.jsonc`（都在 `.gitignore` 中）

## 新增功能 checklist

1. 后端类型定义 (`types/index.ts`)
2. 后端路由/逻辑
3. 前端类型适配（如果需要）
4. 前端 UI（桌面 + 移动双轨）
5. 构建验证（worker + frontend 都通过）
6. 更新 `DEVDOC.md`（API 路由表、架构说明）
7. 更新 `README.md`（如果是用户可见功能）
