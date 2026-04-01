import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";
import { ComponentDraftRepository } from "./component-draft-repository";
import { QueryLogger } from "../query-logger";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS component_family (
      id TEXT PRIMARY KEY, canonical_key TEXT NOT NULL, display_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL, symbol_data TEXT NOT NULL,
      default_package_variant_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS component_draft (
      id TEXT PRIMARY KEY, family_id TEXT REFERENCES component_family(id) ON DELETE SET NULL,
      wizard_step INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, warnings TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
  `);
  return { db, sqlite };
}

describe("ComponentDraftRepository", () => {
  let repo: ComponentDraftRepository;
  let sqlite: Database;

  beforeEach(() => {
    const { db, sqlite: s } = createTestDb();
    sqlite = s;
    repo = new ComponentDraftRepository(
      db,
      new QueryLogger({ enableLogging: false }),
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  test("creates and retrieves a draft", async () => {
    const draft = await repo.create({
      payload: { displayLabel: "Test", description: "" },
      wizardStep: 0,
      warnings: [],
    });
    expect(draft.id).toBeTruthy();
    expect(draft.wizardStep).toBe(0);
  });

  test("upsert creates then updates", async () => {
    const draft = await repo.create({
      payload: { displayLabel: "Test", description: "" },
      wizardStep: 0,
      warnings: [],
    });

    const updated = await repo.upsert(draft.id, { wizardStep: 2 });
    expect(updated.wizardStep).toBe(2);
  });

  test("soft delete excludes from findActive", async () => {
    const draft = await repo.create({
      payload: { displayLabel: "Temp" },
      wizardStep: 0,
      warnings: [],
    });
    await repo.softDelete(draft.id);
    const active = await repo.findActive();
    expect(active.length).toBe(0);
  });
});
