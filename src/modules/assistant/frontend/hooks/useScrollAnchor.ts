import { useCallback, useLayoutEffect, useRef } from "react";

export function isNearBottom(element: HTMLElement, thresholdPx = 80): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < thresholdPx;
}

export function useScrollAnchor() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingPrependRef = useRef<{
    height: number;
    top: number;
  } | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const captureBeforePrepend = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pendingPrependRef.current = { height: el.scrollHeight, top: el.scrollTop };
  }, []);

  const restoreAfterPrepend = useCallback(() => {
    const el = scrollRef.current;
    const pending = pendingPrependRef.current;
    if (!el || !pending) return;
    el.scrollTop = pending.top + (el.scrollHeight - pending.height);
    pendingPrependRef.current = null;
  }, []);

  const stickToBottomIfNear = useCallback((fn: () => void) => {
    const el = scrollRef.current;
    const shouldStick = el ? isNearBottom(el) : true;
    fn();
    if (shouldStick) requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    restoreAfterPrepend();
  });

  return {
    scrollRef,
    scrollToBottom,
    captureBeforePrepend,
    restoreAfterPrepend,
    stickToBottomIfNear,
  };
}
