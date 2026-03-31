import type {
  McpCanonicalToolCollision,
  McpCanonicalToolId,
  McpToolIdentityErrorCode,
  McpToolIdentityInput,
} from "./mcp-contracts";

const TOOL_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*\..+$/;
const SERVER_ALIAS_PATTERN = /^[a-z][a-z0-9-]*$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/;

export class McpToolIdentityError extends Error {
  readonly code: McpToolIdentityErrorCode;

  constructor(code: McpToolIdentityErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "McpToolIdentityError";
    this.code = code;
  }
}

export function buildCanonicalMcpToolId(
  input: McpToolIdentityInput,
): McpCanonicalToolId {
  const serverAlias = normalizeServerAlias(input.serverAlias);
  const toolName = normalizeToolName(input.toolName, "MCP_INVALID_TOOL_NAME", "toolName");
  const effectiveToolName = normalizeToolName(
    input.toolAlias ?? toolName,
    "MCP_INVALID_TOOL_ALIAS",
    "toolAlias",
  );
  const canonicalId = `mcp.${serverAlias}.${effectiveToolName}`;

  if (!TOOL_NAMESPACE_PATTERN.test(canonicalId)) {
    throw new McpToolIdentityError(
      "MCP_INVALID_CANONICAL_TOOL_ID",
      `canonical id '${canonicalId}' must match <namespace>.<name> format`,
    );
  }

  return {
    canonicalId,
    serverAlias,
    toolName,
    effectiveToolName,
  };
}

export function buildMcpCanonicalToolIndex(
  inputs: ReadonlyArray<McpToolIdentityInput>,
): Map<string, McpCanonicalToolId> {
  const index = new Map<string, McpCanonicalToolId>();

  for (const input of inputs) {
    const canonical = buildCanonicalMcpToolId(input);
    const existing = index.get(canonical.canonicalId);
    if (existing) {
      throwCollisionError({
        canonicalId: canonical.canonicalId,
        existing,
        incoming: canonical,
      });
    }
    index.set(canonical.canonicalId, canonical);
  }

  return index;
}

export function parseCanonicalMcpToolId(canonicalId: string): {
  serverAlias: string;
  toolName: string;
} {
  if (!canonicalId.startsWith("mcp.")) {
    throw new McpToolIdentityError(
      "MCP_INVALID_CANONICAL_TOOL_ID",
      `canonical id '${canonicalId}' must start with 'mcp.'`,
    );
  }

  if (!TOOL_NAMESPACE_PATTERN.test(canonicalId)) {
    throw new McpToolIdentityError(
      "MCP_INVALID_CANONICAL_TOOL_ID",
      `canonical id '${canonicalId}' must match <namespace>.<name> format`,
    );
  }

  const withoutPrefix = canonicalId.slice("mcp.".length);
  const firstDot = withoutPrefix.indexOf(".");
  if (firstDot <= 0 || firstDot === withoutPrefix.length - 1) {
    throw new McpToolIdentityError(
      "MCP_INVALID_CANONICAL_TOOL_ID",
      `canonical id '${canonicalId}' must be mcp.<serverAlias>.<toolName>`,
    );
  }

  const serverAlias = normalizeServerAlias(withoutPrefix.slice(0, firstDot));
  const toolName = normalizeToolName(
    withoutPrefix.slice(firstDot + 1),
    "MCP_INVALID_CANONICAL_TOOL_ID",
    "toolName",
  );

  return { serverAlias, toolName };
}

function normalizeServerAlias(value: string): string {
  const trimmed = value.trim();
  if (!SERVER_ALIAS_PATTERN.test(trimmed)) {
    throw new McpToolIdentityError(
      "MCP_INVALID_SERVER_ALIAS",
      `serverAlias '${value}' is invalid; expected /^[a-z][a-z0-9-]*$/`,
    );
  }
  return trimmed;
}

function normalizeToolName(
  value: string,
  code: McpToolIdentityErrorCode,
  fieldName: "toolName" | "toolAlias",
): string {
  const trimmed = value.trim();
  if (!TOOL_NAME_PATTERN.test(trimmed)) {
    throw new McpToolIdentityError(
      code,
      `${fieldName} '${value}' is invalid; expected /^[a-z][a-z0-9_-]*(?:\\.[a-z0-9_-]+)*$/`,
    );
  }
  return trimmed;
}

function throwCollisionError(collision: McpCanonicalToolCollision): never {
  throw new McpToolIdentityError(
    "MCP_CANONICAL_ID_COLLISION",
    `canonical id '${collision.canonicalId}' collides between ` +
      `'${collision.existing.serverAlias}:${collision.existing.toolName}' and ` +
      `'${collision.incoming.serverAlias}:${collision.incoming.toolName}'`,
  );
}
