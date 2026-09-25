import * as React from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "./dialog";
import {
  registerDialogHost,
  useDialogHostStore,
  type DialogRequest,
} from "./dialog-host-store";
import { Input } from "./input";

export {
  cancelAllDialogs,
  confirmDialog,
  promptDialog,
  useDialogHostStore,
  type ConfirmDialogOptions,
  type DialogRequest,
  type PromptDialogOptions,
} from "./dialog-host-store";

type ConfirmRequest = Extract<DialogRequest, { kind: "confirm" }>;
type PromptRequest = Extract<DialogRequest, { kind: "prompt" }>;

function ConfirmBody({ request }: { request: ConfirmRequest }) {
  const { options } = request;
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  return (
    <DialogContent
      size="sm"
      role="alertdialog"
      {...(options.description ? {} : { "aria-describedby": undefined })}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        confirmRef.current?.focus();
      }}
    >
      <DialogHeader title={options.title} />
      {options.description ? (
        <DialogBody>
          <DialogDescription className="text-text">{options.description}</DialogDescription>
        </DialogBody>
      ) : null}
      <DialogFooter>
        <Button variant="secondary" onClick={() => request.settle(false)}>
          {options.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          ref={confirmRef}
          variant={options.tone === "danger" ? "danger" : "primary"}
          onClick={() => request.settle(true)}
        >
          {options.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PromptBody({ request }: { request: PromptRequest }) {
  const { options } = request;
  const [value, setValue] = React.useState(options.defaultValue ?? "");
  const [touched, setTouched] = React.useState(false);
  const inputId = React.useId();
  const error = options.validate?.(value) ?? null;
  return (
    <DialogContent
      size="sm"
      {...(options.description ? {} : { "aria-describedby": undefined })}
    >
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!error) request.settle(value);
        }}
      >
        <DialogHeader title={options.title} description={options.description} />
        <DialogBody className="flex flex-col gap-1">
          {options.label ? (
            <label htmlFor={inputId} className="text-xs text-text-secondary">
              {options.label}
            </label>
          ) : null}
          <Input
            id={inputId}
            autoFocus
            value={value}
            placeholder={options.placeholder}
            maxLength={options.maxLength}
            inputMode={options.inputMode}
            aria-label={options.label ? undefined : options.title}
            invalid={touched && error !== null}
            aria-describedby={touched && error ? `${inputId}-error` : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
            onFocus={(event) => event.currentTarget.select()}
          />
          {touched && error ? (
            <p id={`${inputId}-error`} className="text-2xs text-status-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => request.settle(null)}>
            {options.cancelLabel ?? "Cancel"}
          </Button>
          <Button type="submit" variant="primary" disabled={error !== null}>
            {options.confirmLabel ?? "OK"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * Renders queued confirmDialog()/promptDialog() requests one at a time.
 * Mount ONCE near the app root (wave F0b does this).
 */
export function DialogHost() {
  const head = useDialogHostStore((state) => state.queue[0]);
  React.useEffect(() => registerDialogHost(), []);
  if (!head) return null;
  const cancel = () => (head.kind === "confirm" ? head.settle(false) : head.settle(null));
  return (
    <Dialog
      key={head.id}
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      {head.kind === "confirm" ? <ConfirmBody request={head} /> : <PromptBody request={head} />}
    </Dialog>
  );
}
