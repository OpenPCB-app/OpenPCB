import type { FrontendModuleEntry } from "../../../core/contracts/modules/frontend-entry";

const frontendModule: FrontendModuleEntry = {
  id: "knowledge",
  Space: ({ moduleLabel, namespace }) => (
    <div className="m-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <p className="font-medium">{moduleLabel}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{namespace}</p>
      <p className="mt-3">Legacy knowledge UI is not yet mounted in core frontend shell.</p>
    </div>
  ),
};

export default frontendModule;
