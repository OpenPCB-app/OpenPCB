import { describe, expect, test } from "bun:test";
import {
  makeDesignerPlaceComponentsTool,
  makeDesignerProposeSchematicWiresTool,
} from "../../../modules/assistant/backend/tools/designer-tools";
import type {
  AssistantWriteProposalDto,
  DesignerSDK,
  DesignerSchematicProjection,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { ContextResolver } from "../../../modules/assistant/backend/context-resolver";
import type { ConversationStore } from "../../../modules/assistant/backend/conversation-store";

// ─── test doubles ──────────────────────────────────────────────────────

const DESIGN_ID = "11111111-1111-1111-1111-111111111111";
const COMPONENT_ID = "comp-resistor";

interface DispatchRecord {
  type: string;
}

/**
 * Minimal in-memory ConversationStore: the write tools only touch
 * listWriteProposals / createWriteProposal / updateWriteProposalStatus.
 */
function makeConversation(): ConversationStore {
  const rows = new Map<string, AssistantWriteProposalDto>();
  return {
    createWriteProposal(input: {
      id?: string;
      chatId: string;
      kind: string;
      designId: string;
      baseRevision: number;
      proposal?: unknown;
      envelope?: unknown;
    }) {
      const id = input.id ?? crypto.randomUUID();
      const dto = {
        id,
        chatId: input.chatId,
        kind: input.kind,
        status: "pending",
        designId: input.designId,
        baseRevision: input.baseRevision,
        proposal: input.proposal,
        envelope: input.envelope,
        applyResult: null,
      } as unknown as AssistantWriteProposalDto;
      rows.set(id, dto);
      return dto;
    },
    getWriteProposal(_chatId: string, id: string) {
      return rows.get(id) ?? null;
    },
    listWriteProposals(chatId: string) {
      return [...rows.values()].filter((r) => r.chatId === chatId);
    },
    updateWriteProposalStatus(
      _chatId: string,
      id: string,
      status: string,
      applyResult: unknown = null,
    ) {
      const dto = rows.get(id)!;
      const next = { ...dto, status, applyResult } as AssistantWriteProposalDto;
      rows.set(id, next);
      return next;
    },
  } as unknown as ConversationStore;
}

function makeContextResolver(): ContextResolver {
  return {
    getPrimaryDesign: () => ({
      refId: DESIGN_ID,
      label: "Test",
      status: "active",
    }),
    maybeAutoBindDesign: async () => {},
    resolveDesign: async () => ({
      status: "not-found",
      candidates: [],
      message: "",
    }),
    bindDesign: async () => {},
  } as unknown as ContextResolver;
}

function makeProjection(
  overrides?: Partial<DesignerSchematicProjection>,
): DesignerSchematicProjection {
  return {
    designId: DESIGN_ID,
    revision: 1,
    parts: [],
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets: [],
    ...overrides,
  } as DesignerSchematicProjection;
}

function projectionWithTwoPins(): DesignerSchematicProjection {
  const mkPin = (id: string, num: string, x: number) => ({
    id,
    number: num,
    name: num,
    electricalType: "passive",
    worldPositionNm: { x, y: 0 },
  });
  return makeProjection({
    parts: [
      {
        id: "part-r1",
        reference: "R1",
        value: "1k",
        componentId: COMPONENT_ID,
        positionNm: { x: 0, y: 0 },
        rotationDeg: 0,
        mirrored: false,
        pins: [mkPin("pin-r1-1", "1", 0)],
        footprint: { footprintId: "fp", name: "fp", mountType: null },
      },
      {
        id: "part-r2",
        reference: "R2",
        value: "1k",
        componentId: COMPONENT_ID,
        positionNm: { x: 100, y: 0 },
        rotationDeg: 0,
        mirrored: false,
        pins: [mkPin("pin-r2-1", "1", 100)],
        footprint: { footprintId: "fp", name: "fp", mountType: null },
      },
    ] as unknown as DesignerSchematicProjection["parts"],
  });
}

function makeDesigner(opts?: {
  dispatchLog?: DispatchRecord[];
  failOnType?: string;
  projection?: DesignerSchematicProjection;
}): DesignerSDK {
  let revision = 1;
  const projection = opts?.projection ?? makeProjection();
  return {
    getDesign: async () => ({
      head: {
        id: DESIGN_ID,
        name: "Test Design",
        revision,
        updatedAt: new Date().toISOString(),
      },
    }),
    getSchematicProjection: async () => projection,
    getPcbProjection: async () => null,
    resolveLibraryComponentForPlacement: async (componentId: string) =>
      componentId === COMPONENT_ID
        ? { component: { id: COMPONENT_ID, name: "Resistor" } }
        : null,
    dispatchCommand: async (
      _designId: string,
      envelope: { command: { type: string } },
    ) => {
      opts?.dispatchLog?.push({ type: envelope.command.type });
      if (opts?.failOnType && envelope.command.type === opts.failOnType) {
        return { ok: false, code: "VALIDATION_ERROR" };
      }
      revision += 1;
      return { ok: true, revision, createdEntityId: "entity-1" };
    },
  } as unknown as DesignerSDK;
}

function makeCtx(designer: DesignerSDK): CoreBackendModuleContext {
  return {
    sdk: {
      get<T>(token: string): T | null {
        return token === MODULE_SDK_TOKENS.DESIGNER
          ? (designer as unknown as T)
          : null;
      },
    },
  } as unknown as CoreBackendModuleContext;
}

function makeExecCtx(chatId = "chat-1") {
  return {
    chatId,
    runId: "run-1",
    bindings: [],
    limits: { profile: "default", maxItems: 50, maxBytes: 100_000 },
  } as unknown as Parameters<
    ReturnType<typeof makeDesignerPlaceComponentsTool>["execute"]
  >[0];
}

const ACTION_ID = `place_R1_${DESIGN_ID}`;

// ─── tests ─────────────────────────────────────────────────────────────

describe("write-tool idempotency (action_id)", () => {
  test("same action_id twice -> second call is a no-op", async () => {
    const dispatchLog: DispatchRecord[] = [];
    const conversation = makeConversation();
    const tool = makeDesignerPlaceComponentsTool(
      makeCtx(makeDesigner({ dispatchLog })),
      makeContextResolver(),
      conversation,
      { isSessionAutoApplyAllowed: () => true },
    );

    const first = await tool.execute(makeExecCtx(), {
      action_id: ACTION_ID,
      components: [{ componentId: COMPONENT_ID }],
    });
    expect(first.ok).toBe(true);
    expect(first.status).toBe("ok");
    const dispatchesAfterFirst = dispatchLog.length;
    expect(dispatchesAfterFirst).toBeGreaterThan(0);

    const second = await tool.execute(makeExecCtx(), {
      action_id: ACTION_ID,
      components: [{ componentId: COMPONENT_ID }],
    });
    expect(second.ok).toBe(true);
    const modelData = second.modelData as { status: string };
    expect(modelData.status).toBe("already_applied");
    expect(second.summary).toContain("already_applied");
    // No new dispatch — the second call must not duplicate placements.
    expect(dispatchLog.length).toBe(dispatchesAfterFirst);
  });

  test("same action_id while first is still pending (in-flight) -> blocked, no duplicate dispatch", async () => {
    const dispatchLog: DispatchRecord[] = [];
    const conversation = makeConversation();
    // Auto-apply disallowed: the first proposal stays `pending` (awaiting a
    // user confirm) — a duplicate same-action_id call must NOT re-dispatch.
    const tool = makeDesignerPlaceComponentsTool(
      makeCtx(makeDesigner({ dispatchLog })),
      makeContextResolver(),
      conversation,
      { isSessionAutoApplyAllowed: () => false },
    );

    const first = await tool.execute(makeExecCtx(), {
      action_id: ACTION_ID,
      components: [{ componentId: COMPONENT_ID }],
    });
    // Staged pending, nothing dispatched yet.
    expect((first.modelData as { status: string }).status).toBe("pending");
    expect(dispatchLog.length).toBe(0);
    const proposalsAfterFirst =
      conversation.listWriteProposals("chat-1").length;
    expect(proposalsAfterFirst).toBe(1);

    const second = await tool.execute(makeExecCtx(), {
      action_id: ACTION_ID,
      components: [{ componentId: COMPONENT_ID }],
    });
    // Blocked duplicate: ok:false, no new proposal, no dispatch.
    expect(second.ok).toBe(false);
    expect(second.status).toBe("partial");
    expect((second.modelData as { status: string }).status).toBe(
      "already_applied",
    );
    expect(second.summary).toContain("duplicate_blocked");
    expect(dispatchLog.length).toBe(0);
    expect(conversation.listWriteProposals("chat-1").length).toBe(
      proposalsAfterFirst,
    );
  });

  test("malformed action_id falls back to normal (non-idempotent) apply", async () => {
    const tool = makeDesignerPlaceComponentsTool(
      makeCtx(makeDesigner()),
      makeContextResolver(),
      makeConversation(),
      { isSessionAutoApplyAllowed: () => true },
    );
    const result = await tool.execute(makeExecCtx(), {
      action_id: "not a valid id",
      components: [{ componentId: COMPONENT_ID }],
    });
    expect(result.ok).toBe(true);
    // Malformed id is surfaced as a warning and NOT treated as idempotent.
    expect(result.warnings.some((w) => w.includes("malformed action_id"))).toBe(
      true,
    );
    const modelData = result.modelData as { status: string };
    expect(modelData.status).not.toBe("already_applied");
    // The proposal is staged (a warning gates auto-apply by existing policy),
    // so a fresh, non-idempotent proposal was built.
    expect(result.data).not.toBeNull();
  });
});

describe("write-tool failure surfacing", () => {
  test("failed auto-apply (place) -> ok:false / status:partial, not ok:true", async () => {
    const tool = makeDesignerPlaceComponentsTool(
      makeCtx(makeDesigner({ failOnType: "place_part" })),
      makeContextResolver(),
      makeConversation(),
      { isSessionAutoApplyAllowed: () => true },
    );
    const result = await tool.execute(makeExecCtx(), {
      components: [{ componentId: COMPONENT_ID }],
    });
    // CRITICAL regression: a failed auto-apply must NOT report ok:true.
    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    const modelData = result.modelData as {
      appliedCount: number;
      status: string;
    };
    expect(modelData.status).toBe("partial");
    expect(modelData.appliedCount).toBe(0);
  });

  test("partial schematic wires -> applied ops remain, skipped reported, status partial", async () => {
    const tool = makeDesignerProposeSchematicWiresTool(
      makeCtx(makeDesigner({ projection: projectionWithTwoPins() })),
      makeContextResolver(),
      makeConversation(),
      { isSessionAutoApplyAllowed: () => true },
    );
    const result = await tool.execute(makeExecCtx(), {
      title: "wire",
      summary: "wire two pins",
      wires: [
        { source: "R1.1", target: "R2.1" }, // resolvable
        { source: "R1.1", target: "NOPE.9" }, // build-time skip
      ],
    });
    const modelData = result.modelData as {
      appliedCount: number;
      skipped: Array<{ id: string; reason: string }>;
      status: string;
    };
    // A partial apply (one good op, one skip) is NOT a success.
    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(modelData.appliedCount).toBeGreaterThan(0);
    expect(modelData.skipped.length).toBeGreaterThan(0);
  });
});
