import { customFetch } from "@shared/sdk/mutator";
import type {
  CreateDesignInput,
  DesignRecord,
  UpdateDesignInput,
} from "@shared/types";
import type { ProjectDocumentBundle } from "@shared/types/pcb.types";

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

export async function listDesigns({
  workspaceId,
  projectId = null,
}: DesignScope): Promise<DesignRecord[]> {
  const response = await customFetch<ApiResponse<{ designs: DesignRecord[] }>>(
    projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/designs`
      : `/api/designs?${new URLSearchParams({ workspaceId }).toString()}`,
  );
  return unwrapResponse(response).designs;
}

export async function getDesign(id: string): Promise<DesignRecord> {
  const response = await customFetch<ApiResponse<{ design: DesignRecord }>>(
    `/api/designs/${encodeURIComponent(id)}`,
  );
  return unwrapResponse(response).design;
}

export async function createDesign(
  input: CreateDesignInput,
): Promise<DesignRecord> {
  const response = await customFetch<ApiResponse<{ design: DesignRecord }>>(
    input.projectId
      ? `/api/projects/${encodeURIComponent(input.projectId)}/designs`
      : "/api/designs",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return unwrapResponse(response).design;
}

export async function updateDesign(
  id: string,
  updates: UpdateDesignInput,
): Promise<DesignRecord> {
  const response = await customFetch<ApiResponse<{ design: DesignRecord }>>(
    `/api/designs/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return unwrapResponse(response).design;
}

export async function deleteDesign(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/designs/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
  unwrapResponse(response);
}

export interface SheetContentResponse {
  sheet: {
    id: string;
    designId: string;
    sheetIndex: number;
    title: string;
    contentHash: string | null;
  } | null;
  content: ProjectDocumentBundle | null;
}

export async function getSheetContent(
  designId: string,
  sheetIndex: number,
): Promise<SheetContentResponse> {
  const response = await customFetch<ApiResponse<SheetContentResponse>>(
    `/api/designs/${encodeURIComponent(designId)}/sheets/${sheetIndex}/content`,
  );
  return unwrapResponse(response);
}

export interface SaveSheetContentResponse {
  sheet: {
    id: string;
    designId: string;
    sheetIndex: number;
    title: string;
    contentHash: string | null;
  };
}

export async function saveSheetContent(
  designId: string,
  sheetIndex: number,
  content: ProjectDocumentBundle,
): Promise<SaveSheetContentResponse> {
  const response = await customFetch<ApiResponse<SaveSheetContentResponse>>(
    `/api/designs/${encodeURIComponent(designId)}/sheets/${sheetIndex}/content`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
  return unwrapResponse(response);
}
