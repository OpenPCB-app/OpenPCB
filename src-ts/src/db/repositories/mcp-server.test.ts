import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseAccess } from "../index";
import { runMigrations } from "../migrate";

describe("mcp_server repository", () => {
  let db: DatabaseAccess;
  let dbDir: string;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "openpcb-mcp-server-repo-"));
    const dbFilePath = join(dbDir, "mcp-server-repo.db");

    DatabaseAccess.reset();
    db = DatabaseAccess.getInstance({ filePath: dbFilePath, logger: false });
    await runMigrations();
  });

  afterAll(() => {
    DatabaseAccess.reset();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("creates and reads stdio server", async () => {
    const created = await db.mcpServers.create({
      alias: "local-tools",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    expect(created.id).toBeDefined();
    expect(created.alias).toBe("local-tools");
    expect(created.transport).toBe("stdio");
    expect(created.command).toBe("node");

    const byId = await db.mcpServers.findById(created.id);
    expect(byId?.id).toBe(created.id);
  });

  it("rejects stdio server without command", async () => {
    await expect(
      db.mcpServers.create({
        alias: "broken-stdio",
        transport: "stdio",
      }),
    ).rejects.toThrow("command");
  });

  it("rejects http server without url", async () => {
    await expect(
      db.mcpServers.create({
        alias: "broken-http",
        transport: "http",
      }),
    ).rejects.toThrow("url");
  });

  it("updates and deletes server", async () => {
    const created = await db.mcpServers.create({
      alias: "remote-tools",
      transport: "http",
      url: "https://mcp.example.com",
    });

    const updated = await db.mcpServers.update(created.id, {
      enabled: false,
      headers: { authorization: "Bearer token" },
    });

    expect(updated.enabled).toBe(false);
    expect(updated.headers).toEqual({ authorization: "Bearer token" });

    const deleted = await db.mcpServers.delete(created.id);
    expect(deleted).toBe(true);

    const afterDelete = await db.mcpServers.findById(created.id);
    expect(afterDelete).toBeNull();
  });

  it("enforces unique alias", async () => {
    await db.mcpServers.create({
      alias: "alias-collision",
      transport: "http",
      url: "https://mcp.one.example.com",
    });

    await expect(
      db.mcpServers.create({
        alias: "alias-collision",
        transport: "http",
        url: "https://mcp.two.example.com",
      }),
    ).rejects.toThrow();
  });
});
