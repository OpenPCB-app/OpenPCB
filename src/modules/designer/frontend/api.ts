import type {
  DesignerCommandEnvelope,
  DesignerDesignSummary,
  DesignerDispatchResult,
  DesignerHistoryActionResult,
  DesignerHistorySnapshot,
  DesignerPcbProjection,
  DesignerSchematicProjection,
  KicadProjectCommitResult,
  KicadProjectInspectReport,
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryTagStat,
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

/**
 * Filesystem-safe export bundle name. Must stay byte-for-byte identical to
 * `makeBundleName` in `src/modules/designer/backend/export/index.ts` so the
 * client-saved filename matches the contents of the ZIP's internal paths.
 */
function clientBundleName(designId: string): string {
  const safe = designId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  return `openpcb-${safe}`;
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
      throw new Error(
        problem.detail ?? problem.title ?? `HTTP ${response.status}`,
      );
    }
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: T };
  if (!payload.data) {
    throw new Error("Missing response payload");
  }
  return payload.data;
}

export interface CloudHeadersProvider {
  (): { "x-cloud-bearer"?: string; "x-cloud-api-url"?: string };
}

export function createDesignerApi(params: {
  backendURL?: string | null;
  moduleId: string;
  cloudHeaders?: CloudHeadersProvider;
}) {
  const { backendURL, moduleId, cloudHeaders } = params;

  function applyCloudHeaders(init: HeadersInit | undefined): HeadersInit {
    const headers = new Headers(init);
    const ch = cloudHeaders?.();
    if (ch?.["x-cloud-bearer"]) {
      headers.set("x-cloud-bearer", ch["x-cloud-bearer"]);
    }
    if (ch?.["x-cloud-api-url"]) {
      headers.set("x-cloud-api-url", ch["x-cloud-api-url"]);
    }
    return headers;
  }

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

    async updateDesign(
      designId: string,
      input: { name: string },
    ): Promise<DesignerDesignSummary> {
      const data = await fetchData<{ design: DesignerDesignSummary }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}`,
        ),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return data.design;
    },

    async deleteDesign(designId: string): Promise<void> {
      const url = buildModuleUrl(
        backendURL,
        moduleId,
        `/designs/${encodeURIComponent(designId)}`,
      );
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
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

    async getPcbProjection(designId: string): Promise<DesignerPcbProjection> {
      const data = await fetchData<{ projection: DesignerPcbProjection }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/projection/pcb`,
        ),
      );
      return data.projection;
    },

    async searchComponents(
      query: string,
      limit = 30,
      tags: readonly string[] = [],
    ): Promise<LibraryComponent[]> {
      const params = new URLSearchParams();
      if (query.length > 0) params.set("q", query);
      params.set("limit", String(limit));
      if (tags.length > 0) params.set("tags", tags.join(","));
      const data = await fetchData<{ components: LibraryComponent[] }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/library/components?${params.toString()}`,
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

    async fetchLibraryTags(
      options: { excludeSystem?: boolean } = {},
    ): Promise<LibraryTagStat[]> {
      const params = new URLSearchParams();
      if (options.excludeSystem) params.set("excludeSystem", "true");
      const data = await fetchData<{ tags: LibraryTagStat[] }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          params.toString().length > 0
            ? `/library/tags?${params.toString()}`
            : "/library/tags",
        ),
      );
      return data.tags;
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
          headers: applyCloudHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(envelope),
        },
      );
      return data.result;
    },

    async linkDesignToCloud(
      designId: string,
      options?: {
        existingCloudDesignId?: string;
        lastSyncedRevision?: number;
      },
    ): Promise<{
      link: { cloudDesignId: string; workspaceId: string; userId: string };
    }> {
      return fetchData<{
        link: { cloudDesignId: string; workspaceId: string; userId: string };
      }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/cloud-link`,
        ),
        {
          method: "POST",
          headers: applyCloudHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(options ?? {}),
        },
      );
    },

    // Bypass cloud headers — used during import-from-cloud to seed local
    // SQLite without triggering outbound mirror (the data already exists in
    // the cloud, so re-mirroring would create duplicate entities).
    async dispatchLocalOnly(
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

    async getCloudLink(designId: string): Promise<{
      link: {
        cloudDesignId: string;
        workspaceId: string;
        userId: string;
        lastSyncedRevision: number;
        linkedAt: string;
        failedAttempts: number;
        lastError: string | null;
      } | null;
    }> {
      return fetchData(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/cloud-link`,
        ),
      );
    },

    async getHistory(
      designId: string,
      sessionId: string,
    ): Promise<DesignerHistorySnapshot> {
      const data = await fetchData<{ history: DesignerHistorySnapshot }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/history?sessionId=${encodeURIComponent(sessionId)}`,
        ),
      );
      return data.history;
    },

    async undo(
      designId: string,
      sessionId: string,
    ): Promise<DesignerHistoryActionResult> {
      const data = await fetchData<{ result: DesignerHistoryActionResult }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/history/undo`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        },
      );
      return data.result;
    },

    async redo(
      designId: string,
      sessionId: string,
    ): Promise<DesignerHistoryActionResult> {
      const data = await fetchData<{ result: DesignerHistoryActionResult }>(
        buildModuleUrl(
          backendURL,
          moduleId,
          `/designs/${encodeURIComponent(designId)}/history/redo`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        },
      );
      return data.result;
    },

    async inspectKicadProject(file: File): Promise<KicadProjectInspectReport> {
      const formData = new FormData();
      formData.set("file", file, file.name);
      const data = await fetchData<{ report: KicadProjectInspectReport }>(
        buildModuleUrl(backendURL, moduleId, "/imports/kicad-project/inspect"),
        { method: "POST", body: formData },
      );
      return data.report;
    },

    async commitKicadProject(
      file: File,
      designName?: string,
    ): Promise<KicadProjectCommitResult> {
      const formData = new FormData();
      formData.set("file", file, file.name);
      if (designName) formData.set("designName", designName);
      const data = await fetchData<{ result: KicadProjectCommitResult }>(
        buildModuleUrl(backendURL, moduleId, "/imports/kicad-project"),
        { method: "POST", body: formData },
      );
      return data.result;
    },

    async downloadGerberZip(
      designId: string,
      options?: {
        includeBom?: boolean;
        includePickAndPlace?: boolean;
        includeInnerLayers?: boolean;
      },
    ): Promise<{ bundleName: string; warnings: number; blob: Blob }> {
      const url = `${buildModuleUrl(
        backendURL,
        moduleId,
        `/designs/${encodeURIComponent(designId)}/exports/gerber`,
      )}?format=zip`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/problem+json")) {
          const problem = (await res.json()) as ProblemDetails;
          throw new Error(
            problem.detail ?? problem.title ?? `HTTP ${res.status}`,
          );
        }
        throw new Error(`HTTP ${res.status}`);
      }
      // The X-OpenPCB-* response headers are *not* exposed by default
      // cross-origin (no `Access-Control-Expose-Headers`), so always derive
      // the bundle name client-side mirroring the backend sanitizer.
      const bundleName = clientBundleName(designId);
      const warnings = Number.parseInt(
        res.headers.get("X-OpenPCB-Warnings") ?? "0",
        10,
      );
      const blob = await res.blob();
      return { bundleName, warnings, blob };
    },
  };
}
