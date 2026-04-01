/**
 * HTTP Helper Functions
 * CORS utilities only - use ResponseBuilder for all responses
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "tauri://localhost",
  "https://tauri.localhost",
];

const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-OpenPCB-Token, If-Unmodified-Since, X-Request-Id",
};

const VARY_ORIGIN = "Origin";

function resolveAllowedOrigins(): Set<string> {
  const raw = process.env.OPENPCB_ALLOWED_ORIGINS;
  if (!raw || raw.trim().length === 0) {
    return new Set(DEFAULT_ALLOWED_ORIGINS);
  }

  const parsed = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return new Set(parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS);
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

export function isTrustedOrigin(origin: string | null): boolean {
  if (!origin || origin.trim().length === 0) {
    return true;
  }

  return ALLOWED_ORIGINS.has(origin);
}

export const CORS_HEADERS = {
  ...CORS_BASE_HEADERS,
  Vary: VARY_ORIGIN,
};

function buildCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin || origin.trim().length === 0) {
    return CORS_HEADERS;
  }

  if (!isTrustedOrigin(origin)) {
    return CORS_HEADERS;
  }

  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": origin,
  };
}

export function withCorsHeaders(
  response: Response,
  origin: string | null,
): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(origin);

  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a CORS preflight response
 */
export function corsPreflightResponse(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}
