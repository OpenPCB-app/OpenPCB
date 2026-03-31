import type { PageUpdateEvent } from "../../shared/types";

type PageUpdateSubscriber = (event: PageUpdateEvent) => void;

export class PageEventService {
  private subscribers = new Map<string, Set<PageUpdateSubscriber>>();

  subscribe(
    workspaceId: string,
    callback: PageUpdateSubscriber,
  ): () => void {
    let workspaceSubscribers = this.subscribers.get(workspaceId);
    if (!workspaceSubscribers) {
      workspaceSubscribers = new Set<PageUpdateSubscriber>();
      this.subscribers.set(workspaceId, workspaceSubscribers);
    }

    workspaceSubscribers.add(callback);

    return () => {
      const currentWorkspaceSubscribers = this.subscribers.get(workspaceId);
      if (!currentWorkspaceSubscribers) {
        return;
      }

      currentWorkspaceSubscribers.delete(callback);
      if (currentWorkspaceSubscribers.size === 0) {
        this.subscribers.delete(workspaceId);
      }
    };
  }

  publish(event: PageUpdateEvent): void {
    const workspaceSubscribers = this.subscribers.get(event.workspaceId);
    if (!workspaceSubscribers) {
      return;
    }

    for (const callback of workspaceSubscribers) {
      try {
        callback(event);
      } catch {
      }
    }
  }
}
