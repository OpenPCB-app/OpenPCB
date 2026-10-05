import { expect, test } from "bun:test";
import {
  bootDesignerRuntime,
  dispatchOk,
  envelope,
  postCommand,
  TEST_SESSION,
} from "./helpers/designer-runtime";
import { getSharedSqlite } from "../db/sqlite-client";

test("HTTP schematic batch advances once and Undo/Redo restores exact geometry", async () => {
  const { sdk, server } = await bootDesignerRuntime("h07-schematic");
  const design = await sdk.createDesign({ name: "H07 atomic geometry" });
  const a = await dispatchOk(sdk, design.id, {
    type: "place_gnd_port",
    positionNm: { x: 0, y: 0 },
  });
  const b = await dispatchOk(sdk, design.id, {
    type: "place_gnd_port",
    positionNm: { x: 1270000, y: 2540000 },
  });
  const before = (await sdk.getSchematicProjection(design.id))!;
  const history = await sdk.getHistory(design.id, TEST_SESSION);
  const response = await postCommand(
    server,
    design.id,
    envelope(design.id, before.revision, {
      type: "batch_commands",
      commands: [
        {
          type: "move_primitive",
          primitiveId: a.createdEntityId!,
          positionNm: { x: 3810000, y: -1270000 },
        },
        {
          type: "move_primitive",
          primitiveId: b.createdEntityId!,
          positionNm: { x: -2540000, y: 5080000 },
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  const after = (await sdk.getSchematicProjection(design.id))!;
  expect(after.revision).toBe(before.revision + 1);
  expect((await sdk.getHistory(design.id, TEST_SESSION)).undoDepth).toBe(
    history.undoDepth + 1,
  );
  expect((await sdk.undo(design.id, TEST_SESSION)).ok).toBe(true);
  const byId = (items: typeof before.primitives) =>
    Object.fromEntries(items.map((item) => [item.id, item]));
  expect(
    byId((await sdk.getSchematicProjection(design.id))!.primitives),
  ).toEqual(byId(before.primitives));
  expect((await sdk.redo(design.id, TEST_SESSION)).ok).toBe(true);
  expect(
    byId((await sdk.getSchematicProjection(design.id))!.primitives),
  ).toEqual(byId(after.primitives));
});

test("a rejected late batch step rolls back geometry, revision and history", async () => {
  const { sdk, server } = await bootDesignerRuntime("h07-rollback");
  const design = await sdk.createDesign({ name: "H07 rollback" });
  const a = await dispatchOk(sdk, design.id, {
    type: "place_gnd_port",
    positionNm: { x: 0, y: 0 },
  });
  const before = await sdk.getSchematicProjection(design.id);
  const history = await sdk.getHistory(design.id, TEST_SESSION);
  const response = await postCommand(
    server,
    design.id,
    envelope(design.id, a.revision, {
      type: "batch_commands",
      commands: [
        {
          type: "move_primitive",
          primitiveId: a.createdEntityId!,
          positionNm: { x: 3810000, y: -1270000 },
        },
        {
          type: "move_primitive",
          primitiveId: "missing",
          positionNm: { x: 0, y: 0 },
        },
      ],
    }),
  );
  expect(await response.json()).toMatchObject({
    data: { result: { ok: false, code: "PRIMITIVE_NOT_FOUND" } },
  });
  expect(await sdk.getSchematicProjection(design.id)).toEqual(before);
  expect(await sdk.getHistory(design.id, TEST_SESSION)).toEqual(history);
});

test("duplicate command ID applies once and stale revisions never modify copper", async () => {
  const { sdk } = await bootDesignerRuntime("h07-pcb-revision");
  const design = await sdk.createDesign({ name: "H07 PCB" });
  const command = envelope(design.id, 0, {
    type: "pcb_add_free_hole",
    centerMm: { x: 12.7, y: -2.54 },
    drillMm: 1,
  });
  const first = await sdk.dispatchCommand(design.id, command);
  expect(first.ok).toBe(true);
  expect(await sdk.dispatchCommand(design.id, command)).toMatchObject({
    ...first,
    idempotent: true,
  });
  const before = await sdk.getPcbProjection(design.id);
  const stale = await sdk.dispatchCommand(
    design.id,
    envelope(design.id, 0, {
      type: "pcb_add_free_hole",
      centerMm: { x: 20, y: 20 },
      drillMm: 1,
    }),
  );
  expect(stale).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
  expect(await sdk.getPcbProjection(design.id)).toEqual(before);
});

test("failed history persistence rolls back the command and its replay log", async () => {
  const { sdk } = await bootDesignerRuntime("h07-history-write-failure");
  const design = await sdk.createDesign({ name: "H07 failed write" });
  const before = await sdk.getSchematicProjection(design.id);
  getSharedSqlite().exec(
    "CREATE TRIGGER h07_history_failure BEFORE INSERT ON designer_session_histories BEGIN SELECT RAISE(ABORT, 'injected history write failure'); END",
  );
  const command = envelope(design.id, 0, {
    type: "place_gnd_port",
    positionNm: { x: 1270000, y: 0 },
  });
  expect((await sdk.dispatchCommand(design.id, command)).ok).toBe(false);
  expect(await sdk.getSchematicProjection(design.id)).toEqual(before);
  expect((await sdk.getHistory(design.id, TEST_SESSION)).undoDepth).toBe(0);
  getSharedSqlite().exec("DROP TRIGGER h07_history_failure");
  // Controlled fixture retry proves the rolled-back command ID was not recorded as applied.
  expect(await sdk.dispatchCommand(design.id, command)).toMatchObject({
    ok: true,
    revision: 1,
  });
});

test("failed Undo persistence leaves geometry and history intact", async () => {
  const { sdk } = await bootDesignerRuntime("h07-undo-write-failure");
  const design = await sdk.createDesign({ name: "H07 failed Undo" });
  await dispatchOk(sdk, design.id, {
    type: "place_gnd_port",
    positionNm: { x: 1270000, y: 0 },
  });
  const before = await sdk.getSchematicProjection(design.id);
  const history = await sdk.getHistory(design.id, TEST_SESSION);
  getSharedSqlite().exec(
    "CREATE TRIGGER h07_undo_failure BEFORE INSERT ON designer_session_histories BEGIN SELECT RAISE(ABORT, 'injected history write failure'); END",
  );
  await expect(sdk.undo(design.id, TEST_SESSION)).rejects.toThrow(
    "injected history write failure",
  );
  expect(await sdk.getSchematicProjection(design.id)).toEqual(before);
  expect(await sdk.getHistory(design.id, TEST_SESSION)).toEqual(history);
});

test("stale HTTP Undo/Redo refuses before consuming history or changing geometry", async () => {
  const { sdk, server } = await bootDesignerRuntime("h07-history-revision");
  const design = await sdk.createDesign({
    name: "H07 expected history revision",
  });
  await dispatchOk(sdk, design.id, {
    type: "place_gnd_port",
    positionNm: { x: 0, y: 0 },
  });
  const before = await sdk.getSchematicProjection(design.id);
  const history = await sdk.getHistory(design.id, TEST_SESSION);
  for (const direction of ["undo", "redo"] as const) {
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/history/${direction}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: TEST_SESSION,
            expectedRevision: 0,
          }),
        },
      ),
    );
    expect(await response.json()).toMatchObject({
      data: {
        result: {
          ok: false,
          code: "REVISION_CONFLICT",
          conflict: { expected: 0, actual: 1 },
        },
      },
    });
    expect(await sdk.getSchematicProjection(design.id)).toEqual(before);
    expect(await sdk.getHistory(design.id, TEST_SESSION)).toEqual(history);
  }
  expect((await sdk.undo(design.id, TEST_SESSION, 1)).ok).toBe(true);
  const undone = await sdk.getSchematicProjection(design.id);
  expect(await sdk.redo(design.id, TEST_SESSION, 1)).toMatchObject({
    ok: false,
    code: "REVISION_CONFLICT",
  });
  expect(await sdk.getSchematicProjection(design.id)).toEqual(undone);
  expect((await sdk.redo(design.id, TEST_SESSION, 2)).ok).toBe(true);
});
