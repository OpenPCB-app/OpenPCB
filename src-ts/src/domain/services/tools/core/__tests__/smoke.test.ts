import { describe, test, expect } from "bun:test";
import { createMockDatabaseAccess } from "../../../../../../test/helpers/mock-db";

describe("Core Tools - Smoke Test", () => {
  test("mock database access can be created", () => {
    const mockDb = createMockDatabaseAccess();
    expect(mockDb).toBeDefined();
    expect(mockDb._data).toBeDefined();
    expect(mockDb._data.chats).toBeInstanceOf(Map);
  });

  test("mock database repos are accessible", () => {
    const mockDb = createMockDatabaseAccess();
    expect(mockDb.workspaces).toBeDefined();
    expect(mockDb.projects).toBeDefined();
    expect(mockDb.chats).toBeDefined();
    expect(mockDb.fileRecords).toBeDefined();
  });

  test("mock repos can store and retrieve data", async () => {
    const mockDb = createMockDatabaseAccess();
    const testWs = { id: "ws-1", name: "Test Workspace" };
    mockDb._data.workspaces.set("ws-1", testWs);
    const ws = await mockDb.workspaces.findById("ws-1");
    expect(ws).toMatchObject(testWs);
  });
});
