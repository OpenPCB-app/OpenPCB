import { useState } from "react";
import type { Model3DOptionType } from "../../../../src-ts/src/core/schemas/component-library.schema";
import { StepViewer } from "@/components/3d-viewer/StepViewer";

interface Model3dPlaceholderProps {
  model3dOptions?: Model3DOptionType[];
}

export function Model3dPlaceholder({
  model3dOptions,
}: Model3dPlaceholderProps) {
  const [selectedModel, setSelectedModel] = useState<string | null>(
    model3dOptions?.find((m) => m.isDefault)?.id ||
      model3dOptions?.[0]?.id ||
      null,
  );

  const selectedModelData = model3dOptions?.find((m) => m.id === selectedModel);

  return (
    <div className="space-y-4">
      {model3dOptions && model3dOptions.length > 1 && (
        <div className="flex gap-2">
          {model3dOptions.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                selectedModel === model.id
                  ? "bg-brand text-white border-brand"
                  : "bg-bg-input text-text-secondary border-border-default hover:border-border-strong"
              }`}
            >
              {model.fileName}
              {model.isDefault && " (default)"}
            </button>
          ))}
        </div>
      )}

      <StepViewer
        assetPath={selectedModelData?.stepAssetPath ?? null}
        fileName={selectedModelData?.fileName}
        className="h-[200px]"
      />
    </div>
  );
}
