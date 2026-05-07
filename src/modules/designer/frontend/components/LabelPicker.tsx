import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

export interface LabelPickerProps {
  title: string;
  subtitle?: string;
  presets?: readonly string[];
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onPick: (value: string) => void;
  onCancel: () => void;
}

export function LabelPicker({
  title,
  subtitle,
  presets,
  placeholder,
  initialValue = "",
  submitLabel = "OK",
  onPick,
  onCancel,
}: LabelPickerProps): ReactElement {
  const [custom, setCustom] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submitCustom = () => {
    const trimmed = custom.trim();
    if (trimmed.length > 0) onPick(trimmed);
  };

  const view = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        ) : null}

        {presets && presets.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onPick(preset)}
                className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-violet-500 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-violet-500 dark:hover:bg-violet-950 dark:hover:text-violet-300"
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCustom();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            placeholder={placeholder}
            className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={custom.trim().length === 0}
            className="inline-flex h-9 items-center rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return view;
  }
  return createPortal(view, document.body);
}

const PRESET_RAILS = ["VCC", "VDD", "+5V", "+3V3", "+12V", "-12V"] as const;

export interface PwrRailPickerProps {
  onPick: (railText: string) => void;
  onCancel: () => void;
}

export function PwrRailPicker({
  onPick,
  onCancel,
}: PwrRailPickerProps): ReactElement {
  return (
    <LabelPicker
      title="Place power port"
      subtitle="Pick a preset rail or type a custom name. The placed port will force its net's name."
      presets={PRESET_RAILS}
      placeholder="Custom rail (e.g. +1V8)"
      onPick={onPick}
      onCancel={onCancel}
    />
  );
}

export interface NetPortalPickerProps {
  onPick: (portalText: string) => void;
  onCancel: () => void;
}

export function NetPortalPicker({
  onPick,
  onCancel,
}: NetPortalPickerProps): ReactElement {
  return (
    <LabelPicker
      title="Place net portal"
      subtitle="Net portals with the same name connect across the schematic."
      placeholder="Net name (e.g. SDA, BUS_OUT)"
      submitLabel="Place"
      onPick={onPick}
      onCancel={onCancel}
    />
  );
}
