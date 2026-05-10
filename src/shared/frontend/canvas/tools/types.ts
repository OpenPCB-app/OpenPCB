import type { ReactNode } from "react";
import type { InteractionEvent } from "../interaction/types";

/**
 * A stateful editor tool. Pointer/keyboard events are dispatched to the
 * currently active tool by `useToolDispatch`. Tool factories return fresh
 * instances on activation so per-tool transient state (drag anchors, multi-click
 * state, etc.) is closure-local and does not leak between activations.
 */
export interface EditorTool<TId extends string = string> {
  readonly id: TId;
  readonly cursor: string;
  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown?(event: InteractionEvent): void;
  onPointerMove?(event: InteractionEvent): void;
  onPointerUp?(event: InteractionEvent): void;
  onContextMenu?(event: InteractionEvent): void;
  onKeyDown?(event: KeyboardEvent): void;
  /** Optional rubber-band preview rendered in canvas during interaction. */
  render?(): ReactNode;
}

export type ToolFactory<TId extends string = string> = () => EditorTool<TId>;
