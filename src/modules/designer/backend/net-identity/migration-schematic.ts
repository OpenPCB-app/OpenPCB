import type { SchematicSource } from "../projection-read";
import { asRecord } from "../value-guards";
import type { NetIdentityBackupSnapshot } from "./backup";
import { parseStoredJson, requireValid } from "./validation";

function uniqueMapped<T extends { id: string }>(raw: readonly T[], mapped: readonly { id: string }[], path: string): void {
  const ids = new Set(mapped.map((row) => row.id));
  requireValid(raw.length === mapped.length && ids.size === mapped.length && raw.every((row) => ids.has(row.id)),
    path, "canonical schematic source dropped or duplicated persisted rows");
}

/** Parser recovery cannot become authoritative schematic connectivity during migration. */
export function validateMigrationSchematic(snapshot: NetIdentityBackupSnapshot, source: SchematicSource): void {
  const raw = snapshot.schematic;
  uniqueMapped(raw.parts, source.parts, "migration.parts");
  uniqueMapped(raw.pins, source.parts.flatMap((part) => part.pins), "migration.pins");
  uniqueMapped(raw.wires, source.wires, "migration.wires");
  uniqueMapped(raw.labels, source.labels, "migration.labels");
  uniqueMapped(raw.primitives, source.primitives, "migration.primitives");
  const wires = new Map(source.wires.map((wire) => [wire.id, wire]));
  for (const row of raw.wires) {
    const path = `migration.wire.${row.id}.pointsJson`, points = parseStoredJson(row.pointsJson, path);
    requireValid(Array.isArray(points), path, "must be an array of finite points");
    const mapped = wires.get(row.id)!.pointsNm;
    requireValid(points.length === mapped.length, path, "canonical reader changed point count");
    points.forEach((value, index) => {
      const point = asRecord(value), next = mapped[index]!;
      requireValid(point && typeof point.x === "number" && Number.isFinite(point.x) &&
        typeof point.y === "number" && Number.isFinite(point.y) && point.x === next.x && point.y === next.y,
      `${path}[${index}]`, "canonical reader changed or dropped a declared finite point");
    });
  }
  const primitives = new Map(source.primitives.map((primitive) => [primitive.id, primitive]));
  for (const row of raw.primitives) {
    const path = `migration.primitive.${row.id}`, mapped = primitives.get(row.id)!;
    requireValid(row.kind === mapped.kind, path, "canonical reader changed primitive kind");
    if (row.kind !== "pwr" && row.kind !== "net_portal") continue;
    const payload = asRecord(parseStoredJson(row.payloadJson, `${path}.payloadJson`));
    requireValid(payload, path, "naming primitive payload must be a JSON object");
    const field = row.kind === "pwr" ? "railText" : "portalText";
    requireValid(!Object.hasOwn(payload, field) || typeof payload[field] === "string", `${path}.${field}`, "declared naming text must be a string");
  }
}
