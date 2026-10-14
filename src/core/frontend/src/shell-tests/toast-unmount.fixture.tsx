import { useState } from "react";
import { Toaster, toast, useToastStore } from "@shared/frontend/ui/toast";

export function ToastUnmountFixture() {
  const [visible, setVisible] = useState(true);
  const count = useToastStore((state) => state.toasts.length);
  return (
    <div>
      <button
        onClick={() => toast.info("Unmount fixture", { durationMs: 1000 })}
      >
        Trigger notice
      </button>
      <button onClick={() => setVisible((value) => !value)}>
        Toggle notifications
      </button>
      <output aria-label="Stored notice count">{count}</output>
      {visible ? <Toaster /> : null}
    </div>
  );
}
