import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token gate for the MCP endpoint.
 *
 * The rest of the local API is unauthenticated (loopback is its whole boundary
 * — see `src/core/backend/http/cors.ts`). MCP gets a token anyway: it is the
 * one route that lets an arbitrary local process mutate designs on a schedule,
 * and the shim already has to read a portfile, so carrying a secret in it costs
 * nothing. The token is generated per app launch by Electron main and handed
 * over in `OPENPCB_MCP_TOKEN`.
 */

export type McpAuthFailure =
  | { code: "server_misconfigured"; message: string }
  | { code: "unauthorized"; message: string };

/**
 * Compare SHA-256 digests rather than the raw strings: `timingSafeEqual`
 * throws on a length mismatch, and branching on length first would leak it.
 * Digests are always 32 bytes, so every comparison costs the same.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

function readBearer(req: Pick<Request, "headers">): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Returns `null` when the request is authorised, otherwise the failure to
 * render. A missing `OPENPCB_MCP_TOKEN` fails closed: without it there is
 * nothing to check against, and serving unauthenticated would silently drop
 * the only gate this endpoint has.
 */
export function checkMcpAuth(req: Pick<Request, "headers">): McpAuthFailure | null {
  const expected = process.env.OPENPCB_MCP_TOKEN;
  if (!expected || expected.length === 0) {
    return {
      code: "server_misconfigured",
      message:
        "MCP server has no token configured (OPENPCB_MCP_TOKEN is unset). Restart OpenPCB.",
    };
  }
  const presented = readBearer(req);
  if (!presented) {
    return {
      code: "unauthorized",
      message:
        "Missing bearer token. Read it from the OpenPCB MCP portfile (mcp.json) and send it as 'Authorization: Bearer <token>'.",
    };
  }
  if (!constantTimeEquals(presented, expected)) {
    return { code: "unauthorized", message: "Invalid bearer token." };
  }
  return null;
}
