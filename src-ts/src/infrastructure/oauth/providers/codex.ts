/**
 * OpenAI Codex OAuth Provider
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE (RFC 7636)
 * for OpenAI Codex authentication.
 *
 * PKCE Flow:
 * 1. Generate PKCE codes (verifier + challenge)
 * 2. Build authorization URL with code_challenge
 * 3. User authorizes at auth.openai.com
 * 4. Exchange authorization code for tokens using code_verifier
 * 5. Extract account_id from JWT id_token claims
 *
 * @see https://auth.openai.com/oauth/authorize
 */

import { generatePKCE, generateState } from "../pkce.js";
import type { PKCECodes } from "../types.js";
import { CODEX_CLIENT_ID, CODEX_REDIRECT_PORT } from "../config.js";

/**
 * OpenAI OAuth issuer/authorization server
 */
const CODEX_ISSUER = "https://auth.openai.com";

/**
 * Authorization endpoint
 * User is redirected here to authorize the application
 */
const AUTHORIZE_ENDPOINT = `${CODEX_ISSUER}/oauth/authorize`;

/**
 * Token endpoint
 * Used to exchange authorization code for tokens
 */
const TOKEN_ENDPOINT = `${CODEX_ISSUER}/oauth/token`;

/**
 * OAuth scopes for Codex
 * - openid: Required for OIDC flow
 * - profile: Access to user profile
 * - email: Access to user email
 * - offline_access: Request refresh token
 */
const CODEX_SCOPES = "openid profile email offline_access";

/**
 * Result of initiating Codex OAuth authorization
 */
export interface AuthorizationResult {
  /** Full authorization URL to redirect user to */
  url: string;
  /** PKCE code verifier (store securely, needed for token exchange) */
  verifier: string;
  /** CSRF state parameter (verify on callback) */
  state: string;
  /** Redirect URI where user will be sent after authorization */
  redirectUri: string;
}

/**
 * Token response from OpenAI OAuth token endpoint
 */
export interface TokenResponse {
  /** OIDC ID token (JWT containing user claims) */
  id_token?: string;
  /** Access token for API requests */
  access_token: string;
  /** Refresh token for obtaining new access tokens */
  refresh_token?: string;
  /** Seconds until access token expires */
  expires_in?: number;
  /** Token type (usually "Bearer") */
  token_type?: string;
}

/**
 * Initiate Codex OAuth authorization with PKCE
 *
 * Generates PKCE codes and builds the authorization URL for the user
 * to authenticate with OpenAI. The user should be redirected to the
 * returned URL in a browser.
 *
 * @returns AuthorizationResult containing URL, verifier, state, and redirectUri
 *
 * @example
 * ```typescript
 * const auth = await authorizeCodex();
 * // Redirect user to auth.url
 * // Store auth.verifier and auth.state securely
 * // After callback, call exchangeCodexCode(code, auth.verifier, auth.redirectUri)
 * ```
 */
export async function authorizeCodex(): Promise<AuthorizationResult> {
  const pkce: PKCECodes = generatePKCE();
  const state: string = generateState();
  const redirectUri = `http://localhost:${CODEX_REDIRECT_PORT}/oauth/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_SCOPES,
    code_challenge: pkce.code_challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: state,
    originator: "codex-cli",
  });

  return {
    url: `${AUTHORIZE_ENDPOINT}?${params.toString()}`,
    verifier: pkce.code_verifier,
    state,
    redirectUri,
  };
}

/**
 * Exchange authorization code for tokens
 *
 * After the user authorizes and is redirected back with an authorization
 * code, exchange it for access_token, refresh_token, and id_token using
 * the PKCE code verifier.
 *
 * @param code - Authorization code from callback
 * @param verifier - PKCE code verifier from authorizeCodex()
 * @param redirectUri - Must match the redirect_uri used in authorizeCodex()
 * @returns TokenResponse containing tokens
 * @throws Error if token exchange fails
 *
 * @example
 * ```typescript
 * const tokens = await exchangeCodexCode(code, verifier, redirectUri);
 * console.log(`Access token: ${tokens.access_token}`);
 * const accountId = extractCodexAccountId(tokens.id_token!);
 * ```
 */
export async function exchangeCodexCode(
  code: string,
  verifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Token exchange failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
    );
  }

  const data = (await response.json()) as TokenResponse;

  if (!data.access_token) {
    throw new Error("Token response missing access_token");
  }

  return data;
}

/**
 * Extract Codex account ID from JWT id_token
 *
 * Parses the JWT payload and extracts the chatgpt_account_id from
 * the custom "https://api.openai.com/auth" claims section.
 *
 * @param idToken - JWT id_token from token response
 * @returns Account ID string or null if not found
 *
 * @example
 * ```typescript
 * const accountId = extractCodexAccountId(tokens.id_token!);
 * if (accountId) {
 *   console.log(`Authenticated as account: ${accountId}`);
 * }
 * ```
 */
export function extractCodexAccountId(idToken: string): string | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payloadB64 = parts[1]!;
    const payloadJson = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as {
      "https://api.openai.com/auth"?: {
        chatgpt_account_id?: string;
      };
    };

    const authClaims = payload["https://api.openai.com/auth"];
    return authClaims?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh Codex access token
 *
 * Uses the refresh_token to obtain a new access_token when the
 * current one expires. The refresh_token typically remains valid
 * for extended periods.
 *
 * @param refreshToken - Refresh token from initial token exchange
 * @returns TokenResponse with new access_token and optional new refresh_token
 * @throws Error if refresh fails
 *
 * @example
 * ```typescript
 * const newTokens = await refreshCodexToken(refreshToken);
 * // Update stored credentials with newTokens.access_token
 * // Note: refresh_token may also be rotated
 * ```
 */
export async function refreshCodexToken(
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
    );
  }

  const data = (await response.json()) as TokenResponse;

  if (!data.access_token) {
    throw new Error("Token refresh response missing access_token");
  }

  return data;
}
