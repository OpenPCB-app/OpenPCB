import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isNearBottom, useScrollAnchor } from "./useScrollAnchor";
export function useConversationScroll(chatId: string | null, content: string) {
  const scroll = useScrollAnchor();
  const stick = useRef(true);
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  useEffect(() => {
    const element = scroll.scrollRef.current;
    if (!element) return;
    const update = () => { stick.current = isNearBottom(element); if (stick.current) setShowNewMessagesPill(false); };
    element.addEventListener("scroll", update);
    return () => element.removeEventListener("scroll", update);
  }, [scroll.scrollRef, chatId]);
  useEffect(() => { stick.current = true; setShowNewMessagesPill(false); scroll.scrollToBottom(); }, [chatId, scroll.scrollToBottom]);
  useLayoutEffect(() => { if (stick.current) scroll.scrollToBottom(); else setShowNewMessagesPill(true); }, [content, scroll.scrollToBottom]);
  return { scroll, showNewMessagesPill, setShowNewMessagesPill };
}
