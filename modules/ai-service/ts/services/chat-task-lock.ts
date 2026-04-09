/**
 * ChatTaskLock - Per-Chat Task Serialization
 *
 * Ensures only ONE MessageTask runs per chat at a time.
 * Other tasks for the same chat are queued and started when the active one completes.
 *
 * This prevents context race conditions where multiple concurrent message tasks
 * might see inconsistent chat history.
 */

export interface ChatTaskLockStatus {
  chatId: string;
  activeTaskId: string | null;
  queuedCount: number;
  queuedTaskIds: string[];
}

export class ChatTaskLock {
  // chatId -> currently running taskId
  private activeTaskPerChat = new Map<string, string>();
  // chatId -> queued taskIds (FIFO order)
  private queuedTasks = new Map<string, string[]>();

  /**
   * Try to acquire lock for a chat.
   * Returns true if task can start immediately, false if queued.
   */
  tryAcquire(chatId: string, taskId: string): boolean {
    const activeTaskId = this.activeTaskPerChat.get(chatId);

    if (!activeTaskId) {
      // No active task, acquire lock
      this.activeTaskPerChat.set(chatId, taskId);
      return true;
    }

    // Chat has active task, queue this one
    const queue = this.queuedTasks.get(chatId) ?? [];
    if (!queue.includes(taskId)) {
      queue.push(taskId);
      this.queuedTasks.set(chatId, queue);
    }
    return false;
  }

  /**
   * Release lock when task completes.
   * Returns next queued taskId if any, null otherwise.
   */
  release(chatId: string, taskId: string): string | null {
    const activeTaskId = this.activeTaskPerChat.get(chatId);

    // Only release if this task holds the lock
    if (activeTaskId !== taskId) {
      // Task might have been cancelled or never held lock
      // Remove from queue if present
      this.removeFromQueue(chatId, taskId);
      return null;
    }

    // Release lock
    this.activeTaskPerChat.delete(chatId);

    // Check for next queued task
    const queue = this.queuedTasks.get(chatId);
    if (queue && queue.length > 0) {
      const nextTaskId = queue.shift()!;
      if (queue.length === 0) {
        this.queuedTasks.delete(chatId);
      }
      // Acquire lock for next task
      this.activeTaskPerChat.set(chatId, nextTaskId);
      return nextTaskId;
    }

    return null;
  }

  /**
   * Check if chat has an active task
   */
  hasActive(chatId: string): boolean {
    return this.activeTaskPerChat.has(chatId);
  }

  /**
   * Get current active task for a chat
   */
  getActive(chatId: string): string | null {
    return this.activeTaskPerChat.get(chatId) ?? null;
  }

  /**
   * Get queue position for a task.
   * Returns 0 if active, 1+ if queued, -1 if not found.
   */
  getPosition(chatId: string, taskId: string): number {
    const activeTaskId = this.activeTaskPerChat.get(chatId);
    if (activeTaskId === taskId) {
      return 0; // Currently active
    }

    const queue = this.queuedTasks.get(chatId);
    if (queue) {
      const idx = queue.indexOf(taskId);
      if (idx >= 0) {
        return idx + 1; // 1-indexed queue position
      }
    }

    return -1; // Not found
  }

  /**
   * Get lock status for a chat
   */
  getStatus(chatId: string): ChatTaskLockStatus {
    const queue = this.queuedTasks.get(chatId) ?? [];
    return {
      chatId,
      activeTaskId: this.activeTaskPerChat.get(chatId) ?? null,
      queuedCount: queue.length,
      queuedTaskIds: [...queue],
    };
  }

  /**
   * Get all active chat locks
   */
  getAllActiveChats(): string[] {
    return Array.from(this.activeTaskPerChat.keys());
  }

  /**
   * Remove task from queue (e.g., when cancelled)
   */
  removeFromQueue(chatId: string, taskId: string): boolean {
    const queue = this.queuedTasks.get(chatId);
    if (!queue) return false;

    const idx = queue.indexOf(taskId);
    if (idx >= 0) {
      queue.splice(idx, 1);
      if (queue.length === 0) {
        this.queuedTasks.delete(chatId);
      }
      return true;
    }
    return false;
  }

  /**
   * Cancel task - remove from active or queue
   * Returns next queued taskId if this was active and queue has more
   */
  cancel(chatId: string, taskId: string): string | null {
    const activeTaskId = this.activeTaskPerChat.get(chatId);

    if (activeTaskId === taskId) {
      // This task was active, release and get next
      return this.release(chatId, taskId);
    }

    // Not active, just remove from queue
    this.removeFromQueue(chatId, taskId);
    return null;
  }

  /**
   * Clear all locks (for shutdown/testing)
   */
  clear(): void {
    this.activeTaskPerChat.clear();
    this.queuedTasks.clear();
  }

  /**
   * Get total queued task count across all chats
   */
  getTotalQueuedCount(): number {
    let total = 0;
    for (const queue of this.queuedTasks.values()) {
      total += queue.length;
    }
    return total;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let chatTaskLockInstance: ChatTaskLock | null = null;

export function initializeChatTaskLock(): ChatTaskLock {
  if (!chatTaskLockInstance) {
    chatTaskLockInstance = new ChatTaskLock();
  }
  return chatTaskLockInstance;
}

export function getChatTaskLock(): ChatTaskLock {
  if (!chatTaskLockInstance) {
    throw new Error('ChatTaskLock not initialized. Call initializeChatTaskLock() first.');
  }
  return chatTaskLockInstance;
}

export function resetChatTaskLock(): void {
  if (chatTaskLockInstance) {
    chatTaskLockInstance.clear();
  }
  chatTaskLockInstance = null;
}
