import { useState } from "react";
import { Button } from "@shared/frontend/ui/button";
import { PcbExportDialog } from "./pcb/PcbExportDialog";
import { KicadProjectImportWizard } from "./components/KicadProjectImportWizard";

export function CapabilityFixture() {
  const [exportOpen, setExportOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setImportOpen(true)}>Inspect KiCad project</Button>
      <PcbExportDialog
        backendURL={window.location.origin}
        moduleId="designer"
        designId="fixture"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      {importOpen && (
        <KicadProjectImportWizard
          backendURL={window.location.origin}
          moduleId="designer"
          onClose={() => setImportOpen(false)}
          onImported={() => {
            throw new Error("Quarantined import cannot succeed");
          }}
        />
      )}
    </>
  );
}
