import { ExternalLink, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { useTheme } from "../../../../core/frontend/src/providers/ThemeProvider";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";
import type {
  AssistantPlacementProposal,
  AssistantToolEventDto
} from "../../../../sdks/assistant";
import { Pill } from "../../../../shared/frontend/ui/pill";
import type { PresentedProposal } from "../agentkit-projections";
import { useProposalActions } from "./ProposalActions";
import { ProposalOutcome } from "./ProposalOutcome";
import { classifyComponentType } from "./component-type";
import { useSymbolThumbnails } from "./useSymbolThumbnails";

export function parsePlacementProposal(
  event: AssistantToolEventDto,
): AssistantPlacementProposal | null {
  if (event.toolName !== "designer_place_components") return null;
  if (event.status !== "succeeded" || !event.resultJson) return null;
  try {
    const parsed = JSON.parse(event.resultJson) as AssistantPlacementProposal;
    if (parsed.status === "pending_approval" && parsed.proposalId)
      return parsed;
  } catch {
    // ignore malformed tool payloads
  }
  return null;
}

export function PlacementProposalCard({
  event,
  proposal,
  assistantBaseUrl,
  backendURL,
  statusRecord,
  onProposalChanged,
  compact = false,
}: {
  event: AssistantToolEventDto;
  proposal: AssistantPlacementProposal;
  assistantBaseUrl?: string | null;
  /** Backend root (e.g. http://127.0.0.1:3000) — for library symbol previews. */
  backendURL?: string | null;
  statusRecord?: PresentedProposal | null;
  onProposalChanged?: (change: {
    kind: "applied" | "rejected";
    designId: string;
    revision?: number;
  }) => void;
  compact?: boolean;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actions = useProposalActions();
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);
  const { mode } = useTheme();
  const symbolIds = useSymbolThumbnails(
    proposal.placements.map((p) => p.componentId),
    backendURL,
  );
  // Collapse repeated parts (same componentId) into one row with a ×N count.
  const groupedPlacements = useMemo(() => {
    const map = new Map<
      string,
      {
        componentId: string;
        componentName: string;
        value?: string;
        count: number;
      }
    >();
    for (const p of proposal.placements) {
      const existing = map.get(p.componentId);
      if (existing) existing.count += 1;
      else
        map.set(p.componentId, {
          componentId: p.componentId,
          componentName: p.componentName,
          value: p.value,
          count: 1,
        });
    }
    return [...map.values()];
  }, [proposal.placements]);
  const status = statusRecord?.status === "partial" ? "partial" : statusRecord?.canonicalStatus ?? "pending";
  const isActionable =
    ["pending", "approved", "applying"].includes(status) && Boolean(actions);

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true); setActionMessage(null);
    try { await action(); }
    catch (cause) { setActionMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function applyPlacement(_allowPartial: boolean): Promise<void> {
    if (actions) await perform(() => actions.apply(proposal.proposalId));
  }
  async function rejectPlacement(): Promise<void> {
    if (actions) await perform(() => actions.reject(proposal.proposalId));
  }

  const statusPill =
    status === "applied" ? (
      <Pill tone="accent">Applied</Pill>
    ) : status === "rejected" ? (
      <Pill tone="neutral">Rejected</Pill>
    ) : isActionable ? (
      <Pill tone="success">Ready</Pill>
    ) : (
      <Pill tone="warning">{status}</Pill>
    );

  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-violet-300 bg-violet-50/80 text-xs text-slate-800 dark:border-violet-800/70 dark:bg-violet-950/25 dark:text-slate-200">
      {/* Header: title + status + navigation */}
      <div className="flex items-start justify-between gap-2 border-b border-violet-200/60 px-3 py-2.5 dark:border-violet-800/40">
        <div className="min-w-0">
          <div className="font-semibold text-violet-950 dark:text-violet-100">
            Add components to schematic
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            Add to{" "}
            <span className="text-slate-700 dark:text-slate-200">
              🔗 {proposal.design.name}
            </span>{" "}
            · {proposal.placements.length} part
            {proposal.placements.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {statusPill}
          <button
            type="button"
            onClick={() => navigateToModule("designer", proposal.design.id)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> Preview
          </button>
        </div>
      </div>

      {/* Component list — symbols only, no coordinates (schematic is logical) */}
      <ul className="divide-y divide-violet-100/60 px-3 py-1 dark:divide-violet-900/30">
        {groupedPlacements.slice(0, 10).map((group) => (
          <li
            key={group.componentId}
            className="flex items-center gap-2.5 py-1.5 text-[12px]"
          >
            <SymbolThumb
              symbolId={symbolIds.get(group.componentId) ?? undefined}
              backendURL={backendURL}
              mode={mode}
              fallback={
                classifyComponentType(group.componentName, group.value).icon
              }
            />
            <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
              {group.componentName}
            </span>
            {group.count > 1 ? (
              <span className="ml-auto shrink-0 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                ×{group.count}
              </span>
            ) : null}
          </li>
        ))}
        {groupedPlacements.length > 10 ? (
          <li className="py-1.5 text-[11px] text-slate-500">
            +{groupedPlacements.length - 10} more
          </li>
        ) : null}
      </ul>

      {proposal.skipped.length > 0 ? (
        <div className="mx-3 mb-2 rounded bg-status-warning-soft p-2 text-[11px] text-status-warning">
          {proposal.skipped.map((item) => (
            <div key={item.componentId}>
              {item.componentId}: {item.reason}
            </div>
          ))}
        </div>
      ) : null}

      <p className="px-3 pb-2 text-[11px] text-slate-500 dark:text-slate-400">
        Symbols only — no wires yet. Drag to rearrange after placement, then use
        the Wire tool.
      </p>

      {/* Action hierarchy: primary Add · Reject link; session-permission below */}
      <div className="flex items-center justify-end gap-3 border-t border-violet-200/60 px-3 py-2.5 dark:border-violet-800/40">
        {proposal.requiresPartialConfirmation ? (
          <button
            type="button"
            disabled={busy || actions?.busy || !isActionable}
            onClick={() => void applyPlacement(true)}
            className="text-[11px] text-slate-500 underline-offset-2 hover:underline disabled:opacity-50"
          >
            Add valid only
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || actions?.busy || !isActionable}
          onClick={() => void rejectPlacement()}
          className="text-[11px] text-slate-500 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy || actions?.busy || !isActionable}
          onClick={() => void applyPlacement(false)}
          className="rounded-control bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Add to schematic
        </button>
      </div>
      {statusRecord?.applyResult ? <div className="px-3 pb-2"><ProposalOutcome outcome={statusRecord.applyResult} /></div> : null}
      <div className="flex items-center justify-between border-t border-violet-200/40 px-3 py-1.5 dark:border-violet-900/30">
        {actionMessage ? (
          <span className="truncate text-[11px] text-slate-400">
            {actionMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Small schematic-symbol preview tile; falls back to a type icon. */
function SymbolThumb({
  symbolId,
  backendURL,
  mode,
  fallback: Fallback,
}: {
  symbolId?: string;
  backendURL?: string | null;
  mode: string;
  fallback: LucideIcon;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const url =
    symbolId && backendURL
      ? `${backendURL}/api/modules/library/symbols/${encodeURIComponent(symbolId)}/preview.svg?theme=${mode}`
      : null;
  return (
    <span className="flex h-7 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-violet-200/60 bg-white/60 dark:border-violet-900/40 dark:bg-slate-900/40">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-0.5 text-slate-700 dark:text-slate-200"
        />
      ) : (
        <Fallback className="h-3.5 w-3.5 text-violet-400" />
      )}
    </span>
  );
}
