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

type SettingsPanelId = SettingsNavItem["id"];

type SettingsDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  initialTab?: SettingsPanelId;
};

const panelComponents: Record<SettingsPanelId, () => React.JSX.Element> = {
  general: GeneralPanel,
  assistant: AssistantPanel,
  about: AboutPanel,
};

export function SettingsDialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  initialTab,
}: SettingsDialogProps) {
  const items = React.useMemo(
    () => [...settingsNavItems].sort((a, b) => a.order - b.order),
    [],
  );

  const defaultTab = (initialTab ??
    items[0]?.id ??
    "general") as SettingsPanelId;
  const [activeTab, setActiveTab] = React.useState<SettingsPanelId>(defaultTab);

  React.useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

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
