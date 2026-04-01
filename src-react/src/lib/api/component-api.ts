import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || "API request failed");
  }
  return response.data;
}

export type ComponentScope = "built_in" | "workspace";
export type MountType = "smd" | "through_hole" | "virtual";

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
