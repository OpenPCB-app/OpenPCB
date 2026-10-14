import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shared/frontend/ui";
import { FootprintPreviewCanvas } from "../../../shared/frontend/canvas/preview";
import { asFootprintRender } from "./detail-helpers";
import {
  FootprintGeneratorPanel,
  PinCoverage,
  type GeneratedFootprintPayload,
} from "./footprint-generator/FootprintGeneratorPanel";
import { missingPinNumbers } from "./footprint-generator/footprint-validation";
import { useComponentDetail } from "./hooks/useComponentDetail";
import { useFootprintGeometry } from "./hooks/useFootprintGeometry";
import { toUserError } from "./utils";

/** Backend placeholder footprint id (`builtins/placeholder-footprint.ts`). */
const PLACEHOLDER_FOOTPRINT_ID = "fp-no-footprint-yet";

export interface ChangeFootprintDialogProps {
  backendURL: string | null | undefined;
  /** Library module id; defaults to "library". */
  moduleId?: string;
  componentId: string;
  /** Pin numbers the footprint must cover (symbol pins). */
  symbolPinNumbers: readonly string[];
  /** Called after a successful commit. */
  onDone: () => void;
  onCancel: () => void;
  /** Built-in components: called with the editable copy's id after cloning. */
  onCloned?: (newComponentId: string) => void;
}

async function sendJson(
  url: string,
  method: "PATCH" | "POST",
  body: unknown,
): Promise<{ data?: { componentId?: string } } | null> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: { componentId?: string };
  } | null;
  if (!response.ok || payload?.ok === false) {
    throw new Error(toUserError(payload, `Request failed (HTTP ${response.status})`));
  }
  return payload;
}

/** Choose an existing linked footprint or generate a new one for a component. */
export function ChangeFootprintDialog({
  backendURL,
  moduleId = "library",
  componentId,
  symbolPinNumbers,
  onDone,
  onCancel,
  onCloned,
}: ChangeFootprintDialogProps): ReactElement {
  const { detail, loading, error: loadError } = useComponentDetail({
    backendURL,
    moduleId,
    componentId,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [clonedId, setClonedId] = useState<string | null>(null);
  const [tab, setTab] = useState("existing");

  const variants = useMemo(
    () =>
      (detail?.footprintVariants ?? [])
        .filter((v) => v.footprintId !== PLACEHOLDER_FOOTPRINT_ID)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [detail?.footprintVariants],
  );
  const defaultId = detail?.footprint.id ?? "";
  const effectiveId = selectedId ?? variants.find((v) => v.isDefault)?.footprintId ?? variants[0]?.footprintId ?? "";
  const geometry = useFootprintGeometry({
    backendURL,
    moduleId,
    selectedFootprintId: effectiveId,
    defaultFootprintId: defaultId,
    defaultModel: asFootprintRender(detail?.footprint.preview),
  });
  const existingMissing = useMemo(
    () =>
      geometry.status === "ready"
        ? missingPinNumbers(symbolPinNumbers, geometry.model.pads)
        : [],
    [geometry, symbolPinNumbers],
  );

  const base = `${backendURL}/api/modules/${moduleId}/components/${componentId}`;

  const commit = useCallback(
    async (run: () => Promise<void>) => {
      setBusy(true);
      setCommitError(null);
      try {
        await run();
        onDone();
      } catch (error) {
        setCommitError(
          error instanceof Error ? error.message : "Failed to change footprint",
        );
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  const useExisting = () =>
    commit(async () => {
      await sendJson(base, "PATCH", { defaultFootprintId: effectiveId });
    });
  const useGenerated = (g: GeneratedFootprintPayload) =>
    commit(async () => {
      await sendJson(`${base}/footprints`, "POST", {
        mode: g.mode,
        source: { source: g.source, metadata: g.metadata },
        generator: g.generator,
        setDefault: true,
      });
    });

  const isBuiltin = detail?.component.isBuiltin ?? false;
  const cloneComponent = async () => {
    setBusy(true);
    setCommitError(null);
    try {
      const payload = await sendJson(`${base}/clone`, "POST", {});
      const newId = payload?.data?.componentId;
      if (!newId) throw new Error("Clone returned no component id");
      setClonedId(newId);
      onCloned?.(newId);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Clone failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="xl" data-testid="change-footprint-dialog">
        <DialogHeader
          title="Change footprint"
          description={detail ? `Component: ${detail.component.name}` : undefined}
        />
        <DialogBody className="space-y-3">
          {loading ? <p className="text-text-tertiary">Loading…</p> : null}
          {loadError ? (
            <Banner tone="danger">{loadError}</Banner>
          ) : null}
          {detail && isBuiltin ? (
            <Banner tone="warning" title="Built-in component">
              Built-in components can&apos;t be changed — clone it first.
              Cloning creates an editable copy in your library; open the copy
              to change its footprint.
              {clonedId ? ` Copy created (${clonedId}).` : ""}
            </Banner>
          ) : null}
          {detail && !isBuiltin ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="existing" className="cursor-pointer">
                  Existing
                </TabsTrigger>
                <TabsTrigger value="generate" className="cursor-pointer">
                  Generate
                </TabsTrigger>
              </TabsList>
              <TabsContent value="existing">
                {variants.length === 0 ? (
                  <p className="text-text-tertiary">
                    No footprints are linked to this component yet. Use the
                    Generate tab.
                  </p>
                ) : (
                  <div className="grid grid-cols-[14rem_1fr] gap-3">
                    <ul role="radiogroup" aria-label="Linked footprints" className="space-y-1">
                      {variants.map((v) => (
                        <li key={v.footprintId}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={v.footprintId === effectiveId}
                            onClick={() => setSelectedId(v.footprintId)}
                            className={`w-full cursor-pointer rounded-control border px-2 py-1 text-left ${
                              v.footprintId === effectiveId
                                ? "border-selection bg-surface-selected"
                                : "border-border hover:bg-surface-hover"
                            }`}
                          >
                            <div className="truncate font-mono">{v.variantLabel}</div>
                            <div className="text-2xs text-text-tertiary">
                              {v.mountType ?? "—"} · {v.padCount} pads
                              {v.isDefault ? " · current" : ""}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-2">
                      <div className="h-56 overflow-hidden rounded-control border border-border bg-surface-canvas-well">
                        <FootprintPreviewCanvas
                          model={geometry.status === "ready" ? geometry.model : null}
                          fitToGeometryOnly
                          emptyMessage={
                            geometry.status === "error"
                              ? geometry.message
                              : "Loading footprint…"
                          }
                        />
                      </div>
                      {geometry.status === "ready" ? (
                        <PinCoverage missing={existingMissing} />
                      ) : null}
                    </div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="generate">
                <FootprintGeneratorPanel
                  backendURL={backendURL}
                  moduleId={moduleId}
                  symbolPinNumbers={symbolPinNumbers}
                  onGenerated={() => setCommitError(null)}
                  onUse={(g) => void useGenerated(g)}
                  useLabel="Use footprint"
                  useBusy={busy}
                />
              </TabsContent>
            </Tabs>
          ) : null}
          {commitError ? (
            <p role="alert" className="text-xs text-status-danger" data-testid="change-footprint-error">
              {commitError}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" className="cursor-pointer" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {isBuiltin ? (
            <Button type="button" variant="primary" className="cursor-pointer" disabled={busy || clonedId !== null} onClick={() => void cloneComponent()}>
              Clone component
            </Button>
          ) : tab === "existing" ? (
            <Button
              type="button"
              variant="primary"
              className="cursor-pointer"
              disabled={busy || !effectiveId || effectiveId === defaultId || existingMissing.length > 0}
              onClick={() => void useExisting()}
              title="Set the selected linked footprint as the component default"
            >
              Use selected footprint
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
