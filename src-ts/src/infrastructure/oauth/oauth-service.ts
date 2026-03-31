/**
 * OAuth Service
 *
 * Main orchestration service that coordinates OAuth flows and manages
 * token persistence. Supports both Codex (PKCE) and GitHub Copilot (Device Code)
 * authentication flows.
 *
 * Responsibilities:
 * - Initiate OAuth flows (generate PKCE, request device codes)
 * - Complete OAuth flows (exchange codes, store tokens)
 * - Token lifecycle management (refresh, expiry checking)
 * - Credential persistence via ProviderOAuthRepository
 * - Retry logic for transient errors
 */

import type { QueryLogger } from "../../db/query-logger.js";
import type { ProviderOAuthRepository } from "../../db/repositories/provider-oauth.js";
import { startOAuthListener, type OAuthListener } from "./callback-server.js";
import {
  authorizeCodex,
  exchangeCodexCode,
  extractCodexAccountId,
  refreshCodexToken,
} from "./providers/codex.js";
import { CODEX_REDIRECT_PORT } from "./config.js";
import {
  requestGitHubDeviceCode,
  pollGitHubToken,
} from "./providers/github.js";
import type {
  OAuthProvider,
  OAuthCredentials,
  OAuthFlowResult,
  DeviceCodeResponse,
} from "./types.js";

export interface CodexFlowInitResult extends OAuthFlowResult {
  url: string;
  verifier: string;
  state: string;
  redirectUri: string;
  listener?: OAuthListener;
}

/**
 * Extended flow result for GitHub Copilot device code flow
 */
export interface GitHubFlowInitResult extends OAuthFlowResult {
  /** Device code for polling */
  deviceCode?: string;
  /** User-facing code to enter at verification URI */
  userCode?: string;
  /** URL where user enters the code */
  verificationUri?: string;
  /** Polling interval in seconds */
  interval?: number;
  /** Expiration time in seconds */
  expiresIn?: number;
}

/**
 * Union type for OAuth flow initiation results
 */
export type OAuthFlowInitResult = CodexFlowInitResult | GitHubFlowInitResult;

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is transient (retryable)
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND"
    ) {
      return true;
    }

    // HTTP 5xx errors (server errors)
    const status = (error as { status?: number }).status;
    if (status !== undefined && status >= 500 && status < 600) {
      return true;
    }

    // Timeout messages
    if (
      error.message.includes("timeout") ||
      error.message.includes("ETIMEDOUT")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Execute a function with retry logic for transient errors
 *
 * @param fn - Function to execute
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @returns Result of the function
 * @throws Last error if all attempts fail
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        throw error;
      }

      // Only retry transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * OAuth Service
 *
 * Coordinates OAuth authentication flows and manages token persistence.
 * Supports Codex (PKCE) and GitHub Copilot (Device Code) providers.
 */
export class OAuthService {
  /**
   * Active callback listeners for Codex flows
   * Maps flow state to listener instance
   */
  private activeListeners = new Map<string, OAuthListener>();

  constructor(
    private repository: ProviderOAuthRepository,
    private logger?: QueryLogger
  ) {}

  /**
   * Start an OAuth flow for the specified provider
   *
   * For 'codex': Generates PKCE codes, builds auth URL, starts callback server
   * For 'github-copilot': Requests device code from GitHub
   *
   * @param provider - OAuth provider ('codex' or 'github-copilot')
   * @param options - Optional flow configuration
   * @returns Flow initiation result with URL/codes for user interaction
   *
   * @example
   * ```typescript
   * // Codex flow
   * const result = await oauthService.startOAuthFlow('codex');
   * if (result.success && 'url' in result) {
   *   // Open result.url in browser
   *   // Store result.state and result.verifier for callback
   * }
   *
   * // GitHub Copilot flow
   * const result = await oauthService.startOAuthFlow('github-copilot');
   * if (result.success && 'userCode' in result) {
   *   // Display result.userCode to user
   *   // Direct user to result.verificationUri
   * }
   * ```
   */
  async startOAuthFlow(
    provider: OAuthProvider,
    options?: { projectId?: string }
  ): Promise<OAuthFlowInitResult> {
    this.log("startOAuthFlow", { provider, projectId: options?.projectId });

    try {
      if (provider === "codex") {
        return await this.startCodexFlow();
      } else if (provider === "github-copilot") {
        return await this.startGitHubFlow();
      } else {
        return {
          success: false,
          error: `Unsupported provider: ${provider}`,
          provider,
        };
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("startOAuthFlow error", { provider, error: errorMsg });
      return {
        success: false,
        error: `Failed to start OAuth flow: ${errorMsg}`,
        provider,
      };
    }
  }

  /**
   * Start Codex OAuth flow with PKCE
   *
   * Generates PKCE codes, builds authorization URL, and starts local
   * callback server to receive the authorization code.
   *
   * @returns Flow result with authorization URL and flow state
   */
  private async startCodexFlow(): Promise<CodexFlowInitResult> {
    // Generate PKCE codes and authorization URL
    const authResult = await withRetry(() => authorizeCodex());

    // Start callback listener
    const listener = await withRetry(() =>
      startOAuthListener(CODEX_REDIRECT_PORT, "/oauth/callback")
    );

    // Store listener for potential cleanup
    this.activeListeners.set(authResult.state, listener);

    // Auto-cleanup listener after timeout
    listener.waitForCallback().finally(() => {
      this.activeListeners.delete(authResult.state);
    });

    return {
      success: true,
      provider: "codex",
      url: authResult.url,
      verifier: authResult.verifier,
      state: authResult.state,
      redirectUri: authResult.redirectUri,
      listener,
    };
  }

  /**
   * Start GitHub Copilot OAuth flow with Device Code
   *
   * Requests device code from GitHub for user to enter at verification URI.
   *
   * @returns Flow result with device code information
   */
  private async startGitHubFlow(): Promise<GitHubFlowInitResult> {
    const deviceCode = await withRetry(() => requestGitHubDeviceCode());

    return {
      success: true,
      provider: "github-copilot",
      deviceCode: deviceCode.device_code,
      userCode: deviceCode.user_code,
      verificationUri: deviceCode.verification_uri,
      interval: deviceCode.interval,
      expiresIn: deviceCode.expires_in,
    };
  }

  /**
   * Complete Codex OAuth flow by exchanging authorization code for tokens
   *
   * Exchanges the authorization code for access/refresh tokens, extracts
   * the account ID from the JWT, and stores encrypted credentials.
   *
   * @param code - Authorization code from callback
   * @param state - CSRF state parameter (for verification)
   * @param verifier - PKCE code verifier
   * @param redirectUri - Redirect URI used in authorization
   * @returns Flow result with stored credentials
   *
   * @example
   * ```typescript
   * const result = await oauthService.completeCodexOAuth(
   *   callbackCode,
   *   storedState,
   *   storedVerifier,
   *   redirectUri
   * );
   * if (result.success) {
   *   console.log('Authenticated with Codex');
   * }
   * ```
   */
  async completeCodexOAuth(
    code: string,
    state: string,
    verifier: string,
    redirectUri: string
  ): Promise<OAuthFlowResult> {
    this.log("completeCodexOAuth", { state });

    try {
      // Close any active listener for this state
      const listener = this.activeListeners.get(state);
      if (listener) {
        await listener.close();
        this.activeListeners.delete(state);
      }

      // Exchange code for tokens with retry
      const tokenResponse = await withRetry(() =>
        exchangeCodexCode(code, verifier, redirectUri)
      );

      // Extract account ID from JWT id_token
      const accountId = tokenResponse.id_token
        ? extractCodexAccountId(tokenResponse.id_token)
        : null;

      // Calculate expiration timestamp
      const expiresAt = tokenResponse.expires_in
        ? Date.now() + tokenResponse.expires_in * 1000
        : undefined;

      // Prepare credentials
      const credentials: OAuthCredentials = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        accountId: accountId ?? undefined,
      };

      // Store encrypted credentials
      await this.storeCredentials("codex", credentials);

      this.log("completeCodexOAuth success", { accountId });

      return {
        success: true,
        provider: "codex",
        credentials,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("completeCodexOAuth error", { state, error: errorMsg });
      return {
        success: false,
        error: `Failed to complete OAuth: ${errorMsg}`,
        provider: "codex",
      };
    }
  }

  /**
   * Complete GitHub Copilot OAuth flow by polling for token
   *
   * Polls GitHub token endpoint until user authorizes or timeout.
   * Stores the access token (GitHub tokens don't expire).
   *
   * @param deviceCode - Device code from startOAuthFlow
   * @param interval - Polling interval in seconds
   * @returns Flow result with stored credentials
   */
  async completeGitHubOAuth(
    deviceCode: string,
    interval: number
  ): Promise<OAuthFlowResult> {
    this.log("completeGitHubOAuth", { deviceCode: deviceCode.slice(0, 8) + "..." });

    try {
      // Poll for token with retry wrapper around each poll attempt
      const tokenResponse = await withRetry(
        () => pollGitHubToken(deviceCode, interval),
        3
      );

      // GitHub tokens don't expire and don't have refresh tokens
      const credentials: OAuthCredentials = {
        accessToken: tokenResponse.access_token,
        // No refresh token or expiration for GitHub
      };

      // Store encrypted credentials
      await this.storeCredentials("github-copilot", credentials);

      this.log("completeGitHubOAuth success");

      return {
        success: true,
        provider: "github-copilot",
        credentials,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("completeGitHubOAuth error", { error: errorMsg });
      return {
        success: false,
        error: `Failed to complete GitHub OAuth: ${errorMsg}`,
        provider: "github-copilot",
      };
    }
  }

  /**
   * Get a valid access token for the specified provider
   *
   * Retrieves stored credentials, checks expiration, and refreshes
   * the token if needed (with 60-second buffer).
   *
   * @param provider - OAuth provider ('codex' or 'github-copilot')
   * @returns Valid access token or null if not authenticated
   *
   * @example
   * ```typescript
   * const token = await oauthService.getValidToken('codex');
   * if (token) {
   *   // Use token for API requests
   * } else {
   *   // Need to authenticate
   * }
   * ```
   */
  async getValidToken(provider: OAuthProvider): Promise<string | null> {
    this.log("getValidToken", { provider });

    try {
      // Get stored credentials
      const credentials = await this.repository.get(provider);
      if (!credentials) {
        this.log("getValidToken: no credentials found", { provider });
        return null;
      }

      // Check if token is expired (with 60s buffer)
      const isExpired = await this.repository.isExpired(provider, 60);

      if (!isExpired) {
        this.log("getValidToken: token valid", { provider });
        return credentials.accessToken;
      }

      // Token expired - try to refresh
      this.log("getValidToken: token expired, refreshing", { provider });

      if (provider === "codex") {
        return await this.refreshCodexToken(credentials.refreshToken);
      } else if (provider === "github-copilot") {
        // GitHub tokens don't expire, if we have credentials they're valid
        this.log("getValidToken: GitHub token doesn't expire", { provider });
        return credentials.accessToken;
      }

      return null;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("getValidToken error", { provider, error: errorMsg });
      return null;
    }
  }

  /**
   * Refresh Codex access token using refresh token
   *
   * @param refreshToken - Refresh token from stored credentials
   * @returns New access token or null if refresh fails
   */
  private async refreshCodexToken(
    refreshToken: string | null
  ): Promise<string | null> {
    if (!refreshToken) {
      this.log("refreshCodexToken: no refresh token available");
      return null;
    }

    try {
      // Refresh token with retry
      const newTokens = await withRetry(() => refreshCodexToken(refreshToken));

      // Calculate new expiration
      const expiresAt = newTokens.expires_in
        ? Date.now() + newTokens.expires_in * 1000
        : undefined;

      const accountId = newTokens.id_token
        ? (extractCodexAccountId(newTokens.id_token) ?? undefined)
        : undefined;

      // Store updated credentials
      const credentials: OAuthCredentials = {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token ?? refreshToken, // Use new refresh token if rotated
        expiresAt,
        accountId,
      };

      await this.storeCredentials("codex", credentials);

      this.log("refreshCodexToken success");
      return newTokens.access_token;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("refreshCodexToken error", { error: errorMsg });
      return null;
    }
  }

  /**
   * Revoke OAuth credentials for a provider
   *
   * Deletes stored credentials from the database.
   *
   * @param provider - OAuth provider to revoke
   * @returns True if credentials were deleted, false if not found
   *
   * @example
   * ```typescript
   * const revoked = await oauthService.revokeOAuth('codex');
   * if (revoked) {
   *   console.log('Credentials revoked');
   * }
   * ```
   */
  async revokeOAuth(provider: OAuthProvider): Promise<boolean> {
    this.log("revokeOAuth", { provider });

    try {
      const deleted = await this.repository.delete(provider);
      this.log("revokeOAuth result", { provider, deleted });
      return deleted;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.log("revokeOAuth error", { provider, error: errorMsg });
      return false;
    }
  }

  /**
   * Check if a provider has stored credentials
   *
   * @param provider - OAuth provider to check
   * @returns True if credentials exist
   */
  async hasCredentials(provider: OAuthProvider): Promise<boolean> {
    const credentials = await this.repository.get(provider);
    return credentials !== null;
  }

  /**
   * List all providers with stored OAuth credentials
   *
   * @returns Array of provider IDs
   */
  async listAuthenticatedProviders(): Promise<string[]> {
    return this.repository.listProviders();
  }

  /**
   * Check if stored token is expired (read-only, does NOT trigger refresh)
   *
   * @param provider - OAuth provider to check
   * @param bufferSeconds - Consider token expired this many seconds before actual expiry (default: 60)
   * @returns True if token is expired or missing
   */
  async isTokenExpired(provider: OAuthProvider, bufferSeconds = 60): Promise<boolean> {
    const credentials = await this.repository.get(provider);
    if (!credentials) {
      return true; // No credentials = expired
    }

    // GitHub tokens don't expire
    if (provider === "github-copilot") {
      return false;
    }

    // Use repository's isExpired method for consistency
    return this.repository.isExpired(provider, bufferSeconds);
  }

  /**
   * Store OAuth credentials in the repository
   *
   * @param provider - OAuth provider
   * @param credentials - OAuth credentials to store
   */
  private async storeCredentials(
    provider: OAuthProvider,
    credentials: OAuthCredentials
  ): Promise<void> {
    // Convert expiresAt from number to Date for repository
    const expiresAtDate = credentials.expiresAt
      ? new Date(credentials.expiresAt)
      : undefined;

    await this.repository.upsert(provider, {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: expiresAtDate,
      accountId: credentials.accountId,
    });
  }

  /**
   * Clean up any active callback listeners
   *
   * Should be called on application shutdown.
   */
  async cleanup(): Promise<void> {
    this.log("cleanup", { activeListeners: this.activeListeners.size });

    const closePromises = Array.from(this.activeListeners.values()).map(
      (listener) => listener.close().catch(() => {})
    );

    await Promise.all(closePromises);
    this.activeListeners.clear();
  }

  private log(message: string, meta?: Record<string, unknown>): void {
    console.log(`[OAuthService] ${message}`, meta);
  }
}
