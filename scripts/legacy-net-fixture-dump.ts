import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { asc, eq } from "drizzle-orm";
import { getSharedDb } from "../src/core/backend/db/sqlite-client";
import { designHeads, schematicParts, schematicPins, schematicWires, schematicLabels, schematicPrimitives, pcbEntities, sessionHistories, commandLog } from "../src/modules/designer/backend/schema";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function captureRows(designId: string) {
  const db = getSharedDb();
  const head = db.select().from(designHeads).where(eq(designHeads.id, designId)).get();
  if (!head) throw new Error(`Missing design ${designId}`);
  const payload = {
    format: "openpcb.net-identity-backup/2",
    designId,
    revision: head.revision,
    schematic: {
      parts: db.select().from(schematicParts).where(eq(schematicParts.designId, designId)).orderBy(asc(schematicParts.id)).all(),
      pins: db.select().from(schematicPins).where(eq(schematicPins.designId, designId)).orderBy(asc(schematicPins.id)).all(),
      wires: db.select().from(schematicWires).where(eq(schematicWires.designId, designId)).orderBy(asc(schematicWires.id)).all(),
      labels: db.select().from(schematicLabels).where(eq(schematicLabels.designId, designId)).orderBy(asc(schematicLabels.id)).all(),
      primitives: db.select().from(schematicPrimitives).where(eq(schematicPrimitives.designId, designId)).orderBy(asc(schematicPrimitives.id)).all(),
    },
    pcbEntities: db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).orderBy(asc(pcbEntities.id)).all(),
    sessionHistories: db.select().from(sessionHistories).where(eq(sessionHistories.designId, designId)).orderBy(asc(sessionHistories.id)).all(),
  };
  return {
    sha256: sha256(JSON.stringify(payload)),
    payload,
    auxiliaryRows: {
      designHead: head,
      commandLog: db.select().from(commandLog).where(eq(commandLog.designId, designId)).orderBy(asc(commandLog.commandId)).all(),
    },
  };
}

export function captureProvenance() {
  const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
  const sourcePaths = [
    "scripts/capture-legacy-net-fixtures.ts", "scripts/legacy-net-fixture-dump.ts",
    "src/modules/designer/backend/store.ts", "src/modules/designer/backend/schema.ts",
    "src/modules/designer/backend/command-executor.ts", "src/modules/designer/backend/projection-read.ts",
    "src/modules/designer/backend/projection-world.ts", "src/modules/designer/backend/pcb/pcb-projection.ts",
    "src/modules/designer/backend/pcb/pcb-store.ts", "src/modules/designer/frontend/pcb/tools/area-tool-options.ts",
    "src/sdks/designer/types.ts", "src/core/backend/tests/helpers/designer-runtime.ts",
  ];
  const dirtyStatus = git("status", "--porcelain=v1").split("\n")
    .filter((line) => line && !/\.env|credential|secret|provider|token/i.test(line));
  return {
    capturedAt: new Date().toISOString(),
    generator: "bun scripts/capture-legacy-net-fixtures.ts",
    gitHead: git("rev-parse", "HEAD"),
    captureBoundary: "Current working tree before durable net identity implementation; includes native pin-intent migration 0021_pin_electrical_intent.sql, not the older d5547f9 baseline",
    workingTreeDirty: dirtyStatus.length > 0,
    dirtyStatus,
    workingTreeDiffSha256: sha256(execFileSync("git", ["diff", "--binary", "HEAD", "--", "src/modules/designer", "src/sdks/designer", "src/shared/pcb-connectivity"])),
    sourceFilesSha256: Object.fromEntries(sourcePaths.sort().map((path) => [path, sha256(readFileSync(path))])),
    payloadHashEncoding: "SHA-256 of UTF-8 JSON.stringify(payload); fixed key order, every table array sorted by id; raw JSON column strings unchanged",
    timestampsAndIds: "Actual SDK-generated UUIDs and timestamps; capture output is an immutable observed snapshot, not byte-identical across reruns",
    privacy: "Only design fixtures and source-file hashes captured; no environment values, credentials or provider data",
  };
}
