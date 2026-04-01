import { StepViewer } from "@/components/3d-viewer/StepViewer";

interface ModelAsset {
  id: string;
  fileName: string;
  stepAssetPath: string | null;
  isDefault?: boolean;
}

interface Model3dPlaceholderProps {
  model3dOptions?: ModelAsset[];
}

export function Model3dPlaceholder({ model3dOptions }: Model3dPlaceholderProps) {
  const selectedModel =
    model3dOptions?.find((model) => model.isDefault) ?? model3dOptions?.[0];

  return (
    <StepViewer
      assetPath={selectedModel?.stepAssetPath ?? null}
      fileName={selectedModel?.fileName}
      className="h-[200px]"
    />
  );
}
