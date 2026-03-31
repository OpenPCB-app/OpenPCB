export type McpToolIdentityErrorCode =
  | "MCP_INVALID_SERVER_ALIAS"
  | "MCP_INVALID_TOOL_NAME"
  | "MCP_INVALID_TOOL_ALIAS"
  | "MCP_INVALID_CANONICAL_TOOL_ID"
  | "MCP_CANONICAL_ID_COLLISION";

export interface McpToolIdentityInput {
  serverAlias: string;
  toolName: string;
  toolAlias?: string;
}

export interface McpCanonicalToolId {
  canonicalId: string;
  serverAlias: string;
  toolName: string;
  effectiveToolName: string;
}

export interface McpCanonicalToolCollision {
  canonicalId: string;
  existing: McpCanonicalToolId;
  incoming: McpCanonicalToolId;
}
