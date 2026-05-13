const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "tauri://localhost",
  "https://tauri.localhost",
];

export interface CorsConfig {
  allowedOrigins?: string[];
}

export const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenPCB-Token, If-Unmodified-Since, X-Request-Id",
  Vary: "Origin",
};

function parseEnvAllowedOrigins(): string[] {
  const raw = process.env.OPENPCB_ALLOWED_ORIGINS;
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  const values = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : DEFAULT_ALLOWED_ORIGINS;
}

export function resolveAllowedOrigins(config?: CorsConfig): Set<string> {
  const fromConfig = config?.allowedOrigins;
  if (fromConfig && fromConfig.length > 0) {
    return new Set(fromConfig);
  }
  return new Set(parseEnvAllowedOrigins());
}

export function isTrustedOrigin(origin: string | null, allowedOrigins: Set<string>): boolean {
  if (!origin || origin.trim().length === 0) {
    return true;
  }
  // Allow null origin (file:// or opaque origins) for packaged Electron
  // when the unauthenticated API flag is set.
  if (origin === "null" && process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API === "true") {
    return true;
  }
  if (process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API === "true") {
    if (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) {
      return true;
    }
  }
  return allowedOrigins.has(origin);
}

export function buildCorsHeaders(origin: string | null, allowedOrigins: Set<string>): Record<string, string> {
  if (!origin || !isTrustedOrigin(origin, allowedOrigins)) {
    return { ...BASE_CORS_HEADERS };
  }
  return {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Origin": origin,
  };
}

export function withCorsHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    merged.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
