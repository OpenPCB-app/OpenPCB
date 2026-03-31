import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseAccess } from "./index";
import { runMigrations } from "./migrate";

describe("content-edit backfill migration", () => {
  let dbDir: string;

  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), "openpcb-content-edit-backfill-"));
    const dbFilePath = join(dbDir, "content-edit-backfill.db");

    DatabaseAccess.reset();
    const db = DatabaseAccess.getInstance({ filePath: dbFilePath, logger: false });
    const rawDb = db.getRawDb();

    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        settings TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        hash TEXT NOT NULL,
        created_at NUMERIC
      );
    `);

    const migrationHashes = [
      "0000_common_zaran.sql",
      "0001_outgoing_mikhail_rasputin.sql",
      "0002_cleanup_legacy_tool_messages.sql",
      "0003_add_writer_module.sql",
      "0004_sync_missing_tables.sql",
      "0005_lovely_dust.sql",
    ].map((fileName) => {
      const sql = readFileSync(
        resolve(import.meta.dirname, `../../drizzle/migrations/${fileName}`),
        "utf8",
      );
      return createHash("sha256").update(sql).digest("hex");
    });

    migrationHashes.forEach((hash, index) => {
      rawDb.run(
        `INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (?, ?, ?)`,
        [index + 1, hash, Date.now() + index],
      );
    });
  });

  afterAll(() => {
    DatabaseAccess.reset();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("creates missing content-edit tables and indexes via 0006 migration", async () => {
    await runMigrations();

    const db = DatabaseAccess.getInstance();
    const rawDb = db.getRawDb();

    const snapshotTable = rawDb
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='content_edit_snapshot'`)
      .get();
    const lockTable = rawDb
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='content_edit_lock'`)
      .get();

    expect(snapshotTable).toBeDefined();
    expect(lockTable).toBeDefined();

    const targetStatusIndex = rawDb
      .query(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ces_target_status'`)
      .get();
    const lockTargetIndex = rawDb
      .query(`SELECT name FROM sqlite_master WHERE type='index' AND name='uq_cel_target'`)
      .get();

    expect(targetStatusIndex).toBeDefined();
    expect(lockTargetIndex).toBeDefined();
  });
});
