import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useFootprintEditorStore } from "./useFootprintEditorStore";

export function FootprintTextEditorOverlay(): ReactElement | null {
  const textEditor = useFootprintEditorStore((s) => s.textEditor);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    if (textEditor) {
      setValue(textEditor.initialText);
      settledRef.current = false;
    }
  }, [textEditor]);

  useEffect(() => {
    if (textEditor && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [textEditor]);

  if (!textEditor) return null;

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    useFootprintEditorStore.getState().commitTextEdit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    useFootprintEditorStore.getState().cancelTextEdit();
  };

  return (
    <div
      style={{
        position: "fixed",
        left: textEditor.screenX,
        top: textEditor.screenY,
        transform: "translate(-50%, -50%)",
        zIndex: 50,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          e.stopPropagation();
        }}
        placeholder="Type text…"
        className="h-8 min-w-[8rem] rounded-md border border-violet-500 bg-white px-2 text-xs text-slate-900 shadow-lg outline-none ring-2 ring-violet-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-violet-900/40"
      />
    </div>
  );
}
