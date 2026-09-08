// The apply orchestration (backend/autolayout/apply-candidate.ts) — everything that
// happens around the atomic command: re-fetch, applicability, staleness, error mapping and
// fire-and-forget selection feedback.
//
// Runs against a stubbed cloud (global fetch) and stubbed store callbacks: this is about
// the decision sequence, not about SQLite (the command itself is covered by
// designer-autolayout-apply-atomic.test.ts).
import { afterEach, describe, expect, test } from "bun:test";

import { applyCandidate } from "../../../modules/designer/backend/autolayout/apply-candidate";
import { AutoLayoutError } from "../../../modules/designer/backend/autolayout/errors";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { DesignerPcbProjection } from "../../../sdks/designer";

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
