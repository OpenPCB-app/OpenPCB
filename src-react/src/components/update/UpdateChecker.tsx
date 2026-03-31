import { useEffect } from "react";
import { useUpdateStore } from "@/stores/update-store";

export function UpdateChecker() {
  useEffect(() => {
    const timer = setTimeout(() => {
      useUpdateStore.getState().checkForUpdate();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
