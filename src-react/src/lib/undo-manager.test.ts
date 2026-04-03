import { describe, it, expect, beforeEach } from "vitest";
import { createUndoManager, type UndoManager } from "./undo-manager";

interface TestDocument {
  items: string[];
  count: number;
}

describe("UndoManager", () => {
  let manager: UndoManager<TestDocument>;

  beforeEach(() => {
    manager = createUndoManager<TestDocument>(5);
  });

  it("starts with empty stacks", () => {
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it("can push and undo", () => {
    const doc1: TestDocument = { items: ["a"], count: 1 };
    const doc2: TestDocument = { items: ["a", "b"], count: 2 };

    manager.pushUndo("Add item", doc1);

    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);

    const result = manager.undo(doc2);

    expect(result).not.toBeNull();
    expect(result!.restored).toEqual(doc1);
    expect(result!.description).toBe("Add item");
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);
  });

  it("can redo after undo", () => {
    const doc1: TestDocument = { items: ["a"], count: 1 };
    const doc2: TestDocument = { items: ["a", "b"], count: 2 };

    manager.pushUndo("Add item", doc1);
    manager.undo(doc2);

    const result = manager.redo(doc1);

    expect(result).not.toBeNull();
    expect(result!.restored).toEqual(doc2);
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);
  });

  it("clears redo stack on new push", () => {
    const doc1: TestDocument = { items: ["a"], count: 1 };
    const doc2: TestDocument = { items: ["a", "b"], count: 2 };

    manager.pushUndo("First", doc1);
    manager.undo(doc2);
    expect(manager.canRedo()).toBe(true);

    manager.pushUndo("New action", doc2);
    expect(manager.canRedo()).toBe(false);
  });

  it("respects max stack size", () => {
    for (let i = 0; i < 10; i++) {
      manager.pushUndo(`Action ${i}`, { items: [`item-${i}`], count: i });
    }

    let undoCount = 0;
    const current: TestDocument = { items: ["final"], count: 10 };
    while (manager.canUndo()) {
      manager.undo(current);
      undoCount++;
    }

    expect(undoCount).toBe(5);
  });

  it("deep clones snapshots to prevent mutation", () => {
    const doc: TestDocument = { items: ["a"], count: 1 };
    manager.pushUndo("Initial", doc);

    doc.items.push("mutated");
    doc.count = 999;

    const result = manager.undo({ items: [], count: 0 });
    expect(result!.restored.items).toEqual(["a"]);
    expect(result!.restored.count).toBe(1);
  });

  it("returns null when undo stack is empty", () => {
    const result = manager.undo({ items: [], count: 0 });
    expect(result).toBeNull();
  });

  it("returns null when redo stack is empty", () => {
    const result = manager.redo({ items: [], count: 0 });
    expect(result).toBeNull();
  });

  it("clears both stacks", () => {
    manager.pushUndo("Action", { items: ["a"], count: 1 });
    manager.undo({ items: ["b"], count: 2 });

    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);

    manager.clear();

    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it("handles multiple undo/redo cycles", () => {
    manager.pushUndo("A", { items: ["a"], count: 1 });
    manager.pushUndo("B", { items: ["a", "b"], count: 2 });
    manager.pushUndo("C", { items: ["a", "b", "c"], count: 3 });

    const current: TestDocument = { items: ["a", "b", "c", "d"], count: 4 };

    const r1 = manager.undo(current);
    expect(r1!.restored.count).toBe(3);

    const r2 = manager.undo(r1!.restored);
    expect(r2!.restored.count).toBe(2);

    const r3 = manager.redo(r2!.restored);
    expect(r3!.restored.count).toBe(3);

    const r4 = manager.redo(r3!.restored);
    expect(r4!.restored.count).toBe(4);

    expect(manager.canRedo()).toBe(false);
  });
});
