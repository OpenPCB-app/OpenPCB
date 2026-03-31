import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSchematicStore } from "@/stores/schematic-store";
import { PALETTE_SYMBOL_KIND_MIME } from "../symbol-library";
import type { SymbolKind } from "../types";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

interface ComponentItem {
  kind: SymbolKind;
  label: string;
  prefix: string;
}

interface ComponentCategory {
  name: string;
  items: ComponentItem[];
}

const CATEGORIES: ComponentCategory[] = [
  {
    name: "Passive",
    items: [
      { kind: "resistor", label: "Resistor", prefix: "R" },
      { kind: "capacitor", label: "Capacitor", prefix: "C" },
      { kind: "inductor", label: "Inductor", prefix: "L" },
      { kind: "diode", label: "Diode", prefix: "D" },
      { kind: "led", label: "LED", prefix: "D" },
    ],
  },
  {
    name: "Power",
    items: [
      { kind: "gnd", label: "GND", prefix: "" },
      { kind: "vcc_3v3", label: "VCC 3.3V", prefix: "" },
      { kind: "vcc_5v", label: "VCC 5V", prefix: "" },
      { kind: "vcc_12v", label: "VCC 12V", prefix: "" },
    ],
  },
  {
    name: "Active",
    items: [
      { kind: "npn", label: "NPN Transistor", prefix: "Q" },
      { kind: "pnp", label: "PNP Transistor", prefix: "Q" },
      { kind: "nmos", label: "N-MOSFET", prefix: "Q" },
      { kind: "pmos", label: "P-MOSFET", prefix: "Q" },
      { kind: "opamp", label: "Op-Amp", prefix: "U" },
      { kind: "generic_ic", label: "Generic IC", prefix: "U" },
    ],
  },
  {
    name: "Connectors",
    items: [{ kind: "connector", label: "Connector", prefix: "J" }],
  },
];

interface ComponentPaletteProps {
  controller?: SchematicInteractionController;
}

export function ComponentPalette({ controller }: ComponentPaletteProps) {
  const [search, setSearch] = useState("");
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set(CATEGORIES.map((c) => c.name)),
  );
  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const session = useSchematicStore((s) => s.session);
  const placingSymbolKind = session?.type === "placement" ? session.symbolKind : null;

  const filteredCategories = CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter(
      (item) =>
        item.label.toLowerCase().includes(search.toLowerCase()) ||
        item.kind.toLowerCase().includes(search.toLowerCase()),
    ),
  })).filter((cat) => cat.items.length > 0);

  const toggleCategory = (name: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleBeginPlacement = (kind: SymbolKind) => {
    if (placingSymbolKind === kind) {
      interactionController.cancelSession();
      return;
    }

    interactionController.beginPlacement(kind);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Categories */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {filteredCategories.map((category) => (
            <Collapsible
              key={category.name}
              open={openCategories.has(category.name)}
              onOpenChange={() => toggleCategory(category.name)}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    openCategories.has(category.name) && "rotate-90",
                  )}
                />
                {category.name}
                <span className="ml-auto text-[10px] opacity-50">
                  {category.items.length}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-2 flex flex-col gap-0.5 py-0.5">
                  {category.items.map((item) => (
                    <Button
                      key={item.kind}
                      variant={
                        placingSymbolKind === item.kind ? "default" : "ghost"
                      }
                      size="sm"
                      draggable
                      className="h-6 justify-start gap-2 px-2 text-xs"
                      onClick={() => handleBeginPlacement(item.kind)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(PALETTE_SYMBOL_KIND_MIME, item.kind);
                        event.dataTransfer.setData("text/plain", item.kind);
                        interactionController.beginPlacement(item.kind);
                      }}
                      onDragEnd={() => interactionController.cancelSession()}
                    >
                      <span className="w-4 text-center text-[10px] font-mono text-muted-foreground">
                        {item.prefix}
                      </span>
                      {item.label}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
