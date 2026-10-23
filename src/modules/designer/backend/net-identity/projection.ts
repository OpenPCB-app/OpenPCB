import type { DesignerSchematicProjection } from "../../../../sdks/designer";
import type { SchematicSource } from "../projection-read";
import type { NetComponentsResult } from "../projection-world";
import { bindNetIdentity, type BindInput, type BindResult } from "./bind";
import { requireValid } from "./validation";

export function bindSchematicIdentity(
  source: SchematicSource, derived: NetComponentsResult,
  options: Omit<BindInput, "components" | "pinLabel">,
): { projection: DesignerSchematicProjection; bind: BindResult } {
  const labels = new Map(source.parts.flatMap((part) => part.pins.map((pin) => [
    pin.id, pin.number ? `${part.reference}-${pin.number}` : pin.id,
  ] as const)));
  const bind = bindNetIdentity({ ...options, components: derived.components, pinLabel: (id) => labels.get(id) });
  const ids = new Map(bind.nets.map((net) => [net.legacyRoot, net.id]));
  const netDiagnostics = derived.warnings.map((warning) => {
    const netRoot = ids.get(warning.netRoot);
    requireValid(netRoot !== undefined, "identity.diagnostic", `missing bound net for ${warning.netRoot}`);
    return { ...warning, netRoot };
  });
  return {
    bind,
    projection: {
      designId: source.designId, revision: source.revision,
      parts: source.parts, wires: source.wires,
      labels: source.labels.map((label) => ({ ...label, attached: derived.attachedLabelIds.has(label.id) })),
      primitives: source.primitives.map((primitive) => ({ ...primitive, attached: derived.attachedPrimitiveIds.has(primitive.id) })),
      nets: bind.nets.map((net) => ({
        id: net.id, name: net.name, autoNamed: net.autoNamed,
        pinIds: net.pinIds, wireIds: net.wireIds, labelIds: net.labelIds, primitiveIds: net.primitiveIds,
      })),
      junctions: derived.junctions, netDiagnostics,
    },
  };
}
