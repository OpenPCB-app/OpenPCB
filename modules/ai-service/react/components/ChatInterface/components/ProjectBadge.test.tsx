import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProjectBadge } from "./ProjectBadge";
import type { ProjectRecord } from "@shared/types";

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
  it("always returns null (feature disabled)", () => {
    const { container } = render(<ProjectBadge project={makeProject()} />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null even with project data", () => {
    const { container } = render(
      <ProjectBadge project={makeProject({ name: "My Project" })} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null even with error state", () => {
    const { container } = render(<ProjectBadge project={null} error={true} />);
    expect(container.innerHTML).toBe("");
  });

  it("matches snapshot (empty)", () => {
    const { container } = render(
      <ProjectBadge
        project={makeProject({ name: "Snap Project", icon: "Code", color: "#3b82f6" })}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
