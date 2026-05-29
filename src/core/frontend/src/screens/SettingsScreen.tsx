import { useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useNavigationStore } from "../stores/navigation-store";
import { useBootstrap } from "../providers/BootstrapProvider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsSidebar } from "../settings/SettingsSidebar";
import {
  SETTINGS_NAV,
  type SettingsTab,
} from "../settings/settings-nav.config";
import { GeneralPanel } from "../settings/panels/GeneralPanel";
import { AccountPanel } from "../settings/panels/AccountPanel";
import { LibrariesPanel } from "../settings/panels/LibrariesPanel";
import { AssistantPanel } from "../settings/panels/AssistantPanel";
import { PrivacyPanel } from "../settings/panels/PrivacyPanel";
import { AboutPanel } from "../settings/panels/AboutPanel";

const panelComponents: Record<SettingsTab, () => React.JSX.Element | null> = {
  general: GeneralPanel,
  account: AccountPanel,
  libraries: LibrariesPanel,
  assistant: AssistantPanel,
  privacy: PrivacyPanel,
  about: AboutPanel,
};

export function SettingsScreen({ tab }: { tab: SettingsTab }) {
  const closeSettings = useNavigationStore((state) => state.closeSettings);
  const setSettingsTab = useNavigationStore((state) => state.setSettingsTab);
  const { moduleRegistry } = useBootstrap();
  const [query, setQuery] = useState("");

  const visibleTabs = useMemo<SettingsTab[]>(() => {
    const loaded = moduleRegistry?.loadedModules ?? [];
    return SETTINGS_NAV.flatMap((group) => group.items)
      .filter(
        (item) => !item.requiresModule || loaded.includes(item.requiresModule),
      )
      .map((item) => item.id);
  }, [moduleRegistry?.loadedModules]);

  // Guard: if the active tab is gated out, fall back to the first visible tab.
  const activeTab: SettingsTab = visibleTabs.includes(tab)
    ? tab
    : (visibleTabs[0] ?? "general");
  const Panel = panelComponents[activeTab];

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-slate-950">
      <header className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-slate-200 px-3 dark:border-slate-800">
        <button
          type="button"
          aria-label="Back"
          onClick={closeSettings}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <h1 className="text-base font-medium text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <div className="flex-1" />
        <label className="relative block w-[200px]">
          <span className="sr-only">Search settings</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            strokeWidth={1.8}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <SettingsSidebar
          activeTab={activeTab}
          onSelect={setSettingsTab}
          visibleTabs={visibleTabs}
          query={query}
        />
        <ScrollArea className="h-full min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[640px] px-[22px] py-[18px]">
            <Panel />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
