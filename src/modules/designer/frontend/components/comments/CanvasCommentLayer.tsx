import { useMemo, type ReactElement } from "react";
import type {
  DesignerCommentAnchor,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
} from "@sdks/designer";
import type { CanvasRect, ScreenPoint } from "./useCanvasProjection";
import { CommentPin } from "./CommentPin";
import { CommentThreadPopup } from "./CommentThreadPopup";
import { CommentComposerPopup } from "./CommentComposerPopup";
import { commentStatusColor } from "./comment-style";
import { displayNameFrom } from "./comment-format";

/** A new comment in flight: anchor (built by the canvas) + click screen point. */
export interface CommentDraft {
  anchor: DesignerCommentAnchor;
  screen: { x: number; y: number };
}

/** Callback surface a canvas must supply for the comment overlay. Shared by the
 *  schematic + PCB canvases so their prop wiring stays identical. */
export interface CanvasCommentHandlers {
  currentUserEmail: string | null;
  attachmentUrl: (attachmentId: string) => string;
  onCreateComment: (anchor: DesignerCommentAnchor, body: string) => void;
  onCancelDraft: () => void;
  onOpenThread: (threadId: string) => void;
  onCloseThread: () => void;
  onRecenter: (anchorNm: { x: number; y: number }) => void;
  onAddMessage: (
    thread: DesignerCommentThread,
    body: string,
    file?: File | null,
  ) => Promise<void>;
  onSetStatus: (
    thread: DesignerCommentThread,
    status: DesignerCommentThreadStatus,
  ) => Promise<void>;
  onSetTodoStatus: (
    thread: DesignerCommentThread,
    todoStatus: DesignerCommentTodoStatus,
  ) => Promise<void>;
  onToggleReaction: (
    thread: DesignerCommentThread,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
}

export interface CanvasCommentLayerProps extends CanvasCommentHandlers {
  threads: readonly DesignerCommentThread[];
  activeThreadId: string | null;
  mirrored: boolean;
  rect: CanvasRect;
  project: (
    anchorNm: { x: number; y: number },
    mirrorX?: boolean,
  ) => ScreenPoint;
  clampToEdge: (pt: { x: number; y: number }) => { x: number; y: number };
  draft: CommentDraft | null;
}

/**
 * Renders the world-anchored comment overlay (numbered pins + active thread
 * popup + new-comment composer) over a canvas. Pure DOM: pins reproject every
 * frame the camera moves; the layer itself is `pointer-events-none` so only the
 * pins/popups intercept clicks.
 */
export function CanvasCommentLayer(
  props: CanvasCommentLayerProps,
): ReactElement {
  const anchored = useMemo(
    () => props.threads.filter((t) => t.anchor?.pointNm && !t.deletedAt),
    [props.threads],
  );

  const active = useMemo(
    () => anchored.find((t) => t.id === props.activeThreadId) ?? null,
    [anchored, props.activeThreadId],
  );

  const activeScreen = useMemo(() => {
    if (!active?.anchor) return null;
    const sp = props.project(active.anchor.pointNm, props.mirrored);
    return sp.onScreen ? { x: sp.x, y: sp.y } : props.clampToEdge(sp);
  }, [active, props]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {anchored.map((thread, index) => {
        const number = index + 1;
        const color = commentStatusColor(thread);
        const isActive = thread.id === props.activeThreadId;
        const sp = props.project(thread.anchor!.pointNm, props.mirrored);
        const title = `${displayNameFrom(thread.createdBy)} · ${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"}`;
        if (sp.onScreen) {
          return (
            <CommentPin
              key={thread.id}
              index={number}
              color={color}
              active={isActive}
              resolved={thread.status === "resolved"}
              x={sp.x}
              y={sp.y}
              clamped={false}
              title={title}
              onClick={() => props.onOpenThread(thread.id)}
            />
          );
        }
        const edge = props.clampToEdge(sp);
        return (
          <CommentPin
            key={thread.id}
            index={number}
            color={color}
            active={isActive}
            resolved={thread.status === "resolved"}
            x={edge.x}
            y={edge.y}
            clamped
            title={`${title} — off-screen, click to reveal`}
            onClick={() => props.onRecenter(thread.anchor!.pointNm)}
          />
        );
      })}

      {active && activeScreen ? (
        <CommentThreadPopup
          thread={active}
          screen={activeScreen}
          rect={props.rect}
          currentUserEmail={props.currentUserEmail}
          attachmentUrl={props.attachmentUrl}
          onClose={props.onCloseThread}
          onAddMessage={props.onAddMessage}
          onSetStatus={props.onSetStatus}
          onSetTodoStatus={props.onSetTodoStatus}
          onToggleReaction={props.onToggleReaction}
        />
      ) : null}

      {props.draft ? (
        <CommentComposerPopup
          screen={props.draft.screen}
          rect={props.rect}
          onSubmit={(bodyText) =>
            props.onCreateComment(props.draft!.anchor, bodyText)
          }
          onCancel={props.onCancelDraft}
        />
      ) : null}
    </div>
  );
}
