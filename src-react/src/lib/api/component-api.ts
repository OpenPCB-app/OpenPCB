import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";
import type { ComponentDraftPayload } from "@/../../src-ts/src/core/schemas/component-semantics";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

interface ApiError extends Error {
  code?: string;
  details?: unknown;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    const err: ApiError = new Error(response.error?.message || "API request failed");
    err.code = response.error?.code;
    err.details = response.error?.details;
    throw err;
  }
  return response.data;
}

export type ComponentScope = "built_in" | "workspace";
export type MountType = "smd" | "through_hole" | "virtual";

// ---------------------------------------------------------------------------
// Component Families
// ---------------------------------------------------------------------------

export async function listComponentFamilies(
  scope?: ComponentScope,
  search?: string,
): Promise<ComponentFamilyType[]> {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (search) params.set("search", search);

  const queryString = params.toString();
  const url = `/api/components/families${queryString ? `?${queryString}` : ""}`;

  const response = await customFetch<
    ApiResponse<{ families: ComponentFamilyType[] }>
  >(url);
  return unwrapResponse(response).families;
}

export async function getComponentFamily(
  id: string,
): Promise<ComponentFamilyType> {
  const response = await customFetch<
    ApiResponse<{ family: ComponentFamilyType }>
  >(`/api/components/families/${encodeURIComponent(id)}`);
  return unwrapResponse(response).family;
}

// ---------------------------------------------------------------------------
// Component Drafts
// ---------------------------------------------------------------------------

export interface ComponentDraft {
  id: string;
  familyId: string | null;
  wizardStep: number;
  payload: ComponentDraftPayload;
  warnings: unknown[];
  createdAt: string;
  updatedAt: string;
}

/**
 * List all active (non-deleted) component drafts
 */
export async function listComponentDrafts(): Promise<ComponentDraft[]> {
  const response = await customFetch<ApiResponse<{ drafts: ComponentDraft[] }>>(
    "/api/components/drafts",
  );
  return unwrapResponse(response).drafts;
}

/**
 * Create a new component draft
 */
export async function createComponentDraft(
  payload?: Partial<ComponentDraftPayload>,
): Promise<ComponentDraft> {
  const response = await customFetch<ApiResponse<{ draft: ComponentDraft }>>(
    "/api/components/drafts",
    {
      method: "POST",
      body: JSON.stringify({ payload: payload ?? {} }),
    },
  );
  return unwrapResponse(response).draft;
}

/**
 * Patch (partial update) a component draft - used for auto-save
 */
export async function patchComponentDraft(
  id: string,
  updates: { familyId?: string | null; payload?: Partial<ComponentDraftPayload> },
): Promise<ComponentDraft> {
  const response = await customFetch<ApiResponse<{ draft: ComponentDraft }>>(
    `/api/components/drafts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return unwrapResponse(response).draft;
}

/**
 * Discard (soft-delete) a component draft
 */
export async function discardComponentDraft(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/components/drafts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

/**
 * Validate a component draft before publishing
 */
export async function validateComponentDraft(
  id: string,
): Promise<{ blockers: unknown[]; warnings: unknown[]; canPublish: boolean }> {
  const response = await customFetch<
    ApiResponse<{ blockers: unknown[]; warnings: unknown[]; canPublish: boolean }>
  >(`/api/components/drafts/${encodeURIComponent(id)}/validate`, {
    method: "POST",
  });
  return unwrapResponse(response);
}

/**
 * Publish a component draft as a new revision
 * Creates the component family if it doesn't exist
 */
export async function publishComponentDraft(
  id: string,
): Promise<{ familyId: string; revision: unknown }> {
  const response = await customFetch<
    ApiResponse<{ familyId: string; revision: unknown }>
  >(`/api/components/drafts/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
  return unwrapResponse(response);
}
