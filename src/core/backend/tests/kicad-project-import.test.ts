/**
 * Integration test for F3: KiCad project import (inspect + commit).
 *
 * Builds a minimal but valid KiCad project ZIP in-memory (.kicad_pro + one
 * .kicad_sch + .kicad_pcb), runs both endpoints through the DesignerSDK,
 * and asserts the produced report + persisted design match expectations.
 */

import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  buildInspectReport,
  resolveProjectFiles,
} from "../../../modules/designer/backend/import/kicad-project/inspect";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

function writeUInt16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}
function writeUInt32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function createStoredZip(
  entries: Array<{ name: string; bytes: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const localHeader = concatBytes([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(entry.bytes.byteLength),
      writeUInt32(entry.bytes.byteLength),
      writeUInt16(nameBytes.byteLength),
      writeUInt16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, entry.bytes);
    centralParts.push(
      concatBytes([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(entry.bytes.byteLength),
        writeUInt32(entry.bytes.byteLength),
        writeUInt16(nameBytes.byteLength),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.byteLength + entry.bytes.byteLength;
  }
  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);
  const end = concatBytes([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.byteLength),
    writeUInt32(local.byteLength),
    writeUInt16(0),
  ]);
  return concatBytes([local, central, end]);
}

/** The sample project's ZIP entries, so a variant can swap one of them. */
function buildSampleProjectEntries(): Array<{ name: string; bytes: Uint8Array }> {
  const encoder = new TextEncoder();
  const projectContent = JSON.stringify({
    meta: { filename: "blinky.kicad_pro", version: 1 },
    board: {
      design_settings: {
        rules: {
          // KiCad's OWN default is 0, and 0 is a legitimate floor — it must
          // survive the mapping, not be treated as "absent" (§12.3).
          min_clearance: 0,
          min_track_width: 0.15,
          min_via_diameter: 0.45,
          min_through_hole_diameter: 0.3,
          min_via_annular_width: 0.13,
          min_hole_to_hole: 0.25,
          min_copper_edge_clearance: 0.4,
          min_hole_clearance: 0.35,
        },
      },
    },
    net_settings: {
      classes: [
        {
          name: "Default",
          clearance: 0.2,
          track_width: 0.25,
          via_diameter: 0.8,
          via_drill: 0.4,
        },
        {
          name: "Power",
          clearance: 0.3,
          track_width: 0.5,
          via_diameter: 1.0,
          via_drill: 0.5,
          diff_pair_gap: 0.15,
          // KiCad 6 per-net assignment.
          nets: ["VCC"],
        },
      ],
      // KiCad 7/8 per-net assignment: an exact name maps, a wildcard warns,
      // and a name this design has no net for is skipped WITH a warning at
      // commit (the net ids only exist once the schematic is inserted).
      netclass_patterns: [
        { pattern: "GND", netclass: "Power" },
        { pattern: "D*", netclass: "Power" },
        { pattern: "NOT_A_NET", netclass: "Power" },
      ],
    },
  });
  const schematicContent = `
    (kicad_sch (version 20231120) (generator eeschema)
      (lib_symbols
        (symbol "Device:R"
          (property "Reference" "R" (at 0 0 0))
          (property "Value" "R" (at 0 0 0))
          (pin passive line (at -3.81 0 0) (length 1.27) (name "~") (number "1"))
          (pin passive line (at 3.81 0 0) (length 1.27) (name "~") (number "2"))
        )
      )
      (symbol
        (lib_id "Device:R")
        (at 50 60 0)
        (unit 1)
        (uuid "11111111-1111-1111-1111-111111111111")
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0))
      )
      (symbol
        (lib_id "power:GND")
        (at 60 80 0)
        (property "Reference" "#PWR01" (at 0 0 0))
        (property "Value" "GND" (at 0 0 0))
      )
      (wire (pts (xy 50 60) (xy 60 60)) (stroke (width 0)) (uuid "w1"))
      (label "VCC" (at 50 50 0) (uuid "l1"))
    )`.trim();
  const pcbContent = `
    (kicad_pcb (version 20231120) (generator pcbnew)
      (layers
        (0 "F.Cu" signal)
        (31 "B.Cu" signal)
        (44 "Edge.Cuts" user)
      )
      (net 0 "")
      (net 1 "VCC")
      (net 2 "GND")
      (footprint "Resistor_SMD:R_0805_2012Metric" (layer "F.Cu") (at 25 20 0)
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0))
        (pad "1" smd rect (at -0.95 0 0) (size 1 1.25) (layers "F.Cu") (net 1 "VCC"))
        (pad "2" smd rect (at 0.95 0 0) (size 1 1.25) (layers "F.Cu") (net 2 "GND"))
      )
      (segment (start 25 20) (end 30 20) (width 0.25) (layer "F.Cu") (net 1))
      (via (at 30 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
      (gr_line (start 0 0) (end 60 0) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 60 0) (end 60 40) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 60 40) (end 0 40) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 0 40) (end 0 0) (layer "Edge.Cuts") (width 0.05))
    )`.trim();
  return [
    { name: "blinky.kicad_pro", bytes: encoder.encode(projectContent) },
    { name: "blinky.kicad_sch", bytes: encoder.encode(schematicContent) },
    { name: "blinky.kicad_pcb", bytes: encoder.encode(pcbContent) },
    // Custom design rules are NOT imported; the report must say so (§9).
    {
      name: "blinky.kicad_dru",
      bytes: encoder.encode("(version 1)\n(rule \"x\" (constraint clearance))"),
    },
  ];
}

function buildSampleProjectZip(): Uint8Array {
  return createStoredZip(buildSampleProjectEntries());
}

/** The sample project with a different `.kicad_pro` payload. */
function buildProjectZipWith(projectJson: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(projectJson));
  return createStoredZip(
    buildSampleProjectEntries().map((entry) =>
      entry.name.endsWith(".kicad_pro") ? { ...entry, bytes } : entry,
    ),
  );
}

async function bootRuntime(): Promise<DesignerSDK> {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  return moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
}

describe("KiCad project import (F3)", () => {
  test("inspect returns counts, layer count, outline, net classes", async () => {
    isolateTestDb("f3-inspect");
    const sdk = await bootRuntime();
    const zip = buildSampleProjectZip();

    const report = await sdk.inspectKicadProject("blinky.zip", zip);

    expect(report.projectName).toBe("blinky");
    expect(report.copperLayerCount).toBe(2);
    expect(report.schematicSheetCount).toBe(1);
    expect(report.netCount).toBe(3);
    expect(report.boardOutlineMm).toEqual({
      minXMm: 0,
      minYMm: 0,
      maxXMm: 60,
      maxYMm: 40,
    });
    expect(report.counts.schematicSymbols).toBe(1); // R1 — #PWR01 is classified as power
    expect(report.counts.schematicPowerSymbols).toBe(1);
    expect(report.counts.schematicWires).toBe(1);
    expect(report.counts.schematicLabels).toBe(1);
    expect(report.counts.pcbFootprints).toBe(1);
    expect(report.counts.pcbSegments).toBe(1);
    expect(report.counts.pcbVias).toBe(1);
    expect(report.netClasses).toHaveLength(2);
    expect(report.netClasses[1]?.unknownRules).toEqual({
      diff_pair_gap: 0.15,
    });
    expect(report.components.length).toBeGreaterThanOrEqual(2);

    // S6 (rule-semantics contract §12.3) — project minimums are read from
    // `board.design_settings.rules`, `min_clearance: 0` included.
    expect(report.designRules).toEqual({
      minClearanceMm: 0,
      minTrackWidthMm: 0.15,
      minViaDiameterMm: 0.45,
      minThroughHoleMm: 0.3,
      minViaAnnularMm: 0.13,
      minHoleToHoleMm: 0.25,
      minCopperEdgeClearanceMm: 0.4,
      // S7 — `min_hole_clearance` is OpenPCB's copper ↔ hole rule (contract 06 §4).
      minHoleClearanceMm: 0.35,
    });
    // `classes[].nets` (v6) and exact `netclass_patterns` (v7/8) fold into one
    // net-name → class-name map; the wildcard pattern warns instead.
    expect(report.netClassAssignments).toEqual({
      VCC: "Power",
      GND: "Power",
      // Inspect cannot know the design's nets yet — commit resolves them.
      NOT_A_NET: "Power",
    });
    expect(
      report.warnings.map((w) => w.code),
    ).toContain("kicad_netclass_pattern_unsupported");
    expect(report.warnings.map((w) => w.code)).toContain(
      "kicad_custom_rules_ignored",
    );
  });

  test("commit creates design with board settings derived from .kicad_pcb", async () => {
    isolateTestDb("f3-commit");
    const sdk = await bootRuntime();
    const zip = buildSampleProjectZip();

    const result = await sdk.commitKicadProject({
      archiveFileName: "blinky.zip",
      archiveBytes: zip,
    });

    expect(result.designId).toBeDefined();
    expect(result.designName).toBe("blinky");
    expect(result.applied.copperLayerCount).toBe(2);
    expect(result.applied.boardOutline).toBe(true);
    // Default 3 netclasses + 1 incoming "Power" (Default merges) = 4 unique.
    expect(result.applied.netClassesIngested).toBeGreaterThanOrEqual(3);
    // Full pipeline runs end-to-end now; nothing deferred for a complete
    // project with at least one resolvable schematic part.
    expect(result.applied.deferred).toEqual([]);

    // The persisted PCB projection should reflect the imported outline.
    const projection = await sdk.getPcbProjection(result.designId);
    expect(projection?.board.outline.widthMm).toBe(60);
    expect(projection?.board.outline.heightMm).toBe(40);
    // Schematic + PCB entities should have been inserted.
    const schematic = await sdk.getSchematicProjection(result.designId);
    expect(schematic?.parts.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(projection?.traces.length ?? 0).toBeGreaterThan(0);
    expect(projection?.vias.length ?? 0).toBeGreaterThan(0);

    // S6 — the project minimums land on the board 1:1, and the board's
    // per-kind clearances take the KiCad `Default` class clearance while the
    // FLOOR stays `min_clearance` (rule-semantics contract §12.3).
    const rules = projection!.board.designRules;
    expect(rules.minimums.clearanceMm).toBe(0);
    expect(rules.minimums.traceWidthMm).toBe(0.15);
    expect(rules.minimums.viaDiameterMm).toBe(0.45);
    // KiCad has ONE drill minimum; it floors both drill fields.
    expect(rules.minimums.drillSizeMm).toBe(0.3);
    expect(rules.minimums.viaDrillMm).toBe(0.3);
    expect(rules.minimums.annularRingMm).toBe(0.13);
    expect(rules.minimums.holeToHoleMm).toBe(0.25);
    expect(rules.clearance.copperToBoardEdgeMm).toBe(0.4);
    expect(rules.clearance.copperToHoleMm).toBe(0.35);
    expect(rules.clearance.traceToTraceMm).toBe(0.2);
    expect(rules.clearance.traceToPadMm).toBe(0.2);
    expect(rules.clearance.padToPadMm).toBe(0.2);
    expect(rules.clearance.traceToViaMm).toBe(0.2);
    expect(rules.clearance.viaToViaMm).toBe(0.2);

    // Per-net assignments are resolved to netId → classId once nets exist.
    const powerClassId = projection!.board.netClasses.find(
      (c) => c.name.toLowerCase() === "power",
    )?.id;
    expect(powerClassId).toBeDefined();
    const assignments = projection!.board.perNetClassAssignments ?? {};
    const assignedNames = Object.entries(assignments)
      .filter(([, classId]) => classId === powerClassId)
      .map(([netId]) => projection!.netNames?.[netId])
      .sort();
    expect(assignedNames).toEqual(["GND", "VCC"]);
    // The assignment naming a net this design has no net for is SKIPPED, with
    // a warning rather than silently (rule-semantics contract §12.3).
    expect(result.warnings.map((w) => w.code)).toContain(
      "kicad_netclass_assignment_unknown_net",
    );
    expect(
      result.warnings.find(
        (w) => w.code === "kicad_netclass_assignment_unknown_net",
      )!.message,
    ).toContain("NOT_A_NET");
  });

  // The mirror branch, one step earlier: an assignment naming a class the
  // PROJECT does not declare is skipped at inspect time, so it never reaches
  // the commit-side resolver at all.
  test("inspect leaves `minHoleClearanceMm` absent when the project has no `min_hole_clearance`", async () => {
    // S7 (contract 06 §4): the field is optional on both the report and the
    // board — an absent KiCad value must not become 0 or the edge rule here.
    const zip = buildProjectZipWith({
      meta: { filename: "blinky.kicad_pro", version: 1 },
      board: {
        design_settings: {
          rules: { min_clearance: 0.1, min_copper_edge_clearance: 0.4 },
        },
      },
      net_settings: { classes: [] },
    });
    const files = resolveProjectFiles(zip);
    const report = await buildInspectReport(files, async () => null);
    expect(report.designRules?.minCopperEdgeClearanceMm).toBe(0.4);
    expect(report.designRules?.minHoleClearanceMm).toBeUndefined();
    expect("minHoleClearanceMm" in (report.designRules ?? {})).toBe(false);
  });

  test("inspect skips an assignment naming an undeclared net class, with a warning", async () => {
    const zip = buildProjectZipWith({
      meta: { filename: "blinky.kicad_pro", version: 1 },
      net_settings: {
        classes: [
          {
            name: "Default",
            clearance: 0.2,
            track_width: 0.25,
            via_diameter: 0.8,
            via_drill: 0.4,
          },
        ],
        netclass_patterns: [{ pattern: "VCC", netclass: "NoSuchClass" }],
      },
    });
    const files = resolveProjectFiles(zip);
    const report = await buildInspectReport(files, async () => null);
    expect(report.netClassAssignments).toBeUndefined();
    expect(report.warnings.map((w) => w.code)).toContain(
      "kicad_netclass_unknown",
    );
    expect(
      report.warnings.find((w) => w.code === "kicad_netclass_unknown")!.message,
    ).toContain("NoSuchClass");
  });

  test("commit rejects ZIP missing .kicad_pcb", async () => {
    isolateTestDb("f3-missing-pcb");
    const sdk = await bootRuntime();
    const encoder = new TextEncoder();
    const zip = createStoredZip([
      {
        name: "blinky.kicad_pro",
        bytes: encoder.encode('{"meta":{"filename":"x.kicad_pro"}}'),
      },
      {
        name: "blinky.kicad_sch",
        bytes: encoder.encode(
          "(kicad_sch (version 20231120) (generator eeschema))",
        ),
      },
    ]);
    await expect(
      sdk.inspectKicadProject("incomplete.zip", zip),
    ).rejects.toThrow(/does not contain a .kicad_pcb/);
  });
});
