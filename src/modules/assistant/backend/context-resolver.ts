import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AiContextBinding,
  type AssistantContextBindingDto,
  type DesignerSDK,
} from "../../../sdks";
import { findPrimary } from "@openpcb/ai-core";
import type { ConversationStore } from "./conversation-store";

export interface DesignSummaryHit {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  matchKind: "exact" | "fuzzy";
  score: number;
}

export interface ResolveDesignResult {
  status:
    | "resolved"
    | "ambiguous"
    | "not-found"
    | "already-bound-to-other-design";
  resolved?: DesignSummaryHit;
  candidates: DesignSummaryHit[];
  message: string;
}

function score(
  query: string,
  name: string,
): { match: "exact" | "fuzzy" | null; score: number } {
  const q = query.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!q) return { match: null, score: 0 };
  if (n === q) return { match: "exact", score: 1.0 };
  if (n.includes(q))
    return {
      match: "fuzzy",
      score: 0.8 - Math.min(0.3, (n.length - q.length) / 100),
    };
  // Token overlap
  const qTokens = new Set(q.split(/\s+/));
  const nTokens = new Set(n.split(/\s+/));
  let overlap = 0;
  for (const t of qTokens) if (nTokens.has(t)) overlap++;
  if (overlap > 0)
    return {
      match: "fuzzy",
      score: 0.3 + overlap / Math.max(qTokens.size, nTokens.size),
    };
  return { match: null, score: 0 };
}

export class ContextResolver {
  constructor(
    private readonly ctx: CoreBackendModuleContext,
    private readonly store: ConversationStore,
  ) {}

  private getDesignerSdk(): DesignerSDK | undefined {
    return (
      this.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined
    );
  }

  listBindings(chatId: string): AssistantContextBindingDto[] {
    return this.store.listBindings(chatId);
  }

  getPrimaryDesign(chatId: string): AssistantContextBindingDto | undefined {
    const bindings = this.store.listBindings(chatId);
    return findPrimary(bindings, "design") as
      | AssistantContextBindingDto
      | undefined;
  }

  async resolveDesign(
    chatId: string,
    query: string,
  ): Promise<ResolveDesignResult> {
    const designer = this.getDesignerSdk();
    if (!designer) {
      return {
        status: "not-found",
        candidates: [],
        message: "Designer module is not available.",
      };
    }
    const designs = await designer.listDesigns();
    const hits: DesignSummaryHit[] = [];
    for (const d of designs) {
      const r = score(query, d.name);
      if (r.match) {
        hits.push({
          id: d.id,
          name: d.name,
          revision: d.revision,
          updatedAt: d.updatedAt,
          matchKind: r.match,
          score: r.score,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);

    const primary = this.getPrimaryDesign(chatId);

    if (hits.length === 0) {
      return {
        status: "not-found",
        candidates: [],
        message: `No design matches "${query}".`,
      };
    }
    const top = hits[0]!;
    const exactHits = hits.filter((h) => h.matchKind === "exact");
    const isUniqueExact = exactHits.length === 1;
    const isUniqueByScore =
      hits.length === 1 || (hits[1] && top.score - hits[1].score >= 0.2);
    const isUnique = isUniqueExact || isUniqueByScore;

    if (primary) {
      if (primary.refId === top.id) {
        return {
          status: "resolved",
          resolved: top,
          candidates: hits.slice(0, 5),
          message: `Already bound to ${top.name}.`,
        };
      }
      return {
        status: "already-bound-to-other-design",
        candidates: hits.slice(0, 5),
        message: `This chat is bound to "${primary.label}". Start a new chat to work on "${top.name}".`,
      };
    }

    if (!isUnique) {
      return {
        status: "ambiguous",
        candidates: hits.slice(0, 5),
        message: `Multiple designs match "${query}". Please clarify.`,
      };
    }

    await this.bindDesign(chatId, { id: top.id, name: top.name });
    return {
      status: "resolved",
      resolved: top,
      candidates: hits.slice(0, 5),
      message: `Bound chat to design "${top.name}".`,
    };
  }

  async bindDesign(
    chatId: string,
    design: { id: string; name: string },
  ): Promise<AssistantContextBindingDto> {
    const binding: AiContextBinding = {
      id: crypto.randomUUID(),
      kind: "design",
      refId: design.id,
      label: design.name,
      role: "primary",
      status: "active",
    };
    return this.store.createBinding(chatId, binding);
  }

  /**
   * If the chat has no primary design and this designId resolves to a real design, auto-bind it.
   * Idempotent: no-op when already bound to this design. If bound to a different design, returns null.
   */
  async maybeAutoBindDesign(
    chatId: string,
    designId: string,
  ): Promise<AssistantContextBindingDto | null> {
    const primary = this.getPrimaryDesign(chatId);
    if (primary) return primary.refId === designId ? primary : null;
    const designer = this.getDesignerSdk();
    if (!designer) return null;
    const design = await designer.getDesign(designId);
    if (!design) return null;
    return this.bindDesign(chatId, {
      id: design.head.id,
      name: design.head.name,
    });
  }

  /**
   * Verify all bindings still resolve. Mark missing bindings as 'missing'.
   */
  async refreshBindingHealth(chatId: string): Promise<void> {
    const designer = this.getDesignerSdk();
    if (!designer) return;
    const bindings = this.store.listBindings(chatId);
    const designIds = bindings
      .filter((b) => b.kind === "design")
      .map((b) => b.refId);
    if (designIds.length === 0) return;
    const live = new Set((await designer.listDesigns()).map((d) => d.id));
    for (const b of bindings) {
      if (b.kind === "design" && !live.has(b.refId) && b.status === "active") {
        this.store.updateBindingStatus(b.id, "missing");
      }
    }
  }
}
