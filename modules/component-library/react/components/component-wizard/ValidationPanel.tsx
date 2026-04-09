/**
 * ValidationPanel Component
 *
 * Displays validation blockers and warnings for the component draft.
 * Shows what needs to be fixed before publishing.
 */

import { AlertTriangle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useValidation,
  useIsValidating,
  type ValidationMessage,
} from "@/stores/component-wizard-store";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ValidationPanel() {
  const validation = useValidation();
  const isValidating = useIsValidating();

  if (isValidating) {
    return (
      <div className="rounded-lg border border-border-default bg-bg-elevated p-4">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          <span>Validating component...</span>
        </div>
      </div>
    );
  }

  if (!validation) {
    return null;
  }

  const hasBlockers = validation.blockers.length > 0;
  const hasWarnings = validation.warnings.length > 0;

  if (!hasBlockers && !hasWarnings) {
    return (
      <div className="rounded-lg border border-success bg-success/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <Info className="h-4 w-4" />
          <span>Component is ready to publish</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Blockers */}
      {hasBlockers && (
        <div className="rounded-lg border border-error bg-error/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-4 w-4 text-error" />
            <span className="text-sm font-medium text-error">
              {validation.blockers.length} issue
              {validation.blockers.length !== 1 ? "s" : ""} blocking publish
            </span>
          </div>
          <ul className="space-y-2">
            {validation.blockers.map((msg, idx) => (
              <ValidationMessageItem key={idx} message={msg} />
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="rounded-lg border border-warning bg-warning/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium text-warning">
              {validation.warnings.length} warning
              {validation.warnings.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="space-y-2">
            {validation.warnings.map((msg, idx) => (
              <ValidationMessageItem key={idx} message={msg} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ValidationMessageItem({ message }: { message: ValidationMessage }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 h-1 w-1 flex-shrink-0 rounded-full bg-current" />
      <div>
        <span
          className={cn(
            "font-medium",
            message.severity === "error" ? "text-error" : "text-warning",
          )}
        >
          {message.field}:
        </span>{" "}
        <span
          className={cn(
            message.severity === "error" ? "text-error" : "text-warning",
          )}
        >
          {message.message}
        </span>
      </div>
    </li>
  );
}
