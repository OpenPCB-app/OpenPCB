import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
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
  if (!Object.hasOwn(KIND_LABELS, kind)) return null;
  return { designId, kind: kind as ResourceKind };
}

export async function listMcpResources(ctx: CoreBackendModuleContext) {
  const designer = designerOf(ctx);
  if (!designer) return [];
  return (await designer.listDesigns()).flatMap((design) =>
    (Object.keys(KIND_LABELS) as ResourceKind[]).map((kind) => ({
      uri: `${SCHEME}design/${design.id}/${kind}`, name: `${design.name} — ${kind}`,
      description: KIND_LABELS[kind], mimeType: "application/json",
    })),
  );
}

export async function readMcpResource(ctx: CoreBackendModuleContext, uri: string) {
  const parsed = parseDesignUri(uri);
  if (!parsed) throw new Error(`Unrecognised OpenPCB resource: ${uri}. Expected ${SCHEME}design/{designId}/{${Object.keys(KIND_LABELS).join("|")}}.`);
  const designer = designerOf(ctx);
  if (!designer) throw new Error("Designer module is not available.");
  const payload = await readDesignResource(designer, parsed.designId, parsed.kind);
  if (payload === null || payload === undefined) throw new Error(`No ${parsed.kind} data for design '${parsed.designId}'.`);
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload) }] };
}

export { KIND_LABELS as MCP_RESOURCE_KINDS };
