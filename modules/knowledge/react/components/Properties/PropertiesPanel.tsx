import { useCallback, useState } from "react";
import { X, Plus, Settings, Calendar, Clock, Loader2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useKnowledgeApi } from "../../hooks/useKnowledgeApi";
import { PropertyRow } from "./PropertyRow";
import type {
  Page,
  PageProperty,
  PropertyType,
  PageProperties,
} from "@modules/knowledge/shared/types";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Type,
  Hash,
  CheckSquare,
  Calendar as CalendarIcon,
  Link,
  List,
  ListChecks,
} from "lucide-react";

interface PropertiesPanelProps {
  pageId: string;
  page: Page | null;
  isLoading: boolean;
  error: string | null;
  onPageChange?: (page: Page) => void;
  onClose: () => void;
  isReadOnly?: boolean;
}

/**
 * Get default value for a property type
 */
function getDefaultValue(type: PropertyType): unknown {
  switch (type) {
    case "text":
      return "";
    case "number":
      return 0;
    case "checkbox":
      return false;
    case "date":
      return null;
    case "url":
      return "";
    case "select":
      return "";
    case "multi-select":
      return [];
    default:
      return null;
  }
}

/**
 * Get default property name for a type
 */
function getDefaultName(type: PropertyType): string {
  const names: Record<PropertyType, string> = {
    text: "Text",
    number: "Number",
    checkbox: "Checkbox",
    date: "Date",
    url: "URL",
    select: "Select",
    "multi-select": "Tags",
  };
  return names[type] || "Property";
}

export function PropertiesPanel({
  pageId,
  page,
  isLoading,
  error,
  onPageChange,
  onClose,
  isReadOnly = false,
}: PropertiesPanelProps) {
  const api = useKnowledgeApi();
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Update properties on the page
   */
  const updateProperties = useCallback(
    async (newProperties: PageProperties) => {
      if (isReadOnly) {
        return;
      }
      setIsSaving(true);
      try {
        const updated = await api.updatePageMeta(pageId, {
          properties_json: newProperties,
        });
        if (updated) {
          onPageChange?.(updated);
        }
      } catch (err) {
        console.error("Failed to update properties:", err);
      } finally {
        setIsSaving(false);
      }
    },
    [api, isReadOnly, onPageChange, pageId],
  );

  const handleAddProperty = useCallback(
    async (type: PropertyType) => {
      const properties = page?.properties_json || {};
      const id = nanoid(12);

      const newProperty: PageProperty = {
        id,
        name: getDefaultName(type),
        type,
        value: getDefaultValue(type),
        // Initialize config with options for select types
        ...(type === "select" || type === "multi-select"
          ? { config: { options: [] } }
          : {}),
      };

      await updateProperties({
        ...properties,
        [id]: newProperty,
      });
    },
    [isReadOnly, page, updateProperties],
  );

  const handleUpdateProperty = useCallback(
    async (id: string, updates: Partial<PageProperty>) => {
      const properties = page?.properties_json || {};
      const existing = properties[id];
      if (!existing) return;
      if (isReadOnly) return;

      await updateProperties({
        ...properties,
        [id]: { ...existing, ...updates },
      });
    },
    [isReadOnly, page, updateProperties],
  );

  const handleDeleteProperty = useCallback(
    async (id: string) => {
      if (isReadOnly) return;
      const properties = page?.properties_json || {};
      const { [id]: _, ...remaining } = properties;
      await updateProperties(remaining);
    },
    [isReadOnly, page, updateProperties],
  );

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-muted/5">
        <div className="flex items-center justify-between border-b p-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-6 rounded" />
        </div>
        <div className="space-y-3 p-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="flex h-full flex-col bg-muted/5">
        <div className="flex items-center justify-between p-3">
          <span className="text-sm font-medium">Properties</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">
            Failed to load properties
          </p>
        </div>
      </div>
    );
  }

  const properties = page.properties_json || {};
  const propertyList = Object.values(properties) as PageProperty[];

  return (
    <div className="flex h-full flex-col bg-muted/5">
      {/* Header */}
      <div className="flex items-center justify-between  border-border/40 p-3 h-11">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Properties</span>
          {isSaving && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={isSaving || isReadOnly}
              aria-label="Add property"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Add Property</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleAddProperty("text")}>
              <Type className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Text</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("number")}>
              <Hash className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Number</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("checkbox")}>
              <CheckSquare className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Checkbox</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("date")}>
              <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Date</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("select")}>
              <List className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Select</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("multi-select")}>
              <ListChecks className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Multi-select</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAddProperty("url")}>
              <Link className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>URL</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {/* System Properties */}
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              System
            </p>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>Created</span>
                </div>
                <span className="text-foreground">
                  {new Date(page.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Updated</span>
                </div>
                <span className="text-foreground">
                  {new Date(page.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <Separator className="bg-border/40" />

          {/* Custom Properties */}
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Custom
            </p>

            {propertyList.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No custom properties yet
              </p>
            ) : (
              <div className="space-y-2">
                {propertyList.map((prop) => (
                  <PropertyRow
                    key={prop.id}
                    property={prop}
                    onChange={(updates) =>
                      handleUpdateProperty(prop.id, updates)
                    }
                    onDelete={() => handleDeleteProperty(prop.id)}
                    readOnly={isReadOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>


    </div>
  );
}
