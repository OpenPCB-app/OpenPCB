import * as React from "react";
import { Input, type InputProps } from "./input";
import {
  clampNumber,
  formatNumberValue,
  parseNumberDraft,
  stepNumber,
} from "./number-value";

export {
  clampNumber,
  formatNumberValue,
  parseNumberDraft,
  roundTo,
  stepNumber,
  type NumberDraft,
} from "./number-value";

interface NumberInputBaseProps
  extends Omit<
    InputProps,
    | "value"
    | "defaultValue"
    | "onChange"
    | "type"
    | "inputMode"
    | "min"
    | "max"
    | "step"
    | "trailing"
  > {
  value: number | null;
  /** Each keystroke: the raw draft and its parse (null when empty/invalid). */
  onDraftChange?: (draft: string, parsed: number | null) => void;
  min?: number;
  max?: number;
  /** Arrow Up/Down step (Shift ×10). Default 1. */
  step?: number;
  /** Decimals kept on commit and shown. */
  precision?: number;
  /** Unit suffix shown inside the field (and accepted when typed). */
  unit?: string;
  /** Default true. */
  allowNegative?: boolean;
}

export type NumberInputProps = NumberInputBaseProps &
  (
    | { allowEmpty?: false; onCommit: (value: number) => void }
    | { allowEmpty: true; onCommit: (value: number | null) => void }
  );

/**
 * Numeric text field: accepts a locale comma, commits on Enter/blur (clamped
 * to min/max, rounded to precision), Esc reverts, Arrow Up/Down step. An
 * unparseable draft shows the invalid state and never commits; blurring it
 * reverts to the last value.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (props, ref) => {
    const {
      value,
      onCommit,
      allowEmpty,
      onDraftChange,
      min,
      max,
      step = 1,
      precision,
      unit,
      allowNegative = true,
      invalid: invalidProp = false,
      onKeyDown,
      onBlur,
      onFocus,
      ...inputProps
    } = props;
    const shown = formatNumberValue(value, precision);
    const [draft, setDraft] = React.useState(shown);
    const [dirty, setDirty] = React.useState(false);

    React.useEffect(() => {
      if (!dirty) setDraft(shown);
    }, [shown, dirty]);

    const parsed = parseNumberDraft(draft, { allowNegative, unit });
    const draftInvalid =
      parsed.kind === "invalid" || (parsed.kind === "empty" && !allowEmpty);

    const updateDraft = (next: string) => {
      setDraft(next);
      setDirty(true);
      const result = parseNumberDraft(next, { allowNegative, unit });
      onDraftChange?.(next, result.kind === "value" ? result.value : null);
    };

    const revert = () => {
      setDraft(shown);
      setDirty(false);
    };

    /** Returns false when the draft cannot be committed. */
    const commit = (): boolean => {
      if (!dirty) return true;
      if (parsed.kind === "invalid") return false;
      if (parsed.kind === "empty") {
        if (!allowEmpty) return false;
        setDirty(false);
        if (value !== null) (onCommit as (v: number | null) => void)(null);
        return true;
      }
      const next = clampNumber(parsed.value, { min, max, precision });
      setDraft(formatNumberValue(next, precision));
      setDirty(false);
      if (next !== value) onCommit(next);
      return true;
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Enter") {
        // A clean field lets Enter through so an enclosing form still submits.
        if (!dirty) return;
        event.preventDefault();
        commit();
      } else if (event.key === "Escape" && dirty) {
        event.preventDefault();
        revert();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const base = parsed.kind === "value" ? parsed.value : (value ?? min ?? 0);
        const next = stepNumber(base, event.key === "ArrowUp" ? 1 : -1, {
          step,
          large: event.shiftKey,
          min,
          max,
          precision,
        });
        updateDraft(formatNumberValue(next, precision));
      }
    };

    return (
      <Input
        ref={ref}
        {...inputProps}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        // A dirty draft owns Escape: the enclosing kit Dialog yields it so the
        // first Esc reverts the field and only the second closes the dialog.
        data-escape-owner={dirty ? "true" : undefined}
        invalid={invalidProp || (dirty && draftInvalid)}
        trailing={unit}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          onFocus?.(event);
          event.currentTarget.select();
        }}
        onBlur={(event) => {
          if (!commit()) revert();
          onBlur?.(event);
        }}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";
