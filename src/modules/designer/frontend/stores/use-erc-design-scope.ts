import { useLayoutEffect } from "react";
import { useErcStore } from "./erc-store";

export function useErcDesignScope(designId: string | null): void {
  const clear = useErcStore((state) => state.clear);
  // Child panels start their checks in passive effects, after this reset.
  useLayoutEffect(() => clear(), [clear, designId]);
}
