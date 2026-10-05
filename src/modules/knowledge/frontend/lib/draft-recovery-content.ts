import { getSchema } from "@tiptap/core";
import type { EditorContent, Page } from "../../shared/types";
import { createKnowledgeEditorExtensions } from "../components/Editor/tiptap-extensions";

export interface RetainedPageDraft {
  schemaVersion: 1;
  pageId: string;
  workspaceId: string;
  base: {
    revision: number;
    updatedAt: string;
    contentEngine: string;
    contentVersion: number;
  };
  pending: {
    title?: { raw: string; normalized: string };
    content?: EditorContent;
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported draft record");
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown draft fields; recovery record retained unchanged");
}

function supportedContent(value: unknown): void {
  const content = object(value);
  onlyKeys(content, ["engine", "version", "data"]);
  if (content.engine !== "tiptap" || content.version !== 1)
    throw new Error(
      "Unsupported draft content; recovery record retained unchanged",
    );
  const schema = getSchema(createKnowledgeEditorExtensions());
  const data = object(content.data);
  const node = schema.nodeFromJSON(data);
  node.check();
  if (node.type !== schema.topNodeType)
    throw new Error("Draft content is not a document");
  // ProseMirror ignores unknown attributes; recovery must preserve rather than silently drop them.
  const check = (raw: unknown): void => {
    const item = object(raw);
    onlyKeys(item, ["type", "attrs", "content", "marks", "text"]);
    const type =
      typeof item.type === "string" ? schema.nodes[item.type] : undefined;
    if (!type) throw new Error("Unknown draft node");
    for (const attr of Object.keys(
      item.attrs === undefined ? {} : object(item.attrs),
    ))
      if (!Object.hasOwn(type.spec.attrs ?? {}, attr))
        throw new Error("Unknown draft node attribute");
    for (const mark of (item.marks ?? []) as unknown[]) {
      const value = object(mark);
      onlyKeys(value, ["type", "attrs"]);
      const kind =
        typeof value.type === "string" ? schema.marks[value.type] : undefined;
      if (!kind) throw new Error("Unknown draft mark");
      for (const attr of Object.keys(
        value.attrs === undefined ? {} : object(value.attrs),
      ))
        if (!Object.hasOwn(kind.spec.attrs ?? {}, attr))
          throw new Error("Unknown draft mark attribute");
    }
    for (const child of (item.content ?? []) as unknown[]) check(child);
  };
  check(data);
}

export function parseRetainedPageDraft(
  value: string,
  page: Page,
): RetainedPageDraft {
  const record = object(JSON.parse(value));
  const base = object(record.base);
  const pending = object(record.pending);
  onlyKeys(base, ["revision", "updatedAt", "contentEngine", "contentVersion"]);
  if (
    record.schemaVersion !== 1 ||
    record.pageId !== page.id ||
    record.workspaceId !== page.workspace_id ||
    !Number.isSafeInteger(base.revision) ||
    (base.revision as number) < 0 ||
    typeof base.updatedAt !== "string" ||
    new Date(base.updatedAt).toISOString() !== base.updatedAt ||
    typeof base.contentEngine !== "string" ||
    !Number.isSafeInteger(base.contentVersion) ||
    Object.keys(record).some(
      (key) =>
        !["schemaVersion", "pageId", "workspaceId", "base", "pending"].includes(
          key,
        ),
    ) ||
    Object.keys(pending).some((key) => key !== "title" && key !== "content") ||
    !Object.keys(pending).length
  )
    throw new Error("Unsupported draft record; retained unchanged");
  if (pending.title !== undefined) {
    const title = object(pending.title);
    onlyKeys(title, ["raw", "normalized"]);
    if (
      typeof title.raw !== "string" ||
      title.normalized !== (title.raw.trim() || "Untitled")
    )
      throw new Error("Invalid retained title");
  }
  if (pending.content !== undefined) supportedContent(pending.content);
  return record as unknown as RetainedPageDraft;
}
