import { describe, expect, it } from "vitest";
import {
  DESIGNER_RECOVERY_EPOCH,
  DESIGNER_RECOVERY_SCHEMA,
  decodeRecord,
  encodeRecord,
  recoveryKey,
  type DesignerRecoveryRecordV1,
  type RecoveredAction,
} from "./designer-recovery-record";

const compat = {
  schemaHead: "0020_operation_receipts",
  commandEpoch: 1,
  recordEpoch: DESIGNER_RECOVERY_EPOCH,
  appVersion: "0.9.0",
};
const sent = { commandId: "c-1", baseRevision: 7, issuedAt: 1_760_000_000_000 };
const queuedActions: Record<string, RecoveredAction> = {
  command: {
    kind: "command",
    sessionId: "designer-ui-session",
    command: { type: "delete_entity", entityId: "p1", entityKind: "part" },
  },
  undo: { kind: "undo", sessionId: "designer-ui-session" },
  redo: { kind: "redo", sessionId: "designer-pcb-session" },
  bom: {
    kind: "bom_override",
    refdes: "R1",
    patch: { dnp: true, unitPrice: 0.02, assemblySide: null, notes: "x" },
    partId: "part-1",
  },
};
const sendingActions: Record<string, RecoveredAction> = {
  command: { ...(queuedActions.command as RecoveredAction & { kind: "command" }), sent },
  undo: { kind: "undo", sessionId: "designer-ui-session", expectedRevision: 7 },
  redo: { kind: "redo", sessionId: "designer-pcb-session", expectedRevision: 0 },
  bom: { ...(queuedActions.bom as RecoveredAction & { kind: "bom_override" }), observedHead: 7 },
};

function record(
  phase: "queued" | "sending",
  action: RecoveredAction,
): DesignerRecoveryRecordV1 {
  return {
    schema: DESIGNER_RECOVERY_SCHEMA,
    version: 1,
    compat,
    recordId: "rec-1",
    designId: "design-1",
    createdAt: "2026-10-15T08:00:00.000Z",
    seq: 3,
    phase,
    action,
    lastKnown: { state: phase, at: "2026-10-15T08:00:00.000Z" },
  };
}
const KEY = recoveryKey("design-1", "rec-1");
/** Decodes a hand-edited form of a valid record. */
const decodeEdited = (
  base: DesignerRecoveryRecordV1,
  edit: (record: DesignerRecoveryRecordV1) => unknown,
) => decodeRecord(KEY, JSON.stringify(edit(base)));

describe("designer recovery record", () => {
  it("round-trips every action kind in both phases", () => {
    for (const [phase, actions] of [
      ["queued", queuedActions],
      ["sending", sendingActions],
    ] as const)
      for (const action of Object.values(actions)) {
        const value = record(phase, action);
        expect(decodeRecord(KEY, encodeRecord(value))).toEqual({
          ok: true,
          record: value,
        });
      }
    const noted = { ...record("sending", sendingActions.undo!) };
    noted.lastKnown = { state: "unknown", message: "lost", at: noted.createdAt };
    expect(decodeRecord(KEY, encodeRecord(noted))).toEqual({ ok: true, record: noted });
    const unknownCompat = { ...record("queued", queuedActions.bom!) };
    unknownCompat.compat = { ...compat, schemaHead: null, commandEpoch: null, appVersion: null };
    expect(decodeRecord(KEY, encodeRecord(unknownCompat)).ok).toBe(true);
  });

  it("rejects a queued record that carries send ids", () => {
    for (const [kind, action] of Object.entries(sendingActions)) {
      const decoded = decodeRecord(KEY, JSON.stringify(record("queued", action)));
      expect([kind, decoded]).toEqual([kind, { ok: false, reason: "malformed" }]);
    }
  });

  it("rejects a sending record without its send ids", () => {
    for (const [kind, action] of Object.entries(queuedActions)) {
      const decoded = decodeRecord(KEY, JSON.stringify(record("sending", action)));
      expect([kind, decoded]).toEqual([kind, { ok: false, reason: "malformed" }]);
    }
    const bad = record("sending", sendingActions.command!);
    for (const sentEdit of [
      { commandId: "" },
      { commandId: "x".repeat(129) },
      { baseRevision: -1 },
      { baseRevision: 1.5 },
      { issuedAt: "now" },
    ])
      expect(
        decodeEdited(bad, (r) => ({
          ...r,
          action: { ...r.action, sent: { ...sent, ...sentEdit } },
        })),
      ).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to encode a record it could not decode again", () => {
    expect(() => encodeRecord(record("queued", sendingActions.command!))).toThrow(
      "Invalid designer recovery record (malformed)",
    );
    expect(() => encodeRecord(record("sending", queuedActions.undo!))).toThrow();
  });

  it("reports future versions, key mismatches and foreign values without decoding them", () => {
    const base = record("sending", sendingActions.command!);
    expect(decodeEdited(base, (r) => ({ ...r, version: 2 }))).toEqual({
      ok: false,
      reason: "future-version",
    });
    // A newer build's record keeps its own keys: still reported as future, not malformed.
    expect(
      decodeEdited(base, (r) => ({ ...r, version: 3, extra: 1 })),
    ).toEqual({ ok: false, reason: "future-version" });
    expect(decodeRecord(recoveryKey("design-2", "rec-1"), encodeRecord(base))).toEqual({
      ok: false,
      reason: "key-mismatch",
    });
    for (const raw of ["", "{", "[]", "null", '"x"', JSON.stringify({ ...base, schema: "other" })])
      expect(decodeRecord(KEY, raw)).toEqual({ ok: false, reason: "malformed" });
    expect(decodeEdited(base, (r) => ({ ...r, version: 0 })).ok).toBe(false);
  });

  it("treats any key outside the v1 set as malformed (newer-build records are preserved)", () => {
    const command = record("sending", sendingActions.command!);
    const bom = record("sending", sendingActions.bom!);
    type Edit = (r: DesignerRecoveryRecordV1) => unknown;
    const { appVersion: _dropped, ...compatWithoutApp } = compat;
    const action = (r: DesignerRecoveryRecordV1, extra: object) => ({
      ...r,
      action: { ...r.action, ...extra },
    });
    const bomPatch = (r: DesignerRecoveryRecordV1, extra: object) =>
      action(r, { patch: { dnp: true, ...extra } });
    const edits: Array<[DesignerRecoveryRecordV1, Edit]> = [
      [command, (r) => ({ ...r, headers: { authorization: "Bearer x" } })],
      [command, (r) => action(r, { payloadHash: "abc" })],
      [command, (r) => action(r, { sent: { ...sent, attempt: 2 } })],
      [command, (r) => ({ ...r, compat: { ...compat, platform: "darwin" } })],
      [command, (r) => ({ ...r, lastKnown: { ...r.lastKnown, retries: 1 } })],
      [bom, (r) => bomPatch(r, { weight: 3 })],
      [bom, (r) => bomPatch(r, { dnp: "yes" })],
      [bom, (r) => action(r, { partId: "" })],
      [command, (r) => action(r, { kind: "autolayout" })],
      [command, (r) => ({ ...r, phase: "acked" })],
      [command, (r) => ({ ...r, seq: -1 })],
      [command, (r) => ({ ...r, recordId: "" })],
      [command, (r) => ({ ...r, designId: "d".repeat(129) })],
      [command, (r) => ({ ...r, compat: compatWithoutApp })],
      [command, (r) => ({ ...r, compat: { ...compat, recordEpoch: null } })],
      [command, (r) => ({ ...r, lastKnown: { ...r.lastKnown, state: "acknowledged" } })],
      [command, (r) => action(r, { command: { entityId: "p1" } })],
    ];
    for (const [base, edit] of edits)
      expect(decodeEdited(base, edit)).toEqual({ ok: false, reason: "malformed" });
    // A record whose own designId disagrees with the key it is stored under.
    expect(decodeEdited(command, (r) => ({ ...r, designId: "design-2" }))).toEqual({
      ok: false,
      reason: "key-mismatch",
    });
  });
});
