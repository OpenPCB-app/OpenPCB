/**
 * Insert schematic entities for a KiCad project import.
 *
 * Inputs: parsed schematic sheets (flattened across hierarchical sheets) +
 * componentId-by-refdes map produced by ingest-library.
 *
 * Inserts directly into the designer schema (`schematicParts`, `schematicPins`,
 * `schematicLabels`, `schematicWires`, `schematicPrimitives`). The caller wraps
 * this in the same transaction as the design-head insert so failures roll back.
 *
 * Wire endpoints are matched to pin world positions; when both endpoints map
 * to known pins, a wire row is written. Otherwise the wire is dropped with a
 * warning — KiCad uses absolute mm coordinates and we map straight to nm.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerPin,
  DesignerPrimitive,
  KicadProjectImportWarning,
} from "../../../../../sdks/designer";
import type {
  LibraryComponentPlacementDetail,
  LibrarySymbolPinSnapshot,
} from "../../../../../sdks/library";
import { insertPart, insertWire } from "../../command-executor";
import {
  normalizeRotationDeg,
  recomputePinWorldPositions,
  transformLocalPointNm,
} from "../../commands/place-part";
import { insertPrimitiveRow, primitivePinId } from "../../primitive-store";
import { schematicLabels } from "../../schema";
import type {
  ParsedKicadSchematic,
  ParsedKicadSchPoint,
  ParsedKicadSchPowerSymbol,
} from "../../../../library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import type { PersistedPartPayload } from "../../payload-types";

const NM_PER_MM = 1_000_000;

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

export interface SchematicInsertResult {
  partsInserted: number;
  wiresInserted: number;
  wiresDropped: number;
  labelsInserted: number;
  primitivesInserted: number;
  warnings: KicadProjectImportWarning[];
  /** Map of refdes → inserted partId (used by the PCB insert phase). */
  partIdByRefdes: Map<string, string>;
  /** Map of (xNm,yNm) → pinId for wire matching + PCB pad correlation. */
  pinIdByWorldKey: Map<string, string>;
}

export interface SchematicInsertOptions {
  designId: string;
  schematics: ParsedKicadSchematic[];
  /** Resolved componentId for each schematic refdes (from ingest-library). */
  componentByRefdes: Map<string, string>;
  /**
   * Pre-resolved placement details (symbol + footprint + pins) keyed by
   * componentId. The caller fetches these from LibrarySDK outside the
   * transaction so this inserter can stay fully synchronous.
   */
  placementDetailByComponentId: Map<
    string,
    LibraryComponentPlacementDetail | null
  >;
}

export function insertSchematicEntities(
  tx: DbClient,
  options: SchematicInsertOptions,
  timestamp: string,
): SchematicInsertResult {
  const result: SchematicInsertResult = {
    partsInserted: 0,
    wiresInserted: 0,
    wiresDropped: 0,
    labelsInserted: 0,
    primitivesInserted: 0,
    warnings: [],
    partIdByRefdes: new Map(),
    pinIdByWorldKey: new Map(),
  };

  // Cache LibraryComponentPlacementDetail per componentId; lookup is async and
  // we may have multiple part instances of the same component.
  const detailCache = new Map<string, LibraryComponentPlacementDetail>();

  // Position indexes for the wire-stitching resolver below.
  const labelTextByWorldKey = new Map<string, string>();
  const junctionWorldKeys = new Set<string>();

  // Count instances per refdes — used to detect multi-unit symbols so we can
  // suffix the secondary units' refdes (e.g. U1, U1B, U1C, U1D for an LM324).
  // KiCad allows `(property "Reference" "U1")` on every unit instance, which
  // would violate OpenPCB's UNIQUE(designId, reference) — disambiguate here.
  const refdesInstanceCount = new Map<string, number>();
  for (const sheet of options.schematics) {
    for (const symbol of sheet.symbols) {
      refdesInstanceCount.set(
        symbol.reference,
        (refdesInstanceCount.get(symbol.reference) ?? 0) + 1,
      );
    }
  }
  const refdesAssignedCount = new Map<string, number>();

  // ─── Parts + pins ───
  for (const sheet of options.schematics) {
    for (const symbol of sheet.symbols) {
      const componentId = options.componentByRefdes.get(symbol.reference);
      if (!componentId) {
        result.warnings.push({
          code: "schematic_part_skipped_no_component",
          severity: "warning",
          message: `Skipped symbol ${symbol.reference} (${symbol.libId}): no library component resolved.`,
        });
        continue;
      }
      let detail = detailCache.get(componentId);
      if (!detail) {
        const resolved =
          options.placementDetailByComponentId.get(componentId) ?? null;
        if (!resolved) {
          result.warnings.push({
            code: "schematic_part_detail_unavailable",
            severity: "warning",
            message: `Library component ${componentId} for ${symbol.reference} returned no placement detail.`,
          });
          continue;
        }
        detail = resolved;
        detailCache.set(componentId, resolved);
      }

      const partId = crypto.randomUUID();
      const positionNm = {
        x: Math.round(symbol.at.xMm * NM_PER_MM),
        y: Math.round(symbol.at.yMm * NM_PER_MM),
      };
      // KiCad rotation is degrees CCW. OpenPCB stores 0|90|180|270.
      const rotationDeg = normalizeRotationDeg(symbol.rotationDeg);
      const mirrored = false;

      // Multi-unit handling: filter library pins to those belonging to this
      // instance's unit (and any always-shared unit 0). If the library only
      // has unit-1 pins (single-unit symbol) the filter falls back to all
      // pins — preserving v1 behavior for non-multi-unit parts.
      const availableUnits = new Set(detail.symbol.pins.map((p) => p.unit));
      const isMultiUnit = availableUnits.size > 1;
      const filteredPins = isMultiUnit
        ? detail.symbol.pins.filter(
            (p) => p.unit === symbol.unit || p.unit === 0,
          )
        : detail.symbol.pins;

      const pins: DesignerPin[] = filteredPins.map(
        (pin: LibrarySymbolPinSnapshot) => {
          const localXNm = Math.round(pin.localPositionMm.x * NM_PER_MM);
          const localYNm = Math.round(pin.localPositionMm.y * NM_PER_MM);
          const transformed = transformLocalPointNm(
            { x: localXNm, y: localYNm },
            rotationDeg,
            mirrored,
          );
          const pinId = `${partId}:${pin.originPinKey}`;
          const worldX = positionNm.x + transformed.x;
          const worldY = positionNm.y + transformed.y;
          result.pinIdByWorldKey.set(worldKey(worldX, worldY), pinId);
          return {
            id: pinId,
            originPinKey: pin.originPinKey,
            number: pin.number,
            name: pin.name,
            electricalType: pin.electricalType,
            unit: pin.unit,
            localPositionNm: { x: localXNm, y: localYNm },
            worldPositionNm: { x: worldX, y: worldY },
          };
        },
      );

      // Disambiguate refdes for multi-unit instances. KLC-style unit suffix:
      // unit 1 → no suffix, 2 → "B", 3 → "C", … up to 26 → "Z". Beyond Z we
      // fall back to numeric "_U27" suffixes (extremely rare).
      const totalInstances = refdesInstanceCount.get(symbol.reference) ?? 1;
      const seenIdx = refdesAssignedCount.get(symbol.reference) ?? 0;
      refdesAssignedCount.set(symbol.reference, seenIdx + 1);
      const needsUnitSuffix = isMultiUnit && totalInstances > 1;
      const effectiveReference = needsUnitSuffix
        ? unitSuffixed(symbol.reference, symbol.unit)
        : symbol.reference;

      const payload: PersistedPartPayload = {
        id: partId,
        componentId,
        reference: effectiveReference,
        value: symbol.value ?? "",
        rotationDeg,
        mirrored,
        positionNm,
        symbol: detail.symbol,
        footprint: detail.footprint,
        pins,
        propertiesJson: JSON.stringify(symbol.properties ?? {}),
      };
      insertPart(tx, options.designId, payload, timestamp);
      result.partsInserted += 1;
      // PCB inserter matches placements by the original (KiCad) refdes; both
      // the bare refdes and the unit-suffixed effective reference map to the
      // first inserted partId so refdes lookups stay deterministic.
      if (!result.partIdByRefdes.has(symbol.reference)) {
        result.partIdByRefdes.set(symbol.reference, partId);
      }
      result.partIdByRefdes.set(effectiveReference, partId);
    }

    // ─── Labels ───
    // Hierarchical labels behave like global labels for cross-sheet net
    // continuity (KiCad spec — string equality on net name). Include them
    // here so the inserter and wire-stitching resolver pick them up.
    const hierarchical = sheet.hierarchicalLabels ?? [];
    // Index labels by world position so wire endpoints can anchor against
    // them in the multi-step resolver below.
    for (const label of [
      ...sheet.labels,
      ...sheet.globalLabels,
      ...hierarchical,
    ]) {
      if (!label.text.trim()) continue;
      const positionNm = mmPointToNm(label.at);
      tx.insert(schematicLabels)
        .values({
          id: crypto.randomUUID(),
          designId: options.designId,
          text: label.text,
          xNm: positionNm.x,
          yNm: positionNm.y,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      result.labelsInserted += 1;
      labelTextByWorldKey.set(worldKey(positionNm.x, positionNm.y), label.text);
    }

    // ─── Junctions ───
    for (const junction of sheet.junctions) {
      const positionNm = mmPointToNm(junction.at);
      junctionWorldKeys.add(worldKey(positionNm.x, positionNm.y));
    }

    // ─── Power symbols → primitives ───
    for (const power of sheet.powerSymbols) {
      const primitive = powerSymbolToPrimitive(power);
      if (!primitive) continue;
      insertPrimitiveRow(tx, options.designId, primitive, timestamp);
      result.primitivesInserted += 1;
      // Power symbols are pin-bearing primitives too; let wires anchor to
      // them by world position (they are net sources for GND / VCC / etc.).
      result.pinIdByWorldKey.set(
        worldKey(primitive.positionNm.x, primitive.positionNm.y),
        primitivePinId(primitive.id),
      );
    }
  }

  // ─── Wires ───
  //
  // Multi-step endpoint resolver: pin world match → label position → junction
  // position → other wire's endpoint → synthetic net_portal anchor. Each
  // synthetic anchor is materialized as a `net_portal` primitive carrying any
  // co-located label text so the projection's net extractor names the net
  // correctly. Goal: zero wires dropped on real-world projects.
  const anchorByKey = new Map<string, string>(result.pinIdByWorldKey);
  const synthesizedAnchors: { reason: string; count: number }[] = [
    { reason: "label", count: 0 },
    { reason: "junction", count: 0 },
    { reason: "wire-joint", count: 0 },
    { reason: "floating", count: 0 },
  ];

  // Pre-index wire endpoints across sheets so a single synthetic anchor can
  // serve multiple wire ends sharing a coordinate (T-joints).
  const allWireEndpointsKey = new Set<string>();
  for (const sheet of options.schematics) {
    for (const wire of sheet.wires) {
      if (wire.points.length < 2) continue;
      const s = wire.points[0]!;
      const t = wire.points[wire.points.length - 1]!;
      allWireEndpointsKey.add(
        worldKey(Math.round(s.xMm * NM_PER_MM), Math.round(s.yMm * NM_PER_MM)),
      );
      allWireEndpointsKey.add(
        worldKey(Math.round(t.xMm * NM_PER_MM), Math.round(t.yMm * NM_PER_MM)),
      );
    }
  }

  function resolveOrCreateAnchor(pointNm: { x: number; y: number }): {
    pinId: string;
    reason: "pin" | "label" | "junction" | "wire-joint" | "floating";
  } {
    const key = worldKey(pointNm.x, pointNm.y);
    const cached = anchorByKey.get(key);
    if (cached) {
      return { pinId: cached, reason: "pin" };
    }
    const labelText = labelTextByWorldKey.get(key);
    const isJunction = junctionWorldKeys.has(key);
    const isWireJoint = allWireEndpointsKey.has(key);

    // Choose category for the synthetic anchor (used for portalText + stats).
    const reason: "label" | "junction" | "wire-joint" | "floating" = labelText
      ? "label"
      : isJunction
        ? "junction"
        : isWireJoint
          ? "wire-joint"
          : "floating";

    const primitive = {
      id: crypto.randomUUID(),
      kind: "net_portal" as const,
      positionNm: pointNm,
      rotationDeg: 0 as 0 | 90 | 180 | 270,
      portalText: labelText ?? "",
    };
    insertPrimitiveRow(tx, options.designId, primitive, timestamp);
    result.primitivesInserted += 1;
    const pinId = primitivePinId(primitive.id);
    anchorByKey.set(key, pinId);
    const slot = synthesizedAnchors.find((s) => s.reason === reason)!;
    slot.count += 1;
    return { pinId, reason };
  }

  for (const sheet of options.schematics) {
    for (const wire of sheet.wires) {
      if (wire.points.length < 2) {
        result.wiresDropped += 1;
        continue;
      }
      const sourcePt = wire.points[0]!;
      const targetPt = wire.points[wire.points.length - 1]!;
      const sourceNm = {
        x: Math.round(sourcePt.xMm * NM_PER_MM),
        y: Math.round(sourcePt.yMm * NM_PER_MM),
      };
      const targetNm = {
        x: Math.round(targetPt.xMm * NM_PER_MM),
        y: Math.round(targetPt.yMm * NM_PER_MM),
      };
      const sourceAnchor = resolveOrCreateAnchor(sourceNm);
      const targetAnchor = resolveOrCreateAnchor(targetNm);
      // Degenerate self-loop (source == target after anchor resolve) — skip
      // so we don't violate any future cycle-detection in net extraction.
      if (sourceAnchor.pinId === targetAnchor.pinId) {
        result.wiresDropped += 1;
        continue;
      }
      const pointsNm = wire.points.map((p) => ({
        x: Math.round(p.xMm * NM_PER_MM),
        y: Math.round(p.yMm * NM_PER_MM),
      }));
      insertWire(
        tx,
        options.designId,
        {
          id: crypto.randomUUID(),
          sourcePinId: sourceAnchor.pinId,
          targetPinId: targetAnchor.pinId,
          pointsNm,
        },
        timestamp,
      );
      result.wiresInserted += 1;
    }
  }
  for (const slot of synthesizedAnchors) {
    if (slot.count > 0) {
      result.warnings.push({
        code: `wire_anchor_synthesized_${slot.reason}`,
        severity: slot.reason === "floating" ? "warning" : "info",
        message: `Created ${slot.count} synthetic net_portal anchor(s) for wire endpoints anchored to ${slot.reason}.`,
      });
    }
  }
  if (result.wiresDropped > 0) {
    result.warnings.push({
      code: "wires_dropped_degenerate",
      severity: "warning",
      message: `Dropped ${result.wiresDropped} degenerate wire(s) (zero points or self-loop after anchor resolution).`,
    });
  }

  // Silence unused-export hint; recomputePinWorldPositions is reserved for a
  // future refactor that re-uses the existing helper rather than the local
  // transform call above.
  void recomputePinWorldPositions;

  return result;
}

function unitSuffixed(reference: string, unit: number): string {
  // KLC S3.8: unit 1 = no suffix, unit 2 = "B", unit 3 = "C", … unit 26 = "Z".
  // Fall back to "_U<n>" for the rare >26-unit case.
  if (unit <= 1) return reference;
  if (unit <= 26) {
    const suffix = String.fromCharCode(65 + (unit - 1)); // 65 = 'A'
    return `${reference}${suffix}`;
  }
  return `${reference}_U${unit}`;
}

function mmPointToNm(p: ParsedKicadSchPoint): { x: number; y: number } {
  return {
    x: Math.round(p.xMm * NM_PER_MM),
    y: Math.round(p.yMm * NM_PER_MM),
  };
}

function worldKey(xNm: number, yNm: number): string {
  // Quantize to 0.1 mm (100_000 nm). KiCad coords are exact mm; OpenPCB pins
  // come from float mm and may have rounding noise → loose tolerance.
  const grain = 100_000;
  const qx = Math.round(xNm / grain) * grain;
  const qy = Math.round(yNm / grain) * grain;
  return `${qx},${qy}`;
}

function powerSymbolToPrimitive(
  power: ParsedKicadSchPowerSymbol,
): DesignerPrimitive | null {
  const positionNm = mmPointToNm(power.at);
  const rotationDeg = normalizeRotationDeg(power.rotationDeg);
  // Canonical ground only. Variants like GND1 / GNDA / GNDREF stay distinct
  // nets (they fall through to a named PWR rail), since the projection now
  // globally unions every "GND" port into a single net.
  const lowerName = power.netName.trim().toLowerCase();
  const isGnd = lowerName === "gnd" || lowerName === "ground";
  if (isGnd) {
    return {
      id: crypto.randomUUID(),
      kind: "gnd",
      positionNm,
      rotationDeg,
    };
  }
  return {
    id: crypto.randomUUID(),
    kind: "pwr",
    positionNm,
    rotationDeg,
    railText: power.netName,
  };
}
