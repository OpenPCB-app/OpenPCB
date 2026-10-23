import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PcbBoardSettings, PcbFreePad, PcbKeepout, PcbPlacedPart, PcbTrace, PcbVia, PcbZone } from "../../../sdks/designer";
import { boardCopperRecords } from "../../../shared/pcb-connectivity/board-connectivity";
import { copperReferenceKey, legacyContactEvidence, type LegacyContactEvidenceInput } from "../../../modules/designer/backend/net-identity/evidence";

const ROOT = "pt:0:-3810000";
const TARGET = "net:aaaaaaaaaa:1";
const parse = <T>(value: string): T => JSON.parse(value) as T;

function frozenF9(): LegacyContactEvidenceInput {
  const fixture = parse<{ payload: { pcbEntities: Array<{ kind: string; payloadJson: string }> } }>(
    readFileSync(new URL("./fixtures/legacy-net-ids/f9-pour-only-gnd.json", import.meta.url), "utf8"));
  const rows = fixture.payload.pcbEntities;
  const placements = rows.filter((row) => row.kind === "placement").map((row) => parse<PcbPlacedPart>(row.payloadJson));
  const zones = rows.filter((row) => row.kind === "zone").map((row) => parse<PcbZone>(row.payloadJson));
  const padNetIds = new Map(placements.flatMap((placement) => (placement.footprint.preview?.pads ?? [])
    .map((pad) => [`${placement.id}|${pad.number}`, TARGET] as const)));
  return {
    board: parse<PcbBoardSettings>(rows.find((row) => row.kind === "board_settings")!.payloadJson),
    placements, padNetIds, zones, keepouts: [], traces: [], freePads: [], freeHoles: [],
    vias: rows.filter((row) => row.kind === "via").map((row) => parse<PcbVia>(row.payloadJson)),
    legacyRootIds: new Map([[ROOT, TARGET]]), netNames: new Map([[TARGET, "GND"]]),
    nameBoundZones: zones.map((zone) => ({ zone, netId: TARGET })), allowPourEvidence: true,
  };
}

function keepout(x0: number, y0: number, x1: number, y1: number): PcbKeepout {
  return { id: "void", enabled: true, lockedAt: null, name: null, layers: ["F.Cu"],
    pointsMm: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    restrictions: { tracks: false, vias: false, pads: false, copperPour: true, footprints: false } };
}

function provenVias(input: LegacyContactEvidenceInput): number {
  const result = legacyContactEvidence(input);
  return input.vias.filter((via) => result.evidenceByRef.get(copperReferenceKey("via", via.id))!.padNets.has(TARGET)).length;
}

function bare(): LegacyContactEvidenceInput {
  return { ...frozenF9(), zones: [], nameBoundZones: [], vias: [], allowPourEvidence: false };
}

function firstPad(input: LegacyContactEvidenceInput) {
  return boardCopperRecords({ ...input, layerCount: input.board.layerCount }).pads[0]!;
}

function viaAt(input: LegacyContactEvidenceInput, centerMm = firstPad(input).center): PcbVia {
  return { ...frozenF9().vias[0]!, id: "probe", centerMm, netId: ROOT };
}

function traceAt(input: LegacyContactEvidenceInput, id = "trace"): PcbTrace {
  const a = firstPad(input).center;
  return { id, netId: ROOT, netClassId: "default", layer: "F.Cu", widthMm: 0.25,
    pointsNm: [{ x: Math.round(a.x * 1e6), y: Math.round(a.y * 1e6) }, { x: Math.round((a.x + 0.1) * 1e6), y: Math.round(a.y * 1e6) }], segmentMode: "manhattan-90" };
}

describe("legacy identity actual pour evidence", () => {
  test("frozen F9 proves all four stitching vias through independently labelled pads", () => {
    const input = frozenF9();
    const result = legacyContactEvidence(input);
    expect(provenVias(input)).toBe(4);
    for (const via of input.vias) {
      expect(result.evidenceByRef.get(copperReferenceKey("via", via.id))).toMatchObject({
        directPadNets: new Set(), padNets: new Set([TARGET]), pour: true,
      });
    }
    expect(result.pooledByLegacyRoot.get(ROOT)).toEqual(new Set([TARGET]));
  });

  test("keepout void excludes its via even inside the authored zone", () => {
    expect(provenVias({ ...frozenF9(), keepouts: [keepout(8, 8, 12, 12)] })).toBe(3);
  });

  test("zone holes and mechanical holes subtract real copper proof", () => {
    const input = frozenF9();
    const zone: PcbZone = { ...input.zones[0]!, id: "explicit-plane", region: { kind: "polygon",
      pointsMm: keepout(-10, -10, 80, 60).pointsMm, holesMm: [keepout(8, 8, 12, 12).pointsMm] } };
    expect(provenVias({ ...input, zones: [zone], nameBoundZones: [{ zone, netId: TARGET }] })).toBe(3);
    expect(provenVias({ ...input, freeHoles: [{ id: "mechanical", centerMm: { x: 10, y: 10 }, drillMm: 4, lockedAt: null }] })).toBe(3);
  });

  test("a split filled plane proves only the two pad-connected vias", () => {
    expect(provenVias({ ...frozenF9(), keepouts: [keepout(18, -20, 22, 80)] })).toBe(2);
  });

  test("via-attached fill without joined pads supplies no proof", () => {
    const input = frozenF9();
    const zone = { ...input.zones[0]!, padConnection: "none" as const };
    expect(provenVias({ ...input, zones: [zone], nameBoundZones: [{ zone, netId: TARGET }] })).toBe(0);
  });

  test("zero-root and unmapped-root islands cannot prove themselves", () => {
    for (const netId of [null, "foreign-root"]) {
      const input = frozenF9();
      expect(provenVias({ ...input, vias: input.vias.map((via) => ({ ...via, netId })) })).toBe(0);
    }
  });

  test("disabled, unadmitted, ambiguous and unknown zones cannot prove", () => {
    const input = frozenF9();
    const disabled = { ...input.zones[0]!, enabled: false };
    expect(provenVias({ ...input, zones: [disabled], nameBoundZones: [{ zone: disabled, netId: TARGET }] })).toBe(0);
    expect(provenVias({ ...input, nameBoundZones: [] })).toBe(0);
    expect(provenVias({ ...input, netNames: new Map([[TARGET, "GND"], ["other", "gnd"]]) })).toBe(0);
    const unknown = { ...input.zones[0]!, netName: "unknown" };
    expect(provenVias({ ...input, zones: [unknown], nameBoundZones: [{ zone: unknown, netId: TARGET }] })).toBe(0);
  });

  test("caller refusal and any zone/keepout derivation warning disable pour proof", () => {
    const input = frozenF9();
    expect(provenVias({ ...input, allowPourEvidence: false })).toBe(0);
    const bad = { ...keepout(8, 8, 12, 12), pointsMm: [] };
    const result = legacyContactEvidence({ ...input, keepouts: [bad] });
    expect(result.pourDisabledReasons).toContain("keepout_ring_invalid:void");
    expect([...result.evidenceByRef.values()].every((entry) => entry.padNets.size === 0)).toBe(true);
    expect(provenVias({ ...input, keepouts: [bad], vias: [viaAt(input)] })).toBe(1);
  });

  test("empty and failed fills supply no proof", () => {
    const input = frozenF9();
    expect(provenVias({ ...input, board: { ...input.board, outline: { kind: "rect", widthMm: 0, heightMm: 0, centerMm: { x: 0, y: 0 } } } })).toBe(0);
    const zone = { ...input.zones[0]!, clearanceMm: Number.POSITIVE_INFINITY };
    const obstacle: PcbFreePad = { id: "obstacle", centerMm: { x: 40, y: 40 }, rotationDeg: 0,
      padType: "smd", shape: "circle", widthMm: 1, heightMm: 1, drillMm: null, layer: "F.Cu", netId: null,
      solderMaskExpansionMm: null, solderPasteExpansionMm: null, lockedAt: null };
    expect(provenVias({ ...input, zones: [zone], nameBoundZones: [{ zone, netId: TARGET }], freePads: [obstacle] })).toBe(0);
  });

  test("root-bound zones affect exclusions but cannot contribute proof nodes", () => {
    const input = frozenF9();
    const other: PcbZone = { ...input.zones[0]!, id: "other-zone", netId: "other-root", netName: null,
      priority: 10, region: { kind: "polygon", pointsMm: keepout(8, 8, 12, 12).pointsMm } };
    expect(provenVias({ ...input, zones: [...input.zones, other],
      legacyRootIds: new Map([...input.legacyRootIds, ["other-root", "other-target"]]),
      netNames: new Map([...input.netNames, ["other-target", "VCC"]]) })).toBe(3);
    const onlyRoot = { ...input.zones[0]!, netId: ROOT, netName: null };
    expect(provenVias({ ...input, zones: [onlyRoot], nameBoundZones: [] })).toBe(0);
  });

  test("legacy class and scoped-rule references map to the hypothesis target", () => {
    const input = frozenF9();
    const obstacle: PcbFreePad = { id: "foreign", centerMm: { x: 12, y: 10 }, rotationDeg: 0,
      padType: "smd", shape: "circle", widthMm: 1, heightMm: 1, drillMm: null, layer: "F.Cu", netId: "foreign",
      solderMaskExpansionMm: null, solderPasteExpansionMm: null, lockedAt: null };
    expect(provenVias({ ...input, freePads: [obstacle] })).toBe(4);
    const scoped = { ...input.board, drcRules: [{ id: "legacy-pour", name: "Legacy clearance", enabled: true, priority: 1,
      scopes: [{ kind: "net" as const, netIds: [ROOT] }, { kind: "pairKind" as const, pairKinds: ["pourToPad" as const] }],
      constraint: { kind: "clearance" as const, mm: 3 } }] };
    expect(provenVias({ ...input, board: scoped, freePads: [obstacle] })).toBe(3);
    const classes = { ...input.board, netClasses: [...input.board.netClasses,
      { ...input.board.netClasses[0]!, id: "large-gap", name: "Large gap", clearanceMm: 3 }],
      perNetClassAssignments: { [ROOT]: "large-gap" } };
    expect(provenVias({ ...input, board: classes, freePads: [obstacle] })).toBe(3);
  });
});

describe("legacy identity direct physical evidence", () => {
  test("valid direct contact binds independently of an unknown historical root", () => {
    const input = bare();
    const via = { ...viaAt(input), netId: "stale-root" };
    const result = legacyContactEvidence({ ...input, vias: [via] });
    expect(result.evidenceByRef.get(copperReferenceKey("via", via.id))).toMatchObject({
      directPadNets: new Set([TARGET]), padNets: new Set([TARGET]), pour: false,
    });
    expect(result.pooledByLegacyRoot.get("stale-root")).toEqual(new Set([TARGET]));
  });

  test("invalid span, type and off-stackup copper cannot provide positive proof", () => {
    const input = bare();
    for (const change of [{ fromLayer: "In1.Cu", toLayer: "In2.Cu" }, { viaType: "blind" }]) {
      expect(provenVias({ ...input, vias: [{ ...viaAt(input), ...change } as PcbVia] })).toBe(0);
    }
    const trace = { ...traceAt(input), layer: "In1.Cu" as const };
    expect(legacyContactEvidence({ ...input, traces: [trace] }).evidenceByRef.get(copperReferenceKey("trace", trace.id))!.padNets.size).toBe(0);
    for (const drillMm of [Number.NaN, -1, 2]) expect(provenVias({ ...input, vias: [{ ...viaAt(input), drillMm }] })).toBe(0);
  });

  test("SHORT_EPS-only near contact does not become identity proof", () => {
    const input = bare();
    const pad = firstPad(input);
    const via = viaAt(input, { x: pad.bounds.minX - 0.4 - 0.00005, y: pad.center.y });
    expect(provenVias({ ...input, vias: [via] })).toBe(0);
  });

  test("duplicate raw IDs cannot borrow another holder's legacy label", () => {
    const input = bare();
    const valid = viaAt(input);
    const invalid = { ...valid, netId: "different-root", drillMm: -1 };
    for (const vias of [[valid, invalid], [invalid, valid]]) {
      expect(legacyContactEvidence({ ...input, vias }).evidenceByRef.get(copperReferenceKey("via", valid.id))!.padNets.size).toBe(0);
    }
  });

  test("inexact and invalid-layer schematic pads are not sources", () => {
    for (const shape of ["custom", "off-stackup"] as const) {
      const input = structuredClone(bare());
      const placement = input.placements[0]!;
      const preview = placement.footprint.preview!;
      const pad = preview.pads[0]!;
      const centerMm = firstPad(input).center;
      const changed = { ...placement, footprint: { ...placement.footprint, preview: { ...preview,
        pads: [{ ...pad, ...(shape === "custom" ? { shape: "custom" as typeof pad.shape } : { layer: "In1.Cu" as const }) }] } } };
      expect(provenVias({ ...input, placements: [changed], vias: [viaAt(input, centerMm)] })).toBe(0);
    }
  });

  test("a physical island touching two schematic nets conflicts", () => {
    const input = bare();
    const records = boardCopperRecords({ ...input, layerCount: 2 });
    const [a, b] = records.pads;
    expect(a && b).toBeTruthy();
    const padNetIds = new Map(input.padNetIds);
    const placement = input.placements[0]!;
    padNetIds.set(`${placement.id}|${placement.footprint.preview!.pads[1]!.number}`, "other-net");
    const trace = { ...traceAt(input), pointsNm: [a!.center, b!.center].map((point) => ({ x: Math.round(point.x * 1e6), y: Math.round(point.y * 1e6) })) };
    const result = legacyContactEvidence({ ...input, padNetIds, traces: [trace] });
    expect(result.evidenceByRef.get(copperReferenceKey("trace", trace.id))!.padNets).toEqual(new Set([TARGET, "other-net"]));
    expect(result.pooledByLegacyRoot.has(ROOT)).toBe(false);
  });

  test("disconnected copper on one historical root retains distinct evidence", () => {
    const input = bare();
    const near = viaAt(input);
    const far = { ...viaAt(input, { x: 60, y: 60 }), id: "far" };
    const result = legacyContactEvidence({ ...input, vias: [near, far] });
    expect(result.evidenceByRef.get(copperReferenceKey("via", near.id))!.padNets).toEqual(new Set([TARGET]));
    expect(result.evidenceByRef.get(copperReferenceKey("via", far.id))!.padNets).toEqual(new Set());
  });

  test("free-pad same-layer contact works without making it a schematic source", () => {
    const input = bare();
    const freePad: PcbFreePad = { id: "pad:with|separators", centerMm: firstPad(input).center, rotationDeg: 0, padType: "smd", shape: "circle", widthMm: 0.5, heightMm: 0.5,
      drillMm: null, layer: "F.Cu", netId: ROOT, solderMaskExpansionMm: null, solderPasteExpansionMm: null, lockedAt: null };
    const result = legacyContactEvidence({ ...input, freePads: [freePad] });
    expect(result.evidenceByRef.get(copperReferenceKey("freePad", freePad.id))!.padNets).toEqual(new Set([TARGET]));
    expect(legacyContactEvidence({ ...input, placements: [], freePads: [freePad] }).evidenceByRef.get(copperReferenceKey("freePad", freePad.id))!.padNets.size).toBe(0);
    expect(copperReferenceKey("trace", freePad.id)).not.toBe(copperReferenceKey("freePad", freePad.id));
  });

  test("unplated mechanical pads do not become sources or conduct between faces", () => {
    const input = bare();
    const template = input.placements[0]!;
    const make = (id: string, x: number, layer: "F.Cu" | "B.Cu"): PcbPlacedPart => ({
      ...structuredClone(template), id, positionMm: { x, y: 0 }, layer,
      footprint: { ...structuredClone(template.footprint), preview: { ...structuredClone(template.footprint.preview!),
        pads: [{ ...template.footprint.preview!.pads[0]!, centerMm: { x: 0, y: 0 }, layer: "F.Cu" }] } },
    });
    const a = make("a", 0, "F.Cu");
    const b = make("b", 10, "B.Cu");
    const holeBase = make("mechanical", 5, "F.Cu");
    const mechanical = { ...holeBase.footprint.preview!.pads[0]!, layer: "*.Cu" as const, widthMm: 2, heightMm: 2,
      drillDiameterMm: 0.5, plated: false };
    const hole = { ...holeBase, footprint: { ...holeBase.footprint,
      preview: { ...holeBase.footprint.preview!, pads: [mechanical] } } };
    const line = (id: string, x0: number, x1: number, layer: "F.Cu" | "B.Cu"): PcbTrace => ({
      id, layer, netId: ROOT, netClassId: "default", widthMm: 0.2, segmentMode: "manhattan-90",
      pointsNm: [{ x: x0 * 1e6, y: 0 }, { x: x1 * 1e6, y: 0 }],
    });
    const result = legacyContactEvidence({ ...input, placements: [a, b, hole],
      padNetIds: new Map([["a|1", TARGET], ["b|1", "other"], ["mechanical|1", "not-a-source"]]),
      traces: [line("front", 0, 5, "F.Cu"), line("back", 5, 10, "B.Cu")] });
    expect(result.evidenceByRef.get(copperReferenceKey("trace", "front"))!.padNets).toEqual(new Set([TARGET]));
    expect(result.evidenceByRef.get(copperReferenceKey("trace", "back"))!.padNets).toEqual(new Set(["other"]));
  });

  test("input remains unchanged and permutation produces identical evidence", () => {
    const input = frozenF9();
    const original = structuredClone(input);
    const first = legacyContactEvidence(input);
    expect(input).toEqual(original);
    const second = legacyContactEvidence({ ...input, vias: [...input.vias].reverse(), placements: [...input.placements].reverse(),
      netNames: new Map([...input.netNames].reverse()), legacyRootIds: new Map([...input.legacyRootIds].reverse()) });
    expect(second).toEqual(first);
  });
});
