import { localApiFetch } from "../../../shared/frontend/http/local-api";

export async function assistantRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await localApiFetch(`${base}${path}`, init);
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string; title?: string };
    throw new Error(problem.detail ?? problem.title ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
