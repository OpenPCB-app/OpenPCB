export function toUserError(response: unknown, fallback: string): string {
  if (!response || typeof response !== "object") {
    return fallback;
  }
  const payload = response as {
    error?: unknown;
    detail?: unknown;
    title?: unknown;
    message?: unknown;
  };
  if (typeof payload.error === "string" && payload.error.length > 0) {
    return payload.error;
  }
  if (typeof payload.detail === "string" && payload.detail.length > 0) {
    return payload.detail;
  }
  if (typeof payload.message === "string" && payload.message.length > 0) {
    return payload.message;
  }
  if (typeof payload.title === "string" && payload.title.length > 0) {
    return payload.title;
  }
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function fileSignature(file: File | null): string {
  if (!file) {
    return "";
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function filesSignature(files: File[]): string {
  return files
    .map((file) => fileSignature(file))
    .sort()
    .join("|");
}
