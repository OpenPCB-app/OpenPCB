import { describe, expect, it } from "bun:test";
import { generatePKCE, generateState, verifyPKCE } from "../pkce";

describe("PKCE", () => {
  describe("generatePKCE", () => {
    it("generates verifier and challenge", () => {
      const pkce = generatePKCE();
      expect(pkce.code_verifier).toBeDefined();
      expect(pkce.code_challenge).toBeDefined();
      expect(pkce.code_verifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.code_verifier.length).toBeLessThanOrEqual(128);
    });

    it("generates unique verifiers", () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();
      expect(pkce1.code_verifier).not.toBe(pkce2.code_verifier);
    });

    it("challenge is base64url encoded", () => {
      const pkce = generatePKCE();
      expect(pkce.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("verifyPKCE", () => {
    it("verifies valid PKCE pair", () => {
      const pkce = generatePKCE();
      expect(verifyPKCE(pkce.code_verifier, pkce.code_challenge)).toBe(true);
    });

    it("rejects invalid challenge", () => {
      const pkce = generatePKCE();
      expect(verifyPKCE(pkce.code_verifier, "invalid")).toBe(false);
    });
  });

  describe("generateState", () => {
    it("generates random state", () => {
      const state = generateState();
      expect(state).toBeDefined();
      expect(state.length).toBeGreaterThan(16);
    });

    it("generates unique states", () => {
      const state1 = generateState();
      const state2 = generateState();
      expect(state1).not.toBe(state2);
    });
  });
});
