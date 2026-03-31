/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements RFC 7636 PKCE for secure OAuth flows.
 * Uses SHA256 for code challenge method.
 */

import { randomBytes, createHash } from "crypto";
import type { PKCECodes } from "./types.js";

/**
 * Base64url encoding without padding
 * Replaces + with -, / with _, removes = padding
 */
function base64urlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate PKCE code verifier and challenge pair
 *
 * Generates a 64-byte random verifier (86 chars base64url)
 * and SHA256 hash challenge (43 chars base64url).
 *
 * @returns PKCE codes with verifier and challenge
 */
export function generatePKCE(): PKCECodes {
  // Generate 64 random bytes for verifier
  // Results in 86 chars base64url (within 43-128 char spec requirement)
  const verifierBytes = randomBytes(64);
  const code_verifier = base64urlEncode(verifierBytes);

  // SHA256 hash of verifier, then base64url encode
  const hash = createHash("sha256").update(code_verifier).digest();
  const code_challenge = base64urlEncode(hash);

  return { code_verifier, code_challenge };
}

/**
 * Generate CSRF protection state parameter
 *
 * Generates 32 random bytes (43 chars base64url)
 * for OAuth state parameter to prevent CSRF attacks.
 *
 * @returns Random state string
 */
export function generateState(): string {
  // Generate 32 random bytes
  // Results in 43 chars base64url
  const stateBytes = randomBytes(32);
  return base64urlEncode(stateBytes);
}

/**
 * Verify PKCE code challenge against verifier
 *
 * Used by OAuth servers to validate the code challenge
 * matches the verifier sent in token request.
 *
 * @param verifier - Code verifier from client
 * @param challenge - Code challenge from authorization request
 * @returns True if challenge matches verifier
 */
export function verifyPKCE(verifier: string, challenge: string): boolean {
  const hash = createHash("sha256").update(verifier).digest();
  const computedChallenge = base64urlEncode(hash);
  return computedChallenge === challenge;
}
