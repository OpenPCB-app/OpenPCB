import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  DesignerPin,
  DesignerPrimitive,
  DesignerPrimitiveKind,
} from "../../../sdks";
import { schematicPrimitives } from "./schema";
import { asRecord, asString, parseJsonRecord } from "./value-guards";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;
type PrimitiveRow = typeof schematicPrimitives.$inferSelect;

export const PRIMITIVE_PIN_PREFIX = "primitive:";

export function isPrimitivePinId(pinId: string): boolean {
  return pinId.startsWith(PRIMITIVE_PIN_PREFIX);
}

export function primitiveIdFromPinId(pinId: string): string {
  return pinId.slice(PRIMITIVE_PIN_PREFIX.length);
}

export function primitivePinId(primitiveId: string): string {
  return `${PRIMITIVE_PIN_PREFIX}${primitiveId}`;
}

// Synthetic single-pin "Pin" used by the wire system. Primitives have a
// connection point at local (0, 0); since rotation pivots around that point,
// the world position equals the primitive's position regardless of rotation.
export function primitiveAsPin(primitive: DesignerPrimitive): DesignerPin {
  const id = primitivePinId(primitive.id);
  return {
    id,
    originPinKey: id,
    number: null,
    name: primitive.kind,
    electricalType: "passive",
    unit: 1,
    localPositionNm: { x: 0, y: 0 },
    worldPositionNm: { ...primitive.positionNm },
  };
}

function isPrimitiveKind(value: string): value is DesignerPrimitiveKind {
  return value === "gnd" || value === "pwr" || value === "net_portal";
}

function mapPrimitiveRow(row: PrimitiveRow): DesignerPrimitive | null {
  if (!isPrimitiveKind(row.kind)) {
    // Surface corrupt/typo'd rows in logs rather than silently dropping them
    // from the projection — invisible data loss is the worst outcome here.
    console.warn(
      `[designer.primitives] dropping row with unknown kind "${row.kind}" (id=${row.id}, designId=${row.designId})`,
    );
    return null;
  }
  const payload = parseJsonRecord(row.payloadJson);
  const base = {
    id: row.id,
    positionNm: { x: row.positionXNm, y: row.positionYNm },
    rotationDeg: row.rotationDeg,
  };
  if (row.kind === "gnd") {
    return { ...base, kind: "gnd" };
  }
  if (row.kind === "pwr") {
    const railText = asString(payload.railText) ?? "";
    return { ...base, kind: "pwr", railText };
  }
  const portalText = asString(payload.portalText) ?? "";
  return { ...base, kind: "net_portal", portalText };
}

export function loadPrimitives(
  db: DbClient,
  designId: string,
): DesignerPrimitive[] {
  const rows = db
    .select()
    .from(schematicPrimitives)
    .where(eq(schematicPrimitives.designId, designId))
    .all();
  return rows
    .map(mapPrimitiveRow)
    .filter((primitive): primitive is DesignerPrimitive => primitive !== null);
}

export function serializePrimitivePayload(
  primitive: DesignerPrimitive,
): string {
  if (primitive.kind === "gnd") return JSON.stringify({});
  if (primitive.kind === "pwr")
    return JSON.stringify({ railText: primitive.railText });
  return JSON.stringify({ portalText: primitive.portalText });
}

export function insertPrimitiveRow(
  tx: DbClient,
  designId: string,
  primitive: DesignerPrimitive,
  timestamp: string,
): void {
  tx.insert(schematicPrimitives)
    .values({
      id: primitive.id,
      designId,
      kind: primitive.kind,
      positionXNm: primitive.positionNm.x,
      positionYNm: primitive.positionNm.y,
      rotationDeg: primitive.rotationDeg,
      payloadJson: serializePrimitivePayload(primitive),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function loadPrimitiveById(
  db: DbClient,
  designId: string,
  primitiveId: string,
): DesignerPrimitive | null {
  // `id` is the primary key, so .get() returns at most one row. The designId
  // check guards against a primitive being addressed from the wrong design.
  const row = db
    .select()
    .from(schematicPrimitives)
    .where(eq(schematicPrimitives.id, primitiveId))
    .get();
  if (!row || row.designId !== designId) return null;
  return mapPrimitiveRow(row);
}

export function asPrimitiveFromPayload(
  value: unknown,
): DesignerPrimitive | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = asString(record.kind);
  if (!kind || !isPrimitiveKind(kind)) return null;
  const id = asString(record.id);
  if (!id) return null;
  const position = asRecord(record.positionNm);
  const x = position ? Number(position.x) : Number.NaN;
  const y = position ? Number(position.y) : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rotationDeg = Number(record.rotationDeg);
  const base = {
    id,
    positionNm: { x, y },
    rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0,
  };
  if (kind === "gnd") return { ...base, kind: "gnd" };
  if (kind === "pwr") {
    const railText = asString(record.railText) ?? "";
    return { ...base, kind: "pwr", railText };
  }
  const portalText = asString(record.portalText) ?? "";
  return { ...base, kind: "net_portal", portalText };
}
