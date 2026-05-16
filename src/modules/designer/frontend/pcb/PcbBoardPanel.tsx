import type { ReactElement } from "react";
import type { usePcbWorkspace } from "./usePcbWorkspace";

type PcbWorkspace = ReturnType<typeof usePcbWorkspace>;

interface PcbBoardPanelProps {
  workspace: PcbWorkspace;
  widthText: string;
  setWidthText: (value: string) => void;
  heightText: string;
  setHeightText: (value: string) => void;
  widthMm: number;
  heightMm: number;
  valid: boolean;
}

function NumberInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
      {props.label}
      <input
        value={props.value}
        disabled={props.disabled}
        inputMode="decimal"
        onChange={(event) => props.onChange(event.target.value)}
        className="h-8 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm font-normal text-slate-100 outline-none focus:border-violet-500 disabled:opacity-50"
      />
    </label>
  );
}

export function PcbBoardPanel({
  workspace,
  widthText,
  setWidthText,
  heightText,
  setHeightText,
  widthMm,
  heightMm,
  valid,
}: PcbBoardPanelProps): ReactElement {
  return (
    <div className="flex flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500">Fixed rectangle, mm</p>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          2-layer
        </span>
      </div>

      <div className="flex items-end gap-2">
        <NumberInput
          label="Width mm"
          value={widthText}
          onChange={setWidthText}
          disabled={workspace.saving}
        />
        <NumberInput
          label="Height mm"
          value={heightText}
          onChange={setHeightText}
          disabled={workspace.saving}
        />
        <button
          type="button"
          disabled={!valid || workspace.saving || !workspace.projection}
          onClick={() => void workspace.updateBoardSize(widthMm, heightMm)}
          className="h-8 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {workspace.saving ? "Saving" : "Apply"}
        </button>
      </div>

      {workspace.error ? (
        <p className="mt-3 rounded border border-red-900 bg-red-950/70 px-2 py-1.5 text-xs text-red-200">
          {workspace.error}
        </p>
      ) : null}

      {workspace.projection?.warnings.length ? (
        <ul className="mt-3 max-h-40 list-disc space-y-0.5 overflow-y-auto rounded border border-amber-900 bg-amber-950/50 px-4 py-1.5 text-xs text-amber-200">
          {workspace.projection.warnings.map((warning, i) => (
            <li key={i} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
