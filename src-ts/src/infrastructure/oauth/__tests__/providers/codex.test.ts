import { describe, expect, it } from "bun:test";
import { extractCodexAccountId, authorizeCodex } from "../../providers/codex";

describe("Codex Provider", () => {
  describe("authorizeCodex", () => {
    it("generates authorization URL", async () => {
      const result = await authorizeCodex();
      expect(result.url).toContain("https://auth.openai.com/oauth/authorize");
      expect(result.url).toContain("response_type=code");
      expect(result.url).toContain("code_challenge_method=S256");
      expect(result.verifier).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.redirectUri).toContain("http://localhost:1455/oauth/callback");
    });
  });

  describe("extractCodexAccountId", () => {
    it("extracts account ID from valid JWT", () => {
      const header = btoa(JSON.stringify({ alg: "RS256" }));
      const payload = btoa(JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "test-account-123"
        }
      }));
      const jwt = `${header}.${payload}.signature`;
      
      const accountId = extractCodexAccountId(jwt);
      expect(accountId).toBe("test-account-123");
    });

    it("returns null for invalid JWT", () => {
      expect(extractCodexAccountId("invalid")).toBe(null);
    });

    it("returns null when account ID missing", () => {
      const header = btoa(JSON.stringify({ alg: "RS256" }));
      const payload = btoa(JSON.stringify({ sub: "user-123" }));
      const jwt = `${header}.${payload}.signature`;
      
      expect(extractCodexAccountId(jwt)).toBe(null);
    });
  });
});
