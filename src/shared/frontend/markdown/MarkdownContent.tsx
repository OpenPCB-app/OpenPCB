import { isValidElement, useMemo, type ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram";

const STREAMING_MERMAID_LANGUAGE = "mermaid-streaming";

function textFromChildren(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  return "";
}

function getLanguage(className?: string): string | undefined {
  return /language-([\w-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
}

function isMermaidLanguage(language: string | undefined): boolean {
  return language === "mermaid" || language === "mmd";
}

function isFenceClose(
  line: string,
  marker: "`" | "~",
  length: number,
): boolean {
  const closePattern = new RegExp(
    `^ {0,3}${marker === "`" ? "`" : "~"}{${length},}\\s*$`,
  );
  return closePattern.test(line);
}

function replaceFenceLanguage(line: string, language: string): string {
  const match = /^( {0,3})(`{3,}|~{3,})(\s*)(\S*)(.*)$/.exec(line);
  if (!match) return line;
  return `${match[1]}${match[2]}${match[3]}${language}${match[5]}`;
}

function markStreamingMermaidFences(markdown: string): string {
  const lines = markdown.split("\n");
  let activeFence: {
    marker: "`" | "~";
    length: number;
    openingLine: number;
    mermaid: boolean;
  } | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (activeFence) {
      if (isFenceClose(line, activeFence.marker, activeFence.length)) {
        activeFence = null;
      }
      continue;
    }

    const open = /^( {0,3})(`{3,}|~{3,})(\s*)(\S*)/.exec(line);
    if (!open) continue;
    const fence = open[2] ?? "";
    const language = (open[4] ?? "").toLowerCase();
    activeFence = {
      marker: fence[0] === "~" ? "~" : "`",
      length: fence.length,
      openingLine: idx,
      mermaid: isMermaidLanguage(language),
    };
  }

  if (activeFence?.mermaid) {
    lines[activeFence.openingLine] = replaceFenceLanguage(
      lines[activeFence.openingLine] ?? "",
      STREAMING_MERMAID_LANGUAGE,
    );
  }

  return lines.join("\n");
}

function MermaidStreamingPlaceholder({
  source,
}: {
  source: string;
}): ReactElement {
  const lineCount =
    source.trim().length === 0 ? 0 : source.trim().split("\n").length;
  return (
    <figure
      className="my-3 rounded-lg border border-violet-500/30 bg-violet-950/20 p-3 text-xs text-violet-100"
      aria-busy="true"
    >
      <figcaption className="font-medium">Writing diagram…</figcaption>
      <p className="mt-1 text-violet-200/80">
        Rendering will start when the Mermaid block is complete
        {lineCount > 0 ? ` (${lineCount} lines so far).` : "."}
      </p>
    </figure>
  );
}

function markdownComponents(
  streaming: boolean,
  mermaidTheme?: "light" | "dark",
): Components {
  return {
    pre({ children, ...props }) {
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement<{ className?: string; children?: unknown }>(child)) {
        const language = getLanguage(child.props.className);
        if (isMermaidLanguage(language)) {
          return (
            <MermaidDiagram
              source={textFromChildren(child.props.children)}
              streaming={streaming}
              theme={mermaidTheme}
            />
          );
        }
        if (language === STREAMING_MERMAID_LANGUAGE) {
          return (
            <MermaidStreamingPlaceholder
              source={textFromChildren(child.props.children)}
            />
          );
        }
      }
      return <pre {...props}>{children}</pre>;
    },
    code({ className, children, ...props }) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };
}

export function MarkdownContent({
  children,
  className,
  streaming = false,
  mermaidTheme,
}: {
  children: string;
  className?: string;
  streaming?: boolean;
  /** Force the embedded Mermaid diagrams' theme (e.g. always-dark chat). */
  mermaidTheme?: "light" | "dark";
}): ReactElement {
  const renderedMarkdown = useMemo(
    () => (streaming ? markStreamingMermaidFences(children) : children),
    [children, streaming],
  );
  const components = useMemo(
    () => markdownComponents(streaming, mermaidTheme),
    [streaming, mermaidTheme],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {renderedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
