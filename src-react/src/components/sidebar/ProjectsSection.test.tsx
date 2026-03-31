import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsSection } from "./ProjectsSection";

type Project = {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number | null;
  preferences?: {
    showInSidebar?: boolean;
  } | null;
};

const navigateToProject = vi.fn();
const navigateToHome = vi.fn();
let projects: Project[] = [];
let loading = false;

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects,
    loading,
  }),
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: {
      navigateToProject: typeof navigateToProject;
      navigateToHome: typeof navigateToHome;
    }) => unknown,
  ) =>
    selector({
      navigateToProject,
      navigateToHome,
    }),
}));

describe("ProjectsSection", () => {
  beforeEach(() => {
    navigateToProject.mockReset();
    navigateToHome.mockReset();
    loading = false;
    projects = [
      {
        id: "project-visible-default",
        name: "Visible Default",
        preferences: {},
      },
      {
        id: "project-hidden",
        name: "Hidden Project",
        preferences: { showInSidebar: false },
      },
      {
        id: "project-visible-explicit",
        name: "Visible Explicit",
        preferences: { showInSidebar: true },
      },
    ];
  });

  it("shows projects unless showInSidebar is explicitly false", () => {
    render(<ProjectsSection />);

    expect(screen.getByText("Visible Default")).toBeInTheDocument();
    expect(screen.getByText("Visible Explicit")).toBeInTheDocument();
    expect(screen.queryByText("Hidden Project")).not.toBeInTheDocument();
  });

  it("navigates to the project hub from the sidebar", async () => {
    const user = userEvent.setup();
    render(<ProjectsSection />);

    await user.click(screen.getByRole("button", { name: /visible explicit/i }));

    expect(navigateToProject).toHaveBeenCalledWith("project-visible-explicit");
  });
});
