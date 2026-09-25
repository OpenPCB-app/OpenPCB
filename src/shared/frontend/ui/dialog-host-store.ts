import { create } from "zustand";

/*
 * Queue behind confirmDialog()/promptDialog() — the kit replacement for the
 * browser's native confirm/prompt boxes (T-014). One dialog at a time, FIFO; each
 * request settles exactly once. `<DialogHost/>` renders the head.
 */

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  /** Default "Confirm" ("Delete" reads better for `tone: "danger"`). */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  tone?: "default" | "danger";
}

export interface PromptDialogOptions {
  title: string;
  /** Visible field label (the title names the field when omitted). */
  label?: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Default "OK". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Return an error message to block confirming, or null when valid. */
  validate?: (value: string) => string | null;
  maxLength?: number;
  inputMode?: "text" | "decimal" | "numeric" | "url" | "email" | "search";
}

export type DialogRequest =
  | {
      id: number;
      kind: "confirm";
      options: ConfirmDialogOptions;
      settle: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      options: PromptDialogOptions;
      settle: (value: string | null) => void;
    };

interface DialogHostState {
  queue: DialogRequest[];
  /** Number of mounted <DialogHost/>s (0 → requests wait for one). */
  hosts: number;
}

export const useDialogHostStore = create<DialogHostState>(() => ({
  queue: [],
  hosts: 0,
}));

let nextId = 1;

function warnIfNoHost(): void {
  if (useDialogHostStore.getState().hosts === 0 && import.meta.env?.DEV) {
    console.warn(
      "[dialog-host] no <DialogHost/> is mounted; the dialog is queued until one mounts",
    );
  }
}

function remove(id: number): void {
  useDialogHostStore.setState((state) => ({
    queue: state.queue.filter((request) => request.id !== id),
  }));
}

/** Resolves true on confirm, false on cancel / Esc / close. */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  warnIfNoHost();
  return new Promise<boolean>((resolve) => {
    const id = nextId++;
    const request: DialogRequest = {
      id,
      kind: "confirm",
      options,
      settle: (value) => {
        remove(id);
        resolve(value);
      },
    };
    useDialogHostStore.setState((state) => ({ queue: [...state.queue, request] }));
  });
}

/** Resolves the entered text when confirmed (not trimmed), null on cancel. */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  warnIfNoHost();
  return new Promise<string | null>((resolve) => {
    const id = nextId++;
    const request: DialogRequest = {
      id,
      kind: "prompt",
      options,
      settle: (value) => {
        remove(id);
        resolve(value);
      },
    };
    useDialogHostStore.setState((state) => ({ queue: [...state.queue, request] }));
  });
}

/** Cancels every pending request (e.g. on sign-out / space teardown). */
export function cancelAllDialogs(): void {
  for (const request of useDialogHostStore.getState().queue) {
    if (request.kind === "confirm") request.settle(false);
    else request.settle(null);
  }
}

export function registerDialogHost(): () => void {
  useDialogHostStore.setState((state) => ({ hosts: state.hosts + 1 }));
  return () => useDialogHostStore.setState((state) => ({ hosts: state.hosts - 1 }));
}
