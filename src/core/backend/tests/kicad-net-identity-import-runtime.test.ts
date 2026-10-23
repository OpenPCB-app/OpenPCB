import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { ValidationError } from "../../contracts/errors";
import { packZip } from "../../../modules/designer/backend/export/zip";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { readNetIdentityQuarantine, readNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { commandLog, designHeads, netIdentityBackups, netIdentityRetired, pcbEntities, sessionHistories } from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { bootDesignerRuntime } from "./helpers/designer-runtime";

const oldPath = process.env.OPENPCB_DB_PATH, oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
const oldQuarantine = process.env.OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE;
let file: string | undefined;
beforeEach(() => {
  // Exercise the existing development intake path; release quarantine remains
  // a separate asserted denial below and is not relaxed by identity support.
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
  process.env.OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE = "0";
});
afterEach(async () => {
  resetCaptureRuntimeForTesting(); resetSharedSqliteForTesting();
  for (const [key, value] of [["OPENPCB_DB_PATH", oldPath], ["OPENPCB_FEATURE_DATASET_CAPTURE", oldCapture],
    ["OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE", oldQuarantine]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  if (file) for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
  file = undefined;
});

function project(namedZero = false): Uint8Array {
  const files = {
    "identity.kicad_pro": JSON.stringify({ meta: { filename: "identity.kicad_pro", version: 1 }, net_settings: {
      classes: [{ name: "Default", clearance: 0.2 }, { name: "Power", clearance: 0.3, nets: ["SIG"] }],
      netclass_patterns: [{ pattern: "Net_5", netclass: "Power" }, { pattern: "sig", netclass: "Power" }],
    } }),
    "identity.kicad_sch": `(kicad_sch (version 20231120) (generator eeschema)
      (lib_symbols (symbol "S8Test:UniqueResistor"
        (property "Reference" "R" (at 0 0 0)) (property "Value" "R" (at 0 0 0))
        (pin passive line (at -3.81 0 0) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 3.81 0 0) (length 1.27) (name "~") (number "2"))))
      (symbol (lib_id "S8Test:UniqueResistor") (at 50 60 0) (unit 1)
        (uuid "11111111-1111-1111-1111-111111111111")
        (property "Reference" "R1" (at 0 0 0)) (property "Value" "10k" (at 0 0 0)))
      (label "SIG" (at 10 10 0) (uuid "signal"))
      (label "Net_5" (at 30 10 0) (uuid "literal")))`,
    "identity.kicad_pcb": `(kicad_pcb (version 20231120) (generator pcbnew)
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
      (net 0 "${namedZero ? "GND" : ""}") (net 1 "SIG") (net 2 "sig") (net 3 " SIG ") (net 4 "missing")
      (footprint "S8Test:UniqueFootprint" (layer "F.Cu") (at 25 20 0)
        (property "Reference" "R1" (at 0 0 0)) (property "Value" "10k" (at 0 0 0))
        (pad "1" smd rect (at -0.95 0 0) (size 1 1.25) (layers "F.Cu") (net 1 "SIG"))
        (pad "2" smd rect (at 0.95 0 0) (size 1 1.25) (layers "F.Cu") (net 0 "")))
      (segment (start 0 0) (end 1 0) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 2 0) (end 3 0) (width 0.25) (layer "F.Cu") (net 2))
      (segment (start 4 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 0))
      (via (at 1 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
      (via (at 3 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3))
      (zone (net 1) (net_name "SIG") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
      (zone (net 4) (net_name "missing") (layer "B.Cu") (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))))`,
  };
  return packZip(Object.entries(files).map(([fileName, text]) => ({ kind: "csv.bom" as const, fileName, text })));
}

function persistedSource(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'designer_%' OR name LIKE 'library_%') ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

describe("KiCad commit initializes durable references inside its original transaction", () => {
  test("raw import already has origin, revision zero, active assignments and persisted hint bindings", async () => {
    const { sdk } = await bootDesignerRuntime("kicad-net-identity-runtime"); file = process.env.OPENPCB_DB_PATH;
    const sqlite = getSharedSqlite();
    sqlite.exec(`CREATE TABLE s8_board_writes (operation TEXT);
      CREATE TRIGGER s8_board_insert AFTER INSERT ON designer_pcb_entities WHEN NEW.kind = 'board_settings'
      BEGIN INSERT INTO s8_board_writes VALUES ('insert'); END;
      CREATE TRIGGER s8_board_update AFTER UPDATE ON designer_pcb_entities WHEN NEW.kind = 'board_settings'
      BEGIN INSERT INTO s8_board_writes VALUES ('update'); END;`);
    const result = await sdk.commitKicadProject({ archiveFileName: "identity.zip", archiveBytes: project() });
    const db = getSharedDb(), designId = result.designId;
    // No SDK projection read before these checks: ensure cannot repair the result.
    const state = readNetIdentityState(db, designId)!;
    expect(state).toMatchObject({ status: "active", provenance: { origin: "kicad-import" } });
    expect(db.select().from(designHeads).where(eq(designHeads.id, designId)).get()!.revision).toBe(0);
    expect(db.select().from(netIdentityBackups).all()).toEqual([]);
    expect(db.select().from(netIdentityRetired).all()).toEqual([]);
    expect(db.select().from(sessionHistories).all()).toEqual([]);
    const log = db.select().from(commandLog).where(eq(commandLog.designId, designId)).all();
    expect(log).toHaveLength(1); expect(log[0]).toMatchObject({ commandType: "import_kicad_project", appliedRevision: 0 });
    const rows = db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all();
    const settings = JSON.parse(rows.find((row) => row.kind === "board_settings")!.payloadJson) as { perNetClassAssignments: Record<string, string> };
    expect(Object.keys(settings.perNetClassAssignments).map((id) => state.active.find((net) => net.id === id)?.name).sort()).toEqual(["Net_5", "SIG"]);
    expect(sqlite.query("SELECT operation FROM s8_board_writes").all()).toEqual([{ operation: "insert" }]);
    const copper = rows.filter((row) => ["trace", "via", "zone"].includes(row.kind)).map((row) => ({ kind: row.kind,
      payload: JSON.parse(row.payloadJson) as { netId: string | null; netName: string | null } }));
    const signalId = state.active.find((net) => net.name === "SIG")!.id;
    expect(copper.filter(({ payload }) => payload.netName === "SIG").map(({ kind, payload }) => [kind, payload.netId]).sort())
      .toEqual([["trace", signalId], ["via", signalId], ["zone", signalId]]);
    expect(copper.filter(({ payload }) => payload.netName !== "SIG").every(({ payload }) => payload.netId === null)).toBe(true);
    expect(readNetIdentityQuarantine(db, designId).map((row) => [row.refKind, row.legacyValue, row.reason, row.candidates]))
      .toEqual([["trace", "sig", "unknown_name", []], ["via", " SIG ", "unknown_name", []], ["zone", "missing", "unknown_name", []]]);
    expect(result.warnings.filter((warning) => warning.code === "kicad_net_unresolved")).toHaveLength(3);
    const rawState = JSON.stringify(state);
    expect((await sdk.getPcbProjection(designId))!.revision).toBe(0);
    expect(JSON.stringify(readNetIdentityState(db, designId))).toBe(rawState);
  });

  test("contradictory named ordinal zero fails before any design or library write", async () => {
    const { sdk } = await bootDesignerRuntime("kicad-zero-net-rejected"); file = process.env.OPENPCB_DB_PATH;
    const before = persistedSource();
    const pending = sdk.commitKicadProject({ archiveFileName: "identity.zip", archiveBytes: project(true) });
    await expect(pending).rejects.toBeInstanceOf(ValidationError);
    await expect(pending).rejects.toThrow("KiCad net ordinal 0 cannot have a nonblank name ('GND').");
    expect(persistedSource()).toBe(before);
  });

  test("global import quarantine still denies the entire operation without writes", async () => {
    const { sdk } = await bootDesignerRuntime("kicad-identity-quarantine"); file = process.env.OPENPCB_DB_PATH;
    process.env.OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE = "1";
    const before = persistedSource();
    await expect(sdk.commitKicadProject({ archiveFileName: "identity.zip", archiveBytes: project() })).rejects.toMatchObject({ status: 422 });
    expect(persistedSource()).toBe(before);
  });
});
