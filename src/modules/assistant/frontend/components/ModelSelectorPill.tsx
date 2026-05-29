import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown, Settings } from "lucide-react";
import type {
  AssistantPromptPreset,
  AssistantPromptPresetId,
  AssistantProviderConfig,
  AssistantProviderModel,
} from "../../../../sdks/assistant";

const PRESET_SHORT: Record<AssistantPromptPresetId, string> = {
  "strict-grounded": "Strict",
  "friendly-tutorial": "Tutorial",
  "minimal-concise": "Concise",
};

/** Capability status dot color (mirrors ProviderCapabilityBadge heuristics). */
function dotColor(provider: AssistantProviderConfig | null): {
  cls: string;
  title: string;
} {
  if (!provider) return { cls: "bg-slate-500", title: "No provider" };
  if (!provider.enabled)
    return { cls: "bg-slate-500", title: `${provider.label} disabled` };
  if (provider.kind === "openai" && !provider.hasApiKey)
    return { cls: "bg-red-500", title: "API key required" };
  const caps = provider.capabilities;
  if (caps)
    return caps.toolCalling && caps.streaming
      ? { cls: "bg-emerald-500", title: "Tools + streaming OK" }
      : { cls: "bg-amber-500", title: caps.warning ?? "Chat-only" };
  return { cls: "bg-slate-400", title: "Capabilities not probed" };
}

function shortModel(model: string): string {
  // Drop long distill suffixes for the pill; full name shown in the popover.
  return model.length > 22 ? `${model.slice(0, 22)}…` : model;
}

export interface ModelSelectorPillProps {
  providers: AssistantProviderConfig[];
  providerId: string;
  onProviderChange: (id: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  models: AssistantProviderModel[];
  presets: AssistantPromptPreset[];
  promptPresetId: AssistantPromptPresetId;
  onPresetChange: (id: AssistantPromptPresetId) => void;
  selectedProvider: AssistantProviderConfig | null;
  align?: "left" | "right";
  onOpenSettings?: () => void;
}

/**
 * Single control replacing the three stacked topbar dropdowns (preset ·
 * provider · model · status dot). Shows a compact status pill; opens a popover
 * with the full provider / model / preset selectors.
 */
export function ModelSelectorPill({
  providers,
  providerId,
  onProviderChange,
  model,
  onModelChange,
  models,
  presets,
  promptPresetId,
  onPresetChange,
  selectedProvider,
  align = "right",
  onOpenSettings,
}: ModelSelectorPillProps): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const dot = dotColor(selectedProvider);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 max-w-[260px] items-center gap-1.5 rounded-control border border-slate-300 bg-white px-2.5 text-xs text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
        title={dot.title}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dot.cls} shadow-[0_0_6px_currentColor]`}
        />
        <span className="truncate font-medium text-slate-700 dark:text-slate-200">
          {shortModel(model)}
        </span>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {PRESET_SHORT[promptPresetId]}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${align === "right" ? "right-0" : "left-0"}`}
        >
          <label className="block text-[10px] uppercase tracking-wide text-slate-500">
            Provider
          </label>
          <select
            value={providerId}
            onChange={(e) => {
              const provider = providers.find((p) => p.id === e.target.value);
              onProviderChange(e.target.value);
              if (provider) onModelChange(provider.defaultModel);
            }}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {providers
              .filter((p) => p.enabled)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </select>

          <label className="mt-2.5 block text-[10px] uppercase tracking-wide text-slate-500">
            Model
          </label>
          {models.length > 0 ? (
            <select
              value={
                models.some((m) => m.modelId === model)
                  ? model
                  : (models[0]?.modelId ?? "")
              }
              onChange={(e) => onModelChange(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName ?? m.modelId}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            />
          )}

          <label className="mt-2.5 block text-[10px] uppercase tracking-wide text-slate-500">
            Prompt preset
          </label>
          <select
            value={promptPresetId}
            onChange={(e) =>
              onPresetChange(e.target.value as AssistantPromptPresetId)
            }
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {(presets.length > 0
              ? presets.map((p) => ({ id: p.id, label: p.label }))
              : (Object.keys(PRESET_SHORT) as AssistantPromptPresetId[]).map(
                  (id) => ({ id, label: id }),
                )
            ).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-slate-300 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Settings className="h-3 w-3" /> Configure providers
          </button>
        </div>
      ) : null}
    </div>
  );
}
