import type { ReactElement } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { MarkdownContent } from "../../../../shared/frontend/markdown";
import { useTheme } from "../../../../core/frontend/src/providers/ThemeProvider";
import type {
  AssistantMessage,
  AssistantToolEventDto,
  AssistantWriteProposalDto,
} from "../../../../sdks/assistant";
import { ToolCard } from "./ToolCard";
import {
  PlacementProposalCard,
  parsePlacementProposal,
} from "./PlacementProposalCard";
import {
  AssistantRunStatusCard,
  type ActiveRunState,
} from "./AssistantRunStatusCard";
import {
  ComponentResultsBlock,
  type ComponentResultsPayload,
} from "./ComponentResultCard";
import { BomResultCard, type BomResultPayload } from "./BomResultCard";
import { GenericProposalCard } from "./GenericProposalCard";
import { toolDisplay } from "../../../../shared/frontend/assistant/tool-display-names";
import { toolDurationMs } from "./chat-format";

const PROSE_CLASSES = [
  "prose",
  "prose-sm",
  "dark:prose-invert",
  "max-w-none",
  "prose-p:my-2",
  "prose-headings:mt-4",
  "prose-headings:mb-2",
  "prose-headings:text-slate-900",
  "dark:prose-headings:text-slate-100",
  "prose-li:my-0.5",
  "prose-ul:my-2",
  "prose-ol:my-2",
  "prose-pre:bg-slate-100",
  "dark:prose-pre:bg-slate-950/80",
  "prose-pre:border",
  "prose-pre:border-slate-200",
  "dark:prose-pre:border-slate-800",
  "prose-code:bg-violet-500/10",
  "dark:prose-code:bg-violet-500/15",
  "prose-code:text-violet-700",
  "dark:prose-code:text-violet-200",
  "prose-code:font-mono",
  "prose-code:px-1",
  "prose-code:py-0.5",
  "prose-code:rounded",
  "prose-code:before:content-none",
  "prose-code:after:content-none",
  "prose-table:text-xs",
  "prose-table:w-full",
  "prose-th:bg-slate-100",
  "dark:prose-th:bg-slate-800/60",
  "prose-th:px-2",
  "prose-th:py-1",
  "prose-th:text-left",
  "prose-td:px-2",
  "prose-td:py-1",
  "prose-td:border",
  "prose-td:border-slate-200",
  "dark:prose-td:border-slate-800",
  "prose-th:border",
  "prose-th:border-slate-200",
  "dark:prose-th:border-slate-800",
  "prose-a:text-violet-600",
  "dark:prose-a:text-violet-400",
  "hover:prose-a:text-violet-700",
  "dark:hover:prose-a:text-violet-300",
  "prose-blockquote:border-l-violet-300",
  "dark:prose-blockquote:border-l-violet-700",
  "prose-blockquote:text-slate-600",
  "dark:prose-blockquote:text-slate-300",
].join(" ");

const COMPACT_PROSE_CLASSES = [
  "prose",
  "prose-sm",
  "dark:prose-invert",
  "max-w-none",
  "break-words",
  "prose-p:my-2",
  "prose-headings:mt-3",
  "prose-headings:mb-1.5",
  "prose-pre:max-w-full",
  "prose-pre:overflow-x-auto",
  "prose-pre:bg-slate-100",
  "dark:prose-pre:bg-slate-950/80",
  "prose-code:break-words",
  "prose-code:bg-violet-500/10",
  "prose-code:text-violet-700",
  "dark:prose-code:text-violet-300",
  "prose-code:font-mono",
  "prose-code:before:content-none",
  "prose-code:after:content-none",
  "prose-table:text-xs",
  "prose-a:text-violet-600",
  "dark:prose-a:text-violet-400",
].join(" ");

/**
 * Defensive: strip <response>…</response> envelopes and stray `--->` artifacts
 * some local models emit when chat templates leak. Keeps real markdown intact.
 */
function stripResponseWrapper(raw: string): string {
  let text = raw.trim();
  text = text
    .replace(/^<response>\s*/i, "")
    .replace(/\s*<\/response>\s*$/i, "");
  text = text.replace(/^-{2,}>\s*$/gm, "");
  return text.trim();
}

function extractComponentResults(
  events: AssistantToolEventDto[],
): ComponentResultsPayload[] {
  const out: ComponentResultsPayload[] = [];
  for (const event of events) {
    if (event.toolName !== "library_search_components") continue;
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as ComponentResultsPayload;
      if (Array.isArray(parsed.results)) out.push(parsed);
    } catch {
      // ignore
    }
  }
  return out;
}

function extractBomResults(
  events: AssistantToolEventDto[],
): BomResultPayload[] {
  const out: BomResultPayload[] = [];
  for (const event of events) {
    if (event.toolName !== "library_resolve_bom") continue;
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as BomResultPayload;
      if (Array.isArray(parsed.items)) out.push(parsed);
    } catch {
      // ignore malformed tool payloads
    }
  }
  return out;
}

function extractPlacementProposals(events: AssistantToolEventDto[]): Array<{
  event: AssistantToolEventDto;
  proposal: NonNullable<ReturnType<typeof parsePlacementProposal>>;
}> {
  return events.flatMap((event) => {
    const proposal = parsePlacementProposal(event);
    return proposal ? [{ event, proposal }] : [];
  });
}

function extractGenericToolProposals(
  events: AssistantToolEventDto[],
  writeProposals: AssistantWriteProposalDto[],
): AssistantWriteProposalDto[] {
  const recordsById = new Map(
    writeProposals.map((record) => [record.id, record]),
  );
  const out: AssistantWriteProposalDto[] = [];
  for (const event of events) {
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as {
        id?: string;
        kind?: string;
        designId?: string;
        baseRevision?: number | null;
      };
      if (
        !parsed.id ||
        !parsed.kind ||
        parsed.kind === "designer_place_components"
      ) {
        continue;
      }
      const record = recordsById.get(parsed.id);
      out.push(
        record
          ? { ...record, toolEventId: record.toolEventId ?? event.id }
          : ({
              id: parsed.id,
              chatId: event.chatId,
              toolEventId: event.id,
              kind: parsed.kind,
              status: "pending",
              designId: parsed.designId ?? "",
              baseRevision: parsed.baseRevision ?? null,
              toolName: event.toolName,
              title: null,
              summary: null,
              riskLevel: null,
              operations: [],
              sources: event.sources,
              warnings: [],
              proposal: parsed,
              envelope: null,
              applyResult: null,
              createdAt: event.createdAt,
              updatedAt: event.updatedAt,
            } as AssistantWriteProposalDto),
      );
    } catch {
      // ignore malformed tool result
    }
  }
  return out;
}

/**
 * Drop component-search hits already represented by another result block (a BOM
 * selection or a placement proposal) or by an earlier component block, so the
 * same part is never shown in two "Components from library" cards. A block with
 * no remaining hits is removed unless it carries "no local match" guidance.
 */
function dedupeComponentBlocks(
  blocks: ComponentResultsPayload[],
  claimedComponentIds: Set<string>,
): ComponentResultsPayload[] {
  const seen = new Set(claimedComponentIds);
  const out: ComponentResultsPayload[] = [];
  for (const block of blocks) {
    const results = block.results.filter((hit) => {
      if (seen.has(hit.componentId)) return false;
      seen.add(hit.componentId);
      return true;
    });
    if (results.length > 0 || block.noLocalMatch)
      out.push({ ...block, results });
  }
  return out;
}

/** Compact latency for the collapsed Tools summary line (e.g. `17ms`, `1.2s`). */
function formatMsShort(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** One-line trust trail for the collapsed Tools block: `name · src · ms`. */
function toolsSummaryLine(events: AssistantToolEventDto[]): string {
  const totalSrc = events.reduce((n, event) => n + event.sources.length, 0);
  const totalMs = events.reduce(
    (n, event) => n + (toolDurationMs(event.createdAt, event.updatedAt) ?? 0),
    0,
  );
  const head =
    events.length === 1 && events[0]
      ? toolDisplay(events[0].toolName).label
      : `${events.length} tools`;
  const parts = [head];
  if (totalSrc > 0) parts.push(`${totalSrc} src`);
  if (totalMs > 0) parts.push(formatMsShort(totalMs));
  return parts.join(" · ");
}

export function MessageCard({
  message,
  toolEvents = [],
  loading = false,
  runState,
  assistantBaseUrl,
  backendURL,
  writeProposals = [],
  onProposalChanged,
  onStopRun,
  onRetryRun,
  onSendPrompt,
  compact = false,
}: {
  message: AssistantMessage;
  toolEvents?: AssistantToolEventDto[];
  loading?: boolean;
  runState?: ActiveRunState | null;
  assistantBaseUrl?: string | null;
  backendURL?: string | null;
  writeProposals?: AssistantWriteProposalDto[];
  onProposalChanged?: (change: {
    kind: "applied" | "rejected";
    designId: string;
    revision?: number;
  }) => void;
  onStopRun?: (run: ActiveRunState) => void;
  onRetryRun?: (run: ActiveRunState) => void;
  /** Send a follow-up prompt — result-block CTAs use this to make the model
   *  dispatch a Propose-level command (e.g. designer_place_components). */
  onSendPrompt?: (prompt: string) => void;
  compact?: boolean;
}): ReactElement {
  const { mode } = useTheme();
  const isUser = message.role === "user";
  const cleanedContent = isUser
    ? message.content
    : stripResponseWrapper(message.content);
  const hasContent = cleanedContent.length > 0;
  const reasoning = isUser ? undefined : message.metadata?.ai?.reasoning;
  const truncated = !isUser && message.metadata?.ai?.truncated === true;
  const componentBlocks = isUser ? [] : extractComponentResults(toolEvents);
  const bomBlocks = isUser ? [] : extractBomResults(toolEvents);
  const placementBlocks = isUser ? [] : extractPlacementProposals(toolEvents);
  const placementIds = new Set(
    placementBlocks.map(({ proposal }) => proposal.proposalId),
  );
  const toolEventIds = new Set(toolEvents.map((event) => event.id));
  const genericProposals = isUser
    ? []
    : extractGenericToolProposals(toolEvents, writeProposals).filter(
        (record) => !placementIds.has(record.id),
      );
  const proposalToolEventIds = new Set([
    ...placementBlocks.map(({ event }) => event.id),
    ...genericProposals.flatMap((proposal) =>
      proposal.toolEventId ? [proposal.toolEventId] : [],
    ),
  ]);
  const visibleToolEvents = toolEvents.filter(
    (event) => !proposalToolEventIds.has(event.id),
  );
  const terminalRun =
    !!runState &&
    ["failed", "cancelled", "paused", "disconnected"].includes(runState.status);
  // Actively working = the inline indicator owns the loading UI; result blocks
  // stay hidden until prose finishes (status cleared on completion by the host).
  const runWorking =
    !!runState && !terminalRun && runState.status !== "completed";
  const isActive = !isUser && (loading || runWorking);
  const isStreaming = isActive;
  const showResults = !isActive;
  // Parts already shown in an authoritative result block (BOM table / placement
  // proposal). Component-search cards repeating these are duplicates → filtered.
  const claimedComponentIds = new Set<string>();
  for (const bom of bomBlocks)
    for (const item of bom.items)
      if (item.selected) claimedComponentIds.add(item.selected.componentId);
  for (const { proposal } of placementBlocks)
    for (const placement of proposal.placements)
      claimedComponentIds.add(placement.componentId);
  const dedupedComponentBlocks = isUser
    ? []
    : dedupeComponentBlocks(componentBlocks, claimedComponentIds);
  // Single status label for the one inline indicator.
  const loadingStatus = "Working…";

  // System messages (e.g. provider-failure / retry notices) → warning banner,
  // visually distinct from assistant content. Persists in the thread as history.
  if (message.role === "system") {
    return (
      <div className={compact ? "px-3 py-2" : "px-4 py-3"}>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-status-warning-soft px-3 py-2 text-xs text-status-warning dark:border-amber-800/50">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{cleanedContent}</span>
        </div>
      </div>
    );
  }

  // User messages: right-aligned bubble (iMessage-style) for instant scan.
  if (isUser) {
    return (
      <div
        className={`flex min-w-0 justify-end ${compact ? "px-3 py-3" : "px-4 py-4"}`}
      >
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[10px_10px_2px_10px] border border-violet-300/40 bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 dark:border-violet-700/40 dark:text-slate-100">
          {cleanedContent}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-0 ${compact ? "gap-3 px-3 py-4" : "gap-3 px-4 py-6"}`}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Assistant
          </span>
        </div>
        {/* 1 · Reasoning — how it thought. Collapsed by default; the inline
            indicator below keeps the bubble from reading blank while thinking. */}
        {reasoning ? (
          <details className="group">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-700 dark:hover:text-slate-300 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              Reasoning
            </summary>
            <div className="mt-1.5 whitespace-pre-wrap break-words pl-4 text-[11px] leading-relaxed text-slate-500">
              {reasoning}
            </div>
          </details>
        ) : null}
        {/* 2 · Tools used — what it did. Collapsed by default behind a one-line
            summary (name · src · ms); omitted entirely when no tools ran. */}
        {visibleToolEvents.length > 0 ? (
          <details className="group">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-700 dark:hover:text-slate-300 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
              <Wrench className="h-3 w-3 shrink-0 text-violet-500 dark:text-violet-400" />
              <span className="truncate">
                {toolsSummaryLine(visibleToolEvents)}
              </span>
            </summary>
            <div className="mt-2 space-y-1.5">
              {visibleToolEvents.map((event) => (
                <ToolCard key={event.id} event={event} compact={compact} />
              ))}
            </div>
          </details>
        ) : null}
        {/* 3 · Message prose — the answer, streamed first, before any result. */}
        {hasContent ? (
          <MarkdownContent
            className={compact ? COMPACT_PROSE_CLASSES : PROSE_CLASSES}
            streaming={isStreaming}
            mermaidTheme={mode === "dark" ? "dark" : "light"}
          >
            {cleanedContent}
          </MarkdownContent>
        ) : null}
        {/* Exactly one inline loading indicator — no border, no dots, Stop inline.
            Sits at the active block (body caret) as prose streams. */}
        {isActive ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500 dark:text-violet-400" />
            <span>{loadingStatus}</span>
            {runState && onStopRun ? (
              <button
                type="button"
                onClick={() => onStopRun(runState)}
                className="font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
              >
                Stop
              </button>
            ) : null}
          </div>
        ) : null}
        {/* 4 · Result blocks — BOM / component / spec, inline at the END, only
            after prose finishes. De-duplicated so a part shown in a BOM table or
            placement proposal never repeats as a "Components from library" card. */}
        {showResults && dedupedComponentBlocks.length > 0 ? (
          <div className="space-y-3">
            {dedupedComponentBlocks.map((data, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-violet-400">
                  Components from library
                </div>
                <ComponentResultsBlock
                  data={data}
                  compact={compact}
                  onSendPrompt={onSendPrompt}
                />
              </div>
            ))}
          </div>
        ) : null}
        {showResults && bomBlocks.length > 0 ? (
          <div className="space-y-3">
            {bomBlocks.map((data, idx) => (
              <BomResultCard
                key={idx}
                data={data}
                compact={compact}
                onSendPrompt={onSendPrompt}
              />
            ))}
          </div>
        ) : null}
        {/* 5 · Actions — command-based CTAs (Apply / Add to schematic), last. */}
        {showResults && placementBlocks.length > 0 ? (
          <div className="space-y-3">
            {placementBlocks.map(({ event, proposal }) => (
              <PlacementProposalCard
                key={proposal.proposalId}
                event={event}
                proposal={proposal}
                assistantBaseUrl={assistantBaseUrl}
                backendURL={backendURL}
                statusRecord={
                  writeProposals.find(
                    (record) => record.id === proposal.proposalId,
                  ) ?? null
                }
                onProposalChanged={onProposalChanged}
                compact={compact}
              />
            ))}
          </div>
        ) : null}
        {showResults && genericProposals.length > 0 ? (
          <div className="space-y-3">
            {genericProposals.map((proposal) => (
              <GenericProposalCard
                key={proposal.id}
                proposal={proposal}
                assistantBaseUrl={assistantBaseUrl}
                onProposalChanged={onProposalChanged}
                compact={compact}
              />
            ))}
          </div>
        ) : null}
        {truncated ? (
          <div className="flex items-center gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Response may be truncated (token limit reached).
          </div>
        ) : null}
        {/* Terminal runs (failed / cancelled / paused / disconnected) keep the
            retry affordance; active runs use the inline indicator above. */}
        {terminalRun && runState ? (
          <AssistantRunStatusCard
            run={runState}
            onStop={() => onStopRun?.(runState)}
            onRetry={() => onRetryRun?.(runState)}
          />
        ) : null}
      </div>
    </div>
  );
}
