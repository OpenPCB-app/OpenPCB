import type {
  DesignerCommand,
  DesignerDerivedNet,
} from "../../../sdks";

export interface NetMergeSummary {
  /** null = automatically named; legacy reports infer that from `Net_<n>`. */
  name: string | null;
  pinCount: number;
}

const AUTO_NET_NAME = /^Net_\d+$/;
const NAMING_COMMANDS = ["upsert_label", "place_gnd_port", "place_pwr_port", "place_net_portal", "update_primitive_text"] as const;
const GEOMETRY_COMMANDS = ["place_part", "duplicate_part", "move_part", "rotate_part", "mirror_part", "move_primitive",
  "rotate_primitive", "update_wire_geometry", "auto_arrange_schematic"] as const;
export type NetMergePolicy = "naming" | "geometry";
type GatedCommand = Extract<DesignerCommand, { type: typeof NAMING_COMMANDS[number] | typeof GEOMETRY_COMMANDS[number] }>;

function memberIds(net: DesignerDerivedNet): string[] {
  return [
    ...net.pinIds,
    ...net.wireIds,
    ...net.labelIds,
    ...net.primitiveIds,
  ];
}

function isNamed(net: DesignerDerivedNet): boolean {
  return net.autoNamed === undefined ? !AUTO_NET_NAME.test(net.name) : !net.autoNamed;
}

/**
 * Fusing two named nets, or two anonymous multi-pin nets, changes electrical
 * identity behind the user's back. Fusing ONE named net with anonymous ones is
 * ordinary naming (a GND port dropped on a 2-pin net) and stays silent.
 */
function needsConfirm(merged: readonly DesignerDerivedNet[], policy: NetMergePolicy): boolean {
  const named = merged.filter(isNamed).length;
  const anonymousMultiPin = merged.filter(
    (net) => !isNamed(net) && net.pinIds.length >= 2,
  ).length;
  return named >= 2 || (policy === "naming" && anonymousMultiPin >= 2);
}

function significant(net: DesignerDerivedNet): boolean {
  return isNamed(net) || net.pinIds.length >= 2;
}

/**
 * Detects an edit that fuses 2+ previously distinct nets. BEFORE nets
 * are matched through stable member ids because legacy roots can change and
 * durable merges preserve at most one predecessor id.
 * Only "significant" BEFORE nets count (named, or >= 2 pins): naming a bare
 * stub or a lone pin never asks for confirmation.
 */
export function detectNetMerge(
  before: DesignerDerivedNet[],
  after: DesignerDerivedNet[],
  policy: NetMergePolicy = "naming",
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
    if (!needsConfirm(merged, policy)) continue;
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
): command is GatedCommand {
  return NAMING_COMMANDS.some((type) => command.type === type) || GEOMETRY_COMMANDS.some((type) => command.type === type);
}

/** Mixed batches retain the broader naming policy because the gate compares their final topology. */
export function getNetMergePolicy(command: DesignerCommand): NetMergePolicy | null {
  if (command.type === "batch_commands") {
    const policies = command.commands.map(getNetMergePolicy);
    return policies.includes("naming") ? "naming" : policies.includes("geometry") ? "geometry" : null;
  }
  if (!isNetMergeGatedCommand(command) || command.confirmMerge === true) return null;
  return NAMING_COMMANDS.some((type) => command.type === type) ? "naming" : "geometry";
}

export function isNetMergeGatedDispatch(command: DesignerCommand): boolean {
  return getNetMergePolicy(command) !== null;
}
