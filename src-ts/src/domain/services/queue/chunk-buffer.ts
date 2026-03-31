/**
 * ChunkBuffer - Time-Based Batch Flushing for Streaming Chunks
 *
 * Buffers streaming token chunks and flushes to database periodically
 * to reduce write contention. Configurable flush interval (default 1000ms).
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

import type { DatabaseAccess } from '../../../db';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BufferedChunk {
  seq: number;
  content: string;
}

interface TaskBuffer {
  taskId: string;
  chunks: BufferedChunk[];
  lastFlush: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  nextSeq: number;
}

export interface ChunkBufferConfig {
  /** Flush interval in milliseconds (default: 1000) */
  flushIntervalMs: number;
  /** Enable debug logging */
  debug: boolean;
}

// ─── ChunkBuffer Implementation ──────────────────────────────────────────────

export class ChunkBuffer {
  private buffers = new Map<string, TaskBuffer>();
  private config: ChunkBufferConfig;
  private db: DatabaseAccess;

  constructor(db: DatabaseAccess, config?: Partial<ChunkBufferConfig>) {
    this.db = db;
    this.config = {
      flushIntervalMs: config?.flushIntervalMs ?? 1000,
      debug: config?.debug ?? false,
    };
  }

  /**
   * Append a chunk to the buffer
   * Will be flushed after flushIntervalMs or on finalize
   */
  append(taskId: string, content: string): void {
    let buffer = this.buffers.get(taskId);

    if (!buffer) {
      buffer = {
        taskId,
        chunks: [],
        lastFlush: Date.now(),
        flushTimer: null,
        nextSeq: 0,
      };
      this.buffers.set(taskId, buffer);
    }

    // Add chunk with sequence number
    buffer.chunks.push({
      seq: buffer.nextSeq++,
      content,
    });

    // Schedule flush if not already scheduled
    if (!buffer.flushTimer) {
      buffer.flushTimer = setTimeout(() => {
        this.flush(taskId).catch(err => {
          console.error(`[ChunkBuffer] Flush error for task ${taskId}:`, err);
        });
      }, this.config.flushIntervalMs);
    }

    this.log(`Buffered chunk for task ${taskId}, seq=${buffer.nextSeq - 1}, buffer size=${buffer.chunks.length}`);
  }

  /**
   * Flush buffered chunks to database
   */
  async flush(taskId: string): Promise<void> {
    const buffer = this.buffers.get(taskId);
    if (!buffer || buffer.chunks.length === 0) {
      return;
    }

    // Clear timer
    if (buffer.flushTimer) {
      clearTimeout(buffer.flushTimer);
      buffer.flushTimer = null;
    }

    // Extract chunks to flush
    const chunksToFlush = [...buffer.chunks];
    buffer.chunks = [];
    buffer.lastFlush = Date.now();

    // Write to database
    try {
      await this.db.taskChunks.appendChunks(taskId, chunksToFlush);
      this.log(`Flushed ${chunksToFlush.length} chunks for task ${taskId}`);
    } catch (err) {
      // Put chunks back on error
      buffer.chunks = chunksToFlush.concat(buffer.chunks);
      throw err;
    }
  }

  /**
   * Finalize a task - flush remaining chunks and cleanup
   */
  async finalize(taskId: string): Promise<void> {
    await this.flush(taskId);

    // Cleanup
    const buffer = this.buffers.get(taskId);
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    this.buffers.delete(taskId);

    this.log(`Finalized buffer for task ${taskId}`);
  }

  /**
   * Flush all buffers (for shutdown)
   */
  async flushAll(): Promise<void> {
    const taskIds = Array.from(this.buffers.keys());
    await Promise.all(taskIds.map(taskId => this.flush(taskId)));
  }

  /**
   * Cancel a task buffer without flushing
   */
  cancel(taskId: string): void {
    const buffer = this.buffers.get(taskId);
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    this.buffers.delete(taskId);
    this.log(`Cancelled buffer for task ${taskId}`);
  }

  /**
   * Get current buffer stats
   */
  getStats(): { activeBuffers: number; totalPendingChunks: number } {
    let totalPendingChunks = 0;
    for (const buffer of this.buffers.values()) {
      totalPendingChunks += buffer.chunks.length;
    }
    return {
      activeBuffers: this.buffers.size,
      totalPendingChunks,
    };
  }

  /**
   * Get buffer info for a specific task
   */
  getBufferInfo(taskId: string): { pendingChunks: number; lastFlush: number } | null {
    const buffer = this.buffers.get(taskId);
    if (!buffer) return null;
    return {
      pendingChunks: buffer.chunks.length,
      lastFlush: buffer.lastFlush,
    };
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[ChunkBuffer] ${message}`);
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let chunkBufferInstance: ChunkBuffer | null = null;

export function initializeChunkBuffer(
  db: DatabaseAccess,
  config?: Partial<ChunkBufferConfig>
): ChunkBuffer {
  if (!chunkBufferInstance) {
    chunkBufferInstance = new ChunkBuffer(db, config);
  }
  return chunkBufferInstance;
}

export function getChunkBuffer(): ChunkBuffer {
  if (!chunkBufferInstance) {
    throw new Error('ChunkBuffer not initialized. Call initializeChunkBuffer() first.');
  }
  return chunkBufferInstance;
}

export function resetChunkBuffer(): void {
  if (chunkBufferInstance) {
    chunkBufferInstance.flushAll().catch(console.error);
  }
  chunkBufferInstance = null;
}
