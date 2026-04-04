import { customFetch, getBackendURL } from "@shared/sdk/mutator";
import type { MountType } from "@shared/types/component-library.types";
import type {
  ComponentType as SharedComponentType,
  ComponentVariantType,
} from "@shared/types/component-library-schema.types";

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
export type ComponentType = SharedComponentType;
export type ComponentVariant = ComponentVariantType;
export type { MountType };

type WorkspaceComponentVariantPayload = Partial<ComponentVariant> & {
  footprintOptions?: ComponentVariant["footprintOptions"];
  defaultFootprintOptionId?: string | null;
};

type WorkspaceComponentPayload = {
  canonicalKey?: string;
  displayLabel?: string;
  description?: string;
  symbolData?: ComponentType["symbolData"];
  categoryPath?: string | null;
  tags?: string[];
  variants?: WorkspaceComponentVariantPayload[];
  defaultVariantId?: string | null;
};

export interface ComponentWorkspaceRecord {
  id: string;
  componentId: string | null;
  wizardStep: number;
  payload: Partial<ComponentType>;
  warnings: unknown[];
  createdAt: string;
  updatedAt: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

function createCanonicalKey(displayLabel?: string): string {
  const base = (displayLabel ?? "component")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36);

  return `${base || "component"}-${suffix}`;
}

async function fetchComponent(id: string): Promise<ComponentType> {
  const response = await customFetch<ApiResponse<{ component: ComponentType }>>(
    `/api/components/${encodeURIComponent(id)}`,
  );
  return unwrapResponse(response).component;
}

function ensureSymbolData(
  symbolData?: ComponentType["symbolData"],
): ComponentType["symbolData"] {
  return (
    symbolData ?? {
      referencePrefix: "U",
      pinDefinitions: [],
      pins: [],
      properties: {},
      unitCount: 1,
      bodyGraphics: [],
      rawKicadSource: null,
      symbolTemplate: "generic_ic",
    }
  );
}

function resolveVariantFootprints(
  variant: ComponentVariant,
): ComponentVariant["footprintOptions"] {
  return variant.footprintOptions;
}

function normalizeVariant(variant: ComponentVariant): ComponentVariant {
  const footprintOptions = resolveVariantFootprints(variant);
  const defaultFootprintOptionId =
    variant.defaultFootprintOptionId ??
    footprintOptions.find((entry) => entry.isDefault)?.id ??
    footprintOptions[0]?.id ??
    null;

  return {
    ...variant,
    footprintOptions,
    defaultFootprintOptionId,
  };
}

function resolveComponentVariants(
  component: ComponentType,
): ComponentVariant[] {
  return component.variants.map(normalizeVariant);
}

function normalizeComponent(component: ComponentType): ComponentType {
  const variants = resolveComponentVariants(component);
  const defaultVariantId =
    component.defaultVariantId ??
    variants.find((variant) => variant.isDefault)?.id ??
    variants[0]?.id ??
    null;

  return {
    ...component,
    variants,
    defaultVariantId,
  };
}

function createPlaceholderVariant(
  payload?: WorkspaceComponentPayload,
): WorkspaceComponentVariantPayload {
  return {
    canonicalCode: "default",
    humanLabel: payload?.displayLabel || "Default",
    imperialAlias: null,
    metricAlias: null,
    mountType: "smd",
    dimensions: null,
    isDefault: true,
    pinRemapTable: null,
    footprintOptions: [],
    defaultFootprintOptionId: null,
  };
}

function getRequestedVariants(
  payload?: WorkspaceComponentPayload,
): WorkspaceComponentVariantPayload[] {
  const variants = payload?.variants ?? [];
  return variants.length > 0 ? variants : [createPlaceholderVariant(payload)];
}

function toWorkspaceRecord(component: ComponentType): ComponentWorkspaceRecord {
  return {
    id: component.id,
    componentId: component.id,
    wizardStep: 0,
    payload: component,
    warnings: [],
    createdAt: component.createdAt ?? new Date().toISOString(),
    updatedAt: component.updatedAt ?? new Date().toISOString(),
  };
}

function extractComponentUpdates(
  payload: WorkspaceComponentPayload,
): Partial<ComponentType> {
  const updates: Partial<ComponentType> = {};

  if (payload.canonicalKey !== undefined)
    updates.canonicalKey = payload.canonicalKey;
  if (payload.displayLabel !== undefined)
    updates.displayLabel = payload.displayLabel;
  if (payload.description !== undefined)
    updates.description = payload.description;
  if (payload.symbolData !== undefined) updates.symbolData = payload.symbolData;
  if (payload.categoryPath !== undefined)
    updates.categoryPath = payload.categoryPath;
  if (payload.tags !== undefined) updates.tags = payload.tags;
  const defaultVariantId = payload.defaultVariantId;
  if (defaultVariantId !== undefined) {
    updates.defaultVariantId = defaultVariantId;
  }

  return updates;
}

function getPrimaryVariantPayload(
  payload: WorkspaceComponentPayload,
): WorkspaceComponentVariantPayload | null {
  const variants = payload.variants ?? [];
  return variants[0] ?? null;
}

async function syncWorkspaceComponent(
  id: string,
  payload: WorkspaceComponentPayload,
): Promise<ComponentType> {
  const componentUpdates = extractComponentUpdates(payload);
  let component =
    Object.keys(componentUpdates).length > 0
      ? await updateComponent(id, componentUpdates)
      : await getComponent(id);

  const primaryVariant = getPrimaryVariantPayload(payload);
  if (!primaryVariant) {
    return component;
  }

  const currentVariant =
    component.variants.find((variant) => variant.id === component.defaultVariantId) ??
    component.variants[0];

  if (currentVariant) {
    await updateComponentVariant(id, currentVariant.id, {
      canonicalCode: primaryVariant.canonicalCode,
      humanLabel: primaryVariant.humanLabel,
      imperialAlias: primaryVariant.imperialAlias,
      metricAlias: primaryVariant.metricAlias,
      mountType: primaryVariant.mountType,
      dimensions: primaryVariant.dimensions,
      isDefault: true,
      pinRemapTable: primaryVariant.pinRemapTable,
      footprintOptions: primaryVariant.footprintOptions,
      defaultFootprintOptionId: primaryVariant.defaultFootprintOptionId,
    });
    component = await getComponent(id);
    if (component.defaultVariantId !== currentVariant.id) {
      component = await setDefaultComponentVariant(id, currentVariant.id);
    }
    return component;
  }

  const createdVariant = await addComponentVariant(id, {
    ...primaryVariant,
    isDefault: true,
  });
  return setDefaultComponentVariant(id, createdVariant.id);
}

export async function listComponents(filters?: {
  search?: string;
  categoryPath?: string;
  tags?: string[];
  mountType?: MountType;
}): Promise<ComponentType[]> {
  const response = await customFetch<
    ApiResponse<{ components: ComponentType[] }>
  >(
    `/api/components${buildQuery({
      search: filters?.search,
      categoryPath: filters?.categoryPath,
      tags: filters?.tags?.join(","),
      mountType: filters?.mountType,
    })}`,
  );
  return unwrapResponse(response).components.map(normalizeComponent);
}

export async function getComponent(id: string): Promise<ComponentType> {
  const component = await fetchComponent(id);
  return normalizeComponent(component);
}

export async function createComponent(
  payload: Partial<ComponentType> | WorkspaceComponentPayload,
): Promise<ComponentType> {
  const canonicalKey =
    payload.canonicalKey?.trim() || createCanonicalKey(payload.displayLabel);

  const response = await customFetch<ApiResponse<{ component: ComponentType }>>(
    "/api/components",
    {
      method: "POST",
      body: JSON.stringify({
        canonicalKey,
        displayLabel: payload.displayLabel,
        description: payload.description,
        symbolData: ensureSymbolData(payload.symbolData),
        categoryPath: payload.categoryPath,
        tags: payload.tags,
        variants: getRequestedVariants(payload),
      }),
    },
  );
  return normalizeComponent(unwrapResponse(response).component);
}

export async function updateComponent(
  id: string,
  updates: Partial<ComponentType>,
): Promise<ComponentType> {
  const response = await customFetch<ApiResponse<{ component: ComponentType }>>(
    `/api/components/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return normalizeComponent(unwrapResponse(response).component);
}

export async function deleteComponent(id: string): Promise<void> {
  const response = await customFetch<
    ApiResponse<{
      deleted: boolean;
      usageCount: number;
      designNames: string[];
    }>
  >(`/api/components/${encodeURIComponent(id)}`, { method: "DELETE" });
  unwrapResponse(response);
}

export async function deleteComponentWithOptions(
  id: string,
  options?: { forceUsed?: boolean },
): Promise<{ deleted: boolean; usageCount: number; designNames: string[] }> {
  const forceQuery = options?.forceUsed ? "?force=true" : "";
  const response = await customFetch<
    ApiResponse<{ deleted: boolean; usageCount: number; designNames: string[] }>
  >(
    `/api/components/${encodeURIComponent(id)}${forceQuery}`,
    { method: "DELETE" },
  );
  return unwrapResponse(response);
}

export async function getComponentDeleteImpact(id: string): Promise<{
  usageCount: number;
  designNames: string[];
}> {
  const response = await customFetch<
    ApiResponse<{ usageCount: number; designNames: string[] }>
  >(`/api/components/${encodeURIComponent(id)}/delete-impact`);
  return unwrapResponse(response);
}

export async function addComponentVariant(
  componentId: string,
  variant: Partial<ComponentVariant>,
): Promise<ComponentVariant> {
  const response = await customFetch<
    ApiResponse<{ variant: ComponentVariant }>
  >(`/api/components/${encodeURIComponent(componentId)}/variants`, {
    method: "POST",
    body: JSON.stringify(variant),
  });
  return unwrapResponse(response).variant;
}

export async function updateComponentVariant(
  componentId: string,
  variantId: string,
  updates: Partial<ComponentVariant>,
): Promise<ComponentVariant> {
  const response = await customFetch<
    ApiResponse<{ variant: ComponentVariant }>
  >(
    `/api/components/${encodeURIComponent(componentId)}/variants/${encodeURIComponent(variantId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
  return unwrapResponse(response).variant;
}

export async function removeComponentVariant(
  componentId: string,
  variantId: string,
): Promise<void> {
  const response = await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/components/${encodeURIComponent(componentId)}/variants/${encodeURIComponent(variantId)}`,
    { method: "DELETE" },
  );
  unwrapResponse(response);
}

export async function setDefaultComponentVariant(
  componentId: string,
  variantId: string,
): Promise<ComponentType> {
  const response = await customFetch<ApiResponse<{ component: ComponentType }>>(
    `/api/components/${encodeURIComponent(componentId)}/default-variant`,
    {
      method: "PATCH",
      body: JSON.stringify({ variantId }),
    },
  );
  return normalizeComponent(unwrapResponse(response).component);
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

export async function bulkDeleteComponents(
  ids: string[],
  options?: { forceUsed?: boolean },
): Promise<{
  deletedCount: number;
  skippedCount: number;
  skippedNotFoundCount: number;
  skippedUsedCount: number;
  skippedUsed: Array<{ id: string; usageCount: number; designNames: string[] }>;
  deletedUsedCount: number;
}> {
  const response = await customFetch<
    ApiResponse<{
      deleted: boolean;
      deletedCount: number;
      skippedCount: number;
      skippedNotFoundCount: number;
      skippedUsedCount: number;
      skippedUsed: Array<{
        id: string;
        usageCount: number;
        designNames: string[];
      }>;
      deletedUsedCount: number;
    }>
  >("/api/components/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids, forceUsed: options?.forceUsed ?? false }),
  });
  const result = unwrapResponse(response);
  return {
    deletedCount: result.deletedCount,
    skippedCount: result.skippedCount,
    skippedNotFoundCount: result.skippedNotFoundCount,
    skippedUsedCount: result.skippedUsedCount,
    skippedUsed: result.skippedUsed,
    deletedUsedCount: result.deletedUsedCount,
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

export interface ImportedComponentSummary {
  componentId: string;
  displayLabel: string;
  canonicalKey: string;
  variantCount: number;
  sourceFileNames: string[];
}

export interface ComponentImportExecutionWarning {
  code: string;
  message: string;
  severity: "warning" | "blocker";
  context: Record<string, string>;
}

export interface ComponentImportExecutionResult {
  components: ImportedComponentSummary[];
  warnings: ComponentImportExecutionWarning[];
  ungroupedFiles: string[];
}

export async function listWorkspaceComponentRecords(): Promise<
  ComponentWorkspaceRecord[]
> {
  return [];
}

export async function createWorkspaceComponentRecord(
  payload?: WorkspaceComponentPayload,
): Promise<ComponentWorkspaceRecord> {
  const component = await createComponent(payload ?? {});
  return toWorkspaceRecord(component);
}

export async function patchWorkspaceComponentRecord(
  id: string,
  updates: {
    componentId?: string | null;
    payload?: WorkspaceComponentPayload;
  },
): Promise<ComponentWorkspaceRecord> {
  const component = updates.payload
    ? await syncWorkspaceComponent(id, updates.payload)
    : await getComponent(id);
  return toWorkspaceRecord(component);
}

export async function discardWorkspaceComponentRecord(
  id: string,
): Promise<void> {
  await deleteComponent(id);
}

export async function validateWorkspaceComponentRecord(
  id: string,
): Promise<{ blockers: unknown[]; warnings: unknown[]; canPublish: boolean }> {
  await fetchComponent(id);
  return { blockers: [], warnings: [], canPublish: true };
}

export async function publishWorkspaceComponentRecord(
  id: string,
): Promise<{ componentId: string; revision: unknown }> {
  const component = await getComponent(id);
  return { componentId: component.id, revision: null };
}

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

export async function importComponentsFromFiles(
  files: File[],
): Promise<ComponentImportExecutionResult> {
  const backendUrl = getBackendURL();
  if (!backendUrl) {
    throw new Error("Backend not ready");
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(
    `${backendUrl.replace(/\/$/, "")}/api/components/import`,
    {
      method: "POST",
      body: formData,
    },
  );

  const payload = (await response.json()) as ApiResponse<{
    import: ComponentImportExecutionResult;
  }>;

  if (!response.ok || !payload.ok || !payload.data) {
    const error: ApiError = new Error(
      payload.error?.message || "Failed to import components",
    );
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    throw error;
  }

  return payload.data.import;
}
