import { describe, expect, test } from "bun:test";
import type {
  AssistantWriteApplyResult,
  AssistantWriteProposalDto,
  AssistantWriteProposalEnvelope,
} from "../../../sdks/assistant/types";

describe("assistant generic write proposal contracts", () => {
  test("wraps domain payloads in a generic proposal envelope", () => {
    const envelope: AssistantWriteProposalEnvelope<{ placementCount: number }> = {
      id: "proposal-1",
      kind: "designer_place_components",
      toolName: "designer_place_components",
      title: "Place components",
      summary: "Place one LED on the schematic.",
      riskLevel: "medium",
      designId: "design-1",
      baseRevision: 3,
      operations: [
        {
          id: "op-1",
          kind: "designer.place_part",
          title: "Place LED",
          summary: "Place LED at origin.",
          riskLevel: "medium",
          payload: { componentId: "led" },
          warnings: [],
        },
      ],
      payload: { placementCount: 1 },
      sources: [
        { id: "design_design-1", kind: "design", label: "Demo", refId: "design-1" },
      ],
      warnings: [],
      createdByToolCallId: "call-1",
    };

    expect(envelope.operations[0]?.kind).toBe("designer.place_part");
    expect(envelope.payload.placementCount).toBe(1);
  });

  test("proposal DTO exposes generic metadata alongside legacy payload", () => {
    const dto: AssistantWriteProposalDto = {
      id: "proposal-1",
      chatId: "chat-1",
      toolEventId: null,
      kind: "custom_future_kind",
      status: "partial",
      designId: "design-1",
      baseRevision: null,
      toolName: "future_tool",
      title: "Future proposal",
      summary: "A future proposal kind.",
      riskLevel: "low",
      operations: [],
      sources: [],
      warnings: [],
      proposal: { legacy: true },
      envelope: null,
      applyResult: null,
      createdAt: "created",
      updatedAt: "updated",
    };

    expect(dto.kind).toBe("custom_future_kind");
    expect(dto.status).toBe("partial");
    expect(dto.riskLevel).toBe("low");
  });

  test("apply results can represent partial multi-operation failure", () => {
    const result: AssistantWriteApplyResult = {
      status: "partial",
      appliedCount: 1,
      skippedCount: 0,
      failedCount: 1,
      stoppedAtOperationId: "op-2",
      operations: [
        { operationId: "op-1", status: "applied", revisionAfter: 4 },
        { operationId: "op-2", status: "failed", error: "revision conflict" },
      ],
      message: "Stopped after op-2 failed.",
    };

    expect(result.status).toBe("partial");
    expect(result.operations[1]?.status).toBe("failed");
  });
});
