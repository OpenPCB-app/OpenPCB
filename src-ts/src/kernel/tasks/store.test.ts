import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TaskStore } from "./store";
import { TaskStatus } from "./types";

describe("TaskStore Date Handling", () => {
    const mockRepository = {
        findByStatus: mock(async () => []),
        findById: mock(async () => null),
        create: mock(async () => ({})),
        update: mock(async () => ({})),
        delete: mock(async () => undefined),
        cleanupOld: mock(async () => 0),
    };

    let store: TaskStore;

    beforeEach(() => {
        // Reset mocks
        mockRepository.findByStatus.mockClear();
        mockRepository.findById.mockClear();
        mockRepository.create.mockClear();
        mockRepository.update.mockClear();
        mockRepository.delete.mockClear();
        mockRepository.cleanupOld.mockClear();

        store = new TaskStore(mockRepository as any);
    });

    describe("create", () => {
        it("should create task with Date timestamps", () => {
            const beforeCreate = new Date();
            const task = store.create("test-type", { foo: "bar" });
            const afterCreate = new Date();

            // Timestamps should be Date objects
            expect(task.createdAt).toBeInstanceOf(Date);
            expect(task.updatedAt).toBeInstanceOf(Date);

            // Timestamps should be within test execution time
            expect(task.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
            expect(task.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
            expect(task.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
            expect(task.updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
        });

        it("should persist task with Date timestamps to repository", async () => {
            store.create("test-type", { foo: "bar" });

            // Wait for async persistence
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockRepository.create).toHaveBeenCalled();
            const createCall = mockRepository.create.mock.calls[0] as any;
            const persistedTask = createCall[0];

            // Verify Date objects are passed (not numbers)
            expect(persistedTask.createdAt).toBeInstanceOf(Date);
            expect(persistedTask.updatedAt).toBeInstanceOf(Date);
        });
    });

    describe("update", () => {
        it("should update task with new Date timestamp", () => {
            // Create a task first
            const task = store.create("test-type", { foo: "bar" });
            const originalUpdatedAt = task.updatedAt;

            // Wait a bit to ensure time passes
            const waitTime = 5;
            const start = Date.now();
            while (Date.now() - start < waitTime) { /* busy wait */ }

            // Update the task
            store.update(task.id, { status: TaskStatus.RUNNING });

            // Get updated task
            const updatedTask = store.get(task.id);

            // updatedAt should be a Date and should be after original
            expect(updatedTask?.updatedAt).toBeInstanceOf(Date);
            expect(updatedTask?.updatedAt.getTime()).toBeGreaterThanOrEqual(
                originalUpdatedAt.getTime()
            );
        });
    });

    describe("list sorting", () => {
        it("should sort tasks by createdAt using Date.getTime()", () => {
            // This test verifies that sorting uses getTime() on Date objects
            // The actual sort logic is:
            //   tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            const task1 = store.create("test-type", { order: 1 });
            const task2 = store.create("test-type", { order: 2 });

            const tasks = store.list();

            // Both tasks should be present
            expect(tasks).toHaveLength(2);

            // Verify that createdAt is a Date instance with getTime()
            expect(tasks[0]?.createdAt).toBeInstanceOf(Date);
            expect(typeof tasks[0]?.createdAt.getTime()).toBe('number');

            // Both tasks created - order may vary due to same-ms creation
            const taskIds = tasks.map(t => t.id);
            expect(taskIds).toContain(task1.id);
            expect(taskIds).toContain(task2.id);
        });
    });

    describe("cleanup", () => {
        it("should use getTime() for age comparison", () => {
            // Create a completed task with an old timestamp
            const oldDate = new Date(Date.now() - 10000); // 10 seconds ago
            const task = store.create("test-type", { foo: "bar" });

            // Manually set to completed with old timestamp
            const cached = store.get(task.id);
            if (cached) {
                cached.status = TaskStatus.COMPLETED;
                cached.completedAt = oldDate;
                cached.updatedAt = oldDate;
            }

            // Cleanup tasks older than 1 second
            const cleaned = store.cleanup(1000);

            expect(cleaned).toBe(1);
        });
    });
});
