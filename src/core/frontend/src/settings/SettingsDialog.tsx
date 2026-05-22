import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@shared/frontend/ui/tabs";
import { SettingsSidebar } from "./SettingsSidebar";
import { settingsNavItems, type SettingsNavItem } from "./nav";
import { GeneralPanel } from "./panels/GeneralPanel";
import { AboutPanel } from "./panels/AboutPanel";
import { AssistantPanel } from "./panels/AssistantPanel";
import { AccountPanel } from "./panels/AccountPanel";
import { LibrariesPanel } from "./panels/LibrariesPanel";
import { PrivacyPanel } from "./panels/PrivacyPanel";
import { useAuth } from "@/cloud/AuthProvider";
import { useBootstrap } from "@/providers/BootstrapProvider";

type SettingsPanelId = SettingsNavItem["id"];

type SettingsDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  initialTab?: SettingsPanelId;
};

const panelComponents: Record<SettingsPanelId, () => React.JSX.Element | null> =
  {
    general: GeneralPanel,
    account: AccountPanel,
    libraries: LibrariesPanel,
    assistant: AssistantPanel,
    privacy: PrivacyPanel,
    about: AboutPanel,
  };

export function SettingsDialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  initialTab,
}: SettingsDialogProps) {
  const { enabled: cloudEnabled } = useAuth();
  const { moduleRegistry } = useBootstrap();
  const items = React.useMemo(
    () =>
      [...settingsNavItems]
        .filter((item) => !item.requiresCloud || cloudEnabled)
        .filter(
          (item) =>
            !item.requiresModule ||
            moduleRegistry?.loadedModules.includes(item.requiresModule),
        )
        .sort((a, b) => a.order - b.order),
    [cloudEnabled, moduleRegistry?.loadedModules],
  );

  const defaultTab = (initialTab ??
    items[0]?.id ??
    "general") as SettingsPanelId;
  const [activeTab, setActiveTab] = React.useState<SettingsPanelId>(defaultTab);

  React.useEffect(() => {
    if (initialTab && items.some((item) => item.id === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab, items]);

  React.useEffect(() => {
    if (!items.some((item) => item.id === activeTab)) {
      setActiveTab((items[0]?.id ?? "general") as SettingsPanelId);
    }
  }, [activeTab, items]);

  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="max-w-5xl p-0"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsPanelId)}
          orientation="vertical"
          className="h-[70vh] w-full"
        >
          <div className="grid h-full min-h-0 grid-cols-[18rem_1fr]">
            <SettingsSidebar items={items} />
            <div className="flex min-h-0 flex-col">
              <ScrollArea className="h-full w-full">
                <div className="min-h-full w-full px-6 py-8">
                  {items.map((item) => {
                    const Panel = panelComponents[item.id];
                    return (
                      <TabsContent
                        key={item.id}
                        value={item.id}
                        className="mt-0 h-full w-full"
                      >
                        <Panel />
                      </TabsContent>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
