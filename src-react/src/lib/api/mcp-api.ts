import { customFetch } from "@shared/sdk/mutator";

export interface McpServer {
  id: string;
  alias: string;
  displayName?: string | null;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  error?: string;
  toolCount?: number;
  resourceCount?: number;
  promptCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpServerInput {
  alias: string;
  displayName?: string | null;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  alias?: string;
  displayName?: string | null;
  transport?: "stdio" | "http";
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

function unwrapResponse<T>(response: any): T {
    if (!response.ok) {
        throw new Error(response.error?.message || 'API request failed');
    }
    return response.data as T;
}

export async function listMcpServers(): Promise<McpServer[]> {
  const response = await customFetch<ApiResponse<{ servers: McpServer[] }>>('/api/mcp/servers');
  const data = unwrapResponse<{ servers: McpServer[] }>(response);
  return data.servers;
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
  const response = await customFetch<ApiResponse<{ server: McpServer }>>('/api/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const data = unwrapResponse<{ server: McpServer }>(response);
  return data.server;
}

export async function updateMcpServer(id: string, input: UpdateMcpServerInput): Promise<McpServer> {
  const response = await customFetch<ApiResponse<{ server: McpServer }>>(`/api/mcp/servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  const data = unwrapResponse<{ server: McpServer }>(response);
  return data.server;
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(`/api/mcp/servers/${id}`, {
    method: 'DELETE',
  });
  const data = unwrapResponse<{ deleted: boolean }>(response);
  return data.deleted;
}

export async function connectMcpServer(id: string): Promise<{ connected: boolean; toolCount: number }> {
  const response = await customFetch<ApiResponse<{ connected: boolean; toolCount: number }>>(`/api/mcp/servers/${id}/connect`, {
    method: 'POST',
  });
  const data = unwrapResponse<{ connected: boolean; toolCount: number }>(response);
  return data;
}

export async function disconnectMcpServer(id: string): Promise<{ disconnected: boolean }> {
  const response = await customFetch<ApiResponse<{ disconnected: boolean }>>(`/api/mcp/servers/${id}/disconnect`, {
    method: 'POST',
  });
  const data = unwrapResponse<{ disconnected: boolean }>(response);
  return data;
}
