import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
  type SharedSqliteDatabase,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  const dbFile = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  process.env.OPENPCB_DB_PATH = dbFile;
}

async function createRuntimeAndServer() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

// Every designer table keyed to a design, paired with its design-id column.
// designHeads is keyed by `id`; all others by `design_id`. Keep this in lockstep
// with store.ts#deleteDesign — if a new per-design table is added, both must
// learn about it.
const DESIGN_TABLES: ReadonlyArray<readonly [string, string]> = [
  ["designer_design_heads", "id"],
  ["designer_schematic_parts", "design_id"],
  ["designer_schematic_pins", "design_id"],
  ["designer_schematic_wires", "design_id"],
  ["designer_schematic_labels", "design_id"],
  ["designer_schematic_primitives", "design_id"],
  ["designer_pcb_entities", "design_id"],
  ["designer_command_log", "design_id"],
  ["designer_session_histories", "design_id"],
  ["designer_cloud_link", "design_id"],
  ["designer_bom_overrides", "design_id"],
  ["designer_drc_results", "design_id"],
  ["designer_comment_threads", "design_id"],
  ["designer_comment_messages", "design_id"],
  ["designer_comment_attachments", "design_id"],
  ["designer_comment_reactions", "design_id"],
  ["designer_comment_outbox", "design_id"],
  ["designer_net_identity_state", "design_id"],
  ["designer_net_identity_retired", "design_id"],
  ["designer_net_identity_quarantine", "design_id"],
  ["designer_net_identity_backups", "design_id"],
];

function countRowsForDesign(
  sqlite: SharedSqliteDatabase,
  designId: string,
): number {
  let total = 0;
  for (const [table, col] of DESIGN_TABLES) {
    const row = sqlite
      .query<{
        n: number;
      }>(`select count(*) as n from ${table} where ${col} = ?`)
      .get(designId);
    total += row?.n ?? 0;
  }
  return total;
}

// Seed one row into each table that deleteDesign must clear — focused on the
// previously-orphaned set (drc, primitives, cloud link, all comment tables)
// plus the four net-identity tables.
function seedDesignRows(
  sqlite: SharedSqliteDatabase,
  designId: string,
  suffix: string,
): void {
  const ts = "2026-01-01T00:00:00.000Z";
  const threadId = `thread-${suffix}`;
  const messageId = `msg-${suffix}`;

  sqlite
    .query(
      `insert into designer_drc_results
       (design_id, ran_at_revision, ran_at, error_count, warning_count, info_count, violations_json, created_at, updated_at)
       values (?,?,?,?,?,?,?,?,?)`,
    )
    .run(designId, 0, ts, 0, 0, 0, "[]", ts, ts);

  sqlite
    .query(
      `insert into designer_schematic_primitives
       (id, design_id, kind, position_x_nm, position_y_nm, payload_json, created_at, updated_at)
       values (?,?,?,?,?,?,?,?)`,
    )
    .run(`prim-${suffix}`, designId, "gnd_port", 0, 0, "{}", ts, ts);

  sqlite
    .query(
      `insert into designer_cloud_link
       (design_id, cloud_design_id, cloud_workspace_id, cloud_user_id, linked_at)
       values (?,?,?,?,?)`,
    )
    .run(designId, `cloud-${suffix}`, "ws-1", "user-1", ts);

  sqlite
    .query(
      `insert into designer_comment_threads
       (id, design_id, surface, created_at, updated_at)
       values (?,?,?,?,?)`,
    )
    .run(threadId, designId, "schematic", ts, ts);

  sqlite
    .query(
      `insert into designer_comment_messages
       (id, design_id, thread_id, created_at, updated_at)
       values (?,?,?,?,?)`,
    )
    .run(messageId, designId, threadId, ts, ts);

  sqlite
    .query(
      `insert into designer_comment_attachments
       (id, design_id, thread_id, file_name, mime_type, byte_size, created_at)
       values (?,?,?,?,?,?,?)`,
    )
    .run(`att-${suffix}`, designId, threadId, "f.png", "image/png", 10, ts);

  sqlite
    .query(
      `insert into designer_comment_reactions
       (id, design_id, thread_id, message_id, emoji, created_at)
       values (?,?,?,?,?,?)`,
    )
    .run(`rxn-${suffix}`, designId, threadId, messageId, "+1", ts);

  sqlite
    .query(
      `insert into designer_comment_outbox
       (command_id, design_id, command_type, command_json, created_at, updated_at)
       values (?,?,?,?,?,?)`,
    )
    .run(`cmd-${suffix}`, designId, "comment_create", "{}", ts, ts);

  sqlite
    .query(
      `insert into designer_net_identity_state
       (design_id, schema_version, status, next_seq, active_json, provenance_json, updated_at)
       values (?,?,?,?,?,?,?)`,
    )
    .run(designId, 1, "active", 1, "[]", "{}", ts);

  sqlite
    .query(
      `insert into designer_net_identity_retired
       (design_id, net_id, seq, reason, successor_ids_json, retired_at_revision, created_at, updated_at)
       values (?,?,?,?,?,?,?,?)`,
    )
    .run(designId, `net-${suffix}`, 1, "removed", "[]", 0, ts, ts);

  sqlite
    .query(
      `insert into designer_net_identity_quarantine
       (design_id, ref_kind, ref_id, legacy_value, reason, candidates_json, created_at)
       values (?,?,?,?,?,?,?)`,
    )
    .run(designId, "trace", `trace-${suffix}`, "pt:0:0", "no_evidence", "[]", ts);

  sqlite
    .query(
      `insert into designer_net_identity_backups
       (design_id, schema_version, revision, payload_json, sha256, created_at)
       values (?,?,?,?,?,?)`,
    )
    .run(designId, 1, 0, "{}", "0", ts);
}

describe("designer delete-design endpoint", () => {
  test("DELETE clears all per-design tables atomically and leaves other designs intact", async () => {
    isolateTestDb("designer-delete-design");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const target = await sdk.createDesign({ name: "To Delete" });
    const survivor = await sdk.createDesign({ name: "Keep Me" });

    const sqlite = getSharedSqlite();
    seedDesignRows(sqlite, target.id, "target");
    seedDesignRows(sqlite, survivor.id, "survivor");

    // Both designs have the same shape: head + createDesign's own rows + the 12
    // seeded rows. Exact count is an implementation detail of createDesign; what
    // matters is it's well above the 12 seeds and identical for both designs.
    const targetBefore = countRowsForDesign(sqlite, target.id);
    const survivorBefore = countRowsForDesign(sqlite, survivor.id);
    expect(targetBefore).toBeGreaterThanOrEqual(13);
    expect(survivorBefore).toBe(targetBefore);

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${target.id}`,
        { method: "DELETE" },
      ),
    );
    expect(response.status).toBe(204);

    // Every per-design row for the deleted design is gone — no orphans.
    expect(countRowsForDesign(sqlite, target.id)).toBe(0);
    // The other design is untouched.
    expect(countRowsForDesign(sqlite, survivor.id)).toBe(survivorBefore);
    const listed = await sdk.listDesigns();
    expect(listed.find((d) => d.id === target.id)).toBeUndefined();
    expect(listed.find((d) => d.id === survivor.id)?.name).toBe("Keep Me");
  });
});
