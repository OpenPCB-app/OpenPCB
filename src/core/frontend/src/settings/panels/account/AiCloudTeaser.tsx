import {
  CircuitBoard,
  Sparkles,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const CHIPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Wand2, label: "Zero-setup tuned models" },
  { icon: Workflow, label: "Direct JLCPCB BOM sourcing" },
  { icon: CircuitBoard, label: "EDA-trained ERC/DRC suggestions" },
];

export function AiCloudTeaser() {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900/50">
      <div className="flex items-center gap-2">
        <Sparkles
          className="h-[18px] w-[18px] text-violet-600 dark:text-violet-300"
          strokeWidth={1.8}
        />
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
          OpenPCB AI Cloud
        </h3>
        <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          Coming soon
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        A managed, optimized assistant. Today OpenPCB is free with your own
        provider key (BYOK). Cloud will add it on a subscription:
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {CHIPS.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Icon
              className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500"
              strokeWidth={1.8}
            />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
