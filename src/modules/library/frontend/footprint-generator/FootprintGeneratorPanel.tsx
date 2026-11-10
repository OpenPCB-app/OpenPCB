import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
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
import {
  EMPTY_TEMPLATE_SELECTION,
  missingPinNumbers,
  sameTemplateIdentity,
  type TemplateSelection,
} from "./footprint-validation";
import {
  generatorUnavailableReason,
  sameGeneratorIdentity,
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

export type GeneratorTab = "ipc" | "template";

const EMPTY_SELECTION: IpcSelection = {
  family: null,
  size: null,
  density: "nominal",
};

export type IpcDerivation =
  | { readonly kind: "incomplete" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "ready"; readonly payload: GeneratedFootprintPayload };

/**
 * The IPC footprint for exactly the displayed tuple (T-319). Generation is
 * synchronous, so the payload can never lag the selection.
 */
export function deriveIpcPayload(selection: IpcSelection): IpcDerivation {
  const { family, size, density } = selection;
  if (!family || !size) return { kind: "incomplete" };
  const unavailable = generatorUnavailableReason(family);
  if (unavailable) return { kind: "unavailable", reason: unavailable };
  try {
    const result = generateFootprint(family, size, density);
    return {
      kind: "ready",
      payload: {
        mode: "generated",
        source: result.source,
        model: result.model,
        metadata: result.metadata,
        generator: { kind: "ipc7351b", family, size, density },
      },
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason:
        error instanceof Error ? error.message : "Footprint generation failed",
    };
  }
}

/** True when `payload` was generated from the inputs the active tab displays. */
function matchesDisplayed(
  payload: GeneratedFootprintPayload,
  tab: GeneratorTab,
  selection: IpcSelection,
  templateSelection: TemplateSelection,
): boolean {
  if (tab === "template") {
    return sameTemplateIdentity(payload.generator, templateSelection);
  }
  return (
    payload.generator.kind === "ipc7351b" &&
    selection.family !== null &&
    selection.size !== null &&
    sameGeneratorIdentity(payload.generator, {
      kind: "ipc7351b",
      family: selection.family,
      size: selection.size,
      density: selection.density,
    })
  );
}

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
  /** Called with the active tab's current result, or `null` when there is none. */
  onGenerated: (generated: GeneratedFootprintPayload | null) => void;
  /** Symbol pin numbers to validate against; omit to skip coverage checks. */
  symbolPinNumbers?: readonly string[];
  /** Controlled IPC selection (wizard keeps it in its store). */
  ipcSelection?: IpcSelection;
  onIpcSelectionChange?: (next: IpcSelection) => void;
  /** Controlled tab, template form and template result (the wizard keeps them). */
  activeTab?: GeneratorTab;
  onActiveTabChange?: (next: GeneratorTab) => void;
  templateSelection?: TemplateSelection;
  onTemplateSelectionChange?: (next: TemplateSelection) => void;
  templatePayload?: GeneratedFootprintPayload | null;
  onTemplatePayloadChange?: (next: GeneratedFootprintPayload | null) => void;
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
  activeTab,
  onActiveTabChange,
  templateSelection,
  onTemplateSelectionChange,
  templatePayload,
  onTemplatePayloadChange,
  showPreview = true,
  onUse,
  useLabel = "Use footprint",
  useBusy = false,
}: FootprintGeneratorPanelProps): ReactElement {
  const [localSelection, setLocalSelection] =
    useState<IpcSelection>(EMPTY_SELECTION);
  const selection = ipcSelection ?? localSelection;
  const [localTab, setLocalTab] = useState<GeneratorTab>("ipc");
  const tab = activeTab ?? localTab;
  const [localTemplateSelection, setLocalTemplateSelection] =
    useState<TemplateSelection>(EMPTY_TEMPLATE_SELECTION);
  const templateForm = templateSelection ?? localTemplateSelection;
  const [localTemplatePayload, setLocalTemplatePayload] =
    useState<GeneratedFootprintPayload | null>(null);
  const templateResult =
    templatePayload === undefined ? localTemplatePayload : templatePayload;

  const { family, size, density } = selection;
  const ipc = useMemo(
    () => deriveIpcPayload({ family, size, density }),
    [family, size, density],
  );
  const current =
    tab === "ipc"
      ? ipc.kind === "ready"
        ? ipc.payload
        : null
      : templateResult;

  const onGeneratedRef = useRef(onGenerated);
  useEffect(() => {
    onGeneratedRef.current = onGenerated;
  });
  useEffect(() => {
    onGeneratedRef.current(current);
  }, [current]);

  const changeTab = useCallback(
    (next: GeneratorTab) => {
      setLocalTab(next);
      onActiveTabChange?.(next);
    },
    [onActiveTabChange],
  );
  const changeTemplateSelection = useCallback(
    (next: TemplateSelection) => {
      setLocalTemplateSelection(next);
      onTemplateSelectionChange?.(next);
    },
    [onTemplateSelectionChange],
  );
  const changeTemplatePayload = useCallback(
    (next: GeneratedFootprintPayload | null) => {
      setLocalTemplatePayload(next);
      onTemplatePayloadChange?.(next);
    },
    [onTemplatePayloadChange],
  );
  const handleMaterialized = useCallback(
    (result: MaterializedTemplate) =>
      changeTemplatePayload(templateToPayload(result)),
    [changeTemplatePayload],
  );
  const handleTemplateInvalidated = useCallback(
    () => changeTemplatePayload(null),
    [changeTemplatePayload],
  );

  const changeSelection = useCallback(
    (next: IpcSelection) => {
      setLocalSelection(next);
      onIpcSelectionChange?.(next);
    },
    [onIpcSelectionChange],
  );

  const missing = useMemo(
    () =>
      current && symbolPinNumbers
        ? missingPinNumbers(symbolPinNumbers, current.source.pads)
        : [],
    [current, symbolPinNumbers],
  );
  const usable =
    current !== null &&
    matchesDisplayed(current, tab, selection, templateForm);

  return (
    <div className="space-y-3">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          changeTab(value === "template" ? "template" : "ipc")
        }
      >
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
            onFamilyChange={(nextFamily) =>
              changeSelection({ ...selection, family: nextFamily, size: null })
            }
            onSizeChange={(nextSize) =>
              changeSelection({ ...selection, size: nextSize })
            }
            onDensityChange={(nextDensity) =>
              changeSelection({ ...selection, density: nextDensity })
            }
          />
          {ipc.kind === "unavailable" ? (
            <p role="alert" className="mt-2 text-xs text-status-danger">
              {ipc.reason}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="template">
          <TemplateTab
            backendURL={backendURL}
            moduleId={moduleId}
            selection={templateForm}
            onSelectionChange={changeTemplateSelection}
            onMaterialized={handleMaterialized}
            onInvalidated={handleTemplateInvalidated}
          />
        </TabsContent>
      </Tabs>

      {current && showPreview ? (
        <div
          className="h-56 overflow-hidden rounded-control border border-border bg-surface-canvas-well"
          data-testid="generator-preview"
        >
          <FootprintPreviewCanvas
            model={current.model}
            fitToGeometryOnly
            emptyMessage="No preview"
          />
        </div>
      ) : null}
      {current && symbolPinNumbers ? <PinCoverage missing={missing} /> : null}
      {onUse ? (
        <Button
          type="button"
          variant="primary"
          className="cursor-pointer"
          disabled={!usable || missing.length > 0 || useBusy}
          onClick={() => current && usable && onUse(current)}
        >
          {useBusy ? "Saving…" : useLabel}
        </Button>
      ) : null}
    </div>
  );
}
