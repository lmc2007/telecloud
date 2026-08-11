# 上传 / 下载架构（当前实现）

> 本文档描述合并新版前端（iCloud 双主题）后、经多轮修复的**当前真实逻辑**。
> 关联文档：[CPU_LIMITS.md](./CPU_LIMITS.md)（Cloudflare 限制）、[UPLOAD_ANALYSIS.md](./UPLOAD_ANALYSIS.md)（链路分析）。
> 关键代码：`worker/src/index.ts`（WS 上传/下载、chunk 端点）、`worker/src/handlers/download.ts`（streamMergedDownload）、`worker/src/bot/telegram.ts`（sendDocument 流式）、`frontend/src/components/UploadZone.tsx`（前端分卷）、`frontend/src/pages/FileManager.tsx` / `ShareAccessPage.tsx`（前端下载）。

---

## 一、上传架构

### 1.1 三条路径（按文件大小分流）

| 文件大小 | 路径 | 说明 |
|---|---|---|
| **≤10MB** | HTTP multipart 直传 | `POST /files/upload` → `sendDocument` → 单条 TG 消息 |
| **>10MB ~ ≤95MB** | HTTP 直传 + 服务端分块 | 服务端 `Blob.slice(10MB)` → 多条 TG 消息 + JSON record |
| **>95MB** | **WebSocket 分卷** | 前端 45MB/卷 → WS → 服务端 5-15MB flush → 全部卷完成 → `POST /files/upload/complete` |

> 95MB 分界：Cloudflare 请求体 100MB 限制（Free），>95MB 必须走 WS。

### 1.2 前端分卷（UploadZone.tsx）

```
VOLUME = 45MB   // 每卷大小
BUF    = 1MB    // 每帧大小（file.slice）
INT    = 65ms   // 帧间隔（≈4MB/s）
```

**流程（串行，一次一个文件、一个卷）**：

```
多文件 → 全部注册 pending（TransferManager 串行队列）
for 每卷 vi (0..vols-1):
  wsVol(vi, vs, ve):
    新建 WebSocket → { type:"meta", filename, totalSize, volumeIndex: vi }
    ← { type:"ready" }
    → 1MB 帧 × N（每帧 sleep 65ms，保持 ~4MB/s）
    → { type:"volume_done" }
    ← { type:"volume_ok", fileIds:[{index,file_id,size}], received }
    校验: |received - 卷期望大小| ≤ 1024 && 无空 file_id
  失败 → volWithRetry 整卷重传（maxRetry=1）
all = 所有卷 fileIds 按卷顺序拼接
POST /files/upload/complete { filename, total_size, parent_id, file_ids: all }
校验: Σ卷期望大小 === file.size
```

> **size 字段**：`volume_ok` 的每个 fileId 携带该 flush 的**真实字节数**（服务端 `merged.size`），前端透传给 complete——complete **不再调用 Telegram getFile**（见 1.5）。

### 1.3 服务端 WS 收帧与 flush（index.ts handleWsUpload）

```
每卷一个独立 WS 连接（state 独立）
收帧: 1MB Blob push 到 state.chunks；state.bytes += size
     bytes ≥ 5MB → scheduleFlush()
volume_done → state.drain = true → scheduleFlush()

flush():
  takeBytes 累积到 MAX_FLUSH_SIZE=15MB（帧边界截断，至少 1 帧）
  merged = new Blob(toSend)          // 惰性拼接，不拷贝
  partIdx = state.fileIds.length
  sendDocument(env, chatId, merged, "file_v{vi}_p{pi}", topicId)
  state.fileIds.push({ index: vi*100 + partIdx, file_id, size: merged.size })

scheduleFlush():
  chunks 空 && drain → 发 volume_ok + 关连接
  flushing 互斥 + setTimeout(0) 让出 CPU + MIN_FLUSH_GAP(100ms) 限频
```

**关键点**：
- **5MB 阈值 / 15MB 上限**：单次 flush 5~15MB（45MB 卷通常 3~9 条 TG 消息），平衡 TG 20 条/分钟限流与消息数
- **`index = volumeIndex*100 + partIdx`**：卷内序号，complete 按此排序恢复字节顺序
- **keepalive**：每 10s 发 `{type:"ka"}` 心跳，防 CF "hung" 检测（TG retry_after 等待期连接空转）
- **progress 节流**：每 2MB 发一条（`lastProgressBytes`），降 WS 消息开销
- **drain 模式**：volume_done 后无视 5MB 阈值强制排空剩余数据

### 1.4 sendDocument（telegram.ts）——流式 multipart

```
>2MB:  ReadableStream + duplex:"half"
       256KB 分片 enqueue + 每片 await setTimeout(0) 让出 CPU
       multipart 手动构造（chat_id / disable_content_type_detection / message_thread_id / caption / document）
≤2MB:  普通 FormData（小文件）
重试:  retryWithBackoff ×3（每次重建流，流只能消费一次）
```

**为什么流式**：一次性同步序列化 10-15MB multipart 会超过 CF Free 的 **10ms CPU 限制**（日志实锤 `Worker exceeded CPU time limit`）。流式 + 分片让出后，单次连续 CPU 只有 256KB 拷贝量（~0.1ms）。

**完整性校验**：发送后比对 Telegram 返回的 `file_size` 与发送字节数，偏差 >1KB 或 0.1% **抛错**（防 TG 存储截断）。

### 1.5 upload/complete（0 子请求 + 校验）

```
接收 file_ids（含每块 size）
sort by index → 按 (卷, 卷内序号) 恢复字节顺序
chunkInfos = file_ids.map(c => ({ index, size: c.size, telegram_file_id: c.file_id }))
   // 不用 getFile——200+ chunk 会超 CF Free 50 子请求/请求上限
校验:
  zeroSizeChunks（size=0 的块，旧前端上传）→ 警告
  sumSizes vs declaredTotal，偏差 >1KB/0.1% → 400 拒绝（宁可失败不存坏文件）
  每卷 partIdx 从 0 连续（INDEX SEQ BROKEN 检测）
record 文件 → sendDocument 一条 JSON（fileIds 持久化，下载可恢复）
setFileMeta → KV + D1
```

---

## 二、下载架构

### 2.1 小文件（is_chunks=false）

```
GET /files/:id/download → directDownload
  getFile → file_path → getFileStream(CDN) → 流式转发
  Content-Disposition: image/video/audio → inline，其他 → attachment
```

### 2.2 大文件（is_chunks=true）——主路径

```
前端 downloadFileBlob(item):
  GET /files/:id/chunks → 222 个 { index, size }
  chunks.length ≤ 1 → 走 /download（遗留）
  否则 → for i in 0..N-1:
    GET /files/:id/chunk/:index   // 每个 chunk 独立 HTTP 请求！
    校验: blob.size === chunks[i].size（>0 时）；size=0 时 blob 非空
    失败 → 指数退避重试 ×3（1s/2s/4s+抖动）
    每 chunk 间 sleep 200ms
  new Blob(chunkBlobs)
  校验: blob.size === item.size   // 拼接总大小兜底
```

**关键点**：
- **每 chunk 独立请求**：每个请求有自己独立的 50 子请求配额（只用 1-2 个）——**大文件下载不受 50 限制影响**（chunk 数不限）
- **服务端 `/chunk/:index`（index.ts handleDownloadChunk）**：
  ```
  meta.chunks[chunkIdx] → file_path（KV 缓存 or getFile 解析 or record 恢复）
  CDN 流 arrayBuffer() 读完整
  校验: chunk.size > 0 && buf.byteLength !== chunk.size → 500（明确报错）
  返回: new Response(buf, { Content-Length: buf.byteLength })
  ```
  **为什么 arrayBuffer**：旧代码 `Content-Length: String(chunk.size || 0)` 在 size=0（旧数据）时发 `Content-Length: 0`，浏览器按声明截断 body → 静默缺字节。现在读完整校验 + 返回真实长度，杜绝截断。

### 2.3 分享下载（/s/:token）

```
GET /s/:token/chunks        → 分块元数据（入口门控，D1 原子递增下载计数）
GET /s/:token/chunk/:index  → 单 chunk（仅校验密码，不计数）
GET /s/:token/stream        → 预览流（serveChunkRange，不计数）
前端 ShareAccessPage：同样的串行下载 + blob.size 校验 + 拼接总大小校验
```

**URL 构造（shareUrl helper）**：分享下载请求统一用 `shareUrl(path, fileIndex)` 构造——
内部 `URLSearchParams` 处理 `pw` 与 `file_index` 参数及 `?`/`&` 分隔与编码。
> 历史 bug：早期用字符串拼接 `?pw=xxx` + `&file_index=N`，无密码多文件分享时
> URL 变成 `/chunks&file_index=1`（`&file_index` 落在路径里），后端读不到
> `file_index`，永远取第 0 个文件的块 → 前端拼接待校验 `blob.size !== file.size`
> → 下载失败、进度条消失。

**下载进度**：`downloadFileBlob` 的 `onChunk` 回调携带
`(done, total, downloadedBytes, totalBytes)`，TransferManager 显示
"已下载 X / 总 Y"（字节，按实际 `blob.size` 累计），进度条按字节比例。


### 2.4 遗留 streamMergedDownload（/download 端点）

```
单请求内合并所有 chunk 流式返回（Range 请求支持）
eager 模式: ≤20 chunk，预解析全部 file_path（并发 ≤6）
lazy 模式:  >20 chunk，pull() 内按需解析 + 预取下一个
trackSubReq: >45 子请求抛错（Free 50 上限，防静默超限）
增量 cumulativeOffset 维护 chunk 偏移（避免 O(n²)）
```

> 注：前端大文件不走此路径（走 2.2）。此端点服务于小文件与历史兼容。

### 2.5 预览（serveChunkRange，/stream）

```
小文件 → directDownload（浏览器直接播放）
大文件 → 按 Range 定位 chunk → CDN 流 → 提取精确字节段（内存峰值 ~8MB）
  末尾 moov 请求 → 取最后 12 chunk 兜底；非末尾 ±5 chunk buffer
预览 token: 30 分钟 JWT（<img>/<video> 无法带 Authorization 头）
```

---

## 三、完整性校验体系

### 3.1 上传（防"不漏传、不损坏"）

| 层 | 校验 | 防什么 |
|---|---|---|
| 前端字节 | `received ≈ 卷期望大小 ±1KB` | 卷内字节缺失 |
| 前端 file_id | 空 file_id 检查 | 服务端返回空 fid |
| 前端总量 | Σ卷期望大小 === file.size | 漏卷 |
| 服务端 flush | fileId 携带真实 `size` | 精确记录每块字节 |
| **complete 总和** | sumSizes vs declaredTotal（偏差>1KB/0.1% **400 拒绝**） | 漏块/截断 |
| **complete 序列** | 每卷 partIdx 从 0 连续 | 顺序错误 |
| **sendDocument** | TG file_size vs 发送字节（偏差抛错重试） | TG 存储截断 |
| 重试 | sendDocument ×3 + 前端卷重试 ×1 | 瞬时失败/429 |

### 3.2 下载（防"静默损坏"）

| 层 | 校验 | 说明 |
|---|---|---|
| 服务端 `/chunk/:index` | arrayBuffer 后 `buf.byteLength === chunk.size`（>0 时） | 不符 500，明确报错 |
| 前端单 chunk | `blob.size === chunks[i].size`（>0 时） | 不符重试 ×3 |
| 前端 size=0 兜底 | blob 非空 | 旧数据（size 未知）至少不空 |
| 前端总大小 | `blob.size === item.size` | 拼接后兜底 |

---

## 四、平台限制应对

| 限制 | 值 | 应对 |
|---|---|---|
| CPU 时间 | Free 10ms/请求 | 流式 sendDocument（256KB 分片+让出）；flush `setTimeout(0)` 链；progress 2MB 节流 |
| 子请求 | Free 50/请求 | complete **0 子请求**（size 由 WS 带回）；下载每 chunk **独立请求**（各 50 配额） |
| 出站并发连接 | 6/请求 | `MAX_CONCURRENT_RESOLVE = 6`（streamMergedDownload 预解析） |
| 内存 | 128MB/isolate | chunk arrayBuffer ≤15MB；WS 下载逐段 send（O(read 段)）；flush Blob 惰性拼接 |
| WebSocket 消息 | 32MiB 上限 | chunk ≤15MB 单帧安全 |

---

## 五、关键参数表

| 参数 | 值 | 位置 |
|---|---|---|
| 上传分流阈值 | 10MB / 95MB | UploadZone + upload 路由 |
| 卷大小 VOLUME | 45MB | UploadZone.tsx:36 |
| 帧大小 BUF | 1MB | UploadZone.tsx:36 |
| 帧间隔 INT | 65ms | UploadZone.tsx:36 |
| 卷重试 maxRetry | 1 | UploadZone.tsx:71 |
| flush 阈值 | 5MB | index.ts:1290/1300 |
| flush 上限 MAX_FLUSH_SIZE | 15MB | index.ts:1193 |
| 流式分片 | 256KB + setTimeout(0) | telegram.ts |
| 流式阈值 | >2MB | telegram.ts:44 |
| TG 大小校验阈值 | 1KB 或 0.1% | telegram.ts |
| 心跳间隔 | 10s | index.ts:1179 |
| progress 节流 | 每 2MB | index.ts:lastProgressBytes |
| complete 拒绝阈值 | 1KB 或 0.1% | index.ts |
| chunk index 生成 | `volumeIndex*100 + partIdx` | index.ts:1199 |
| 下载重试 | 指数退避 ×3（1s/2s/4s+抖动） | FileManager.tsx |
| chunk 间间隔 | 200ms | FileManager.tsx |
| streamMerged lazy 阈值 | >20 chunk | download.ts:210 |
| streamMerged 并发 | 6 | download.ts:209 |
| streamMerged 子请求上限 | 45 | download.ts:102 |

---

## 六、历史修复记录（为什么现在是这个样）

| 问题（日志现象） | 根因 | 修复 |
|---|---|---|
| `Worker exceeded CPU time limit`（15MB flush 后 100ms 内被杀） | FormData 一次性序列化 15MB 超 10ms CPU | sendDocument 流式 multipart + 分片让出（telegram.ts） |
| `Too many subrequests`（upload/complete 挂起） | complete 逐个 getFile 超 50 子请求 | size 由 WS flush 带回，complete 0 子请求（index.ts） |
| 下载"文件不完整"（期望 N 实际 N-7MB） | size=0 旧数据 + `Content-Length: 0` 截断 body | `/chunk/:index` arrayBuffer 校验 + 返回真实长度（index.ts） |
| 下载静默损坏（无报错） | 前端不校验 blob.size | 前端双层校验（FileManager/ShareAccessPage） |
| 上传"100% 不完成" | complete getFile 重试空转 | 同上 complete 0 子请求 |
| 分享页多文件下载失败（进度条消失） | URL 字符串拼接 `&file_index=N` 落在路径里，后端读不到 file_index，永远取第 0 个文件 | `shareUrl` helper 用 `URLSearchParams` 统一构造（ShareAccessPage） |
| 下载进度无字节显示 | TransferItem 无下载字节字段 | `downloadedBytes` 字段 + `onChunk` 携带字节（transferStore/FileManager/TransferManager） |
