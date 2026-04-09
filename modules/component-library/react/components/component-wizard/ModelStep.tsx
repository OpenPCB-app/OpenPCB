import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useComponentWizardStore } from "@/stores/component-wizard-store";
import { useAppStore } from "@/stores/app-store";
import { toast } from "@/components/ui/use-toast";
import * as fileClient from "@shared/sdk/file-client";
import { StepViewer } from "@/components/3d-viewer/StepViewer";

export function ModelStep() {
  const draft = useComponentWizardStore((s) => s.draft);
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

  const modelRefs =
    draft?.footprintData?.importPreservation?.model3dReferences ?? [];
  const hasModelRefs = modelRefs.length > 0;
  const selectedModelFileName = draft?.modelData?.stepFileName ?? null;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleToolbarUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleModelUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (!activeWorkspaceId) {
        toast({
          title: "Upload failed",
          description: "No active workspace available for file upload",
          variant: "destructive",
        });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspaceId", activeWorkspaceId);

      try {
        setIsUploading(true);
        const uploaded = await fileClient.uploadFile(formData);
        const assetPath = `/api/files/${encodeURIComponent(uploaded.id)}/content`;

        updateDraft({
          modelData: {
            fileId: uploaded.id,
            stepFileName: uploaded.originalName,
            stepAssetPath: assetPath,
            gltfPreviewPath: null,
          },
        });

        toast({
          title: "3D model uploaded",
          description: `Uploaded ${uploaded.originalName}`,
        });
      } catch (error) {
        toast({
          title: "Upload failed",
          description:
            error instanceof Error
              ? error.message
              : "Unable to upload 3D model",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [activeWorkspaceId, updateDraft],
  );

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[800px]">
        <div className="mb-4 flex items-center gap-2 border border-border-default bg-bg-secondary px-3 py-2 rounded-md">
          <input
            ref={uploadInputRef}
            type="file"
            accept=".step,.stp,.wrl"
            className="hidden"
            onChange={handleModelUpload}
          />
          <button
            onClick={handleToolbarUploadClick}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
          >
            <Upload className="h-4 w-4" />
            Import 3D model
          </button>
          {isUploading && (
            <span className="text-xs text-text-muted">Uploading…</span>
          )}
          {selectedModelFileName && (
            <span className="text-xs text-text-muted">
              {selectedModelFileName}
            </span>
          )}
        </div>

        {hasModelRefs && (
          <div className="mb-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-xs text-text-secondary space-y-1">
            <p>Footprint references these 3D models:</p>
            {modelRefs.map((ref) => (
              <div key={ref.path} className="font-mono">
                {ref.path}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <StepViewer
            assetPath={draft?.modelData?.stepAssetPath ?? null}
            fileName={selectedModelFileName ?? undefined}
            className="min-h-[300px]"
          />

          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Upload a STEP/WRL file. If footprint imports a model path, upload
              the matching file here.
            </p>
            <label className="rounded-lg border-2 border-dashed border-border-default p-8 text-center flex flex-col items-center gap-2 cursor-pointer hover:border-brand transition-colors">
              <Upload className="h-6 w-6 text-text-muted" />
              <p className="text-sm text-text-muted">
                Select .step/.stp/.wrl file
              </p>
              <input
                type="file"
                accept=".step,.stp,.wrl"
                className="hidden"
                onChange={handleModelUpload}
                disabled={isUploading}
              />
            </label>
            <p className="text-xs text-text-tertiary">
              3D models are optional. You can add one later.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
