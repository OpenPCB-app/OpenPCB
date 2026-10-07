/**
 * `compile_circuit` — the compiler-agent capstone (P1.3).
 *
 * The LLM emits a declarative circuit-spec IR (block instances + port-level
 * nets); this tool deterministically expands → lowers → applies it to the live
 * design and ERC-checks the composed result. The model never hand-wires pins:
 * each block owns its own pin-accurate wiring, and part roles are resolved to
 * INSTALLED library components (installed-parts-only — no substitution).
 *
 * Self-correction: the tool records enough in its result for the canonical verification hook to
 * persist a BuildIntent, so the existing Definition-of-Done harness verifies the
 * composed circuit and drives ≤N correction passes if ERC is dirty. The in-tool
 * ERC read below is immediate same-turn feedback, not the enforcement path.
 */

import type { AiTool } from "agentkit/core";
import type { AiToolResult } from "agentkit/contracts";
import type { CompiledPlan } from "./lowering";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type DesignerSDK,
  type LibrarySDK,
} from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import { failedTool, resolveDesignForTool } from "../tools/designer-tools";
import { resolveRoleToComponentId } from "../tools/library-tools";
import { getBlockDef, listBlockRecipes } from "./blocks";
import { expandCircuit } from "./expander";
import type { CircuitIr, ResolvedNetlist } from "./ir";
import { DEFAULT_PITCH_NM, lowerNetlist } from "./lowering";
import { applyCompiledPlan, type ApplyCompiledPlanResult } from "./apply";

export type CompileCircuitInput = CircuitIr & { designId?: string };

/** Aggregated placed part — mirrors a BuildIntent item (per componentId). */
export interface CompileBomItem {
  role: string;
  componentId: string;
  quantity: number;
  value?: string;
}

export interface CompileCircuitData {
  status: "applied" | "partial" | "failed" | "unresolved";
  placedCount: number;
  wiredCount: number;
  portCount: number;
  /** Distinct roles with no installed component (installed-parts-only guardrail). */
  missingRoles: string[];
  ercErrors: Array<{ code: string; message: string }>;
  assumptions: string[];
  /** Resolved bill of materials — the native adapter captures this as a BuildIntent. */
  bom: CompileBomItem[];
}

export function makeDesignerCompileCircuitTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  stage?: (input: { designId: string; baseRevision: number; plan: CompiledPlan; bom: CompileBomItem[]; warnings: string[] }) => Promise<AiToolResult<unknown>>,
): AiTool<CompileCircuitInput, CompileCircuitData | null> {
  const recipes = listBlockRecipes().join(", ");
  return {
    definition: {
      name: "compile_circuit",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.compile",
      description:
        "Build a schematic from a declarative circuit-spec IR: block instances + port-level nets. " +
        "Prefer this over hand placing+wiring for standard multi-part circuits — each block owns its " +
        "own pin-accurate internal wiring and part values (Ohm's law etc.) are computed deterministically, " +
        "so you connect only a few semantic ports and never touch pins. Part roles resolve to INSTALLED " +
        "library components; a missing role is reported (import it) — parts are never substituted. The " +
        "composed result is ERC-checked and auto-applied in one pass (revertible step-by-step via designer undo). " +
        `Available block recipes: ${recipes} (led_indicator ports: IN, GND; params: supplyV, vf, currentA). ` +
        "Connect nets by port ref \"<blockId>.<PORT>\" (e.g. \"led0.IN\"); name your vcc/gnd rails in `power`.",
      inputSchema: {
        type: "object",
        properties: {
          designId: {
            type: "string",
            description:
              "Target design id. Omit to use the design bound to this chat.",
          },
          version: {
            type: "integer",
            enum: [1],
            description: "IR schema version — must be 1.",
          },
          blocks: {
            type: "array",
            description: "Block instances to place.",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Unique handle within this IR (e.g. \"led0\").",
                },
                recipe: {
                  type: "string",
                  description: `Block recipe name. Available: ${recipes}.`,
                },
                params: {
                  type: "object",
                  description:
                    "Recipe parameters (e.g. supplyV, vf, currentA for led_indicator).",
                  additionalProperties: true,
                },
              },
              required: ["id", "recipe"],
            },
          },
          nets: {
            type: "array",
            description:
              "Port-level nets. Each connects block ports named \"<blockId>.<PORT>\".",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                ports: {
                  type: "array",
                  items: { type: "string" },
                  description: "Port refs, e.g. [\"led0.IN\", \"led1.IN\"].",
                },
              },
              required: ["name", "ports"],
            },
          },
          power: {
            type: "object",
            description:
              "Names of the vcc/gnd rail nets — lowered to power/ground port symbols, not plain wires.",
            properties: {
              vcc: { type: "string" },
              gnd: { type: "string" },
            },
            required: ["vcc", "gnd"],
          },
        },
        required: ["version", "blocks", "nets", "power"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
      if (!library)
        return failedTool("Library module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);

      const resolved = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolved.ok) return failedTool(resolved.warning, execCtx.limits);
      const designId = resolved.designId;
      const design = await designer.getDesign(designId);
      if (!design)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const baseRevision = design.head.revision;

      // Pass 1: expand without a resolver to discover roles and surface structural
      // IR errors (unknown recipe / bad port ref) as a fixable message.
      let firstPass: ResolvedNetlist;
      try {
        firstPass = expandCircuit(input);
      } catch (err) {
        return failedTool(`Invalid circuit IR: ${errMessage(err)}`, execCtx.limits);
      }

      // Async-resolve each distinct role once (sync `resolveRole` can't await),
      // then re-expand with a synchronous map lookup.
      const roleMap = new Map<string, string>();
      for (const role of new Set(firstPass.parts.map((p) => p.role))) {
        const componentId = await resolveRoleToComponentId(library, role);
        if (componentId) roleMap.set(role, componentId);
      }
      const netlist = expandCircuit(input, {
        resolveRole: (role) => roleMap.get(role),
      });
      // Recompiling into a non-empty design must not stack the new grid on the
      // old one: coincident pins junction-merge across compiles (shorts ERC
      // can't see, since all-passive pins fire no rule). Drop the new block
      // grid below everything already placed.
      const existing = await designer.getSchematicProjection(designId);
      const partYs = (existing?.parts ?? []).map((p) => p.positionNm.y);
      const plan = lowerNetlist(
        netlist,
        partYs.length > 0
          ? { origin: { x: 0, y: Math.max(...partYs) + 2 * DEFAULT_PITCH_NM } }
          : {},
      );
      const bom = buildBom(netlist);

      // Unreferenced block ports float silently (ERC can't flag all-passive
      // pins): an IR whose nets miss a port compiles "clean" but leaves e.g.
      // every LED cathode disconnected. Flag them so the model fixes the IR
      // instead of shipping a smaller circuit than it asked for.
      const referenced = new Set(input.nets.flatMap((n) => n.ports));
      const structuralWarnings = [...plan.warnings];
      for (const block of input.blocks) {
        for (const port of getBlockDef(block.recipe)?.ports ?? []) {
          const ref = `${block.id}.${port}`;
          if (!referenced.has(ref)) {
            structuralWarnings.push(
              `Block port "${ref}" is not connected to any net — it floats. ` +
                "Add it to a net (or a rail net named in `power`).",
            );
          }
        }
      }

      // Installed-parts-only guardrail: flag missing roles, never substitute.
      if (plan.unresolvedRoles.length > 0) {
        const missingRoles = [...new Set(plan.unresolvedRoles)];
        return {
          ok: false,
          data: {
            status: "unresolved",
            placedCount: 0,
            wiredCount: 0,
            portCount: 0,
            missingRoles,
            ercErrors: [],
            assumptions: plan.assumptions,
            bom,
          },
          sources: [],
          warnings: [
            `No installed component for role(s): ${missingRoles.join(", ")}. ` +
              "Import a matching part or install a generic — I won't substitute a wrong part.",
          ],
          truncated: false,
          limits: execCtx.limits,
          status: "partial",
          summary: `Cannot compile: no installed parts for ${missingRoles.join(", ")}.`,
          modelData: { status: "unresolved", missingRoles },
        };
      }

      if (stage) {
        return await stage({ designId, baseRevision, plan, bom, warnings: structuralWarnings }) as AiToolResult<CompileCircuitData | null>;
      }

      // Commands commit separately and each has a UI undo entry.
      let applyResult: ApplyCompiledPlanResult;
      try {
        applyResult = await applyCompiledPlan({
          designer,
          designId,
          baseRevision,
          plan,
        });
      } catch (err) {
        return failedTool(errMessage(err), execCtx.limits);
      }

      // In-tool ERC read over the composed result (immediate feedback; the
      // run-level DoD harness re-verifies and drives correction passes).
      const ercErrors = await readErcErrors(designer, designId);

      const data: CompileCircuitData = {
        status: applyResult.status,
        placedCount: applyResult.placedCount,
        wiredCount: applyResult.wiredCount,
        portCount: applyResult.portCount,
        missingRoles: [],
        ercErrors,
        assumptions: plan.assumptions,
        bom,
      };
      const ok =
        applyResult.status === "applied" &&
        ercErrors.length === 0 &&
        structuralWarnings.length === 0;
      return {
        ok,
        data,
        sources: [],
        warnings: [
          ...structuralWarnings,
          ...plan.assumptions,
          ...applyResult.errors,
          ...ercErrors.map((v) => `ERC ${v.code}: ${v.message}`),
        ],
        truncated: false,
        limits: execCtx.limits,
        status: ok ? "ok" : "partial",
        summary: buildSummary(applyResult, ercErrors.length),
        modelData: {
          status: applyResult.status,
          placedCount: applyResult.placedCount,
          wiredCount: applyResult.wiredCount,
          portCount: applyResult.portCount,
          ercErrorCount: ercErrors.length,
          ercErrors: ercErrors.slice(0, 10),
          structuralWarnings,
          assumptions: plan.assumptions,
        },
      };
    },
  };
}

function buildBom(netlist: ResolvedNetlist): CompileBomItem[] {
  const byComponent = new Map<string, CompileBomItem>();
  for (const part of netlist.parts) {
    if (!part.componentId) continue;
    const existing = byComponent.get(part.componentId);
    if (existing) {
      existing.quantity += 1;
    } else {
      byComponent.set(part.componentId, {
        role: part.role,
        componentId: part.componentId,
        quantity: 1,
        ...(part.value !== null ? { value: part.value } : {}),
      });
    }
  }
  return [...byComponent.values()];
}

async function readErcErrors(
  designer: DesignerSDK,
  designId: string,
): Promise<Array<{ code: string; message: string }>> {
  const snapshot = await designer.getProjectionAndErc(designId).catch(() => null);
  if (!snapshot) return [];
  return snapshot.erc.violations
    .filter((v) => v.severity === "error")
    .map((v) => ({ code: v.code, message: v.message }));
}

function buildSummary(
  applyResult: ApplyCompiledPlanResult,
  ercErrorCount: number,
): string {
  const parts = `${applyResult.placedCount} part${applyResult.placedCount === 1 ? "" : "s"}`;
  const base = `${applyResult.status}: placed ${parts}, wired ${applyResult.wiredCount} net${applyResult.wiredCount === 1 ? "" : "s"}, ${applyResult.portCount} power pin${applyResult.portCount === 1 ? "" : "s"}`;
  if (ercErrorCount > 0) return `${base}; ${ercErrorCount} ERC error${ercErrorCount === 1 ? "" : "s"} — fix and recompile.`;
  return `${base}; ERC clean.`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
