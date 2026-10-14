import { useCallback, useMemo, useState, type ReactElement } from "react";
import type {
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  PcbDesignRules,
  PcbLengthMatchGroup,
  PcbNetClass,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { PcbDesignRulesDialog } from "../components/PcbDesignRulesDialog";
import { dispatchFailureMessage } from "./dispatch-failure";

export interface PcbDesignRulesSaveInput {
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  boardThicknessMm: number;
  perNetClassAssignments: Record<string, string>;
  lengthMatchGroups: PcbLengthMatchGroup[];
}

export interface UsePcbDesignRulesDialogOptions {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  /** Command-log session id — one per surface that can open the dialog. */
  sessionId: string;
  /** Supplies `board` + `netNames` + the base revision; `null` disables. */
  projection: DesignerPcbProjection | null;
  /** Base revision to use when the projection has not loaded yet. */
  fallbackRevision?: number | null;
  /** Runs after the command is accepted (refresh + re-run DRC). */
  onSaved?: () => void | Promise<void>;
}

export interface UsePcbDesignRulesDialogResult {
  /** Opens the dialog; a no-op without a design + projection. */
  open: () => void;
  /** True while the dialog can be opened (design + projection present). */
  available: boolean;
  /** Render this somewhere in the tree; `null` when unavailable. */
  dialog: ReactElement | null;
}

/**
 * Single owner of the "Edit design rules" dialog state + save path. Both the
 * DRC view and the PCB Board properties open it, and both must dispatch the
 * identical `pcb_set_design_rules` command — duplicating the envelope would let
 * the two drift.
 */
export function usePcbDesignRulesDialog({
  backendURL,
  moduleId,
  designId,
  sessionId,
  projection,
  fallbackRevision = null,
  onSaved,
}: UsePcbDesignRulesDialogOptions): UsePcbDesignRulesDialogResult {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const [isOpen, setIsOpen] = useState(false);

  const handleSave = useCallback(
    async (next: PcbDesignRulesSaveInput): Promise<void> => {
      if (!designId) return;
      const envelope: DesignerCommandEnvelope = {
        commandId: crypto.randomUUID(),
        sessionId,
        aggregateId: designId,
        baseRevision: projection?.revision ?? fallbackRevision ?? null,
        issuedAt: Date.now(),
        command: {
          type: "pcb_set_design_rules",
          designRules: next.designRules,
          netClasses: next.netClasses,
          boardThicknessMm: next.boardThicknessMm,
          perNetClassAssignments: next.perNetClassAssignments,
          lengthMatchGroups: next.lengthMatchGroups,
        },
      };
      const result = await api.dispatch(designId, envelope);
      if (!result.ok) {
        throw new Error(dispatchFailureMessage("Design rules", result));
      }
      await onSaved?.();
    },
    [api, designId, fallbackRevision, onSaved, projection?.revision, sessionId],
  );

  const available = Boolean(designId && projection);

  const dialog =
    designId && projection ? (
      <PcbDesignRulesDialog
        open={isOpen}
        board={projection.board}
        netNames={projection.netNames}
        onClose={() => setIsOpen(false)}
        onSave={handleSave}
      />
    ) : null;

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  return { open, available, dialog };
}
