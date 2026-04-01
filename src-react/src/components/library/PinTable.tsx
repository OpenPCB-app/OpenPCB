import { useState } from "react";
import type { ComponentFamilyType } from "../../../../src-ts/src/core/schemas/component-library.schema";
import { Search } from "lucide-react";

interface PinTableProps {
  pins?: ComponentFamilyType['symbolData']['pinDefinitions'];
}

const ELECTRICAL_TYPE_LABELS: Record<string, string> = {
  passive: "Passive",
  input: "Input",
  output: "Output",
  bidirectional: "Bidirectional",
  power_in: "Power In",
  power_out: "Power Out",
  open_collector: "Open Collector",
  open_emitter: "Open Emitter",
  unspecified: "Unspecified",
};

const ELECTRICAL_TYPE_COLORS: Record<string, string> = {
  passive: "text-text-tertiary",
  input: "text-info",
  output: "text-success",
  bidirectional: "text-warning",
  power_in: "text-error",
  power_out: "text-error",
  open_collector: "text-brand",
  open_emitter: "text-brand",
  unspecified: "text-text-tertiary",
};

export function PinTable({ pins }: PinTableProps) {
  const [searchQuery, setSearchQuery] = useState("");

  if (!pins || pins.length === 0) {
    return (
      <div className="text-center py-4 text-text-tertiary text-sm">
        No pin information available
      </div>
    );
  }

  const filteredPins = pins.filter(
    (pin) =>
      pin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pin.electricalType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
        <input
          type="text"
          placeholder="Filter pins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-bg-input border border-border-default rounded-md pl-7 pr-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none"
        />
      </div>

      <div className="border border-border-default rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-bg-secondary sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">#</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Name</th>
              <th className="text-left px-3 py-2 font-medium text-text-secondary">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {filteredPins.map((pin, index) => (
              <tr key={index} className="hover:bg-bg-hover">
                <td className="px-3 py-2 text-text-tertiary">{index + 1}</td>
                <td className="px-3 py-2 text-text-primary font-medium">{pin.name}</td>
                <td className="px-3 py-2">
                  <span className={ELECTRICAL_TYPE_COLORS[pin.electricalType] || "text-text-tertiary"}>
                    {ELECTRICAL_TYPE_LABELS[pin.electricalType] || pin.electricalType}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-tertiary">
        Showing {filteredPins.length} of {pins.length} pins
      </p>
    </div>
  );
}
