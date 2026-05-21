import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCloudConfig } from "./config";
import { createCloudStorage } from "./secure-storage-adapter";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = readCloudConfig();
  if (!cfg.enabled) return null;
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      // PKCE: required for Electron deep-link OAuth return path.
      flowType: "pkce",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage: createCloudStorage(),
      storageKey: "openpcb.auth",
    },
  });
  return client;
}
