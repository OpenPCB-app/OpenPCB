import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import { allDesignerRows, rawState } from "./helpers/net-rebind-runtime";
import { routesRuntime, status, type RoutesRuntime } from "./helpers/net-identity-routes-runtime";

const SESSION = "http-repair";

async function fixture() {
  const runtime = await routesRuntime();
  await status(runtime, "/migrate");
  const target = readNetIdentityState(runtime.db, runtime.designId)!.active[0]!.id;
  const rowId = crypto.randomUUID();
  runtime.db.insert(pcbEntities).values({ id: rowId, designId: runtime.designId, kind: "trace",
    payloadJson: JSON.stringify({ id: rowId, netId: "http-stale", netName: " Provenance ", future: { preserve: true } }),
    createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" }).run();
  return { ...runtime, target, rowId };
}

function envelope(runtime: RoutesRuntime, bindings: unknown) {
  return { commandId: crypto.randomUUID(), sessionId: SESSION, aggregateId: runtime.designId, baseRevision: null,
    issuedAt: Date.now(), command: { type: "pcb_rebind_net_references", bindings } };
}

function post(runtime: RoutesRuntime, suffix: string, body: unknown) {
  return runtime.server.fetch(new Request(`http://localhost/api/modules/designer/designs/${runtime.designId}/${suffix}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("repair command HTTP transport", () => {
  test("receipt replays idempotently and raw delta stays private; normal undo/redo routes replay carrier", async () => {
    const runtime = await fixture(), original = runtime.db.select().from(pcbEntities).where(eq(pcbEntities.id, runtime.rowId)).get()!.payloadJson;
    const command = envelope(runtime, [{ fromNetId: "http-stale", toNetId: runtime.target }]);
    const response = await post(runtime, "commands", command);
    expect(response.status).toBe(200);
    const first = await response.json() as { data: { result: Record<string, unknown> } };
    expect(first.data.result).toMatchObject({ ok: true, idempotent: false, netRebind: { traces: 1 } });
    expect(Object.keys(first.data.result).sort()).toEqual(["createdEntityId", "idempotent", "netRebind", "ok", "revision"]);
    const before = allDesignerRows();
    const replay = await post(runtime, "commands", command);
    expect((await replay.json() as { data: { result: unknown } }).data.result).toEqual({ ...first.data.result, idempotent: true });
    expect(allDesignerRows()).toBe(before);
    expect((await post(runtime, "history/undo", { sessionId: SESSION })).status).toBe(200);
    expect(runtime.db.select().from(pcbEntities).where(eq(pcbEntities.id, runtime.rowId)).get()!.payloadJson).toBe(original);
    expect((await post(runtime, "history/redo", { sessionId: SESSION })).status).toBe(200);
    const raw = JSON.parse(runtime.db.select().from(pcbEntities).where(eq(pcbEntities.id, runtime.rowId)).get()!.payloadJson) as Record<string, unknown>;
    expect(raw).toMatchObject({ netId: runtime.target, netName: " Provenance ", future: { preserve: true } });
  });

  test("malformed bindings reach strict shared planner unchanged; target failure carries indexed field", async () => {
    const runtime = await fixture();
    for (const bindings of [null, [], [null], [{ fromNetId: true, toNetId: runtime.target }], [{ fromNetId: "http-stale" }],
      [{ fromNetId: null, fromNetName: " ", toNetId: null }], undefined]) {
      const before = rawState(runtime.designId), response = await post(runtime, "commands", envelope(runtime, bindings));
      expect(response.status).toBe(200);
      expect((await response.json() as { data: { result: unknown } }).data.result).toMatchObject({ ok: false, code: "INVALID_PCB_BOARD_SETTINGS" });
      expect(rawState(runtime.designId)).toBe(before);
    }
    const response = await post(runtime, "commands", envelope(runtime, [{ fromNetId: "http-stale", toNetId: "foreign" }]));
    expect((await response.json() as { data: { result: unknown } }).data.result).toMatchObject({ ok: false, code: "NET_REFERENCE_DANGLING", field: "bindings[0].toNetId" });
  });

  test("name hint keeps exact whitespace/case through HTTP parsing", async () => {
    const runtime = await fixture();
    runtime.db.update(pcbEntities).set({ payloadJson: JSON.stringify({ id: runtime.rowId, netId: null, netName: " Exact " }) }).where(eq(pcbEntities.id, runtime.rowId)).run();
    const miss = await post(runtime, "commands", envelope(runtime, [{ fromNetId: null, fromNetName: "Exact", toNetId: runtime.target }]));
    expect((await miss.json() as { data: { result: unknown } }).data.result).toMatchObject({ ok: true, netRebind: { traces: 0 } });
    const match = await post(runtime, "commands", envelope(runtime, [{ fromNetId: null, fromNetName: " Exact ", toNetId: runtime.target }]));
    expect((await match.json() as { data: { result: unknown } }).data.result).toMatchObject({ ok: true, netRebind: { traces: 1 } });
    expect(JSON.parse(runtime.db.select().from(pcbEntities).where(eq(pcbEntities.id, runtime.rowId)).get()!.payloadJson)).toMatchObject({ netId: runtime.target, netName: " Exact " });
  });

  test("mixed batch refuses with 400 and no command log or data changes", async () => {
    const runtime = await fixture(), command = envelope(runtime, []), before = allDesignerRows();
    const response = await post(runtime, "commands", { ...command, command: { type: "batch_commands", commands: [
      { type: "pcb_add_free_hole", centerMm: { x: 4, y: 4 }, drillMm: 1 }, command.command,
    ] } });
    expect(response.status).toBe(400);
    expect(allDesignerRows()).toBe(before);
  });

  test("history CAS conflict surfaces explicit 409 and preserves stack/head/all rows", async () => {
    const runtime = await fixture();
    await post(runtime, "commands", envelope(runtime, [{ fromNetId: "http-stale", toNetId: runtime.target }]));
    const raw = JSON.parse(runtime.db.select().from(pcbEntities).where(eq(pcbEntities.id, runtime.rowId)).get()!.payloadJson) as Record<string, unknown>;
    runtime.db.update(pcbEntities).set({ payloadJson: JSON.stringify({ ...raw, netId: "newer-session" }) }).where(eq(pcbEntities.id, runtime.rowId)).run();
    const before = allDesignerRows(), response = await post(runtime, "history/undo", { sessionId: SESSION });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "NET_REBIND_HISTORY_CONFLICT" });
    expect(allDesignerRows()).toBe(before);
  });
});
