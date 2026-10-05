import type { AiTool, AiToolRegistry, AiToolResult } from "@openpcb/ai-core";
import { MentionRegistry } from "../../../../core/backend/mentions";
import { MentionContentResolver } from "../mention-content-resolver";

/**
 * Knowledge pages ("Docs") for MCP clients.
 *
 * In-app, the user @mentions a page and the run loop resolves it into the
 * prompt (`mention-content-resolver.ts`). An MCP client has no composer, so it
 * gets the same data as tools: search by title, then read a page as markdown.
 * Both go through the same core `MentionRegistry` path the in-app mentions use
 * — the knowledge module exposes no SDK, and this keeps one read path.
 *
 * MCP-only (registered next to the extended reads), for the same reason: the
 * in-app registry's prompt and DoD harness are tuned against its current set.
 */

const KNOWLEDGE_PAGE = "knowledge-page";
const WORKSPACE = "default";
/** Same id shape the mention parser accepts. */
const PAGE_ID = /^[a-zA-Z0-9-]+$/;
/** Per-page cap for an external agent: generous, but not a whole manual. */
const MAX_PAGE_CHARS = 60_000;

function failed(message: string, limits: AiToolResult["limits"]): AiToolResult<null> {
  return {
    ok: false,
    data: null,
    summary: message,
    sources: [],
    warnings: [message],
    truncated: false,
    limits,
  };
}

function makeSearchTool(): AiTool {
  return {
    definition: {
      name: "knowledge_search_pages",
      version: "1",
      effect: "read",
      capability: "knowledge.read",
      description:
        "Search the user's OpenPCB Docs (knowledge pages: notes, specs, imported PDFs) by title. Returns page ids and titles; read one with knowledge_get_page.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Title text to match." },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["query"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { query, limit } = (input ?? {}) as { query?: string; limit?: number };
      if (!MentionRegistry.get().getProvider(KNOWLEDGE_PAGE)) {
        return failed("The Docs (knowledge) module is not available.", execCtx.limits);
      }
      const hits = await MentionRegistry.get().search(
        { query: query ?? "", workspaceId: WORKSPACE, limit: limit ?? 20 },
        [KNOWLEDGE_PAGE],
      );
      const pages = hits.map((hit) => ({
        id: hit.id,
        title: hit.displayText,
        description: hit.description ?? null,
      }));
      return {
        ok: true,
        data: { pages },
        summary:
          pages.length === 0
            ? `No Docs page matches "${query ?? ""}".`
            : `${pages.length} Docs page(s) match "${query ?? ""}".`,
        sources: [],
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeGetPageTool(): AiTool {
  return {
    definition: {
      name: "knowledge_get_page",
      version: "1",
      effect: "read",
      capability: "knowledge.read",
      description:
        "Read one OpenPCB Docs page as markdown (the same content the in-app assistant gets when the user @mentions it). Images are omitted; PDF pages return a stub.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string", description: "Page id from knowledge_search_pages." },
        },
        required: ["pageId"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { pageId } = (input ?? {}) as { pageId?: string };
      if (!pageId || !PAGE_ID.test(pageId)) {
        return failed("pageId must be an id from knowledge_search_pages.", execCtx.limits);
      }
      if (!MentionRegistry.get().getProvider(KNOWLEDGE_PAGE)) {
        return failed("The Docs (knowledge) module is not available.", execCtx.limits);
      }
      const resolver = new MentionContentResolver(MAX_PAGE_CHARS, MAX_PAGE_CHARS);
      const [page] = await resolver.resolveMessageMentions(
        `@[${KNOWLEDGE_PAGE}:${pageId}|page]`,
        WORKSPACE,
      );
      if (!page || !page.exists) {
        return failed(`No Docs page with id '${pageId}'.`, execCtx.limits);
      }
      return {
        ok: true,
        data: { id: pageId, title: page.displayText, markdown: page.content },
        summary: `Docs page "${page.displayText}" (${page.content.length} chars).`,
        sources: [
          { id: `knowledge_${pageId}`, kind: "file", refId: pageId, label: page.displayText },
        ],
        warnings: [],
        truncated: page.content.length >= MAX_PAGE_CHARS,
        limits: execCtx.limits,
      };
    },
  };
}

export function registerKnowledgeTools(registry: AiToolRegistry): void {
  registry.register(makeSearchTool());
  registry.register(makeGetPageTool());
}
