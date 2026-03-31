import { useState, useMemo } from "react";
import { X, ChevronDown, Check, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface MultiSelectPropertyEditorProps {
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  onOptionsChange: (options: string[]) => void;
  placeholder?: string;
}

export function MultiSelectPropertyEditor({
  value,
  options,
  onChange,
  onOptionsChange,
  placeholder = "Select...",
}: MultiSelectPropertyEditorProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;
    return options.filter((opt) =>
      opt.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [options, inputValue]);

  const canCreate = useMemo(() => {
    if (!inputValue.trim()) return false;
    return !options.some(
      (opt) => opt.toLowerCase() === inputValue.toLowerCase()
    );
  }, [options, inputValue]);

  const handleSelect = (option: string) => {
    if (selectedSet.has(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const handleRemove = (option: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== option));
  };

  const handleCreate = () => {
    if (!inputValue.trim()) return;
    const newOption = inputValue.trim();
    if (!options.includes(newOption)) {
      onOptionsChange([...options, newOption]);
    }
    if (!selectedSet.has(newOption)) {
      onChange([...value, newOption]);
    }
    setInputValue("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-7 w-full justify-between text-xs px-2 py-1"
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge
                  key={v}
                  variant="secondary"
                  className="h-5 text-xs px-1.5 gap-1"
                >
                  {v}
                  <button
                    className="hover:bg-muted-foreground/20 rounded-full"
                    onClick={(e) => handleRemove(v, e)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or create..."
            value={inputValue}
            onValueChange={setInputValue}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-2 text-xs text-center text-muted-foreground">
              {canCreate ? "Press Enter to create" : "No results found"}
            </CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => handleSelect(option)}
                  className="text-xs"
                >
                  <div
                    className={`mr-2 flex h-4 w-4 items-center justify-center rounded border ${
                      selectedSet.has(option)
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {selectedSet.has(option) && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  onSelect={handleCreate}
                  className="text-xs text-primary"
                >
                  <Plus className="mr-2 h-3 w-3" />
                  Create "{inputValue}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
