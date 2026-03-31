/**
 * OAuth Configuration
 *
 * Centralized configuration for OAuth client IDs and settings.
 * These are currently hardcoded but should be moved to environment
 * variables or secure storage for production.
 */

// TODO: Move to environment variables or Tauri stronghold for production

/**
 * OpenAI Codex OAuth client ID
 * Registered OpenAI OAuth application for Codex CLI
 */
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * Local redirect port for Codex OAuth callback
 * Server listens on this port for authorization code
 */
export const CODEX_REDIRECT_PORT = 1455;

/**
 * GitHub OAuth client ID for Copilot integration
 * Registered GitHub OAuth application
 */
export const COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz";

/**
 * OAuth scope for GitHub Copilot
 * read:user - Access user profile information
 */
export const COPILOT_SCOPE = "read:user";
