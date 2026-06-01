import type {
  DesignerSDK,
  DesignerSchematicProjection,
  ErcReport,
  ErcViolation,
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

/**
 * The single ERC code the engine emits for a floating power-input pin
 * (`erc-engine.ts` → `UNCONNECTED_INPUT_PIN`, severity `"error"` only when the
 * pin is `power_in`). A `warning`-severity occurrence is an unconnected signal
 * input, not a dangling power pin, so we gate on severity too.
 */
const DANGLING_POWER_CODE = "UNCONNECTED_INPUT_PIN";

function isDanglingPower(violation: ErcViolation): boolean {
  return (
    violation.code === DANGLING_POWER_CODE && violation.severity === "error"
  );
}

function anchorIds(
  report: ErcReport,
  predicate: (violation: ErcViolation) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const violation of report.violations) {
    if (!predicate(violation)) continue;
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
  schematic: DesignerSchematicProjection | null,
): CheckResult {
  if (!intent || intent.items.length === 0) {
    return {
      id: "bom_placed",
      passed: true,
      message: "No build intent recorded; skipping BOM-placement check.",
      affectedIds: [],
    };
  }
  // Intent exists but the projection can't be read — verification is
  // unavailable, which is NOT a pass for a build task (F3).
  if (!schematic) {
    return {
      id: "bom_placed",
      passed: false,
      message: "Schematic projection unavailable; cannot verify BOM placement.",
      affectedIds: intent.items.map((i) => i.componentId),
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
  schematic: DesignerSchematicProjection | null,
): CheckResult {
  const hasItems = (intent?.items.length ?? 0) > 0;
  const required = new Set<string>();
  for (const item of intent?.items ?? []) {
    for (const net of item.requiredNets) required.add(net);
  }
  if (required.size === 0) {
    // F7b: a build task with items but ZERO captured required nets is NOT
    // verifiable — do not vacuously pass. Fail closed. Only a genuinely
    // net-free intent (no items at all) skips the check.
    if (hasItems) {
      return {
        id: "nets_wired",
        passed: false,
        message:
          "Build intent has items but no required nets were captured; net wiring is not verifiable.",
        affectedIds: [],
      };
    }
    return {
      id: "nets_wired",
      passed: true,
      message: "No required nets recorded; skipping net-wiring check.",
      affectedIds: [],
    };
  }
  // Intent requires nets but the projection can't be read — unavailable, not a
  // pass (F3).
  if (!schematic) {
    return {
      id: "nets_wired",
      passed: false,
      message: "Schematic projection unavailable; cannot verify net wiring.",
      affectedIds: [...required],
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

function checkNoDanglingPower(
  erc: ErcReport | null,
  intentExists: boolean,
): CheckResult {
  if (!erc) {
    // F3: ERC unavailable while a build intent exists must FAIL — verification
    // unavailable is not a pass. Absent any intent there is nothing to verify.
    return {
      id: "no_dangling_power",
      passed: !intentExists,
      message: intentExists
        ? "ERC unavailable; cannot verify dangling power pins."
        : "ERC unavailable; skipping dangling-power check.",
      affectedIds: [],
    };
  }
  const affected = anchorIds(erc, isDanglingPower);
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

function checkErcClean(
  erc: ErcReport | null,
  intentExists: boolean,
): CheckResult {
  if (!erc) {
    // F3: ERC unavailable with an intent present is a fail, not a pass.
    return {
      id: "erc_clean",
      passed: !intentExists,
      message: intentExists
        ? "ERC unavailable; cannot verify ERC cleanliness."
        : "ERC unavailable; skipping ERC-clean check.",
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
 * Run the Definition-of-Done verifier (P4b). Reads a SINGLE same-revision
 * snapshot of the schematic projection + ERC via `getProjectionAndErc` (no
 * racing two SDK reads), then applies four hard-fail checks: every BOM item
 * placed, every required net wired, no dangling power/gnd, ERC errors == 0.
 * When a build intent exists but the snapshot/ERC is unavailable, the dependent
 * checks fail (verification-unavailable is never a pass).
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
  const intentExists = (intent?.items.length ?? 0) > 0;

  // C2: one same-revision snapshot of projection + ERC (never two interleaved
  // reads). `null` means the design has no schematic projection, or the read
  // failed — either way verification is UNAVAILABLE, not a pass (F3).
  const snapshot = await input.designer
    .getProjectionAndErc(input.designId)
    .catch(() => null);
  const schematic = snapshot?.projection ?? null;
  const erc = snapshot?.erc ?? null;

  // With no build intent and no projection there is genuinely nothing to
  // verify. With an intent present, a missing snapshot must fall through so the
  // individual checks fail closed.
  if (!schematic && !intentExists) {
    return passReport("No schematic projection; nothing to verify.");
  }

  // Surface whether the last writes actually applied (informational; the checks
  // below assert on real projection state, which already reflects applied ops).
  const proposals = input.conversation.listWriteProposals(input.chatId);
  const lastFailedApply = proposals.find(
    (p) => p.status === "failed" || p.status === "partial",
  );

  const checks: CheckResult[] = [
    checkBomPlaced(intent, schematic),
    checkNetsWired(intent, schematic),
    checkNoDanglingPower(erc, intentExists),
    checkErcClean(erc, intentExists),
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
