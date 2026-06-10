import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Button } from "@shared/frontend/ui/button";
import { Textarea } from "@shared/frontend/ui/textarea";

const POPUP_WIDTH = 288;

export interface CommentComposerPopupProps {
  /** Wrapper-relative screen px of the click point. */
  screen: { x: number; y: number };
  rect: { width: number; height: number };
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

/** Inline new-comment composer placed at the canvas click point. */
export function CommentComposerPopup({
  screen,
  rect,
  onSubmit,
  onCancel,
}: CommentComposerPopupProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [pos, setPos] = useState({ left: screen.x + 12, top: screen.y + 12 });

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? POPUP_WIDTH;
    const h = el?.offsetHeight ?? 140;
    let left = screen.x + 12;
    if (left + w > rect.width - 8) left = screen.x - w - 12;
    left = Math.min(Math.max(left, 8), Math.max(8, rect.width - w - 8));
    let top = screen.y + 12;
    if (top + h > rect.height - 8) top = screen.y - h - 12;
    top = Math.min(Math.max(top, 8), Math.max(8, rect.height - h - 8));
    setPos({ left, top });
  }, [screen.x, screen.y, rect.width, rect.height]);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute z-40 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left: pos.left, top: pos.top }}
    >
      <Textarea
        ref={textRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        rows={3}
        placeholder="Add a comment…  (⌘/Ctrl+Enter to post)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!body.trim()} onClick={submit}>
          Comment
        </Button>
      </div>
    </div>
  );
}
