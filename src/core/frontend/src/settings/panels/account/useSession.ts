export interface AccountSession {
  email: string;
}

/**
 * Cloud session source of truth for the Account page.
 *
 * No auth backend is wired in the desktop app yet, so this always returns
 * `null` (signed-out). When CLOUD_AUTH_ENABLED flips on, replace the body
 * with a real session subscription. // TODO(cloud-auth)
 */
export function useSession(): AccountSession | null {
  return null;
}
