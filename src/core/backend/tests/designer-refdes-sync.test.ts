import { describe, expect, test } from "bun:test";
import {
  bootDesignerRuntime,
  dispatchOk,
  importCapacitorComponent,
  placeCapacitors,
  TEST_SESSION,
} from "./helpers/designer-runtime";

async function download(
  server: Awaited<ReturnType<typeof bootDesignerRuntime>>["server"],
  designId: string,
  file: string,
): Promise<string> {
  const response = await server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/exports/${file}`,
    ),
  );
  expect(response.status).toBe(200);
  return response.text();
}

async function patchBomRef(
  server: Awaited<ReturnType<typeof bootDesignerRuntime>>["server"],
  designId: string,
  refdes: string,
  patch: Record<string, unknown>,
): Promise<{ partId: string | null; refdes: string }> {
  const response = await server.fetch(
    new Request(
      `http://localhost/api/modules/designer/designs/${designId}/bom/refs/${refdes}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { override: { partId: string | null; refdes: string } };
  };
  return body.data.override;
}

/** The designators pnp.csv places, header dropped. */
async function placedRefs(
  server: Awaited<ReturnType<typeof bootDesignerRuntime>>["server"],
  designId: string,
): Promise<string[]> {
  const pnp = await download(server, designId, "pnp.csv");
  return pnp
    .split("\r\n")
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => line.split(",")[0]!)
    .sort();
}

describe("refdes rename reaches the PCB, BOM and CPL (T-217)", () => {
  test("rename → placement reference, BOM refs and pnp.csv follow; undo follows back", async () => {
    const { sdk, server } = await bootDesignerRuntime("refdes-sync");
    const design = await sdk.createDesign({ name: "Refdes sync" });
    const componentId = await importCapacitorComponent(server);
    const [c1, c2] = await placeCapacitors(sdk, design.id, componentId, 2);
    // The PCB projection creates the placements with the original refs.
    const seeded = (await sdk.getPcbProjection(design.id))!;
    const originalRef = seeded.placements.find((p) => p.partId === c1)!
      .reference;

    await dispatchOk(sdk, design.id, {
      type: "update_part_properties",
      partId: c1!,
      reference: "C77",
    });

    const pcb = (await sdk.getPcbProjection(design.id))!;
    expect(pcb.placements.find((p) => p.partId === c1)?.reference).toBe("C77");
    expect(pcb.placements).toHaveLength(2);

    const bom = (await sdk.getBomProjection(design.id))!;
    expect(bom.summary.partCount).toBe(2);
    const refs = bom.rows.flatMap((row) => row.refs.map((ref) => ref.refdes));
    expect(refs.sort()).toEqual(
      ["C77", pcb.placements.find((p) => p.partId === c2)!.reference].sort(),
    );
    expect(refs).not.toContain(originalRef);

    const jlc = await download(server, design.id, "bom-jlc.csv");
    expect(jlc).toContain("C77");
    expect(jlc).not.toContain(`${originalRef},`);
    const pnp = await download(server, design.id, "pnp.csv");
    expect(pnp).toContain("C77");
    expect(pnp.split("\r\n").filter((line) => line.length > 0)).toHaveLength(3);

    // Undo is a schematic-only patch; the placement is derived, so it follows.
    await sdk.undo(design.id, TEST_SESSION);
    const undone = (await sdk.getPcbProjection(design.id))!;
    expect(undone.placements.find((p) => p.partId === c1)?.reference).toBe(
      originalRef,
    );
  });

  test("BOM overrides follow the part across a rename, its undo/redo and a reused refdes", async () => {
    const { sdk, server } = await bootDesignerRuntime("refdes-sync-overrides");
    const design = await sdk.createDesign({ name: "Override sync" });
    const componentId = await importCapacitorComponent(server);
    const [c1, c2] = await placeCapacitors(sdk, design.id, componentId, 2);
    const schematic = (await sdk.getSchematicProjection(design.id))!;
    const refOf = (id: string) =>
      schematic.parts.find((part) => part.id === id)!.reference;
    const [ref1, ref2] = [refOf(c1!), refOf(c2!)];
    await sdk.getPcbProjection(design.id);

    const written = await patchBomRef(server, design.id, ref1, {
      dnp: true,
      lcscPartNumber: "C12345",
    });
    expect(written).toMatchObject({ partId: c1, refdes: ref1 });
    expect(await placedRefs(server, design.id)).toEqual([ref2]);

    const rowOf = async (partId: string) => {
      const bom = (await sdk.getBomProjection(design.id))!;
      return bom.rows.find((row) => row.refs.some((ref) => ref.partId === partId))!;
    };
    const expectDnpUnder = async (ref: string) => {
      const row = await rowOf(c1!);
      expect(row.refdesList).toBe(ref);
      expect(row.dnp).toBe(true);
      expect(row.lcscPartNumber).toBe("C12345");
      expect(await placedRefs(server, design.id)).toEqual([ref2]);
    };

    await dispatchOk(sdk, design.id, {
      type: "update_part_properties",
      partId: c1!,
      reference: "C77",
    });
    await expectDnpUnder("C77");

    // Undo/redo replay ECS patches past every command handler.
    await sdk.undo(design.id, TEST_SESSION);
    await expectDnpUnder(ref1);
    await sdk.redo(design.id, TEST_SESSION);
    await expectDnpUnder("C77");

    // C2 takes C1's old reference: C1's override (still written under that
    // reference) must not reach it, and a new override for it must not collide.
    await dispatchOk(sdk, design.id, {
      type: "update_part_properties",
      partId: c2!,
      reference: ref1,
    });
    const reused = await rowOf(c2!);
    expect(reused.refdesList).toBe(ref1);
    expect(reused.dnp).toBe(false);
    expect(reused.lcscPartNumber).toBeNull();
    expect(await placedRefs(server, design.id)).toEqual([ref1]);

    const second = await patchBomRef(server, design.id, ref1, {
      lcscPartNumber: "C999",
    });
    expect(second).toMatchObject({ partId: c2, refdes: ref1 });
    expect((await rowOf(c2!)).lcscPartNumber).toBe("C999");
    expect(await placedRefs(server, design.id)).toEqual([ref1]);
    const renamed = await rowOf(c1!);
    expect(renamed.refdesList).toBe("C77");
    expect(renamed.lcscPartNumber).toBe("C12345");
    expect(renamed.dnp).toBe(true);
  });
});
