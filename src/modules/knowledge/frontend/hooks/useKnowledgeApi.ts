import type {
  PageTreeNode,
  Page,
  CreatePageParams,
  UpdatePageMetaParams,
  UpdatePageContentParams,
  MovePageParams,
  PageSearchResult,
  BulkDeleteResult,
  BulkMoveResult,
} from "../../shared/types";

const DEFAULT_WORKSPACE = "default";

export class KnowledgeApiError<TPayload = unknown> extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: TPayload | undefined;

  constructor(params: {
    status: number;
    code: string;
    message?: string;
    payload?: TPayload;
  }) {
    super(params.message ?? params.code);
    this.name = "KnowledgeApiError";
    this.status = params.status;
    this.code = params.code;
    this.payload = params.payload;
  }
}

interface ApiResponse<T> {
  data?: T;
  error?: KnowledgeApiError;
}

export interface KnowledgeApi {
  readonly draftNamespace?: string;
  createPage: (params: CreatePageParams) => Promise<Page | null>;
  importPdf: (
    file: File,
    options?: {
      project_id?: string;
      parent_id?: string;
      page_count?: number;
    },
  ) => Promise<Page | null>;
  /** URL that streams the stored PDF for a pdf-engine page (empty if no backend). */
  pdfUrl: (pageId: string) => string;
  getPage: (
    pageId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Page | null>;
  updatePageMeta: (
    pageId: string,
    updates: UpdatePageMetaParams,
    options?: { requestId?: string; ifUnmodifiedSince?: string },
  ) => Promise<Page | null>;
  updatePageContent: (
    pageId: string,
    content: UpdatePageContentParams,
    options?: {
      ifUnmodifiedSince?: string;
      requestId?: string;
      signal?: AbortSignal;
    },
  ) => Promise<{ page: Page; requestId?: string } | null>;
  movePage: (pageId: string, target: MovePageParams) => Promise<Page | null>;
  deletePage: (pageId: string) => Promise<boolean>;
  restorePage: (pageId: string) => Promise<Page | null>;
  getWorkspaceTree: (workspaceId: string) => Promise<PageTreeNode[]>;
  getProjectTree: (
    projectId: string,
    workspaceId: string,
  ) => Promise<PageTreeNode[]>;
  searchPages: (
    workspaceId: string,
    query: string,
    scope?: "all" | "workspace" | "projects",
  ) => Promise<PageSearchResult[]>;
  ensureProjectRoot: (params: {
    workspace_id: string;
    project_id: string;
    title: string;
  }) => Promise<Page | null>;
  bulkDeletePages: (pageIds: string[]) => Promise<BulkDeleteResult>;
  bulkMovePages: (
    pageIds: string[],
    targetParentId: string | null,
  ) => Promise<BulkMoveResult>;
}

export function createKnowledgeApi(
  backendURL: string | null,
  moduleId: string,
): KnowledgeApi {
  const base = backendURL
    ? `${backendURL.replace(/\/$/, "")}/api/modules/${moduleId}`
    : null;

  async function fetchApi<T>(
    path: string,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> {
    if (!base) {
      return {
        error: new KnowledgeApiError({
          status: 503,
          code: "BACKEND_NOT_READY",
        }),
      };
    }

    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => undefined);
        const code =
          typeof errorData === "object" &&
          errorData !== null &&
          "error" in errorData &&
          typeof (errorData as { error?: unknown }).error === "string"
            ? (errorData as { error: string }).error
            : `HTTP_${response.status}`;
        return {
          error: new KnowledgeApiError({
            status: response.status,
            code,
            payload: errorData,
          }),
        };
      }

      if (response.status === 204) {
        return { data: undefined as T };
      }

      const data = await response.json();
      return { data };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      return {
        error: new KnowledgeApiError({
          status: 0,
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network error",
        }),
      };
    }
  }

  const createPage = async (params: CreatePageParams) => {
    const result = await fetchApi<{ page: Page }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        workspace_id: params.workspace_id ?? DEFAULT_WORKSPACE,
      }),
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const importPdf = async (
    file: File,
    options?: {
      project_id?: string;
      parent_id?: string;
      page_count?: number;
    },
  ) => {
    if (!base) {
      throw new KnowledgeApiError({
        status: 503,
        code: "BACKEND_NOT_READY",
      });
    }
    const form = new FormData();
    form.set("file", file);
    form.set("workspace_id", DEFAULT_WORKSPACE);
    if (options?.project_id) form.set("project_id", options.project_id);
    if (options?.parent_id) form.set("parent_id", options.parent_id);
    if (options?.page_count != null) {
      form.set("page_count", String(options.page_count));
    }

    // Raw fetch (not fetchApi) so the browser sets the multipart boundary.
    const response = await fetch(`${base}/pages/import/pdf`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => undefined);
      const code =
        typeof errorData === "object" &&
        errorData !== null &&
        "error" in errorData &&
        typeof (errorData as { error?: unknown }).error === "string"
          ? (errorData as { error: string }).error
          : `HTTP_${response.status}`;
      throw new KnowledgeApiError({
        status: response.status,
        code,
        payload: errorData,
      });
    }
    const data = (await response.json()) as { page?: Page };
    return data?.page ?? null;
  };

  const pdfUrl = (pageId: string) =>
    base ? `${base}/pages/${pageId}/pdf` : "";

  const getPage = async (
    pageId: string,
    options?: { signal?: AbortSignal },
  ) => {
    const result = await fetchApi<{ page: Page }>(`/pages/${pageId}`, {
      signal: options?.signal,
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const updatePageMeta = async (
    pageId: string,
    updates: UpdatePageMetaParams,
    options?: { requestId?: string; ifUnmodifiedSince?: string },
  ) => {
    const headers: Record<string, string> = {};
    if (options?.requestId) headers["X-Request-Id"] = options.requestId;
    if (options?.ifUnmodifiedSince)
      headers["If-Unmodified-Since"] = options.ifUnmodifiedSince;
    const result = await fetchApi<{ page: Page }>(`/pages/${pageId}/meta`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const updatePageContent = async (
    pageId: string,
    content: UpdatePageContentParams,
    options?: {
      ifUnmodifiedSince?: string;
      requestId?: string;
      signal?: AbortSignal;
    },
  ) => {
    const headers: Record<string, string> = {};
    if (options?.ifUnmodifiedSince) {
      headers["If-Unmodified-Since"] = options.ifUnmodifiedSince;
    }
    if (options?.requestId) {
      headers["X-Request-Id"] = options.requestId;
    }

    const result = await fetchApi<{ page: Page; requestId?: string }>(
      `/pages/${pageId}/content`,
      {
        method: "PATCH",
        headers,
        signal: options?.signal,
        body: JSON.stringify(content),
      },
    );
    if (result.error) throw result.error;
    return result.data ?? null;
  };

  const movePage = async (pageId: string, target: MovePageParams) => {
    const result = await fetchApi<{ page: Page }>(`/pages/${pageId}/move`, {
      method: "POST",
      body: JSON.stringify(target),
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const deletePage = async (pageId: string) => {
    const result = await fetchApi<void>(`/pages/${pageId}`, {
      method: "DELETE",
    });
    if (result.error) throw result.error;
    return true;
  };

  const restorePage = async (pageId: string) => {
    const result = await fetchApi<{ page: Page }>(`/pages/${pageId}/restore`, {
      method: "POST",
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const getWorkspaceTree = async (workspaceId: string) => {
    const result = await fetchApi<{ pages: PageTreeNode[] }>(
      `/workspaces/${workspaceId}/tree`,
    );
    if (result.error) throw result.error;
    return result.data?.pages ?? [];
  };

  const getProjectTree = async (projectId: string, workspaceId: string) => {
    const result = await fetchApi<{ pages: PageTreeNode[] }>(
      `/projects/${projectId}/tree?workspace_id=${encodeURIComponent(workspaceId)}`,
    );
    if (result.error) throw result.error;
    return result.data?.pages ?? [];
  };

  const searchPages = async (
    workspaceId: string,
    query: string,
    scope: "all" | "workspace" | "projects" = "all",
  ) => {
    const params = new URLSearchParams({
      q: query,
      scope,
      workspace_id: workspaceId,
    });
    const result = await fetchApi<{ results: PageSearchResult[] }>(
      `/search?${params}`,
    );
    if (result.error) throw result.error;
    return result.data?.results ?? [];
  };

  const ensureProjectRoot = async (params: {
    workspace_id: string;
    project_id: string;
    title: string;
  }) => {
    const result = await fetchApi<{ page: Page }>("/ensure-project-root", {
      method: "POST",
      body: JSON.stringify(params),
    });
    if (result.error) throw result.error;
    return result.data?.page ?? null;
  };

  const bulkDeletePages = async (
    pageIds: string[],
  ): Promise<BulkDeleteResult> => {
    const result = await fetchApi<BulkDeleteResult>("/pages/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ page_ids: pageIds }),
    });
    if (result.error) throw result.error;
    return result.data ?? { deleted: [], failed: [] };
  };

  const bulkMovePages = async (
    pageIds: string[],
    targetParentId: string | null,
  ): Promise<BulkMoveResult> => {
    const result = await fetchApi<BulkMoveResult>("/pages/bulk-move", {
      method: "POST",
      body: JSON.stringify({
        page_ids: pageIds,
        target_parent_id: targetParentId,
      }),
    });
    if (result.error) throw result.error;
    return result.data ?? { moved: [], failed: [] };
  };

  return {
    draftNamespace: base ?? `unavailable:${moduleId}`,
    createPage,
    importPdf,
    pdfUrl,
    getPage,
    updatePageMeta,
    updatePageContent,
    movePage,
    deletePage,
    restorePage,
    getWorkspaceTree,
    getProjectTree,
    searchPages,
    ensureProjectRoot,
    bulkDeletePages,
    bulkMovePages,
  };
}
