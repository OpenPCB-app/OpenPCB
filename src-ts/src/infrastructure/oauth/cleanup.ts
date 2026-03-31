/**
 * OAuth Cleanup Hook
 *
 * Handles graceful cleanup of active OAuth callback listeners on application shutdown.
 * Ensures all HTTP servers are closed properly to prevent orphaned ports.
 */

import type { OAuthService } from "./oauth-service.js";

/**
 * Register OAuth cleanup handlers for process termination signals
 *
 * Listens for SIGTERM, SIGINT, and beforeExit events to ensure
 * active callback listeners are closed gracefully.
 *
 * @param oauthService - OAuthService instance to cleanup
 */
export function createOAuthCleanup(oauthService: OAuthService): void {
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await oauthService.cleanup();
      console.log("[OAuth] Cleanup complete");
    } catch (err) {
      console.error("[OAuth] Cleanup failed:", err);
    }
  };

  // Handle SIGTERM (docker stop, systemd, etc.)
  process.on("SIGTERM", async () => {
    console.log("[OAuth] Received SIGTERM, cleaning up...");
    await cleanup();
    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", async () => {
    console.log("[OAuth] Received SIGINT, cleaning up...");
    await cleanup();
    process.exit(0);
  });

  console.log("[OAuth] Cleanup handlers registered (SIGTERM, SIGINT)");
}
