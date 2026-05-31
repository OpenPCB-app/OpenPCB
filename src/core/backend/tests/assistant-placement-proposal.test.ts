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
  isAssistantProposalApplyError,
  makeDesignerCreateDesignTool,
  makeDesignerGetSchematicConnectivityTool,
  makeDesignerPlaceComponentsTool,
  makeDesignerProposeSchematicDeletionsTool,
  makeDesignerProposeSchematicEditsTool,
  makeDesignerProposeSchematicUpdatesTool,
  makeDesignerProposeSchematicWiresTool,
} from "../../../modules/assistant/backend/tools/designer-tools";
import { applyAssistantWriteProposal } from "../../../modules/assistant/backend/proposals/proposal-apply-service";
import type { ConversationStore } from "../../../modules/assistant/backend/conversation-store";
import { AssistantWriteSessionPolicy } from "../../../modules/assistant/backend/write-session-policy";

function proposal(
  overrides: Partial<AssistantPlacementProposal> = {},
): AssistantPlacementProposal {
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
    async dispatchCommand(
      _designId: string,
      envelope: DesignerCommandEnvelope,
    ) {
      nextRevision += 1;
      if (envelope.command.type !== "place_part")
        throw new Error("unexpected command");
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

  test("annotates placed parts when value/properties are present", async () => {
    const commands: DesignerCommandEnvelope["command"][] = [];
    let nextRevision = 7;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 7,
            createdAt: "now",
            updatedAt: "now",
          },
          schematic: null,
          pcb: null,
        };
      },
      async dispatchCommand(
        _designId: string,
        envelope: DesignerCommandEnvelope,
      ) {
        commands.push(envelope.command);
        nextRevision += 1;
        return {
          ok: true,
          revision: nextRevision,
          createdEntityId:
            envelope.command.type === "place_part" ? "created-part-1" : null,
        };
      },
    } as unknown as DesignerSDK;

    const result = await applyDesignerPlaceComponentsProposal({
      designer,
      proposal: proposal({
        placements: [
          {
            componentId: "cmp-1",
            componentName: "LED",
            positionNm: { x: 0, y: 0 },
            rotationDeg: 0,
            mirrored: false,
            value: "red",
            properties: { role: "indicator" },
            warnings: [],
          },
        ],
      }),
      designId: "design-1",
      baseRevision: 7,
      allowPartial: false,
    });

    expect(result.applied).toHaveLength(1);
    expect(commands.map((command) => command.type)).toEqual([
      "place_part",
      "update_part_properties",
    ]);
    const update = commands[1];
    expect(update?.type).toBe("update_part_properties");
    if (update?.type === "update_part_properties") {
      expect(update.partId).toBe("created-part-1");
      expect(update.value).toBe("red");
      expect(update.propertiesJson).toEqual({
        role: "indicator",
        intendedValue: "red",
      });
    }
  });

  test("reports partial apply result when a later placement fails", async () => {
    let calls = 0;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 7,
            createdAt: "now",
            updatedAt: "now",
          },
          schematic: null,
          pcb: null,
        };
      },
      async dispatchCommand(
        _designId: string,
        envelope: DesignerCommandEnvelope,
      ) {
        calls += 1;
        if (calls === 2) {
          return {
            ok: false,
            code: "VALIDATION_FAILED",
            message: "bad placement",
          };
        }
        return {
          ok: true,
          revision: 7 + calls,
          createdEntityId: `part-${envelope.command.type}`,
        };
      },
    } as unknown as DesignerSDK;

    try {
      await applyDesignerPlaceComponentsProposal({
        designer,
        proposal: proposal(),
        designId: "design-1",
        baseRevision: 7,
        allowPartial: false,
      });
      throw new Error("expected apply to fail");
    } catch (err) {
      expect(isAssistantProposalApplyError(err)).toBe(true);
      if (isAssistantProposalApplyError(err)) {
        const applyResult = err.applyResult as {
          status: string;
          applied: unknown[];
          results: unknown[];
          message: string;
        };
        expect(applyResult.status).toBe("partial");
        expect(applyResult.applied).toHaveLength(1);
        expect(applyResult.results).toHaveLength(2);
        expect(applyResult.message).toContain("Failed to place Capacitor");
      }
    }
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
  test("creates a pending placement proposal for resolved components", async () => {
    let storedProposal: unknown = null;
    let storedEnvelope: unknown = null;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 3,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return {
          designId: "design-1",
          revision: 3,
          parts: [],
          wires: [],
          labels: [],
          primitives: [],
          junctions: [],
          nets: [],
        };
      },
      async resolveLibraryComponentForPlacement(componentId: string) {
        return {
          component: {
            id: componentId,
            name: componentId === "cmp-led" ? "LED" : "Resistor",
            description: "component",
            symbolId: `${componentId}.sym`,
            footprintId: `${componentId}.fp`,
            tags: [],
            isBuiltin: false,
          },
          symbol: { id: `${componentId}.sym`, name: "Symbol", data: {} },
          footprint: { id: `${componentId}.fp`, name: "Footprint", data: {} },
        };
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
      createWriteProposal(input: { proposal: unknown; envelope?: unknown }) {
        storedProposal = input.proposal;
        storedEnvelope = input.envelope;
        return { id: "stored-proposal" };
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
      {
        components: [
          { componentId: "cmp-led", quantity: 2, value: "red" },
          { componentId: "cmp-res", value: "330Ω" },
        ],
        layout: { columns: 2 },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("pending_approval");
    expect(result.data?.placements).toHaveLength(3);
    expect(result.data?.placements[0]?.componentName).toBe("LED");
    expect(result.data?.placements[0]?.value).toBe("red");
    expect(result.data?.design.revision).toBe(3);
    expect(storedProposal).toEqual(result.data);
    expect(storedEnvelope).toMatchObject({
      id: result.data?.proposalId,
      kind: "designer_place_components",
      toolName: "designer_place_components",
      title: "Place 3 component(s)",
      riskLevel: "medium",
      payload: result.data,
    });
    expect(
      (storedEnvelope as { operations?: Array<{ kind: string }> }).operations,
    ).toHaveLength(3);
    expect(
      (storedEnvelope as { operations?: Array<{ kind: string }> })
        .operations?.[0]?.kind,
    ).toBe("designer.place_part");
    expect(result.sources.some((source) => source.kind === "design")).toBe(
      true,
    );
    expect(
      result.sources.filter((source) => source.kind === "library-component"),
    ).toHaveLength(3);
  });

  test("auto-applies placement proposal when session policy allows it", async () => {
    const statuses: Array<{ status: string; applyResult: unknown }> = [];
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 3,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return {
          designId: "design-1",
          revision: 3,
          parts: [],
          wires: [],
          labels: [],
          primitives: [],
          junctions: [],
          nets: [],
        };
      },
      async resolveLibraryComponentForPlacement(componentId: string) {
        return {
          component: {
            id: componentId,
            name: "LED",
            description: "component",
            symbolId: `${componentId}.sym`,
            footprintId: `${componentId}.fp`,
            tags: [],
            isBuiltin: false,
          },
          symbol: { id: `${componentId}.sym`, name: "Symbol", data: {} },
          footprint: { id: `${componentId}.fp`, name: "Footprint", data: {} },
        };
      },
      async dispatchCommand() {
        return { ok: true, revision: 4, createdEntityId: "part-1" };
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
        return { id: "stored-proposal" };
      },
      updateWriteProposalStatus(
        _chatId: string,
        _proposalId: string,
        status: string,
        applyResult: unknown,
      ) {
        statuses.push({ status, applyResult });
        return { id: "stored-proposal" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerPlaceComponentsTool(
      mockToolContext(designer),
      contextResolver,
      conversation,
      {
        isSessionAutoApplyAllowed() {
          return true;
        },
      },
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      { components: [{ componentId: "cmp-led" }] },
    );

    expect(result.ok).toBe(true);
    expect(statuses[0]?.status).toBe("applied");
    expect(
      (statuses[0]?.applyResult as { applied?: unknown[] }).applied,
    ).toHaveLength(1);
  });

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

describe("assistant schematic edit proposal tool", () => {
  test("creates a generic schematic edit proposal", async () => {
    let storedEnvelope: unknown = null;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async resolveLibraryComponentForPlacement(componentId: string) {
        return {
          component: {
            id: componentId,
            name: "LED",
            description: "component",
            symbolId: `${componentId}.sym`,
            footprintId: `${componentId}.fp`,
            tags: [],
            isBuiltin: false,
          },
          symbol: { id: `${componentId}.sym`, name: "Symbol", data: {} },
          footprint: { id: `${componentId}.fp`, name: "Footprint", data: {} },
        };
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
      createWriteProposal(input: { envelope?: unknown }) {
        storedEnvelope = input.envelope;
        return { id: "stored-proposal" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicEditsTool(
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
      {
        title: "Add LED indicator",
        summary: "Place an LED indicator with a VCC label.",
        parts: [{ componentId: "cmp-led", positionNm: { x: 1, y: 1 } }],
        labels: [{ text: "LED_IN", positionNm: { x: 2_000_001, y: 0 } }],
        powerPorts: [
          { kind: "pwr", text: "+5V", positionNm: { x: 0, y: -2_000_001 } },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.kind).toBe("designer_schematic_edits");
    // Placing a part appends a trailing auto-arrange op (clean AI layout).
    expect(result.data?.operations).toHaveLength(4);
    expect(result.data?.operations.map((operation) => operation.kind)).toEqual([
      "designer.place_part",
      "designer.upsert_label",
      "designer.place_pwr_port",
      "designer.auto_arrange_schematic",
    ]);
    expect(storedEnvelope).toEqual(result.data);
  });

  test("skips wires whose pin ids are not in the current projection", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return {
          designId: "design-1",
          revision: 5,
          parts: [],
          wires: [],
          labels: [],
          primitives: [],
          junctions: [],
          nets: [],
        };
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
      createWriteProposal() {},
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicEditsTool(
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
      {
        title: "Wire invalid pins",
        summary: "Should not create invalid wire commands.",
        wires: [
          { source: { pinId: "missing-a" }, target: { pinId: "missing-b" } },
        ],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("Skipped wire");
  });

  test("auto-applies schematic proposal when session policy allows it", async () => {
    const statuses: Array<{ status: string; applyResult: unknown }> = [];
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async resolveLibraryComponentForPlacement(componentId: string) {
        return {
          component: {
            id: componentId,
            name: "LED",
            description: "component",
            symbolId: `${componentId}.sym`,
            footprintId: `${componentId}.fp`,
            tags: [],
            isBuiltin: false,
          },
          symbol: { id: `${componentId}.sym`, name: "Symbol", data: {} },
          footprint: { id: `${componentId}.fp`, name: "Footprint", data: {} },
        };
      },
      async dispatchCommand(
        _designId: string,
        envelope: DesignerCommandEnvelope,
      ) {
        return {
          ok: true,
          revision: envelope.command.type === "place_part" ? 6 : 7,
          createdEntityId: null,
        };
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
        return { id: "stored-proposal" };
      },
      updateWriteProposalStatus(
        _chatId: string,
        _proposalId: string,
        status: string,
        applyResult: unknown,
      ) {
        statuses.push({ status, applyResult });
        return { id: "stored-proposal" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicEditsTool(
      mockToolContext(designer),
      contextResolver,
      conversation,
      {
        isSessionAutoApplyAllowed() {
          return true;
        },
      },
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Add LED indicator",
        summary: "Place an LED and label.",
        parts: [{ componentId: "cmp-led", positionNm: { x: 0, y: 0 } }],
        labels: [{ text: "LED_IN", positionNm: { x: 2_000_000, y: 0 } }],
      },
    );

    expect(result.ok).toBe(true);
    expect(statuses[0]?.status).toBe("applied");
    // Placement-only (no wires/flags) does NOT append arrange — it would only
    // scatter parts with no connectivity. So just place_part + upsert_label.
    expect(
      (statuses[0]?.applyResult as { appliedCount?: number }).appliedCount,
    ).toBe(2);
  });

  test("applies generic schematic operations sequentially", async () => {
    const commands: string[] = [];
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand(
        _designId: string,
        envelope: DesignerCommandEnvelope,
      ) {
        commands.push(envelope.command.type);
        return {
          ok: true,
          revision: 5 + commands.length,
          createdEntityId: null,
        };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_edits",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_edits",
        designId: "design-1",
        baseRevision: 5,
        operations: [
          {
            id: "op-1",
            kind: "designer.upsert_label",
            title: "Label",
            summary: "Label",
            payload: {
              type: "upsert_label",
              text: "LED_IN",
              positionNm: { x: 0, y: 0 },
            },
          },
          {
            id: "op-2",
            kind: "designer.place_gnd_port",
            title: "GND",
            summary: "GND",
            payload: {
              type: "place_gnd_port",
              positionNm: { x: 0, y: 2_000_000 },
            },
          },
        ],
      },
    } as never;

    const result = await applyAssistantWriteProposal({
      designer,
      record,
      allowPartial: false,
    });

    expect((result as { status: string }).status).toBe("applied");
    expect(commands).toEqual(["upsert_label", "place_gnd_port"]);
  });

  test("returns partial status when schematic apply fails after an operation", async () => {
    let calls = 0;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand() {
        calls += 1;
        if (calls === 2) {
          return { ok: false, code: "VALIDATION_FAILED", message: "bad op" };
        }
        return { ok: true, revision: 5 + calls, createdEntityId: null };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_edits",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_edits",
        designId: "design-1",
        baseRevision: 5,
        operations: [
          {
            id: "op-1",
            kind: "designer.upsert_label",
            title: "Label",
            summary: "Label",
            payload: {
              type: "upsert_label",
              text: "A",
              positionNm: { x: 0, y: 0 },
            },
          },
          {
            id: "op-2",
            kind: "designer.upsert_label",
            title: "Label B",
            summary: "Label B",
            payload: {
              type: "upsert_label",
              text: "B",
              positionNm: { x: 1, y: 0 },
            },
          },
        ],
      },
    } as never;

    const result = (await applyAssistantWriteProposal({
      designer,
      record,
      allowPartial: false,
    })) as { status: string; appliedCount: number; failedCount: number };

    expect(result.status).toBe("partial");
    expect(result.appliedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  test("generic schematic apply annotates placed parts", async () => {
    const commands: DesignerCommandEnvelope["command"][] = [];
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand(
        _designId: string,
        envelope: DesignerCommandEnvelope,
      ) {
        commands.push(envelope.command);
        return {
          ok: true,
          revision: 5 + commands.length,
          createdEntityId:
            envelope.command.type === "place_part" ? "created-part" : null,
        };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_edits",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_edits",
        designId: "design-1",
        baseRevision: 5,
        warnings: [],
        operations: [
          {
            id: "op-1",
            kind: "designer.place_part",
            title: "Place LED",
            summary: "Place LED",
            payload: {
              type: "place_part",
              componentId: "cmp-led",
              positionNm: { x: 0, y: 0 },
            },
            updatePartAfterCreate: {
              value: "red",
              propertiesJson: { role: "indicator" },
            },
          },
        ],
      },
    } as never;

    const result = await applyAssistantWriteProposal({
      designer,
      record,
      allowPartial: false,
    });

    expect((result as { status: string }).status).toBe("applied");
    expect(commands).toEqual([
      {
        type: "place_part",
        componentId: "cmp-led",
        positionNm: { x: 0, y: 0 },
      },
      {
        type: "update_part_properties",
        partId: "created-part",
        value: "red",
        propertiesJson: { role: "indicator" },
      },
    ]);
    expect(
      (
        result as {
          operations: Array<{
            createdEntityId?: string | null;
            revisionAfter?: number;
          }>;
        }
      ).operations[0]?.createdEntityId,
    ).toBe("created-part");
    expect(
      (
        result as {
          operations: Array<{
            createdEntityId?: string | null;
            revisionAfter?: number;
          }>;
        }
      ).operations[0]?.revisionAfter,
    ).toBe(7);
  });

  test("schematic apply: non-destructive warned proposal applies the valid ops (partial) without confirmation", async () => {
    let dispatched = 0;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand() {
        dispatched += 1;
        return { ok: true, revision: 6, createdEntityId: "label-1" };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_edits",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_edits",
        toolName: "designer_propose_schematic_edits",
        riskLevel: "high",
        designId: "design-1",
        baseRevision: 5,
        warnings: ["Skipped wire: No pin RST on U1"],
        operations: [
          {
            id: "op-1",
            kind: "designer.upsert_label",
            title: "Label",
            summary: "Label",
            payload: {
              type: "upsert_label",
              text: "A",
              positionNm: { x: 0, y: 0 },
            },
          },
        ],
      },
    } as never;

    const result = (await applyAssistantWriteProposal({
      designer,
      record,
      allowPartial: false,
    })) as { status: string; appliedCount: number; skippedCount: number };
    expect(dispatched).toBe(1);
    expect(result.appliedCount).toBe(1);
    // One wire was dropped at build time → status is partial, not applied.
    expect(result.status).toBe("partial");
    expect(result.skippedCount).toBeGreaterThanOrEqual(1);
  });

  test("schematic apply: a truncated proposal applies its prefix as 'partial', never 'applied'", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand() {
        return { ok: true, revision: 6, createdEntityId: "label-1" };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_edits",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_edits",
        toolName: "designer_propose_schematic_edits",
        riskLevel: "medium",
        designId: "design-1",
        baseRevision: 5,
        // Truncation notice only — the dropped tail must keep status incomplete.
        warnings: ["Only the first 40 wire operation(s) were included."],
        operations: [
          {
            id: "op-1",
            kind: "designer.upsert_label",
            title: "Label",
            summary: "Label",
            payload: {
              type: "upsert_label",
              text: "A",
              positionNm: { x: 0, y: 0 },
            },
          },
        ],
      },
    } as never;

    const result = (await applyAssistantWriteProposal({
      designer,
      record,
      allowPartial: false,
    })) as { status: string; appliedCount: number };
    expect(result.appliedCount).toBe(1);
    expect(result.status).toBe("partial");
  });

  test("schematic apply: destructive warned proposal still requires partial confirmation", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 5,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async dispatchCommand() {
        return { ok: true, revision: 6 };
      },
    } as unknown as DesignerSDK;
    const record = {
      id: "proposal-1",
      kind: "designer_schematic_deletions",
      designId: "design-1",
      baseRevision: 5,
      envelope: {
        id: "proposal-1",
        kind: "designer_schematic_deletions",
        toolName: "designer_propose_schematic_deletions",
        riskLevel: "destructive",
        designId: "design-1",
        baseRevision: 5,
        warnings: ["Skipped delete: entity does not exist"],
        operations: [
          {
            id: "op-1",
            kind: "designer.delete_entity",
            title: "Delete",
            summary: "Delete",
            payload: {
              type: "delete_entity",
              entityId: "x",
              entityKind: "wire",
            },
          },
        ],
      },
    } as never;

    await expect(
      applyAssistantWriteProposal({ designer, record, allowPartial: false }),
    ).rejects.toThrow(/Confirm partial apply/);
  });
});

describe("assistant schematic connectivity and wiring tools", () => {
  const projection = {
    designId: "design-1",
    revision: 8,
    parts: [
      {
        id: "part-r1",
        componentId: "cmp-r",
        reference: "R1",
        value: "10k",
        rotationDeg: 0,
        mirrored: false,
        positionNm: { x: 0, y: 0 },
        symbol: {} as never,
        footprint: {} as never,
        propertiesJson: {},
        pins: [
          {
            id: "part-r1:1",
            originPinKey: "1",
            number: "1",
            name: "A",
            electricalType: "passive",
            unit: 1,
            localPositionNm: { x: 0, y: 0 },
            worldPositionNm: { x: 0, y: 0 },
          },
          {
            id: "part-r1:2",
            originPinKey: "2",
            number: "2",
            name: "B",
            electricalType: "passive",
            unit: 1,
            localPositionNm: { x: 10_000_000, y: 0 },
            worldPositionNm: { x: 10_000_000, y: 0 },
          },
        ],
      },
    ],
    wires: [
      {
        id: "wire-1",
        sourcePinId: "part-r1:1",
        targetPinId: "primitive:gnd-1",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 0, y: -10_000_000 },
        ],
      },
    ],
    labels: [
      { id: "label-1", text: "OLD", positionNm: { x: 4_000_000, y: 0 } },
    ],
    primitives: [
      {
        id: "gnd-1",
        kind: "gnd",
        positionNm: { x: 0, y: -10_000_000 },
        rotationDeg: 0,
      },
      {
        id: "pwr-1",
        kind: "pwr",
        railText: "VCC",
        positionNm: { x: 2_000_000, y: 10_000_000 },
        rotationDeg: 0,
      },
    ],
    junctions: [],
    nets: [
      {
        id: "net-1",
        name: "GND",
        pinIds: ["part-r1:1", "primitive:gnd-1"],
        wireIds: ["wire-1"],
        labelIds: [],
        primitiveIds: ["gnd-1"],
      },
    ],
  };

  function boundResolver(): ContextResolver {
    return {
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
  }

  test("connectivity tool returns pins with net names", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const tool = makeDesignerGetSchematicConnectivityTool(
      mockToolContext(designer),
      boundResolver(),
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      { includePins: true, includeNets: true, includeWires: true },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.parts[0]?.pins?.[0]?.netName).toBe("GND");
    expect(result.data?.primitives[0]?.pinId).toBe("primitive:gnd-1");
    expect(result.data?.wires?.[0]?.id).toBe("wire-1");
  });

  test("wiring tool creates pending wire and junction proposal", async () => {
    let storedEnvelope: unknown = null;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const conversation = {
      createWriteProposal(input: { envelope?: unknown }) {
        storedEnvelope = input.envelope;
        return { id: "proposal-1" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicWiresTool(
      mockToolContext(designer),
      boundResolver(),
      conversation,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Wire R1",
        summary: "Add a wire and a junction.",
        wires: [
          {
            source: { pinId: "part-r1:2" },
            target: { pinId: "primitive:gnd-1" },
          },
        ],
        junctions: [
          {
            source: { pinId: "part-r1:2" },
            wireId: "wire-1",
            targetPointNm: { x: 0, y: -4_000_000 },
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.kind).toBe("designer_schematic_wires");
    // Wiring appends a trailing auto-arrange op (moves parts for clean wiring).
    expect(result.data?.operations.map((operation) => operation.kind)).toEqual([
      "designer.create_wire",
      "designer.create_wire_junction",
      "designer.auto_arrange_schematic",
    ]);
    expect(storedEnvelope).toEqual(result.data);
  });

  test("wiring tool skips wires with unresolvable pins", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const tool = makeDesignerProposeSchematicWiresTool(
      mockToolContext(designer),
      boundResolver(),
      { createWriteProposal() {} } as unknown as ConversationStore,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Bad wires",
        summary: "Should skip invalid wires.",
        wires: [
          { source: { pinId: "missing" }, target: { pinId: "part-r1:1" } },
          { source: { ref: "R9", pin: "1" }, target: { pinId: "part-r1:2" } },
        ],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("Skipped wire");
  });

  test("schematic edits tool wires existing pins and skips unresolvable ones", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    let bindCount = 0;
    const contextResolver = {
      ...boundResolver(),
      async maybeAutoBindDesign() {
        bindCount += 1;
        return null;
      },
    } as unknown as ContextResolver;
    const conversation = {
      createWriteProposal() {
        return { id: "proposal-1" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicEditsTool(
      mockToolContext(designer),
      contextResolver,
      conversation,
    );

    const valid = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Wire primitive",
        summary: "Wire R1 to GND primitive.",
        wires: [
          {
            source: { pinId: "part-r1:2" },
            target: { pinId: "primitive:gnd-1" },
          },
        ],
      },
    );

    expect(valid.ok).toBe(true);
    expect(valid.data?.operations[0]?.payload).toEqual({
      type: "create_wire",
      sourcePinId: "part-r1:2",
      targetPinId: "primitive:gnd-1",
    });
    expect(bindCount).toBe(1);

    const invalid = await tool.execute(
      {
        runId: "run-2",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Bad wire",
        summary: "Should skip unresolvable wire.",
        wires: [
          { source: { ref: "R9", pin: "1" }, target: { pinId: "part-r1:2" } },
        ],
      },
    );

    expect(invalid.ok).toBe(false);
    expect(invalid.warnings.join("\n")).toContain("Skipped wire");
    expect(bindCount).toBe(1);
  });

  test("schematic updates tool proposes part label and primitive updates", async () => {
    let storedEnvelope: unknown = null;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const conversation = {
      createWriteProposal(input: { envelope?: unknown }) {
        storedEnvelope = input.envelope;
        return { id: "proposal-1" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicUpdatesTool(
      mockToolContext(designer),
      boundResolver(),
      conversation,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Tidy schematic",
        summary: "Move R1, update label, and rename power rail.",
        partUpdates: [
          {
            partId: "part-r1",
            positionNm: { x: 2_000_001, y: 0 },
            value: "22k",
          },
        ],
        labelUpdates: [
          { labelId: "label-1", positionNm: { x: 6_000_001, y: 0 } },
        ],
        primitiveUpdates: [
          { primitiveId: "pwr-1", text: "+5V", rotationDeg: 90 },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.kind).toBe("designer_schematic_updates");
    expect(
      result.data?.operations.map((operation) => operation.payload.type),
    ).toEqual([
      "move_part",
      "update_part_properties",
      "upsert_label",
      "rotate_primitive",
      "update_primitive_text",
    ]);
    expect(result.data?.operations[2]?.payload).toEqual({
      type: "upsert_label",
      labelId: "label-1",
      text: "OLD",
      positionNm: { x: 6_000_000, y: 0 },
    });
    expect(storedEnvelope).toEqual(result.data);
  });

  test("schematic updates tool skips invalid and immutable primitive text updates", async () => {
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const tool = makeDesignerProposeSchematicUpdatesTool(
      mockToolContext(designer),
      boundResolver(),
      { createWriteProposal() {} } as unknown as ConversationStore,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Bad updates",
        summary: "Should skip.",
        partUpdates: [{ partId: "missing", value: "1k" }],
        primitiveUpdates: [{ primitiveId: "gnd-1", text: "AGND" }],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("Skipped part update");
    expect(result.warnings.join("\n")).toContain("GND text is fixed");
  });

  test("schematic deletions tool creates destructive proposal", async () => {
    let storedEnvelope: unknown = null;
    const designer = {
      async getDesign() {
        return {
          head: {
            id: "design-1",
            name: "Demo",
            revision: 8,
            createdAt: "created",
            updatedAt: "updated",
          },
        };
      },
      async getSchematicProjection() {
        return projection;
      },
    } as unknown as DesignerSDK;
    const conversation = {
      createWriteProposal(input: { envelope?: unknown }) {
        storedEnvelope = input.envelope;
        return { id: "proposal-1" };
      },
    } as unknown as ConversationStore;
    const tool = makeDesignerProposeSchematicDeletionsTool(
      mockToolContext(designer),
      boundResolver(),
      conversation,
    );

    const result = await tool.execute(
      {
        runId: "run-1",
        chatId: "chat-1",
        bindings: [],
        limits: { profile: "small", maxBytes: 1024, maxItems: 10 },
      },
      {
        title: "Delete stale wire",
        summary: "Remove an old wire.",
        entities: [
          {
            entityId: "wire-1",
            entityKind: "wire",
            reason: "Wire is obsolete.",
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.kind).toBe("designer_schematic_deletions");
    expect(result.data?.riskLevel).toBe("destructive");
    expect(result.data?.operations[0]?.payload).toEqual({
      type: "delete_entity",
      entityId: "wire-1",
      entityKind: "wire",
    });
    expect(storedEnvelope).toEqual(result.data);
  });
});

describe("assistant write session policy", () => {
  test("session allowance only auto-applies up to allowed risk", () => {
    const policy = new AssistantWriteSessionPolicy();
    policy.allow({
      chatId: "chat-1",
      toolName: "designer_propose_schematic_edits",
      proposalKind: "designer_schematic_edits",
      riskLevel: "medium",
    });

    expect(
      policy.isAllowed({
        chatId: "chat-1",
        toolName: "designer_propose_schematic_edits",
        proposalKind: "designer_schematic_edits",
        riskLevel: "low",
      }),
    ).toBe(true);
    expect(
      policy.isAllowed({
        chatId: "chat-1",
        toolName: "designer_propose_schematic_edits",
        proposalKind: "designer_schematic_edits",
        riskLevel: "high",
      }),
    ).toBe(false);
  });
});
