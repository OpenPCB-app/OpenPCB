import type {
  DesignerCommandEnvelope,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerSchematicProjection,
  LibraryComponent,
  LibraryComponentPlacementDetail,
} from "../../../sdks";

function buildModuleUrl(
  backendURL: string | null | undefined,
  moduleId: string,
  path: string,
): string {
  if (!backendURL) {
    throw new Error("Backend URL unavailable");
  }
  return `${backendURL}/api/modules/${moduleId}${path}`;
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

async function fetchData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/problem+json")) {
      const problem = (await response.json()) as ProblemDetails;
      throw new Error(problem.detail ?? problem.title ?? `HTTP ${response.status}`);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: T };
  if (!payload.data) {
    throw new Error("Missing response payload");
  }
  return payload.data;
}

export function createDesignerApi(params: {
  backendURL?: string | null;
  moduleId: string;
}) {
  const { backendURL, moduleId } = params;

  return {
    async listDesigns(): Promise<DesignerDesignSummary[]> {
      const data = await fetchData<{ designs: DesignerDesignSummary[] }>(
        buildModuleUrl(backendURL, moduleId, "/designs"),
      );
      return data.designs;
    },

    async createDesign(name?: string): Promise<DesignerDesignSummary> {
      const data = await fetchData<{ design: DesignerDesignSummary }>(
        buildModuleUrl(backendURL, moduleId, "/designs"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(name ? { name } : {}),
        },
      );
      return data.design;
    },

    async getSchematicProjection(
      designId: string,
    ): Promise<DesignerSchematicProjection> {
      const data = await fetchData<{ projection: DesignerSchematicProjection }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/projection/schematic`,
        ),
      );
      return data.projection;
    },

    async searchComponents(query: string, limit = 30): Promise<LibraryComponent[]> {
      const data = await fetchData<{ components: LibraryComponent[] }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/library/components?q=${encodeURIComponent(query)}&limit=${limit}`,
        ),
      );
      return data.components;
    },

    async resolvePlacement(
      componentId: string,
    ): Promise<LibraryComponentPlacementDetail> {
      const data = await fetchData<{ detail: LibraryComponentPlacementDetail }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/library/components/${encodeURIComponent(componentId)}/placement`,
        ),
      );
      return data.detail;
    },

    async dispatch(
      designId: string,
      envelope: DesignerCommandEnvelope,
    ): Promise<DesignerDispatchResult> {
      const data = await fetchData<{ result: DesignerDispatchResult }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/commands`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
        },
      );
      return data.result;
    },
  };
}
