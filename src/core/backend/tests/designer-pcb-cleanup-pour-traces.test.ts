/**
 * `pcb_cleanup_pour_traces` fill parity (zone/keepout contract §13.3). The
 * command deletes a same-net trace the plane already covers; a `copperPour`
 * keepout means the plane does NOT cover that spot, so the trace must survive.
 * Before S4 this site called `pourParamsForZone` without the keepouts and
 * deleted a trace whose copper the pour never replaced.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  PcbKeepoutRestrictions,
  PcbPointMm,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime(label: string): Promise<DesignerSDK> {
  isolateTestDb(label);
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  return moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
}

const SESSION = "cleanup-pour-session";
let commandSeq = 0;

function envelope(
  designId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  commandSeq += 1;
  return {
    commandId: `cleanup-cmd-${commandSeq}-${crypto.randomUUID()}`,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

const MM = 1_000_000;
/** Covers the trace below, with room to spare on either end. */
const KEEPOUT_RING: PcbPointMm[] = [
  { x: -6, y: -3 },
  { x: 6, y: -3 },
  { x: 6, y: 3 },
  { x: -6, y: 3 },
];
const POUR_ONLY: PcbKeepoutRestrictions = {
  tracks: false,
  vias: false,
  pads: false,
  copperPour: true,
  footprints: false,
};

/** A polygon zone that comfortably covers the trace below. */
const ZONE_RING: PcbPointMm[] = [
  { x: -8, y: -4 },
  { x: 8, y: -4 },
  { x: 8, y: 4 },
  { x: -8, y: 4 },
];

/**
 * A design with a GND pour on F.Cu — a board plane by default, or the explicit
 * polygon zone above — and one GND trace at the origin.
 */
async function poured(
  label: string,
  withKeepout: boolean,
  region: { kind: "board" } | { kind: "polygon"; pointsMm: PcbPointMm[] } = {
    kind: "board",
  },
) {
  const sdk = await createRuntime(label);
  const design = await sdk.createDesign({ name: label });

  // A label is the cheapest way to get a named schematic net.
  expect(
    (
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "upsert_label",
          text: "GND",
          positionNm: { x: 0, y: 0 },
        }),
      )
    ).ok,
  ).toBe(true);
  const netId = Object.entries(
    (await sdk.getPcbProjection(design.id))!.netNames,
  ).find(([, name]) => name === "GND")![0];

  expect(
    (
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_add_zone",
          layer: "F.Cu",
          net: { netId, netName: "GND" },
          region,
        }),
      )
    ).ok,
  ).toBe(true);

  expect(
    (
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_add_trace",
          layer: "F.Cu",
          pointsNm: [
            { x: -4 * MM, y: 0 },
            { x: 4 * MM, y: 0 },
          ],
          widthMm: 0.25,
          netId,
          netClassId: "default",
          segmentMode: "manhattan-90",
        }),
      )
    ).ok,
  ).toBe(true);

  if (withKeepout) {
    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_add_keepout",
            layers: ["F.Cu"],
            pointsMm: KEEPOUT_RING,
            restrictions: POUR_ONLY,
          }),
        )
      ).ok,
    ).toBe(true);
  }

  const before = (await sdk.getPcbProjection(design.id))!;
  expect(before.traces).toHaveLength(1);
  return { sdk, designId: design.id };
}

/** The zone of the island-removal scenario below — small, and pad-free. */
const ISLAND_ZONE_RING: PcbPointMm[] = [
  { x: -4, y: -4 },
  { x: 4, y: -4 },
  { x: 4, y: 4 },
  { x: -4, y: 4 },
];

/**
 * A GND polygon zone with `islandRemoval: "always"`, the given GND traces, and
 * optionally a GND free pad that anchors the island on its own.
 */
async function pouredWithIslandRemoval(
  label: string,
  traceSpans: ReadonlyArray<{ from: PcbPointMm; to: PcbPointMm }>,
  anchorPadMm: PcbPointMm | null,
) {
  const sdk = await createRuntime(label);
  const design = await sdk.createDesign({ name: label });

  expect(
    (
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "upsert_label",
          text: "GND",
          positionNm: { x: 0, y: 0 },
        }),
      )
    ).ok,
  ).toBe(true);
  const netId = Object.entries(
    (await sdk.getPcbProjection(design.id))!.netNames,
  ).find(([, name]) => name === "GND")![0];

  expect(
    (
      await sdk.dispatchCommand(
        design.id,
        envelope(design.id, {
          type: "pcb_add_zone",
          layer: "F.Cu",
          net: { netId, netName: "GND" },
          region: { kind: "polygon", pointsMm: [...ISLAND_ZONE_RING] },
          islandRemoval: "always",
        }),
      )
    ).ok,
  ).toBe(true);

  if (anchorPadMm) {
    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_add_free_pad",
            centerMm: anchorPadMm,
            rotationDeg: 0,
            padType: "smd",
            shape: "rect",
            widthMm: 1,
            heightMm: 1,
            layer: "F.Cu",
            netId,
          }),
        )
      ).ok,
    ).toBe(true);
  }

  for (const span of traceSpans) {
    expect(
      (
        await sdk.dispatchCommand(
          design.id,
          envelope(design.id, {
            type: "pcb_add_trace",
            layer: "F.Cu",
            pointsNm: [
              { x: span.from.x * MM, y: span.from.y * MM },
              { x: span.to.x * MM, y: span.to.y * MM },
            ],
            widthMm: 0.25,
            netId,
            netClassId: "default",
            segmentMode: "manhattan-90",
          }),
        )
      ).ok,
    ).toBe(true);
  }

  const before = (await sdk.getPcbProjection(design.id))!;
  expect(before.traces).toHaveLength(traceSpans.length);
  return { sdk, designId: design.id };
}

describe("pcb_cleanup_pour_traces", () => {
  test("a same-net trace the plane covers is deleted", async () => {
    const { sdk, designId } = await poured("cleanup-pour-plain", false);
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_cleanup_pour_traces" }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.traces).toHaveLength(0);
  });

  test("an explicit POLYGON zone cleans up too, not just the board plane", async () => {
    // Widened in S5 (copper-pour contract §9): a trace buried in an explicit
    // zone's copper is as redundant as one buried in a plane. Before S5 this
    // site iterated `sourceKind === "board"` only and left the trace behind.
    const { sdk, designId } = await poured("cleanup-pour-polygon", false, {
      kind: "polygon",
      pointsMm: ZONE_RING,
    });
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_cleanup_pour_traces" }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.traces).toHaveLength(0);
  });

  test("a trace inside a copperPour keepout survives — the plane never covers it", async () => {
    const { sdk, designId } = await poured("cleanup-pour-keepout", true);
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_cleanup_pour_traces" }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.traces).toHaveLength(1);
  });

  test("a trace that is the only member of its island survives", async () => {
    // The zone has no pads or vias, so the trace is the ONLY thing making the
    // island attached; with `islandRemoval: "always"` the island goes away the
    // moment the trace does. The pre-deletion fill says "covered", but deleting
    // the trace would take the copper with it — trace and pour both gone.
    const { sdk, designId } = await pouredWithIslandRemoval(
      "cleanup-pour-sole-member",
      [{ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }],
      null,
    );
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_cleanup_pour_traces" }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.traces).toHaveLength(1);
  });

  test("traces a pad-anchored island covers are all deleted", async () => {
    // The free pad keeps the island attached on its own, so removing one
    // candidate never removes the copper covering the other: the fixed-point
    // loop must converge with BOTH traces still deleted.
    const { sdk, designId } = await pouredWithIslandRemoval(
      "cleanup-pour-pad-anchored",
      [
        { from: { x: -2, y: -1 }, to: { x: 2, y: -1 } },
        { from: { x: -2, y: 1 }, to: { x: 2, y: 1 } },
      ],
      { x: 0, y: 3 },
    );
    expect(
      (
        await sdk.dispatchCommand(
          designId,
          envelope(designId, { type: "pcb_cleanup_pour_traces" }),
        )
      ).ok,
    ).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.traces).toHaveLength(0);
  });
});
