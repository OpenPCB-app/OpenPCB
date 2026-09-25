import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import type { AssistantPromptPresetId } from "../../../../sdks";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ConversationStore } from "../conversation-store";
import type { ContextResolver } from "../context-resolver";
import type { CapturedIntent } from "../verification/build-intent-capture";

/**
 * Who is calling the MCP endpoint, and which assistant chats back them.
 *
 * The SDK serves 2025-era clients statelessly — a fresh server per POST, no
 * `Mcp-Session-Id` — so connection state cannot come from the transport. It
 * comes from headers instead:
 *
 * - `clientKey` (`X-OpenPCB-MCP-Client`, else User-Agent) groups a client's
 *   chats. It must be header-stable, never the display name.
 * - `instanceId` (`X-OpenPCB-MCP-Instance`, one UUID per shim process ≈ one
 *   Claude Code session) keys the design pin, so two concurrent sessions
 *   never steer each other. Direct HTTP clients without the header share
 *   state per `clientKey`.
 *
 * Chat model — per SESSION (`clientKey|instanceId`), never shared between two
 * Claude Code sessions. Chats are the audit trail, not the ownership boundary:
 * proposals carry an explicit actor (`actor_client_key`, `actor_instance_id`)
 * and every ownership check (await/get proposal, undo/redo) compares that.
 * Keeping chats per session on top means "allow this tool for the session" in
 * the panel (keyed by chat) can never authorise another session, and no two
 * sessions ever bind the same chat.
 *
 * - One **home** chat per session, never bound to a design. Calls that do not
 *   target a design (library search, list/create/resolve design) run there.
 * - One **design** chat per session per design, bound exactly once. Designer
 *   tools resolve their design from the chat's primary binding
 *   (`ContextResolver.getPrimaryDesign`), so a chat that never changes design
 *   makes every in-app tool work unmodified — and because the metadata has the
 *   `{scope:"designer", designId}` shape `listChatsForDesign` filters on, the
 *   session's activity and approval cards show in that design's dock.
 * - When a tool binds the home chat (`designer_create_design`,
 *   `designer_resolve_design`), that chat becomes the design's chat and a new
 *   home chat is created lazily (`adoptBoundHomeChat`). Those tools run under
 *   the connection's lock (`serialize`), so two parallel calls from one
 *   session cannot bind the same home chat to two designs.
 * - Chats from before per-session chats (no `mcp.instanceId`) are left alone.
 */

export interface McpClientIdentity {
  clientKey: string;
  clientName: string;
  instanceId: string;
}

export interface McpConnection extends McpClientIdentity {
  /** Set by `designer_use_design`; beats the UI-active design, loses to an explicit argument. */
  pinnedDesignId: string | null;
  /** The last design a call from this connection acted on. */
  lastDesignId: string | null;
  /**
   * Expected BOM from this session's last `library_resolve_bom`, held until a
   * design exists to attach it to (`designer_verify_build` moves it).
   */
  buildIntent: CapturedIntent | null;
  firstSeen: number;
  lastSeen: number;
  callCount: number;
}

export interface McpConnectionSummary {
  instanceId: string;
  clientKey: string;
  clientName: string;
  pinnedDesignId: string | null;
  lastDesignId: string | null;
  firstSeen: string;
  lastSeen: string;
  callCount: number;
}

export type DesignTargetSource = "explicit" | "pin" | "ui" | "last";

export interface DesignTarget {
  designId: string;
  source: DesignTargetSource;
  warning?: string;
}

export interface ChatDefaults {
  providerConfigId: string;
  model: string;
  promptPresetId: AssistantPromptPresetId;
}

export interface McpConnectionDeps {
  ctx: CoreBackendModuleContext;
  conversation: ConversationStore;
  contextResolver: ContextResolver;
  /**
   * Provider/model/preset stamped on chats this registry creates. MCP chats
   * are driven by an external agent, so this must never throw for a missing
   * in-app provider — the caller falls back to a sentinel.
   */
  chatDefaults: () => ChatDefaults;
  now?: () => number;
}

/** Connections idle this long are dropped (their pin with them). */
export const CONNECTION_IDLE_MS = 30 * 60 * 1000;

interface McpChatMetadata {
  clientKey: string;
  clientName: string;
  instanceId: string;
  role: "home" | "design";
}

/** `clientKey|instanceId` — the unit that owns chats, pins and proposals. */
export function sessionKeyOf(connection: McpClientIdentity): string {
  return `${connection.clientKey}|${connection.instanceId}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-09-25 14:32" in the machine's local time — tells sessions apart in chat titles. */
function sessionLabel(startedAt: number): string {
  const d = new Date(startedAt);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function mcpMetaOf(
  metadata: Record<string, unknown> | null,
): Partial<McpChatMetadata> | null {
  if (!metadata) return null;
  const mcp = metadata.mcp;
  if (typeof mcp !== "object" || mcp === null) return null;
  return mcp as Partial<McpChatMetadata>;
}

export function normalizeClientKey(raw: string): string {
  return raw.trim().toLowerCase() || "unknown-client";
}

export class McpConnectionRegistry {
  private readonly connections = new Map<string, McpConnection>();
  /** sessionKey → home chat id. */
  private readonly homeChats = new Map<string, string>();
  /** `${sessionKey}|${designId}` → design chat id. */
  private readonly designChats = new Map<string, string>();
  /** In-flight design-chat creations, so parallel calls share one chat. */
  private readonly pendingDesignChats = new Map<string, Promise<string | null>>();
  /** sessionKey → tail of the connection's serialized-call queue. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly deps: McpConnectionDeps) {
    this.now = deps.now ?? Date.now;
  }

  private designer(): DesignerSDK | undefined {
    return this.deps.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined;
  }

  // ─── connections ────────────────────────────────────────────────────

  /** Record activity from a client and return its connection state. */
  touch(identity: McpClientIdentity): McpConnection {
    this.evictIdle();
    const clientKey = normalizeClientKey(identity.clientKey);
    const instanceId = identity.instanceId.trim() || clientKey;
    const now = this.now();
    // Keyed by client AND instance: an instance id is only unique within the
    // client that minted it, and two clients must never share a pin.
    const key = `${clientKey}|${instanceId}`;
    const existing = this.connections.get(key);
    if (existing) {
      existing.lastSeen = now;
      if (identity.clientName && identity.clientName !== existing.clientKey) {
        existing.clientName = identity.clientName;
      }
      return existing;
    }
    const connection: McpConnection = {
      clientKey,
      clientName: identity.clientName.trim() || clientKey,
      instanceId,
      pinnedDesignId: null,
      lastDesignId: null,
      buildIntent: null,
      firstSeen: now,
      lastSeen: now,
      callCount: 0,
    };
    this.connections.set(key, connection);
    return connection;
  }

  list(): McpConnectionSummary[] {
    this.evictIdle();
    return [...this.connections.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((c) => ({
        instanceId: c.instanceId,
        clientKey: c.clientKey,
        clientName: c.clientName,
        pinnedDesignId: c.pinnedDesignId,
        lastDesignId: c.lastDesignId,
        firstSeen: new Date(c.firstSeen).toISOString(),
        lastSeen: new Date(c.lastSeen).toISOString(),
        callCount: c.callCount,
      }));
  }

  private evictIdle(): void {
    const cutoff = this.now() - CONNECTION_IDLE_MS;
    for (const [id, connection] of this.connections) {
      if (connection.lastSeen < cutoff) this.connections.delete(id);
    }
  }

  /**
   * Run `fn` after every earlier serialized call of this session finished.
   * Used for writes and for the tools that bind the home chat: Claude Code
   * issues tool calls in parallel, and two of those racing on one chat's
   * binding or on one design's revision must not interleave. Reads are not
   * serialized.
   */
  serialize<T>(connection: McpClientIdentity, fn: () => Promise<T>): Promise<T> {
    const key = sessionKeyOf(connection);
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }

  nextRunId(connection: McpConnection): string {
    connection.callCount += 1;
    return `mcp:${connection.instanceId}:${crypto.randomUUID()}`;
  }

  // ─── design targeting ───────────────────────────────────────────────

  /**
   * Which design a call acts on: explicit argument → session pin → the design
   * focused in the OpenPCB UI → the design this connection last used. The UI
   * pointer is cleared whenever the Designer screen unmounts (the user is on
   * the Assistant or Library screen), so the last-used fallback keeps a
   * session working while the user looks elsewhere — with a warning, so the
   * model knows it is not acting on what the user is looking at.
   */
  resolveDesign(
    connection: McpConnection,
    explicitDesignId?: string | null,
  ): DesignTarget | null {
    if (explicitDesignId) return { designId: explicitDesignId, source: "explicit" };
    if (connection.pinnedDesignId) {
      return { designId: connection.pinnedDesignId, source: "pin" };
    }
    const active = this.designer()?.getActiveDesignId() ?? null;
    if (active) return { designId: active, source: "ui" };
    if (connection.lastDesignId) {
      return {
        designId: connection.lastDesignId,
        source: "last",
        warning:
          "No design is focused in OpenPCB, so this call used the design this session last worked on. Pass designId or call designer_use_design to be explicit.",
      };
    }
    return null;
  }

  // ─── chats ──────────────────────────────────────────────────────────

  private createChat(
    title: string,
    metadata: Record<string, unknown>,
  ): string {
    const defaults = this.deps.chatDefaults();
    return this.deps.conversation.createChat({
      title,
      providerConfigId: defaults.providerConfigId,
      model: defaults.model,
      promptPresetId: defaults.promptPresetId,
      metadata,
    }).id;
  }

  private chatExists(chatId: string | undefined): chatId is string {
    return Boolean(chatId && this.deps.conversation.getChat(chatId));
  }

  /** The session's unbound home chat; created on first use. */
  homeChat(connection: McpConnection): string {
    const key = sessionKeyOf(connection);
    const cached = this.homeChats.get(key);
    if (this.chatExists(cached) && !this.deps.contextResolver.getPrimaryDesign(cached)) {
      return cached;
    }

    for (const chat of this.deps.conversation.listChats()) {
      const meta = mcpMetaOf(chat.metadata);
      if (!this.isSessionChat(meta, connection) || meta?.role !== "home") continue;
      if (this.deps.contextResolver.getPrimaryDesign(chat.id)) continue;
      this.homeChats.set(key, chat.id);
      return chat.id;
    }

    const chatId = this.createChat(
      `MCP · ${connection.clientName} · ${sessionLabel(connection.firstSeen)}`,
      { mcp: this.mcpMeta(connection, "home") },
    );
    this.homeChats.set(key, chatId);
    return chatId;
  }

  /**
   * The session's chat for `designId`, bound to it; created (and bound) on
   * first use. Returns null when the design does not exist — the caller then
   * runs the tool in the home chat, where it reports the missing design.
   */
  async designChat(
    connection: McpConnection,
    designId: string,
  ): Promise<string | null> {
    const cacheKey = `${sessionKeyOf(connection)}|${designId}`;
    const existing = this.findDesignChat(connection, designId);
    if (existing) return existing;
    const inFlight = this.pendingDesignChats.get(cacheKey);
    if (inFlight) return inFlight;

    const creation = (async () => {
      const design = await this.designer()?.getDesign(designId);
      if (!design) return null;
      // Re-check after the await: another call may have created it.
      const raced = this.findDesignChat(connection, designId);
      if (raced) return raced;
      const chatId = this.createChat(
        `MCP · ${connection.clientName} · ${design.head.name} · ${sessionLabel(connection.firstSeen)}`,
        {
          scope: "designer",
          designId: design.head.id,
          designName: design.head.name,
          mcp: this.mcpMeta(connection, "design"),
        },
      );
      this.deps.contextResolver.bindDesignIfUnbound(chatId, {
        id: design.head.id,
        name: design.head.name,
      });
      this.designChats.set(cacheKey, chatId);
      return chatId;
    })();
    this.pendingDesignChats.set(cacheKey, creation);
    try {
      return await creation;
    } finally {
      this.pendingDesignChats.delete(cacheKey);
    }
  }

  /**
   * After a tool ran in the home chat: if it bound the chat to a design, that
   * chat is now the design's chat and the connection pins to the design.
   * Returns the design id it adopted, or null when nothing changed.
   */
  adoptBoundHomeChat(connection: McpConnection, chatId: string): string | null {
    const primary = this.deps.contextResolver.getPrimaryDesign(chatId);
    if (!primary) return null;
    connection.pinnedDesignId = primary.refId;
    connection.lastDesignId = primary.refId;
    if (this.findDesignChat(connection, primary.refId, chatId)) {
      // The session already has a chat for this design (e.g. resolve_design
      // on a design it worked on before): keep one chat per design — undo the
      // bind and leave this chat as the home chat.
      this.deps.conversation.deleteBinding(chatId, primary.id);
      return primary.refId;
    }
    this.markDesignChat(chatId, connection, primary.refId, primary.label);
    this.homeChats.delete(sessionKeyOf(connection));
    return primary.refId;
  }

  private isSessionChat(
    meta: Partial<McpChatMetadata> | null,
    connection: McpClientIdentity,
  ): boolean {
    return Boolean(
      meta &&
        meta.clientKey === connection.clientKey &&
        meta.instanceId === connection.instanceId,
    );
  }

  private findDesignChat(
    connection: McpConnection,
    designId: string,
    excludeChatId?: string,
  ): string | null {
    const cacheKey = `${sessionKeyOf(connection)}|${designId}`;
    const cached = this.designChats.get(cacheKey);
    if (
      cached !== excludeChatId &&
      this.chatExists(cached) &&
      this.deps.contextResolver.getPrimaryDesign(cached)?.refId === designId
    ) {
      return cached;
    }
    for (const chat of this.deps.conversation.listChats()) {
      if (chat.id === excludeChatId) continue;
      const meta = mcpMetaOf(chat.metadata);
      if (!this.isSessionChat(meta, connection) || meta?.role !== "design") continue;
      if (this.deps.contextResolver.getPrimaryDesign(chat.id)?.refId === designId) {
        this.designChats.set(cacheKey, chat.id);
        return chat.id;
      }
    }
    return null;
  }

  private markDesignChat(
    chatId: string,
    connection: McpConnection,
    designId: string,
    designName: string,
  ): void {
    const chat = this.deps.conversation.getChat(chatId);
    this.deps.conversation.updateChat(chatId, {
      title: `MCP · ${connection.clientName} · ${designName} · ${sessionLabel(connection.firstSeen)}`,
      metadata: {
        ...(chat?.metadata ?? {}),
        scope: "designer",
        designId,
        designName,
        mcp: this.mcpMeta(connection, "design"),
      },
    });
    this.designChats.set(`${sessionKeyOf(connection)}|${designId}`, chatId);
  }

  private mcpMeta(
    connection: McpConnection,
    role: McpChatMetadata["role"],
  ): McpChatMetadata {
    return {
      clientKey: connection.clientKey,
      clientName: connection.clientName,
      instanceId: connection.instanceId,
      role,
    };
  }
}
