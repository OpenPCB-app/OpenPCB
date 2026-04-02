import { StepViewer } from "@/components/3d-viewer/StepViewer";

interface ModelAsset {
  id: string;
  fileName: string;
  stepAssetPath: string | null;
  isDefault?: boolean;
}

interface Model3dPlaceholderProps {
  model3dOptions?: unknown[];
}

function isModelAsset(value: unknown): value is ModelAsset {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "fileName" in value &&
    typeof value.fileName === "string" &&
    "stepAssetPath" in value &&
    (typeof value.stepAssetPath === "string" || value.stepAssetPath === null)
  );
}

export function Model3dPlaceholder({ model3dOptions }: Model3dPlaceholderProps) {
  const models = model3dOptions?.filter(isModelAsset);
  const selectedModel =
    models?.find((model) => model.isDefault) ?? models?.[0];

  return (
    <StepViewer
      assetPath={selectedModel?.stepAssetPath ?? null}
      fileName={selectedModel?.fileName}
      className="h-[200px]"
    />
  );
}
