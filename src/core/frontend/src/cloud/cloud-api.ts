// Thin HTTP client for the Hono backend (api.cloud.openpcb.app).
// Writes (commands), AI invocations, library sync, admin invites.
// Reads also go through cloud-api now (see queries.ts), not PostgREST.
import { getSupabase } from "./supabase";
import { readCloudConfig } from "./config";

export interface CommandEnvelope {
  commandId: string;
  sessionId: string;
  aggregateId: string;
  baseRevision: number | null;
  issuedAt: number;
  command: { type: string } & Record<string, unknown>;
}

export interface DispatchResult {
  ok: boolean;
  revision?: number;
  forwardPatches?: unknown[];
  code?: string;
  conflict?: unknown;
}

async function authHeader(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token
    ? `Bearer ${data.session.access_token}`
    : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = readCloudConfig();
  if (!cfg.enabled) throw new Error("Cloud not configured");
  const auth = await authHeader();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (auth) headers.set("authorization", auth);
  const res = await fetch(`${cfg.apiUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const err = new Error(`Cloud API ${res.status} ${path}`);
    (err as Error & { detail?: unknown }).detail = detail;
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export const cloudApi = {
  health: () => request<{ status: string }>("/v1/health"),

  dispatchCommand: (designId: string, env: CommandEnvelope) =>
    request<DispatchResult>(`/v1/designs/${designId}/commands`, {
      method: "POST",
      body: JSON.stringify(env),
    }),

  createDesign: (workspaceId: string, name: string) =>
    request<{ id: string; name: string; revision: number }>(
      `/v1/designs/workspaces/${workspaceId}`,
      { method: "POST", body: JSON.stringify({ name }) },
    ),

  personalWorkspace: () =>
    request<{ id: string; slug: string }>("/v1/workspaces/me/personal"),

  coreLibLatest: (channel = "stable") =>
    request<{ channel: string; version: string; manifestUrl: string }>(
      `/v1/core-lib/${channel}/latest`,
    ),

  // AI component search returns a streamed text response (SSE-ish).
  aiComponentSearch: async (query: string): Promise<Response> => {
    const cfg = readCloudConfig();
    const auth = await authHeader();
    const headers = new Headers({ "content-type": "application/json" });
    if (auth) headers.set("authorization", auth);
    return fetch(`${cfg.apiUrl}/v1/ai/component-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });
  },
};
