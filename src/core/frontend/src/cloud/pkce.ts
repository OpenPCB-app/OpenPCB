// PKCE (RFC 7636) + state helpers for the browser-login handoff. Runs in the
// renderer (Web Crypto). The desktop generates the verifier/challenge/state,
// opens the browser to the Cloud login page with the challenge, and later
// redeems the auth code with the verifier — proving it is the same app that
// started the flow (RFC 8252 native-app protection against code interception).

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Random URL-safe string (default 32 bytes → 43 base64url chars). */
export function randomUrlSafe(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** base64url(SHA-256(utf8(input))). */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomUrlSafe(32); // 43 base64url chars (within RFC 7636 43..128)
  const challenge = await sha256Base64Url(verifier);
  const state = randomUrlSafe(16);
  return { verifier, challenge, state };
}
