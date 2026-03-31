import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PageProperty } from "@modules/knowledge/shared/types";
import { SelectPropertyEditor } from "./SelectPropertyEditor";
import { MultiSelectPropertyEditor } from "./MultiSelectPropertyEditor";

interface PropertyRowProps {
  property: PageProperty;
  onChange: (updates: Partial<PageProperty>) => void;
  onDelete: () => void;
  readOnly?: boolean;
}

export function PropertyRow({
  property,
  onChange,
  onDelete,
  readOnly = false,
}: PropertyRowProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(property.name);

  const handleNameBlur = () => {
    setIsEditingName(false);
    if (nameValue !== property.name) {
      onChange({ name: nameValue });
    }
  };

  const renderValueEditor = () => {
    if (readOnly) {
      return (
        <span className="text-xs text-muted-foreground">
          {String(property.value || "-")}
        </span>
      );
    }

    switch (property.type) {
      case "text":
        return (
          <Input
            className="h-7 text-xs"
            value={(property.value as string) || ""}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="Empty"
          />
        );

      case "number":
        return (
          <Input
            type="number"
            className="h-7 text-xs"
            value={(property.value as number) ?? ""}
            onChange={(e) => onChange({ value: parseFloat(e.target.value) || 0 })}
            placeholder="0"
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center h-7">
            <Checkbox
              checked={!!property.value}
            onCheckedChange={(checked) => onChange({ value: checked })}
            disabled={readOnly}
          />
          </div>
        );

      case "date":
        return (
          <Input
            type="date"
            className="h-7 text-xs"
            value={
              property.value
                ? new Date(property.value as string | number).toISOString().split("T")[0]
                : ""
            }
            onChange={(e) => onChange({ value: e.target.value })}
          />
        );

      case "url":
        return (
          <Input
            type="url"
            className="h-7 text-xs"
            value={(property.value as string) || ""}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="https://..."
          />
        );

      case "select":
        return (
          <SelectPropertyEditor
            value={(property.value as string) || undefined}
            options={property.config?.options || []}
            onChange={(value) => onChange({ value })}
            onOptionsChange={(options) =>
              onChange({ config: { ...property.config, options } })
            }
            placeholder="Select..."
          />
        );

      case "multi-select":
        return (
          <MultiSelectPropertyEditor
            value={(property.value as string[]) || []}
            options={property.config?.options || []}
            onChange={(value) => onChange({ value })}
            onOptionsChange={(options) =>
              onChange({ config: { ...property.config, options } })
            }
            placeholder="Select tags..."
          />
        );

      default:
        return (
          <span className="text-xs text-muted-foreground">
            {String(property.value || "-")}
          </span>
        );
    }
  };

  return (
    <div className="group flex flex-col gap-1 py-1">
      {/* Property Name */}
      <div className="flex items-center justify-between">
        {isEditingName ? (
          <Input
            className="h-6 text-xs w-32"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === "Enter" && handleNameBlur()}
            autoFocus
          />
        ) : (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setIsEditingName(true)}
                disabled={readOnly}
              >
                {property.name}
              </button>
            )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              disabled={readOnly}
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem
              className="text-xs text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Property Value */}
      {renderValueEditor()}
    </div>
  );
}
