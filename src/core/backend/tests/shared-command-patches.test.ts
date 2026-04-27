import { describe, expect, test } from "bun:test";
import { applyPatches } from "../../../shared/domain/commands/apply";
import { CommandHistory } from "../../../shared/domain/commands/history";
import { invertPatchBatch } from "../../../shared/domain/commands/invert";
import type { EcsPatch } from "../../../shared/domain/commands/patch";
import { asEntityId } from "../../../shared/domain/ecs/entity";
import { EcsWorld } from "../../../shared/domain/ecs/world";

type TestComponent =
  | { type: "part"; reference: string }
  | { type: "transform"; x: number; y: number };

describe("patch application and inversion", () => {
  test("applies forward patches and reverts them with inverse batch", () => {
    const world = new EcsWorld<TestComponent>();
    const entityId = asEntityId("part:1");

    const forward: EcsPatch<TestComponent>[] = [
      {
        kind: "component.set",
        entityId,
        component: { type: "part", reference: "U1" },
      },
      {
        kind: "component.set",
        entityId,
        component: { type: "transform", x: 100, y: 200 },
      },
    ];

    const applied = applyPatches(world, forward);
    expect(world.getComponent(entityId, "part")?.reference).toBe("U1");
    expect(world.getComponent(entityId, "transform")?.x).toBe(100);

    const inverse = invertPatchBatch(applied);
    applyPatches(world, inverse);

    expect(world.hasEntity(entityId)).toBe(false);
  });
});

describe("CommandHistory", () => {
  test("tracks undo and redo stacks", () => {
    const history = new CommandHistory<{ type: "demo" }, TestComponent>(10);
    const entry = {
      envelope: {
        commandId: "cmd-1",
        sessionId: "session-1",
        aggregateId: "design-1",
        baseRevision: 1,
        issuedAt: Date.now(),
        command: { type: "demo" as const },
      },
      revision: 2,
      forwardPatches: [],
      inversePatches: [],
      createdEntityId: null,
      timestamp: Date.now(),
    };

    history.record(entry);
    expect(history.canUndo()).toBe(true);

    const undone = history.consumeUndo();
    expect(undone?.envelope.commandId).toBe("cmd-1");
    expect(history.canRedo()).toBe(true);

    const redone = history.consumeRedo();
    expect(redone?.revision).toBe(2);
    expect(history.canUndo()).toBe(true);
  });
});
