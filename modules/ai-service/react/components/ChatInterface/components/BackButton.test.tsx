import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackButton } from "./BackButton";

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

describe("BackButton", () => {
  it("renders button with correct aria-label", () => {
    render(<BackButton onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "Back to project" })).toBeInTheDocument();
  });

  it("calls onBack when clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<BackButton onBack={onBack} />);

    await user.click(screen.getByRole("button", { name: "Back to project" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    const { container } = render(<BackButton onBack={() => {}} className="custom-class" />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("custom-class");
  });

  it("renders ArrowLeft icon", () => {
    const { container } = render(<BackButton onBack={() => {}} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("matches snapshot", () => {
    const { container } = render(<BackButton onBack={() => {}} />);
    expect(container).toMatchSnapshot();
  });
});
