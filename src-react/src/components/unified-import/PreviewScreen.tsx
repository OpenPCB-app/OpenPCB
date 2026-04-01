import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";
import { ConflictResolutionDialog } from "./ConflictResolutionDialog";

export function PreviewScreen() {
  const previewData = useUnifiedImportStore((s: { previewData: ReturnType<typeof useUnifiedImportStore.getState>['previewData'] }) => s.previewData);
  const approveImport = useUnifiedImportStore((s: { approveImport: () => Promise<void> }) => s.approveImport);
  const cancelImport = useUnifiedImportStore((s: { cancelImport: () => Promise<void> }) => s.cancelImport);
  const currentStep = useUnifiedImportStore((s: { currentStep: string }) => s.currentStep);

  if (!previewData) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header with metadata */}
      <div className="border-b border-border-default p-4 bg-bg-secondary">
        <h2 className="text-lg font-semibold text-text-primary">
          {previewData.extractedMetadata.componentName}
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-text-secondary mt-1">
          {previewData.extractedMetadata.mpn && (
            <span>MPN: {previewData.extractedMetadata.mpn}</span>
          )}
          {previewData.extractedMetadata.manufacturer && (
            <span>Manufacturer: {previewData.extractedMetadata.manufacturer}</span>
          )}
          <span>Reference: {previewData.extractedMetadata.referencePrefix}</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Symbol Preview */}
        <section className="border border-border-default rounded-lg overflow-hidden">
          <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
            <h3 className="text-sm font-medium text-text-primary">
              Schematic Symbol ({previewData.symbol.pinCount} pins)
            </h3>
          </div>
          <div className="p-4 bg-bg-input min-h-[200px] flex items-center justify-center">
            <div className="text-center text-text-tertiary">
              <p className="text-sm">{previewData.symbol.name}</p>
              <p className="text-xs mt-1">
                Prefix: {previewData.symbol.referencePrefix}
              </p>
            </div>
          </div>
        </section>

        {/* Footprint Preview */}
        <section className="border border-border-default rounded-lg overflow-hidden">
          <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
            <h3 className="text-sm font-medium text-text-primary">
              PCB Footprint ({previewData.footprint.padCount} pads)
            </h3>
          </div>
          <div className="p-4 bg-bg-input min-h-[200px] flex items-center justify-center">
            <div className="text-center text-text-tertiary">
              <p className="text-sm">{previewData.footprint.name}</p>
              <p className="text-xs mt-1">
                Type: {previewData.footprint.mountType.toUpperCase()}
              </p>
              {previewData.footprint.description && (
                <p className="text-xs mt-1">{previewData.footprint.description}</p>
              )}
            </div>
          </div>
        </section>

        {/* 3D Model Preview */}
        {previewData.model3d && (
          <section className="border border-border-default rounded-lg overflow-hidden">
            <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
              <h3 className="text-sm font-medium text-text-primary">3D Model</h3>
            </div>
            <div className="p-4 bg-bg-input min-h-[200px] flex items-center justify-center">
              <div className="text-center text-text-tertiary">
                <p className="text-sm">{previewData.model3d.fileName}</p>
                <p className="text-xs mt-1">
                  {(previewData.model3d.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Warnings */}
        {previewData.warnings.length > 0 && (
          <section className="border border-warning/30 rounded-lg overflow-hidden bg-warning/5">
            <div className="bg-warning/10 px-4 py-2 border-b border-warning/30">
              <h3 className="text-sm font-medium text-warning">Warnings</h3>
            </div>
            <div className="p-4">
              <ul className="space-y-1">
                {previewData.warnings.map((warning, index) => (
                  <li key={index} className="text-xs text-warning">
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>

      {/* Action buttons */}
      <div className="border-t border-border-default p-4 flex justify-end gap-3">
        <button
          onClick={cancelImport}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={approveImport}
          className="px-4 py-2 bg-brand text-white rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Import Component
        </button>
      </div>

      {/* Conflict Resolution Dialog */}
      {currentStep === "conflict" && previewData.conflicts && (
        <ConflictResolutionDialog
          conflict={previewData.conflicts}
          onClose={() => {}}
        />
      )}
    </div>
  );
}
