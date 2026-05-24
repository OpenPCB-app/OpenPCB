import { useState, type ReactElement } from "react";
import type {
  AssistantPlacementApplyResult,
  AssistantPlacementProposal,
  AssistantToolEventDto,
  AssistantWriteProposalDto,
} from "../../../../sdks/assistant";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";

export function parsePlacementProposal(
  event: AssistantToolEventDto,
): AssistantPlacementProposal | null {
  if (event.toolName !== "designer_place_components") return null;
  if (event.status !== "succeeded" || !event.resultJson) return null;
  try {
    const parsed = JSON.parse(event.resultJson) as AssistantPlacementProposal;
    if (parsed.status === "pending_approval" && parsed.proposalId) return parsed;
  } catch {
    // ignore malformed tool payloads
  }
  return null;
}

export function PlacementProposalCard({
  event,
  proposal,
  assistantBaseUrl,
  statusRecord,
  onProposalChanged,
}: {
  event: AssistantToolEventDto;
  proposal: AssistantPlacementProposal;
  assistantBaseUrl?: string | null;
  statusRecord?: AssistantWriteProposalDto | null;
  onProposalChanged?: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);
  const status = statusRecord?.status ?? (finished ? "applied" : "pending");
  const isActionable = status === "pending" && !finished && Boolean(assistantBaseUrl);

  async function applyPlacement(allowPartial: boolean): Promise<void> {
    if (!assistantBaseUrl) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(
        `${assistantBaseUrl}/chats/${event.chatId}/write-proposals/${proposal.proposalId}/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowPartial }),
        },
      );
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as {
          detail?: string;
          title?: string;
        };
        throw new Error(problem.detail ?? problem.title ?? "Apply failed");
      }
      const result = (await response.json()) as AssistantPlacementApplyResult;
      setFinished(true);
      setActionMessage(`Applied ${result.applied.length} component(s).`);
      onProposalChanged?.();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rejectPlacement(): Promise<void> {
    if (!assistantBaseUrl) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(
        `${assistantBaseUrl}/chats/${event.chatId}/write-proposals/${proposal.proposalId}/reject`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Reject failed");
      setFinished(true);
      setActionMessage("Proposal rejected.");
      onProposalChanged?.();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-violet-800/70 bg-violet-950/25 p-3 text-xs text-slate-200">
      <div className="font-semibold text-violet-100">
        Placement proposal for {proposal.design.name}
      </div>
      <div className="text-[11px] text-slate-400">
        {proposal.placements.length} component(s) ready
        {proposal.skipped.length > 0 ? ` · ${proposal.skipped.length} skipped` : ""}
        {status !== "pending" ? ` · ${status}` : ""}
      </div>
      <ul className="space-y-1 text-[11px] text-slate-300">
        {proposal.placements.slice(0, 8).map((placement) => (
          <li key={`${placement.componentId}:${placement.positionNm.x}:${placement.positionNm.y}`}>
            {placement.componentName} at {placement.positionNm.x},{" "}
            {placement.positionNm.y} nm
          </li>
        ))}
      </ul>
      {proposal.placements.length > 8 ? (
        <div className="text-[11px] text-slate-500">
          +{proposal.placements.length - 8} more component(s)
        </div>
      ) : null}
      {proposal.skipped.length > 0 ? (
        <div className="rounded bg-amber-950/30 p-2 text-[11px] text-amber-200">
          {proposal.skipped.map((item) => (
            <div key={item.componentId}>
              {item.componentId}: {item.reason}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigateToModule("designer", proposal.design.id)}
          className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
        >
          View in Designer
        </button>
        <button
          type="button"
          disabled={busy || !isActionable}
          onClick={() => void applyPlacement(false)}
          className="rounded bg-violet-600 px-2 py-1 text-[11px] text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Apply
        </button>
        {proposal.requiresPartialConfirmation ? (
          <button
            type="button"
            disabled={busy || !isActionable}
            onClick={() => void applyPlacement(true)}
            className="rounded bg-amber-700 px-2 py-1 text-[11px] text-white hover:bg-amber-600 disabled:opacity-50"
          >
            Apply valid only
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !isActionable}
          onClick={() => void rejectPlacement()}
          className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {actionMessage ? (
        <div className="text-[11px] text-slate-400">{actionMessage}</div>
      ) : null}
    </div>
  );
}
