import { describe, expect, test } from "bun:test";
import { asEntityId } from "../../../shared/domain/ecs/entity";
import { queryEntities } from "../../../shared/domain/ecs/query";
import { EcsWorld } from "../../../shared/domain/ecs/world";

type TestComponent =
  | { type: "transform"; x: number; y: number }
  | { type: "part"; reference: string }
  | { type: "label"; text: string };

describe("EcsWorld", () => {
  test("stores and retrieves typed components", () => {
    const world = new EcsWorld<TestComponent>();
    const entityId = asEntityId("part:1");

    world.setComponent(entityId, { type: "part", reference: "U1" });
    world.setComponent(entityId, { type: "transform", x: 10, y: 20 });

    const part = world.getComponent(entityId, "part");
    const transform = world.getComponent(entityId, "transform");

    expect(part?.reference).toBe("U1");
    expect(transform?.x).toBe(10);
    expect(transform?.y).toBe(20);
  });

  test("removes empty entity after last component is deleted", () => {
    const world = new EcsWorld<TestComponent>();
    const entityId = asEntityId("label:1");

    world.setComponent(entityId, { type: "label", text: "NET_A" });
    expect(world.hasEntity(entityId)).toBe(true);

    world.removeComponent(entityId, "label");
    expect(world.hasEntity(entityId)).toBe(false);
  });
});

describe("queryEntities", () => {
  test("filters entities by required component types", () => {
    const world = new EcsWorld<TestComponent>();

    world.setComponent(asEntityId("part:1"), { type: "part", reference: "U1" });
    world.setComponent(asEntityId("part:1"), { type: "transform", x: 0, y: 0 });

    world.setComponent(asEntityId("part:2"), { type: "part", reference: "U2" });
    world.setComponent(asEntityId("label:1"), { type: "label", text: "GND" });

    const placeable = queryEntities(world, {
      require: ["part", "transform"],
    });

    expect(placeable).toHaveLength(1);
    expect(placeable[0]?.id).toBe(asEntityId("part:1"));
  });
});
