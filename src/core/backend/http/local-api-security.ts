import { timingSafeEqual } from "node:crypto";
import { LOCAL_API_TOKEN_HEADER, isPrivilegedLocalApiPath, type LocalApiSecurityConfig } from "../../contracts/security/local-api";
import type { Middleware, RequestContext } from "./request-context";
import { buildCorsHeaders, withCorsHeaders } from "./cors";

export const DEFAULT_JSON_BODY_LIMIT = 1024 * 1024;
const MCP_PATH = "/api/modules/assistant/mcp";

function denied(status: number, detail: string): Response {
  return Response.json({ type: "about:blank", title: status === 401 ? "Unauthorized" : "Forbidden", status, detail },
    { status, headers: { "content-type": "application/problem+json" } });
}

function tokenMatches(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected || expected.length < 32) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createLocalApiSecurityMiddleware(
  security: LocalApiSecurityConfig | undefined,
  backendOrigin: () => string,
): Middleware {
  return async (ctx, next) => {
    if (!isPrivilegedLocalApiPath(ctx.url.pathname)) return next();
    const expected = new URL(backendOrigin());
    const host = ctx.req.headers.get("host") ?? ctx.url.host;
    if (host !== expected.host || ctx.url.host !== expected.host) return denied(403, "Host not allowed");
    const origin = ctx.req.headers.get("origin");
    const origins = new Set([expected.origin, ...(security?.rendererOrigins ?? [])]);
    if (origin && !(origins.has(origin) || (origin === "null" && security?.allowOpaqueOrigin))) {
      return denied(403, "Origin not allowed");
    }
    // Browsers cannot send the token on preflight; no application handler runs here.
    if (ctx.req.method === "OPTIONS") return next();
    // The MCP handler independently verifies its own bearer, never the app token.
    if (ctx.url.pathname === MCP_PATH) return next();
    if (!tokenMatches(ctx.req.headers.get(LOCAL_API_TOKEN_HEADER), security?.token)) {
      return withCorsHeaders(denied(401, "Application token required"), buildCorsHeaders(origin, origins));
    }
    return next();
  };
}

function bodyError(status: number, detail: string): Response {
  return Response.json({ type: "about:blank", title: status === 413 ? "Payload Too Large" : "Bad Request", status, detail },
    { status, headers: { "content-type": "application/problem+json" } });
}

async function readBoundedBody(ctx: RequestContext, limit: number): Promise<Uint8Array | Response> {
  const length = ctx.req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return bodyError(413, "Request body exceeds limit");
  const reader = ctx.req.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        return bodyError(413, "Request body exceeds limit");
      }
      chunks.push(chunk.value);
    }
  } catch { return bodyError(400, "Request body could not be read"); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export const boundedJsonBodyMiddleware: Middleware = async (ctx, next) => {
  if (!ctx.req.body || !isPrivilegedLocalApiPath(ctx.url.pathname)) return next();
  const contentType = ctx.req.headers.get("content-type") ?? "";
  const json = /^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(contentType);
  const bytes = await readBoundedBody(ctx, DEFAULT_JSON_BODY_LIMIT);
  if (bytes instanceof Response) return bytes;
  if (json && bytes.byteLength) {
    try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return bodyError(400, "Request body must be valid JSON"); }
  }
  ctx.req = new Request(ctx.req, { body: bytes });
  return next();
};
