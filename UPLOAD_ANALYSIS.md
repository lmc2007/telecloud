# 上传链路分析：CPU 时间限制与完整性保障

> 基于合并后代码（Hono v3.0.0 + 流式 sendDocument + complete 零子请求）的分析结论。
> 本文档仅为分析，不包含代码改动。关键参数核对日期：合并完成后。
>
> **关联文档**：[CPU_LIMITS.md](./CPU_LIMITS.md) — Cloudflare Workers CPU 时间限制完整探究
> （官方配额/计时规则/关联限制 + 项目代码审计）。

## 背景：Cloudflare Workers 免费版限制

| 限制 | 值 | 对本项目的影响 |
|---|---|---|
| CPU 时间 | **10ms/请求**（连续执行） | 任何两段 `await` 之间的同步代码块必须 <10ms |
| 子请求 | **50/请求** | complete 逐个 `getFile` 解析 chunk 大小必爆（200+ chunk） |
| 请求体 | 100MB（HTTP） | >95MB 走 WebSocket 分卷 |
| WebSocket | 长连接 | 需要 keepalive 防 "hung" 检测 |

> 关键机制：**CPU 计时器在每次 `await`（I/O）时重置**。"绕过"CPU 限制的本质是——
> 把大任务切碎，用 I/O 让出，保证任何同步代码块 <10ms。

---

## 问题 1：CPU 时间限制能否绕过？如何优化？

### 当前上传链路的 CPU 消耗点（逐点核对）

| 阶段 | 操作 | 单次 CPU | 当前状态 |
|---|---|---|---|
| WS 收帧 | 1MB Blob push + 状态累加（每 65ms 一帧） | <1ms | ✅ 安全 |
| flush 组装 | `new Blob(toSend)` 惰性拼接（5~15MB） | <1ms | ✅ 安全 |
| **sendDocument** | **multipart body 构造** | **曾 >10ms ❌** | ✅ **已修复（流式）** |
| progress | 每 2MB 一条 WS 消息 | <1ms | ✅ 已节流 |
| keepalive | 每 10s 一条心跳 | <1ms | ✅ 安全 |
| upload/complete | 0 子请求 + 内存校验 | <1ms | ✅ 已去 getFile |

### 结论：当前逻辑已绕过 CPU 时间限制

三道关键防线（均为合并时带入）：

1. **流式 multipart body（治本）**
   `sendDocument` 对 >2MB 的 payload 用 `ReadableStream` + `duplex:"half"`，
   256KB 分片 enqueue，每片之间 `setTimeout(0)` 让出——即使 15MB 的 flush，
   单次连续 CPU 也只有 256KB 的拷贝量（~0.1ms），远低于 10ms。
   *历史日志中反复出现的 `Worker exceeded CPU time limit` 正是 15MB FormData
   一次性序列化触发，流式化后不再出现。*

2. **complete 零子请求**
   chunk 大小由 WS flush 时真实字节数（`merged.size`）随 `volume_ok` 带回前端，
   complete 直接使用，不再逐个 `getFile`——同时绕开 50 子请求/请求上限
   （200+ chunk 时必爆，日志实锤过 `Too many subrequests`）。

3. **`setTimeout(0)` 让出链**
   flush 完成后重新 `scheduleFlush` 用 `setTimeout(0)`，防止 CF "hung" 检测。

### 可进一步优化的点（按收益排序，均非必需）

| 优化 | 收益 | 代价/风险 |
|---|---|---|
| **并发卷上传**（当前串行，每卷一个 WS 连接） | 上传总时间显著缩短：TG 429 `retry_after` 等待期可与其他卷重叠 | 同时打 TG，20 条/分钟限流更紧张；需服务端限速协调，改动较大 |
| **日志降级**：`[sendDocument] ok` 每 flush 一条，单请求 256KB 日志上限，大文件（38 卷×9 flush≈342 条）接近上限 | 减少日志 I/O，防日志截断 | 排查问题时信息变少 |
| flush 大小自适应 | 基本没有（15MB 已是消息数最少） | 无需改 |
| 帧大小（1MB/帧） | 基本没有（已合理） | 无需改 |

---

## 问题 2：大文件上传能否保证精确分卷、不漏传、不损坏？

### 当前分层保障（逐层核对）

| 层 | 校验机制 | 防什么 | 状态 |
|---|---|---|---|
| 前端字节 | `received == 期望卷大小 ±1KB` | 卷内字节缺失 | ✅ |
| 前端 file_id | 空 file_id 检查 | 服务端返回空 fid | ✅ |
| 前端总量 | `totalBytes == file.size`（所有卷累加） | 卷数不足/漏卷 | ✅ |
| 服务端 flush | `fileIds` 携带 `size: merged.size`（真实字节数） | 精确记录每块大小 | ✅ |
| **complete 总和校验** | `sumSizes vs declaredTotal`，偏差 >1KB/0.1% **直接 400 拒绝** | 分块总字节 ≠ 声明大小（漏卷/截断） | ✅ |
| **complete 序列校验** | 每卷 partIdx 从 0 连续（`INDEX SEQ BROKEN` 检测） | 排序/顺序错误 | ✅ |
| sendDocument 内容校验 | TG 返回 `file_size` vs 发送大小，偏差 >1KB/0.1% 抛错 | TG 存储截断 | ✅ |
| 重试 | sendDocument retry×3（指数退避）+ 前端卷重试×1 | 瞬时失败/429 | ✅ |
| record 文件 | fileIds 持久化到 TG record 消息，下载可恢复 | 元数据丢失后恢复 | ✅ |

### 结论：已能保证不漏传、不损坏

两条强校验闭环：

- **字节数闭环**：flush 记录真实字节 → complete 与声明总量比对，偏差即拒绝
  （宁可上传失败也不存坏文件）。
- **顺序闭环**：每卷 partIdx 连续性校验 + index 排序
  （模拟验证过 100MB/3 卷场景，拼接字节顺序 100% 正确）。

### 剩余缺口（按严重性）

| 缺口 | 严重性 | 说明 |
|---|---|---|
| **index 理论冲突**：`volumeIndex * 100 + partIdx`，若某卷 flush ≥100 则跨卷 index 撞号 | ⚠️ 低 | 实际 45MB/5MB 最多 9 个 flush，不会触发；属脆弱设计，改 `* 1000` 或全局计数器可彻底消除 |
| **孤儿 TG 消息**：卷重试时已成功的 flush 残留群组 | ⚪ 无影响 | 内容相同仅浪费存储，不影响正确性 |
| **无端到端 hash**：只验证字节数，未验证 "TG 存储内容 == 本地文件内容" | ⚪ 极低 | Telegram 对 document 不做转码，内容被篡改风险趋近于零；hash 校验成本高，收益低 |
| 缺卷静默检测 | ✅ 已覆盖 | 某卷丢失 → sumSizes 偏小 → complete 拒绝 |

---

## 核心结论

1. **CPU 限制已被绕过**（流式 sendDocument + 零子请求 complete），无需再动即可稳定上传；
   真要提速只剩"并发卷上传"一条路，但要权衡 TG 20 条/分钟限流。
2. **大文件完整性已有完整保障**。"下载损坏变小"的历史问题根因**不在上传端**
   （日志实锤所有 flush `sent == tg diff=0`），而在**下载端 CDN 流截断无校验**——
   若后续要彻底解决，方向是下载端完整性校验（`/chunk/:index` 校验实际字节数、
   前端校验 `blob.size === chunks[i].size`），而不是上传端。
3. 唯一建议的低成本加固：`volumeIndex * 100` → `* 1000`（消除 index 撞号脆设计，锦上添花）。
