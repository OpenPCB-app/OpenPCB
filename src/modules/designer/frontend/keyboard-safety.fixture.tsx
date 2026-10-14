import { useState } from "react";
import { Select } from "@shared/frontend/ui/select";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  DesignerSchematicProjection,
} from "../../../sdks";
import { PcbCanvas } from "./pcb/PcbCanvas";
import { SchematicCanvas } from "./components/SchematicCanvas";
import type { DesignerWorkspaceActions } from "./hooks/useDesignerWorkspace";

const schematic: DesignerSchematicProjection = {
  designId: "keyboard-fixture",
  revision: 1,
  parts: [],
  wires: [],
  labels: [],
  primitives: [
    { id: "ground", kind: "gnd", positionNm: { x: 0, y: 0 }, rotationDeg: 0 },
  ],
  junctions: [],
  nets: [],
};
async function dispatch(
  command: DesignerCommand,
): Promise<DesignerDispatchResult> {
  const response = await fetch("/api/h06/command", {
    method: "POST",
    body: JSON.stringify(command),
  });
  return response.json() as Promise<DesignerDispatchResult>;
}
const actions = {
  dispatchCommand: dispatch,
  dispatchCommandsBatch: async (commands: DesignerCommand[]) => {
    for (const command of commands) await dispatch(command);
  },
  setSelectedPartId: () => {},
  setSelectedPartIds: () => {},
  setSelectedLabelId: () => {},
  setSelectedWireId: () => {},
  setSelectedPinId: () => {},
  setWireSourcePinId: () => {},
  setError: () => {},
} as unknown as DesignerWorkspaceActions;
const request = { placementIds: ["placement"], nonce: 1 };

export function KeyboardSafetyFixture() {
  const [view, setView] = useState("pcb");
  const [property, setProperty] = useState("one");
  const [parameters, setParameters] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [hint, setHint] = useState("");
  const [schematicZoom, setSchematicZoom] = useState(0);
  return (
    <div>
      <button
        onClick={() =>
          setView((value) => (value === "pcb" ? "schematic" : "pcb"))
        }
      >
        Switch canvas
      </button>
      <button onClick={() => setMounted((value) => !value)}>
        Toggle editor
      </button>
      <button onClick={() => setOverlay((value) => !value)}>
        Toggle overlay
      </button>
      <textarea aria-label="Assistant draft" defaultValue="draft" />
      <Select
        aria-label="Property"
        options={[
          { id: "one", label: "one" },
          { id: "two", label: "two" },
        ]}
        value={property}
        onChange={setProperty}
      />
      <div role="textbox" aria-label="Nested editor">
        <span contentEditable aria-label="Editable draft">
          draft
        </span>
      </div>
      <output aria-label="Tool hint">{hint}</output>
      <output aria-label="Schematic zoom">{schematicZoom}</output>
      <div ref={setParameters} data-testid="route-parameter-portal" />
      {overlay ? (
        <div role="dialog" aria-modal="true">
          <button>Dialog action</button>
        </div>
      ) : null}
      <div style={{ height: 500 }}>
        {mounted &&
          (view === "pcb" ? (
            <PcbCanvas
              backendURL={window.location.origin}
              paramRowTarget={parameters}
              moduleId="designer"
              designId="keyboard-fixture"
              dispatchCommand={dispatch}
              selectionRequest={request}
              onHintChange={setHint}
            />
          ) : (
            <SchematicCanvas
              projection={schematic}
              onZoomChange={setSchematicZoom}
              selectedPartId={null}
              selectedPinId={null}
              selectedLabelId={null}
              wireSourcePinId={null}
              labelDraftText="NET"
              draggingComponentId={null}
              dragPlacementLoading={false}
              dragPlacementDetail={null}
              dragGhostNm={null}
              actions={actions}
              onHintChange={setHint}
            />
          ))}
      </div>
    </div>
  );
}
