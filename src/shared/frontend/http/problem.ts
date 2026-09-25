/**
 * The one mapping from a failed request to user-facing copy (T-006). Every
 * surface renders `describeError(err, action)` — never `HTTP 500`, "Failed to
 * fetch", runtime strings or stack traces. Raw detail stays on the error for
 * logs (`ApiError.diagnostic`).
 */

/** Problem type the backend uses when OpenPCB Cloud cannot be reached. */
export const CLOUD_UNREACHABLE_TYPE = "https://openpcb.dev/problems/cloud-unreachable";

export const LOCAL_SERVICE_UNREACHABLE = "Can't reach the local OpenPCB service";
export const CLOUD_UNREACHABLE =
  "Can't reach OpenPCB Cloud — you're offline or the service is down. Your local work is unaffected.";

export interface DescribeErrorOptions {
  /**
   * Names the remote the request depends on (e.g. "OpenPCB Cloud", "the AI
   * provider"): a connect failure — the backend's outbound call, or the
   * browser's own fetch when it calls that remote directly — then reads
   * "Can't reach <service>" instead of blaming the local service.
   */
  service?: string;
}

function remoteUnreachable(service: string | undefined): string {
  if (!service) return "Can't reach the remote service — you're offline or it's down";
  if (service === "OpenPCB Cloud") return CLOUD_UNREACHABLE;
  return `Can't reach ${service} — you're offline or it's down`;
}

/** The request never got a response: the named remote, else the local backend. */
function unreachable(options: DescribeErrorOptions): string {
  return options.service ? remoteUnreachable(options.service) : LOCAL_SERVICE_UNREACHABLE;
}

export interface ApiErrorInit {
  /** HTTP status; 0 when the request never got a response. */
  status: number;
  code?: string;
  type?: string;
  title?: string;
  detail?: string;
  requestId?: string;
  /** Parsed response body, for callers that need typed extras. */
  body?: unknown;
}

/** A failed HTTP call. `message` is already user-safe copy. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly type?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly body?: unknown;

  constructor(init: ApiErrorInit) {
    super("");
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.type = init.type;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.body = init.body;
    this.message = describeError(this);
  }

  /** Raw summary for logs / "Copy details" — not for display. */
  get diagnostic(): string {
    const parts = [`HTTP ${this.status}`];
    if (this.code) parts.push(this.code);
    if (this.title) parts.push(this.title);
    if (this.detail) parts.push(this.detail);
    if (this.requestId) parts.push(`request ${this.requestId}`);
    return parts.join(" · ");
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Reads problem+json, `{ error }`, `{ ok:false, code }` and `{ message }` bodies. */
export function apiErrorFromBody(
  status: number,
  body: unknown,
  requestId?: string,
): ApiError {
  const record = asRecord(body);
  const nested = asRecord(record?.error);
  return new ApiError({
    status,
    body,
    requestId: requestId ?? asText(record?.requestId),
    type: asText(record?.type),
    title: asText(record?.title),
    code: asText(record?.code) ?? asText(nested?.code),
    detail:
      asText(record?.detail) ??
      asText(record?.error) ??
      asText(nested?.message) ??
      asText(record?.message) ??
      (typeof body === "string" ? asText(body) : undefined),
  });
}

/** Builds an ApiError from a non-OK Response (never throws). */
export async function apiErrorFromResponse(
  res: Response,
  fallbackMessage?: string,
): Promise<ApiError> {
  let body: unknown;
  try {
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = /<html|<!doctype/i.test(text) ? undefined : text;
    }
  } catch {
    body = undefined;
  }
  const error = apiErrorFromBody(res.status, body, res.headers.get("x-request-id") ?? undefined);
  if (fallbackMessage && !error.detail && !error.title) {
    return new ApiError({
      status: error.status,
      requestId: error.requestId,
      body,
      title: fallbackMessage,
    });
  }
  return error;
}

/** The browser's fetch failed (also when re-thrown as a plain Error or string). */
const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|err_connection|err_internet/i;
/** Safari's wording — too generic to trust outside fetch's own TypeError. */
const SAFARI_FETCH_FAILURE = /load failed/i;
const OUTBOUND_FAILURE =
  /unable to connect|econnrefused|enotfound|etimedout|econnreset|eai_again|getaddrinfo|fetch failed|socket hang up|connectionrefused/i;
const RUNTIME_NOISE =
  /is not a function|cannot read propert|cannot set propert|undefined is not|null is not|is not defined|unexpected token|maximum call stack|sqlite_|constraint failed|typeerror|referenceerror|syntaxerror|internal server error|internal error|unknown error|^http \d{3}/i;

/** True when a server/detail string is fit to show a user verbatim. */
export function isSafeDetail(detail: string | undefined): detail is string {
  if (!detail) return false;
  if (detail.length > 200 || /\n/.test(detail)) return false;
  if (/\bat .+:\d+|file:\/\/|node_modules|\/users\/|\.(ts|js|tsx):\d/i.test(detail)) return false;
  return ![RUNTIME_NOISE, OUTBOUND_FAILURE, NETWORK_FAILURE].some((re) => re.test(detail));
}

function isAbort(err: unknown): boolean {
  const name = (asRecord(err)?.name as string | undefined) ?? "";
  return name === "AbortError";
}

function messageOf(err: unknown): string | undefined {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : undefined;
}

/**
 * The request never got a response — fetch's TypeError, or its "Failed to
 * fetch" text re-thrown as a plain Error or string.
 */
export function isNetworkError(err: unknown): boolean {
  if (isApiError(err)) return err.status === 0;
  if (err instanceof TypeError && SAFARI_FETCH_FAILURE.test(err.message)) return true;
  const message = messageOf(err);
  return message !== undefined && NETWORK_FAILURE.test(message);
}

function isCloudUnreachable(err: ApiError): boolean {
  return err.type === CLOUD_UNREACHABLE_TYPE || err.code === "CLOUD_UNREACHABLE";
}

function reasonForStatus(err: ApiError, options: DescribeErrorOptions = {}): string {
  const detail = isSafeDetail(err.detail) ? err.detail : undefined;
  const { status } = err;
  if (isCloudUnreachable(err)) return CLOUD_UNREACHABLE;
  if (status === 0) return unreachable(options);
  if (err.code === "REVISION_CONFLICT" || /^REVISION_CONFLICT\b/.test(err.detail ?? "")) {
    return "The design changed elsewhere — reload it and try again";
  }
  // The backend answered, so a connect failure in its text is about a remote it called.
  const text = `${err.detail ?? ""} ${err.title ?? ""}`;
  if (OUTBOUND_FAILURE.test(text) || NETWORK_FAILURE.test(text)) {
    return remoteUnreachable(options.service);
  }
  if (status === 409) return detail ?? "It changed elsewhere — reload and try again";
  if (status === 400 || status === 422) return detail ?? "The request was not valid";
  if (status === 401) return "Sign-in required — sign in and try again";
  if (status === 403) return "You don't have permission to do that";
  if (status === 404) return detail ?? "Not found — it may have been deleted";
  if (status === 408 || status === 504) return "The request timed out — try again";
  if (status === 413) return "File too large";
  if (status === 429) return "Too many requests — wait a moment and try again";
  if (status >= 500) {
    const base = `Something went wrong in the local service (HTTP ${status})`;
    return detail ? `${base}: ${detail}` : base;
  }
  return detail ?? (isSafeDetail(err.title) ? err.title : `Request failed (HTTP ${status})`);
}

function reasonFor(err: unknown, options: DescribeErrorOptions): string {
  if (isApiError(err)) return reasonForStatus(err, options);
  if (isAbort(err)) return "The request was cancelled";
  if (isNetworkError(err)) return unreachable(options);
  const message = messageOf(err);
  // Legacy `throw new Error(\`HTTP ${status}\`)` call sites.
  const legacy = message?.match(/^HTTP (\d{3})\b/);
  if (legacy) return reasonForStatus(new ApiError({ status: Number(legacy[1]) }), options);
  if (message && OUTBOUND_FAILURE.test(message)) return remoteUnreachable(options.service);
  return isSafeDetail(message) ? message : "Something went wrong";
}

/**
 * User copy for any thrown value. `action` is a verb phrase ("delete part")
 * and becomes the prefix "Couldn't delete part: …"; a phrase that already
 * starts with "Couldn't"/"Could not"/"Failed" is used as-is.
 */
export function describeError(
  err: unknown,
  action?: string,
  options: DescribeErrorOptions = {},
): string {
  const reason = reasonFor(err, options);
  const verb = action?.trim();
  if (!verb) return reason;
  const prefix = /^(couldn't|could not|can't|cannot|failed)\b/i.test(verb)
    ? verb
    : `Couldn't ${verb}`;
  return `${prefix}: ${reason}`;
}

/** True when repeating the same request may succeed (show a Retry). */
export function isRetryableError(err: unknown): boolean {
  if (isAbort(err)) return false;
  if (isNetworkError(err)) return true;
  if (isApiError(err)) {
    if (isCloudUnreachable(err)) return true;
    return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
  }
  const message = messageOf(err) ?? "";
  const legacy = message.match(/^HTTP (\d{3})\b/);
  if (legacy) return Number(legacy[1]) >= 500;
  return OUTBOUND_FAILURE.test(message);
}
