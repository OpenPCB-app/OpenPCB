import { TabsList, TabsTrigger } from "@/components/ui/tabs.tsx"

import { type SettingsNavItem } from "./nav.ts"

interface SettingsSidebarProps {
  items: SettingsNavItem[]
}

export function SettingsSidebar({ items }: SettingsSidebarProps) {

  
  return (
    <aside className="h-full w-72 flex-shrink-0 flex flex-col gap-4 p-4 overflow-y-auto">

        <TabsList className="w-full">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </TabsTrigger>
            )
          })}
        </TabsList>
      
    </aside>
  )
}
