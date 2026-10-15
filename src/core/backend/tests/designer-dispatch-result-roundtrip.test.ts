// OPENPCB-103: every failure a command can log must replay as itself. A logged result
// this build cannot rebuild used to replay as REVISION_CONFLICT with actual >= 0 — an
// ordinary-looking conflict that invites a fresh-id reapply of an applied command.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import {
  inspectLoggedResult,
  parseDispatchResultJson,
  type DesignerDispatchFailure,
  type DesignerDispatchFailureCode,
} from "../../../modules/designer/backend/results";
import type { DesignerCommandEnvelope } from "../../../sdks/designer";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";

/** Typed so a failure code added without a fixture fails typecheck. */
const FIXTURES: {
  [C in DesignerDispatchFailureCode]: Extract<DesignerDispatchFailure, { code: C }>;
} = {
  NET_MERGE_REQUIRES_CONFIRM: {
    ok: false,
    code: "NET_MERGE_REQUIRES_CONFIRM",
    message: "This change would merge distinct nets",
    nets: [
      { name: "GND", pinCount: 3 },
      { name: null, pinCount: 2 },
    ],
  },
  OPERATION_IDENTITY_CONFLICT: { ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: "c1" },
  PCB_COPPER_ILLEGAL: {
    ok: false,
    code: "PCB_COPPER_ILLEGAL",
    detail: "1 DRC violation(s): TRACE_WIDTH_MIN (0.100/0.200)",
    violations: [
      {
        id: "v1",
        code: "TRACE_WIDTH_MIN",
        ruleClass: "constraint",
        severity: "error",
        message: "too thin",
        anchors: [],
        layer: "F.Cu",
        measuredMm: 0.1,
        requiredMm: 0.2,
      },
    ],
    refusedCount: 7,
  },
  REVISION_CONFLICT: { ok: false, code: "REVISION_CONFLICT", conflict: { expected: null, actual: 4 } },
  COMPONENT_NOT_FOUND: { ok: false, code: "COMPONENT_NOT_FOUND", componentId: "cmp" },
  COMPONENT_NOT_WIREABLE: { ok: false, code: "COMPONENT_NOT_WIREABLE", componentId: "cmp", reason: "NO_PINS" },
  FOOTPRINT_PIN_MISMATCH: { ok: false, code: "FOOTPRINT_PIN_MISMATCH", partId: "p", missingPinNumbers: ["1", "2"] },
  PIN_NOT_FOUND: { ok: false, code: "PIN_NOT_FOUND", pinId: "pin" },
  ENTITY_NOT_FOUND: { ok: false, code: "ENTITY_NOT_FOUND", entityId: "e", entityKind: "primitive" },
  INVALID_WIRE_PATH: { ok: false, code: "INVALID_WIRE_PATH", detail: "d" },
  DUPLICATE_REFERENCE: { ok: false, code: "DUPLICATE_REFERENCE", reference: "R1" },
  INVALID_LABEL: { ok: false, code: "INVALID_LABEL", detail: "d" },
  INVALID_PRIMITIVE: { ok: false, code: "INVALID_PRIMITIVE", detail: "d" },
  PRIMITIVE_NOT_FOUND: { ok: false, code: "PRIMITIVE_NOT_FOUND", primitiveId: "prim" },
  INVALID_PCB_BOARD_SETTINGS: { ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail: "d" },
  PCB_PLACEMENT_NOT_FOUND: { ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId: "pl" },
  INVALID_PCB_TRACE: { ok: false, code: "INVALID_PCB_TRACE", detail: "d" },
  INVALID_PCB_VIA: { ok: false, code: "INVALID_PCB_VIA", detail: "d" },
  PCB_TRACE_NOT_FOUND: { ok: false, code: "PCB_TRACE_NOT_FOUND", traceId: "t" },
  PCB_VIA_NOT_FOUND: { ok: false, code: "PCB_VIA_NOT_FOUND", viaId: "v" },
  PCB_NET_CLASS_NOT_FOUND: { ok: false, code: "PCB_NET_CLASS_NOT_FOUND", netClassId: "nc" },
  INVALID_PCB_FREE_HOLE: { ok: false, code: "INVALID_PCB_FREE_HOLE", detail: "d" },
  PCB_FREE_HOLE_NOT_FOUND: { ok: false, code: "PCB_FREE_HOLE_NOT_FOUND", freeHoleId: "h" },
  INVALID_PCB_FREE_PAD: { ok: false, code: "INVALID_PCB_FREE_PAD", detail: "d" },
  PCB_FREE_PAD_NOT_FOUND: { ok: false, code: "PCB_FREE_PAD_NOT_FOUND", freePadId: "fp" },
  INVALID_PCB_OVERLAY: { ok: false, code: "INVALID_PCB_OVERLAY", detail: "d" },
  PCB_OVERLAY_NOT_FOUND: { ok: false, code: "PCB_OVERLAY_NOT_FOUND", overlayId: "o" },
  INVALID_PCB_ZONE: { ok: false, code: "INVALID_PCB_ZONE", detail: "d" },
  PCB_ZONE_NOT_FOUND: { ok: false, code: "PCB_ZONE_NOT_FOUND", zoneId: "z" },
  PCB_ZONE_BOARD_EXISTS: { ok: false, code: "PCB_ZONE_BOARD_EXISTS", layer: "B.Cu" },
  INVALID_PCB_KEEPOUT: { ok: false, code: "INVALID_PCB_KEEPOUT", detail: "d" },
  PCB_KEEPOUT_NOT_FOUND: { ok: false, code: "PCB_KEEPOUT_NOT_FOUND", keepoutId: "k" },
  INVALID_DRC_RULE: { ok: false, code: "INVALID_DRC_RULE", ruleId: "r", detail: "d" },
};

describe("parseDispatchResultJson round-trip", () => {
  for (const [code, result] of Object.entries(FIXTURES)) {
    test(code, () => {
      expect(parseDispatchResultJson(JSON.stringify(result))).toEqual(result);
    });
  }

  test("an unknown code or a prototype key is unparseable, not a crash", () => {
    for (const code of ["FUTURE_CODE", "toString", "__proto__", "constructor"]) {
      expect(parseDispatchResultJson(JSON.stringify({ ok: false, code }))).toBeNull();
    }
  });

  test("inspectLoggedResult reads what an unparseable row says about itself", () => {
    expect(inspectLoggedResult('{"ok":false,"code":"FUTURE_CODE"}')).toEqual({
      rawOk: false,
      rawCode: "FUTURE_CODE",
    });
    expect(inspectLoggedResult('{"ok":true}')).toEqual({ rawOk: true, rawCode: null });
    expect(inspectLoggedResult("{not json")).toEqual({ rawOk: null, rawCode: null });
  });
});

describe("replay of an unparseable logged result", () => {
  let folder: string;
  const oldPath = process.env.OPENPCB_DB_PATH;
  const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), "designer-replay-"));
  });

  afterEach(async () => {
    resetCaptureRuntimeForTesting();
    resetSharedSqliteForTesting();
    if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
    else process.env.OPENPCB_DB_PATH = oldPath;
    if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
    else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
    await rm(folder, { recursive: true, force: true });
  });

  function logRow(envelope: DesignerCommandEnvelope, resultJson: string, appliedRevision: number) {
    getSharedSqlite()
      .query(
        `INSERT INTO designer_command_log
          (command_id, design_id, session_id, command_type, command_json, result_json,
           issued_at, applied_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        envelope.commandId,
        envelope.aggregateId,
        envelope.sessionId,
        envelope.command.type,
        JSON.stringify(envelope.command),
        resultJson,
        envelope.issuedAt,
        appliedRevision,
        "2026-10-15T00:00:00.000Z",
      );
  }

  function holeEnvelope(designId: string, commandId: string): DesignerCommandEnvelope {
    return {
      commandId,
      sessionId: "replay-session",
      aggregateId: designId,
      baseRevision: 0,
      issuedAt: 1000,
      command: { type: "pcb_add_free_hole", centerMm: { x: 1, y: 1 }, drillMm: 1 },
    };
  }

  test("an unparseable ok row replays as success at its applied revision", async () => {
    const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
    const design = await store.createDesign();
    const envelope = holeEnvelope(design.id, "future-ok");
    logRow(envelope, JSON.stringify({ ok: true, revisionV2: 5 }), 5);
    expect(await store.dispatchCommand(design.id, envelope)).toEqual({
      ok: true,
      revision: 5,
      createdEntityId: null,
      idempotent: true,
    });
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
  });

  test("an unparseable failure replays as not-applied (actual -1), never a live conflict", async () => {
    const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
    const design = await store.createDesign();
    for (const [id, json] of [
      ["future-failure", JSON.stringify({ ok: false, code: "FUTURE_CODE" })],
      ["garbage", "{not json"],
    ] as const) {
      const envelope = holeEnvelope(design.id, id);
      logRow(envelope, json, 0);
      expect(await store.dispatchCommand(design.id, envelope)).toEqual({
        ok: false,
        code: "REVISION_CONFLICT",
        conflict: { expected: 0, actual: -1 },
      });
    }
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
  });
});
