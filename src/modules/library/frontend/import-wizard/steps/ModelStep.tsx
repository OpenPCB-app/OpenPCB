import type { ReactElement } from "react";
import { Box } from "lucide-react";

export function ModelStep(): ReactElement {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-2 text-center">
          <Box className="h-9 w-9 text-slate-300 dark:text-slate-600" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            3D Model
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This step is a roadmap placeholder for future model import.
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            You can continue to Metadata now.
          </p>
        </div>
      </div>
    </div>
  );
}
