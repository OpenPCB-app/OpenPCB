import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import { MentionRegistry } from "../../../../core/backend/mentions";
import { MentionContentResolver } from "../mention-content-resolver";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";

/**
 * Designs as MCP resources.
 *
 * A client can @-mention `openpcb://design/{id}/schematic` as context instead
 * of spending a tool call on it, which matters because these reads are the ones
 * an agent repeats most.
 *
 * No subscriptions in v1: the designer module has no change stream (no SSE, no
 * WebSocket), so `notifications/resources/updated` would mean standing up a
 * revision watcher. Clients should re-read after they write.
 */

const SCHEME = "openpcb://";

type ResourceKind = "schematic" | "pcb" | "bom" | "erc" | "drc";

const KIND_LABELS: Record<ResourceKind, string> = {
  schematic: "Schematic connectivity (parts, pins, nets, wires)",
  pcb: "PCB projection (board, placements, traces, vias, ratsnest)",
  bom: "Bill of materials",
  erc: "Electrical Rule Check report",
  drc: "Design Rule Check report",
};

function designerOf(ctx: CoreBackendModuleContext): DesignerSDK | undefined {
  return ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined;
}

async function readDesignResource(
  designer: DesignerSDK,
  designId: string,
  kind: ResourceKind,
): Promise<unknown> {
  switch (kind) {
    case "schematic":
      return designer.getSchematicProjection(designId);
    case "pcb":
      return designer.getPcbProjection(designId);
    case "bom":
      return designer.getBomProjection(designId);
    case "erc":
      return designer.runErc(designId);
    case "drc":
      return designer.runDrc(designId);
  }
}

function parseDesignUri(
  uri: string,
): { designId: string; kind: ResourceKind } | null {
  if (!uri.startsWith(`${SCHEME}design/`)) return null;
  const rest = uri.slice(`${SCHEME}design/`.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const designId = rest.slice(0, slash);
  const kind = rest.slice(slash + 1);
  if (!(kind in KIND_LABELS)) return null;
  return { designId, kind: kind as ResourceKind };
}

export function registerResources(
  server: McpServer,
  ctx: CoreBackendModuleContext,
): void {
  server.registerResource(
    "openpcb-design",
    // One template covers every design × kind pair. `list` enumerates the
    // concrete URIs so a client can browse them without guessing ids.
    new ResourceTemplate(`${SCHEME}design/{designId}/{kind}`, {
      list: async () => {
        const designer = designerOf(ctx);
        if (!designer) return { resources: [] };
        const designs = await designer.listDesigns();
        return {
          resources: designs.flatMap((design) =>
            (Object.keys(KIND_LABELS) as ResourceKind[]).map((kind) => ({
              uri: `${SCHEME}design/${design.id}/${kind}`,
              name: `${design.name} — ${kind}`,
              description: KIND_LABELS[kind],
              mimeType: "application/json",
            })),
          ),
        };
      },
    }),
    {
      title: "OpenPCB design data",
      description: `Read-only JSON views of a design. kind is one of: ${Object.keys(
        KIND_LABELS,
      ).join(", ")}. Use designer_list_designs for valid designIds.`,
      mimeType: "application/json",
    },
    async (uri: URL) => {
      const parsed = parseDesignUri(uri.href);
      if (!parsed) {
        throw new Error(
          `Unrecognised OpenPCB resource: ${uri.href}. Expected ${SCHEME}design/{designId}/{${Object.keys(
            KIND_LABELS,
          ).join("|")}}.`,
        );
      }
      const designer = designerOf(ctx);
      if (!designer) throw new Error("Designer module is not available.");

      const payload = await readDesignResource(
        designer,
        parsed.designId,
        parsed.kind,
      );
      if (payload === null || payload === undefined) {
        throw new Error(
          `No ${parsed.kind} data for design '${parsed.designId}'.`,
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  );
}

/**
 * Docs (knowledge) pages as resources, so a client can attach a spec or a
 * note as context the way the user @mentions it in-app. Same read path as the
 * `knowledge_*` tools (core MentionRegistry → Tiptap-to-markdown).
 */
export function registerKnowledgeResources(server: McpServer): void {
  if (!MentionRegistry.get().getProvider("knowledge-page")) return;
  server.registerResource(
    "openpcb-knowledge-page",
    new ResourceTemplate(`${SCHEME}knowledge/{pageId}`, {
      list: async () => {
        const pages = await MentionRegistry.get().search(
          { query: "", workspaceId: "default", limit: 100 },
          ["knowledge-page"],
        );
        return {
          resources: pages.map((page) => ({
            uri: `${SCHEME}knowledge/${page.id}`,
            name: page.displayText,
            description: page.description ?? "OpenPCB Docs page",
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "OpenPCB Docs page",
      description: "A page from the user's OpenPCB Docs, as markdown.",
      mimeType: "text/markdown",
    },
    async (uri: URL) => {
      const pageId = uri.href.slice(`${SCHEME}knowledge/`.length);
      if (!/^[a-zA-Z0-9-]+$/.test(pageId)) {
        throw new Error(`Unrecognised OpenPCB Docs resource: ${uri.href}`);
      }
      const [page] = await new MentionContentResolver(60_000, 60_000).resolveMessageMentions(
        `@[knowledge-page:${pageId}|page]`,
        "default",
      );
      if (!page || !page.exists) throw new Error(`No Docs page '${pageId}'.`);
      return {
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: page.content },
        ],
      };
    },
  );
}

export { KIND_LABELS as MCP_RESOURCE_KINDS };
