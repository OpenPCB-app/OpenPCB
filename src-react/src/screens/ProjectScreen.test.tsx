import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectScreen } from "./ProjectScreen";

const navigateToHome = vi.fn();
const navigateToDesign = vi.fn();
const navigateToNotes = vi.fn();
const navigateToChat = vi.fn();
const updateProject = vi.fn();
const createDesign = vi.fn();
const updateDesign = vi.fn();
const removeDesign = vi.fn();
const getProjectTree = vi.fn();
const ensureProjectRoot = vi.fn();

let designs = [
  {
    id: "design-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    name: "Main Board",
    description: "Primary layout",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
];

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector?: (state: {
      currentProjectId: string;
      navigateToHome: typeof navigateToHome;
      navigateToDesign: typeof navigateToDesign;
      navigateToNotes: typeof navigateToNotes;
      navigateToChat: typeof navigateToChat;
    }) => unknown,
  ) => {
    const state = {
      currentProjectId: "project-1",
      navigateToHome,
      navigateToDesign,
      navigateToNotes,
      navigateToChat,
    };

    return selector ? selector(state) : state;
  },
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: [
      {
        id: "project-1",
        workspaceId: "workspace-1",
        name: "Motor Driver",
        description: "Main project",
        status: "active",
        icon: "briefcase",
        color: "#3b82f6",
      },
    ],
    loading: false,
    error: null,
    update: updateProject,
  }),
}));

vi.mock("@/hooks/useDesigns", () => ({
  useDesigns: () => ({
    designs,
    create: createDesign,
    update: updateDesign,
    remove: removeDesign,
  }),
}));

vi.mock("@/hooks/useChatList", () => ({
  useChatList: () => ({
    chats: [],
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useChatOperations", () => ({
  useChatOperations: () => ({
    createNewChat: vi.fn(),
    moveToProject: vi.fn(),
    isCreating: false,
  }),
}));

vi.mock("@modules/knowledge/react/hooks/useKnowledgeApi", () => ({
  useKnowledgeApi: () => ({
    getProjectTree,
    ensureProjectRoot,
  }),
}));

vi.mock("@/components/project/ProjectDeleteConfirmDialog", () => ({
  ProjectDeleteConfirmDialog: () => null,
}));

describe("ProjectScreen", () => {
  beforeEach(() => {
    navigateToHome.mockReset();
    navigateToDesign.mockReset();
    navigateToNotes.mockReset();
    navigateToChat.mockReset();
    updateProject.mockReset();
    createDesign.mockReset();
    updateDesign.mockReset();
    removeDesign.mockReset();
    getProjectTree.mockReset();
    ensureProjectRoot.mockReset();

    getProjectTree.mockResolvedValue([]);
    ensureProjectRoot.mockResolvedValue(undefined);
    createDesign.mockResolvedValue(undefined);
    updateDesign.mockResolvedValue(undefined);
    removeDesign.mockResolvedValue(undefined);

    designs = [
      {
        id: "design-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        name: "Main Board",
        description: "Primary layout",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    ];
  });

  it("opens an existing design from the project hub", async () => {
    const user = userEvent.setup();
    render(<ProjectScreen />);

    await user.click(screen.getByRole("button", { name: /^open$/i }));

    expect(navigateToDesign).toHaveBeenCalledWith("project-1", "design-1");
  });

  it("creates a new design from the hub dialog", async () => {
    const user = userEvent.setup();
    render(<ProjectScreen />);

    await user.click(screen.getByRole("button", { name: /new design/i }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Power Stage");
    await user.type(within(dialog).getByLabelText("Description"), "Rev B");
    await user.click(within(dialog).getByRole("button", { name: /create design/i }));

    await waitFor(() =>
      expect(createDesign).toHaveBeenCalledWith({
        name: "Power Stage",
        description: "Rev B",
      }),
    );
  });

  it("deletes a design from the hub", async () => {
    const user = userEvent.setup();
    render(<ProjectScreen />);

    await user.click(screen.getByRole("button", { name: /delete main board/i }));

    await waitFor(() => expect(removeDesign).toHaveBeenCalledWith("design-1"));
  });
});
