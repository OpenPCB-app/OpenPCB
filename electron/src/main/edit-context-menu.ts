import {
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";

/** Electron has no default renderer edit menu; trusted roles retain native selection. */
export function registerEditContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (event, params) => {
    if (event.defaultPrevented || (!params.isEditable && !params.selectionText))
      return;
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable)
      items.push({ role: "cut", enabled: params.editFlags.canCut });
    items.push({ role: "copy", enabled: params.editFlags.canCopy });
    if (params.isEditable) {
      items.push({ role: "paste", enabled: params.editFlags.canPaste });
      items.push(
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    }
    Menu.buildFromTemplate(items).popup({ window });
  });
}
