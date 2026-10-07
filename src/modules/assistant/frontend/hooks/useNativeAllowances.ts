import { useCallback, useEffect, useRef, useState } from "react";
import { localApiFetch } from "../../../../shared/frontend/http/local-api";
import type { ProposalPresentation } from "../agentkit-projections";
import { assistantRequest, jsonRequest } from "../client";
interface NativeAllowance { key: string; chatId: string; scopeKey: string; toolName: string; proposalKind: string; maxRisk: string; createdAt: string }
export function useNativeAllowances(base: string, chatId: string | null, presentations: Record<string, ProposalPresentation>) {
  const [state, setState] = useState<{ chatId: string | null; items: NativeAllowance[] }>({ chatId: null, items: [] });
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!chatId) return;
    const items = await assistantRequest<NativeAllowance[]>(base, `/v1/chats/${encodeURIComponent(chatId)}/native-write-allowances`, { signal });
    if (!signal?.aborted && activeChat.current === chatId) setState({ chatId, items });
  }, [base, chatId]);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    void reload(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [reload]);
  const find = (proposalId: string) => {
    const envelope = presentations[proposalId]?.envelope;
    return envelope && state.chatId === chatId ? state.items.find(item => item.toolName === envelope.toolName && item.proposalKind === envelope.kind && item.scopeKey.endsWith(`:design:${envelope.designId}`)) : undefined;
  };
  const allow = async (proposalId: string) => {
    if (activeChat.current !== chatId) return;
    if (!presentations[proposalId]) throw new Error("Proposal is no longer available.");
    setBusy(true);
    try { await assistantRequest(base, `/v1/proposals/${encodeURIComponent(proposalId)}/allow-session`, jsonRequest("POST", {})); await reload(); }
    finally { setBusy(false); }
  };
  const revoke = async (proposalId: string) => {
    if (activeChat.current !== chatId) return;
    const allowance = find(proposalId);
    if (!allowance || !chatId) return;
    setBusy(true);
    try {
      const response = await localApiFetch(`${base}/v1/chats/${encodeURIComponent(chatId)}/native-write-allowances/${encodeURIComponent(allowance.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Allowance revoke failed: HTTP ${response.status}`);
      await reload();
    } finally { setBusy(false); }
  };
  return { busy, error, allow, revoke, isAllowed: (proposalId: string) => Boolean(find(proposalId)) };
}
