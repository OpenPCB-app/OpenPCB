/**
 * KiCad project import wizard (H14 P0): pick → inspecting → review →
 * committing → done | failed, in the kit Dialog. With
 * `designer.outputQuarantine` on (release) commit stays disabled and only
 * inspection remains.
 */

import {
  type ChangeEvent,
  type ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KicadProjectCommitResult,
  KicadProjectInspectReport,
} from "../../../../../sdks/designer";
import { useFeatureFlag } from "@/feature-flags";
import { Banner } from "@shared/frontend/ui/banner";
import { Button } from "@shared/frontend/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@shared/frontend/ui/dialog";
import { createDesignerApi } from "../../api";
import { PROJECT_IMPORT_UNAVAILABLE } from "../../../shared/capability-policy";
import { DoneStage } from "./DoneStage";
import { PickStage } from "./PickStage";
import { ProgressStage } from "./ProgressStage";
import { ReviewStage } from "./ReviewStage";

export interface KicadProjectImportWizardProps {
  backendURL: string | null;
  moduleId: string;
  onClose(): void;
  /** A design was created; refresh lists only, the wizard stays open. */
  onImported(result: KicadProjectCommitResult): void;
  /** "Open design" on the Done stage. */
  onOpenDesign(designId: string): void;
}

export type WizardStage =
  | "pick"
  | "inspecting"
  | "review"
  | "committing"
  | "done"
  | "failed";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function KicadProjectImportWizard({
  backendURL,
  moduleId,
  onClose,
  onImported,
  onOpenDesign,
}: KicadProjectImportWizardProps): ReactElement {
  const quarantined = useFeatureFlag("designer.outputQuarantine");
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<WizardStage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<KicadProjectInspectReport | null>(null);
  const [designName, setDesignName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KicadProjectCommitResult | null>(null);
  const busy = stage === "inspecting" || stage === "committing";

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0];
      event.target.value = "";
      if (!chosen) return;
      setFile(chosen);
      setError(null);
      setStage("inspecting");
      try {
        const inspected = await api.inspectKicadProject(chosen);
        setReport(inspected);
        setDesignName(inspected.projectName);
        setStage("review");
      } catch (err) {
        setError(errorMessage(err));
        setStage("pick");
      }
    },
    [api],
  );

  const handleCommit = useCallback(async () => {
    if (!file || quarantined) return;
    setError(null);
    setStage("committing");
    try {
      const trimmed = designName.trim();
      const committed = await api.commitKicadProject(
        file,
        trimmed.length > 0 ? trimmed : undefined,
      );
      setResult(committed);
      setStage("done");
      onImported(committed);
    } catch (err) {
      setError(errorMessage(err));
      setStage("failed");
    }
  }, [api, designName, file, onImported, quarantined]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          chooseRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader title="Import KiCad project" />
        <DialogBody className="flex flex-col gap-3">
          {quarantined ? (
            <Banner tone="warning" role="status">
              {PROJECT_IMPORT_UNAVAILABLE}
            </Banner>
          ) : null}
          {stage === "pick" ? (
            <PickStage
              ref={chooseRef}
              quarantined={quarantined}
              error={error}
              onPick={() => fileInputRef.current?.click()}
            />
          ) : null}
          {stage === "inspecting" || stage === "committing" ? (
            <ProgressStage phase={stage} />
          ) : null}
          {stage === "review" && report ? (
            <ReviewStage
              report={report}
              designName={designName}
              onDesignNameChange={setDesignName}
            />
          ) : null}
          {stage === "done" && result ? <DoneStage result={result} /> : null}
          {stage === "failed" ? (
            <Banner tone="danger" title="Import failed">
              <p>The project wasn't imported. {error}</p>
            </Banner>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <WizardActions
            stage={stage}
            quarantined={quarantined}
            onClose={onClose}
            onCommit={() => void handleCommit()}
            onBackToReview={() => setStage("review")}
            onOpenDesign={result ? () => onOpenDesign(result.designId) : undefined}
          />
        </DialogFooter>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => void handleFile(event)}
        />
      </DialogContent>
    </Dialog>
  );
}

function WizardActions({
  stage,
  quarantined,
  onClose,
  onCommit,
  onBackToReview,
  onOpenDesign,
}: {
  stage: WizardStage;
  quarantined: boolean;
  onClose(): void;
  onCommit(): void;
  onBackToReview(): void;
  onOpenDesign?: () => void;
}): ReactElement | null {
  switch (stage) {
    case "pick":
      return <Button onClick={onClose}>Cancel</Button>;
    case "inspecting":
    case "committing":
      return (
        <Button disabled>Cancel</Button>
      );
    case "review":
      return (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={onCommit}
            disabled={quarantined}
            title={quarantined ? PROJECT_IMPORT_UNAVAILABLE : undefined}
          >
            Import design
          </Button>
        </>
      );
    case "failed":
      return (
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onBackToReview}>
            Back to review
          </Button>
        </>
      );
    case "done":
      return (
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onOpenDesign} disabled={!onOpenDesign}>
            Open design
          </Button>
        </>
      );
  }
}
