import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runErc } from "../../../modules/designer/backend/erc/erc-engine";
import {
  deriveNetsAndJunctions,
  deriveNetComponents,
  projectionFromWorld,
  projectionFromWorldWithIdentity,
  projectionToWorld,
  replaceSchematicProjection,
} from "../../../modules/designer/backend/projection-world";
import type { DesignerPrimitive } from "../../../sdks/designer";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { bindSchematicIdentity } from "../../../modules/designer/backend/net-identity/projection";
import { readNetIdentityState, writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { syncNetIdentity } from "../../../modules/designer/backend/net-identity/sync";
import { designNetSalt } from "../../../modules/designer/backend/net-identity/types";
import { openReceiptStore } from "./designer-operation-receipts-harness";
import { ercProjection } from "./helpers/erc-fixtures";

function pwr(id: string, railText: string): DesignerPrimitive {
  return {
    id,
    kind: "pwr",
    railText,
    positionNm: { x: 0, y: 0 },
    rotationDeg: 0,
  };
}
const gnd: DesignerPrimitive = {
  id: "gnd",
  kind: "gnd",
  positionNm: { x: 0, y: 0 },
  rotationDeg: 0,
};

describe("ERC net naming diagnostics", () => {
  test("different power rails survive world projection as ERC warnings", () => {
    const projection = projectionFromWorld(
      "d",
      1,
      projectionToWorld(
        ercProjection({ primitives: [pwr("a", "+5V"), pwr("b", "+3V3")] }),
      ),
    );
    expect(projection.netDiagnostics).toHaveLength(1);
    expect(
      runErc(projection).violations.find((v) => v.code === "PWR_RAIL_CONFLICT"),
    ).toMatchObject({
      severity: "warning",
      anchors: [{ kind: "net", netId: projection.nets[0]!.id }],
    });
  });

  test("GND priority does not hide a different power rail", () => {
    const derived = deriveNetsAndJunctions(
      [],
      [],
      [],
      [gnd, pwr("vcc", "VCC")],
    );
    expect(derived.nets[0]?.name).toBe("GND");
    expect(derived.warnings).toHaveLength(1);
    expect(derived.warnings[0]?.code).toBe("PWR_RAIL_CONFLICT");
    expect(derived.warnings[0]?.detail).toContain("GND");
    expect(derived.warnings[0]?.detail).toContain("VCC");
  });

  test("case-only power aliases and canonical GND alias do not conflict", () => {
    expect(
      deriveNetsAndJunctions([], [], [], [pwr("a", "VCC"), pwr("b", "vcc")])
        .warnings,
    ).toEqual([]);
    expect(
      deriveNetsAndJunctions([], [], [], [gnd, pwr("a", "gnd")]).warnings,
    ).toEqual([]);
  });

  test("GND label override reaches ERC alongside rail conflict", () => {
    const projection = projectionFromWorld(
      "d",
      1,
      projectionToWorld(
        ercProjection({
          primitives: [gnd, pwr("vcc", "VCC")],
          labels: [{ id: "label", text: "SIGNAL", positionNm: { x: 0, y: 0 } }],
        }),
      ),
    );
    expect(
      runErc(projection).violations.filter(
        (v) => v.code === "LABEL_OVERRIDDEN_BY_GND",
      ),
    ).toHaveLength(1);
    expect(
      runErc(projection).violations.filter(
        (v) => v.code === "PWR_RAIL_CONFLICT",
      ),
    ).toHaveLength(1);
  });
});

let folder: string | undefined;
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
afterEach(async () => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = oldPath;
  if (oldCapture === undefined)
    delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

for (const mode of ["durable", "legacy"] as const) test(`${mode} database and world projections retain identical naming diagnostics`, async () => {
  folder = await mkdtemp(path.join(tmpdir(), "erc-diagnostics-"));
  const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
  const design = await store.createDesign();
  const authored = ercProjection({
    designId: design.id,
    revision: 0,
    primitives: [gnd, pwr("vcc", "VCC")],
  });
  const timestamp = new Date().toISOString();
  getSharedDb().transaction((tx) => {
    replaceSchematicProjection(tx, design.id, authored, timestamp);
    if (mode === "durable") syncNetIdentity(tx, design.id, 0, timestamp);
    else writeNetIdentityState(tx, { ...readNetIdentityState(tx, design.id)!, status: "legacy_restored", active: [] });
  });
  const database = (await store.getSchematicProjection(design.id))!;
  const state = readNetIdentityState(getSharedDb(), design.id)!;
  const world = mode === "legacy" ? projectionFromWorld(design.id, database.revision, projectionToWorld(authored)) :
    projectionFromWorldWithIdentity(design.id, database.revision, projectionToWorld(authored, state.active), (source, previousActive) =>
      bindSchematicIdentity(source, deriveNetComponents(source.parts, source.wires, source.labels, source.primitives), {
        previousActive, salt: designNetSalt(design.id), seqWatermark: state.nextSeq, mode: "read", dependentCount: () => 0,
      })).projection;
  expect(database.netDiagnostics).toHaveLength(1);
  expect(database.netDiagnostics).toEqual(world.netDiagnostics);
  expect(runErc(database)).toEqual(runErc(world));
  for (const projection of [database, world]) {
    expect(projection.nets[0]!.id).toStartWith(mode === "durable" ? "net:" : "pt:");
    expect(projection.netDiagnostics![0]!.netRoot).toBe(projection.nets[0]!.id);
    expect(runErc(projection).violations.find((violation) => violation.code === "PWR_RAIL_CONFLICT")!.anchors)
      .toEqual([{ kind: "net", netId: projection.nets[0]!.id }]);
  }
});
