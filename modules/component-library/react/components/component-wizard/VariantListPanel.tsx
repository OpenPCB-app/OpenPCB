import { Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useComponentWizardStore,
  useVariants,
  useActiveVariantId,
  type WizardVariantDraft,
  type MountType,
} from "@/stores/component-wizard-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const MOUNT_TYPE_LABELS: Record<MountType, string> = {
  smd: "SMD",
  through_hole: "THT",
};

interface VariantItemProps {
  variant: WizardVariantDraft;
  isActive: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

function VariantItem({
  variant,
  isActive,
  canDelete,
  onSelect,
  onDelete,
  onSetDefault,
}: VariantItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors group",
            isActive
              ? "bg-brand/10 border border-brand"
              : "bg-bg-input hover:bg-bg-elevated border border-transparent",
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm text-text-primary truncate">
                {variant.canonicalCode || "Unnamed"}
              </span>
              {variant.isDefault && (
                <Star className="h-3 w-3 text-warning flex-shrink-0 fill-warning" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  variant.mountType === "smd"
                    ? "bg-info/20 text-info"
                    : "bg-success/20 text-success",
                )}
              >
                {MOUNT_TYPE_LABELS[variant.mountType]}
              </span>
              {variant.humanLabel &&
                variant.humanLabel !== variant.canonicalCode && (
                  <span className="text-xs text-text-muted truncate">
                    {variant.humanLabel}
                  </span>
                )}
            </div>
          </div>
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger/20 text-text-muted hover:text-danger transition-all"
              title="Delete variant"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onSetDefault} disabled={variant.isDefault}>
          <Star className="h-4 w-4 mr-2" />
          Set as default
        </ContextMenuItem>
        {canDelete && (
          <ContextMenuItem onClick={onDelete} className="text-danger">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function VariantListPanel() {
  const variants = useVariants();
  const activeVariantId = useActiveVariantId();
  const addVariant = useComponentWizardStore((s) => s.addVariant);
  const removeVariant = useComponentWizardStore((s) => s.removeVariant);
  const setActiveVariant = useComponentWizardStore((s) => s.setActiveVariant);
  const setDefaultVariant = useComponentWizardStore((s) => s.setDefaultVariant);

  const canDelete = variants.length > 1;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border-default">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Package Variants
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {variants.map((variant) => (
          <VariantItem
            key={variant.id}
            variant={variant}
            isActive={variant.id === activeVariantId}
            canDelete={canDelete}
            onSelect={() => setActiveVariant(variant.id)}
            onDelete={() => removeVariant(variant.id)}
            onSetDefault={() => setDefaultVariant(variant.id)}
          />
        ))}
      </div>

      <div className="p-2 border-t border-border-default">
        <button
          type="button"
          onClick={addVariant}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-text-secondary bg-bg-input hover:bg-bg-elevated transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Variant
        </button>
      </div>
    </div>
  );
}
