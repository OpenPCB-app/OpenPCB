import type { ToolEventDto } from "agentkit/contracts";
import { useChat, useProposals, useRun } from "agentkit/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AssistantPromptPresetId } from "../../../../sdks/assistant";
import { committedChange, presetId, projectMessage, projectProposal, projectToolEvent, type ProposalPresentation } from "../agentkit-projections";
import { useAssistantCache } from "../AssistantClientProvider";
import { assistantRequest, jsonRequest } from "../client";
import type { ActiveRunState } from "../components/AssistantRunStatusCard";
import { useNativeAllowances } from "./useNativeAllowances";

const terminal = new Set(["completed", "failed", "cancelled", "interrupted", "incomplete"]);
type Change = { kind: "applied" | "rejected"; designId: string; revision?: number };
type Cache = ReturnType<typeof useAssistantCache>;
type Chat = ReturnType<typeof useChat>;
type Run = ReturnType<typeof useRun>;
type Proposals = ReturnType<typeof useProposals>;
type ActiveChat = { current: string | null };
type ErrorSetter = (error: string | null) => void;

function useConversationSelection(cache: Cache, chatId: string | null, draftKey: string) {
  const selectionKey = `openpcb.selection:${chatId ?? draftKey}`;
  const selection = cache.resources[selectionKey] as { chatId: string | null; providerId: string; model: string; preset: AssistantPromptPresetId } | undefined;
  const selected = cache.chats.find(item => item.id === chatId);
  const providerId = selection?.chatId === chatId ? selection.providerId : typeof selected?.metadata.providerId === "string" ? selected.metadata.providerId : cache.settings?.defaultProviderId ?? "";
  const selectedProvider = cache.providerDetails.find(item => item.id === providerId) ?? null;
  const model = selection?.chatId === chatId ? selection.model : typeof selected?.metadata.model === "string" ? selected.metadata.model : cache.settings?.defaultModel || selectedProvider?.defaultModel || "";
  const promptPresetId = selection?.chatId === chatId ? selection.preset : presetId(selected?.metadata.promptPresetId ?? cache.appSettings?.defaultPromptPresetId);
  const updateSelection = (next: Partial<{ providerId: string; model: string; preset: AssistantPromptPresetId }>) => cache.updateResource(selectionKey, previous => ({ chatId, providerId, model, preset: promptPresetId, ...(previous as typeof selection), ...next }));
  const setProviderId = (id: string) => updateSelection({ providerId: id, model: cache.providerDetails.find(item => item.id === id)?.defaultModel ?? "" });
  const inputKey = chatId ?? draftKey;
  const input = cache.drafts[inputKey] ?? "";
  const setInput = (text: string) => cache.setDraft(inputKey, text);
  const pendingKey = `openpcb.pending-draft:${chatId}`;
  const submitted = cache.resources[pendingKey] as { chatId: string; key: string; content: string; existing: string[]; providerId: string; model: string; preset: AssistantPromptPresetId } | undefined;
  const modelState = cache.providerState;
  const models = modelState.models[providerId] ?? [];
  useEffect(() => { if (providerId && !modelState.models[providerId]) void cache.loadModels(providerId); }, [providerId, modelState.models, cache.loadModels]);
  return {
    providerId, selectedProvider, model, promptPresetId, setProviderId, updateSelection,
    input, setInput, inputKey, pendingKey, submitted, modelState, models,
    setModel: (value: string) => updateSelection({ model: value }),
    setPromptPresetId: (value: AssistantPromptPresetId) => updateSelection({ preset: value })
  };
}

function useConversationDetails(cache: Cache, chat: Chat, run: Run, proposals: Proposals, chatId: string | null, activeChat: ActiveChat, setLocalError: ErrorSetter) {
  const scopedProposals = proposals.proposals.filter(item => item.chatId === chatId);
  const [tools, setTools] = useState<{ chatId: string | null; items: ToolEventDto[] }>({ chatId: null, items: [] });
  const [presentations, setPresentations] = useState<{ chatId: string | null; items: Record<string, ProposalPresentation> }>({ chatId: null, items: {} });
  const toolVersion = run.events.filter(event => event.type.startsWith("run.tool.")).length;
  const readDetails = useCallback(async (signal?: AbortSignal) => {
    if (!chatId) return;
    const events = await cache.client.listToolEvents({ chatId }, { signal });
    if (!signal?.aborted && activeChat.current === chatId) setTools({ chatId, items: events });
  }, [cache.client, chatId]);
  useEffect(() => {
    const controller = new AbortController();
    void readDetails(controller.signal).catch(cause => { if (!controller.signal.aborted) setLocalError(String(cause)); });
    return () => controller.abort();
  }, [readDetails, toolVersion, chat.phase]);
  const proposalVersion = scopedProposals.map(item => `${item.id}:${item.status}:${item.outcome?.status ?? ""}`).join("|");
  useEffect(() => {
    const controller = new AbortController();
    if (!chatId) return;
    void Promise.all(scopedProposals.map(async proposal => [proposal.id, await assistantRequest<ProposalPresentation>(cache.base, `/v1/proposals/${encodeURIComponent(proposal.id)}/presentation`, { signal: controller.signal })] as const))
      .then(items => { if (!controller.signal.aborted) setPresentations({ chatId, items: Object.fromEntries(items) }); })
      .catch(cause => { if (!controller.signal.aborted) setLocalError(String(cause)); });
    return () => controller.abort();
  }, [cache.base, chatId, proposalVersion]);
  useEffect(() => { if (chatId && proposals.proposals.some(item => item.chatId !== chatId)) void proposals.reload(); }, [chatId, proposals.proposals, proposals.reload]);
  useEffect(() => { if (toolVersion > 0) void proposals.reload(); }, [toolVersion, proposals.reload]);
  const visibleTools = tools.chatId === chatId ? tools.items : [];
  const visiblePresentations = presentations.chatId === chatId ? presentations.items : {};
  return { scopedProposals, visibleTools, visiblePresentations, readDetails, setPresentations };
}

type Details = ReturnType<typeof useConversationDetails>;
function useConversationProjection(chatId: string | null, chat: Chat, run: Run, runId: string | null, latestAssistant: Chat["messages"][number] | undefined, details: Details, onChanged?: (change: Change) => void) {
  const notified = useRef(new Set<string>());
  const messages = useMemo(() => chat.messages.map(projectMessage), [chat.messages]);
  const toolEvents = details.visibleTools.map(event => projectToolEvent(event, chat.messages, details.visiblePresentations));
  const writeProposals = details.scopedProposals.map(proposal => projectProposal(proposal, details.visiblePresentations[proposal.id], details.visibleTools));
  const toolEventsByMessage = new Map<string, typeof toolEvents>();
  for (const event of toolEvents) { if (event.messageId) toolEventsByMessage.set(event.messageId, [...(toolEventsByMessage.get(event.messageId) ?? []), event]); }
  useEffect(() => {
    for (const presentation of Object.values(details.visiblePresentations)) {
      const change = committedChange(presentation);
      const key = `${presentation.proposalId}:${presentation.outcome?.appliedOps}:${change?.revision}`;
      if (change && !notified.current.has(key)) { notified.current.add(key); onChanged?.({ kind: "applied", ...change }); }
    }
  }, [details.visiblePresentations, onChanged]);
  const phase = run.phase ?? chat.phase;
  const failure = [...run.events].reverse().find(event => event.type === "run.failed");
  const loading = chat.status === "loading" || (!!phase && !terminal.has(phase) && phase !== "waiting_approval");
  const selectedRun: ActiveRunState | null = runId && latestAssistant ? {
    chatId: chatId ?? "", taskId: runId, assistantMessageId: latestAssistant.id,
    status: phase === "settling" ? "finalizing" : phase ?? "queued", currentStage: phase === "waiting_approval" ? "Waiting for proposal decision." : phase === "interrupted" ? "Run interrupted. Continue explicitly." : phase === "incomplete" ? "Response incomplete." : phase === "cancelled" ? "Run stopped." : phase === "completed" ? "Completed" : phase === "failed" ? "Run failed." : phase === "settling" ? "Verifying result…" : "Assistant is working…",
    activeTools: details.visibleTools.filter(event => event.runId === runId).map(event => ({ callId: event.toolCallId, name: event.toolName, status: event.status })),
    lastError: run.error?.message ?? chat.error?.message ?? (failure?.type === "run.failed" ? failure.data.errorMessage : null), userMessageContent: "", startedAt: latestAssistant.createdAt, lastEventAt: run.events.at(-1)?.timestamp ?? latestAssistant.createdAt
  } : null;
  const verification = [...run.events].reverse().find(event => event.type === "run.verification");
  return { messages, toolEventsByMessage, writeProposals, selectedRun, verification, loading };
}

type Selection = ReturnType<typeof useConversationSelection>;
function useConversationSubmission(cache: Cache, chat: Chat, chatId: string | null, selection: Selection, loading: boolean) {
  const { submitted, input, inputKey, pendingKey, providerId, model, promptPresetId, modelState, selectedProvider } = selection;
  useEffect(() => {
    const pending = submitted;
    if (!pending || pending.chatId !== chatId) return;
    const accepted = chat.messages.some(message => message.role === "user" && message.metadata.optimistic !== true && !pending.existing.includes(message.id) && message.content === pending.content);
    if (accepted) { if ((cache.drafts[pending.key] ?? "").trim() === pending.content) cache.setDraft(pending.key, ""); cache.setResource(pendingKey, undefined); void cache.reloadChats(); }
  }, [cache, chat.messages, chatId]);
  const readyToSend = !cache.configLoading && !!cache.settings && !!selectedProvider?.enabled && !!model && !!modelState.models[providerId] && !loading && !chat.activeRunId;
  const canSend = !!chatId && readyToSend;
  const submit = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const content = (override ?? input).trim();
    if (!chatId || !content || !canSend) return;
    const snapshot = submitted?.content === content ? submitted : { providerId, model, preset: promptPresetId };
    cache.setResource(pendingKey, { chatId, key: inputKey, content, existing: chat.messages.map(message => message.id), ...snapshot });
    await chat.submit(content, { providerId: snapshot.providerId, model: snapshot.model, metadata: { promptPresetId: snapshot.preset } });
  };
  return { readyToSend, canSend, submit };
}

function useConversationActions(cache: Cache, chat: Chat, proposals: Proposals, chatId: string | null, activeChat: ActiveChat, details: Details, selection: Selection, setLocalError: ErrorSetter, onChanged?: (change: Change) => void) {
  const [toolFixBusy, setToolFixBusy] = useState(false);
  const apply = async (id: string) => {
    if (activeChat.current !== chatId) return;
    const item = details.scopedProposals.find(proposal => proposal.id === id);
    if (!item) throw new Error("Proposal is no longer available.");
    if (item.status === "pending" && !await proposals.approve(id)) throw new Error("Proposal approval failed. Retry to reconcile.");
    if (activeChat.current !== chatId) return;
    if (!await proposals.apply(id, `native:${id}`)) throw new Error("Proposal apply failed. Retry with the same operation identity.");
    if (activeChat.current !== chatId) return;
    const presentation = await assistantRequest<ProposalPresentation>(cache.base, `/v1/proposals/${encodeURIComponent(id)}/presentation`);
    if (activeChat.current !== chatId) return;
    details.setPresentations(previous => ({ chatId, items: { ...(previous.chatId === chatId ? previous.items : {}), [id]: presentation } }));
    await chat.reload();
  };
  const reject = async (id: string) => {
    if (activeChat.current !== chatId) return;
    if (!details.scopedProposals.some(proposal => proposal.id === id)) throw new Error("Proposal is no longer available.");
    const result = await proposals.reject(id);
    if (!result) throw new Error("Proposal rejection failed.");
    const designId = details.visiblePresentations[id]?.envelope.designId;
    if (designId && activeChat.current === chatId) onChanged?.({ kind: "rejected", designId });
  };
  const refreshChatModels = async () => { await selection.modelState.refreshModels(selection.providerId); await cache.reloadConfig(); };
  const fixTools = async (enable: boolean) => {
    setToolFixBusy(true);
    try { await assistantRequest(cache.base, `/providers/${encodeURIComponent(selection.providerId)}/${enable ? "tool-calling" : "capabilities/refresh"}`, enable ? jsonRequest("PUT", { mode: "on" }) : { method: "POST" }); await cache.reloadConfig(); }
    catch (cause) { setLocalError(String(cause)); } finally { setToolFixBusy(false); }
  };
  return { apply, reject, refreshChatModels, toolFixBusy, reprobeTools: () => fixTools(false), enableToolsAnyway: () => fixTools(true) };
}

export function useAssistantConversation(chatId: string | null, draftKey = "new", onChanged?: (change: Change) => void) {
  const cache = useAssistantCache();
  const chat = useChat(chatId);
  const proposals = useProposals(chatId);
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  const latestAssistant = [...chat.messages].reverse().find(message => message.role === "assistant" && message.metadata.internal !== true);
  const runId = chat.activeRunId ?? latestAssistant?.runId ?? null;
  const run = useRun(runId);
  const [localError, setLocalError] = useState<string | null>(null);
  const selection = useConversationSelection(cache, chatId, draftKey);
  const details = useConversationDetails(cache, chat, run, proposals, chatId, activeChat, setLocalError);
  const projection = useConversationProjection(chatId, chat, run, runId, latestAssistant, details, onChanged);
  const submission = useConversationSubmission(cache, chat, chatId, selection, projection.loading);
  const actions = useConversationActions(cache, chat, proposals, chatId, activeChat, details, selection, setLocalError, onChanged);
  const allowances = useNativeAllowances(cache.base, chatId, details.visiblePresentations);
  useEffect(() => { setLocalError(null); }, [chatId]);
  useEffect(() => { if (runId && run.phase && terminal.has(run.phase)) { void run.drain(); void cache.reloadChats(); } }, [runId, run.phase, run.drain, cache.reloadChats]);
  return {
    cache, chat, run, ...projection, ...submission,
    providers: cache.providerDetails, models: selection.models, presets: cache.presets, settings: cache.settings, selectedProvider: selection.selectedProvider,
    providerId: selection.providerId, setProviderId: selection.setProviderId, model: selection.model, setModel: selection.setModel,
    promptPresetId: selection.promptPresetId, setPromptPresetId: selection.setPromptPresetId, input: selection.input, setInput: selection.setInput,
    toolFixBusy: actions.toolFixBusy, reprobeTools: actions.reprobeTools, enableToolsAnyway: actions.enableToolsAnyway, refreshChatModels: actions.refreshChatModels,
    stopRun: async () => chat.cancel(), continueRun: async () => chat.resume(),
    refreshMessages: async () => { await chat.reload(); await details.readDetails(); await proposals.reload(); },
    error: localError ?? chat.error?.message ?? run.error?.message ?? proposals.error?.message ?? allowances.error ?? cache.error,
    setError: setLocalError, chatOnly: selection.selectedProvider?.capabilities?.toolCalling === false, toolCount: cache.toolCount,
    proposalActions: { busy: proposals.busy || allowances.busy, apply: actions.apply, reject: actions.reject, allow: allowances.allow, revoke: allowances.revoke, isAllowed: allowances.isAllowed }
  };
}
