import {
  Cloud,
  History,
  LayoutDashboard,
  RefreshCw,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

const BENEFITS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: RefreshCw, label: "Sync projects across devices" },
  { icon: UploadCloud, label: "Automatic cloud backup" },
  { icon: History, label: "Full revision history & restore" },
  { icon: LayoutDashboard, label: "Web project dashboard" },
];

export function CloudValueCard() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Cloud
          className="h-[18px] w-[18px] text-violet-600 dark:text-violet-300"
          strokeWidth={1.8}
        />
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
          OpenPCB Cloud
        </h3>
        <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
          Paid
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        What an account unlocks:
      </p>

      <ul className="mt-2 space-y-2">
        {BENEFITS.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200"
          >
            <Icon
              className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
              strokeWidth={1.8}
            />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
