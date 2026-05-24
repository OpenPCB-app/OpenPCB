import type {
  AiSourceRef,
  AiTool,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import { truncateArray } from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type LibrarySDK } from "../../../../sdks";

// ─── library_search_components ─────────────────────────────────────────

interface LibrarySearchComponentsInput {
  query: string;
  requirements?: {
    function?: string;
    voltage?: string;
    current?: string;
    package?: string;
    mountType?: string;
    value?: string;
    tolerance?: string;
    tags?: string[];
  };
  limit?: number;
}

interface ComponentHit {
  componentId: string;
  name: string;
  description: string;
  tags: string[];
  isBuiltin: boolean;
  score: number;
  reasons: string[];
  detailAvailable: boolean;
}

interface LibrarySearchComponentsOutput {
  rewrittenQuery: string;
  normalizedRequirements: Record<string, string | string[]>;
  results: ComponentHit[];
  noLocalMatch: boolean;
  genericSuggestions: Array<{
    label: string;
    reason: string;
    availability: "not-installed";
  }>;
  importGuidance: string | null;
}

function normalizeRequirements(
  reqs: NonNullable<LibrarySearchComponentsInput["requirements"]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (reqs.function) out.function = reqs.function.trim().toLowerCase();
  if (reqs.voltage)
    out.voltage = reqs.voltage.trim().toLowerCase().replace(/\s+/g, "");
  if (reqs.current)
    out.current = reqs.current.trim().toLowerCase().replace(/\s+/g, "");
  if (reqs.package) out.package = reqs.package.trim().toLowerCase();
  if (reqs.mountType) out.mountType = reqs.mountType.trim().toLowerCase();
  if (reqs.value) out.value = reqs.value.trim().toLowerCase();
  if (reqs.tolerance) out.tolerance = reqs.tolerance.trim().toLowerCase();
  if (reqs.tags)
    out.tags = reqs.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return out;
}

function scoreComponent(
  component: {
    name: string;
    description: string;
    tags: string[];
    isBuiltin: boolean;
  },
  query: string,
  normalized: Record<string, string | string[]>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const q = query.trim().toLowerCase();
  const name = component.name.toLowerCase();
  const desc = component.description.toLowerCase();
  const tags = new Set(component.tags.map((t) => t.toLowerCase()));
  if (q && name === q) {
    score += 5;
    reasons.push("name exact match");
  } else if (q && name.includes(q)) {
    score += 3;
    reasons.push("name contains query");
  } else if (q && desc.includes(q)) {
    score += 1.5;
    reasons.push("description contains query");
  }
  if (
    typeof normalized.function === "string" &&
    (name.includes(normalized.function) ||
      desc.includes(normalized.function) ||
      tags.has(normalized.function))
  ) {
    score += 2;
    reasons.push(`matches function "${normalized.function}"`);
  }
  if (
    typeof normalized.voltage === "string" &&
    (name.includes(normalized.voltage) ||
      desc.includes(normalized.voltage) ||
      tags.has(normalized.voltage))
  ) {
    score += 1.5;
    reasons.push(`mentions voltage ${normalized.voltage}`);
  }
  if (
    typeof normalized.package === "string" &&
    (name.includes(normalized.package) ||
      desc.includes(normalized.package) ||
      tags.has(normalized.package))
  ) {
    score += 1;
    reasons.push(`mentions package ${normalized.package}`);
  }
  if (Array.isArray(normalized.tags)) {
    let matched = 0;
    for (const t of normalized.tags) if (tags.has(t)) matched++;
    if (matched > 0) {
      score += matched * 0.5;
      reasons.push(`matches ${matched} required tag(s)`);
    }
  }
  if (component.isBuiltin) score += 0.2;
  return { score, reasons };
}

function genericSuggestionsFor(
  query: string,
  reqs?: LibrarySearchComponentsInput["requirements"],
): Array<{ label: string; reason: string; availability: "not-installed" }> {
  const q = query.toLowerCase();
  const suggestions: Array<{
    label: string;
    reason: string;
    availability: "not-installed";
  }> = [];
  if (
    q.includes("regulator") ||
    reqs?.function?.toLowerCase().includes("regulator")
  ) {
    const v = (reqs?.voltage ?? "").toLowerCase();
    if (v.includes("3.3")) {
      suggestions.push({
        label: "AMS1117-3.3",
        reason: "Common 3.3V 1A LDO; SOT-223.",
        availability: "not-installed",
      });
      suggestions.push({
        label: "MIC5219-3.3",
        reason: "Low-noise 500mA 3.3V LDO; SOT-23-5.",
        availability: "not-installed",
      });
    } else if (v.includes("5")) {
      suggestions.push({
        label: "AMS1117-5.0",
        reason: "5V LDO; SOT-223.",
        availability: "not-installed",
      });
    } else {
      suggestions.push({
        label: "AMS1117-ADJ",
        reason: "Adjustable LDO regulator.",
        availability: "not-installed",
      });
    }
  }
  return suggestions;
}

export function makeLibrarySearchComponentsTool(
  ctx: CoreBackendModuleContext,
): AiTool<LibrarySearchComponentsInput, LibrarySearchComponentsOutput> {
  return {
    definition: {
      name: "library_search_components",
      version: "1",
      effect: "read",
      capability: "library.read",
      description:
        "Search the local OpenPCB component library by query, or list all installed components when query is omitted. Supports optional requirements (voltage/current/package/etc.). Returns ranked matches paginated by limit (default 10, max 50). If none match, returns generic suggestions and import guidance.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural-language description of the component. Omit (or leave empty) to list all installed components.",
          },
          requirements: {
            type: "object",
            properties: {
              function: { type: "string" },
              voltage: { type: "string" },
              current: { type: "string" },
              package: { type: "string" },
              mountType: { type: "string" },
              value: { type: "string" },
              tolerance: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: [],
      },
    },
    async execute(execCtx, input) {
      const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
      const rawQuery = (input.query ?? "").trim();
      const isListAll = rawQuery.length === 0 || rawQuery === "*";
      if (!library) {
        return {
          ok: false,
          data: emptyOutput(rawQuery),
          sources: [],
          warnings: ["Library module not available."],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const limit = Math.min(input.limit ?? 10, 50);
      const normalized = normalizeRequirements(input.requirements ?? {});
      const tags = Array.isArray(normalized.tags)
        ? (normalized.tags as string[])
        : undefined;
      const components = await library.searchComponents({
        query: isListAll ? "" : rawQuery,
        limit: limit * 2,
        tags,
      });
      const scored: ComponentHit[] = components
        .map((c) => {
          const s = isListAll
            ? {
                score: 1 + (c.isBuiltin ? 0.2 : 0),
                reasons: ["listed (no query)"],
              }
            : scoreComponent(c, rawQuery, normalized);
          return {
            componentId: c.id,
            name: c.name,
            description: c.description,
            tags: c.tags,
            isBuiltin: c.isBuiltin,
            score: s.score,
            reasons: s.reasons,
            detailAvailable: true,
          };
        })
        .filter((h) => isListAll || h.score > 0)
        .sort((a, b) =>
          isListAll ? a.name.localeCompare(b.name) : b.score - a.score,
        );
      const { items: top, truncated } = truncateArray(scored, limit);
      const noLocalMatch = top.length === 0;
      const sources: AiSourceRef[] = top.map((h) => ({
        id: `lib_${h.componentId}`,
        kind: "library-component",
        refId: h.componentId,
        label: h.name,
        excerpt: h.description,
      }));
      const output: LibrarySearchComponentsOutput = {
        rewrittenQuery: isListAll ? "(list all)" : rawQuery,
        normalizedRequirements: normalized,
        results: top,
        noLocalMatch,
        genericSuggestions:
          noLocalMatch && !isListAll
            ? genericSuggestionsFor(rawQuery, input.requirements)
            : [],
        importGuidance: noLocalMatch
          ? isListAll
            ? "Your local OpenPCB library has no installed components. Use the Library module to import KiCad symbols/footprints or create new components."
            : "No installed component matches. Use the Library module to import KiCad symbols/footprints or create a new component."
          : null,
      };
      return {
        ok: true,
        data: output,
        sources,
        warnings: [],
        truncated,
        limits: execCtx.limits,
      };
    },
  };
}

function emptyOutput(query: string): LibrarySearchComponentsOutput {
  return {
    rewrittenQuery: query,
    normalizedRequirements: {},
    results: [],
    noLocalMatch: true,
    genericSuggestions: [],
    importGuidance: null,
  };
}

// ─── library_get_component_detail ──────────────────────────────────────

interface LibraryGetComponentDetailInput {
  componentId: string;
  includeRaw?: boolean;
}

interface LibraryGetComponentDetailOutput {
  component: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    isBuiltin: boolean;
  };
  symbol: {
    id: string;
    name: string;
    referencePrefix: string | null;
    pinCount: number;
    keyPins: Array<{
      number: string | null;
      name: string;
      electricalType: string;
    }>;
    warnings: string[];
  };
  footprint: {
    id: string;
    name: string;
    mountType: string | null;
    padCount: number;
    packageCode: { imperial: string | null; metric: string | null };
    warnings: string[];
  };
  footprintVariants: Array<{
    footprintId: string;
    variantLabel: string;
    isDefault: boolean;
    mountType: string | null;
    padCount: number;
    packageCode: { imperial: string | null; metric: string | null };
  }>;
  provenance: {
    sourceKind: string | null;
    sourceFormat: string | null;
    fileName: string | null;
    importedAt: string | null;
    sourceHash: string | null;
  } | null;
  raw?: unknown;
}

export function makeLibraryGetComponentDetailTool(
  ctx: CoreBackendModuleContext,
  options: { allowRawToolData: boolean },
): AiTool<
  LibraryGetComponentDetailInput,
  LibraryGetComponentDetailOutput | null
> {
  return {
    definition: {
      name: "library_get_component_detail",
      version: "1",
      effect: "read",
      capability: "library.read",
      description:
        'Fetch full compact detail for one installed library component (symbol summary, footprint summary, variants, provenance). `componentId` may be the UUID returned by library_search_components OR the component name (e.g. "ATMEGA16U4-AU"); name lookup falls back to a library search.',
      inputSchema: {
        type: "object",
        properties: {
          componentId: {
            type: "string",
            description:
              "Component UUID (preferred) or exact/partial component name. Name lookup will use library_search_components and pick the best match.",
          },
          includeRaw: { type: "boolean" },
        },
        required: ["componentId"],
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<LibraryGetComponentDetailOutput | null>> {
      const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
      if (!library) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: ["Library module not available."],
          truncated: false,
          limits: execCtx.limits,
        };
      }

      const warnings: string[] = [];
      const requested = input.componentId.trim();

      // 1. Try direct UUID lookup.
      let resolvedId: string | null = null;
      let directHit = await library.getComponentDetail(requested);
      if (directHit) {
        resolvedId = requested;
      } else {
        // 2. Fall back to a name search (LLMs often pass names instead of UUIDs).
        const candidates = await library.searchComponents({
          query: requested,
          limit: 5,
        });
        if (candidates.length === 0) {
          return {
            ok: false,
            data: null,
            sources: [],
            warnings: [`Component not found: ${requested}`],
            truncated: false,
            limits: execCtx.limits,
          };
        }
        const needle = requested.toLowerCase();
        const exactByName = candidates.find(
          (c) => c.name.toLowerCase() === needle,
        );
        const best = exactByName ?? candidates[0]!;
        if (candidates.length > 1 && !exactByName) {
          warnings.push(
            `"${requested}" matched ${candidates.length} components by name; using "${best.name}" (${best.id}). Other candidates: ${candidates
              .slice(0, 3)
              .filter((c) => c.id !== best.id)
              .map((c) => c.name)
              .join(", ")}.`,
          );
        }
        directHit = await library.getComponentDetail(best.id);
        if (!directHit) {
          return {
            ok: false,
            data: null,
            sources: [],
            warnings: [
              `Component "${best.name}" (${best.id}) listed by search but detail lookup returned null.`,
            ],
            truncated: false,
            limits: execCtx.limits,
          };
        }
        resolvedId = best.id;
      }
      const detail = directHit;

      // Resolve placement detail only for keyPins; never include preview.
      let keyPins: LibraryGetComponentDetailOutput["symbol"]["keyPins"] = [];
      try {
        const placement =
          await library.resolveComponentForPlacement(resolvedId);
        if (placement) {
          keyPins = placement.symbol.pins.slice(0, 8).map((p) => ({
            number: p.number,
            name: p.name,
            electricalType: p.electricalType,
          }));
        }
      } catch {
        // ignore; pin enrichment is best-effort
      }
      const output: LibraryGetComponentDetailOutput = {
        component: {
          id: detail.component.id,
          name: detail.component.name,
          description: detail.component.description,
          tags: detail.component.tags,
          isBuiltin: detail.component.isBuiltin,
        },
        symbol: {
          id: detail.symbol.id,
          name: detail.symbol.name,
          referencePrefix: detail.symbol.referencePrefix,
          pinCount: detail.symbol.pinCount,
          keyPins,
          warnings: detail.symbol.warnings.map((w) => w.message),
        },
        footprint: {
          id: detail.footprint.id,
          name: detail.footprint.name,
          mountType: detail.footprint.mountType,
          padCount: detail.footprint.padCount,
          packageCode: detail.footprint.packageCode,
          warnings: detail.footprint.warnings.map((w) => w.message),
        },
        footprintVariants: detail.footprintVariants.slice(0, 5).map((v) => ({
          footprintId: v.footprintId,
          variantLabel: v.variantLabel,
          isDefault: v.isDefault,
          mountType: v.mountType,
          padCount: v.padCount,
          packageCode: v.packageCode,
        })),
        provenance:
          detail.symbol.provenance ?? detail.footprint.provenance ?? null,
      };
      const truncated = detail.footprintVariants.length > 5;
      if (truncated)
        warnings.push(
          `Showing first 5 of ${detail.footprintVariants.length} footprint variants.`,
        );
      if (input.includeRaw && options.allowRawToolData) {
        output.raw = detail;
      }
      const sources: AiSourceRef[] = [
        {
          id: `lib_${detail.component.id}`,
          kind: "library-component",
          refId: detail.component.id,
          label: detail.component.name,
        },
        {
          id: `sym_${detail.symbol.id}`,
          kind: "symbol",
          refId: detail.symbol.id,
          label: detail.symbol.name,
        },
        {
          id: `fp_${detail.footprint.id}`,
          kind: "footprint",
          refId: detail.footprint.id,
          label: detail.footprint.name,
        },
      ];
      return {
        ok: true,
        data: output,
        sources,
        warnings,
        truncated,
        limits: execCtx.limits,
      };
    },
  };
}

// ─── register entry point ──────────────────────────────────────────────

export function registerLibraryTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  options: { allowRawToolData: boolean },
): void {
  registry.register(makeLibrarySearchComponentsTool(ctx) as unknown as AiTool);
  registry.register(
    makeLibraryGetComponentDetailTool(ctx, options) as unknown as AiTool,
  );
}
