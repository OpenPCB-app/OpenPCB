import { expect, test } from "vitest";
import type { DesignerPcbProjection, DrcReport, DrcRuleCode, PcbZone } from "../../../../../sdks";
import { NON_OVERRIDABLE } from "../../../../../shared/drc/severity";
import { buildDrcMarkers, resolveAnchorLabel } from "./drc-labels";

const ZONE_ID = "zone-123456";

function projection(netNames: Record<string, string>, zone?: Partial<PcbZone>): DesignerPcbProjection {
  return {
    netNames,
    zones: zone ? [{ id: ZONE_ID, name: null, netId: null, netName: null, ...zone }] : [],
  } as DesignerPcbProjection;
}

test("zone labels keep the user's explicit zone name first", () => {
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection({ live: "NEW" }, {
    name: "Shield", netId: "live", netName: "OLD",
  }))).toBe("zone Shield");
});

test("zone labels follow a renamed durable net rather than its stored hint", () => {
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection({ live: "NEW", other: "OLD" }, {
    netId: "live", netName: "OLD",
  }))).toBe("zone NEW");
});

test("a stale zone ID never labels itself through a matching old hint", () => {
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection({ live: "OLD" }, {
    netId: "retired", netName: "OLD",
  }))).toBe("zone zone-1");
});

test("only ID-less zones may display an unresolved legacy name hint", () => {
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection({}, {
    netId: null, netName: "UNRESOLVED",
  }))).toBe("zone UNRESOLVED");
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection({}, {}))).toBe("zone zone-1");
});

test("net, pair and zone labels ignore inherited net-name properties", () => {
  const names = Object.create({ stale: "INHERITED" }) as Record<string, string>;
  expect(resolveAnchorLabel({ kind: "net", netId: "stale" }, projection(names))).toBe("net stale");
  expect(resolveAnchorLabel({ kind: "diffPair", pairId: "pair", pNetId: "stale", nNetId: "constructor" }, projection(names)))
    .toBe("pair stal/cons");
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection(names, { netId: "stale", netName: "OLD" })))
    .toBe("zone zone-1");
});

test.each(["constructor", "__proto__", "toString"])("net, pair and zone labels preserve intentional own %s entries", (id) => {
  const names = { [id]: "OWN", partner: "PARTNER" };
  expect(resolveAnchorLabel({ kind: "net", netId: id }, projection(names))).toBe("OWN");
  expect(resolveAnchorLabel({ kind: "diffPair", pairId: "pair", pNetId: id, nNetId: "partner" }, projection(names)))
    .toBe("pair OWN/PARTNER");
  expect(resolveAnchorLabel({ kind: "zone", zoneId: ZONE_ID }, projection(names, { netId: id, netName: "OLD" })))
    .toBe("zone OWN");
});

test("stored waiver IDs cannot hide safety-critical canvas markers", () => {
  const codes: DrcRuleCode[] = [...NON_OVERRIDABLE, "TRACE_WIDTH_MIN"];
  const report: DrcReport = {
    designId: "board", revision: 1, countsByCode: {},
    summary: { errors: codes.length, warnings: 0, infos: 0 },
    violations: codes.map((code) => ({
      id: code, code, ruleClass: "structural", severity: "error",
      message: code, anchors: [], locationMm: { x: 1, y: 2 },
    })),
  };
  const markers = buildDrcMarkers(report, null, null, codes);
  expect(markers.map((marker) => marker.id)).toEqual([...NON_OVERRIDABLE]);
  expect(buildDrcMarkers(report, null, null, []).map((marker) => marker.id))
    .toEqual(codes);
});
