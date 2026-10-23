import type { DesignerSchematicProjection, ErcAnchor } from "../../../../sdks";
import { pointBoundsMm, type BoundsMm } from "./OutlinePanel/bounds";

/** Ports can be framed even though external canvas selection has no port field. */
export function detachedErcAnchorTarget(
  anchor: Extract<ErcAnchor, { kind: "label" | "primitive" }>,
  projection: DesignerSchematicProjection,
): {
  selection: { labelIds?: string[] };
  bounds: BoundsMm;
  label: string;
} | null {
  if (anchor.kind === "label") {
    const label = projection.labels.find((item) => item.id === anchor.labelId);
    if (!label) return null;
    return {
      selection: { labelIds: [label.id] },
      bounds: pointBoundsMm(label.positionNm),
      label: label.text,
    };
  }
  const primitive = projection.primitives.find(
    (item) => item.id === anchor.primitiveId,
  );
  if (!primitive) return null;
  const label =
    primitive.kind === "pwr"
      ? primitive.railText
      : primitive.kind === "net_portal"
        ? primitive.portalText
        : primitive.kind === "gnd"
          ? "GND"
          : "Junction";
  return { selection: {}, bounds: pointBoundsMm(primitive.positionNm), label };
}
