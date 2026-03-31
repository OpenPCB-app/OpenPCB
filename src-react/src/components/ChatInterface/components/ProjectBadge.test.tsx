import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectBadge } from "./ProjectBadge";
import type { ProjectRecord } from "@shared/types";

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "proj-1",
    workspaceId: "ws-1",
    name: "Test Project",
    status: "active" as const,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProjectBadge", () => {
  it("returns null when no project and no error", () => {
    const { container } = render(<ProjectBadge project={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders project name", () => {
    render(<ProjectBadge project={makeProject({ name: "My Project" })} />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it('renders "Unknown Project" when project has no name', () => {
    render(<ProjectBadge project={makeProject({ name: "" })} />);
    expect(screen.getByText("Unknown Project")).toBeInTheDocument();
  });

  it("renders error icon when error=true", () => {
    const { container } = render(<ProjectBadge project={null} error={true} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(screen.getByText("Unknown Project")).toBeInTheDocument();
  });

  it("renders correct icon from PROJECT_ICON_MAP", () => {
    const { container } = render(
      <ProjectBadge project={makeProject({ icon: "Code", color: "#ff0000" })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders default FolderIcon when project has no icon", () => {
    const { container } = render(
      <ProjectBadge project={makeProject({ icon: undefined })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders default FolderIcon when project icon not in map", () => {
    const { container } = render(
      <ProjectBadge project={makeProject({ icon: "NonExistentIcon" })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("applies project color to border", () => {
    const { container } = render(
      <ProjectBadge project={makeProject({ color: "#ff0000" })} />,
    );
    const badge = container.querySelector("[style]");
    expect(badge).toBeInTheDocument();
    expect(badge?.getAttribute("style")).toContain("#ff0000");
  });

  it("matches snapshot with project context", () => {
    const { container } = render(
      <ProjectBadge
        project={makeProject({ name: "Snap Project", icon: "Code", color: "#3b82f6" })}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot with error state", () => {
    const { container } = render(<ProjectBadge project={null} error={true} />);
    expect(container).toMatchSnapshot();
  });
});
