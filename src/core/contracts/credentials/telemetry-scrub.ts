/**
 * Defense-in-depth for crash reports: credentials are redacted at their source, but an
 * echo that slips through (provider error text, a header bag in breadcrumb data) must
 * still never leave the machine. Shared by the main, renderer and backend Sentry hooks.
 */
export const TELEMETRY_REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization", "proxyauthorization", "xopenpcbtoken", "xapikey", "apikey",
  "apikeysecretref", "secretref", "secretrefs", "clientsecret", "secret", "password",
  "passwd", "token", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "bearer",
  "cookie", "setcookie", "openpcbmcptoken", "privatekey",
]);
const SENSITIVE_SUFFIXES = ["token", "secret", "apikey", "password"];
const HEADER_VALUE =
  /\b(authorization|proxy-authorization|x-openpcb-token|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|token|secret)(["']?\s*[:=]\s*["']?)((?:(?:bearer|basic)\s+)?[^\s"'&,;}\]]+)/gi;
const SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=%-]{4,}/gi;
const QUERY_KEY = /([?&](?:key|sig|signature)=)[^&\s#"']+/gi;
const PROVIDER_KEY = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const MAX_DEPTH = 32;

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYS.has(normalized)
    || SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function scrubTelemetryString(value: string): string {
  return value
    .replace(HEADER_VALUE, `$1$2${TELEMETRY_REDACTED}`)
    .replace(SCHEME_VALUE, `$1 ${TELEMETRY_REDACTED}`)
    .replace(QUERY_KEY, `$1${TELEMETRY_REDACTED}`)
    .replace(PROVIDER_KEY, TELEMETRY_REDACTED)
    .replace(JWT, TELEMETRY_REDACTED);
}

function isPlainContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scrub(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubTelemetryString(value);
  if (!value || typeof value !== "object" || !isPlainContainer(value)) return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, seen));
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = sensitiveKey(key) && child !== null && child !== undefined && child !== ""
        ? TELEMETRY_REDACTED : scrub(child, depth + 1, seen);
    }
    return result;
  } finally { seen.delete(value); }
}

/** Returns a redacted copy of a Sentry event, breadcrumb, log or transaction. */
export function scrubTelemetry<T>(value: T): T {
  return scrub(value, 0, new WeakSet()) as T;
}

/** Spread into every `Sentry.init` so no process ships an unscrubbed payload. */
export const TELEMETRY_SCRUB_HOOKS = {
  beforeSend: <T>(event: T): T => scrubTelemetry(event),
  beforeSendTransaction: <T>(event: T): T => scrubTelemetry(event),
  beforeBreadcrumb: <T>(breadcrumb: T): T => scrubTelemetry(breadcrumb),
  beforeSendLog: <T>(log: T): T => scrubTelemetry(log),
} as const;
