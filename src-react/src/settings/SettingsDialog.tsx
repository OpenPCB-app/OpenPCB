import * as React from "react";

import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";

import { SettingsSidebar } from "./SettingsSidebar";
import { settingsNavItems, type SettingsNavItem } from "./nav";

import { GeneralPanel } from "./panels/GeneralPanel";
import { AboutPanel } from "./panels/AboutPanel";
import { ApiKeysPanel } from "./panels/ApiKeysPanel";
import { UsagePanel } from "./panels/UsagePanel";
import { McpServersPanel } from "./panels/McpServersPanel";

type SettingsPanelId = SettingsNavItem["id"];

type SettingsDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  initialTab?: SettingsPanelId;
};

const panelComponents: {
  general: () => React.JSX.Element;
  "api-keys": () => React.JSX.Element;
  "mcp-servers": () => React.JSX.Element;
  usage: () => React.JSX.Element;
  about: () => React.JSX.Element;
} = {
  general: GeneralPanel,
  "api-keys": ApiKeysPanel,
  "mcp-servers": McpServersPanel,
  usage: UsagePanel,
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

  const content = (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as SettingsPanelId)}
      orientation="vertical"
      className="flex-1 h-full w-full min-h-0"
    >
      <div className="grid grid-cols-[18rem_1fr] h-[70vh] min-h-0 min-w-0">
        <SettingsSidebar items={items} />
        <div className="relative flex-1 min-h-0">
          <div className="flex h-full flex-col min-h-0">
            <ScrollArea className="flex-1 w-full min-h-0">
              <div className="min-h-full w-full py-10">
                <div className="px-6">
                  {items.map((item) => {
                    // @ts-ignore
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
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </Tabs>
  );

  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        // Prevent closing the dialog when clicking outside the content.
        onPointerDownOutside={(e) => e.preventDefault()}
        className="max-w-5xl gap-0 overflow-hidden border-none p-0"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  );
}
