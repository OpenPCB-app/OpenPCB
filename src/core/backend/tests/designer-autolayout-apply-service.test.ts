// The apply orchestration (backend/autolayout/apply-candidate.ts) — everything that
// happens around the atomic command: re-fetch, applicability, staleness, error mapping and
// fire-and-forget selection feedback.
//
// Runs against a stubbed cloud (global fetch) and stubbed store callbacks: this is about
// the decision sequence, not about SQLite (the command itself is covered by
// designer-autolayout-apply-atomic.test.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyCandidate,
  type PriorApply,
} from "../../../modules/designer/backend/autolayout/apply-candidate";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { AutoLayoutError } from "../../../modules/designer/backend/autolayout/errors";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { DesignerPcbProjection } from "../../../sdks/designer";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";

const TS = "2026-01-01T00:00:00.000Z";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function projection(): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 12,
    board: createDefaultPcbBoardSettings(TS),
    placements: [],
    traces: [],
    vias: [],
    freeHoles: [],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    keepouts: [],
    ratsnest: [],
    netNames: {},
    warnings: [],
  } as unknown as DesignerPcbProjection;
}

function layoutResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "designer_pcb_autolayout",
    envelopeId: "env_1",
    snapshotHash: "cloudhash",
    engineVersions: { route: "0.9.6", place: "0.5.0", layout: "0.2.0" },
    objectiveVersion: "layout-1",
    recommendedCandidateId: "cand_1",
    candidates: [
      {
        candidateId: "cand_1",
        kind: "default_placer",
        rank: 0,
        recommended: true,
        scorecard: {},
        explanation: "best completion",
        placeEnvelope: {
          operations: [
            {
              id: "op1",
              kind: "pcb_move_placement",
              payload: {
                type: "pcb_move_placement",
                placementId: "U1",
                positionMm: { x: 1, y: 2 },
              },
            },
          ],
        },
        routeEnvelope: {
          operations: [
            {
              id: "op2",
              kind: "pcb_add_via",
              payload: {
                type: "pcb_add_via",
                centerMm: { x: 3, y: 4 },
                netId: null,
                netClassId: "default",
              },
            },
          ],
        },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

/** Stubs the two cloud calls the apply path makes: GET status, POST selection. */
function stubCloud(options: {
  result?: unknown;
  status?: string;
  selectionCalls?: string[];
  selectionStatus?: number;
}) {
  const selectionCalls = options.selectionCalls ?? [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/selection")) {
      selectionCalls.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ jobId: "job_1", candidateId: "cand_1", recorded: true }),
        { status: options.selectionStatus ?? 202, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/v1/version")) {
      return new Response(JSON.stringify({ capabilities: {} }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        jobId: "job_1",
        status: options.status ?? "done",
        error: null,
        diagnostics: [],
        result: options.result === undefined ? layoutResult() : options.result,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return selectionCalls;
}

function deps(overrides: Partial<Parameters<typeof applyCandidate>[0]> = {}) {
  const proj = projection();
  const digest = computeBoardContentDigest(proj);
  return {
    digest,
    args: {
      designId: "d1",
      bearer: "token",
      request: {
        jobId: "job_1",
        candidateId: "cand_1",
        snapshotDigest: digest,
        applyRequestId: "apply-1",
        sessionId: "designer-pcb-session",
      },
      loadProjection: async () => proj,
      dispatch: async () => ({ ok: true as const, revision: 13, createdEntityId: null }),
      findPriorApply: () => null,
      runDrc: () => ({
        designId: "d1",
        revision: 13,
        violations: [],
        summary: { errors: 0, warnings: 0, infos: 0 },
        countsByCode: {},
      }),
      ...overrides,
    } as Parameters<typeof applyCandidate>[0],
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: AutoLayoutError["code"],
) {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AutoLayoutError);
    expect((error as AutoLayoutError).code).toBe(code);
  }
}

describe("applyCandidate", () => {
  test("derives operations from the SERVICE, not from the caller", async () => {
    // The request carries no operations at all — a stale or tampered renderer cannot feed
    // the command layer geometry the cloud never produced.
    stubCloud({});
    const dispatched: unknown[] = [];
    const { args } = deps({
      dispatch: async (envelope) => {
        dispatched.push(envelope);
        return { ok: true as const, revision: 13, createdEntityId: null };
      },
    });

    const result = await applyCandidate(args);
    expect(result.applied).toBe(true);
    expect(result.revision).toBe(13);
    expect(result.placementOperationCount).toBe(1);
    expect(result.routeOperationCount).toBe(1);

    const envelope = dispatched[0] as { commandId: string; command: Record<string, unknown> };
    // applyRequestId IS the command id, so a transport retry replays instead of re-applying
    expect(envelope.commandId).toBe("apply-1");
    expect(envelope.command.type).toBe("pcb_apply_autolayout_candidate");
    expect(envelope.command.placementOperations).toEqual([
      { type: "pcb_move_placement", placementId: "U1", positionMm: { x: 1, y: 2 } },
    ]);
    // provenance is bounded — engine versions + hash, never the whole result
    expect(envelope.command.provenance).toEqual({
      engineVersions: { route: "0.9.6", place: "0.5.0", layout: "0.2.0" },
      objectiveVersion: "layout-1",
      cloudSnapshotHash: "cloudhash",
    });
  });

  test("selection feedback fires exactly once, AFTER a successful commit", async () => {
    const selection = stubCloud({});
    const { args } = deps();
    await applyCandidate(args);
    await Bun.sleep(5); // fire-and-forget
    expect(selection).toHaveLength(1);
    expect(JSON.parse(selection[0]!)).toEqual({ candidateId: "cand_1" });
  });

  test("a failed selection POST never invalidates the applied board", async () => {
    stubCloud({ selectionStatus: 500 });
    const { args } = deps();
    const result = await applyCandidate(args);
    await Bun.sleep(5);
    expect(result.applied).toBe(true);
  });

  test("a changed board is rejected as stale before dispatch", async () => {
    stubCloud({});
    let dispatched = 0;
    const { args } = deps({
      dispatch: async () => {
        dispatched += 1;
        return { ok: true as const, revision: 13, createdEntityId: null };
      },
    });
    args.request = { ...args.request, snapshotDigest: "digest-from-an-older-board" };

    await expectCode(applyCandidate(args), "AUTO_LAYOUT_STALE");
    expect(dispatched).toBe(0);
  });

  test("a failed candidate is not applicable", async () => {
    stubCloud({
      result: layoutResult({
        candidates: [
          {
            candidateId: "cand_1",
            kind: "default_placer",
            rank: 0,
            recommended: false,
            scorecard: {},
            explanation: "",
            failure: { code: "route_budget_exhausted", stage: "route" },
          },
        ],
      }),
    });
    await expectCode(
      applyCandidate(deps().args),
      "AUTO_LAYOUT_CANDIDATE_NOT_APPLICABLE",
    );
  });

  test("a candidate with no operations is not applicable", async () => {
    stubCloud({
      result: layoutResult({
        candidates: [
          {
            candidateId: "cand_1",
            kind: "input_preserved",
            rank: 0,
            recommended: true,
            scorecard: {},
            explanation: "",
          },
        ],
      }),
    });
    await expectCode(
      applyCandidate(deps().args),
      "AUTO_LAYOUT_CANDIDATE_NOT_APPLICABLE",
    );
  });

  test("an unknown candidate id is reported as such", async () => {
    stubCloud({});
    const { args } = deps();
    args.request = { ...args.request, candidateId: "cand_missing" };
    await expectCode(applyCandidate(args), "AUTO_LAYOUT_INVALID_CANDIDATE");
  });

  test("an expired job cannot be applied from a cached client copy", async () => {
    stubCloud({ result: null, status: "done" });
    await expectCode(applyCandidate(deps().args), "AUTO_LAYOUT_RESULT_EXPIRED");
  });

  test("a malformed result is refused rather than dispatched", async () => {
    // A proxy error page, a truncated body, or a service too old to know this shape.
    stubCloud({
      result: layoutResult({
        candidates: [
          {
            candidateId: "cand_1",
            routeEnvelope: { operations: [{ id: "x", kind: "?", payload: { type: "rm -rf" } }] },
          },
        ],
      }),
    });
    await expectCode(applyCandidate(deps().args), "AUTO_LAYOUT_CONTRACT_MISMATCH");
  });

  test("a revision conflict maps to its own code", async () => {
    stubCloud({});
    const { args } = deps({
      dispatch: async () => ({
        ok: false as const,
        code: "REVISION_CONFLICT" as const,
        conflict: { expected: 12, actual: 14 },
      }),
    });
    await expectCode(applyCandidate(args), "AUTO_LAYOUT_REVISION_CONFLICT");
  });

  test("a rejected operation maps to OPERATION_INVALID", async () => {
    stubCloud({});
    const { args } = deps({
      dispatch: async () => ({
        ok: false as const,
        code: "INVALID_PCB_VIA" as const,
        detail: "drill exceeds diameter",
      }),
    });
    await expectCode(applyCandidate(args), "AUTO_LAYOUT_OPERATION_INVALID");
  });
});

/** Counts every cloud request, so a replay can prove it never reached the service. */
function countCloudCalls(): { count: number } {
  const calls = { count: 0 };
  const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.count += 1;
    return stubbed(input, init);
  }) as typeof fetch;
  return calls;
}

describe("applyCandidate replay (OPENPCB-103)", () => {
  /** A command log the stubbed dispatch writes into, shaped like the store's rows. */
  function fakeLog(revision: number) {
    const rows = new Map<string, PriorApply>();
    return {
      rows,
      dispatch: async (envelope: Parameters<Parameters<typeof applyCandidate>[0]["dispatch"]>[0]) => {
        const result = { ok: true as const, revision, createdEntityId: null };
        rows.set(envelope.commandId, {
          designId: envelope.aggregateId,
          sessionId: envelope.sessionId,
          commandType: envelope.command.type,
          command: JSON.parse(JSON.stringify(envelope.command)),
          resultJson: JSON.stringify(result),
          appliedRevision: revision,
          operationIdentity: false,
        });
        return result;
      },
    };
  }

  test("a lost response is answered from the log: no cloud, no digest check, no dispatch, no DRC", async () => {
    stubCloud({});
    const log = fakeLog(13);
    let dispatched = 0;
    let projectionReads = 0;
    let drcRuns = 0;
    const { args } = deps({
      dispatch: async (envelope) => {
        dispatched += 1;
        return log.dispatch(envelope);
      },
      findPriorApply: (id) => log.rows.get(id) ?? null,
    });
    const first = await applyCandidate(args);
    expect(first.replayed).toBeUndefined();
    await Bun.sleep(5); // selection feedback settles before counting

    const cloud = countCloudCalls();
    const retry = await applyCandidate({
      ...args,
      loadProjection: async () => {
        projectionReads += 1;
        return null;
      },
      runDrc: async () => {
        drcRuns += 1;
        return null;
      },
    });
    await Bun.sleep(5);
    expect(retry).toEqual({
      applied: true,
      revision: 13,
      jobId: "job_1",
      candidateId: "cand_1",
      placementOperationCount: 1,
      routeOperationCount: 1,
      drc: null,
      warnings: [],
      replayed: true,
    });
    expect(cloud.count).toBe(0);
    expect(projectionReads).toBe(0);
    expect(drcRuns).toBe(0);
    expect(dispatched).toBe(1);
  });

  test("the same id for another candidate, digest, session or an identity row is a request conflict", async () => {
    stubCloud({});
    const log = fakeLog(13);
    const { args } = deps({
      dispatch: log.dispatch,
      findPriorApply: (id) => log.rows.get(id) ?? null,
    });
    await applyCandidate(args);
    const cloud = countCloudCalls();
    for (const request of [
      { ...args.request, candidateId: "cand_2" },
      { ...args.request, snapshotDigest: "another-digest" },
      { ...args.request, sessionId: "another-session" },
    ]) {
      await expectCode(applyCandidate({ ...args, request }), "AUTO_LAYOUT_REQUEST_CONFLICT");
    }
    const row = log.rows.get("apply-1")!;
    log.rows.set("apply-1", { ...row, operationIdentity: true });
    await expectCode(applyCandidate(args), "AUTO_LAYOUT_REQUEST_CONFLICT");
    expect(cloud.count).toBe(0);
  });

  test("a logged refusal replays today's mapping; an unparseable success still replays", async () => {
    stubCloud({});
    const { args } = deps();
    const row = (resultJson: string): PriorApply => ({
      designId: "d1",
      sessionId: "designer-pcb-session",
      commandType: "pcb_apply_autolayout_candidate",
      command: {
        jobId: "job_1",
        candidateId: "cand_1",
        snapshotDigest: args.request.snapshotDigest,
        placementOperations: [],
        routeOperations: [{}, {}],
      },
      resultJson,
      appliedRevision: 12,
      operationIdentity: false,
    });
    await expectCode(
      applyCandidate({
        ...args,
        findPriorApply: () =>
          row(JSON.stringify({ ok: false, code: "REVISION_CONFLICT", conflict: { expected: 11, actual: 12 } })),
      }),
      "AUTO_LAYOUT_REVISION_CONFLICT",
    );
    await expectCode(
      applyCandidate({
        ...args,
        findPriorApply: () => row(JSON.stringify({ ok: false, code: "FUTURE_CODE" })),
      }),
      "AUTO_LAYOUT_OPERATION_INVALID",
    );
    const replayed = await applyCandidate({
      ...args,
      findPriorApply: () => row(JSON.stringify({ ok: true, revisionV2: 12 })),
    });
    expect(replayed).toMatchObject({
      revision: 12,
      placementOperationCount: 0,
      routeOperationCount: 2,
      replayed: true,
    });
  });

  test("against the real command log: lost response replays, apply → undo → apply applies again", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "designer-autolayout-replay-"));
    const oldPath = process.env.OPENPCB_DB_PATH;
    const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
    try {
      const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
      const design = await store.createDesign();
      const original = (await store.getPcbProjection(design.id))!;
      stubCloud({
        result: layoutResult({
          candidates: [
            {
              candidateId: "cand_1",
              kind: "default_placer",
              rank: 0,
              recommended: true,
              scorecard: {},
              explanation: "via only",
              routeEnvelope: {
                operations: [
                  {
                    id: "op1",
                    kind: "pcb_add_via",
                    payload: {
                      type: "pcb_add_via",
                      centerMm: { x: 3, y: 4 },
                      netId: null,
                      netClassId: "default",
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      const request = {
        jobId: "job_1",
        candidateId: "cand_1",
        snapshotDigest: computeBoardContentDigest(original),
        applyRequestId: "apply-real-1",
        sessionId: "designer-pcb-session",
      };
      const live = {
        designId: design.id,
        bearer: "token",
        request,
        loadProjection: () => store.getPcbProjection(design.id),
        dispatch: (envelope: Parameters<typeof store.dispatchCommand>[1]) =>
          store.dispatchCommand(design.id, envelope),
        findPriorApply: (id: string) => store.getLoggedUiCommand(id),
        runDrc: async () => null,
      };

      const first = await applyCandidate(live);
      expect(first).toMatchObject({ applied: true, revision: 1, routeOperationCount: 1 });
      expect((await store.getPcbProjection(design.id))?.vias).toHaveLength(1);

      // The response was lost; the board has moved on, so today's path would say STALE.
      const retry = await applyCandidate(live);
      expect(retry).toMatchObject({ revision: 1, replayed: true, routeOperationCount: 1 });
      expect((await store.getPcbProjection(design.id))?.vias).toHaveLength(1);
      expect((await store.getHistory(design.id, request.sessionId)).undoDepth).toBe(1);

      expect((await store.undo(design.id, request.sessionId)).ok).toBe(true);
      expect((await store.getPcbProjection(design.id))?.vias).toHaveLength(0);
      const again = await applyCandidate({
        ...live,
        request: { ...request, applyRequestId: "apply-real-2" },
      });
      expect(again.replayed).toBeUndefined();
      expect(again.revision).toBe(3);
      expect((await store.getPcbProjection(design.id))?.vias).toHaveLength(1);
    } finally {
      resetCaptureRuntimeForTesting();
      resetSharedSqliteForTesting();
      if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
      else process.env.OPENPCB_DB_PATH = oldPath;
      if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
      else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
      await rm(folder, { recursive: true, force: true });
    }
  });
});
