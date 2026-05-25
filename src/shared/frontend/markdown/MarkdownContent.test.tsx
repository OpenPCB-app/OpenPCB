import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <div data-testid="mermaid-diagram">{source}</div>
  ),
}));

describe("MarkdownContent", () => {
  test("renders Mermaid fenced code with the Mermaid diagram component", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>
        {"Before\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter"}
      </MarkdownContent>,
    );

    expect(markup).toContain('data-testid="mermaid-diagram"');
    expect(markup).toContain("flowchart TD");
    expect(markup).not.toContain('class="language-mermaid"');
  });

  test("keeps non-Mermaid fenced code as code", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{"```ts\nconst answer = 42;\n```"}</MarkdownContent>,
    );

    expect(markup).toContain('class="language-ts"');
    expect(markup).toContain("const answer = 42;");
    expect(markup).not.toContain('data-testid="mermaid-diagram"');
  });

  test("shows a stable placeholder for incomplete streaming Mermaid fences", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent streaming>{"```mermaid\nflowchart LR\n  A -->"}</MarkdownContent>,
    );

    expect(markup).toContain("Writing diagram");
    expect(markup).toContain("Rendering will start when the Mermaid block is complete");
    expect(markup).not.toContain('data-testid="mermaid-diagram"');
    expect(markup).not.toContain('class="language-mermaid"');
  });

  test("renders complete Mermaid fences even while the message streams", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent streaming>
        {"```mermaid\nflowchart LR\n  A --> B\n```\n\nMore text is streaming."}
      </MarkdownContent>,
    );

    expect(markup).toContain('data-testid="mermaid-diagram"');
    expect(markup).toContain("flowchart LR");
    expect(markup).not.toContain("Writing diagram");
  });

  test("lets final incomplete Mermaid fences fall through to final render handling", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{"```mermaid\nflowchart LR\n  A -->"}</MarkdownContent>,
    );

    expect(markup).toContain('data-testid="mermaid-diagram"');
    expect(markup).not.toContain("Writing diagram");
  });
});
