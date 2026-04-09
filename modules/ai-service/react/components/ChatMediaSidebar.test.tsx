import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChatMediaSidebar } from "@/components/ChatMediaSidebar";
import type { FileRecord } from "@shared/types/file.types";

const useMediaFilesMock = vi.hoisted(() => vi.fn());
const useBackendURLMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useMediaFiles", () => ({
  useMediaFiles: useMediaFilesMock,
}));

vi.mock("@/contexts/BackendURLContext", () => ({
  useBackendURL: useBackendURLMock,
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{
    active: string;
    setActive: (value: string) => void;
  } | null>(null);

  function Tabs({
    defaultValue,
    children,
  }: {
    defaultValue: string;
    className?: string;
    children: React.ReactNode;
  }) {
    const [active, setActive] = React.useState(defaultValue);
    return <TabsContext.Provider value={{ active, setActive }}>{children}</TabsContext.Provider>;
  }

  function TabsList({ children }: { children: React.ReactNode; className?: string }) {
    return <div role="tablist">{children}</div>;
  }

  function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
    const ctx = React.useContext(TabsContext);
    if (!ctx) return null;
    const selected = ctx.active === value;
    return (
      <button role="tab" aria-selected={selected} onClick={() => ctx.setActive(value)}>
        {children}
      </button>
    );
  }

  function TabsContent({
    value,
    children,
  }: {
    value: string;
    className?: string;
    children: React.ReactNode;
  }) {
    const ctx = React.useContext(TabsContext);
    if (!ctx || ctx.active !== value) return null;
    return <div role="tabpanel">{children}</div>;
  }

  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

function createFile(overrides: Partial<FileRecord>): FileRecord {
  return {
    id: overrides.id ?? "file-1",
    blobId: overrides.blobId ?? "blob-1",
    originalName: overrides.originalName ?? "file",
    mimeType: overrides.mimeType ?? "application/octet-stream",
    sizeBytes: overrides.sizeBytes ?? 1024,
    currentVersion: overrides.currentVersion ?? 1,
    workspaceId: overrides.workspaceId ?? "ws-1",
    projectId: overrides.projectId ?? null,
    spaceId: overrides.spaceId ?? null,
    tags: overrides.tags ?? [],
    permissions: overrides.permissions ?? null,
    metadata: overrides.metadata ?? null,
    status: overrides.status ?? "active",
    trashedAt: overrides.trashedAt ?? null,
    trashedBy: overrides.trashedBy ?? null,
    createdAt: overrides.createdAt ?? "2026-02-16T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-16T10:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe("ChatMediaSidebar", () => {
  beforeEach(() => {
    useBackendURLMock.mockReturnValue({ backendURL: "http://127.0.0.1:3210" });
    useMediaFilesMock.mockReturnValue({
      files: [],
      imageFiles: [],
      documentFiles: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("renders empty state when no media files exist", () => {
    render(
      <ChatMediaSidebar chatId="chat-1" open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByTestId("chat-media-sidebar")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("No media shared in this chat yet")).toBeInTheDocument();
  });

  it("does not render docked panel when closed", () => {
    render(
      <ChatMediaSidebar chatId="chat-1" open={false} onOpenChange={vi.fn()} />,
    );

    expect(screen.queryByTestId("chat-media-sidebar")).not.toBeInTheDocument();
  });

  it("renders image and document groups from hook data", () => {
    const image = createFile({
      id: "img-1",
      originalName: "design.png",
      mimeType: "image/png",
      sizeBytes: 2048,
    });
    const doc = createFile({
      id: "doc-1",
      originalName: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
    });

    useMediaFilesMock.mockReturnValue({
      files: [image, doc],
      imageFiles: [image],
      documentFiles: [doc],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <ChatMediaSidebar chatId="chat-1" open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "design.png" })).toBeInTheDocument();
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
  });

  it("switches filter tabs between all/images/documents", () => {
    const image = createFile({
      id: "img-2",
      originalName: "wireframe.png",
      mimeType: "image/png",
    });
    const doc = createFile({
      id: "doc-2",
      originalName: "spec.md",
      mimeType: "text/markdown",
    });

    useMediaFilesMock.mockReturnValue({
      files: [image, doc],
      imageFiles: [image],
      documentFiles: [doc],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <ChatMediaSidebar chatId="chat-1" open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "wireframe.png" })).toBeInTheDocument();
    expect(screen.getByText("spec.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    const imagesPanel = screen.getByRole("tabpanel");
    expect(within(imagesPanel).getByRole("button", { name: "wireframe.png" })).toBeInTheDocument();
    expect(within(imagesPanel).queryByText("spec.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    const documentsPanel = screen.getByRole("tabpanel");
    expect(within(documentsPanel).queryByRole("button", { name: "wireframe.png" })).not.toBeInTheDocument();
    expect(within(documentsPanel).getByText("spec.md")).toBeInTheDocument();
  });

  it("opens preview modal when thumbnail is clicked", () => {
    const image = createFile({
      id: "img-3",
      originalName: "preview.png",
      mimeType: "image/png",
    });

    useMediaFilesMock.mockReturnValue({
      files: [image],
      imageFiles: [image],
      documentFiles: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <ChatMediaSidebar chatId="chat-1" open onOpenChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "preview.png" }));

    expect(screen.getByText("Close preview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download", hidden: true })).toHaveAttribute(
      "href",
      "http://127.0.0.1:3210/api/files/img-3/content",
    );
  });
});
