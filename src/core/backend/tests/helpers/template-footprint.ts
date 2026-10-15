/**
 * Generated-footprint fixtures that do not depend on an IPC family being
 * available: every IPC family is quarantined on the pinned rendering-core
 * (H15 D1), so positive generated-footprint paths use a parametric template.
 */
import { resolveGeneratedFootprint } from "../../../../modules/library/backend/import/resolve-generated-footprint";
import type { GeneratedFootprintMetadata } from "../../../../shared/rendering/ipc7351b";
import type { FootprintRenderSource } from "../../../../shared/rendering/types";

export interface TemplateGenerator {
  kind: "template";
  templateId: string;
  params: Record<string, unknown>;
}

/** A THT pin header (2.54 mm, vertical): `rows × pinsPerRow` pads numbered 1…n. */
export function pinHeaderGenerator(
  rows: number,
  pinsPerRow: number,
): TemplateGenerator {
  return {
    kind: "template",
    templateId: "pin-header",
    params: {
      rows,
      pinsPerRow,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    },
  };
}

/** What the client posts beside the generator: the server's own output, as JSON. */
export function templatePayload(generator: TemplateGenerator): {
  source: FootprintRenderSource;
  metadata: GeneratedFootprintMetadata;
} {
  const resolved = resolveGeneratedFootprint({ generator });
  return JSON.parse(
    JSON.stringify({ source: resolved.source, metadata: resolved.metadata }),
  );
}
