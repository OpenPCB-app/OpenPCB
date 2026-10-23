import { describe, expect, test } from "bun:test";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerSDK,
} from "../../../sdks";
import { getSharedSqlite } from "../db/sqlite-client";
import { bootDesignerRuntime, dispatchOk, envelope, postCommand } from "./helpers/designer-runtime";

async function seedActiveNets(sdk: DesignerSDK, designId: string): Promise<Record<string, string>> {
  const names = ["a", "b", "c", "d", "e", "f"];
  for (const [index, name] of names.entries()) await dispatchOk(sdk, designId, {
    type: "upsert_label", text: `Fixture ${name}`, positionNm: { x: index * 10_000_000, y: 100_000_000 },
  });
  const schematic = (await sdk.getSchematicProjection(designId))!;
  const ids = Object.fromEntries(names.map((name) => {
    const net = schematic.nets.find((net) => net.name === `Fixture ${name}`);
    expect(net).toBeDefined();
    return [name, net!.id];
  }));
  return { ...ids, "missing-a": ids.a!, "missing-b": ids.b!, "missing-p": ids.a!, "missing-n": ids.b! };
}

function activeReferences(value: unknown, ids: Record<string, string>): unknown {
  if (typeof value === "string") return Object.hasOwn(ids, value) ? ids[value] : value;
  if (Array.isArray(value)) return value.map((entry) => activeReferences(entry, ids));
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, activeReferences(entry, ids)]),
  );
  return value;
}

const group = {
  id: "bus",
  name: "Bus",
  netIds: ["missing-a", "missing-b"],
  target: { kind: "longest" },
  toleranceMm: 0,
};
const pair = { id: "pair", name: "Pair", pNetId: "missing-p", nNetId: "missing-n" };
type InvalidCase = [string, Record<string, unknown>, string];

const structuralCases: InvalidCase[] = [
    ["groups object", { lengthMatchGroups: {} }, "lengthMatchGroups"],
    ["pairs null", { diffPairs: null }, "diffPairs"],
    ["null group", { lengthMatchGroups: [null] }, "lengthMatchGroups[0]"],
    ["array pair", { diffPairs: [[]] }, "diffPairs[0]"],
    ["duplicate group id", { lengthMatchGroups: [group, group] }, "lengthMatchGroups[1].id"],
    ["duplicate pair id", { diffPairs: [pair, { ...pair, pNetId: "c", nNetId: "d" }] }, "diffPairs[1].id"],
    ["missing members", { lengthMatchGroups: [{ ...group, netIds: undefined }] }, "lengthMatchGroups[0].netIds"],
    ["bad member", { lengthMatchGroups: [{ ...group, netIds: ["a", 7] }] }, "lengthMatchGroups[0].netIds[1]"],
    ["blank member", { lengthMatchGroups: [{ ...group, netIds: ["a", "  "] }] }, "lengthMatchGroups[0].netIds[1]"],
    ["duplicate member", { lengthMatchGroups: [{ ...group, netIds: ["a", "a"] }] }, "lengthMatchGroups[0].netIds[1]"],
    ["empty absolute", { lengthMatchGroups: [{ ...group, netIds: [], target: { kind: "absolute", mm: 1 } }] }, "lengthMatchGroups[0].netIds"],
    ["singleton longest", { lengthMatchGroups: [{ ...group, netIds: ["a"] }] }, "lengthMatchGroups[0].netIds"],
    ["empty longest", { lengthMatchGroups: [{ ...group, netIds: [] }] }, "lengthMatchGroups[0].netIds"],
    ["null target", { lengthMatchGroups: [{ ...group, target: null }] }, "lengthMatchGroups[0].target"],
    ["unknown target", { lengthMatchGroups: [{ ...group, target: { kind: "future" } }] }, "lengthMatchGroups[0].target.kind"],
    ["missing target kind", { lengthMatchGroups: [{ ...group, target: {} }] }, "lengthMatchGroups[0].target.kind"],
    ["self pair", { diffPairs: [{ ...pair, nNetId: pair.pNetId }] }, "diffPairs[0].nNetId"],
    ["identical pair", { diffPairs: [pair, { ...pair, id: "other" }] }, "diffPairs[1]"],
    ["reverse pair", { diffPairs: [pair, { ...pair, id: "other", pNetId: pair.nNetId, nNetId: pair.pNetId }] }, "diffPairs[1]"],
    ["shared pair net", { diffPairs: [pair, { ...pair, id: "other", nNetId: "c" }] }, "diffPairs[1].pNetId"],
    ["shared negative net", { diffPairs: [pair, { ...pair, id: "other", pNetId: "c" }] }, "diffPairs[1].nNetId"],
    ["gap band beyond window", { diffPairs: [{ ...pair, gapMm: 0.2, gapTolMm: 0.1, couplingMaxGapMm: 0.25 }] }, "diffPairs[0].couplingMaxGapMm"],
    ["default gap tolerance beyond window", { diffPairs: [{ ...pair, gapMm: 0.2, couplingMaxGapMm: 0.21 }] }, "diffPairs[0].couplingMaxGapMm"],
    ["gap band beyond default window", { diffPairs: [{ ...pair, gapMm: 0.1, gapTolMm: 0.5 }] }, "diffPairs[0].couplingMaxGapMm"],
];

function invalidCases(): InvalidCase[] {
  const cases = [...structuralCases];
  for (const field of ["id", "name"] as const) {
    for (const bad of [undefined, "", "  ", 5]) {
      cases.push([`group ${field}: ${bad}`, { lengthMatchGroups: [{ ...group, [field]: bad }] }, `lengthMatchGroups[0].${field}`]);
    }
  }
  for (const field of ["id", "name", "pNetId", "nNetId"] as const) {
    for (const bad of [undefined, "", "  ", 5]) {
      cases.push([`pair ${field}: ${bad}`, { diffPairs: [{ ...pair, [field]: bad }] }, `diffPairs[0].${field}`]);
    }
  }
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "0", null]) {
    cases.push([`tolerance: ${bad}`, { lengthMatchGroups: [{ ...group, toleranceMm: bad }] }, "lengthMatchGroups[0].toleranceMm"]);
    for (const field of ["gapMm", "gapTolMm", "maxSkewMm", "maxUncoupledMm", "couplingMaxGapMm"]) {
      cases.push([`${field}: ${bad}`, { diffPairs: [{ ...pair, [field]: bad }] }, `diffPairs[0].${field}`]);
    }
  }
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null, undefined]) {
    cases.push([`absolute mm: ${bad}`, { lengthMatchGroups: [{ ...group, target: { kind: "absolute", mm: bad } }] }, "lengthMatchGroups[0].target.mm"]);
  }
  cases.push(["zero coupling", { diffPairs: [{ ...pair, couplingMaxGapMm: 0 }] }, "diffPairs[0].couplingMaxGapMm"]);
  return cases;
}

function command(fields: Record<string, unknown>): DesignerCommand {
  return { type: "pcb_set_design_rules", ...fields } as unknown as DesignerCommand;
}

function settingsRows(designId: string): unknown[] {
  return getSharedSqlite().query(
    "SELECT * FROM designer_pcb_entities WHERE design_id = ? ORDER BY id",
  ).all(designId);
}

describe("strict SI authoring validation", () => {
  for (const transport of ["SDK", "HTTP"] as const) {
    test(`${transport}: malformed SI refuses the entire command before mutation`, async () => {
      const { sdk, server } = await bootDesignerRuntime(`si-invalid-${transport}`);
      const design = await sdk.createDesign({ name: "SI validation" });
      const activeIds = await seedActiveNets(sdk, design.id);
      const before = (await sdk.getPcbProjection(design.id))!;
      const stored = settingsRows(design.id);
      for (const [label, fields, detail] of invalidCases()) {
        const body = envelope(design.id, before.revision, command({
          boardThicknessMm: 2,
          ...activeReferences(fields, activeIds) as Record<string, unknown>,
        }));
        let result: DesignerDispatchResult;
        if (transport === "SDK") {
          result = await sdk.dispatchCommand(design.id, body);
        } else {
          const response = await postCommand(server, design.id, body);
          const payload = await response.json() as { data?: { result?: DesignerDispatchResult } };
          expect(payload.data?.result, label).toBeDefined();
          result = payload.data!.result!;
        }
        expect(result.ok, label).toBe(false);
        if (!result.ok) {
          expect(result.code, label).toBe("INVALID_PCB_BOARD_SETTINGS");
          expect(JSON.stringify(result), label).toContain(detail);
        }
        expect(settingsRows(design.id), label).toEqual(stored);
        expect((await sdk.getPcbProjection(design.id))!.revision, label).toBe(before.revision);
      }
    });
  }

  test("defaults, zero thresholds, live references and explicit clearing remain supported", async () => {
    const { sdk } = await bootDesignerRuntime("si-valid");
    const design = await sdk.createDesign({ name: "Valid SI" });
    const activeIds = await seedActiveNets(sdk, design.id);
    let projection = (await sdk.getPcbProjection(design.id))!;
    const saved = await sdk.dispatchCommand(design.id, envelope(design.id, projection.revision, command(activeReferences({
      lengthMatchGroups: [
        { id: "default", name: "Default", netIds: ["a", "b"] },
        { ...group, id: "single", netIds: ["a"], target: { kind: "absolute", mm: 2 } },
      ],
      diffPairs: [
        { ...pair, gapTolMm: 0, maxSkewMm: 0, maxUncoupledMm: 0 },
        { id: "zero", name: "Zero", pNetId: "c", nNetId: "d", gapMm: 0, gapTolMm: 0 },
        { id: "boundary", name: "Boundary", pNetId: "e", nNetId: "f", gapMm: 0.2, gapTolMm: 0.1, couplingMaxGapMm: 0.2 + 0.1 },
      ],
    }, activeIds) as Record<string, unknown>)));
    expect(saved.ok).toBe(true);
    projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.board.lengthMatchGroups?.[0]?.target).toEqual({ kind: "longest" });
    expect(projection.board.lengthMatchGroups?.[0]?.toleranceMm).toBe(0);
    expect(projection.board.diffPairs?.[0]?.maxSkewMm).toBe(0);
    const cleared = await sdk.dispatchCommand(design.id, envelope(design.id, projection.revision, command({ lengthMatchGroups: [], diffPairs: [] })));
    expect(cleared.ok).toBe(true);
    projection = (await sdk.getPcbProjection(design.id))!;
    expect(projection.board.lengthMatchGroups ?? []).toEqual([]);
    expect(projection.board.diffPairs ?? []).toEqual([]);
  });

  test("invalid SI never triggers lazy board-settings creation", async () => {
    const { sdk } = await bootDesignerRuntime("si-no-lazy-write");
    const design = await sdk.createDesign({ name: "Untouched board" });
    const before = settingsRows(design.id);
    const result = await sdk.dispatchCommand(design.id, envelope(
      design.id, null, command({ diffPairs: [null] }),
    ));
    expect(result.ok).toBe(false);
    expect(settingsRows(design.id)).toEqual(before);
  });

  test("unrelated saves retain unknown SI data and rescued rows; clearing removes known rows", async () => {
    const { sdk } = await bootDesignerRuntime("si-legacy-rescue");
    const design = await sdk.createDesign({ name: "Future SI" });
    const projection = (await sdk.getPcbProjection(design.id))!;
    const sqlite = getSharedSqlite();
    const stored = sqlite.query<{ payload_json: string }>(
      "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'",
    ).get(design.id)!;
    const futureGroup = { id: "future-group", name: "Future", target: { kind: "future" } };
    const futurePair = { id: "future-pair", name: "Future", pNetId: 7 };
    const raw = {
      ...JSON.parse(stored.payload_json) as Record<string, unknown>,
      futureSi: { kind: "phase" },
      lengthMatchGroups: [{ ...group, futureGroupKey: 1 }, futureGroup],
      diffPairs: [{ ...pair, futurePairKey: 2 }, futurePair],
    };
    sqlite.query("UPDATE designer_pcb_entities SET payload_json = ? WHERE design_id = ? AND kind = 'board_settings'")
      .run(JSON.stringify(raw), design.id);
    const saved = await sdk.dispatchCommand(design.id, envelope(
      design.id, projection.revision, command({ boardThicknessMm: 2 }),
    ));
    expect(saved.ok).toBe(true);
    let next = sqlite.query<{ payload_json: string }>(
      "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'",
    ).get(design.id)!;
    let payload = JSON.parse(next.payload_json) as Record<string, unknown>;
    expect(payload.futureSi).toEqual(raw.futureSi);
    expect(payload.lengthMatchGroups).toEqual(raw.lengthMatchGroups);
    expect(payload.diffPairs).toEqual(raw.diffPairs);
    if (!saved.ok) throw new Error("unrelated SI save failed");
    const resaved = await sdk.dispatchCommand(design.id, envelope(
      design.id, saved.revision, command({ lengthMatchGroups: [group], diffPairs: [pair] }),
    ));
    expect(resaved.ok).toBe(true);
    if (!resaved.ok) throw new Error("stored stale SI references must resave under the same owners");
    next = sqlite.query<{ payload_json: string }>(
      "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'",
    ).get(design.id)!;
    payload = JSON.parse(next.payload_json) as Record<string, unknown>;
    expect(payload.lengthMatchGroups).toEqual(raw.lengthMatchGroups);
    expect(payload.diffPairs).toEqual(raw.diffPairs);
    const cleared = await sdk.dispatchCommand(design.id, envelope(
      design.id, resaved.revision, command({ lengthMatchGroups: [], diffPairs: [] }),
    ));
    expect(cleared.ok).toBe(true);
    next = sqlite.query<{ payload_json: string }>(
      "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'",
    ).get(design.id)!;
    payload = JSON.parse(next.payload_json) as Record<string, unknown>;
    expect(payload.lengthMatchGroups).toEqual([futureGroup]);
    expect(payload.diffPairs).toEqual([futurePair]);
  });
});
