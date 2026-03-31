import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

type Project = {
  id: string;
  name: string;
};

const navigateToProject = vi.fn();
const navigateToDesign = vi.fn();
let projects: Project[] = [];
let workspaceDesigns = [{ id: "design-1", name: "Loose Part", description: "Workspace design" }];

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: {
      navigateToProject: typeof navigateToProject;
      navigateToDesign: typeof navigateToDesign;
    }) => unknown,
  ) => selector({ navigateToProject, navigateToDesign }),
}));

vi.mock("@/stores/app-store", () => ({
  useAppStore: (
    selector: (state: {
      projects: Project[];
      activeWorkspaceId: string;
      workspaces: Array<{ id: string; name: string }>;
    }) => unknown,
  ) =>
    selector({
      projects,
      activeWorkspaceId: "workspace-1",
      workspaces: [{ id: "workspace-1", name: "Main Workspace" }],
    }),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/project/ProjectCreateDialog", () => ({
  ProjectCreateDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated?: (project: { id: string }) => void;
  }) =>
    open ? (
      <button onClick={() => onCreated?.({ id: "project-new" })}>
        Confirm Create Project
      </button>
    ) : null,
}));

vi.mock("@/components/design/DesignDialog", () => ({
  DesignDialog: ({
    open,
    title,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    onConfirm: (input: { name: string; description: string }) => Promise<void>;
  }) =>
    open ? (
      <button
        onClick={() =>
          void onConfirm({ name: `${title} Result`, description: "Workspace description" })
        }
      >
        Confirm {title}
      </button>
    ) : null,
}));

const createDesign = vi.fn();
const updateDesign = vi.fn();
const removeDesign = vi.fn();

vi.mock("@/hooks/useDesigns", () => ({
  useDesigns: () => ({
    designs: workspaceDesigns,
    create: createDesign,
    update: updateDesign,
    remove: removeDesign,
  }),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    navigateToProject.mockReset();
    navigateToDesign.mockReset();
    createDesign.mockReset();
    updateDesign.mockReset();
    removeDesign.mockReset();
    projects = [
      { id: "project-1", name: "Motor Driver" },
      { id: "project-2", name: "Power Board" },
    ];
    workspaceDesigns = [
      { id: "design-1", name: "Loose Part", description: "Workspace design" },
    ];
  });

  it("navigates to the project hub when a project card is clicked", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /motor driver/i }));

    expect(navigateToProject).toHaveBeenCalledWith("project-1");
  });

  it("routes the create-project flow to the new project hub", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.click(screen.getByRole("button", { name: /confirm create project/i }));

    expect(navigateToProject).toHaveBeenCalledWith("project-new");
  });

  it("opens workspace-level designs without a project", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /^open$/i }));

    expect(navigateToDesign).toHaveBeenCalledWith(null, "design-1");
  });

  it("creates a workspace-level design and opens it", async () => {
    const user = userEvent.setup();
    createDesign.mockResolvedValue({ id: "design-new" });

    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /new design/i }));
    await user.click(screen.getByRole("button", { name: /confirm create workspace design/i }));

    expect(createDesign).toHaveBeenCalledWith({
      name: "Create Workspace Design Result",
      description: "Workspace description",
    });
    expect(navigateToDesign).toHaveBeenCalledWith(null, "design-new");
  });
});
