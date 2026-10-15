// OPENPCB-103: the UI command lookup (`GET /designs/:id/commands/:commandId`) is the
// evidence a crash-recovered edit is classified on. It must say exactly what the log
// holds — found, missing, mismatch, or found-unparsed — never guess, and never write.
import { describe, expect, test } from "bun:test";
import type {
  DesignerCommand,
  DesignerCommandLookup,
  DesignerDispatchResult,
} from "../../../sdks";
import { getSharedSqlite } from "../db/sqlite-client";
import {
  bootDesignerRuntime,
  envelope,
  importCapacitorComponent,
  postCommand,
  TEST_SESSION,
  type TestServer,
} from "./helpers/designer-runtime";

const HOLE: DesignerCommand = {
  type: "pcb_add_free_hole",
  centerMm: { x: 3, y: 4 },
  drillMm: 1,
};

function lookupUrl(
  designId: string,
  commandId: string,
  query: Record<string, string>,
): string {
  const params = new URLSearchParams(query).toString();
  return `http://localhost/api/modules/designer/designs/${designId}/commands/${encodeURIComponent(commandId)}?${params}`;
}

function getLookup(
  server: TestServer,
  designId: string,
  commandId: string,
  sessionId = TEST_SESSION,
  commandType = "pcb_add_free_hole",
): Promise<Response> {
  return server.fetch(
    new Request(lookupUrl(designId, commandId, { sessionId, commandType })),
  );
}

async function lookup(
  server: TestServer,
  designId: string,
  commandId: string,
  sessionId?: string,
  commandType?: string,
): Promise<DesignerCommandLookup> {
  const response = await getLookup(server, designId, commandId, sessionId, commandType);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { lookup: DesignerCommandLookup } };
  return body.data.lookup;
}

function commandLogCount(commandId: string): number {
  return (
    getSharedSqlite()
      .query<{ count: number }>(
        "SELECT count(*) AS count FROM designer_command_log WHERE command_id = ?",
      )
      .get(commandId)?.count ?? -1
  );
}

/** A log row this build did not write — a newer build's result, or a corrupted one. */
function insertLogRow(row: {
  commandId: string;
  designId: string;
  resultJson: string;
  appliedRevision: number;
  command?: DesignerCommand;
}): void {
  const command = row.command ?? HOLE;
  getSharedSqlite()
    .query(
      `INSERT INTO designer_command_log
        (command_id, design_id, session_id, command_type, command_json, result_json,
         issued_at, applied_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.commandId,
      row.designId,
      TEST_SESSION,
      command.type,
      JSON.stringify(command),
      row.resultJson,
      1000,
      row.appliedRevision,
      "2026-10-15T00:00:00.000Z",
    );
}

describe("designer UI command lookup", () => {
  test("missing reports the head; found ok carries the applied revision", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-found");
    const design = await sdk.createDesign({ name: "Lookup" });
    expect(await lookup(server, design.id, "never-sent")).toEqual({
      status: "missing",
      headRevision: 0,
    });

    const sent = envelope(design.id, 0, HOLE);
    const result = await sdk.dispatchCommand(design.id, sent);
    if (!result.ok) throw new Error(result.code);
    const found = await lookup(server, design.id, sent.commandId);
    expect(found).toMatchObject({
      status: "found",
      commandType: "pcb_add_free_hole",
      appliedRevision: result.revision,
      headRevision: result.revision,
      result: { ...result, idempotent: true },
    });
    if (found.status !== "found") throw new Error(found.status);
    expect(Number.isNaN(Date.parse(found.committedAt))).toBe(false);
  });

  test("a logged conflict and a logged rejection are found, not missing", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-conflict");
    const design = await sdk.createDesign({ name: "Lookup conflict" });
    await sdk.dispatchCommand(design.id, envelope(design.id, 0, HOLE));
    const stale = envelope(design.id, 0, HOLE);
    const conflict = await sdk.dispatchCommand(design.id, stale);
    expect(conflict).toEqual({
      ok: false,
      code: "REVISION_CONFLICT",
      conflict: { expected: 0, actual: 1 },
    });
    expect(await lookup(server, design.id, stale.commandId)).toMatchObject({
      status: "found",
      appliedRevision: 1,
      headRevision: 1,
      result: conflict,
    });

    const rejected = envelope(design.id, 1, {
      type: "pcb_update_free_hole",
      freeHoleId: "missing",
      drillMm: 2,
    });
    const rejection = await sdk.dispatchCommand(design.id, rejected);
    expect(rejection.ok).toBe(false);
    expect(
      await lookup(server, design.id, rejected.commandId, TEST_SESSION, "pcb_update_free_hole"),
    ).toMatchObject({ status: "found", appliedRevision: 1, result: rejection });
  });

  test("each of the six formerly unparseable codes round-trips through the log", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-six");
    const design = await sdk.createDesign({ name: "Lookup six" });
    const commands: Array<[DesignerCommand, string]> = [
      [{ type: "pcb_add_free_hole", centerMm: { x: 0, y: 0 }, drillMm: 0 }, "INVALID_PCB_FREE_HOLE"],
      [{ type: "pcb_delete_free_hole", freeHoleId: "missing" }, "PCB_FREE_HOLE_NOT_FOUND"],
      [
        {
          type: "pcb_add_free_pad",
          centerMm: { x: 0, y: 0 },
          rotationDeg: 0,
          padType: "smd",
          shape: "rect",
          widthMm: 0,
          heightMm: 1,
          layer: "F.Cu",
        },
        "INVALID_PCB_FREE_PAD",
      ],
      [{ type: "pcb_delete_free_pad", freePadId: "missing" }, "PCB_FREE_PAD_NOT_FOUND"],
      [
        {
          type: "pcb_add_overlay_text",
          layer: "F.SilkS",
          positionMm: { x: 0, y: 0 },
          text: "",
          fontSizeMm: 1,
          rotationDeg: 0,
        },
        "INVALID_PCB_OVERLAY",
      ],
      [{ type: "pcb_delete_overlay_text", overlayTextId: "missing" }, "PCB_OVERLAY_NOT_FOUND"],
    ];
    for (const [command, code] of commands) {
      const sent = envelope(design.id, 0, command);
      const result: DesignerDispatchResult = await sdk.dispatchCommand(design.id, sent);
      expect(result).toMatchObject({ ok: false, code });
      expect(
        await lookup(server, design.id, sent.commandId, TEST_SESSION, command.type),
      ).toMatchObject({ status: "found", result });
      // The duplicate id replays the same rejection, not a REVISION_CONFLICT.
      expect(await sdk.dispatchCommand(design.id, sent)).toEqual(result);
    }
  });

  test("an unparseable logged result is found-unparsed, never mismatch", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-unparsed");
    const design = await sdk.createDesign({ name: "Lookup unparsed" });
    insertLogRow({
      commandId: "future-code",
      designId: design.id,
      resultJson: JSON.stringify({ ok: false, code: "FUTURE_CODE", detail: "x" }),
      appliedRevision: 0,
    });
    insertLogRow({
      commandId: "garbage",
      designId: design.id,
      resultJson: "{not json",
      appliedRevision: 0,
    });
    insertLogRow({
      commandId: "future-ok",
      designId: design.id,
      resultJson: JSON.stringify({ ok: true, revisionV2: 7 }),
      appliedRevision: 7,
    });
    expect(await lookup(server, design.id, "future-code")).toEqual({
      status: "found-unparsed",
      commandType: "pcb_add_free_hole",
      appliedRevision: 0,
      committedAt: "2026-10-15T00:00:00.000Z",
      headRevision: 0,
      rawOk: false,
      rawCode: "FUTURE_CODE",
    });
    expect(await lookup(server, design.id, "garbage")).toMatchObject({
      status: "found-unparsed",
      rawOk: false,
      rawCode: null,
    });
    expect(await lookup(server, design.id, "future-ok")).toMatchObject({
      status: "found-unparsed",
      appliedRevision: 7,
      rawOk: true,
      rawCode: null,
    });
  });

  test("another session, type, design or an operation identity is a mismatch", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-mismatch");
    const design = await sdk.createDesign({ name: "Lookup mismatch" });
    const other = await sdk.createDesign({ name: "Other" });
    const sent = envelope(design.id, 0, HOLE);
    await sdk.dispatchCommand(design.id, sent);
    expect(await lookup(server, design.id, sent.commandId, "other-session")).toEqual({
      status: "mismatch",
    });
    expect(
      await lookup(server, design.id, sent.commandId, TEST_SESSION, "pcb_delete_free_hole"),
    ).toEqual({ status: "mismatch" });
    expect(await lookup(server, other.id, sent.commandId)).toEqual({
      status: "mismatch",
    });

    const assisted = envelope(design.id, 1, HOLE);
    const receipt = await sdk.dispatchOperation(design.id, assisted, {
      actorScope: "local:chat-1",
      operationId: "operation-1",
      actionId: assisted.commandId,
      toolName: "designer_add_free_hole",
      argumentFingerprint: "arguments-sha256",
      designId: design.id,
      expectedRevision: 1,
    });
    expect(receipt.ok).toBe(true);
    expect(await lookup(server, design.id, assisted.commandId)).toEqual({
      status: "mismatch",
    });
  });

  test("an unknown or deleted design is a TYPED 404; an unmatched path is generic", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-404");
    const design = await sdk.createDesign({ name: "Doomed" });
    const sent = envelope(design.id, 0, HOLE);
    await sdk.dispatchCommand(design.id, sent);
    const deleted = await server.fetch(
      new Request(`http://localhost/api/modules/designer/designs/${design.id}`, {
        method: "DELETE",
      }),
    );
    expect(deleted.ok).toBe(true);

    for (const designId of ["no-such-design", design.id]) {
      const response = await getLookup(server, designId, sent.commandId);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        type: "https://openpcb.dev/problems/designer/design-not-found",
        title: "Design Not Found",
      });
    }
    const unmatched = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${design.id}/commandz/${sent.commandId}`,
      ),
    );
    expect(unmatched.status).toBe(404);
    expect(((await unmatched.json()) as { type: string }).type).toBe(
      "https://openpcb.dev/problems/not-found",
    );
  });

  test("missing or oversized lookup keys are a 400", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-400");
    const design = await sdk.createDesign({ name: "Lookup 400" });
    const cases = [
      lookupUrl(design.id, "id", { commandType: "pcb_add_free_hole" }),
      lookupUrl(design.id, "id", { sessionId: TEST_SESSION }),
      lookupUrl(design.id, "id", { sessionId: "", commandType: "x" }),
      lookupUrl(design.id, "x".repeat(129), {
        sessionId: TEST_SESSION,
        commandType: "pcb_add_free_hole",
      }),
    ];
    for (const url of cases) {
      expect((await server.fetch(new Request(url))).status).toBe(400);
    }
  });

  test("concurrent same-id POSTs commit once", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-concurrent");
    const componentId = await importCapacitorComponent(server);
    const design = await sdk.createDesign({ name: "Concurrent" });
    // place_part resolves the library BEFORE its transaction, so both requests
    // pass the first log check and race to the in-transaction re-check.
    const sent = envelope(design.id, 0, {
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    const responses = await Promise.all([
      postCommand(server, design.id, sent),
      postCommand(server, design.id, sent),
    ]);
    const results = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        return ((await response.json()) as { data: { result: DesignerDispatchResult } })
          .data.result;
      }),
    );
    expect(results.every((result) => result.ok && result.revision === 1)).toBe(true);
    expect(results.filter((result) => result.ok && result.idempotent)).toHaveLength(1);
    expect((await sdk.getSchematicProjection(design.id))?.parts).toHaveLength(1);
    expect((await sdk.getHistory(design.id, TEST_SESSION)).undoDepth).toBe(1);
    expect(commandLogCount(sent.commandId)).toBe(1);
  });

  test("a commit whose response was lost is found, and its resend applies nothing", async () => {
    const { sdk, server } = await bootDesignerRuntime("p103-lookup-lost-response");
    const design = await sdk.createDesign({ name: "Lost response" });
    const sent = envelope(design.id, 0, HOLE);
    // The commit lands; the caller never sees its answer.
    await sdk.dispatchCommand(design.id, sent);

    expect(await lookup(server, design.id, sent.commandId)).toMatchObject({
      status: "found",
      appliedRevision: 1,
      headRevision: 1,
      result: { ok: true, revision: 1 },
    });
    // The lookup itself wrote nothing.
    expect((await sdk.getSchematicProjection(design.id))?.revision).toBe(1);

    const resent = await postCommand(server, design.id, sent);
    expect(resent.status).toBe(200);
    expect(
      ((await resent.json()) as { data: { result: DesignerDispatchResult } }).data.result,
    ).toMatchObject({ ok: true, revision: 1, idempotent: true });
    expect((await sdk.getSchematicProjection(design.id))?.revision).toBe(1);
    expect((await sdk.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);
    expect((await sdk.getHistory(design.id, TEST_SESSION)).undoDepth).toBe(1);
    expect(commandLogCount(sent.commandId)).toBe(1);
  });
});
