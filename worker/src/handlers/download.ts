import type { Env, BigFileInfo, FileMetadata, ChunkInfo } from "../types";
import { getFile, getFileStream } from "../bot/telegram";
import { getFileMeta } from "../storage/kv";
import { getMimeType } from "../utils/common";

/**
 * Download a file from Telegram.
 *
 * For small files: directly stream from Telegram CDN.
 * For large files (is_chunks=true): download the record file, parse the chunk list,
 * then stream-merge all chunks in order.
 *
 * tgDrive-style implementation: every file's telegram_file_id points to a Telegram document.
 * We download it, try to parse as BigFileInfo JSON. If it parses, it's a large file record;
 * otherwise it's the actual small file content.
 */
export async function downloadFile(
  env: Env,
  fileId: string,
  range?: { start: number; end: number } | null
): Promise<Response> {
  try {
    const meta = await getFileMeta(env, fileId);
    if (!meta) {
      return new Response(JSON.stringify({ error: "File not found" }), { status: 404 });
    }

    if (meta.is_chunks && meta.chunks && meta.chunks.length > 0) {
      console.log(`[download] file=${fileId} path=streamMerged chunks=${meta.chunks.length} range=${range ? `${range.start}-${range.end}` : "none"}`);
      return await streamMergedDownload(env, meta, range);
    } else {
      console.log(`[download] file=${fileId} path=directDownload size=${meta.size}`);
      return await directDownload(env, meta);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Download failed";
    console.error("Download error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 });
  }
}

/**
 * Direct download for small files.
 * Downloads from Telegram CDN and streams to the client.
 */
async function directDownload(env: Env, meta: FileMetadata): Promise<Response> {
  if (!meta.telegram_file_id) {
    return new Response(JSON.stringify({ error: "No telegram file_id" }), { status: 500 });
  }

  const file = await getFile(env, meta.telegram_file_id);
  if (!file.file_path) {
    return new Response(JSON.stringify({ error: "File path not available" }), { status: 500 });
  }

  const response = await getFileStream(env, file.file_path);
  if (!response.ok || !response.body) {
    return new Response(JSON.stringify({ error: "Failed to download from Telegram" }), { status: 500 });
  }

  // Create a new response with proper headers
  const mimeType = meta.mime_type || "application/octet-stream";
  const isInlineType = mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/");

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": isInlineType
        ? `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`
        : `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Content-Length": String(meta.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}

/**
 * Stream-merge download for large files (chunked storage).
 *
 * Approach:
 * 1. Read chunks metadata from FileMetadata.chunks
 * 2. Download each chunk sequentially from Telegram CDN
 * 3. Pipe chunks into a unified ReadableStream
 * 4. Support Range requests
 */
async function streamMergedDownload(
  env: Env,
  meta: FileMetadata,
  range?: { start: number; end: number } | null
): Promise<Response> {
  const chunks = meta.chunks!;
  const totalSize = meta.size;
  let subReqCount = 0;
  // Cloudflare Free caps subrequests at 50/invocation. Track and fail early
  // with a clear error instead of letting the runtime abort mid-stream
  // (which silently corrupts the download). 45 leaves margin for the
  // record-recovery getFile path.
  const MAX_SUBREQ = 45;
  const trackSubReq = () => {
    subReqCount++;
    if (subReqCount > MAX_SUBREQ) {
      throw new Error(`Too many subrequests (${subReqCount} > ${MAX_SUBREQ}); file too large for the Cloudflare Free plan (max ~${Math.floor(MAX_SUBREQ / 2)} chunks)`);
    }
  };

  // Fix legacy chunks where size is 0 (upload didn't record per-chunk size).
  // Estimate so the range→chunk-index calculation below works correctly.
  const avgChunkSize = Math.ceil(totalSize / chunks.length);
  for (const c of chunks) {
    if (!c.size || c.size <= 0) c.size = avgChunkSize;
  }

  // Determine which chunks to download based on range
  let startChunkIdx = 0;
  let endChunkIdx = chunks.length - 1;
  let rangeStart = 0;
  let rangeEnd = totalSize - 1;

  if (range) {
    rangeStart = range.start;
    rangeEnd = Math.min(range.end, totalSize - 1); // clamp Infinity
  }

  // Find chunk range for the requested byte range.
  // Chunk sizes may be estimates (legacy data had size=0), so add ±1 buffer.
  let byteOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (byteOffset + chunks[i].size > rangeStart) {
      startChunkIdx = i;
      break;
    }
    byteOffset += chunks[i].size;
  }
  byteOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (byteOffset + chunks[i].size > rangeEnd) {
      endChunkIdx = i;
      break;
    }
    byteOffset += chunks[i].size;
  }
  // ±3 safety margin for estimated chunk sizes (cumulative error can be large)
  startChunkIdx = Math.max(0, startChunkIdx - 3);
  endChunkIdx = Math.min(chunks.length - 1, endChunkIdx + 3);

  const contentLength = rangeEnd - rangeStart + 1;

  // Resolve all chunk file_paths (lightweight API calls, done in parallel)
  // With retry and record-file recovery for resilience
  const neededChunks = chunks.slice(startChunkIdx, endChunkIdx + 1);
  
  // Helper: try to recover a chunk's file_id from the record file
  const recoverFileIdFromRecord = async (chunkIdx: number): Promise<string | null> => {
    if (!meta.telegram_file_id) return null;
    try {
      const recordFile = await getFile(env, meta.telegram_file_id);
      if (!recordFile.file_path) return null;
      const resp = await getFileStream(env, recordFile.file_path);
      if (!resp.ok || !resp.body) return null;
      const recordBytes = await resp.arrayBuffer();
      const text = new TextDecoder().decode(recordBytes);
      const parsed = JSON.parse(text) as { recordFile?: boolean; fileIds?: string[] };
      if (parsed.recordFile && Array.isArray(parsed.fileIds) && parsed.fileIds.length > chunkIdx) {
        const recovered = parsed.fileIds[chunkIdx];
        if (recovered && recovered.trim()) return recovered;
      }
    } catch {}
    return null;
  };

  const resolveChunkPath = async (chunk: ChunkInfo): Promise<{ filePath: string; size: number; index: number }> => {
    let fileId = chunk.telegram_file_id;
    // Retry up to 3 times with exponential backoff
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const file = await getFile(env, fileId);
        trackSubReq();
        if (file.file_path) {
          return { filePath: file.file_path, size: file.file_size || chunk.size, index: chunk.index };
        }
        throw new Error(`Chunk ${chunk.index}: empty file_path from getFile`);
      } catch (e) {
        if (attempt < 2) {
          console.warn(`[streamMerge] chunk ${chunk.index}: getFile attempt ${attempt + 1} failed, retrying...`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          // On last attempt, try recovery from record file
          if (attempt === 1) {
            const recovered = await recoverFileIdFromRecord(chunk.index);
            if (recovered && recovered !== fileId) {
              console.log(`[streamMerge] chunk ${chunk.index}: recovered file_id from record, retrying...`);
              fileId = recovered;
            }
          }
        } else {
          throw e;
        }
      }
    }
    throw new Error(`Chunk ${chunk.index}: exhausted retries resolving file_path`);
  };
  
  // Concurrent slot pattern: max 6 parallel getFile calls.
  // Cloudflare allows only 6 concurrent outbound connections per request
  // (7th+ wait for a response header, throttling throughput) — 10 exceeded it.
  const MAX_CONCURRENT_RESOLVE = 6;
  const LAZY_THRESHOLD = 20; // switch to lazy per-chunk resolution if >20 chunks
  const chunkPaths: { filePath: string; size: number; index: number }[] = [];
  
  const useLazy = neededChunks.length > LAZY_THRESHOLD;
  
  if (useLazy) {
    // Lazy mode: resolve only the first chunk upfront.
    // Subsequent chunks are resolved on-demand inside pull() with prefetch.
    if (neededChunks.length > 0) {
      chunkPaths[0] = await resolveChunkPath(neededChunks[0]);
    }
    chunkPaths.length = neededChunks.length;
    console.log(`[streamMerge] lazy mode: ${neededChunks.length} chunks, resolving on-demand`);
  } else {
    // Eager mode (≤20 chunks): resolve all file_paths upfront in parallel.
    let resolveIdx = 0;
    const resolveSlot = async () => {
      while (resolveIdx < neededChunks.length) {
        const i = resolveIdx++;
        const result = await resolveChunkPath(neededChunks[i]);
        chunkPaths[i] = result;
      }
    };
    const slotWorkers = Array(Math.min(MAX_CONCURRENT_RESOLVE, neededChunks.length))
      .fill(null).map(() => resolveSlot());
    chunkPaths.length = neededChunks.length;
    await Promise.all(slotWorkers);
  }
  
  // Compact: remove any undefined slots (shouldn't happen, but safety)
  const resolvedPaths = chunkPaths.filter(Boolean) as { filePath: string; size: number; index: number }[];
  if (!useLazy && resolvedPaths.length !== neededChunks.length) {
    throw new Error(`Failed to resolve some chunk paths: ${resolvedPaths.length}/${neededChunks.length}`);
  }

  // Stream download: read chunks one by one in small buffers.
  // Memory-safe: never loads an entire chunk into memory at once.
  let bytesSent = 0;
  let currentChunkIdx = 0;
  // Precompute cumulative byte offset up to the first needed chunk ONCE,
  // then increment per-chunk inside pull() — avoids re-summing on every pull
  // (O(n²) on large files, a CPU-time risk under the Free 10ms limit).
  let cumulativeOffset = 0;
  for (let i = 0; i < startChunkIdx; i++) cumulativeOffset += chunks[i].size;

  const stream = new ReadableStream({
    async pull(controller) {
      if (currentChunkIdx >= neededChunks.length) {
        controller.close();
        return;
      }

      // Lazy mode: resolve current chunk path on-demand if not yet resolved
      if (useLazy && !chunkPaths[currentChunkIdx]) {
        chunkPaths[currentChunkIdx] = await resolveChunkPath(neededChunks[currentChunkIdx]);
      }

      // Prefetch next chunk's file_path in background (lazy mode only)
      let prefetchPromise: Promise<void> | null = null;
      if (useLazy) {
        const nextIdx = currentChunkIdx + 1;
        if (nextIdx < neededChunks.length && !chunkPaths[nextIdx]) {
          prefetchPromise = resolveChunkPath(neededChunks[nextIdx]).then(result => {
            chunkPaths[nextIdx] = result;
          }).catch(() => {
            // Will retry on-demand in pull() if this fails
          });
        }
      }

      const cp = chunkPaths[currentChunkIdx];
      if (!cp) {
        controller.error(new Error(`Chunk ${neededChunks[currentChunkIdx].index}: failed to resolve file_path`));
        return;
      }
      
      // Retry CDN download with backoff
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await getFileStream(env, cp.filePath);
        trackSubReq();
        if (resp.ok && resp.body) {
          response = resp;
          break;
        }
        if (attempt < 2) {
          console.warn(`[streamMerge] chunk ${cp.index}: CDN fetch attempt ${attempt + 1} failed (${resp.status}), retrying...`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      
      if (!response || !response.body) {
        controller.error(new Error(`Failed to download chunk ${cp.index} after retries`));
        return;
      }

      const reader = response.body.getReader();

      // Calculate Range trimming for first chunk (incremental offset)
      const chunkByteStart = cumulativeOffset;
      const actualSkip = Math.max(0, rangeStart - chunkByteStart);
      const remainingTotal = contentLength - bytesSent;

      let chunkBytesRead = 0;
      let chunkBytesSentFromThis = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunkBytesRead += value.length;

          // Handle skip for first chunk
          if (currentChunkIdx === 0 && chunkBytesRead <= actualSkip) {
            // This entire value is before our range
            const afterSkip = actualSkip - (chunkBytesRead - value.length);
            if (afterSkip > 0 && afterSkip < value.length) {
              // Partial: some bytes to skip, some to send
              const usable = value.slice(afterSkip);
              const canSend = Math.min(usable.length, remainingTotal - chunkBytesSentFromThis);
              if (canSend > 0) {
                controller.enqueue(usable.slice(0, canSend));
                chunkBytesSentFromThis += canSend;
                bytesSent += canSend;
              }
            }
            continue;
          }

          // Normal write
          const canSend = Math.min(value.length, remainingTotal - chunkBytesSentFromThis);
          if (canSend <= 0) break;
          controller.enqueue(canSend === value.length ? value : value.slice(0, canSend));
          chunkBytesSentFromThis += canSend;
          bytesSent += canSend;

          if (bytesSent >= contentLength) break;
        }
      } finally {
        reader.releaseLock();
      }

      currentChunkIdx++;
      // Advance cumulative offset for the next pull (chunk we just finished)
      const cpSize = cp.size || 0;
      if (cpSize > 0) cumulativeOffset += cpSize;
      
      // Wait for next chunk's file_path prefetch to settle (lazy mode only)
      if (prefetchPromise) await prefetchPromise;
      
      if (currentChunkIdx >= neededChunks.length || bytesSent >= contentLength) {
        console.log(`[streamMerge] DONE chunks=${neededChunks.length} chunksSent=${currentChunkIdx} subReqs=${subReqCount} bytes=${bytesSent}/${contentLength}`);
        controller.close();
      }
    },
    cancel() {
      console.log(`[streamMerge] CANCELLED chunks=${neededChunks.length} chunksSent=${currentChunkIdx} subReqs=${subReqCount}`);
    },
  });

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": meta.mime_type || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  console.log(`[streamMerge] START chunks=${neededChunks.length} lazy=${useLazy} range=${range ? `${rangeStart}-${rangeEnd}` : "none"} totalSize=${totalSize}`);

  // Check if this is an inline-display type (images/video)
  const isInlineType = (meta.mime_type || "").startsWith("image/") ||
    (meta.mime_type || "").startsWith("video/") ||
    (meta.mime_type || "").startsWith("audio/");

  if (range) {
    headers["Content-Range"] = `bytes ${rangeStart}-${rangeEnd}/${totalSize}`;
    headers["Content-Length"] = String(contentLength);
    if (!isInlineType) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
    }
    return new Response(stream, { status: 206, headers });
  }

  headers["Content-Length"] = String(totalSize);
  if (!isInlineType) {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
  } else {
    headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
  }

  return new Response(stream, { status: 200, headers });
}

/**
 * Try to parse downloaded content as a BigFileInfo record.
 * Returns null if not a record file.
 */
export function tryParseRecordFile(data: Uint8Array): BigFileInfo | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    if (parsed && parsed.recordFile === true && Array.isArray(parsed.fileIds)) {
      return parsed as BigFileInfo;
    }
    return null;
  } catch {
    return null;
  }
}
