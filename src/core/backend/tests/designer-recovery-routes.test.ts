// OPENPCB-103: the recovery head, the compat stamp and the BOM binding guard — the
// server half of crash-durable edits that are not plain command envelopes.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import {
  DESIGNER_COMMAND_EPOCH,
  DESIGNER_SCHEMA_HEAD,
} from "../../../modules/designer/backend/recovery-compat";
import type { DesignerSDK } from "../../../sdks";
import {
  bootDesignerRuntime,
  dispatchOk,
  importCapacitorComponent,
  placeCapacitors,
  type TestServer,
} from "./helpers/designer-runtime";

const BASE = "http://localhost/api/modules/designer";

/** A success envelope or an RFC 7807 problem — only the fields the tests read. */
interface ApiBody {
  type?: string;
  title?: string;
  data?: { head?: unknown; compat?: unknown; override?: unknown };
}

async function getJson(server: TestServer, url: string): Promise<{ status: number; body: ApiBody }> {
  const response = await server.fetch(new Request(`${BASE}${url}`));
  return { status: response.status, body: await response.json() };
}

async function patchBom(
  server: TestServer,
  designId: string,
  refdes: string,
  body: unknown,
): Promise<{ status: number; body: ApiBody }> {
  const response = await server.fetch(
    new Request(`${BASE}/designs/${designId}/bom/refs/${encodeURIComponent(refdes)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

/** Three capacitors; returns their part ids keyed by their current reference. */
async function boardWithParts(label: string): Promise<{
  sdk: DesignerSDK;
  server: TestServer;
  designId: string;
  byRef: Record<string, string>;
}> {
  const { sdk, server } = await bootDesignerRuntime(label);
  const componentId = await importCapacitorComponent(server);
  const design = await sdk.createDesign({ name: label });
  await placeCapacitors(sdk, design.id, componentId, 3);
  const parts = (await sdk.getSchematicProjection(design.id))!.parts;
  const byRef = Object.fromEntries(parts.map((part) => [part.reference, part.id]));
  return { sdk, server, designId: design.id, byRef };
}

describe("recovery head", () => {
  test("reports the head revision, and the part a refdes binds to only when asked", async () => {
    const { server, designId, byRef } = await boardWithParts("p103-head");
    const [ref] = Object.keys(byRef).sort();
    const plain = await getJson(server, `/designs/${designId}/recovery-head`);
    expect(plain.status).toBe(200);
    expect(plain.body.data?.head).toEqual({ headRevision: 3 });

    const bound = await getJson(server, `/designs/${designId}/recovery-head?refdes=${ref}`);
    expect(bound.body.data?.head).toEqual({ headRevision: 3, refdesPartId: byRef[ref!] });

    const unbound = await getJson(server, `/designs/${designId}/recovery-head?refdes=TP99`);
    expect(unbound.body.data?.head).toEqual({ headRevision: 3, refdesPartId: null });
  });

  test("an unknown design is the typed 404; an empty refdes is a 400", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-head-404");
    const missing = await getJson(server, "/designs/no-such-design/recovery-head");
    expect(missing.status).toBe(404);
    expect(missing.body.type).toBe("https://openpcb.dev/problems/designer/design-not-found");
    const design = await sdk.createDesign({ name: "Empty refdes" });
    expect((await getJson(server, `/designs/${design.id}/recovery-head?refdes=`)).status).toBe(400);
  });
});

describe("recovery compat", () => {
  test("serves the schema head and command epoch", async () => {
    const { server } = await bootDesignerRuntime("p103-compat");
    const compat = await getJson(server, "/recovery/compat");
    expect(compat.status).toBe(200);
    expect(compat.body.data?.compat).toEqual({
      schemaHead: DESIGNER_SCHEMA_HEAD,
      commandEpoch: DESIGNER_COMMAND_EPOCH,
    });
  });

  test("the schema head is the last designer migration — every migration must bump it", () => {
    const dir = path.resolve(import.meta.dir, "../../../modules/designer/backend/migrations");
    const last = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .at(-1);
    expect(DESIGNER_SCHEMA_HEAD).toBe(last!.replace(/\.sql$/, ""));
  });
});

describe("BOM override binding guard", () => {
  test("a matching expectedPartId writes; a re-annotated refdes is a typed 409 with no change", async () => {
    const { sdk, server, designId, byRef } = await boardWithParts("p103-bom-guard");
    const [first, , third] = Object.keys(byRef).sort();
    const editedPartId = byRef[first!]!;

    const ok = await patchBom(server, designId, first!, {
      manufacturer: "Murata",
      expectedPartId: editedPartId,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data?.override).toMatchObject({ partId: editedPartId, manufacturer: "Murata" });

    // Re-annotate: the edited part moves to a fresh reference, the third part takes its old one.
    await dispatchOk(sdk, designId, {
      type: "update_part_properties",
      partId: editedPartId,
      reference: "C9",
    });
    await dispatchOk(sdk, designId, {
      type: "update_part_properties",
      partId: byRef[third!]!,
      reference: first!,
    });
    const before = await sdk.getBomProjection(designId);

    const refused = await patchBom(server, designId, first!, {
      manufacturer: "Yageo",
      expectedPartId: editedPartId,
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      type: "https://openpcb.dev/problems/designer/bom-binding-changed",
      title: "BOM Binding Changed",
    });
    expect(await sdk.getBomProjection(designId)).toEqual(before);
  });

  test("without expectedPartId the write binds whatever carries the refdes (legacy)", async () => {
    const { server, designId, byRef } = await boardWithParts("p103-bom-legacy");
    const [first] = Object.keys(byRef).sort();
    const legacy = await patchBom(server, designId, first!, { notes: "legacy" });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data?.override).toMatchObject({ partId: byRef[first!], notes: "legacy" });
  });

  test("expectedPartId null guards a reference no part carries; a bad type is a 400", async () => {
    const { server, designId, byRef } = await boardWithParts("p103-bom-null");
    const unbound = await patchBom(server, designId, "TP1", { notes: "pcb only", expectedPartId: null });
    expect(unbound.status).toBe(200);
    expect(unbound.body.data?.override).toMatchObject({ partId: null, notes: "pcb only" });

    const [first] = Object.keys(byRef).sort();
    const bound = await patchBom(server, designId, first!, { notes: "x", expectedPartId: null });
    expect(bound.status).toBe(409);
    expect((await patchBom(server, designId, first!, { notes: "x", expectedPartId: 7 })).status).toBe(400);
  });
});
