import { describe, expect, it } from "bun:test";
import {
  McpToolIdentityError,
  buildCanonicalMcpToolId,
  buildMcpCanonicalToolIndex,
  parseCanonicalMcpToolId,
} from "./mcp-tool-identity-policy";

describe("mcp-tool-identity-policy", () => {
  describe("canonical id mapping", () => {
    it("maps server alias + tool name deterministically", () => {
      const canonical = buildCanonicalMcpToolId({
        serverAlias: "github",
        toolName: "search_repositories",
      });

      expect(canonical.canonicalId).toBe("mcp.github.search_repositories");
      expect(canonical.effectiveToolName).toBe("search_repositories");
    });

    it("uses explicit tool alias when provided", () => {
      const canonical = buildCanonicalMcpToolId({
        serverAlias: "github",
        toolName: "search_repositories",
        toolAlias: "search.repos",
      });

      expect(canonical.canonicalId).toBe("mcp.github.search.repos");
      expect(canonical.effectiveToolName).toBe("search.repos");
    });

    it("parses canonical id back to alias + tool name", () => {
      const parsed = parseCanonicalMcpToolId("mcp.linear.list_issues");

      expect(parsed.serverAlias).toBe("linear");
      expect(parsed.toolName).toBe("list_issues");
    });
  });

  describe("collision behavior", () => {
    it("throws deterministic collision error for duplicate canonical ids", () => {
      expect(() =>
        buildMcpCanonicalToolIndex([
          { serverAlias: "github", toolName: "search_repositories" },
          {
            serverAlias: "github",
            toolName: "find_repos",
            toolAlias: "search_repositories",
          },
        ]),
      ).toThrow("MCP_CANONICAL_ID_COLLISION");
    });
  });

  describe("invalid id edge cases", () => {
    it("rejects invalid server alias", () => {
      expect(() =>
        buildCanonicalMcpToolId({
          serverAlias: "GitHub",
          toolName: "search_repositories",
        }),
      ).toThrow("MCP_INVALID_SERVER_ALIAS");
    });

    it("rejects invalid tool name", () => {
      expect(() =>
        buildCanonicalMcpToolId({
          serverAlias: "github",
          toolName: "search repositories",
        }),
      ).toThrow("MCP_INVALID_TOOL_NAME");
    });

    it("rejects invalid alias", () => {
      expect(() =>
        buildCanonicalMcpToolId({
          serverAlias: "github",
          toolName: "search_repositories",
          toolAlias: "search..repos",
        }),
      ).toThrow("MCP_INVALID_TOOL_ALIAS");
    });

    it("rejects non-mcp canonical ids", () => {
      expect(() => parseCanonicalMcpToolId("core.list_files")).toThrow(
        "MCP_INVALID_CANONICAL_TOOL_ID",
      );
    });

    it("exposes stable error code on policy errors", () => {
      try {
        buildCanonicalMcpToolId({
          serverAlias: "bad alias",
          toolName: "search_repositories",
        });
        throw new Error("expected policy error");
      } catch (error) {
        expect(error).toBeInstanceOf(McpToolIdentityError);
        expect((error as McpToolIdentityError).code).toBe(
          "MCP_INVALID_SERVER_ALIAS",
        );
      }
    });
  });
});
