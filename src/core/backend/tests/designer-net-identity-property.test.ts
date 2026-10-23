import { describe, expect, test } from "bun:test";
import type { DesignerCommand, DesignerSchematicProjection } from "../../../sdks/designer";
import { readNetIdentityRetired } from "../../../modules/designer/backend/net-identity/state-store";
import { getSharedDb } from "../db/sqlite-client";
import { assertIdentityInvariants, assertIdentityTransition, assertObservedBinderPermutation, observeIdentity } from "./helpers/net-identity-property-checks";
import { createRoutedIdentityFixture, openPropertyRuntime } from "./helpers/net-identity-property-runtime";
import { send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();
type Pins = Awaited<ReturnType<typeof createRoutedIdentityFixture>>["pins"];

function random(seed: number): () => number {
  let value = seed + 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 0x1_0000_0000; };
}

function wireCommand(projection: DesignerSchematicProjection, pins: Pins, add: boolean, choose: () => number): DesignerCommand {
  const keys = (first: string, second: string) => JSON.stringify([pins.findIndex((pin) => pin.pinId === first), pins.findIndex((pin) => pin.pinId === second)].sort());
  const existing = [...projection.wires].sort((first, second) => keys(first.sourcePinId, first.targetPinId) < keys(second.sourcePinId, second.targetPinId) ? -1 : 1);
  const pairs = pins.flatMap((first, index) => pins.slice(index + 1).map((second) => [first, second] as const));
  const missing = pairs.filter(([first, second]) => !existing.some((wire) => keys(wire.sourcePinId, wire.targetPinId) === keys(first.pinId, second.pinId)));
  if (!add && existing.length || !missing.length) {
    const wire = existing[Math.floor(choose() * existing.length)]!;
    return { type: "delete_entity", entityKind: "wire", entityId: wire.id };
  }
  const [first, second] = missing[Math.floor(choose() * missing.length)]!;
  return { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId };
}

function nextCommand(projection: DesignerSchematicProjection, pins: Pins, seed: number, step: number, choose: () => number): DesignerCommand {
  const index = Math.floor(choose() * pins.length), part = projection.parts.find((part) => part.id === pins[index]!.partId)!;
  switch (step % 10) {
    case 0: return { type: "move_part", partId: part.id, positionNm: { x: (index % 2 ? 10 : 0) * 1_000_000 + (Math.floor(choose() * 5) - 2) * 1_000_000,
      y: (index < 2 ? 0 : 20) * 1_000_000 + (Math.floor(choose() * 5) - 2) * 1_000_000 }, confirmMerge: true };
    case 1: return { type: "rotate_part", partId: part.id, rotationDeg: [0, 90, 180, 270][(part.rotationDeg / 90 + 1) % 4] as 0 | 90 | 180 | 270, confirmMerge: true };
    case 2: return { type: "mirror_part", partId: part.id, mirrored: !part.mirrored, confirmMerge: true };
    case 3: return { type: "update_part_properties", partId: part.id, reference: `R${seed * 100 + step + 1}` };
    case 4: return wireCommand(projection, pins, false, choose);
    case 5: return { type: "upsert_label", text: `LABEL_${seed}_${step}`, positionNm: { ...part.pins[0]!.worldPositionNm }, confirmMerge: true };
    case 8: return wireCommand(projection, pins, true, choose);
    case 9: return { type: "delete_entity", entityKind: "label", entityId: [...projection.labels].sort((a, b) => a.text < b.text ? -1 : 1)[0]!.id };
    default: throw new Error("history steps must use store undo/redo");
  }
}

describe("100 seeded actual-store identity sequences", () => {
  for (let seed = 0; seed < 100; seed++) test(`seed ${seed}: 25 accepted mixed steps with reboot every 10`, async () => {
    const fixture = await createRoutedIdentityFixture(), { designId, pins } = fixture, choose = random(seed);
    let runtime = fixture.runtime, before = await observeIdentity(runtime, designId);
    const issued = new Set([...before.state.active.map((net) => net.id), ...readNetIdentityRetired(getSharedDb(), designId).map((net) => net.netId)]);
    assertIdentityInvariants(before, before.state.nextSeq);
    for (let step = 0; step < 25; step++) {
      const history = step % 10 === 6 || step % 10 === 7;
      try {
        if (step % 10 === 6) expect((await runtime.store.undo(designId, "property")).ok).toBe(true);
        else if (step % 10 === 7) expect((await runtime.store.redo(designId, "property")).ok).toBe(true);
        else await send(runtime, designId, nextCommand(before.schematic, pins, seed, step, choose), "property");
        const after = await observeIdentity(runtime, designId);
        assertIdentityTransition(before, after, issued, history);
        if (step % 5 === 4) assertObservedBinderPermutation(after);
        before = after;
        if ((step + 1) % 10 === 0) {
          runtime = await openPropertyRuntime(runtime.file);
          const reopened = await observeIdentity(runtime, designId);
          expect(reopened.state).toEqual(before.state); expect(reopened.references).toBe(before.references);
          assertIdentityInvariants(reopened, before.state.nextSeq); before = reopened;
        }
      } catch (error) {
        throw new Error(`Identity property failed at seed=${seed}, step=${step}, operation=${step % 10}`, { cause: error });
      }
    }
    expect(runtime.errors).toEqual([]);
  }, 30_000);
});
