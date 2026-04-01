/**
 * Symbol Metadata Editor
 *
 * Form for editing symbol name, reference prefix, and description.
 */

import { useCallback } from "react";
import { useSymbolEditorStore } from "./symbol-editor-store";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SymbolMetadataEditor() {
  const metadata = useSymbolEditorStore((s) => s.draft.metadata);
  const updateMetadata = useSymbolEditorStore((s) => s.updateMetadata);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateMetadata({ name: e.target.value });
    },
    [updateMetadata],
  );

  const handlePrefixChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateMetadata({ referencePrefix: e.target.value.toUpperCase() });
    },
    [updateMetadata],
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateMetadata({ description: e.target.value });
    },
    [updateMetadata],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-muted-foreground">Symbol Info</div>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Name *</label>
        <input
          type="text"
          value={metadata.name}
          onChange={handleNameChange}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          placeholder="e.g., LM358"
        />
      </div>

      {/* Reference Prefix */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Reference Prefix</label>
        <input
          type="text"
          value={metadata.referencePrefix}
          onChange={handlePrefixChange}
          className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm uppercase focus:border-primary focus:outline-none"
          placeholder="U"
          maxLength={3}
        />
        <span className="text-xs text-muted-foreground">
          Designator prefix (U, R, C, etc.)
        </span>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Description</label>
        <textarea
          value={metadata.description}
          onChange={handleDescriptionChange}
          className="min-h-[60px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          placeholder="Brief description of the component"
        />
      </div>
    </div>
  );
}
