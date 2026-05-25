import type {
  BomLine,
  BomLineRef,
  BomOverride,
  BomProjection,
  BomRow,
  DesignerPcbProjection,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  PartPropertiesJson,
  PcbPlacedPart,
} from "../../../../../sdks/designer/types";

const NL = "\r\n";

interface PartContext {
  value: string;
  footprint: string;
  refdes: string;
  partId: string | null;
  placementId: string | null;
  pcbLayer: "top" | "bottom" | null;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  lcscPartNumber: string | null;
  supplier: string | null;
  unitPrice: number | null;
  currency: string | null;
  dnp: boolean;
  assemblySide: "top" | "bottom" | null;
  notes: string | null;
  warnings: string[];
}

export function buildBomProjection(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[] = [],
): BomProjection {
  const parts = collectParts(pcb, schematic, overrides);
  const rows = aggregateRows(parts);
  const warnings = rows.flatMap((row) => row.warnings);
  const activeRows = rows.filter((row) => !row.dnp);
  const currencies = new Set(
    activeRows
      .map((row) => row.currency)
      .filter((currency): currency is string => !!currency),
  );
  const allPriced = activeRows.every((row) => row.unitPrice !== null);
  const estimatedCost =
    activeRows.length > 0 && allPriced && currencies.size <= 1
      ? activeRows.reduce(
          (sum, row) => sum + (row.unitPrice ?? 0) * row.quantity,
          0,
        )
      : null;
  return {
    designId: pcb.designId,
    revision: Math.max(pcb.revision, schematic?.revision ?? pcb.revision),
    rows,
    summary: {
      lineCount: rows.length,
      partCount: rows.reduce((sum, row) => sum + row.quantity, 0),
      activePartCount: activeRows.reduce((sum, row) => sum + row.quantity, 0),
      dnpPartCount: rows
        .filter((row) => row.dnp)
        .reduce((sum, row) => sum + row.quantity, 0),
      missingRequiredCount: rows.filter((row) => row.warnings.length > 0).length,
      estimatedCost,
      currency: currencies.size === 1 ? Array.from(currencies)[0]! : null,
    },
    warnings,
  };
}

export function buildBomRows(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[] = [],
): BomLine[] {
  return buildBomProjection(pcb, schematic, overrides).rows;
}

export function buildBomCsv(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[] = [],
): string {
  const rows = buildBomRows(pcb, schematic, overrides).filter((row) => !row.dnp);
  const lines = [
    "Comment,Designator,Footprint,LCSC Part #,Manufacturer,MPN,Quantity,DNP,Assembly Side,Unit Price,Currency,Notes",
  ];
  for (const row of rows) {
    lines.push(formatBomCsvRow(row));
  }
  return lines.join(NL) + NL;
}

export function buildBomTsv(rows: readonly BomLine[]): string {
  const lines = [
    [
      "Designators",
      "Qty",
      "Value",
      "Footprint",
      "Manufacturer",
      "MPN",
      "LCSC/JLC",
      "DNP",
      "Assembly Side",
      "Unit Price",
      "Currency",
      "Notes",
    ].join("\t"),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.refdesList,
        String(row.quantity),
        row.value,
        row.footprint,
        row.manufacturer ?? "",
        row.manufacturerPartNumber ?? "",
        row.lcscPartNumber ?? "",
        row.dnp ? "yes" : "no",
        row.assemblySide ?? "",
        row.unitPrice?.toString() ?? "",
        row.currency ?? "",
        row.notes ?? "",
      ]
        .map(tsvField)
        .join("\t"),
    );
  }
  return lines.join(NL) + NL;
}

export function buildJlcBomCsv(rows: readonly BomLine[]): string {
  const lines = ["Comment,Designator,Footprint,LCSC Part #,Quantity"];
  for (const row of rows.filter((candidate) => !candidate.dnp)) {
    lines.push(
      [
        csvField(row.value),
        csvField(row.refdesList),
        csvField(row.footprint),
        csvField(row.lcscPartNumber ?? ""),
        String(row.quantity),
      ].join(","),
    );
  }
  return lines.join(NL) + NL;
}

export function buildKicadBomCsv(rows: readonly BomLine[]): string {
  const lines = [
    "References,Value,Footprint,Quantity,Manufacturer,MPN,LCSC,DNP,Notes",
  ];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.refdesList),
        csvField(row.value),
        csvField(row.footprint),
        String(row.quantity),
        csvField(row.manufacturer ?? ""),
        csvField(row.manufacturerPartNumber ?? ""),
        csvField(row.lcscPartNumber ?? ""),
        row.dnp ? "1" : "0",
        csvField(row.notes ?? ""),
      ].join(","),
    );
  }
  return lines.join(NL) + NL;
}

export function toLegacyBomRows(rows: readonly BomLine[]): BomRow[] {
  return rows.map((row) => ({
    refdesList: row.refdesList,
    value: row.value,
    footprint: row.footprint,
    partNumber: row.lcscPartNumber,
    quantity: row.quantity,
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturerPartNumber,
  }));
}

function collectParts(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  overrides: readonly BomOverride[],
): PartContext[] {
  const overrideByRef = new Map(overrides.map((o) => [o.refdes, o]));
  const placementsByRef = new Map<string, PcbPlacedPart>();
  for (const placement of pcb.placements) {
    placementsByRef.set(placement.reference, placement);
  }

  const schematicParts = schematic?.parts ?? [];
  const refOrder = new Set<string>();
  for (const part of schematicParts) refOrder.add(part.reference);
  for (const placement of pcb.placements) refOrder.add(placement.reference);

  const schematicByRef = new Map<string, DesignerPlacedPart>();
  for (const part of schematicParts) schematicByRef.set(part.reference, part);

  const out: PartContext[] = [];
  for (const refdes of refOrder) {
    const schPart = schematicByRef.get(refdes) ?? null;
    const placement = placementsByRef.get(refdes) ?? null;
    const override = overrideByRef.get(refdes) ?? null;
    const props = schPart?.propertiesJson ?? null;
    const manufacturer = coalesce(
      override?.manufacturer,
      readPropString(props, "manufacturer"),
    );
    const manufacturerPartNumber = coalesce(
      override?.manufacturerPartNumber,
      readPropString(props, "manufacturerPartNumber"),
      readPropString(props, "mpn"),
    );
    const lcscPartNumber = coalesce(
      override?.lcscPartNumber,
      readPropString(props, "lcscPartNumber"),
      readPropString(props, "lcsc"),
      readPropString(props, "jlc"),
    );
    const footprint = placement?.footprint.name ?? schPart?.footprint.name ?? "";
    const value = schPart?.value ?? "";
    const dnp = override?.dnp ?? readPropBoolean(props, "dnp") ?? false;
    const assemblySide = override?.assemblySide ?? pcbSide(placement) ?? null;
    const warnings: string[] = [];
    if (!footprint) warnings.push(`${refdes}: missing footprint`);
    if (!manufacturerPartNumber && !lcscPartNumber) {
      warnings.push(`${refdes}: missing MPN or LCSC/JLC part number`);
    }
    out.push({
      value,
      footprint,
      refdes,
      partId: schPart?.id ?? null,
      placementId: placement?.id ?? null,
      pcbLayer: pcbSide(placement),
      manufacturer,
      manufacturerPartNumber,
      lcscPartNumber,
      supplier: override?.supplier ?? readPropString(props, "supplier"),
      unitPrice: override?.unitPrice ?? readPropNumber(props, "unitPrice"),
      currency: override?.currency ?? readPropString(props, "currency"),
      dnp,
      assemblySide,
      notes: override?.notes ?? readPropString(props, "notes"),
      warnings,
    });
  }
  return out;
}

function aggregateRows(parts: readonly PartContext[]): BomLine[] {
  const byKey = new Map<string, { first: PartContext; refs: BomLineRef[]; warnings: string[] }>();
  for (const part of parts) {
    const key = [
      part.value,
      part.footprint,
      part.manufacturerPartNumber ?? "",
      part.lcscPartNumber ?? "",
      part.dnp ? "dnp" : "active",
    ].join("|");
    const existing = byKey.get(key);
    const ref: BomLineRef = {
      refdes: part.refdes,
      partId: part.partId,
      placementId: part.placementId,
      pcbLayer: part.pcbLayer,
      dnp: part.dnp,
    };
    if (existing) {
      existing.refs.push(ref);
      existing.warnings.push(...part.warnings);
    } else {
      byKey.set(key, { first: part, refs: [ref], warnings: [...part.warnings] });
    }
  }

  const rows: BomLine[] = [];
  for (const bucket of byKey.values()) {
    const refs = [...bucket.refs].sort((a, b) => refdesCompare(a.refdes, b.refdes));
    const sides = new Set(
      refs.map((ref) => ref.pcbLayer).filter((side): side is "top" | "bottom" => !!side),
    );
    rows.push({
      id: refs.map((ref) => ref.refdes).join("_"),
      refs,
      refdesList: refs.map((ref) => ref.refdes).join(","),
      value: bucket.first.value,
      footprint: bucket.first.footprint,
      quantity: refs.length,
      manufacturer: bucket.first.manufacturer,
      manufacturerPartNumber: bucket.first.manufacturerPartNumber,
      lcscPartNumber: bucket.first.lcscPartNumber,
      supplier: bucket.first.supplier,
      unitPrice: bucket.first.unitPrice,
      currency: bucket.first.currency,
      dnp: bucket.first.dnp,
      assemblySide:
        bucket.first.assemblySide ??
        (sides.size === 1 ? Array.from(sides)[0]! : sides.size > 1 ? "mixed" : null),
      notes: bucket.first.notes,
      warnings: bucket.warnings,
    });
  }
  rows.sort((a, b) => refdesCompare(a.refs[0]?.refdes ?? "", b.refs[0]?.refdes ?? ""));
  return rows;
}

function formatBomCsvRow(row: BomLine): string {
  return [
    csvField(row.value),
    csvField(row.refdesList),
    csvField(row.footprint),
    csvField(row.lcscPartNumber ?? ""),
    csvField(row.manufacturer ?? ""),
    csvField(row.manufacturerPartNumber ?? ""),
    String(row.quantity),
    row.dnp ? "yes" : "no",
    row.assemblySide ?? "",
    row.unitPrice?.toString() ?? "",
    row.currency ?? "",
    csvField(row.notes ?? ""),
  ].join(",");
}

function pcbSide(placement: PcbPlacedPart | null): "top" | "bottom" | null {
  if (!placement) return null;
  return placement.layer === "B.Cu" ? "bottom" : "top";
}

function coalesce(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function csvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function tsvField(s: string): string {
  return s.replace(/[\t\r\n]+/g, " ").trim();
}

function readPropString(
  props: PartPropertiesJson | null,
  key: string,
): string | null {
  if (!props) return null;
  const raw = props[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readPropNumber(
  props: PartPropertiesJson | null,
  key: string,
): number | null {
  if (!props) return null;
  const raw = props[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readPropBoolean(
  props: PartPropertiesJson | null,
  key: string,
): boolean | null {
  if (!props) return null;
  const raw = props[key];
  return typeof raw === "boolean" ? raw : null;
}

function refdesCompare(a: string, b: string): number {
  const ra = splitRefdes(a);
  const rb = splitRefdes(b);
  if (ra.prefix !== rb.prefix) return ra.prefix.localeCompare(rb.prefix);
  return ra.number - rb.number;
}

function splitRefdes(ref: string): { prefix: string; number: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return { prefix: ref, number: 0 };
  return { prefix: m[1]!, number: Number.parseInt(m[2]!, 10) };
}
