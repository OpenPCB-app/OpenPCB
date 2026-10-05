import type { ReactElement } from "react";
import { Button } from "@shared/frontend/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@shared/frontend/ui/dialog";
import { MANUFACTURING_UNAVAILABLE } from "../../shared/capability-policy";

interface PcbExportDialogProps {
  backendURL: string | null | undefined;
  moduleId: string;
  designId: string;
  open: boolean;
  onClose(): void;
}

export function PcbExportDialog({
  open,
  onClose,
}: PcbExportDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Manufacturing exports unavailable"
          description={MANUFACTURING_UNAVAILABLE}
        />
        <p className="px-4 py-3 text-xs text-text-secondary">
          Descriptive BOM exports remain available from the BOM view. No
          fabrication ZIP or placement-coordinate file is created.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled title={MANUFACTURING_UNAVAILABLE}>
            Download ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
