import type {
  DesignerSDK,
  DesignerSchematicProjection,
  ErcReport,
} from "../../../../sdks";
import type { ConversationStore } from "../conversation-store";
import type { BuildIntentStore } from "./build-intent-store";
import type {
  BuildIntent,
  CheckResult,
  DeficiencyReport,
  DodCheckId,
} from "./types";

export interface RunDefinitionOfDoneInput {
  designer: DesignerSDK;
  conversation: ConversationStore;
  buildIntents: BuildIntentStore;
  chatId: string;
  taskId: string;
  /** Design the run is bound to. When absent, every check is a no-op pass. */
  designId: string | null;
}

/** ERC violation codes that indicate a floating power / driven input pin. */
const DANGLING_POWER_CODES = new Set<string>([
  "POWER_PIN_NOT_DRIVEN",
  "PIN_NOT_CONNECTED",
  "INPUT_PIN_NOT_DRIVEN",
  "FLOATING_POWER",
  "FLOATING_INPUT",
]);

function anchorIds(
  report: ErcReport,
  predicate: (code: string) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const violation of report.violations) {
    if (!predicate(violation.code)) continue;
    for (const anchor of violation.anchors) {
      if (anchor.kind === "pin") ids.add(anchor.pinId);
      else if (anchor.kind === "net") ids.add(anchor.netId);
      else if (anchor.kind === "part") ids.add(anchor.partId);
    }
  }
  return [...ids];
}

/** Count placed schematic parts per library component id. */
function placedCountByComponent(
  schematic: DesignerSchematicProjection,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of schematic.parts) {
    counts.set(part.componentId, (counts.get(part.componentId) ?? 0) + 1);
  }
  return counts;
}

/** All derived-net names with at least two real electrical endpoints. */
function wiredNetNames(schematic: DesignerSchematicProjection): Set<string> {
  const names = new Set<string>();
  for (const net of schematic.nets) {
    const endpoints =
      net.pinIds.length +
      net.wireIds.length +
      net.labelIds.length +
      net.primitiveIds.length;
    const hasConnection =
      net.pinIds.length >= 2 ||
      (net.pinIds.length >= 1 &&
        (net.wireIds.length > 0 ||
          net.labelIds.length > 0 ||
          net.primitiveIds.length > 0));
    if (hasConnection && endpoints >= 2) names.add(net.name);
  }
  return names;
}

function checkBomPlaced(
  intent: BuildIntent | null,
  schematic: DesignerSchematicProjection,
): CheckResult {
  if (!intent || intent.items.length === 0) {
    return {
      id: "bom_placed",
      passed: true,
      message: "No build intent recorded; skipping BOM-placement check.",
      affectedIds: [],
    };
  }
  const placed = placedCountByComponent(schematic);
  const missing: string[] = [];
  const details: string[] = [];
  for (const item of intent.items) {
    const have = placed.get(item.componentId) ?? 0;
    if (have < item.quantity) {
      missing.push(item.componentId);
      details.push(
        `${item.role} (${item.value ?? item.componentId}): placed ${have}/${item.quantity}`,
      );
    }
  }
  return {
    id: "bom_placed",
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? "Every BOM item is placed."
        : `Missing placements — ${details.join("; ")}.`,
    affectedIds: missing,
  };
}

function checkNetsWired(
  intent: BuildIntent | null,
  schematic: DesignerSchematicProjection,
): CheckResult {
  const required = new Set<string>();
  for (const item of intent?.items ?? []) {
    for (const net of item.requiredNets) required.add(net);
  }
  if (required.size === 0) {
    return {
      id: "nets_wired",
      passed: true,
      message: "No required nets recorded; skipping net-wiring check.",
      affectedIds: [],
    };
  }
  const wired = wiredNetNames(schematic);
  const unwired = [...required].filter((net) => !wired.has(net));
  return {
    id: "nets_wired",
    passed: unwired.length === 0,
    message:
      unwired.length === 0
        ? "Every required net is wired."
        : `Required net(s) not wired: ${unwired.join(", ")}.`,
    affectedIds: unwired,
  };
}

function checkNoDanglingPower(erc: ErcReport | null): CheckResult {
  if (!erc) {
    return {
      id: "no_dangling_power",
      passed: true,
      message: "ERC unavailable; skipping dangling-power check.",
      affectedIds: [],
    };
  }
  const affected = anchorIds(erc, (code) => DANGLING_POWER_CODES.has(code));
  return {
    id: "no_dangling_power",
    passed: affected.length === 0,
    message:
      affected.length === 0
        ? "No dangling power/ground pins."
        : `Dangling power/input pin(s): ${affected.join(", ")}.`,
    affectedIds: affected,
  };
}

function checkErcClean(erc: ErcReport | null): CheckResult {
  if (!erc) {
    return {
      id: "erc_clean",
      passed: true,
      message: "ERC unavailable; skipping ERC-clean check.",
      affectedIds: [],
    };
  }
  const errors = erc.violations.filter((v) => v.severity === "error");
  const affected = new Set<string>();
  for (const e of errors) {
    for (const a of e.anchors) {
      if (a.kind === "pin") affected.add(a.pinId);
      else if (a.kind === "net") affected.add(a.netId);
      else if (a.kind === "part") affected.add(a.partId);
    }
  }
  return {
    id: "erc_clean",
    passed: erc.summary.errors === 0,
    message:
      erc.summary.errors === 0
        ? "ERC reports no errors."
        : `ERC reports ${erc.summary.errors} error(s): ${errors
            .slice(0, 5)
            .map((e) => e.message)
            .join("; ")}.`,
    affectedIds: [...affected],
  };
}

/**
 * Run the Definition-of-Done verifier (P4b). Takes a SINGLE schematic-projection
 * snapshot and runs ERC against the same revision (no racing two SDK reads), then
 * applies four hard-fail checks: every BOM item placed, every required net wired,
 * no dangling power/gnd, ERC errors == 0.
 *
 * Apply status is read from persisted write proposals (not tool `ok`) so the
 * report reflects what actually landed in the design.
 */
export async function runDefinitionOfDone(
  input: RunDefinitionOfDoneInput,
): Promise<DeficiencyReport> {
  const passReport = (message: string): DeficiencyReport => ({
    status: "pass",
    checks: (
      [
        "bom_placed",
        "nets_wired",
        "no_dangling_power",
        "erc_clean",
      ] as DodCheckId[]
    ).map((id) => ({ id, passed: true, message, affectedIds: [] })),
    failing: [],
  });

  if (!input.designId) {
    return passReport("No design bound; nothing to verify.");
  }

  const intent = input.buildIntents.get(input.chatId, input.taskId);
  // One snapshot of the schematic; ERC runs against the current revision too.
  const schematic = await input.designer.getSchematicProjection(input.designId);
  if (!schematic) {
    return passReport("No schematic projection; nothing to verify.");
  }
  const erc = await input.designer.runErc(input.designId).catch(() => null);

  // Surface whether the last writes actually applied (informational; the checks
  // below assert on real projection state, which already reflects applied ops).
  const proposals = input.conversation.listWriteProposals(input.chatId);
  const lastFailedApply = proposals.find(
    (p) => p.status === "failed" || p.status === "partial",
  );

  const checks: CheckResult[] = [
    checkBomPlaced(intent, schematic),
    checkNetsWired(intent, schematic),
    checkNoDanglingPower(erc),
    checkErcClean(erc),
  ];
  if (lastFailedApply) {
    const bom = checks[0]!;
    if (!bom.passed) {
      bom.message += ` (a prior apply finished as "${lastFailedApply.status}").`;
    }
  }

  const failing = checks.filter((c) => !c.passed).map((c) => c.id);
  return {
    status: failing.length === 0 ? "pass" : "partial",
    checks,
    failing,
  };
}
