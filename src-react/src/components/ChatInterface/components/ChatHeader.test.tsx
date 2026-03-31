import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatHeader } from "./ChatHeader";
import type { ProjectRecord } from "@shared/types";
import type { ModelLoadingState } from "@/stores/model-loading-store";

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/ai/ModelLoadingBadge", () => ({
  ModelLoadingBadge: ({
    modelName,
    loadingState,
    className,
  }: {
    modelName: string;
    loadingState: ModelLoadingState | null;
    className?: string;
  }) => (
    <div
      data-testid="model-loading-badge"
      data-model={modelName}
      data-status={loadingState?.status ?? "idle"}
      className={className}
    >
      {modelName}
    </div>
  ),
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

describe("ChatHeader", () => {
  it("renders BackButton when showBack and onBack provided", () => {
    render(<ChatHeader showBack onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "Back to project" })).toBeInTheDocument();
  });

  it("does NOT render BackButton when showBack is false", () => {
    render(<ChatHeader showBack={false} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "Back to project" })).not.toBeInTheDocument();
  });

  it("does NOT render BackButton when onBack is undefined", () => {
    render(<ChatHeader showBack />);
    expect(screen.queryByRole("button", { name: "Back to project" })).not.toBeInTheDocument();
  });

  it("renders ProjectBadge when projectContext provided", () => {
    render(<ChatHeader projectContext={makeProject({ name: "My Project" })} />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("renders ProjectBadge when projectContextError is true", () => {
    render(<ChatHeader projectContextError />);
    expect(screen.getByText("Unknown Project")).toBeInTheDocument();
  });

  it("renders ModelBadge when modelName provided and no projectContext", () => {
    render(<ChatHeader modelName="gpt-4o" />);
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("does NOT render ModelBadge when projectContext is present", () => {
    render(
      <ChatHeader
        modelName="gpt-4o"
        projectContext={makeProject({ name: "Project" })}
      />,
    );
    expect(screen.queryByTestId("model-loading-badge")).not.toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
  });

  it("renders empty when no props provided", () => {
    const { container } = render(<ChatHeader />);
    expect(container.innerHTML).toBe("");
  });

  it("matches snapshot with all features", () => {
    const { container } = render(
      <ChatHeader
        showBack
        onBack={() => {}}
        projectContext={makeProject({ name: "Full Header", icon: "Code", color: "#3b82f6" })}
        modelName="gpt-4o"
        modelLoadingState={{ status: "ready", modelName: "gpt-4o" }}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
