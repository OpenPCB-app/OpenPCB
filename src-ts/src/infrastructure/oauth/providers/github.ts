/**
 * GitHub Copilot OAuth Provider
 *
 * Implements OAuth 2.0 Device Authorization Grant flow (RFC 8628)
 * for GitHub Copilot authentication.
 *
 * Device Code Flow:
 * 1. Request device code from GitHub
 * 2. User enters code at verification URI
 * 3. Poll token endpoint until authorized or timeout
 *
 * @see https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

import type { DeviceCodeResponse, DeviceTokenResponse } from "../types.js";
import { COPILOT_CLIENT_ID, COPILOT_SCOPE } from "../config.js";

/**
 * GitHub Device Code endpoint
 * Used to initiate device flow
 */
const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";

/**
 * GitHub Token endpoint
 * Used to poll for access token
 */
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

/**
 * Polling timeout: 15 minutes (900 seconds)
 * Per RFC 8628, device codes typically expire after 15 minutes
 */
const POLLING_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Safety margin added to polling interval
 * Prevents rate limiting by adding buffer to server-specified interval
 */
const POLLING_SAFETY_MARGIN_MS = 3000;

/**
 * Default polling interval in seconds
 * Used if server doesn't specify interval
 */
const DEFAULT_POLLING_INTERVAL_S = 5;

/**
 * Sleep utility for polling delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Request device code from GitHub
 *
 * Initiates the OAuth 2.0 Device Authorization Grant flow by requesting
 * a device code and user code from GitHub. The user must then visit the
 * verification URI and enter the user code to authorize the application.
 *
 * @returns DeviceCodeResponse containing device_code, user_code, verification_uri, interval, expires_in
 * @throws Error if the request fails
 *
 * @example
 * ```typescript
 * const deviceCode = await requestGitHubDeviceCode();
 * console.log(`Enter code ${deviceCode.user_code} at ${deviceCode.verification_uri}`);
 * ```
 */
export async function requestGitHubDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: COPILOT_SCOPE,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to request device code: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as DeviceCodeResponse;

  // Validate required fields per RFC 8628
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(
      `Invalid device code response: missing required fields`
    );
  }

  return data;
}

/**
 * Poll GitHub token endpoint for access token
 *
 * Continuously polls the GitHub token endpoint until:
 * - User authorizes the application (returns access_token)
 * - Device code expires (15 minute timeout)
 * - An error occurs
 *
 * Handles RFC 8628 error responses:
 * - authorization_pending: User hasn't authorized yet, continue polling
 * - slow_down: Polling too fast, increase interval by 5 seconds
 *
 * @param deviceCode - The device code from requestGitHubDeviceCode()
 * @param interval - Polling interval in seconds (from device code response)
 * @returns DeviceTokenResponse containing access_token
 * @throws Error on timeout, network failure, or OAuth error
 *
 * @example
 * ```typescript
 * const deviceCode = await requestGitHubDeviceCode();
 * const token = await pollGitHubToken(deviceCode.device_code, deviceCode.interval);
 * console.log(`Access token: ${token.access_token}`);
 * ```
 */
export async function pollGitHubToken(
  deviceCode: string,
  interval: number
): Promise<DeviceTokenResponse> {
  const startTime = Date.now();

  // Use provided interval or default, ensure at least 5 seconds
  let currentInterval = Math.max(interval || DEFAULT_POLLING_INTERVAL_S, 5);

  while (Date.now() - startTime < POLLING_TIMEOUT_MS) {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Token endpoint error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as DeviceTokenResponse;

    // Success: access token received
    if (data.access_token) {
      return data;
    }

    // Handle error responses per RFC 8628
    if (data.error) {
      switch (data.error) {
        case "authorization_pending":
          // User hasn't authorized yet, continue polling
          await sleep(currentInterval * 1000 + POLLING_SAFETY_MARGIN_MS);
          continue;

        case "slow_down":
          // Polling too fast, increase interval by 5 seconds
          // Server may provide new interval in response
          currentInterval = (data.expires_in ?? currentInterval + 5);
          await sleep(currentInterval * 1000 + POLLING_SAFETY_MARGIN_MS);
          continue;

        case "expired_token":
          throw new Error(
            `Device code expired. Please restart the authentication flow.`
          );

        case "access_denied":
          throw new Error(
            `Access denied by user.`
          );

        default:
          // Other errors are fatal
          throw new Error(
            `OAuth error: ${data.error}${data.error_description ? ` - ${data.error_description}` : ""}`
          );
      }
    }

    // No access_token and no error - unexpected response
    throw new Error(
      `Unexpected token response: no access_token or error field`
    );
  }

  // Timeout after 15 minutes
  throw new Error(
    `Device code polling timeout (15 minutes). Please restart the authentication flow.`
  );
}
