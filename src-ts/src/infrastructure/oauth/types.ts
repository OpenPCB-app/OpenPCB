/**
 * OAuth Types and Interfaces
 *
 * Type definitions for OAuth 2.0 flows including PKCE and Device Code flows.
 * Supports GitHub Copilot and Codex providers.
 */

/**
 * Supported OAuth providers
 */
export type OAuthProvider = "codex" | "github-copilot";

/**
 * OAuth credentials stored after successful authentication
 */
export interface OAuthCredentials {
  /** Access token for API requests */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Unix timestamp in milliseconds when token expires */
  expiresAt?: number;
  /** Account ID (specific to Codex provider from JWT) */
  accountId?: string;
}

/**
 * Result of a completed OAuth flow
 */
export interface OAuthFlowResult {
  /** Whether authentication was successful */
  success: boolean;
  /** OAuth credentials on success */
  credentials?: OAuthCredentials;
  /** Error message on failure */
  error?: string;
  /** Provider that was authenticated */
  provider: OAuthProvider;
}

/**
 * PKCE code verifier and challenge pair
 * Used for secure OAuth flows without client secret
 */
export interface PKCECodes {
  /** Code verifier (43-128 chars, base64url encoded) */
  code_verifier: string;
  /** Code challenge (SHA256 hash of verifier, base64url encoded) */
  code_challenge: string;
}

/**
 * Response from device code endpoint
 * Used in OAuth 2.0 Device Authorization Grant flow
 */
export interface DeviceCodeResponse {
  /** Device code for polling token endpoint */
  device_code: string;
  /** Short code for user to enter */
  user_code: string;
  /** URL where user enters the code */
  verification_uri: string;
  /** Polling interval in seconds */
  interval: number;
  /** Expiration time in seconds */
  expires_in: number;
  /** Optional: complete verification URL with code */
  verification_uri_complete?: string;
}

/**
 * Response from token endpoint during device code polling
 */
export interface DeviceTokenResponse {
  /** Access token */
  access_token: string;
  /** Token type (usually "Bearer") */
  token_type: string;
  /** Refresh token */
  refresh_token?: string;
  /** Scope granted */
  scope?: string;
  /** Seconds until expiration */
  expires_in?: number;
  /** Error code if polling failed */
  error?: string;
  /** Error description */
  error_description?: string;
}

/**
 * OAuth provider configuration
 */
export interface OAuthProviderConfig {
  /** Provider identifier */
  provider: OAuthProvider;
  /** OAuth authorization endpoint */
  authorizationEndpoint: string;
  /** OAuth token endpoint */
  tokenEndpoint: string;
  /** Device code endpoint (for device flow) */
  deviceCodeEndpoint?: string;
  /** Client ID registered with provider */
  clientId: string;
  /** OAuth scopes to request */
  scopes: string[];
  /** Redirect URI for authorization code flow */
  redirectUri?: string;
}

/**
 * State of an active OAuth flow
 */
export interface OAuthFlowState {
  /** Unique flow identifier */
  flowId: string;
  /** Provider being authenticated */
  provider: OAuthProvider;
  /** CSRF protection state parameter */
  state: string;
  /** PKCE codes (for PKCE flows) */
  pkce?: PKCECodes;
  /** Device code info (for device flows) */
  deviceCode?: DeviceCodeResponse;
  /** Flow start timestamp */
  startedAt: number;
  /** Flow expiration timestamp */
  expiresAt: number;
}
