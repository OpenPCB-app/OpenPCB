import { describe, it, expect } from "bun:test";
import { applyCursorPagination, pickFields, applyFieldSelection } from "../shared";

describe("Shared Utilities", () => {
  describe("Pagination", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i + 1}`, name: `Item ${i + 1}` }));
    const getId = (item: { id: string }) => item.id;

    it("should return first page when no cursor is provided", () => {
      const result = applyCursorPagination(items, {}, getId);
      expect(result.items).toHaveLength(20);
      expect(result.items[0].id).toBe("id-1");
      expect(result.items[19].id).toBe("id-20");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("id-20");
    });

    it("should return items after the cursor position", () => {
      const result = applyCursorPagination(items, { cursor: "id-10" }, getId);
      expect(result.items).toHaveLength(20);
      expect(result.items[0].id).toBe("id-11");
      expect(result.items[19].id).toBe("id-30");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("id-30");
    });

    it("should respect custom limit", () => {
      const result = applyCursorPagination(items, { limit: 5 }, getId);
      expect(result.items).toHaveLength(5);
      expect(result.items[0].id).toBe("id-1");
      expect(result.items[4].id).toBe("id-5");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("id-5");
    });

    it("should cap limit at 100", () => {
      const largeItems = Array.from({ length: 150 }, (_, i) => ({ id: `id-${i + 1}` }));
      const result = applyCursorPagination(largeItems, { limit: 200 }, getId);
      expect(result.items).toHaveLength(100);
      expect(result.hasMore).toBe(true);
    });

    it("should set hasMore to false on the last page", () => {
      const result = applyCursorPagination(items, { cursor: "id-40" }, getId);
      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should return empty result if cursor is not found", () => {
      const result = applyCursorPagination(items, { cursor: "non-existent" }, getId);
      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should return empty result for empty items array", () => {
      const result = applyCursorPagination([], {}, getId);
      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should return all items if fewer than limit", () => {
      const smallItems = items.slice(0, 5);
      const result = applyCursorPagination(smallItems, { limit: 10 }, getId);
      expect(result.items).toHaveLength(5);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("Field Selection", () => {
    const item = { id: "1", name: "Test", description: "Desc", secret: "shh" };

    it("should return full object when no fields are provided", () => {
      expect(pickFields(item)).toEqual(item);
      expect(pickFields(item, [])).toEqual(item);
    });

    it("should return only specified fields", () => {
      const result = pickFields(item, ["id", "name"]);
      expect(result).toEqual({ id: "1", name: "Test" });
      expect(result).not.toHaveProperty("description");
      expect(result).not.toHaveProperty("secret");
    });

    it("should ignore nonexistent fields silently", () => {
      const result = pickFields(item, ["id", "nonexistent"] as any);
      expect(result).toEqual({ id: "1" });
    });

    it("should apply field selection to an array of items", () => {
      const items = [
        { id: "1", name: "A", secret: "1" },
        { id: "2", name: "B", secret: "2" },
      ];
      const result = applyFieldSelection(items, ["id", "name"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "1", name: "A" });
      expect(result[1]).toEqual({ id: "2", name: "B" });
    });

    it("should return full items if no fields are provided to applyFieldSelection", () => {
      const items = [{ id: "1", name: "A" }];
      expect(applyFieldSelection(items)).toEqual(items);
      expect(applyFieldSelection(items, [])).toEqual(items);
    });
  });
});
