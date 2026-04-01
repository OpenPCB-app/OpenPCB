import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type {
  ComponentWorkspaceRecord as SharedComponentWorkspaceRecord,
  MountType,
} from "@shared/types/component-library.types";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

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
    const err: ApiError = new Error(
      response.error?.message || "API request failed",
    );
    err.code = response.error?.code;
    err.details = response.error?.details;
    throw err;
  }
  return response.data;
}

export type ComponentScope = "built_in" | "workspace";
export type ComponentType = ComponentFamilyType;
export type ComponentWorkspaceRecord = SharedComponentWorkspaceRecord;
export type ComponentDraft = ComponentWorkspaceRecord;
export type { MountType };

// ---------------------------------------------------------------------------
// Component Families
// ---------------------------------------------------------------------------

export async function listComponentFamilies(
  scope?: ComponentScope,
  search?: string,
): Promise<ComponentType[]> {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (search) params.set("search", search);

  const queryString = params.toString();
  const url = `/api/components/families${queryString ? `?${queryString}` : ""}`;

  const response =
    await customFetch<ApiResponse<{ families: ComponentType[] }>>(url);
  return unwrapResponse(response).families;
}

export async function getComponentFamily(
  id: string,
): Promise<ComponentType> {
  const response = await customFetch<
    ApiResponse<{ family: ComponentType }>
  >(`/api/components/families/${encodeURIComponent(id)}`);
  return unwrapResponse(response).family;
}

export interface CategoryNode {
  path: string;
  label: string;
  count: number;
  children: CategoryNode[];
}

export async function getComponentCategories(): Promise<CategoryNode[]> {
  const response = await customFetch<
    ApiResponse<{ categories: CategoryNode[] }>
  >("/api/components/categories");
  return unwrapResponse(response).categories;
}

export async function updateComponentFamily(
  id: string,
  updates: {
    displayLabel?: string;
    description?: string;
    categoryPath?: string;
    tags?: string[];
  },
): Promise<ComponentType> {
  const response = await customFetch<
    ApiResponse<{ family: ComponentType }>
  >(`/api/components/families/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  return unwrapResponse(response).family;
}

export async function deleteComponentFamily(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/components/families/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function bulkDeleteComponentFamilies(
  ids: string[],
): Promise<{ deletedCount: number; skippedCount: number }> {
  const response = await customFetch<
    ApiResponse<{
      deleted: boolean;
      deletedCount: number;
      skippedCount: number;
    }>
  >("/api/components/families/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  const result = unwrapResponse(response);
  return {
    deletedCount: result.deletedCount,
    skippedCount: result.skippedCount,
  };
}

export interface KicadImportWarning {
  code: string;
  message: string;
}

export interface ParsedKicadSymbolPin {
  name: string;
  number: string;
  electricalType: string;
  direction: string;
  position: { x: number; y: number };
  length: number;
  rotation: number;
  unit: number;
  hidden: boolean;
}

export interface ParsedKicadSymbolGraphic {
  unit: number;
  node: unknown[];
}

export interface ParsedKicadSymbol {
  name: string;
  kicadId: string | null;
  pins: ParsedKicadSymbolPin[];
  units: number;
  properties: Record<string, string>;
  bodyGraphics: ParsedKicadSymbolGraphic[];
  warnings: KicadImportWarning[];
  rawSource: string;
}

export interface ParsedKicadFootprint {
  name: string;
  description: string;
  tags: string[];
  pads: Array<{
    number: string;
    type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
    shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
    position: { x: number; y: number };
    size: { width: number; height: number };
    rotation: number;
    layers: string[];
    roundrectRatio?: number;
    drillDiameter?: number;
    drillOffset?: { x: number; y: number };
  }>;
  graphics: Array<{
    type: "line" | "rect" | "circle" | "arc" | "poly" | "text";
    layer: string;
    data: Record<string, unknown>;
  }>;
  model3dRefs: Array<{
    path: string;
    resolvedFileName: string;
    offset: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  }>;
  attributes: { type: "smd" | "through_hole" | "virtual" | "unknown" };
  warnings: KicadImportWarning[];
  rawSource: string;
}

/**
 * List all active (non-deleted) component drafts
 */
export async function listWorkspaceComponentRecords(): Promise<
  ComponentWorkspaceRecord[]
> {
  const response = await customFetch<
    ApiResponse<{ drafts: ComponentWorkspaceRecord[] }>
  >(
    "/api/components/drafts",
  );
  return unwrapResponse(response).drafts;
}

/**
 * Create a new component draft
 */
export async function createWorkspaceComponentRecord(
  payload?: Partial<ComponentType>,
): Promise<ComponentWorkspaceRecord> {
  const response = await customFetch<
    ApiResponse<{ draft: ComponentWorkspaceRecord }>
  >(
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
export async function patchWorkspaceComponentRecord(
  id: string,
  updates: {
    familyId?: string | null;
    payload?: Partial<ComponentType>;
  },
): Promise<ComponentWorkspaceRecord> {
  const response = await customFetch<
    ApiResponse<{ draft: ComponentWorkspaceRecord }>
  >(
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
export async function discardWorkspaceComponentRecord(id: string): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/components/drafts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

/**
 * Validate a component draft before publishing
 */
export async function validateWorkspaceComponentRecord(
  id: string,
): Promise<{ blockers: unknown[]; warnings: unknown[]; canPublish: boolean }> {
  const response = await customFetch<
    ApiResponse<{
      blockers: unknown[];
      warnings: unknown[];
      canPublish: boolean;
    }>
  >(`/api/components/drafts/${encodeURIComponent(id)}/validate`, {
    method: "POST",
  });
  return unwrapResponse(response);
}

/**
 * Publish a component draft as a new revision
 * Creates the component family if it doesn't exist
 */
export async function publishWorkspaceComponentRecord(
  id: string,
): Promise<{ familyId: string; revision: unknown }> {
  const response = await customFetch<
    ApiResponse<{ familyId: string; revision: unknown }>
  >(`/api/components/drafts/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
  return unwrapResponse(response);
}

export async function listComponentDrafts(): Promise<ComponentDraft[]> {
  return listWorkspaceComponentRecords();
}

export async function createComponentDraft(
  payload?: Partial<ComponentType>,
): Promise<ComponentDraft> {
  return createWorkspaceComponentRecord(payload);
}

export async function patchComponentDraft(
  id: string,
  updates: {
    familyId?: string | null;
    payload?: Partial<ComponentType>;
  },
): Promise<ComponentDraft> {
  return patchWorkspaceComponentRecord(id, updates);
}

export async function discardComponentDraft(id: string): Promise<void> {
  return discardWorkspaceComponentRecord(id);
}

export async function validateComponentDraft(
  id: string,
): Promise<{ blockers: unknown[]; warnings: unknown[]; canPublish: boolean }> {
  return validateWorkspaceComponentRecord(id);
}

export async function publishComponentDraft(
  id: string,
): Promise<{ familyId: string; revision: unknown }> {
  return publishWorkspaceComponentRecord(id);
}

// ---------------------------------------------------------------------------
// KiCAD wizard import helpers
// ---------------------------------------------------------------------------

export async function parseKicadSymbolImport(
  content: string,
  fileName?: string,
): Promise<{
  symbol: ParsedKicadSymbol;
  availableSymbols: string[];
  fileName: string | null;
}> {
  const response = await customFetch<
    ApiResponse<{
      symbol: ParsedKicadSymbol;
      availableSymbols: string[];
      fileName: string | null;
    }>
  >("/api/components/import/parse-symbol", {
    method: "POST",
    body: JSON.stringify({ content, fileName }),
  });
  return unwrapResponse(response);
}

export async function parseKicadFootprintImport(
  content: string,
  fileName?: string,
): Promise<{ footprint: ParsedKicadFootprint; fileName: string | null }> {
  const response = await customFetch<
    ApiResponse<{ footprint: ParsedKicadFootprint; fileName: string | null }>
  >("/api/components/import/parse-footprint", {
    method: "POST",
    body: JSON.stringify({ content, fileName }),
  });
  return unwrapResponse(response);
}
