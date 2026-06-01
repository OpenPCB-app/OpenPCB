import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK, ErcReport } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

// ── Regression: pins the ERC engine output AT THE SDK + HTTP-ROUTE BOUNDARY
// for the representative cases (connected net, floating power_in → error,
// floating input → warning, no_connect → clean) using a REAL schematic
// projection derived from placed parts and wires. The pure runErc unit tests
// already cover the connected-semantics matrix; this guards against the
// stricter `netIsConnected` silently shifting the results the ERC dock and
// DRC-visible callers consume, and that all three entry points
// (runErc, getProjectionAndErc, GET …/erc) agree at one revision.

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  const dbFile = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  process.env.OPENPCB_DB_PATH = dbFile;
}

async function createRuntimeAndServer() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();

  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });

  return { moduleRuntime, server };
}

/**
 * Import a drawn component whose first four pins exercise every ERC-relevant
 * electrical type: power_in (error when floating), input (warning when
 * floating), output (never an unconnected-pin violation), no_connect (clean
 * when isolated). A trailing passive pin gives us a benign endpoint to wire to.
 */
async function importErcProbeComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const pinDef = (
    id: string,
    number: string,
    name: string,
    electricalType: string,
    x: number,
  ) => ({
    id,
    name,
    number,
    electricalType,
    positionMm: { x, y: 0 },
    lengthMm: 1,
    rotationDeg: 0,
    unit: 1,
    hidden: false,
  });

  const response = await server.fetch(
    new Request("http://localhost/api/modules/library/imports/drawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drawnSymbol: {
          source: {
            name: "ErcProbe",
            unitCount: 1,
            referenceText: "U?",
            valueText: "ErcProbe",
            pins: [
              pinDef("pin-pwr", "1", "VCC", "power_in", -6),
              pinDef("pin-in", "2", "IN", "input", -3),
              pinDef("pin-out", "3", "OUT", "output", 3),
              pinDef("pin-nc", "4", "NC", "no_connect", 6),
              pinDef("pin-pass", "5", "P", "passive", 0),
            ],
            graphics: [
              {
                unit: 1,
                graphic: {
                  kind: "rect",
                  x: -1,
                  y: -0.8,
                  width: 2,
                  height: 1.6,
                  fill: "none",
                  strokeWidthMm: 0.12,
                },
              },
            ],
            warnings: [],
          },
          referencePrefix: "U",
        },
        footprintMode: "none",
        component: {
          name: "ERC Probe Component",
          description: "Used by designer ERC SDK/route regression test",
        },
      }),
    }),
  );

  expect(response.status).toBe(201);
  const body = (await response.json()) as { data?: { componentId?: string } };
  const componentId = body.data?.componentId;
  if (!componentId) {
    throw new Error("Drawn import must return component id");
  }
  return componentId;
}

function codesFor(
  report: ErcReport,
  pinId: string,
): Array<{ code: string; severity: string }> {
  return report.violations
    .filter((v) => v.anchors.some((a) => a.kind === "pin" && a.pinId === pinId))
    .map((v) => ({ code: v.code, severity: v.severity }));
}

async function ercViaRoute(
  server: ReturnType<typeof createHttpServer>,
  designId: string,
): Promise<ErcReport> {
  const res = await server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/erc`,
    ),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data?: { report?: ErcReport } };
  if (!body.data?.report) {
    throw new Error("ERC route must return a report");
  }
  return body.data.report;
}

describe("designer ERC SDK + route regression", () => {
  test("pins representative ERC verdicts across SDK and HTTP route", async () => {
    isolateTestDb("designer-erc-sdk");
    const { moduleRuntime, server } = await createRuntimeAndServer();
    const componentId = await importErcProbeComponent(server);
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

    const design = await designerSdk.createDesign({ name: "ERC regression" });

    // Place two probe parts; everything starts floating.
    const placeA = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "erc",
      aggregateId: design.id,
      baseRevision: 0,
      issuedAt: Date.now(),
      command: { type: "place_part", componentId, positionNm: { x: 0, y: 0 } },
    });
    expect(placeA.ok).toBe(true);

    const placeB = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "erc",
      aggregateId: design.id,
      baseRevision: 1,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId,
        positionNm: { x: 40_000_000, y: 0 },
      },
    });
    expect(placeB.ok).toBe(true);

    const placed = await designerSdk.getSchematicProjection(design.id);
    const partA = placed?.parts[0];
    const partB = placed?.parts[1];
    if (!partA || !partB) throw new Error("Expected two placed parts");

    const pinOf = (part: NonNullable<typeof partA>, etype: string): string => {
      const p = part.pins.find((pin) => pin.electricalType === etype);
      if (!p) throw new Error(`Missing ${etype} pin`);
      return p.id;
    };

    const aPwr = pinOf(partA, "power_in");
    const aIn = pinOf(partA, "input");
    const aOut = pinOf(partA, "output");
    const aNc = pinOf(partA, "no_connect");

    // ── All floating: power_in error, input warning, output/NC clean. ──
    const floating = await designerSdk.runErc(design.id);
    if (!floating) throw new Error("runErc returned null for placed design");

    expect(codesFor(floating, aPwr)).toEqual([
      { code: "UNCONNECTED_INPUT_PIN", severity: "error" },
    ]);
    expect(codesFor(floating, aIn)).toEqual([
      { code: "UNCONNECTED_INPUT_PIN", severity: "warning" },
    ]);
    expect(codesFor(floating, aOut)).toEqual([]);
    // no_connect pin, isolated, is legal → no violation.
    expect(codesFor(floating, aNc)).toEqual([]);

    // Two probe parts → 2 floating power_in (error) + 2 floating input (warning).
    expect(floating.summary.errors).toBe(2);
    expect(floating.summary.warnings).toBe(2);

    // getProjectionAndErc must return the SAME report at the SAME revision,
    // computed off a single projection fetch.
    const bundle = await designerSdk.getProjectionAndErc(design.id);
    if (!bundle) throw new Error("getProjectionAndErc returned null");
    expect(bundle.erc).toEqual(floating);
    expect(bundle.projection.revision).toBe(floating.revision);
    expect(bundle.erc.revision).toBe(bundle.projection.revision);

    // HTTP route agrees with the SDK.
    expect(await ercViaRoute(server, design.id)).toEqual(floating);

    // ── Connect part A's power_in + input to part B's passive pin via wires,
    //    making them genuinely connected (≥2-pin nets). They must clear. ──
    const bPass = pinOf(partB, "passive");
    const bOut = pinOf(partB, "output");

    const wire1 = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "erc",
      aggregateId: design.id,
      baseRevision: 2,
      issuedAt: Date.now(),
      command: { type: "create_wire", sourcePinId: aPwr, targetPinId: bPass },
    });
    expect(wire1.ok).toBe(true);

    const wire2 = await designerSdk.dispatchCommand(design.id, {
      commandId: crypto.randomUUID(),
      sessionId: "erc",
      aggregateId: design.id,
      baseRevision: 3,
      issuedAt: Date.now(),
      command: { type: "create_wire", sourcePinId: aIn, targetPinId: bOut },
    });
    expect(wire2.ok).toBe(true);

    const connected = await designerSdk.getProjectionAndErc(design.id);
    if (!connected) throw new Error("getProjectionAndErc returned null");

    // Now-connected pins on part A clear their unconnected violations.
    expect(codesFor(connected.erc, aPwr)).toEqual([]);
    expect(codesFor(connected.erc, aIn)).toEqual([]);
    // Part B's still-floating power_in/input remain flagged.
    const bPwr = pinOf(partB, "power_in");
    const bIn = pinOf(partB, "input");
    expect(codesFor(connected.erc, bPwr)).toEqual([
      { code: "UNCONNECTED_INPUT_PIN", severity: "error" },
    ]);
    expect(codesFor(connected.erc, bIn)).toEqual([
      { code: "UNCONNECTED_INPUT_PIN", severity: "warning" },
    ]);

    // One error + one warning left after wiring.
    expect(connected.erc.summary.errors).toBe(1);
    expect(connected.erc.summary.warnings).toBe(1);

    // Same-revision invariant + route agreement still hold post-mutation.
    expect(connected.erc.revision).toBe(connected.projection.revision);
    expect(await ercViaRoute(server, design.id)).toEqual(connected.erc);
  });
});
