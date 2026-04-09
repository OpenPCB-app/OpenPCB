import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/providers/ThemeProvider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle({
  className,
}: {
  className?: string;
}): React.ReactElement {
  const { preference, mode, isReady, setPreference } = useTheme();

  const handleChange = React.useCallback(
    (nextPreference: ThemePreference) => {
      void setPreference(nextPreference);
    },
    [setPreference],
  );

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900",
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
            disabled={!isReady}
            onClick={() => handleChange(value)}
            className={cn(
              "flex min-w-[3.5rem] flex-col items-center justify-center rounded-sm border border-transparent px-3 py-1 text-xs font-medium transition-colors",
              isReady ? "cursor-pointer" : "cursor-default",
              isActive
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-transparent text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <span>{label}</span>
            {showMode ? (
              <span className="mt-0.5 text-[0.625rem] leading-4 opacity-80">
                {mode === "dark" ? "Dark" : "Light"}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
