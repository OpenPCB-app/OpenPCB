import type { ReactElement } from "react";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Wrap bare http(s) URLs in anchor tags (operates on already-escaped text). */
function linkify(html: string): string {
  return html.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
    // Don't swallow trailing sentence punctuation into the link.
    const trailing = match.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-violet-600 underline underline-offset-2 hover:text-violet-500 dark:text-violet-400">${url}</a>${trailing}`;
  });
}

/** Minimal Markdown: links, `code`, **bold**, *italic*, newlines. */
export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = linkify(html);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\n/g, "<br />");
  return html;
}

export function Markdown({ text }: { text: string }): ReactElement {
  return (
    <div
      className="prose prose-sm max-w-none break-words text-sm text-slate-700 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 dark:prose-invert dark:text-slate-200 dark:prose-code:bg-slate-800"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
