import { useMemo, useState, type ReactElement } from "react";
import { Cable, ChevronDown, ChevronUp, Tag, Zap } from "lucide-react";
import type {
  DesignerDerivedNet,
  DesignerLabel,
  DesignerPlacedPart,
} from "../../../../../sdks";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../../hooks/useDesignerWorkspace";
import {
  compareDesignators,
  inferComponentClass,
  partValueLabel,
} from "../../lib/outline-format";
import { duplicateSchematicPositionNm } from "../../lib/grid";
import { useGridPreferences } from "../../stores/grid-prefs";
import { classifyNet, isPowerNet } from "../../lib/net-class";
import { ComponentClassIcon } from "../ComponentClassIcon";
import { OutlineRow, type OutlineRowAction } from "./OutlineRow";
import { OutlineEmptyState } from "./OutlineEmptyState";
import { labelBoundsMm, netBoundsMm, partBoundsMm } from "./bounds";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { SearchField } from "@shared/frontend/ui/search-field";
import { SegmentedControl } from "@shared/frontend/ui/segmented-control";
import { TableHeaderRow } from "@shared/frontend/ui/data-table";

type TabKey = "parts" | "nets" | "labels";
type SortKey = "primary" | "secondary";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

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
  onSelectOnCanvas(sel: {
    partIds?: string[];
    wireIds?: string[];
    labelIds?: string[];
  }): void;
}

interface RenameTarget {
  kind: "part" | "label";
  id: string;
}

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "parts", label: "Parts" },
  { key: "nets", label: "Nets" },
  { key: "labels", label: "Labels" },
];

/** `grid-template-columns` per tab (design D2 §6). */
const TAB_COLS: Record<TabKey, string> = {
  parts: "40px 1fr 80px",
  nets: "1fr 60px",
  labels: "1fr",
};

function headerColumns(tab: TabKey): {
  primary: string;
  secondary?: string;
  tertiary?: string;
} {
  if (tab === "parts")
    return { primary: "Ref", secondary: "Value", tertiary: "Footprint" };
  if (tab === "nets") return { primary: "Net", secondary: "Pins" };
  return { primary: "Label" };
}

export function OutlinePanel({
  state,
  actions,
  onPlaceComponent,
  onAddNetLabel,
  onBrowseLibrary,
  onFrameBoundsMm,
  onSelectOnCanvas,
}: OutlinePanelProps): ReactElement {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("parts");
  const [sort, setSort] = useState<SortState>({ key: "primary", dir: "asc" });
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
  }, [parts, lowerQuery]);

  const filteredNets = useMemo(() => {
    if (!lowerQuery) return nets;
    return nets.filter((net) => net.name.toLowerCase().includes(lowerQuery));
  }, [nets, lowerQuery]);

  const filteredLabels = useMemo(() => {
    if (!lowerQuery) return labels;
    return labels.filter((label) =>
      label.text.toLowerCase().includes(lowerQuery),
    );
  }, [labels, lowerQuery]);

  const dir = sort.dir === "asc" ? 1 : -1;

  const sortedParts = useMemo(() => {
    const arr = [...filteredParts];
    arr.sort((a, b) => {
      if (sort.key === "secondary") {
        const v = partValueLabel(a).localeCompare(
          partValueLabel(b),
          undefined,
          {
            numeric: true,
          },
        );
        if (v !== 0) return v * dir;
        return compareDesignators(a.reference, b.reference) * dir;
      }
      return compareDesignators(a.reference, b.reference) * dir;
    });
    return arr;
  }, [filteredParts, sort.key, dir]);

  const sortedNets = useMemo(() => {
    const arr = [...filteredNets];
    arr.sort((a, b) => {
      if (sort.key === "secondary") {
        const d = a.pinIds.length - b.pinIds.length;
        if (d !== 0) return d * dir;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true }) * dir;
    });
    return arr;
  }, [filteredNets, sort.key, dir]);

  const sortedLabels = useMemo(() => {
    const arr = [...filteredLabels];
    arr.sort(
      (a, b) =>
        a.text.localeCompare(b.text, undefined, { numeric: true }) * dir,
    );
    return arr;
  }, [filteredLabels, dir]);

  const selectTab = (key: TabKey) => {
    setActiveTab(key);
    setSort({ key: "primary", dir: "asc" });
  };

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const selectPart = (partId: string) => {
    actions.setSelectedPartIds(new Set<string>([partId]));
    actions.setSelectedPartId(partId);
    actions.setSelectedLabelId(null);
    actions.setSelectedWireId(null);
    actions.setSelectedPinId(null);
    onSelectOnCanvas({ partIds: [partId] });
  };

  const selectLabel = (labelId: string) => {
    actions.setSelectedPartIds(new Set<string>());
    actions.setSelectedPartId(null);
    actions.setSelectedLabelId(labelId);
    actions.setSelectedWireId(null);
    actions.setSelectedPinId(null);
    onSelectOnCanvas({ labelIds: [labelId] });
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
    // Highlight every wire on the net so the whole net lights up on the canvas.
    onSelectOnCanvas({ wireIds: [...net.wireIds] });
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
        type: "duplicate_part",
        partId: part.id,
        positionNm: duplicateSchematicPositionNm(
          part.positionNm,
          useGridPreferences.getState().schematic.snap,
        ),
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
        positionNm: duplicateSchematicPositionNm(
          label.positionNm,
          useGridPreferences.getState().schematic.snap,
        ),
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

  const cols = headerColumns(activeTab);
  const gridCols = TAB_COLS[activeTab];
  const SortArrow = ({ active }: { active: boolean }): ReactElement | null => {
    if (!active) return null;
    return sort.dir === "asc" ? (
      <ChevronUp className="h-2.5 w-2.5" />
    ) : (
      <ChevronDown className="h-2.5 w-2.5" />
    );
  };

  const activeCount =
    activeTab === "parts"
      ? sortedParts.length
      : activeTab === "nets"
        ? sortedNets.length
        : sortedLabels.length;

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-surface-panel">
      <PanelSectionHeader title="Outline" count={totalCount} />

      <div className="flex h-[26px] shrink-0 items-center gap-1.5 border-b border-border px-2">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter ref, value, net…"
          aria-label="Filter outline"
          containerClassName="h-[20px] min-w-0 flex-1"
        />
        <SegmentedControl
          aria-label="Outline view"
          size="sm"
          options={TABS.map(({ key, label }) => ({ id: key, label }))}
          value={activeTab}
          onChange={selectTab}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {designIsEmpty ? (
          <OutlineEmptyState
            onPlaceComponent={onPlaceComponent}
            onAddNetLabel={onAddNetLabel}
            onBrowseLibrary={onBrowseLibrary}
          />
        ) : (
          <>
            <TableHeaderRow cols={gridCols} className="gap-1.5">
              <button
                type="button"
                onClick={() => toggleSort("primary")}
                className="flex cursor-pointer items-center gap-0.5 text-left uppercase hover:text-text-secondary"
              >
                {cols.primary}
                <SortArrow active={sort.key === "primary"} />
              </button>
              {cols.secondary ? (
                <button
                  type="button"
                  onClick={() => toggleSort("secondary")}
                  className={`flex cursor-pointer items-center gap-0.5 uppercase hover:text-text-secondary ${
                    activeTab === "nets"
                      ? "justify-end pr-5 text-right"
                      : "text-left"
                  }`}
                >
                  {cols.secondary}
                  <SortArrow active={sort.key === "secondary"} />
                </button>
              ) : null}
              {cols.tertiary ? (
                <span className="text-right uppercase">{cols.tertiary}</span>
              ) : null}
            </TableHeaderRow>

            {activeCount === 0 && (
              <p className="px-2.5 py-2 text-2xs text-text-tertiary">
                No {activeTab} match “{query}”.
              </p>
            )}

            {activeTab === "parts" &&
              sortedParts.map((part) => {
                const selected =
                  state.selectedPartId === part.id ||
                  state.selectedPartIds.has(part.id);
                const reference = part.reference || part.id.slice(0, 6);
                return (
                  <OutlineRow
                    key={part.id}
                    cols={gridCols}
                    renameValue={reference}
                    selected={selected}
                    onSelect={() => selectPart(part.id)}
                    onActivate={() => frameToPart(part)}
                    actions={partActions(part)}
                    renaming={
                      renameTarget?.kind === "part" &&
                      renameTarget.id === part.id
                    }
                    onRenameCommit={(value) => void renamePart(part.id, value)}
                    onRenameCancel={() => setRenameTarget(null)}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <ComponentClassIcon
                        part={part}
                        className="h-3 w-3 shrink-0 text-text-tertiary"
                      />
                      <span
                        className="min-w-0 truncate font-mono text-text-strong"
                        title={reference}
                      >
                        {reference}
                      </span>
                    </span>
                    <span
                      className="min-w-0 truncate"
                      title={partValueLabel(part)}
                    >
                      {partValueLabel(part)}
                    </span>
                    <span
                      className="min-w-0 truncate text-right font-mono text-2xs text-text-tertiary"
                      title={part.footprint.name}
                    >
                      {part.footprint.name}
                    </span>
                  </OutlineRow>
                );
              })}

            {activeTab === "nets" &&
              sortedNets.map((net) => {
                const connectionCount = net.pinIds.length;
                const power = isPowerNet(net.name);
                const unconnected =
                  classifyNet(net.name) === "ground" && connectionCount <= 1;
                const isSelected =
                  state.selectedWireId != null &&
                  net.wireIds.includes(state.selectedWireId);
                return (
                  <OutlineRow
                    key={net.id}
                    cols={gridCols}
                    renameValue={net.name}
                    selected={isSelected}
                    onSelect={() => selectNet(net)}
                    onActivate={() => frameToNet(net)}
                    actions={netActions(net)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {power ? (
                        <Zap className="h-3 w-3 shrink-0 text-text-tertiary" />
                      ) : (
                        <Cable className="h-3 w-3 shrink-0 text-text-tertiary" />
                      )}
                      <span
                        className="min-w-0 truncate font-mono text-text-strong"
                        title={net.name}
                      >
                        {net.name}
                      </span>
                    </span>
                    <span
                      className={`truncate pr-5 text-right font-mono text-2xs tabular-nums ${
                        unconnected
                          ? "text-status-warning"
                          : "text-text-tertiary"
                      }`}
                      title={
                        unconnected
                          ? `${connectionCount} pins · unconnected`
                          : `${connectionCount} pins`
                      }
                    >
                      {connectionCount}
                    </span>
                  </OutlineRow>
                );
              })}

            {activeTab === "labels" &&
              sortedLabels.map((label) => {
                const selected = state.selectedLabelId === label.id;
                return (
                  <OutlineRow
                    key={label.id}
                    cols={gridCols}
                    renameValue={label.text}
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
                  >
                    <span className="flex min-w-0 items-center gap-1.5 pr-5">
                      <Tag className="h-3 w-3 shrink-0 text-text-tertiary" />
                      <span
                        className="min-w-0 truncate font-mono text-text-strong"
                        title={label.text}
                      >
                        {label.text}
                      </span>
                    </span>
                  </OutlineRow>
                );
              })}
          </>
        )}
      </div>
    </aside>
  );
}
