import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemePreference } from "./ThemeProvider";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle({ className }: { className?: string }): React.ReactElement {
  const { preference, mode, isReady, setPreference } = useTheme();

  const handleChange = React.useCallback(
    (nextPreference: ThemePreference) => {
      void setPreference(nextPreference);
    },
    [setPreference]
  );

  return (
    <div
      role="radiogroup"
      aria-label="Theme preference"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-sm",
        className,
      )}
    >
      {OPTIONS.map(({ value, label }) => {
        const isActive = preference === value;
        const showMode = value === "system" && isActive;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={!isReady}
            onClick={() => handleChange(value)}
            className={cn(
              "flex min-w-[3.5rem] flex-col items-center justify-center rounded-sm border px-3 py-1 text-[0.75rem] font-medium tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent/50 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-60",
              isReady ? "cursor-pointer" : "cursor-default",
              isActive
                ? "border-transparent bg-accent text-accent-contrast"
                : "border-transparent bg-transparent text-text-primary hover:bg-surface-muted",
            )}
          >
            <span className="text-xs font-medium tracking-wide">{label}</span>
            {showMode ? (
              <span className="mt-0.5 text-[0.625rem] leading-4 text-accent-contrast">
                {mode === "dark" ? "Dark" : "Light"}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
