import { createHash, randomUUID } from "node:crypto";

/**
 * The bridge's instance id — the "session" half of the MCP actor
 * (`X-OpenPCB-MCP-Instance`). OpenPCB keys chats, design pins, proposal
 * ownership, undo rights and idempotency on it, so it should name ONE agent
 * session and stay the same for that session's lifetime.
 *
 * - `OPENPCB_MCP_INSTANCE`: explicit override (tests, custom clients).
 * - `CLAUDE_CODE_SESSION_ID`: Claude Code sets it on every stdio MCP server it
 *   spawns. Keying on it keeps a session's ownership across `/mcp` reconnects
 *   and bridge restarts. It is hashed: OpenPCB only needs a stable opaque key,
 *   and the raw id has no business in its database.
 * - Otherwise a random id per process (Claude Desktop, other clients).
 */
export function resolveInstanceId(
  env: Record<string, string | undefined>,
  random: () => string = randomUUID,
): string {
  const explicit = env.OPENPCB_MCP_INSTANCE?.trim();
  if (explicit && /^[A-Za-z0-9._:-]{1,128}$/.test(explicit)) return explicit;
  const session = env.CLAUDE_CODE_SESSION_ID?.trim();
  if (session) {
    return `cc-${createHash("sha256").update(session).digest("hex").slice(0, 32)}`;
  }
  return random();
}
