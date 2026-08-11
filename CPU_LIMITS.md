# Cloudflare Workers CPU 时间限制探究

> 基于 Cloudflare 官方文档（2026-04 更新版）核实 + 本项目代码审计。
> 关联文档：[UPLOAD_ANALYSIS.md](./UPLOAD_ANALYSIS.md)（上传链路完整性/CPU 修复分析）。
> 官方来源：developers.cloudflare.com/workers/platform/limits/、/workers/runtime-apis/、/workers/observability/errors/。

---

## 一、CPU 配额（各计划）

| 计划 | CPU/请求 | 说明 |
|---|---|---|
| **Free** | **10 ms** | HTTP 请求与 Cron Trigger 均为 10ms；每日 100,000 请求 |
| **Paid** | **30 s 默认**，最大可配 **5 min（300,000 ms）** | 通过 wrangler `limits.cpu_ms` 或 dashboard 调整；Cron <1h 间隔 30s、≥1h 间隔 15min |
| Bundled / Unbound | **已废弃** | 不再对新账户开放；Bundled 例外（CPU 50ms、子请求 50）；Unbound 等同 Paid |

> 官方原文："Waiting on network requests (such as fetch() calls, KV reads, or database queries) does **not** count toward CPU time."
> 平均请求 ~2.2ms CPU，重负载 10–20ms。

**本项目**：部署在 Free 计划 → **每请求 10ms 连续 CPU** 是硬约束。

---

## 二、CPU 计时规则

| 场景 | 是否计 CPU | 官方核实程度 |
|---|---|---|
| `await fetch()` / KV / D1 等 I/O 等待 | **否**（不计） | ✅ 官方原文 |
| I/O 返回后恢复执行 | 是（从断点续计） | ✅ 推断（分段计费模型） |
| 流式响应 `ReadableStream` 的 `pull()` | 每段独立计费；段内 `await reader.read()` 等待不计 | ⚠️ 推断（streams 页无字面表述） |
| WebSocket 长连接 | 按消息处理段累计；I/O 等待段不计 | ⚠️ 官方无 CPU 计费细则（websockets 页仅限消息大小 32 MiB） |
| `setTimeout` 睡着的等待（retry backoff） | **否**（睡眠段不计） | ⚠️ 推断（按"只测执行代码时间"定义） |
| `setTimeout` 回调执行 | 是 | ✅ 推断 |

**关键机制（本项目所有 CPU 优化的理论依据）**：CPU 计时器在 **I/O 边界（await）重置**——只要任何两段 `await` 之间的同步代码 < 10ms 即安全。Cloudflare 2024 年引入 "isolate CPU flexibility" 机制（文档以 `<Render>` 嵌入，原文未能逐字抓取）。

---

## 三、关联限制（与 CPU 协同影响设计）

| 限制 | Free | Paid | 对本项目的影响 |
|---|---|---|---|
| **子请求**（subrequests） | **50/请求** | 10,000（可配 10M） | 大文件下载每 chunk 需 getFile + CDN fetch = 2 子请求 → Free 上限 ~25 chunk（~375MB）；上传 complete 已改为 0 子请求 |
| **并发出站连接**（等待响应头） | **6 个/请求** | 同 | 第 7+ 排队（非报错）；并行 getFile 应 ≤6 |
| 内存 | 128 MB/isolate | 同 | WS 上传 flush ≤15MB + 流式 body 峰值 ~30MB 安全；需避免大缓冲 |
| 请求体 | 100 MB（Free/Pro） | 账户计划定 | >95MB 走 WebSocket 分卷 |
| 响应体 | 无上限 | 同 | 流式下载不受限 |
| 墙钟（wall-clock） | 无上限（客户端保持连接即可） | 同 | 下载/上传可长时间运行；`waitUntil` 最多 30s |
| 启动时间 | 1s | 同 | 超限报 Error 10021 |

---

## 四、常见错误

| 错误 | 触发条件 | 官方说明 |
|---|---|---|
| **"Worker exceeded CPU time limit"** / Error 1102 | 同步 CPU 超过配额（大循环、大块序列化等） | ✅ 官方：dashboard 显示 "Exceeded CPU Time Limits"，Logpush outcome `exceededCpu` |
| **"Your Worker's code had hung"** | 运行时判定调用"无进展挂起"（常见于 CPU 耗尽或长阻塞） | ⚠️ 官方 errors 页未收录此短语，为社区/运行时行为推断 |
| Error 1027 | Free 日请求 100,000 超限 | ✅ |
| Error 10021 | 启动超时（1s） | ✅ |

---

## 五、本项目代码审计

### 已做 CPU 优化（模式正确，符合 "I/O 不计 CPU" 机制）

| 位置 | 措施 |
|---|---|
| `bot/telegram.ts` — sendDocument（>2MB） | **流式 multipart body**：`ReadableStream` + `duplex:"half"`，256KB 分片 + 每片 `await setTimeout(0)` 让出，避免 15MB 一次性同步序列化超 10ms（历史 `Worker exceeded CPU time limit` 根因） |
| `index.ts` — WS 上传 scheduleFlush 链 | 5MB 阈值 + flush 用 `setTimeout(0)` 异步执行 + finally 递归续链 + `MIN_FLUSH_GAP` 限频 |
| `index.ts` — WS 上传 progress | 节流至每 2MB（原每 1MB 帧） |
| `index.ts` — WS 上传 flush | `MAX_FLUSH_SIZE = 15MB`（配合流式 body 无 CPU 压力；兼顾 TG 20 条/分钟限流消息数） |
| `index.ts` — WS 上传 keepalive | 每 10s 心跳防 hung 检测（TG retry_after 等待时） |
| `index.ts` — handleUploadComplete | **0 子请求**（chunk size 由 WS flush 真实字节随 volume_ok 带回）——同时绕开 Free 50 子请求上限 |
| `handlers/download.ts` — lazy 模式 | >20 chunk 时按需解析 file_path + 预取，控制子请求节奏 |
| `index.ts` — WS 下载 | `MAX_SUBREQ = 45` 给 Free 50 留余量 |
| 各处 retry sleep | 睡着等待不计 CPU |

### 风险点（本轮已修复 ✅ / 已记录 ⚠️）

| 位置 | 风险 | 处置 |
|---|---|---|
| `handlers/download.ts` — `chunkByteStart` 每 pull 重算 | **O(n²) 整数加法**，几百 chunk 大文件叠加 Free 10ms | ✅ **已修**：增量维护 `cumulativeOffset`（预计算起点 + 每 chunk 递增） |
| `handlers/download.ts` — `MAX_CONCURRENT_RESOLVE` | 10 > 平台 **6 并发连接**，第 7+ 排队降吞吐 | ✅ **已修**：10 → 6 |
| `handlers/download.ts` — `trackSubReq` | 只计数不检查；>25 chunk（~375MB）在 Free 50 子请求下**静默超限**（流中断 → 损坏文件） | ✅ **已修**：>45 时抛明确错误 |
| `index.ts` — `streamChunkToWs` | 整个 chunk（15-20MB）缓冲进数组再合并单帧，峰值 ~2×chunk（~40MB），多并发逼近 128MB | ✅ **已修**：逐段 `server.send`（每 read 段一帧），内存 O(read 段大小）；该路径当前无前端调用方，协议由调用方 `progress` 消息标记 chunk 边界 |
| `index.ts` — flush `new Blob(toSend)` | ≤15MB + 流式 multipart 峰值 ~30MB | ⚠️ 安全（128MB 内），不宜再增大阈值 |
| WebSocket 消息大小 | 单帧上限 32 MiB（关闭码 1009） | ⚠️ 当前 chunk ≤15MB 单帧安全；`streamChunkToWs` 逐段化后更安全 |

---

## 六、结论

1. **Free 计划 10ms CPU 是硬约束**，但"await I/O 不计 CPU + 计时器 I/O 边界重置"使长任务可通过**切碎 + 让出**绕过——本项目上传链路已按此原则完成流式化。
2. **真正的短板是子请求（50/请求）**：大文件下载（>25 chunk / ~375MB）在 Free 下必然受限，本轮已从"静默损坏"改为"明确报错"；升级 Paid 可解除。
3. **并发出站连接 6 个/请求** 是容易被忽略的隐藏限制，并行 fetch 应 ≤6。
4. 墙钟无上限 + 响应体无上限 → 流式大文件传输在 Free 上可行，瓶颈只在 CPU 突发与子请求计数。
