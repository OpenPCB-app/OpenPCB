import { useMemo, useState, type ReactElement } from "react";
import { Cable, CircuitBoard, Search, Tag, Zap } from "lucide-react";
import type {
  DesignerDerivedNet,
  DesignerLabel,
  DesignerPlacedPart,
  DesignerSchematicProjection,
} from "../../../../../sdks";
import { Units } from "../../../../../shared/frontend/canvas/coords";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../../hooks/useDesignerWorkspace";
import { OutlineGroup } from "./OutlineGroup";
import { OutlineRow, type OutlineRowAction } from "./OutlineRow";
import { OutlineEmptyState } from "./OutlineEmptyState";

const FRAME_PADDING_MM = 5;

type FilterKey = "components" | "nets" | "labels";

interface OutlinePanelProps {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  onPlaceComponent(): void;
  onAddNetLabel(): void;
  onBrowseLibrary(): void;
  onFrameBoundsMm(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): void;
}

interface RenameTarget {
  kind: "part" | "label";
  id: string;
}

function partBoundsMm(part: DesignerPlacedPart): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const x = Units.nmToMm(part.positionNm.x);
  const y = Units.nmToMm(part.positionNm.y);
  return {
    minX: x - FRAME_PADDING_MM,
    minY: y - FRAME_PADDING_MM,
    maxX: x + FRAME_PADDING_MM,
    maxY: y + FRAME_PADDING_MM,
  };
}

function labelBoundsMm(label: DesignerLabel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const x = Units.nmToMm(label.positionNm.x);
  const y = Units.nmToMm(label.positionNm.y);
  return {
    minX: x - FRAME_PADDING_MM,
    minY: y - FRAME_PADDING_MM,
    maxX: x + FRAME_PADDING_MM,
    maxY: y + FRAME_PADDING_MM,
  };
}

function netBoundsMm(
  net: DesignerDerivedNet,
  projection: DesignerSchematicProjection,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hit = false;
  for (const wireId of net.wireIds) {
    const wire = projection.wires.find((w) => w.id === wireId);
    if (!wire) continue;
    for (const point of wire.pointsNm) {
      const xMm = Units.nmToMm(point.x);
      const yMm = Units.nmToMm(point.y);
      if (xMm < minX) minX = xMm;
      if (yMm < minY) minY = yMm;
      if (xMm > maxX) maxX = xMm;
      if (yMm > maxY) maxY = yMm;
      hit = true;
    }
  }
  for (const pinId of net.pinIds) {
    for (const part of projection.parts) {
      const pin = part.pins.find((p) => p.id === pinId);
      if (!pin) continue;
      const xMm = Units.nmToMm(pin.worldPositionNm.x);
      const yMm = Units.nmToMm(pin.worldPositionNm.y);
      if (xMm < minX) minX = xMm;
      if (yMm < minY) minY = yMm;
      if (xMm > maxX) maxX = xMm;
      if (yMm > maxY) maxY = yMm;
      hit = true;
    }
  }
  if (!hit) return null;
  return {
    minX: minX - FRAME_PADDING_MM,
    minY: minY - FRAME_PADDING_MM,
    maxX: maxX + FRAME_PADDING_MM,
    maxY: maxY + FRAME_PADDING_MM,
  };
}

function inferComponentClass(part: DesignerPlacedPart): string {
  const name = part.symbol.name?.trim();
  if (name) return name;
  const ref = part.reference.toUpperCase();
  if (ref.startsWith("C")) return "Capacitor";
  if (ref.startsWith("R")) return "Resistor";
  if (ref.startsWith("L")) return "Inductor";
  if (ref.startsWith("D")) return "Diode";
  if (ref.startsWith("U")) return "IC";
  if (ref.startsWith("Q")) return "Transistor";
  return "Component";
}

export function OutlinePanel({
  state,
  actions,
  onPlaceComponent,
  onAddNetLabel,
  onBrowseLibrary,
  onFrameBoundsMm,
}: OutlinePanelProps): ReactElement {
  const [query, setQuery] = useState("");
  const [enabledFilters, setEnabledFilters] = useState<Set<FilterKey>>(
    new Set<FilterKey>(["components", "nets", "labels"]),
  );
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const projection = state.projection;
  const parts = projection?.parts ?? [];
  const labels = projection?.labels ?? [];
  // Real nets only — exclude auto-derived 1-pin "nets" the projection emits
  // for every unconnected pin. A net is shown when the user has expressed
  // intent: routed a wire, dropped a label, or placed a power/portal symbol.
  const nets = useMemo(
    () =>
      (projection?.nets ?? []).filter(
        (net) =>
          net.wireIds.length > 0 ||
          net.labelIds.length > 0 ||
          net.primitiveIds.length > 0,
      ),
    [projection?.nets],
  );

  const totalCount = parts.length + labels.length + nets.length;
  const designIsEmpty =
    parts.length === 0 && labels.length === 0 && nets.length === 0;

  const lowerQuery = query.trim().toLowerCase();

  const filteredParts = useMemo(() => {
    if (!enabledFilters.has("components")) return [];
    if (!lowerQuery) return parts;
    return parts.filter((part) => {
      const klass = inferComponentClass(part).toLowerCase();
      return (
        part.reference.toLowerCase().includes(lowerQuery) ||
        klass.includes(lowerQuery) ||
        part.value.toLowerCase().includes(lowerQuery) ||
        part.footprint.name.toLowerCase().includes(lowerQuery)
      );
    });
  }, [parts, lowerQuery, enabledFilters]);

  const filteredNets = useMemo(() => {
    if (!enabledFilters.has("nets")) return [];
    if (!lowerQuery) return nets;
    return nets.filter((net) => net.name.toLowerCase().includes(lowerQuery));
  }, [nets, lowerQuery, enabledFilters]);

  const filteredLabels = useMemo(() => {
    if (!enabledFilters.has("labels")) return [];
    if (!lowerQuery) return labels;
    return labels.filter((label) =>
      label.text.toLowerCase().includes(lowerQuery),
    );
  }, [labels, lowerQuery, enabledFilters]);

  const toggleFilter = (key: FilterKey) => {
    setEnabledFilters((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size === 1) return current; // never empty
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectPart = (partId: string) => {
    actions.setSelectedPartIds(new Set<string>([partId]));
    actions.setSelectedPartId(partId);
    actions.setSelectedLabelId(null);
    actions.setSelectedWireId(null);
    actions.setSelectedPinId(null);
  };

  const selectLabel = (labelId: string) => {
    actions.setSelectedPartIds(new Set<string>());
    actions.setSelectedPartId(null);
    actions.setSelectedLabelId(labelId);
    actions.setSelectedWireId(null);
    actions.setSelectedPinId(null);
  };

  const selectNet = (net: DesignerDerivedNet) => {
    // Highlight a representative wire as the selection, since nets are derived.
    const firstWireId = net.wireIds[0];
    if (firstWireId) {
      actions.setSelectedWireId(firstWireId);
    } else {
      actions.setSelectedWireId(null);
    }
    actions.setSelectedPartIds(new Set<string>());
    actions.setSelectedPartId(null);
    actions.setSelectedLabelId(null);
    actions.setSelectedPinId(null);
  };

  const frameToPart = (part: DesignerPlacedPart) => {
    onFrameBoundsMm(partBoundsMm(part));
  };
  const frameToLabel = (label: DesignerLabel) => {
    onFrameBoundsMm(labelBoundsMm(label));
  };
  const frameToNet = (net: DesignerDerivedNet) => {
    if (!projection) return;
    const bounds = netBoundsMm(net, projection);
    if (bounds) onFrameBoundsMm(bounds);
  };

  const renamePart = async (partId: string, value: string) => {
    setRenameTarget(null);
    try {
      await actions.dispatchCommand({
        type: "update_part_properties",
        partId,
        reference: value,
      });
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  const renameLabel = async (labelId: string, value: string) => {
    setRenameTarget(null);
    const label = labels.find((l) => l.id === labelId);
    if (!label) return;
    try {
      await actions.dispatchCommand({
        type: "upsert_label",
        labelId,
        text: value,
        positionNm: label.positionNm,
      });
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  const duplicatePart = async (part: DesignerPlacedPart) => {
    try {
      await actions.dispatchCommand({
        type: "place_part",
        componentId: part.componentId,
        positionNm: {
          x: part.positionNm.x + 2_540_000, // 2.54mm offset (100 mil)
          y: part.positionNm.y + 2_540_000,
        },
        rotationDeg: part.rotationDeg,
        mirrored: part.mirrored,
      });
    } catch (err) {
      actions.setError(
        err instanceof Error ? err.message : "Failed to duplicate",
      );
    }
  };

  const duplicateLabel = async (label: DesignerLabel) => {
    try {
      await actions.dispatchCommand({
        type: "upsert_label",
        text: label.text,
        positionNm: {
          x: label.positionNm.x + 2_540_000,
          y: label.positionNm.y + 2_540_000,
        },
      });
    } catch (err) {
      actions.setError(
        err instanceof Error ? err.message : "Failed to duplicate",
      );
    }
  };

  const deleteEntity = async (
    entityId: string,
    entityKind: "part" | "wire" | "label" | "primitive",
  ) => {
    try {
      await actions.dispatchCommand({
        type: "delete_entity",
        entityId,
        entityKind,
      });
    } catch (err) {
      actions.setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const partActions = (part: DesignerPlacedPart): OutlineRowAction[] => [
    {
      label: "Frame to canvas",
      shortcut: "F",
      onSelect: () => frameToPart(part),
    },
    {
      label: "Rename",
      shortcut: "F2",
      onSelect: () => {
        selectPart(part.id);
        setRenameTarget({ kind: "part", id: part.id });
      },
    },
    {
      label: "Duplicate",
      onSelect: () => void duplicatePart(part),
    },
    {
      label: "Delete",
      shortcut: "Del",
      destructive: true,
      onSelect: () => void deleteEntity(part.id, "part"),
    },
  ];

  const labelActions = (label: DesignerLabel): OutlineRowAction[] => [
    {
      label: "Frame to canvas",
      shortcut: "F",
      onSelect: () => frameToLabel(label),
    },
    {
      label: "Rename",
      shortcut: "F2",
      onSelect: () => {
        selectLabel(label.id);
        setRenameTarget({ kind: "label", id: label.id });
      },
    },
    {
      label: "Duplicate",
      onSelect: () => void duplicateLabel(label),
    },
    {
      label: "Delete",
      shortcut: "Del",
      destructive: true,
      onSelect: () => void deleteEntity(label.id, "label"),
    },
  ];

  const netActions = (net: DesignerDerivedNet): OutlineRowAction[] => [
    {
      label: "Frame to canvas",
      shortcut: "F",
      onSelect: () => frameToNet(net),
    },
    {
      label: "Rename",
      shortcut: "F2",
      disabled: true,
      onSelect: () => undefined,
    },
    {
      label: "Duplicate",
      disabled: true,
      onSelect: () => undefined,
    },
    {
      label: "Delete",
      shortcut: "Del",
      destructive: true,
      disabled: true,
      onSelect: () => undefined,
    },
  ];

  const isPowerNet = (name: string): boolean => {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return false;
    return (
      trimmed.startsWith("+") ||
      trimmed === "GND" ||
      trimmed === "VCC" ||
      trimmed === "VDD" ||
      trimmed === "VSS" ||
      trimmed.startsWith("VBAT")
    );
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Outline
        </p>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {totalCount}
        </span>
      </div>

      <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search designator, value, net…"
            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1">
          {(
            [
              { key: "components", label: "Components" },
              { key: "nets", label: "Nets" },
              { key: "labels", label: "Labels" },
            ] as Array<{ key: FilterKey; label: string }>
          ).map(({ key, label }) => {
            const enabled = enabledFilters.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  enabled
                    ? "bg-violet-600 text-white"
                    : "bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {designIsEmpty ? (
          <OutlineEmptyState
            onPlaceComponent={onPlaceComponent}
            onAddNetLabel={onAddNetLabel}
            onBrowseLibrary={onBrowseLibrary}
          />
        ) : (
          <div className="flex flex-col gap-1 py-1">
            {enabledFilters.has("components") && (
              <OutlineGroup
                label="Components"
                count={filteredParts.length}
                defaultOpen
              >
                {filteredParts.map((part) => {
                  const selected =
                    state.selectedPartId === part.id ||
                    state.selectedPartIds.has(part.id);
                  return (
                    <OutlineRow
                      key={part.id}
                      icon={<CircuitBoard className="h-3 w-3" />}
                      primary={part.reference || part.id.slice(0, 6)}
                      secondary={inferComponentClass(part)}
                      tertiary={part.value || part.footprint.name}
                      selected={selected}
                      onSelect={() => selectPart(part.id)}
                      onActivate={() => frameToPart(part)}
                      actions={partActions(part)}
                      renaming={
                        renameTarget?.kind === "part" &&
                        renameTarget.id === part.id
                      }
                      onRenameCommit={(value) =>
                        void renamePart(part.id, value)
                      }
                      onRenameCancel={() => setRenameTarget(null)}
                    />
                  );
                })}
              </OutlineGroup>
            )}
            {enabledFilters.has("nets") && (
              <OutlineGroup
                label="Nets"
                count={filteredNets.length}
                defaultOpen
              >
                {filteredNets.map((net) => {
                  const connectionCount = net.pinIds.length;
                  const power = isPowerNet(net.name);
                  const isSelected =
                    state.selectedWireId != null &&
                    net.wireIds.includes(state.selectedWireId);
                  return (
                    <OutlineRow
                      key={net.id}
                      icon={
                        power ? (
                          <Zap className="h-3 w-3" />
                        ) : (
                          <Cable className="h-3 w-3" />
                        )
                      }
                      primary={net.name}
                      secondary={null}
                      tertiary={`${connectionCount} pin${connectionCount === 1 ? "" : "s"}`}
                      selected={isSelected}
                      onSelect={() => selectNet(net)}
                      onActivate={() => frameToNet(net)}
                      actions={netActions(net)}
                    />
                  );
                })}
              </OutlineGroup>
            )}
            {enabledFilters.has("labels") && (
              <OutlineGroup
                label="Labels"
                count={filteredLabels.length}
                defaultOpen
              >
                {filteredLabels.map((label) => {
                  const selected = state.selectedLabelId === label.id;
                  return (
                    <OutlineRow
                      key={label.id}
                      icon={<Tag className="h-3 w-3" />}
                      primary={label.text}
                      secondary={null}
                      tertiary={null}
                      selected={selected}
                      onSelect={() => selectLabel(label.id)}
                      onActivate={() => frameToLabel(label)}
                      actions={labelActions(label)}
                      renaming={
                        renameTarget?.kind === "label" &&
                        renameTarget.id === label.id
                      }
                      onRenameCommit={(value) =>
                        void renameLabel(label.id, value)
                      }
                      onRenameCancel={() => setRenameTarget(null)}
                    />
                  );
                })}
              </OutlineGroup>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
