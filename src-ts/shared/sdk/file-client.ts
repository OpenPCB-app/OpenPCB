import { customFetch } from "./mutator";
import type {
  FileRecord,
  FileQueryParams,
  FileVersionRecord,
  FileVersionResult,
  InitiateUploadRequest,
  UploadSessionInfo,
  ChunkUploadResult,
  UploadProgress,
} from "../types/file.types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(resp: ApiResponse<T>): T {
  if (!resp.ok || !resp.data) {
    throw new Error(resp.error?.message || "File API request failed");
  }
  return resp.data;
}

export async function uploadFile(formData: FormData): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>("/api/files", {
    method: "POST",
    body: formData,
  });
  return unwrap(response).file;
}

export async function listFiles(params: FileQueryParams = {}): Promise<FileRecord[]> {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.spaceId) search.set("spaceId", params.spaceId);
  if (params.mimeType) search.set("mimeType", params.mimeType);
  if (params.status) search.set("status", params.status);
  if (params.fromDate) search.set("fromDate", params.fromDate);
  if (params.toDate) search.set("toDate", params.toDate);
  if (params.limit) search.set("limit", params.limit.toString());
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","));

  const response = await customFetch<ApiResponse<{ files: FileRecord[] }>>(`/api/files?${search.toString()}`);
  return unwrap(response).files;
}

export async function getFileMeta(id: string): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(`/api/files/${encodeURIComponent(id)}/meta`);
  return unwrap(response).file;
}

export async function softDeleteFile(id: string): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(`/api/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return unwrap(response).file;
}

export async function restoreFile(id: string): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(`/api/files/${encodeURIComponent(id)}/restore`, {
    method: "POST",
  });
  return unwrap(response).file;
}

export async function updateFileMetadata(id: string, metadata: Record<string, unknown>): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(
    `/api/files/${encodeURIComponent(id)}/metadata`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata }),
    },
  );
  return unwrap(response).file;
}

export async function emptyTrash(params: { workspaceId?: string; projectId?: string; spaceId?: string } = {}): Promise<{
  deletedCount: number;
  freedBytes: number;
}> {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.spaceId) search.set("spaceId", params.spaceId);

  const response = await customFetch<ApiResponse<{ deletedCount: number; freedBytes: number }>>(
    `/api/files/trash/empty?${search.toString()}`,
    { method: "POST" },
  );
  return unwrap(response);
}

// Versioning methods

export async function uploadVersion(
  fileId: string,
  file: File | Blob,
  options?: { createdBy?: string; comment?: string }
): Promise<FileVersionResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.createdBy) formData.append("createdBy", options.createdBy);
  if (options?.comment) formData.append("comment", options.comment);

  const response = await customFetch<ApiResponse<FileVersionResult>>(
    `/api/files/${encodeURIComponent(fileId)}/versions`,
    {
      method: "POST",
      body: formData,
    }
  );
  return unwrap(response);
}

export async function listVersions(fileId: string): Promise<FileVersionRecord[]> {
  const response = await customFetch<ApiResponse<{ versions: FileVersionRecord[] }>>(
    `/api/files/${encodeURIComponent(fileId)}/versions`
  );
  return unwrap(response).versions;
}

export async function getVersion(fileId: string, version: number): Promise<FileVersionRecord> {
  const response = await customFetch<ApiResponse<{ version: FileVersionRecord }>>(
    `/api/files/${encodeURIComponent(fileId)}/versions/${version}`
  );
  return unwrap(response).version;
}

export function getVersionContentUrl(fileId: string, version: number): string {
  return `/api/files/${encodeURIComponent(fileId)}/versions/${version}/content`;
}

export async function restoreVersion(fileId: string, version: number): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(
    `/api/files/${encodeURIComponent(fileId)}/versions/${version}/restore`,
    { method: "POST" }
  );
  return unwrap(response).file;
}

export async function deleteVersion(fileId: string, version: number): Promise<void> {
  await customFetch<ApiResponse<{ deleted: boolean }>>(
    `/api/files/${encodeURIComponent(fileId)}/versions/${version}`,
    { method: "DELETE" }
  );
}

// Chunked upload methods

export async function initiateChunkedUpload(request: InitiateUploadRequest): Promise<UploadSessionInfo> {
  const response = await customFetch<ApiResponse<{ session: UploadSessionInfo }>>(
    "/api/uploads/initiate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  return unwrap(response).session;
}

export async function uploadChunk(
  sessionId: string,
  chunkIndex: number,
  chunk: Blob | ArrayBuffer
): Promise<ChunkUploadResult> {
  const response = await customFetch<ApiResponse<ChunkUploadResult>>(
    `/api/uploads/${encodeURIComponent(sessionId)}/chunks/${chunkIndex}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
    }
  );
  return unwrap(response);
}

export async function completeChunkedUpload(sessionId: string): Promise<FileRecord> {
  const response = await customFetch<ApiResponse<{ file: FileRecord }>>(
    `/api/uploads/${encodeURIComponent(sessionId)}/complete`,
    { method: "POST" }
  );
  return unwrap(response).file;
}

export async function abortChunkedUpload(sessionId: string): Promise<void> {
  await customFetch<ApiResponse<{ aborted: boolean }>>(
    `/api/uploads/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

export async function getUploadProgress(sessionId: string): Promise<UploadProgress> {
  const response = await customFetch<ApiResponse<{ progress: UploadProgress }>>(
    `/api/uploads/${encodeURIComponent(sessionId)}/progress`
  );
  return unwrap(response).progress;
}

/**
 * Upload a large file using chunked upload
 * Handles splitting, uploading, and assembly automatically
 */
export async function uploadFileChunked(
  file: File,
  context: { workspaceId: string; projectId?: string; spaceId?: string },
  options?: {
    chunkSize?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<FileRecord> {
  const chunkSize = options?.chunkSize || 5 * 1024 * 1024; // 5MB default

  // Initiate session
  const session = await initiateChunkedUpload({
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    totalSize: file.size,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    spaceId: context.spaceId,
    chunkSize,
  });

  try {
    // Upload chunks
    let uploadedChunks = 0;
    for (let i = 0; i < session.totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const buffer = await chunk.arrayBuffer();

      await uploadChunk(session.sessionId, i, buffer);
      uploadedChunks++;

      if (options?.onProgress) {
        options.onProgress(uploadedChunks / session.totalChunks);
      }
    }

    // Complete upload
    return await completeChunkedUpload(session.sessionId);
  } catch (err) {
    // Abort on error
    try {
      await abortChunkedUpload(session.sessionId);
    } catch {
      // Ignore abort errors
    }
    throw err;
  }
}
