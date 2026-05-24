import { describe, expect, test } from "bun:test";
import type {
  AssistantPlacementProposal,
  DesignerCommandEnvelope,
  DesignerSDK,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { ContextResolver } from "../../../modules/assistant/backend/context-resolver";
import {
  applyDesignerPlaceComponentsProposal,
  makeDesignerCreateDesignTool,
  makeDesignerPlaceComponentsTool,
} from "../../../modules/assistant/backend/tools/designer-tools";
import type { ConversationStore } from "../../../modules/assistant/backend/conversation-store";

function proposal(overrides: Partial<AssistantPlacementProposal> = {}): AssistantPlacementProposal {
  return {
    proposalId: "proposal-1",
    status: "pending_approval",
    design: { id: "design-1", name: "Demo", revision: 7 },
    placements: [
      {
        componentId: "cmp-1",
        componentName: "Regulator",
        positionNm: { x: 0, y: 0 },
        rotationDeg: 0,
        mirrored: false,
        warnings: [],
      },
      {
        componentId: "cmp-2",
        componentName: "Capacitor",
        positionNm: { x: 24_000_000, y: 0 },
        rotationDeg: 90,
        mirrored: false,
        warnings: [],
      },
    ],
    skipped: [],
    requiresPartialConfirmation: false,
    ...overrides,
  };
}

function mockDesigner(currentRevision = 7): DesignerSDK {
  let nextRevision = currentRevision;
  return {
    async getDesign() {
      return {
        head: {
          id: "design-1",
          name: "Demo",
          revision: currentRevision,
          createdAt: "now",
          updatedAt: "now",
        },
        schematic: null,
        pcb: null,
      };
    },
    async dispatchCommand(_designId: string, envelope: DesignerCommandEnvelope) {
      nextRevision += 1;
      if (envelope.command.type !== "place_part") throw new Error("unexpected command");
      return {
        ok: true,
        revision: nextRevision,
        createdEntityId: `part-${envelope.command.componentId}`,
      };
    },
  } as unknown as DesignerSDK;
}

function mockCreateDesigner(): DesignerSDK {
  return {
    async createDesign(input?: { name?: string }) {
      return {
        id: "new-design",
        name: input?.name ?? "Untitled Design",
        revision: 0,
        createdAt: "created",
        updatedAt: "updated",
      };
    },
  } as unknown as DesignerSDK;
}

function mockToolContext(designer: DesignerSDK): CoreBackendModuleContext {
  return {
    sdk: {
      get<T>(token: string): T | null {
        if (token === MODULE_SDK_TOKENS.DESIGNER) return designer as T;
        return null;
      },
    },
  } as unknown as CoreBackendModuleContext;
}

function mockContextResolver(bound = false): ContextResolver {
  return {
    getPrimaryDesign() {
      return bound
        ? {
            id: "binding-1",
            chatId: "chat-1",
            kind: "design",
            refId: "existing-design",
            label: "Existing",
            role: "primary",
            status: "active",
            createdAt: "created",
            updatedAt: "updated",
          }
        : undefined;
    },
    async bindDesign() {
      return {
        id: "binding-2",
        chatId: "chat-1",
        kind: "design",
        refId: "new-design",
        label: "New Design",
        role: "primary",
        status: "active",
        createdAt: "created",
        updatedAt: "updated",
      };
    },
  } as unknown as ContextResolver;
}

describe("assistant placement proposal apply", () => {
  test("dispatches one place_part command per placement", async () => {
    const result = await applyDesignerPlaceComponentsProposal({
      designer: mockDesigner(),
      proposal: proposal(),
      designId: "design-1",
      baseRevision: 7,
      allowPartial: false,
    });

    expect(result.applied).toHaveLength(2);
    expect(result.applied[0]?.partId).toBe("part-cmp-1");
    expect(result.applied[1]?.revision).toBe(9);
  });

  test("requires explicit partial confirmation when proposal has skipped items", async () => {
    await expect(
      applyDesignerPlaceComponentsProposal({
        designer: mockDesigner(),
        proposal: proposal({
          skipped: [{ componentId: "missing", reason: "not found" }],
          requiresPartialConfirmation: true,
        }),
        designId: "design-1",
        baseRevision: 7,
        allowPartial: false,
      }),
    ).rejects.toThrow(/Confirm partial apply/);
  });

  test("blocks stale design revisions", async () => {
    await expect(
      applyDesignerPlaceComponentsProposal({
        designer: mockDesigner(8),
        proposal: proposal(),
        designId: "design-1",
        baseRevision: 7,
        allowPartial: false,
      }),
    ).rejects.toThrow(/Design changed/);
  });
});

describe("assistant design creation tool", () => {
  test("creates a design and binds the chat", async () => {
    const tool = makeDesignerCreateDesignTool(
      mockToolContext(mockCreateDesigner()),
      mockContextResolver(false),
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      { name: "Sensor Board" },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.design.name).toBe("Sensor Board");
    expect(result.data?.bound).toBe(true);
  });

  test("blocks creation when chat is already bound to a design", async () => {
    const tool = makeDesignerCreateDesignTool(
      mockToolContext(mockCreateDesigner()),
      mockContextResolver(true),
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      { name: "Another Board" },
    );

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("already bound");
  });
});

describe("assistant placement proposal tool", () => {
  test("does not create a pending proposal when every component is skipped", async () => {
    let proposalCount = 0;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 1,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return { parts: [] };
      },
      async resolveLibraryComponentForPlacement() {
        return null;
      },
    } as unknown as DesignerSDK;
    const contextResolver = {
      getPrimaryDesign() {
        return {
          id: "binding-1",
          chatId: "chat-1",
          kind: "design",
          refId: "design-1",
          label: "Demo",
          role: "primary",
          status: "active",
          createdAt: "created",
          updatedAt: "updated",
        };
      },
      async maybeAutoBindDesign() {
        return null;
      },
    } as unknown as ContextResolver;
    const conversation = {
      createWriteProposal() {
        proposalCount += 1;
        throw new Error("should not create proposal");
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerPlaceComponentsTool(
      mockToolContext(designer),
      contextResolver,
      conversation,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      { components: [{ componentId: "missing-part" }] },
    );

    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(proposalCount).toBe(0);
    expect(result.warnings[0]).toContain("missing-part");
  });
});
