import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, ContextMenuParams, Event } from "electron";
import { registerEditContextMenu } from "../../../../../electron/src/main/edit-context-menu";

const menu = vi.hoisted(() => ({ build: vi.fn(), popup: vi.fn() }));
// The module under test resolves `electron` from the electron workspace, not
// from this test's root, so the mock must target that resolved path.
vi.mock("../../../../../electron/node_modules/electron", () => ({
  Menu: { buildFromTemplate: menu.build },
}));

function setup() {
  const on = vi.fn();
  const window = { webContents: { on } } as unknown as BrowserWindow;
  registerEditContextMenu(window);
  const handler = on.mock.calls[0]?.[1] as (
    event: Event,
    params: ContextMenuParams,
  ) => void;
  return { window, handler };
}

const flags = {
  canCut: true,
  canCopy: true,
  canPaste: false,
  canSelectAll: true,
};
const params = (editable: boolean, selectionText = "") =>
  ({
    isEditable: editable,
    selectionText,
    editFlags: flags,
  }) as ContextMenuParams;
const event = (defaultPrevented = false) => ({ defaultPrevented }) as Event;

beforeEach(() => {
  vi.clearAllMocks();
  menu.build.mockReturnValue({ popup: menu.popup });
});

describe("native Electron edit menu", () => {
  it("uses trusted clipboard roles with Electron-provided enablement", () => {
    const { window, handler } = setup();
    handler(event(), params(true));
    expect(menu.build).toHaveBeenCalledWith([
      { role: "cut", enabled: true },
      { role: "copy", enabled: true },
      { role: "paste", enabled: false },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ]);
    expect(menu.popup).toHaveBeenCalledWith({ window });
  });
  it("does not replace a consumed canvas or row menu", () => {
    setup().handler(event(true), params(true));
    expect(menu.build).not.toHaveBeenCalled();
  });
  it("does not add a native menu to unselected app chrome", () => {
    setup().handler(event(), params(false));
    expect(menu.build).not.toHaveBeenCalled();
  });
  it("allows copying selected non-editable text without mutation roles", () => {
    setup().handler(event(), params(false, "Selected text"));
    expect(menu.build).toHaveBeenCalledWith([{ role: "copy", enabled: true }]);
  });
});
