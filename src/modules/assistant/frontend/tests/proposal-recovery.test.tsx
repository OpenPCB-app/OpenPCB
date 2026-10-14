// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProposalDto } from "agentkit/contracts";
import { projectProposal, type ProposalPresentation } from "../agentkit-projections";
import { GenericProposalCard } from "../components/GenericProposalCard";
import { ProposalActionsProvider, type ProposalActions } from "../components/ProposalActions";

vi.mock("../../../../core/frontend/src/stores/navigation-store", () => ({ useNavigationStore: () => vi.fn() }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function dto(status: ProposalDto["status"], outcome?: ProposalDto["outcome"]): ProposalDto {
  return { id: "proposal-1", chatId: "chat-1", scopeKey: "desktop:chat:chat-1:design:design-1", toolName: "designer_propose_schematic_edits",
    kind: "designer_schematic_edits", risk: "medium", status, warnings: [], truncated: false, createdAt: "2026-10-07T00:00:00.000Z",
    ...(outcome ? { outcome } : {}) };
}
const presentation = (outcome: ProposalPresentation["outcome"] = null): ProposalPresentation => ({ proposalId: "proposal-1", outcome,
  envelope: { id: "proposal-1", kind: "designer_schematic_edits", designId: "design-1", baseRevision: 0, title: "Add label",
    summary: "Label", toolName: "designer_propose_schematic_edits", riskLevel: "medium", operations: [], sources: [], warnings: [] } as never });

const actions: ProposalActions = { busy: false, apply: vi.fn(), reject: vi.fn(), allow: vi.fn(), revoke: vi.fn(), isAllowed: () => false };
async function render(proposal: ReturnType<typeof projectProposal>) {
  await act(async () => root.render(<ProposalActionsProvider value={actions}><GenericProposalCard proposal={proposal} /></ProposalActionsProvider>));
}
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;

test("a claimed apply without an outcome is a distinct, non-actionable recovering state", async () => {
  const recovering = projectProposal(dto("applying"), presentation());
  expect(recovering.status).toBe("recovering");
  await render(recovering);
  expect(container.textContent).toContain("Outcome unknown");
  expect(button("Apply").disabled).toBe(true);
  expect(button("Reject").disabled).toBe(true);
});

test("approved stays actionable and a known outcome replaces recovery", async () => {
  expect(projectProposal(dto("approved"), presentation()).status).toBe("pending");
  await render(projectProposal(dto("pending"), presentation()));
  expect(button("Apply").disabled).toBe(false);
  expect(container.textContent).not.toContain("Outcome unknown");
  const settled = projectProposal(dto("applying"), presentation({ status: "partial", appliedOps: 1, failedOps: [{ opIndex: 1, error: "INTERRUPTED" }] }));
  expect(settled.status).toBe("partial");
  expect(projectProposal(dto("applying", { status: "applied", appliedOps: 1, failedOps: [] })).status).not.toBe("recovering");
  await render(settled);
  expect(container.textContent).toContain("Outcome: partial");
  expect(container.textContent).not.toContain("Outcome unknown");
});
