// Cloud SaaS endpoints — set via Vite env vars at build time.
// Leaving these blank in dev disables cloud features (offline desktop mode).

export interface CloudConfig {
  enabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
  // Cloud website (dashboard) host that hosts the browser login page. Not part
  // of `enabled` so existing sessions keep working if it's unset; the login
  // flow validates it separately (see AuthProvider.beginCloudLogin).
  webUrl: string;
}

export function readCloudConfig(): CloudConfig {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  const supabaseAnonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";
  const apiUrl = (import.meta.env.VITE_CLOUD_API_URL as string) ?? "";
  const webUrl = (import.meta.env.VITE_CLOUD_WEB_URL as string) ?? "";
  return {
    enabled: Boolean(supabaseUrl && supabaseAnonKey && apiUrl),
    supabaseUrl,
    supabaseAnonKey,
    apiUrl,
    webUrl,
  };
}
