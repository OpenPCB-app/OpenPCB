import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { NetIdentityBackupSnapshot } from "../../../modules/designer/backend/net-identity/backup";
import { bindNetIdentity } from "../../../modules/designer/backend/net-identity/bind";
import { classifyLegacyReference } from "../../../modules/designer/backend/net-identity/migration-classify";
import { legacyBackupSequenceWatermark } from "../../../modules/designer/backend/net-identity/migration-watermark";
import {
  designNetSalt, formatDurableNetId, NetIdentityStateInvalidError,
} from "../../../modules/designer/backend/net-identity/types";
import { judgeNetReference, type NetReference } from "../../../shared/electrical-identity/references";

function snapshot(): NetIdentityBackupSnapshot {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/legacy-net-ids/f1-routed-clean.json", import.meta.url), "utf8")) as {
    payload: NetIdentityBackupSnapshot;
  };
  return fixture.payload;
}

function own(input: NetIdentityBackupSnapshot, seq: number): string {
  return formatDurableNetId(designNetSalt(input.designId), seq);
}

describe("legacy backup durable sequence watermark", () => {
  test("a quarantined raw reference cannot become bound through fresh allocation", () => {
    const input = snapshot(), oldId = own(input, 1);
    input.pcbEntities[0]!.payloadJson = JSON.stringify({ id: "raw-trace", netId: oldId });
    const ref: NetReference = {
      site: { kind: "trace", traceId: "raw-trace" }, netId: oldId, netName: null, refClass: "copper",
    };
    expect(classifyLegacyReference(ref, {
      legacyRootIds: new Map(), namedIdsByUpperName: new Map(), legacyAutoRootsByUpperName: new Map(),
      evidence: {
        islands: [], islandOf: new Map(), evidenceByRef: new Map(),
        pooledByLegacyRoot: new Map(), pourDisabledReasons: [],
      },
    })).toEqual({ kind: "quarantine", reason: "no_evidence", candidates: [], suggestedNetId: null });
    const bind = (seqWatermark: number) => bindNetIdentity({
      salt: designNetSalt(input.designId), seqWatermark, previousActive: [], mode: "commit",
      pinLabel: () => undefined,
      components: [{
        key: "live-root", pinIds: ["p1", "p2"], wireIds: [], labelIds: [], primitiveIds: [],
        derivedName: null, nameSource: "auto", legacyName: "Net_1",
      }],
    });
    expect(judgeNetReference(ref, new Set(bind(1).nets.map((net) => net.id)))).toBe("bound");
    const migrated = bind(legacyBackupSequenceWatermark(input, 1));
    expect(migrated.createdIds).toEqual([own(input, 2)]);
    expect(judgeNetReference(ref, new Set(migrated.nets.map((net) => net.id)))).toBe("inactive");
  });

  test("assignment object keys and PCB payload values both reserve sequences", () => {
    const input = snapshot();
    input.pcbEntities[0]!.payloadJson = JSON.stringify({ perNetClassAssignments: { [own(input, 21)]: "fast" } });
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(22);
    input.pcbEntities[1]!.payloadJson = JSON.stringify({ unknownRow: { netId: own(input, 35) } });
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(36);
  });

  test.each(["undoStackJson", "redoStackJson"] as const)("IDs surviving only in %s stay reserved", (column) => {
    const input = snapshot();
    input.sessionHistories[0]![column] = JSON.stringify([{ patch: { netId: own(input, 81) } }]);
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(82);
  });

  test("schematic columns and nested opaque extension JSON are scanned without a whitelist", () => {
    const input = snapshot();
    input.schematic.pins[0]!.electricalIntent = own(input, 40);
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(41);
    input.schematic.parts[0]!.propertiesJson = JSON.stringify({
      future: JSON.stringify([{ [own(input, 93)]: JSON.stringify({ value: own(input, 105) }) }]),
    });
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(106);
    const extended = { ...input, unknownExtension: JSON.stringify({ another: own(input, 120) }) };
    expect(legacyBackupSequenceWatermark(extended, 1)).toBe(121);
  });

  test("only exact own-design durable IDs count", () => {
    const input = snapshot(), id = own(input, 99);
    const foreign = formatDurableNetId(designNetSalt("foreign-design"), Number.MAX_SAFE_INTEGER);
    const extended = { ...input, values: [
      foreign, "pt:99", "nc:99", "pending:99", `prefix ${id}`, `${id} suffix`, ` ${id}`, `${id}\n`,
      `${id}:extra`, id.replace(":99", ":099"), id.replace(":99", ":0"), id.toUpperCase(),
      id.replace(":99", ":9007199254740992"), JSON.stringify(id), `not-json [${id}]`,
    ] };
    expect(legacyBackupSequenceWatermark(extended, 7)).toBe(7);
  });

  test("malformed opaque JSON is untouched and its ID substrings are ignored", () => {
    const input = snapshot(), value = ` {"netId":"${own(input, 999)}"`;
    input.pcbEntities[0]!.payloadJson = value;
    input.sessionHistories[0]!.undoStackJson = ` ["${own(input, 888)}",`;
    const before = JSON.stringify(input);
    expect(legacyBackupSequenceWatermark(input, 4)).toBe(4);
    expect(JSON.stringify(input)).toBe(before);
    expect(input.pcbEntities[0]!.payloadJson).toBe(value);
  });

  test("maximum sequence overflow fails with the identity validation error", () => {
    const input = snapshot();
    const extended = { ...input, historicalId: own(input, Number.MAX_SAFE_INTEGER) };
    expect(() => legacyBackupSequenceWatermark(extended, 1)).toThrow(NetIdentityStateInvalidError);
    expect(() => legacyBackupSequenceWatermark(extended, 1)).toThrow("durable sequence exhausted");
    const lastReservable = { ...input, historicalId: own(input, Number.MAX_SAFE_INTEGER - 1) };
    expect(legacyBackupSequenceWatermark(lastReservable, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("invalid minimum %s fails", (minimum) => {
    expect(() => legacyBackupSequenceWatermark(snapshot(), minimum)).toThrow(NetIdentityStateInvalidError);
  });

  test("minimum is never reduced and repeat reads preserve all raw bytes", () => {
    const input = snapshot();
    input.pcbEntities[0]!.payloadJson = ` \n { "future" : ["${own(input, 15)}"] }\t `;
    const before = JSON.stringify(input);
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(16);
    expect(legacyBackupSequenceWatermark(input, 1)).toBe(16);
    expect(legacyBackupSequenceWatermark(input, 100)).toBe(100);
    expect(legacyBackupSequenceWatermark(input, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("deep objects and repeated references use an iterative immutable walk", () => {
    const input = snapshot();
    const leaf: Record<string, unknown> = { value: own(input, 67) };
    let deep: Record<string, unknown> = leaf;
    for (let level = 0; level < 20_000; level++) deep = { child: deep };
    leaf.repeat = leaf;
    const extended = { ...input, deep, repeated: leaf };
    expect(legacyBackupSequenceWatermark(extended, 1)).toBe(68);
    expect(leaf.repeat).toBe(leaf);
    expect(extended.repeated).toBe(leaf);
  });
});
