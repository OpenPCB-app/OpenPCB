import { customFetch } from "@shared/sdk/mutator";
import type {
  CreateDesignInput,
  DesignRecord,
  UpdateDesignInput,
} from "@shared/types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface DesignScope {
  workspaceId: string;
  projectId?: string | null;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export async function listDesigns(scope: DesignScope): Promise<DesignRecord[]> {
  const params = new URLSearchParams({ workspaceId: scope.workspaceId });
  if (scope.projectId !== undefined) {
    params.set("projectId", scope.projectId ?? "null");
  }

  const response = await customFetch<ApiResponse<{ designs: DesignRecord[] }>>(
    `/api/designs?${params.toString()}`,
  );
  return unwrapResponse(response).designs;
}

export async function createDesign(
  input: CreateDesignInput,
): Promise<DesignRecord> {
  const response = await customFetch<ApiResponse<{ design: DesignRecord }>>(
    "/api/designs",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return unwrapResponse(response).design;
}

export async function updateDesign(
  id: string,
  input: UpdateDesignInput,
): Promise<DesignRecord> {
  const response = await customFetch<ApiResponse<{ design: DesignRecord }>>(
    `/api/designs/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return unwrapResponse(response).design;
}

export async function deleteDesign(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/designs/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function saveSheetContent(
  designId: string,
  sheetIndex: number,
  content: unknown,
): Promise<void> {
  const response = await customFetch<ApiResponse<{ saved: boolean }>>(
    `/api/designs/${encodeURIComponent(designId)}/sheets/${sheetIndex}`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
  unwrapResponse(response);
}
