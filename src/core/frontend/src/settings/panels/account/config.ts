// Build-time master switch for OpenPCB Cloud accounts in the desktop app.
// Actual availability ALSO requires the Cloud env vars (VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY / VITE_CLOUD_API_URL) — see useAuth().enabled /
// readCloudConfig(). Set this to false to force an offline build even when
// those vars are present.
export const CLOUD_AUTH_ENABLED = true;

// Inline copy surfaced when cloud is unavailable (build flag off or env unset).
export const COMING_SOON_NOTICE =
  "Cloud accounts aren't available in this build. The desktop app is fully usable offline.";
