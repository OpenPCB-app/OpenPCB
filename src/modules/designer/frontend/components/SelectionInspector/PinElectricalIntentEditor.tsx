import { useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type {
  DesignerPin,
  DesignerPinElectricalIntent,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";
import { Select } from "@shared/frontend/ui/select";

interface PinElectricalIntentEditorProps {
  pin: DesignerPin;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}

function useSubmissionLifetime(pinId: string) {
  const owner = useRef<object | null>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setLocalError] = useState<string | null>(null);
  useLayoutEffect(() => {
    owner.current = {};
    submitting.current = false;
    setPending(false);
    setLocalError(null);
    return () => {
      owner.current = null;
    };
  }, [pinId]);
  return { owner, submitting, pending, setPending, error, setLocalError };
}

function intentDescription(
  pin: DesignerPin,
  pending: boolean,
  unsupported: boolean,
): string {
  if (pending) return "Saving…";
  if (unsupported) {
    return `Unsupported stored intent: ${pin.electricalIntent}. Choose an intent to replace or clear it.`;
  }
  if (pin.electricalIntent === "power_source") {
    return "Asserts external supply; does not rename the net.";
  }
  return pin.electricalType === "no_connect"
    ? "Library no-connect pins cannot be power sources."
    : "Intent applies to this placed pin only.";
}

function usePinIntentSubmission({
  pin,
  dispatchCommand,
  setError,
}: PinElectricalIntentEditorProps) {
  const state = useSubmissionLifetime(pin.id);
  async function changeIntent(value: string): Promise<void> {
    const owner = state.owner.current;
    if (!owner || state.submitting.current) return;
    if (value !== "" && value !== "no_connect" && value !== "power_source") return;
    if (value === "power_source" && pin.electricalType === "no_connect") return;
    const next: DesignerPinElectricalIntent | null = value === "" ? null : value;
    if (next === (pin.electricalIntent ?? null)) return;
    state.submitting.current = true;
    state.setPending(true);
    state.setLocalError(null);
    try {
      const result = await dispatchCommand({
        type: "set_pin_electrical_intent",
        pinId: pin.id,
        intent: next,
      });
      if (!result.ok) {
        const message = "message" in result
          ? result.message
          : "detail" in result ? result.detail : result.code;
        throw new Error(message);
      }
    } catch (cause) {
      if (state.owner.current !== owner) return;
      const message = cause instanceof Error
        ? cause.message
        : "Failed to update pin electrical intent";
      state.setLocalError(message);
      setError(message);
    } finally {
      if (state.owner.current === owner) {
        state.submitting.current = false;
        state.setPending(false);
      }
    }
  }
  return { pending: state.pending, error: state.error, changeIntent };
}

export function PinElectricalIntentEditor(
  props: PinElectricalIntentEditorProps,
): ReactElement {
  const { pin } = props;
  const { pending, error, changeIntent } = usePinIntentSubmission(props);
  const descriptionId = useId();
  const intent = pin.electricalIntent;
  const unsupported = intent !== undefined
    && intent !== "no_connect" && intent !== "power_source";
  const pinLabel = `Pin ${pin.number ?? pin.id} ${pin.name}`;
  return (
    <div className="border-b border-border-subtle px-[10px] py-1">
      <Select
        aria-label={`${pinLabel} electrical intent`}
        aria-describedby={descriptionId}
        aria-busy={pending}
        invalid={Boolean(error)}
        value={unsupported ? "unsupported" : (intent ?? "")}
        disabled={pending}
        onChange={(value) => void changeIntent(value)}
        containerClassName="w-full"
        className="text-2xs"
        options={[
          ...(unsupported ? [{
            id: "unsupported", label: `Unsupported: ${intent}`, disabled: true,
          }] : []),
          { id: "", label: "Normal" },
          { id: "no_connect", label: "Intentional NC" },
          {
            id: "power_source", label: "External power source",
            disabled: pin.electricalType === "no_connect",
          },
        ]}
      />
      <p id={descriptionId} className="text-2xs leading-snug text-text-tertiary">
        {intentDescription(pin, pending, unsupported)}
      </p>
      {error ? (
        <p role="alert" className="text-2xs text-status-danger">{error}</p>
      ) : null}
    </div>
  );
}
