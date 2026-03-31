import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Palette } from "lucide-react";

export interface ColorOption {
  name: string;
  textColor: string;
  bgColor: string;
}

export const TEXT_COLORS: ColorOption[] = [
  { name: "Default", textColor: "inherit", bgColor: "transparent" },
  { name: "Red", textColor: "#dc2626", bgColor: "#fef2f2" },
  { name: "Orange", textColor: "#ea580c", bgColor: "#fff7ed" },
  { name: "Yellow", textColor: "#ca8a04", bgColor: "#fefce8" },
  { name: "Green", textColor: "#16a34a", bgColor: "#f0fdf4" },
  { name: "Blue", textColor: "#2563eb", bgColor: "#eff6ff" },
  { name: "Purple", textColor: "#9333ea", bgColor: "#faf5ff" },
];

interface ColorPickerProps {
  onColorChange: (color: ColorOption, mode: "text" | "background") => void;
  currentTextColor?: string;
  currentBgColor?: string;
  asChild?: boolean;
  children?: React.ReactNode;
}

export function ColorPicker({
  onColorChange,
  currentTextColor,
  currentBgColor,
  asChild,
  children,
}: ColorPickerProps) {
  const [mode, setMode] = useState<"text" | "background">("text");
  const [open, setOpen] = useState(false);

  const handleColorClick = (color: ColorOption) => {
    onColorChange(color, mode);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild={asChild}>
        {children || (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Palette className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="flex gap-1 mb-2">
          <Button
            variant={mode === "text" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 text-xs h-7"
            onClick={() => setMode("text")}
          >
            Text
          </Button>
          <Button
            variant={mode === "background" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 text-xs h-7"
            onClick={() => setMode("background")}
          >
            Background
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {TEXT_COLORS.map((color) => {
            const isActive =
              mode === "text"
                ? currentTextColor === color.textColor
                : currentBgColor === color.bgColor;

            return (
              <button
                key={color.name}
                className={`w-8 h-8 rounded border-2 transition-all ${
                  isActive
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-transparent hover:border-muted-foreground/30"
                }`}
                style={{
                  backgroundColor:
                    mode === "text" ? color.textColor : color.bgColor,
                }}
                onClick={() => handleColorClick(color)}
                title={color.name}
              >
                {color.name === "Default" && (
                  <span className="text-xs text-muted-foreground">A</span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
