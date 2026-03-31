import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  SidebarButtonsProvider,
  useSidebarButtons,
} from "@/contexts/SidebarButtonsContext";

function wrapper({ children }: { children: ReactNode }) {
  return <SidebarButtonsProvider>{children}</SidebarButtonsProvider>;
}

describe("SidebarButtonsContext", () => {
  it("registers top buttons and clears them on cleanup", () => {
    const { result } = renderHook(() => useSidebarButtons(), { wrapper });

    expect(result.current.rightTop).toHaveLength(0);

    act(() => {
      result.current.setRightTopButtons([
        <button key="chat-media-sidebar-toggle" type="button">
          Media
        </button>,
      ]);
    });

    expect(result.current.rightTop).toHaveLength(1);

    act(() => {
      result.current.setRightTopButtons([]);
    });

    expect(result.current.rightTop).toHaveLength(0);
  });

  it("replaces top buttons instead of appending duplicates", () => {
    const { result } = renderHook(() => useSidebarButtons(), { wrapper });

    act(() => {
      result.current.setRightTopButtons([
        <button key="media" type="button">
          Media
        </button>,
      ]);
    });

    expect(result.current.rightTop).toHaveLength(1);

    act(() => {
      result.current.setRightTopButtons([
        <button key="media" type="button">
          Media
        </button>,
      ]);
    });

    expect(result.current.rightTop).toHaveLength(1);
  });
});
