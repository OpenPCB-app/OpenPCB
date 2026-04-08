import { SchematicCanvasR3F } from "@/lib/render-engine/adapters/SchematicCanvasR3F";
import type { SchematicInteractionController } from "../useSchematicInteractionController";

interface SchematicCanvasProps {
  controller?: SchematicInteractionController;
}

export function SchematicCanvas({ controller }: SchematicCanvasProps) {
  return <SchematicCanvasR3F controller={controller} />;
}
