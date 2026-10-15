// Typed errors for the cloud Auto Layout surface.
//
// The UI must never parse English out of an error string. Before this, a quota rejection
// reached the user as the literal text `auto-router 429: in-flight job limit reached (1)`,
// which is both unreadable and unbranchable. Everything crossing this boundary now carries
// a stable machine code; the message is for logs and for a human reading a report.

/** Stable codes. The UI switches on these; they are part of the desktop's own contract. */
export type AutoLayoutErrorCode =
  /** No cloud session — the user is signed out or the token expired. */
  | "AUTO_LAYOUT_AUTH_REQUIRED"
  /** Authenticated but not permitted (kept for a future entitlement policy). */
  | "AUTO_LAYOUT_FORBIDDEN"
  /** Per-user in-flight job limit; another job of ANY engine is already running. */
  | "AUTO_LAYOUT_QUOTA_EXCEEDED"
  /** The service rejected the board snapshot (422 + structured diagnostics). */
  | "AUTO_LAYOUT_SNAPSHOT_INVALID"
  /** The deployment does not mount the endpoint this feature needs. */
  | "AUTO_LAYOUT_SERVICE_UNSUPPORTED"
  /** Job or result no longer exists (TTL) — rerun rather than retry. */
  | "AUTO_LAYOUT_RESULT_EXPIRED"
  /** The board changed since the candidate was computed. */
  | "AUTO_LAYOUT_STALE"
  /** The named candidate is not in this job's result. */
  | "AUTO_LAYOUT_INVALID_CANDIDATE"
  /** The candidate exists but cannot be applied (failed / no envelopes / cancelled). */
  | "AUTO_LAYOUT_CANDIDATE_NOT_APPLICABLE"
  /** An operation inside the candidate was rejected by the command layer. */
  | "AUTO_LAYOUT_OPERATION_INVALID"
  /** Optimistic-concurrency conflict at dispatch. */
  | "AUTO_LAYOUT_REVISION_CONFLICT"
  /** The applyRequestId was already used for a different apply request. */
  | "AUTO_LAYOUT_REQUEST_CONFLICT"
  /** The service answered with something this desktop cannot parse. */
  | "AUTO_LAYOUT_CONTRACT_MISMATCH"
  /** Network failure, timeout, or a 5xx from the service. */
  | "AUTO_LAYOUT_SERVICE_ERROR";

export class AutoLayoutError extends Error {
  readonly code: AutoLayoutErrorCode;
  readonly status: number;
  readonly detail?: unknown;

  constructor(
    code: AutoLayoutErrorCode,
    message: string,
    options: { status?: number; detail?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AutoLayoutError";
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.detail = options.detail;
  }

  toProblem(): {
    type: string;
    title: string;
    status: number;
    code: AutoLayoutErrorCode;
    detail?: unknown;
  } {
    return {
      type: `https://openpcb.dev/problems/${this.code.toLowerCase().replace(/_/g, "-")}`,
      title: this.message,
      status: this.status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

function statusForCode(code: AutoLayoutErrorCode): number {
  switch (code) {
    case "AUTO_LAYOUT_AUTH_REQUIRED":
      return 401;
    case "AUTO_LAYOUT_FORBIDDEN":
      return 403;
    case "AUTO_LAYOUT_RESULT_EXPIRED":
    case "AUTO_LAYOUT_INVALID_CANDIDATE":
      return 404;
    case "AUTO_LAYOUT_STALE":
    case "AUTO_LAYOUT_REVISION_CONFLICT":
    case "AUTO_LAYOUT_REQUEST_CONFLICT":
      return 409;
    case "AUTO_LAYOUT_SNAPSHOT_INVALID":
    case "AUTO_LAYOUT_CANDIDATE_NOT_APPLICABLE":
    case "AUTO_LAYOUT_OPERATION_INVALID":
      return 422;
    case "AUTO_LAYOUT_QUOTA_EXCEEDED":
      return 429;
    case "AUTO_LAYOUT_SERVICE_UNSUPPORTED":
      return 501;
    case "AUTO_LAYOUT_CONTRACT_MISMATCH":
    case "AUTO_LAYOUT_SERVICE_ERROR":
      return 502;
  }
}

/**
 * Map a cloud HTTP response onto a typed error.
 *
 * The service's own message is preserved as `detail` (it is often genuinely useful — a 422
 * carries structured snapshot diagnostics), but the CODE is what the UI branches on.
 */
export async function errorFromResponse(
  res: Response,
  context: string,
): Promise<AutoLayoutError> {
  let detail: unknown;
  let message = `${context} failed (${res.status})`;
  try {
    const body = (await res.json()) as { detail?: unknown; diagnostics?: unknown };
    detail = body?.diagnostics ?? body?.detail;
    if (typeof body?.detail === "string") message = body.detail;
  } catch {
    // non-JSON body — keep the generic message
  }

  switch (res.status) {
    case 401:
      return new AutoLayoutError(
        "AUTO_LAYOUT_AUTH_REQUIRED",
        "Sign in to OpenPCB Cloud to use Auto Layout.",
        { detail },
      );
    case 403:
      return new AutoLayoutError("AUTO_LAYOUT_FORBIDDEN", message, { detail });
    case 404:
      return new AutoLayoutError(
        "AUTO_LAYOUT_RESULT_EXPIRED",
        "This Auto Layout job is no longer available — run it again.",
        { detail },
      );
    case 409:
      return new AutoLayoutError("AUTO_LAYOUT_STALE", message, { detail });
    case 422:
      return new AutoLayoutError("AUTO_LAYOUT_SNAPSHOT_INVALID", message, { detail });
    case 429:
      return new AutoLayoutError(
        "AUTO_LAYOUT_QUOTA_EXCEEDED",
        "Another cloud job is already running for your account.",
        { detail },
      );
    default:
      return new AutoLayoutError("AUTO_LAYOUT_SERVICE_ERROR", message, {
        status: res.status >= 500 ? 502 : 502,
        detail,
      });
  }
}

/** Wrap a transport-level failure (DNS, refused, timeout, aborted). */
export function errorFromNetwork(cause: unknown, context: string): AutoLayoutError {
  return new AutoLayoutError(
    "AUTO_LAYOUT_SERVICE_ERROR",
    `Could not reach OpenPCB Cloud (${context}).`,
    { cause },
  );
}
