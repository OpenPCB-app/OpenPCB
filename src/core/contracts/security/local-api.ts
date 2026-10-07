export const LOCAL_API_TOKEN_HEADER = "X-OpenPCB-Token";

export function isPrivilegedLocalApiPath(pathname: string): boolean {
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { /* Preserve the literal path for fail-closed prefix matching. */ }
  return /^\/(?:api\/)?(?:modules\/)?(?:assistant|tasks)(?:\/|$)/.test(path);
}

/** Ephemeral application access, separate from provider credentials and MCP access. */
export interface LocalApiBootstrap {
  url: string;
  token: string;
}

export interface LocalApiSecurityConfig {
  token: string;
  rendererOrigins?: readonly string[];
  allowOpaqueOrigin?: boolean;
}

export interface RendererLocalApi {
  bootstrap(): Promise<LocalApiBootstrap | null>;
}
