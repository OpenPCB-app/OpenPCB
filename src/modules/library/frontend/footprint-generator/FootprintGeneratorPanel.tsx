import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/frontend/ui";
import { FootprintPreviewCanvas } from "../../../../shared/frontend/canvas/preview";
import {
  generateFootprint,
  type GeneratedFootprintMetadata,
} from "../../../../shared/rendering/ipc7351b";
import { buildFootprintRenderModel } from "../../../../shared/rendering";
import type {
  FootprintRenderModel,
  FootprintRenderSource,
} from "../../../../shared/rendering/types";
import { IpcPresetTab, type IpcSelection } from "./IpcPresetTab";
import { TemplateTab, type MaterializedTemplate } from "./TemplateTab";
import { missingPinNumbers } from "./footprint-validation";
import {
  generatorUnavailableReason,
  type FootprintGeneratorIdentity,
} from "../../shared/generator-policy";

/** What a generator hands back; `source`+`metadata` feed the library routes. */
export interface GeneratedFootprintPayload {
  mode: "generated";
  source: FootprintRenderSource;
  model: FootprintRenderModel;
  metadata: GeneratedFootprintMetadata;
  /** Explicit inputs the backend re-derives the geometry from. */
  generator: FootprintGeneratorIdentity;
}

const EMPTY_SELECTION: IpcSelection = {
  family: null,
  size: null,
  density: "nominal",
};

export function templateToPayload(
  result: MaterializedTemplate,
): GeneratedFootprintPayload {
  return {
    mode: "generated",
    source: result.source,
    model: buildFootprintRenderModel(result.source),
    metadata: {
      name: result.metadata.name,
      mountType: result.metadata.mountType,
      packageCode: { imperial: result.metadata.packageCode, metric: null },
      tags: result.metadata.tags,
    },
    generator: {
      kind: "template",
      templateId: result.templateId,
      params: result.params,
    },
  };
}

/** Pin-coverage verdict row; hidden when no symbol pins are supplied. */
export function PinCoverage({
  missing,
}: {
  missing: readonly string[];
}): ReactElement {
  if (missing.length === 0) {
    return (
      <p className="text-xs text-status-success" data-testid="pin-coverage-ok">
        Every symbol pin has a matching pad.
      </p>
    );
  }
  return (
    <p
      role="alert"
      className="text-xs text-status-danger"
      data-testid="pin-coverage-missing"
    >
      Pins without a pad: {missing.join(", ")}
    </p>
  );
}

interface FootprintGeneratorPanelProps {
  backendURL: string | null | undefined;
  moduleId: string;
  /** Called with each new result, or `null` when a previous one is invalidated. */
  onGenerated: (generated: GeneratedFootprintPayload | null) => void;
  /** Symbol pin numbers to validate against; omit to skip coverage checks. */
  symbolPinNumbers?: readonly string[];
  /** Controlled IPC selection (wizard keeps it in its store). */
  ipcSelection?: IpcSelection;
  onIpcSelectionChange?: (next: IpcSelection) => void;
  /** Render the pad-number preview inside the panel. Default true. */
  showPreview?: boolean;
  /** When set, shows a "Use footprint" button gated on pin coverage. */
  onUse?: (generated: GeneratedFootprintPayload) => void;
  useLabel?: string;
  useBusy?: boolean;
}

/** IPC-7351B preset + parametric-template footprint generator. */
export function FootprintGeneratorPanel({
  backendURL,
  moduleId,
  onGenerated,
  symbolPinNumbers,
  ipcSelection,
  onIpcSelectionChange,
  showPreview = true,
  onUse,
  useLabel = "Use footprint",
  useBusy = false,
}: FootprintGeneratorPanelProps): ReactElement {
  const [localSelection, setLocalSelection] =
    useState<IpcSelection>(EMPTY_SELECTION);
  const selection = ipcSelection ?? localSelection;
  const [generated, setGenerated] = useState<GeneratedFootprintPayload | null>(
    null,
  );
  const [ipcError, setIpcError] = useState<string | null>(null);

  const emit = useCallback(
    (next: GeneratedFootprintPayload | null) => {
      setGenerated(next);
      onGenerated(next);
    },
    [onGenerated],
  );

  const changeSelection = useCallback(
    (next: IpcSelection) => {
      setLocalSelection(next);
      onIpcSelectionChange?.(next);
    },
    [onIpcSelectionChange],
  );

  const handleIpcGenerate = useCallback(() => {
    if (!selection.family || !selection.size) return;
    const unavailable = generatorUnavailableReason(selection.family);
    if (unavailable) {
      setIpcError(unavailable);
      return;
    }
    try {
      const result = generateFootprint(
        selection.family,
        selection.size,
        selection.density,
      );
      setIpcError(null);
      emit({
        mode: "generated",
        source: result.source,
        model: result.model,
        metadata: result.metadata,
        generator: {
          kind: "ipc7351b",
          family: selection.family,
          size: selection.size,
          density: selection.density,
        },
      });
    } catch (error) {
      setIpcError(
        error instanceof Error
          ? error.message
          : "Footprint generation failed",
      );
    }
  }, [emit, selection]);

  const missing = useMemo(
    () =>
      generated && symbolPinNumbers
        ? missingPinNumbers(symbolPinNumbers, generated.source.pads)
        : [],
    [generated, symbolPinNumbers],
  );

  return (
    <div className="space-y-3">
      <Tabs defaultValue="ipc">
        <TabsList>
          <TabsTrigger value="ipc" className="cursor-pointer">
            IPC package
          </TabsTrigger>
          <TabsTrigger value="template" className="cursor-pointer">
            Template
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ipc">
          <IpcPresetTab
            selection={selection}
            onFamilyChange={(family) => {
              changeSelection({ ...selection, family, size: null });
              emit(null);
            }}
            onSizeChange={(size) => {
              changeSelection({ ...selection, size });
              emit(null);
            }}
            onDensityChange={(density) => {
              changeSelection({ ...selection, density });
              emit(null);
            }}
            onGenerate={handleIpcGenerate}
          />
          {ipcError ? (
            <p role="alert" className="mt-2 text-xs text-status-danger">
              {ipcError}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="template">
          <TemplateTab
            backendURL={backendURL}
            moduleId={moduleId}
            onMaterialized={(result) => emit(templateToPayload(result))}
          />
        </TabsContent>
      </Tabs>

      {generated && showPreview ? (
        <div
          className="h-56 overflow-hidden rounded-control border border-border bg-surface-canvas-well"
          data-testid="generator-preview"
        >
          <FootprintPreviewCanvas
            model={generated.model}
            fitToGeometryOnly
            emptyMessage="No preview"
          />
        </div>
      ) : null}
      {generated && symbolPinNumbers ? <PinCoverage missing={missing} /> : null}
      {onUse ? (
        <Button
          type="button"
          variant="primary"
          className="cursor-pointer"
          disabled={!generated || missing.length > 0 || useBusy}
          onClick={() => generated && onUse(generated)}
        >
          {useBusy ? "Saving…" : useLabel}
        </Button>
      ) : null}
    </div>
  );
}
