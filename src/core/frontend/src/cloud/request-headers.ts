import { readCloudConfig } from "./config";

/**
 * Per-request cloud credential headers for the local backend.
 *
 * The desktop backend never stores tokens — the renderer forwards the live
 * session per request (`x-cloud-bearer`) plus the service URLs, and the backend
 * parses them in each module's `cloudCredsFromHeaders`. Anything that hits a
 * backend route which in turn talks to the cloud needs these.
 *
 * Structurally typed on `access_token` so it accepts a Supabase `Session`
 * without importing the SDK type into core.
 */
export function cloudRequestHeaders(
  session: { access_token: string } | null | undefined,
): Record<string, string> {
  if (!session?.access_token) return {};
  const cfg = readCloudConfig();
  return {
    "x-cloud-bearer": session.access_token,
    ...(cfg.apiUrl ? { "x-cloud-api-url": cfg.apiUrl } : {}),
  };
}
