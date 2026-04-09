import { ThemeToggle } from "@/components/ThemeToggle";

export function GeneralPanel() {
  return (
    <div className="space-y-8 pb-24">
      <p className="text-sm text-slate-600 dark:text-slate-300">General Settings</p>

      <div className="space-y-3">
        <ThemeToggle />
      </div>
    </div>
  );
}
