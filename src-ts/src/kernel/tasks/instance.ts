/**
 * Task Manager Instance
 * 
 * Singleton instance initialized with SQLite persistence in main.ts
 */

import { TaskManager } from './manager';
import type { TaskStore } from './store';

/**
 * Global task manager instance
 * Initialized in main.ts after database is ready
 */
export let taskManager: TaskManager;

/**
 * Initialize task manager with store
 * Called from main.ts after database initialization
 */
export function initializeTaskManager(store: TaskStore): void {
    taskManager = new TaskManager(store);

    // Periodic cleanup every hour
    setInterval(() => {
        taskManager.cleanup();
    }, 3600000);

    console.log('[TaskManager] Initialized with SQLite persistence');
}
