import type {
  BomRow,
  DesignerPcbProjection,
  DesignerPlacedPart,
  DesignerSchematicProjection,
} from "../../../../../sdks/designer/types";

/**
 * Bill-of-materials CSV.
 *
 * Output format (JLCPCB / generic-fab compatible):
 *   Comment,Designator,Footprint,LCSC Part #,Manufacturer,MPN,Quantity
 *
 * `Comment` is the part value (e.g. "10k", "100nF", "NE555"). Designator
 * is the comma-joined refdes list ("R1,R2,R3"). Footprint is the library
 * footprint name. Other columns are populated from `propertiesJson` when
 * present and left empty otherwise.
 *
 * Rows are grouped by (value, footprint, mpn) so a row represents one
 * uniquely-orderable line item.
 */

const NL = "\r\n";

interface PartContext {
  value: string;
  footprint: string;
  refdes: string;
  manufacturer: string | null;
  mpn: string | null;
  lcsc: string | null;
}

export function buildBomCsv(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
): string {
  const parts = collectParts(pcb, schematic);
  const rows = aggregateRows(parts);

  const lines: string[] = [];
  lines.push(
    "Comment,Designator,Footprint,LCSC Part #,Manufacturer,MPN,Quantity",
  );
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  return lines.join(NL) + NL;
}

function collectParts(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
): PartContext[] {
  const schematicByRef = new Map<string, DesignerPlacedPart>();
  if (schematic) {
    for (const part of schematic.parts) {
      schematicByRef.set(part.reference, part);
    }
  }

  const out: PartContext[] = [];
  for (const placement of pcb.placements) {
    const schPart = schematicByRef.get(placement.reference);
    const props = schPart?.propertiesJson ?? null;
    out.push({
      value: schPart?.value ?? "",
      footprint: placement.footprint.name,
      refdes: placement.reference,
      manufacturer: readPropString(props, "manufacturer"),
      mpn: readPropString(props, "mpn"),
      lcsc: readPropString(props, "lcsc"),
    });
  }
  return out;
}

function aggregateRows(parts: PartContext[]): BomRow[] {
  const byKey = new Map<string, { row: BomRow; refdesSet: Set<string> }>();
  for (const p of parts) {
    const key = `${p.value}|${p.footprint}|${p.mpn ?? ""}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        row: {
          refdesList: "",
          value: p.value,
          footprint: p.footprint,
          partNumber: p.lcsc,
          quantity: 0,
          manufacturer: p.manufacturer,
          manufacturerPartNumber: p.mpn,
        },
        refdesSet: new Set(),
      };
      byKey.set(key, bucket);
    }
    bucket.refdesSet.add(p.refdes);
  }
  const rows: BomRow[] = [];
  for (const { row, refdesSet } of byKey.values()) {
    const sortedRefs = Array.from(refdesSet).sort(refdesCompare);
    rows.push({
      ...row,
      refdesList: sortedRefs.join(","),
      quantity: sortedRefs.length,
    });
  }
  rows.sort((a, b) => a.refdesList.localeCompare(b.refdesList));
  return rows;
}

function formatRow(row: BomRow): string {
  return [
    csvField(row.value),
    csvField(row.refdesList),
    csvField(row.footprint),
    csvField(row.partNumber ?? ""),
    csvField(row.manufacturer ?? ""),
    csvField(row.manufacturerPartNumber ?? ""),
    String(row.quantity),
  ].join(",");
}

function csvField(s: string): string {
  // Quote any field containing comma, quote, CR, or LF. Escape inner quotes.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function readPropString(
  props: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!props) return null;
  const raw = props[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Sort references alphabetically by their letter prefix, numerically by
 * their numeric suffix: R1 < R2 < R10 < U1.
 */
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
