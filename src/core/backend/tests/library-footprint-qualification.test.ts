import { beforeAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  LibraryFootprintPlacementSnapshot,
  LibraryFootprintQualification,
  LibrarySDK,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { classifyFootprintGeometry } from "../../../modules/library/backend/qualification/classify";
import {
  classifyPlacedFootprints,
  getFootprintQualifications,
} from "../../../modules/library/backend/qualification/footprint-qualifications";
import { padGeometryFingerprint } from "../../../modules/library/backend/qualification/pad-fingerprint";
import type { QualificationInputs } from "../../../modules/library/backend/qualification/classify";
import { LEGACY_IPC_FINGERPRINTS } from "../../../modules/library/shared/legacy-ipc-fingerprints.generated";
import type { FootprintRenderModel } from "../../../shared/rendering/types";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { MentionRegistry } from "../mentions";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  deleteFootprintRow,
  footprintDataJson,
  insertFootprintRow,
  LEGACY_GENERATOR_INSTALLED,
  legacyIpcPreview,
  overlappingPreview,
  PIN_HEADER_1X2,
  plainPreview,
  PROVENANCE,
  previewOf,
  rectPad,
  templatePreview,
  updateFootprintRow,
} from "./helpers/footprint-qualification";
import { pinHeaderGenerator, templatePayload } from "./helpers/template-footprint";

// Legacy pads only exist while the legacy generator (pinned v0.1.3) is installed.
const legacyTest = test.if(LEGACY_GENERATOR_INSTALLED);

let sdk: LibrarySDK;
let server: ReturnType<typeof createHttpServer>;

beforeAll(async () => {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `fp-qualification-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  sdk = moduleRuntime.getSdkRegistry().resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
});

function fp(preview: FootprintRenderModel): string {
  return padGeometryFingerprint(preview.pads);
}

/** An accepted SOT-23/least block whose only fingerprint is `preview`'s pads. */
function acceptedFor(preview: FootprintRenderModel): QualificationInputs {
  return { accepted: { sot: { 2: { "SOT-23|least": fp(preview) } } } };
}

function seedRow(provenance: Record<string, unknown>, preview: FootprintRenderModel | null): string {
  return insertFootprintRow(crypto.randomUUID(), footprintDataJson(provenance, preview));
}

function rowQualification(id: string, inputs: QualificationInputs = {}): LibraryFootprintQualification {
  const out = getFootprintQualifications(getSharedDb(), [id], inputs);
  expect(Object.keys(out)).toEqual([id]);
  return out[id]!;
}

function snapshot(
  footprintId: string,
  preview: FootprintRenderModel,
  generation?: unknown,
): LibraryFootprintPlacementSnapshot {
  const snap: Record<string, unknown> = {
    footprintId,
    name: preview.name,
    mountType: null,
    sourceHash: null,
    preview,
  };
  if (generation !== undefined) snap.generation = generation;
  return snap as unknown as LibraryFootprintPlacementSnapshot;
}

function placedQualification(
  snap: LibraryFootprintPlacementSnapshot,
  inputs: QualificationInputs = {},
): LibraryFootprintQualification {
  return classifyPlacedFootprints(getSharedDb(), [{ key: "p", snapshot: snap }], inputs).p!;
}

describe("legacy deny-list fixtures", () => {
  legacyTest("the pinned generator's chip 0603 preview is on the legacy deny-list", () => {
    expect(LEGACY_IPC_FINGERPRINTS.has(fp(legacyIpcPreview("chip", "0603", "nominal")))).toBe(true);
  });
});

describe("row classification (stored pads + provenance claim)", () => {
  test("legacy generated row (no generator identity) is flagged", () => {
    const q = rowQualification(seedRow(PROVENANCE.legacyGenerated, plainPreview()));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("legacy-generated");
    expect(q.generatorLabel).toBeNull();
    expect(q.reason).toContain("Generated before generator provenance was recorded");
    expect(q.reason).toContain("No qualified IPC generator is installed yet");
  });

  legacyTest("post-d11ce92 IPC row carrying legacy pads is flagged with its preset label", () => {
    const q = rowQualification(
      seedRow(PROVENANCE.ipc("chip", "0603", "nominal", { ipcRevision: 2 }), legacyIpcPreview("chip", "0603", "nominal")),
    );
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("ipc7351b");
    expect(q.generatorLabel).toBe("0603 · nominal");
    expect(q.reason).toContain("legacy IPC-7351B Chip generator");
    expect(q.reason).toContain("No qualified generator for Chip is installed yet");
  });

  legacyTest("legacy pads get the replace-with-IPC remedy once the family is available", () => {
    const id = seedRow(PROVENANCE.ipc("chip", "0603", "nominal"), legacyIpcPreview("chip", "0603", "nominal"));
    const q = rowQualification(id, {
      installed: { chip: { revision: 2, qualified: true } },
      accepted: { chip: { 2: { "0603|nominal": "not-these-pads" } } },
    });
    expect(q.status).toBe("unqualified-generator");
    expect(q.reason).toContain("Replace it in the Library (Change footprint → IPC package)");
  });

  test("pads in an accepted block qualify; the same row without the block does not", () => {
    const preview = plainPreview();
    const id = seedRow(PROVENANCE.ipc("sot", "SOT-23", "least"), preview);
    expect(rowQualification(id, acceptedFor(preview))).toEqual({
      status: "qualified",
      reason: null,
      generatorKind: "ipc7351b",
      generatorLabel: "SOT-23 · least",
    });
    const unaccepted = rowQualification(id);
    expect(unaccepted.status).toBe("unqualified-generator");
    expect(unaccepted.generatorKind).toBe("ipc7351b");
    expect(unaccepted.reason).toContain("has not passed qualification");
  });

  test("a clean template row qualifies", () => {
    const q = rowQualification(
      seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), templatePreview("pin-header", PIN_HEADER_1X2)),
    );
    expect(q).toEqual({
      status: "qualified",
      reason: null,
      generatorKind: "template",
      generatorLabel: "pin-header",
    });
  });

  test("an overlapping template row is flagged with the pads that overlap", () => {
    const q = rowQualification(seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview()));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("template");
    expect(q.reason).toContain("pads 1 and 2 overlap");
    expect(q.reason).toContain("Regenerate it with non-overlapping parameters.");
  });

  test("a template row with unreadable pads is flagged, not trusted", () => {
    const preview = { ...plainPreview(), pads: [{ number: "1" }] } as unknown as FootprintRenderModel;
    const q = rowQualification(seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), preview));
    expect(q.status).toBe("unqualified-generator");
    expect(q.reason).toContain("its pads cannot be read");
  });

  for (const [label, provenance] of [
    ["drawn", PROVENANCE.drawn],
    ["KiCad import", PROVENANCE.kicad],
    ["CoreLibrary", PROVENANCE.coreLibrary],
  ] as const) {
    test(`${label} row is not generated`, () => {
      expect(rowQualification(seedRow(provenance, plainPreview()))).toEqual({
        status: "not-generated",
        reason: null,
        generatorKind: null,
        generatorLabel: null,
      });
    });
  }

  test("malformed data_json reads as not generated", () => {
    const id = insertFootprintRow(crypto.randomUUID(), "{not json");
    expect(rowQualification(id).status).toBe("not-generated");
  });

  legacyTest("a relabelled drawn row carrying legacy pads is flagged (rule 2 ignores claims)", () => {
    const q = rowQualification(seedRow(PROVENANCE.drawn, legacyIpcPreview("chip", "0603", "nominal")));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("ipc7351b");
    expect(q.generatorLabel).toBe("0603 · nominal");
  });

  test("unknown ids are absent and duplicate ids collapse", () => {
    const id = seedRow(PROVENANCE.drawn, plainPreview());
    const out = getFootprintQualifications(getSharedDb(), [id, id, "missing-footprint"]);
    expect(Object.keys(out)).toEqual([id]);
  });

  test("the SDK classifies rows with the shipped tables", async () => {
    const legacy = seedRow(PROVENANCE.legacyGenerated, plainPreview());
    const drawn = seedRow(PROVENANCE.drawn, plainPreview());
    const out = await sdk.getFootprintQualifications([legacy, drawn]);
    expect(out[legacy]?.status).toBe("unqualified-generator");
    expect(out[drawn]?.status).toBe("not-generated");
  });
});

describe("snapshot classification (placed pads)", () => {
  test("stamped overlapping template is flagged after its row is deleted", () => {
    const id = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview());
    deleteFootprintRow(id);
    const q = placedQualification(snapshot(id, overlappingPreview(), { kind: "template", label: "pin-header" }));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("template");
    expect(q.reason).toContain("overlap");
  });

  test("stamped clean template qualifies without any row", () => {
    const preview = templatePreview("pin-header", PIN_HEADER_1X2);
    const q = placedQualification(snapshot("no-such-row", preview, { kind: "template", label: "pin-header" }));
    expect(q.status).toBe("qualified");
    expect(q.generatorLabel).toBe("pin-header");
  });

  test("a stamp cannot buy qualification: IPC stamp on arbitrary pads is flagged", () => {
    const q = placedQualification(snapshot("no-such-row", plainPreview(), { kind: "ipc7351b", label: "SOT-23 · least" }));
    expect(q.status).toBe("unqualified-generator");
    expect(q.reason).toContain("has not passed qualification");
    expect(q.reason).toContain("No qualified generator for SOT is installed yet");
  });

  legacyTest("unstamped legacy pads are flagged after the row is deleted", () => {
    const preview = legacyIpcPreview("chip", "0603", "nominal");
    const id = seedRow(PROVENANCE.ipc("chip", "0603", "nominal"), preview);
    deleteFootprintRow(id);
    const q = placedQualification(snapshot(id, preview));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorLabel).toBe("0603 · nominal");
  });

  test("unstamped snapshot whose generated row was deleted is the documented residual", () => {
    const id = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview());
    deleteFootprintRow(id);
    expect(placedQualification(snapshot(id, overlappingPreview())).status).toBe("not-generated");
  });

  test("unstamped snapshot adopts its unchanged generated row's claim", () => {
    const clean = templatePreview("pin-header", PIN_HEADER_1X2);
    const cleanId = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), clean);
    expect(placedQualification(snapshot(cleanId, clean))).toMatchObject({
      status: "qualified",
      generatorKind: "template",
    });
    const badId = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview());
    const bad = placedQualification(snapshot(badId, overlappingPreview()));
    expect(bad.status).toBe("unqualified-generator");
    expect(bad.reason).toContain("overlap");
  });

  test("unstamped snapshot of a row updated in place no longer matches", () => {
    const placed = templatePreview("pin-header", PIN_HEADER_1X2);
    const id = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), placed);
    updateFootprintRow(
      id,
      footprintDataJson(PROVENANCE.template("pin-header", PIN_HEADER_1X2), previewOf([rectPad("1", -3, 0), rectPad("2", 3, 0)])),
    );
    const q = placedQualification(snapshot(id, placed));
    expect(q.status).toBe("unqualified-generator");
    expect(q.generatorKind).toBe("template");
    expect(q.reason).toContain("no longer matches its generated library footprint");
  });

  test("unstamped snapshot of a non-generated row is not generated", () => {
    const id = seedRow(PROVENANCE.drawn, overlappingPreview());
    expect(placedQualification(snapshot(id, overlappingPreview())).status).toBe("not-generated");
  });

  test("a malformed stamp counts as absent, so the row lookup still applies", () => {
    const id = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), overlappingPreview());
    const q = placedQualification(snapshot(id, overlappingPreview(), { kind: "drawn", label: 7 }));
    expect(q.status).toBe("unqualified-generator");
    expect(q.reason).toContain("overlap");
  });

  test("revoking an accepted block re-flags placed parts (stamped and unstamped)", () => {
    const preview = plainPreview();
    const id = seedRow(PROVENANCE.ipc("sot", "SOT-23", "least"), preview);
    const stamped = snapshot(id, preview, { kind: "ipc7351b", label: "SOT-23 · least" });
    const unstamped = snapshot(id, preview);
    for (const snap of [stamped, unstamped]) {
      expect(placedQualification(snap, acceptedFor(preview)).status).toBe("qualified");
      const revoked = placedQualification(snap, { accepted: {} });
      expect(revoked.status).toBe("unqualified-generator");
      expect(revoked.generatorKind).toBe("ipc7351b");
    }
  });

  test("one call classifies many keys and only looks up stampless leftovers", () => {
    const clean = templatePreview("pin-header", PIN_HEADER_1X2);
    const rowId = seedRow(PROVENANCE.template("pin-header", PIN_HEADER_1X2), clean);
    const out = classifyPlacedFootprints(getSharedDb(), [
      { key: "a", snapshot: snapshot(rowId, clean) },
      { key: "b", snapshot: snapshot(rowId, clean, { kind: "template", label: "pin-header" }) },
      { key: "c", snapshot: snapshot("gone", plainPreview()) },
      { key: "d", snapshot: null as unknown as LibraryFootprintPlacementSnapshot },
    ]);
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.status]))).toEqual({
      a: "qualified",
      b: "qualified",
      c: "not-generated",
      d: "not-generated",
    });
  });

  test("the classifier entry point applies the rules to bare pads", () => {
    expect(classifyFootprintGeometry({ pads: null, generation: null }).status).toBe("not-generated");
    expect(
      classifyFootprintGeometry({ pads: null, generation: { kind: "template", label: "pin-header" } }).status,
    ).toBe("unqualified-generator");
  });
});

describe("snapshot stamp writer", () => {
  async function call(method: string, url: string, body?: unknown) {
    const res = await server.fetch(
      new Request(`http://localhost/api/modules/library${url}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as any };
  }

  /** A drawn two-pin component on the placeholder footprint. */
  async function placeholderComponent(name: string): Promise<string> {
    const pins = ["1", "2"].map((n, i) => ({
      id: `p${n}`,
      name: n,
      number: n,
      electricalType: "passive",
      positionMm: { x: i * 2.54, y: 0 },
      lengthMm: 1,
      rotationDeg: 0,
      unit: 1,
      hidden: false,
    }));
    const created = await call("POST", "/imports/drawn", {
      drawnSymbol: {
        source: { name, unitCount: 1, referenceText: "J?", valueText: name, pins, graphics: [], warnings: [] },
        referencePrefix: "J",
      },
      footprintMode: "none",
      component: { name, description: "stamp writer" },
    });
    expect(created.status).toBe(201);
    return created.json.data.componentId as string;
  }

  async function headerComponent(): Promise<{ componentId: string; footprintId: string }> {
    const componentId = await placeholderComponent("QualHdr");
    const generator = pinHeaderGenerator(1, 2);
    const added = await call("POST", `/components/${componentId}/footprints`, {
      mode: "generated",
      source: templatePayload(generator),
      generator,
    });
    expect(added.status).toBe(201);
    return { componentId, footprintId: added.json.data.footprintId as string };
  }

  test("snapshots of generated rows carry the generation stamp and derivationHash", async () => {
    const { componentId, footprintId } = await headerComponent();
    const placement = await sdk.resolveComponentForPlacement(componentId);
    expect(placement?.footprint.generation).toEqual({ kind: "template", label: "pin-header" });
    expect(placement?.footprint.derivationHash).toBeNull();
    const variant = placement?.footprintVariants.find((v) => v.footprintId === footprintId);
    expect(variant?.qualification?.status).toBe("qualified");

    const row = getSharedSqlite()
      .query<{ data_json: string }, [string]>("SELECT data_json FROM library_footprints WHERE id = ?")
      .get(footprintId)!;
    const data = JSON.parse(row.data_json);
    data.provenance.derivationHash = "derived-1";
    updateFootprintRow(footprintId, JSON.stringify(data));
    const after = await sdk.resolveComponentForPlacement(componentId);
    expect(after?.footprint.derivationHash).toBe("derived-1");
    const refs = await sdk.getDefaultFootprintRefs([componentId]);
    expect(refs[componentId]).toMatchObject({ footprintId, derivationHash: "derived-1" });
  });

  test("snapshots of non-generated rows (the placeholder) carry no stamp", async () => {
    const componentId = await placeholderComponent("QualPlain");
    const placement = await sdk.resolveComponentForPlacement(componentId);
    expect(placement?.footprint.footprintId).toBe("fp-no-footprint-yet");
    expect(placement?.footprint).not.toHaveProperty("generation");
    const refs = await sdk.getDefaultFootprintRefs([componentId]);
    expect(refs[componentId]?.derivationHash).toBeNull();
  });
});
