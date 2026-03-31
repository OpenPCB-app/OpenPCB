import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatList } from "./useChatList";

const listChatsMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/api/chat-api", () => ({
  listChats: (...args: unknown[]) => listChatsMock(...args),
}));

vi.mock("@/contexts/BackendURLContext", () => ({
  useBackendURL: () => ({ isReady: true }),
}));

vi.mock("@/stores/app-store", () => ({
  useAppStore: (selector: (state: { activeWorkspaceId: string }) => unknown) =>
    selector({ activeWorkspaceId: "ws-1" }),
}));

describe("useChatList", () => {
  it("excludes module-scoped chats including writer chats from main list", async () => {
    renderHook(() => useChatList());

    await waitFor(() => {
      expect(listChatsMock).toHaveBeenCalled();
    });

    expect(listChatsMock).toHaveBeenCalledWith(
      "ws-1",
      undefined,
      undefined,
      ["brainstorming_node", "knowledge_page", "writer_document"],
      null,
    );
  });
});
