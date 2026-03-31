import type { McpSessionManagerConfig } from "./session-manager";
import type { HttpMcpSessionManagerConfig } from "./http-mcp-session-manager";

export const MCP_STDIO_SESSION_DEFAULTS: Readonly<McpSessionManagerConfig> = {
  requestTimeoutMs: 5000,
  connectTimeoutMs: 5000,
  maxConnectAttempts: 3,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 2000,
  circuitOpenMs: 5000,
};

export const MCP_HTTP_SESSION_DEFAULTS: Readonly<HttpMcpSessionManagerConfig> = {
  requestTimeoutMs: 5000,
  connectTimeoutMs: 5000,
  maxConnectAttempts: 3,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 2000,
  reconnectMaxAttempts: 2,
  reconnectBackoffFactor: 2,
  circuitOpenMs: 5000,
  protocolVersion: "2025-06-18",
};
