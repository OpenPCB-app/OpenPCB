export interface ContextMenuPoint {
  x: number;
  y: number;
}

export type ContextMenuScope =
  | "app"
  | "schematic"
  | "pcb"
  | "symbol-editor"
  | "footprint-editor";

export interface ContextMenuAction {
  kind: "action";
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ContextMenuSeparator {
  kind: "separator";
  id: string;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

export interface ContextMenuGroup {
  id: string;
  label?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuOpenInput {
  scope: ContextMenuScope;
  position: ContextMenuPoint;
  groups: ContextMenuGroup[];
  title?: string;
}

export interface ContextMenuState {
  open: boolean;
  scope: ContextMenuScope | null;
  position: ContextMenuPoint;
  groups: ContextMenuGroup[];
  title: string | null;
  focusedIndex: number;
}
