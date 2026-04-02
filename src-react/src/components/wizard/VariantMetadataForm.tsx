import { useEffect, useId, useState } from "react";
import {
  useComponentWizardStore,
  useActiveVariant,
  useActiveVariantId,
  type MountType,
} from "@/stores/component-wizard-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MOUNT_OPTIONS: { value: MountType; label: string }[] = [
  { value: "smd", label: "SMD" },
  { value: "through_hole", label: "Through-hole" },
];

export function VariantMetadataForm() {
  const activeVariant = useActiveVariant();
  const activeVariantId = useActiveVariantId();
  const updateVariantMetadata = useComponentWizardStore(
    (s) => s.updateVariantMetadata,
  );

  const [canonicalCode, setCanonicalCode] = useState("");
  const [humanLabel, setHumanLabel] = useState("");
  const [mountType, setMountType] = useState<MountType>("smd");

  const codeId = useId();
  const labelId = useId();
  const mountId = useId();

  useEffect(() => {
    if (activeVariant) {
      setCanonicalCode(activeVariant.canonicalCode);
      setHumanLabel(activeVariant.humanLabel);
      setMountType(activeVariant.mountType);
    }
  }, [activeVariant]);

  if (!activeVariant || !activeVariantId) {
    return null;
  }

  const handleCanonicalCodeChange = (value: string) => {
    setCanonicalCode(value);
    updateVariantMetadata(activeVariantId, { canonicalCode: value });
  };

  const handleHumanLabelChange = (value: string) => {
    setHumanLabel(value);
    updateVariantMetadata(activeVariantId, { humanLabel: value });
  };

  const handleMountTypeChange = (value: MountType) => {
    setMountType(value);
    updateVariantMetadata(activeVariantId, { mountType: value });
  };

  return (
    <div className="bg-bg-secondary border-b border-border-default p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <label
            htmlFor={codeId}
            className="block text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1"
          >
            Package Code
          </label>
          <input
            id={codeId}
            type="text"
            value={canonicalCode}
            onChange={(e) => handleCanonicalCodeChange(e.target.value)}
            placeholder="e.g. 0805"
            className="w-full h-8 px-2.5 text-sm rounded-md border border-border-default bg-bg-input text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          />
        </div>

        <div className="flex-1 min-w-0">
          <label
            htmlFor={labelId}
            className="block text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1"
          >
            Display Label
          </label>
          <input
            id={labelId}
            type="text"
            value={humanLabel}
            onChange={(e) => handleHumanLabelChange(e.target.value)}
            placeholder="e.g. 0805 (2012 metric)"
            className="w-full h-8 px-2.5 text-sm rounded-md border border-border-default bg-bg-input text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          />
        </div>

        <div className="w-32 flex-shrink-0">
          <label
            htmlFor={mountId}
            className="block text-[10px] font-medium text-text-muted uppercase tracking-wide mb-1"
          >
            Mount Type
          </label>
          <Select value={mountType} onValueChange={handleMountTypeChange}>
            <SelectTrigger id={mountId} className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOUNT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
