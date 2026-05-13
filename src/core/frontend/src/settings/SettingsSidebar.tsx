import { TabsList, TabsTrigger } from "@shared/frontend/ui/tabs";
import type { SettingsNavItem } from "./nav";

interface SettingsSidebarProps {
  items: SettingsNavItem[];
}

export function SettingsSidebar({ items }: SettingsSidebarProps) {
  return (
    <aside className="h-full w-72 flex-shrink-0 border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <TabsList className="!flex !h-auto !w-full !flex-col !items-stretch !justify-start !gap-2 !rounded-none !bg-transparent !p-0">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="!flex !w-full !justify-start gap-3 rounded-xl px-4 py-3 text-base"
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </aside>
  );
}
