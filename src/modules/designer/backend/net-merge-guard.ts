import type {
  DesignerCommand,
  DesignerDerivedNet,
  DesignerPlaceGndPortCommand,
  DesignerPlaceNetPortalCommand,
  DesignerPlacePwrPortCommand,
  DesignerUpsertLabelCommand,
} from "../../../sdks";

export interface NetMergeSummary {
  /** null = auto-named (`Net_<n>`), i.e. no label / port named it. */
  name: string | null;
  pinCount: number;
}

const AUTO_NET_NAME = /^Net_\d+$/;

function memberIds(net: DesignerDerivedNet): string[] {
  return [
    ...net.pinIds,
    ...net.wireIds,
    ...net.labelIds,
    ...net.primitiveIds,
  ];
}

function isNamed(net: DesignerDerivedNet): boolean {
  return !AUTO_NET_NAME.test(net.name);
}

/**
 * Fusing two named nets, or two anonymous multi-pin nets, changes electrical
 * identity behind the user's back. Fusing ONE named net with anonymous ones is
 * ordinary naming (a GND port dropped on a 2-pin net) and stays silent.
 */
function needsConfirm(merged: readonly DesignerDerivedNet[]): boolean {
  const named = merged.filter(isNamed).length;
  const anonymousMultiPin = merged.filter(
    (net) => !isNamed(net) && net.pinIds.length >= 2,
  ).length;
  return named >= 2 || anonymousMultiPin >= 2;
}

function significant(net: DesignerDerivedNet): boolean {
  return isNamed(net) || net.pinIds.length >= 2;
}

/**
 * Detects a label/port edit that fuses 2+ previously distinct nets. Net ids
 * are union-find roots and change between derivations, so BEFORE nets are
 * matched to AFTER nets through their (stable, unique) member entity ids.
 * Only "significant" BEFORE nets count (named, or >= 2 pins): naming a bare
 * stub or a lone pin never asks for confirmation.
 */
export function detectNetMerge(
  before: DesignerDerivedNet[],
  after: DesignerDerivedNet[],
): { nets: NetMergeSummary[] } | null {
  const afterByMember = new Map<string, DesignerDerivedNet>();
  for (const net of after) {
    for (const id of memberIds(net)) afterByMember.set(id, net);
  }
  const groups = new Map<DesignerDerivedNet, DesignerDerivedNet[]>();
  for (const net of before) {
    const targets = new Set<DesignerDerivedNet>();
    for (const id of memberIds(net)) {
      const target = afterByMember.get(id);
      if (target) targets.add(target);
    }
    for (const target of targets) {
      const list = groups.get(target) ?? [];
      list.push(net);
      groups.set(target, list);
    }
  }
  for (const merged of groups.values()) {
    if (!needsConfirm(merged)) continue;
    const sig = merged.filter(significant);
    return {
      nets: sig.map((net) => ({
        name: isNamed(net) ? net.name : null,
        pinCount: net.pinIds.length,
      })),
    };
  }
  return null;
}

export class NetMergeRefusal extends Error {
  constructor(readonly nets: NetMergeSummary[]) {
    super("NET_MERGE_REQUIRES_CONFIRM");
  }
}

export function isNetMergeGatedCommand(
  command: DesignerCommand,
): command is
  | DesignerUpsertLabelCommand
  | DesignerPlaceGndPortCommand
  | DesignerPlacePwrPortCommand
  | DesignerPlaceNetPortalCommand {
  return (
    command.type === "upsert_label" ||
    command.type === "place_gnd_port" ||
    command.type === "place_pwr_port" ||
    command.type === "place_net_portal"
  );
}

/**
 * Whether a dispatch must be net-merge-checked: a gated command without
 * `confirmMerge: true`, or a batch carrying at least one such step.
 */
export function isNetMergeGatedDispatch(command: DesignerCommand): boolean {
  if (command.type === "batch_commands") {
    return command.commands.some(
      (step) => isNetMergeGatedCommand(step) && step.confirmMerge !== true,
    );
  }
  return isNetMergeGatedCommand(command) && command.confirmMerge !== true;
}
