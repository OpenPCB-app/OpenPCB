import { useEffect, useRef, useState } from "react";

/**
 * `value`, republished at most once per animation frame.
 *
 * The route tool's live legality gate runs at most once per frame (live-parity
 * contract 07 §7): the ghost RENDER stays unthrottled — it reads the raw value
 * — while the gate's memo reads this, so a burst of pointer moves inside one
 * frame costs one gate evaluation, not one per event. Throttling bounds
 * frequency, never the cost of a single evaluation.
 *
 * Not a frame loop: a frame is requested only when the value actually changed,
 * and the pending callback always publishes the LATEST value, so nothing is
 * dropped — only coalesced.
 */
export function useRafThrottledValue<T>(value: T): T {
  const [published, setPublished] = useState<T>(value);
  const latest = useRef<T>(value);
  const frame = useRef<number | null>(null);
  latest.current = value;

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setPublished(value);
      return;
    }
    // A frame is already pending; it will publish `latest.current`.
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setPublished(latest.current);
    });
  }, [value]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return published;
}
