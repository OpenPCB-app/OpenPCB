import type { DesignerCommentThread } from "@sdks/designer";

/**
 * Pin/marker fill color by thread state. Resolved → slate, todo-done → green,
 * any other todo (todo/in_progress) → orange, open → violet (accent). Active
 * selection is conveyed via a ring/scale in `CommentPin`, not a fill swap.
 */
export function commentStatusColor(thread: DesignerCommentThread): string {
  if (thread.status === "resolved") return "#64748b"; // slate-500
  if (thread.todoStatus === "done") return "#22c55e"; // green-500
  if (thread.todoStatus !== "none") return "#fb923c"; // orange-400
  return "#8b5cf6"; // violet-500
}
