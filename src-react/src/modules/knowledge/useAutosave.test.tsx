import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAutosave } from "@modules/knowledge/react/hooks/useAutosave";
import type { EditorContent } from "@modules/knowledge/shared/types";

function makeContent(text: string): EditorContent {
  return {
    engine: "tiptap",
    version: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

function Harness(props: {
  saveKey: string;
  onSave: (content: EditorContent, saveKey: string) => Promise<void>;
}) {
  const { triggerSave } = useAutosave({
    saveKey: props.saveKey,
    debounceMs: 100,
    onSave: props.onSave,
  });

  return (
    <div>
      <button
        data-testid="save-a"
        onClick={() => triggerSave(makeContent("content-a"))}
      >
        Save A
      </button>
      <button
        data-testid="save-b"
        onClick={() => triggerSave(makeContent("content-b"))}
      >
        Save B
      </button>
    </div>
  );
}

describe("useAutosave saveKey isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not leak pending content from page A into page B after switch", async () => {
    const saves: Array<{ saveKey: string; payload: string }> = [];
    const onSave = vi.fn(async (content: EditorContent, saveKey: string) => {
      saves.push({
        saveKey,
        payload: JSON.stringify(content),
      });
    });

    const { rerender } = render(<Harness saveKey="page-a" onSave={onSave} />);

    fireEvent.click(screen.getByTestId("save-a"));

    // Switch page before debounce flushes.
    rerender(<Harness saveKey="page-b" onSave={onSave} />);
    fireEvent.click(screen.getByTestId("save-b"));

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saves).toHaveLength(1);
    expect(saves[0]?.saveKey).toBe("page-b");
    expect(saves[0]?.payload.includes("content-b")).toBe(true);
    expect(
      saves.some(
        (entry) =>
          entry.saveKey === "page-b" && entry.payload.includes("content-a"),
      ),
    ).toBe(false);
  });
});
