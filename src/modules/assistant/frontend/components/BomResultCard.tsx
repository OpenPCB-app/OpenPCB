import type { ReactElement } from "react";
import { Pill } from "../../../../shared/frontend/ui/pill";
import {
  classifyComponentType,
  ledColorTone,
  type ComponentTypeInfo,
} from "./component-type";

interface ComponentHit {
  componentId: string;
  name: string;
  description: string;
  tags: string[];
  score: number;
}

export interface BomItem {
  role: string;
  requestedQuery: string;
  rewrittenQuery: string;
  quantity: number;
  value: string | null;
  attributes: Record<string, string | string[] | number | boolean>;
  selected: ComponentHit | null;
  alternatives: ComponentHit[];
  assumptions: string[];
  importSuggestions: Array<{
    label: string;
    reason: string;
    availability: "not-installed";
  }>;
  status: "resolved" | "generic-resolved" | "missing";
}

export interface BomResultPayload {
  goal: string | null;
  defaults: {
    supplyVoltage: string;
    blinkRate: string;
    packagePreference: string;
  };
  items: BomItem[];
  readyForPlacement: boolean;
  assumptions: string[];
  nextAction: string;
}

/** One displayed table row — same-value parts collapsed into a single line. */
interface BomGroup {
  type: ComponentTypeInfo;
  refdes: string[];
  quantity: number;
  value: string | null;
  sourceName: string | null;
  /** Show a package chip only for passives/LEDs where it's meaningful. */
  showPackage: boolean;
}

/** Group items by (type, value, source); join refdes and sum quantity. */
export function groupBomItems(items: BomItem[]): BomGroup[] {
  const groups = new Map<string, BomGroup>();
  for (const item of items) {
    const type = classifyComponentType(
      item.selected?.name,
      item.value,
      item.role,
    );
    const sourceName = item.selected ? `core:${item.selected.name}` : null;
    const key = `${type.key}|${item.value ?? ""}|${sourceName ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.refdes.push(item.role);
      existing.quantity += item.quantity;
    } else {
      groups.set(key, {
        type,
        refdes: [item.role],
        quantity: item.quantity,
        value: item.value,
        sourceName,
        showPackage: [
          "led",
          "resistor",
          "capacitor",
          "inductor",
          "diode",
        ].includes(type.key),
      });
    }
  }
  return [...groups.values()];
}

export function BomResultCard({
  data,
  onSendPrompt,
}: {
  data: BomResultPayload;
  compact?: boolean;
  /** Sends a follow-up prompt that makes the model dispatch a Propose-level
   *  command (create design / place components) — never a direct mutation. */
  onSendPrompt?: (prompt: string) => void;
}): ReactElement {
  const sourced = data.items.filter((i) => i.status === "resolved").length;
  const groups = groupBomItems(data.items);
  const pkg = data.defaults.packagePreference;
  return (
    <section className="max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-violet-400">
            BOM proposal
          </div>
          <h3 className="mt-0.5 break-words font-semibold text-slate-900 dark:text-slate-100">
            {data.goal ?? "Resolved local components"}
          </h3>
        </div>
        <Pill tone={data.readyForPlacement ? "success" : "warning"}>
          {sourced}/{data.items.length} sourced
        </Pill>
      </header>

      {/* Assumed parameter chips */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 dark:border-slate-800/70 dark:bg-black/10">
        <span className="mr-0.5 text-[9px] uppercase tracking-wider text-slate-400">
          Assumed
        </span>
        <ParamChip label="Supply" value={data.defaults.supplyVoltage} />
        <ParamChip label="Blink rate" value={data.defaults.blinkRate} />
        <ParamChip label="Package" value={pkg} />
        <button
          type="button"
          disabled
          title="Adjust parameters — coming soon"
          className="ml-auto text-[11px] text-accent-text opacity-60"
        >
          Adjust
        </button>
      </div>

      {/* Reference layout: Type · Qty · Value · Source (status omitted) */}
      <div className="px-2 pb-2">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-2 py-1.5">Type</th>
              <th className="w-10 px-1 py-1.5 text-right">Qty</th>
              <th className="px-1 py-1.5">Value</th>
              <th className="w-24 px-1 py-1.5">Source</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, idx) => {
              const Icon = group.type.icon;
              const led = group.type.key === "led";
              const tone = led ? ledColorTone(group.value) : null;
              return (
                <tr
                  key={`${group.type.key}-${idx}`}
                  className="border-t border-slate-100 align-top dark:border-slate-800/70"
                >
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{group.type.label}</span>
                    </span>
                  </td>
                  <td className="px-1 py-2 text-right font-mono tabular-nums text-slate-500">
                    {group.quantity}×
                  </td>
                  <td className="min-w-0 px-1 py-2">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        {group.refdes.join(", ")}
                      </span>
                      {led && tone ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] ${tone.bg} ${tone.text}`}
                        >
                          {group.value}
                        </span>
                      ) : group.value ? (
                        <span className="text-slate-500 dark:text-slate-300">
                          {group.value}
                        </span>
                      ) : null}
                      {group.showPackage && pkg ? (
                        <span className="font-mono text-[10px] text-slate-400">
                          {pkg}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="min-w-0 px-1 py-2">
                    {group.sourceName ? (
                      <span className="truncate font-mono text-[11px] text-accent-text">
                        {group.sourceName}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Actions — command-based CTAs (Propose level). The model's `nextAction`
          is planning guidance for the model, not user-facing copy → not shown. */}
      {onSendPrompt ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() =>
              onSendPrompt("Create a new design and place these components.")
            }
            className="rounded-control border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Create design
          </button>
          <button
            type="button"
            disabled={!data.readyForPlacement}
            title={
              data.readyForPlacement
                ? undefined
                : "Resolve the missing parts first"
            }
            onClick={() =>
              onSendPrompt("Place these components on the schematic.")
            }
            className="rounded-control bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Place components
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ParamChip({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-800">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">
        {value}
      </span>
    </span>
  );
}
