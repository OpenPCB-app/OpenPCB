import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelBadge } from "./ModelBadge";
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

describe("ModelBadge", () => {
  it("renders model name", () => {
    render(<ModelBadge modelName="gpt-4o" loadingState={null} />);
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("passes loadingState to ModelLoadingBadge", () => {
    const state: ModelLoadingState = { status: "loading", modelName: "gpt-4o" };
    render(<ModelBadge modelName="gpt-4o" loadingState={state} />);
    const badge = screen.getByTestId("model-loading-badge");
    expect(badge).toHaveAttribute("data-status", "loading");
  });

  it("applies custom className", () => {
    const { container } = render(
      <ModelBadge modelName="gpt-4o" loadingState={null} className="extra" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("extra");
  });

  it("matches snapshot", () => {
    const { container } = render(
      <ModelBadge
        modelName="gpt-4o"
        loadingState={{ status: "ready", modelName: "gpt-4o" }}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
