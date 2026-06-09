import { useAuth } from "@/cloud/AuthProvider";

export interface AccountSession {
  email: string;
  tier: "pro" | null;
}

/**
 * Cloud session source of truth for the Account page, derived from the
 * AuthProvider. Returns `null` when signed out (or cloud is unavailable).
 */
export function useSession(): AccountSession | null {
  const { user, tier } = useAuth();
  if (!user) return null;
  return { email: user.email ?? "", tier };
}
