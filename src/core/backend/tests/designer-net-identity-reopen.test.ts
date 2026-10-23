import { expect, test } from "bun:test";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { checkNetBinding } from "../../../shared/drc/checks/net-binding";
import { isDurableNetIdOf } from "../../../modules/designer/backend/net-identity/types";
import { openPropertyRuntime, rawReferenceSignature } from "./helpers/net-identity-property-runtime";
import { identityState, placed, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();

test("lone pin label promotion orphans old nc copper with exact pin-owner suggestion through reopen/undo/redo", async () => {
  let runtime = await openPropertyRuntime();
  const design = await runtime.store.createDesign(), pin = await placed(runtime, design.id, 0, 0), loneId = `nc:${pin.pinId}`;
  const via = await send(runtime, design.id, { type: "pcb_add_via", netId: loneId, netClassId: "default", centerMm: { x: 2, y: 2 }, legality: "off" }, "PCB");
  const references = rawReferenceSignature(design.id);
  await send(runtime, design.id, { type: "upsert_label", text: "PROMOTED", positionNm: { x: 0, y: 0 }, confirmMerge: true }, "label");
  const durable = identityState(design.id).active[0]!.id, watermark = identityState(design.id).nextSeq;
  expect(isDurableNetIdOf(durable, design.id)).toBe(true);
  runtime = await openPropertyRuntime(runtime.file);
  const promoted = (await runtime.store.getPcbProjection(design.id))!;
  expect(promoted.netIdentity).toMatchObject({ orphanedCopperCount: 1, groups: [{ netId: loneId, reason: "retired", successorNetIds: [durable], suggestedNetId: durable }] });
  expect(checkNetBinding(buildDrcContext(promoted)).map((draft) => draft.anchors)).toEqual([[{ kind: "via", viaId: via.createdEntityId! }]]);
  expect(rawReferenceSignature(design.id)).toBe(references);
  expect((await runtime.store.undo(design.id, "label")).ok).toBe(true);
  expect(identityState(design.id).active).toEqual([]);
  expect((await runtime.store.getPcbProjection(design.id))!.netIdentity!.orphanedCopperCount).toBe(0);
  runtime = await openPropertyRuntime(runtime.file);
  expect((await runtime.store.redo(design.id, "label")).ok).toBe(true);
  expect(identityState(design.id).active[0]!.id).toBe(durable);
  expect(identityState(design.id).nextSeq).toBeGreaterThanOrEqual(watermark);
  expect(rawReferenceSignature(design.id)).toBe(references);
});
