import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface SelectPropertyEditorProps {
  value: string | undefined;
  options: string[];
  onChange: (value: string) => void;
  onOptionsChange: (options: string[]) => void;
  placeholder?: string;
}

export function SelectPropertyEditor({
  value,
  options,
  onChange,
  onOptionsChange,
  placeholder = "Select...",
}: SelectPropertyEditorProps) {
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [newOption, setNewOption] = useState("");

  const handleAddOption = () => {
    if (newOption.trim() && !options.includes(newOption.trim())) {
      const updatedOptions = [...options, newOption.trim()];
      onOptionsChange(updatedOptions);
      onChange(newOption.trim());
      setNewOption("");
      setIsAddingOption(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddOption();
    } else if (e.key === "Escape") {
      setIsAddingOption(false);
      setNewOption("");
    }
  };

  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option} className="text-xs">
            {option}
          </SelectItem>
        ))}

        {options.length === 0 && !isAddingOption && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No options yet
          </div>
        )}

        <div className="border-t border-border mt-1 pt-1">
          {isAddingOption ? (
            <div className="flex gap-1 px-1 py-1">
              <Input
                className="h-6 text-xs flex-1"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="New option..."
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={handleAddOption}
                disabled={!newOption.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-sm transition-colors"
              onClick={() => setIsAddingOption(true)}
            >
              <Plus className="h-3 w-3" />
              Add option
            </button>
          )}
        </div>
      </SelectContent>
    </Select>
  );
}
