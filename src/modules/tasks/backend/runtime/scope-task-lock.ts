export class ScopeTaskLock {
  private readonly active = new Map<string, string>();
  private readonly queued = new Map<string, string[]>();

  tryAcquire(scopeId: string, taskId: string): boolean {
    if (!this.active.has(scopeId)) {
      this.active.set(scopeId, taskId);
      return true;
    }
    const queue = this.queued.get(scopeId) ?? [];
    if (!queue.includes(taskId)) queue.push(taskId);
    this.queued.set(scopeId, queue);
    return false;
  }

  release(scopeId: string, taskId: string): string | null {
    if (this.active.get(scopeId) !== taskId) return null;
    this.active.delete(scopeId);
    const queue = this.queued.get(scopeId) ?? [];
    const next = queue.shift() ?? null;
    if (queue.length === 0) this.queued.delete(scopeId);
    else this.queued.set(scopeId, queue);
    if (next) this.active.set(scopeId, next);
    return next;
  }

  cancel(scopeId: string, taskId: string): string | null {
    if (this.active.get(scopeId) === taskId) return this.release(scopeId, taskId);
    const queue = this.queued.get(scopeId) ?? [];
    this.queued.set(scopeId, queue.filter((id) => id !== taskId));
    return null;
  }
}
