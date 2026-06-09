import { describe, expect, it } from "vitest";
import { createPkcePair, randomUrlSafe, sha256Base64Url } from "./pkce";

describe("desktop pkce", () => {
  it("sha256Base64Url matches the RFC 7636 reference vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await sha256Base64Url(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("createPkcePair derives challenge = S256(verifier)", async () => {
    const { verifier, challenge, state } = await createPkcePair();
    expect(challenge).toBe(await sha256Base64Url(verifier));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/); // within RFC 7636 43..128
    expect(state.length).toBeGreaterThanOrEqual(8);
    expect(state).not.toBe(verifier);
  });

  it("randomUrlSafe produces url-safe, non-repeating strings", () => {
    expect(randomUrlSafe(32)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomUrlSafe()).not.toBe(randomUrlSafe());
  });
});
