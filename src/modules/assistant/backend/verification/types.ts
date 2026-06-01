export type DodCheckId =
  | "bom_placed"
  | "nets_wired"
  | "no_dangling_power"
  | "erc_clean";

export interface CheckResult {
  id: DodCheckId;
  passed: boolean;
  message: string; // actionable, includes refs/pins/nets
  affectedIds: string[];
}

export type DodStatus = "pass" | "partial";

export interface DeficiencyReport {
  status: DodStatus;
  checks: CheckResult[];
  failing: DodCheckId[];
}

export interface BuildIntentItem {
  role: string;
  componentId: string;
  quantity: number;
  value?: string;
  requiredNets: string[];
}

export interface BuildIntent {
  chatId: string;
  taskId: string;
  goal: string;
  items: BuildIntentItem[];
}

export interface DesignContextSummary {
  designId: string;
  name: string;
  schematic: {
    componentCount: number;
    netCount: number;
    unplaced: string[];
    openNets: string[];
  };
  pcb: { placed: number; unrouted: number };
}
