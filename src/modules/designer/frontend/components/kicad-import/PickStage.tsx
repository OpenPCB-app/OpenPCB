import { forwardRef } from "react";
import { FileUp } from "lucide-react";
import { Banner } from "@shared/frontend/ui/banner";
import { Button } from "@shared/frontend/ui/button";

export const PICK_FOOTNOTE =
  "Imports every schematic sheet, PCB placements, tracks, vias, zones, keepouts, board graphics, net classes and design rules. Parts are added to your library.";

export const PICK_FOOTNOTE_QUARANTINED =
  "Inspection reports source counts, warnings and component references. Import design remains disabled.";

interface PickStageProps {
  quarantined: boolean;
  error: string | null;
  onPick(): void;
}

/** First stage; the "Choose ZIP…" button takes focus when the dialog opens. */
export const PickStage = forwardRef<HTMLButtonElement, PickStageProps>(
  function PickStage({ quarantined, error, onPick }, ref) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-xs text-text-secondary">
          Pick a ZIP archive of a KiCad project (.kicad_pro, .kicad_sch and
          .kicad_pcb).
        </p>
        <Button
          ref={ref}
          variant="primary"
          size="lg"
          icon={<FileUp className="h-4 w-4" aria-hidden="true" />}
          onClick={onPick}
        >
          Choose ZIP…
        </Button>
        {error ? (
          <Banner tone="danger" title="Couldn't read the project" className="max-w-md text-left">
            {error}
          </Banner>
        ) : null}
        <p className="max-w-md text-2xs text-text-tertiary">
          {quarantined ? PICK_FOOTNOTE_QUARANTINED : PICK_FOOTNOTE}
        </p>
      </div>
    );
  },
);
