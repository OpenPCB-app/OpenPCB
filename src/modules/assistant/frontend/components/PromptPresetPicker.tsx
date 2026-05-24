import type { ReactElement } from "react";
import type {
  AssistantPromptPreset,
  AssistantPromptPresetId,
} from "../../../../sdks/assistant";

export function PromptPresetPicker({
  presets,
  value,
  onChange,
}: {
  presets: AssistantPromptPreset[];
  value: AssistantPromptPresetId;
  onChange: (id: AssistantPromptPresetId) => void;
}): ReactElement | null {
  if (presets.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(event) =>
        onChange(event.target.value as AssistantPromptPresetId)
      }
      className="h-8 rounded-lg border border-slate-800 bg-slate-900 px-2 text-xs text-slate-300 hover:text-white"
      title="Prompt preset"
    >
      {presets.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.label}
        </option>
      ))}
    </select>
  );
}
