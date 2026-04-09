import type { ComponentProps, ReactNode } from "react";
import type { Components } from "react-markdown";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { MermaidDiagram } from "@/components/MermaidDiagram";

export type MarkdownComponentOptions = {
  isStreaming?: boolean;
  onReasoningRender?: (content: string, isStreaming: boolean) => ReactNode;
  onMermaidRender?: (code: string) => ReactNode;
  onCodeBlockRender?: (code: string, language: string) => ReactNode;
};

/**
 * Create custom markdown components for react-markdown
 * This factory function allows customization of how different markdown elements are rendered
 */
export function createMarkdownComponents(
  options: MarkdownComponentOptions = {},
): Components {
  const { isStreaming = false } = options;

  return {
    // Paragraphs
    p(props: ComponentProps<"p">) {
      return <p {...props} />;
    },
    // Headings
    h1(props: ComponentProps<"h1">) {
      return <h1 {...props} />;
    },
    h2(props: ComponentProps<"h2">) {
      return <h2 {...props} />;
    },
    h3(props: ComponentProps<"h3">) {
      return <h3 {...props} />;
    },
    h4(props: ComponentProps<"h4">) {
      return <h4 {...props} />;
    },
    h5(props: ComponentProps<"h5">) {
      return <h5 {...props} />;
    },
    h6(props: ComponentProps<"h6">) {
      return <h6 {...props} />;
    },
    // Lists
    ul(props: ComponentProps<"ul">) {
      return <ul {...props} />;
    },
    ol(props: ComponentProps<"ol">) {
      return <ol {...props} />;
    },
    li(props: ComponentProps<"li">) {
      return <li {...props} />;
    },
    // Blockquotes
    blockquote(props: ComponentProps<"blockquote">) {
      return <blockquote {...props} />;
    },
    // Links
    a(props: ComponentProps<"a">) {
      return <a {...props} />;
    },
    // Tables
    table(props: ComponentProps<"table">) {
      return <table {...props} />;
    },
    thead(props: ComponentProps<"thead">) {
      return <thead {...props} />;
    },
    tbody(props: ComponentProps<"tbody">) {
      return <tbody {...props} />;
    },
    tr(props: ComponentProps<"tr">) {
      return <tr {...props} />;
    },
    th(props: ComponentProps<"th">) {
      return <th {...props} />;
    },
    td(props: ComponentProps<"td">) {
      return <td {...props} />;
    },
    // Horizontal rules
    hr(props: ComponentProps<"hr">) {
      return <hr {...props} />;
    },
    // Strong and emphasis
    strong(props: ComponentProps<"strong">) {
      return <strong {...props} />;
    },
    em(props: ComponentProps<"em">) {
      return <em {...props} />;
    },
    // Images
    img(props: ComponentProps<"img">) {
      return <img {...props} />;
    },
    // Handle pre elements - ReactMarkdown wraps code blocks in pre > code
    pre(props: ComponentProps<"pre">) {
      const { children, ...rest } = props;

      // ReactMarkdown processes code elements first, then wraps them in pre
      // If the code handler returned a custom component (Reasoning, MermaidDiagram, CodeBlock),
      // we should return it directly without the pre wrapper
      const child = Array.isArray(children) ? children[0] : children;

      if (
        typeof child === "object" &&
        child !== null &&
        "type" in child &&
        typeof child.type !== "string"
      ) {
        // It's a React component, return it directly (code handler already processed it)
        return <>{child}</>;
      }

      // For regular pre elements (shouldn't happen in markdown code blocks)
      return <pre {...rest}>{children}</pre>;
    },
    // Handle code elements - this is where we detect code blocks vs inline code
    code(props: ComponentProps<"code">) {
      const { className, children, ...rest } = props;

      // Check if this is a code block (has language class) or inline code
      const match = /language-([\w-]+)/.exec(className || "");
      const language = match?.[1] ?? null;
      const isInline = !language;

      // Handle inline code - styles come from markdown.css
      if (isInline) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }

      // Handle code blocks with special languages
      const childContent = Array.isArray(children)
        ? children.join("")
        : children;
      const code = String(childContent ?? "").replace(/\n$/, "");

      // Handle reasoning component - must be checked first
      if (language === "reasoning") {
        if (options.onReasoningRender) {
          return <>{options.onReasoningRender(code.trim(), isStreaming)}</>;
        }

        const reasoningText = code.trim();
        return (
          <Reasoning isStreaming={isStreaming} defaultOpen={true}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        );
      }

      // Handle mermaid diagrams
      if (language === "mermaid") {
        if (options.onMermaidRender) {
          return <>{options.onMermaidRender(code)}</>;
        }
        return <MermaidDiagram code={code} />;
      }

      // Render regular code block with syntax highlighting
      if (options.onCodeBlockRender) {
        return <>{options.onCodeBlockRender(code, language)}</>;
      }

      if (isStreaming) {
        return (
          <div className="group relative max-w-full overflow-x-auto rounded-md border bg-surface text-foreground">
            <pre className="m-0 max-w-full bg-surface p-4 text-foreground text-sm">
              <code className="font-mono text-sm whitespace-pre">{code}</code>
            </pre>
          </div>
        );
      }

      return (
        <CodeBlock code={code} language={language as BundledLanguage}>
          <CodeBlockCopyButton />
        </CodeBlock>
      );
    },
  } as Components;
}
