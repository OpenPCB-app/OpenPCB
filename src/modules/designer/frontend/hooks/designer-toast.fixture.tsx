import { ToastProvider, useToast } from "./use-toast";

function ToastActions() {
  const { addToast, toasts, removeToast } = useToast();
  return (
    <section>
      <button onClick={() => addToast("Placement fixture failed", "error")}>
        Trigger handled error
      </button>
      <button onClick={() => addToast("Short error fixture", "error", 1)}>
        Trigger explicit-duration error
      </button>
      <button onClick={() => addToast("Transient fixture", "info", 100)}>
        Trigger transient notice
      </button>
      <button onClick={() => addToast("Long transient fixture", "info", 1000)}>
        Trigger long transient notice
      </button>
      <button
        onClick={() => {
          const last = toasts.at(-1);
          if (last) removeToast(last.id);
        }}
      >
        Remove last adapter toast
      </button>
      <output aria-label="Adapter toast count">{toasts.length}</output>
    </section>
  );
}

export function DesignerToastFixture() {
  return (
    <ToastProvider>
      <ToastActions />
    </ToastProvider>
  );
}
