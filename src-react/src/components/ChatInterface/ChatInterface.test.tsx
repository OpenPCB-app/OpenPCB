import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatInterface } from "../ChatInterface";
import type { ChatConfig } from "./types";

const mockIsMessageStreaming = vi.hoisted(() => vi.fn(() => false));
const mockExtractMessageParts = vi.hoisted(() =>
  vi.fn(() => ({
    textParts: [{ type: "text" as const, text: "Hello" }],
    imageParts: [] as unknown[],
    reasoningParts: [] as Array<{ type: "reasoning"; text: string }>,
    toolCallParts: [] as unknown[],
    toolResultParts: [] as unknown[],
  })),
);
const reasoningPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/hooks/useChatInterface", () => ({
  useChatInterface: () => ({
    previewImage: null,
    handleImagePreview: vi.fn(),
    handleClosePreview: vi.fn(),
    messageRatings: {},
    handleRatingChange: vi.fn(),
    handleMessageAction: vi.fn(),
    isMessageStreaming: mockIsMessageStreaming,
    getMessageId: (_msg: unknown, idx: number) => `msg-${idx}`,
    createMarkdownComponents: () => ({}),
  }),
}));

vi.mock("@/lib/chat/messages", () => ({
  extractMessageParts: mockExtractMessageParts,
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="conversation" className={className}>{children}</div>
  ),
  ConversationContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="conversation-content" className={className}>{children}</div>
  ),
  ConversationEmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span data-testid="empty-title">{title}</span>
      <span data-testid="empty-description">{description}</span>
    </div>
  ),
}));

vi.mock("@/components/ai-elements/message", () => ({
  Message: ({ children, from }: { children: React.ReactNode; from: string }) => (
    <div data-testid={`message-${from}`}>{children}</div>
  ),
  MessageContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="message-content">{children}</div>
  ),
  MessageAttachment: () => <div data-testid="message-attachment" />,
}));

vi.mock("@/components/ai-elements/tool", () => ({
  Tool: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool">{children}</div>
  ),
  ToolHeader: ({
    title,
    state,
  }: {
    title: string;
    state: string;
  }) => <div data-testid="tool-header">{`${title}:${state}`}</div>,
  ToolContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool-content">{children}</div>
  ),
  ToolInput: ({ input }: { input: unknown }) => (
    <div data-testid="tool-input">{JSON.stringify(input)}</div>
  ),
  ToolOutput: ({ output }: { output: unknown }) => (
    <div data-testid="tool-output">{JSON.stringify(output)}</div>
  ),
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
  AIChatPromptInput: ({
    placeholder,
    chatId,
    workspaceId,
    toolsEnabled,
  }: {
    placeholder?: string;
    chatId?: string;
    workspaceId?: string;
    toolsEnabled?: boolean;
  }) => (
    <div data-testid="prompt-input">
      {placeholder && <span data-testid="placeholder">{placeholder}</span>}
      {chatId && <span data-testid="chat-id">{chatId}</span>}
      {workspaceId && <span data-testid="workspace-id">{workspaceId}</span>}
      {toolsEnabled !== undefined && (
        <span data-testid="tools-enabled">{String(toolsEnabled)}</span>
      )}
    </div>
  ),
}));

vi.mock("@/components/MessageFooter", () => ({
  MessageFooter: () => <div data-testid="message-footer" />,
}));

vi.mock("@/components/ai-elements/reasoning", () => ({
  Reasoning: ({
    children,
    isStreaming,
    defaultOpen,
  }: {
    children: React.ReactNode;
    isStreaming?: boolean;
    defaultOpen?: boolean;
  }) => {
    reasoningPropsSpy({ isStreaming, defaultOpen });
    return <div>{children}</div>;
  },
  ReasoningContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReasoningTrigger: () => <div />,
}));

vi.mock("@/components/ai/ModelLoadingErrorModal", () => ({
  ModelLoadingErrorModal: ({ isOpen, modelName }: { isOpen: boolean; modelName: string }) =>
    isOpen ? <div data-testid="error-modal">{modelName}</div> : null,
}));

vi.mock("@/components/ChatInterface/components", () => ({
  ChatHeader: ({
    showBack,
    onBack,
    projectContext,
    modelName,
  }: {
    showBack?: boolean;
    onBack?: () => void;
    projectContext?: unknown;
    modelName?: string;
  }) => (
    <div data-testid="chat-header">
      {showBack && onBack && <button data-testid="back-button" onClick={onBack}>Back</button>}
      {projectContext ? <span data-testid="project-badge">project</span> : null}
      {modelName && !projectContext && <span data-testid="model-badge">{modelName}</span>}
    </div>
  ),
}));

vi.mock("@/components/chat/MessageTextWithMentions", () => ({
  MessageTextWithMentions: ({ text }: { text: string }) => <span>{text}</span>,
}));

function createMessage(role: "user" | "assistant", text: string) {
  return {
    id: `msg-${Math.random()}`,
    role,
    content: text,
    parts: [{ type: "text" as const, text }],
    createdAt: new Date(),
  };
}

describe("ChatInterface", () => {
  beforeEach(() => {
    mockIsMessageStreaming.mockReset();
    mockIsMessageStreaming.mockReturnValue(false);
    mockExtractMessageParts.mockReset();
    mockExtractMessageParts.mockReturnValue({
      textParts: [{ type: "text" as const, text: "Hello" }],
      imageParts: [] as unknown[],
      reasoningParts: [] as Array<{ type: "reasoning"; text: string }>,
      toolCallParts: [] as unknown[],
      toolResultParts: [] as unknown[],
    });
    reasoningPropsSpy.mockClear();
  });

  describe("config.ui", () => {
    it("renders empty state with custom title and description when no messages", () => {
      const config: ChatConfig = {
        messages: [],
        ui: {
          emptyState: {
            title: "Welcome!",
            description: "Start chatting",
          },
        },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      expect(screen.getByTestId("empty-title")).toHaveTextContent("Welcome!");
      expect(screen.getByTestId("empty-description")).toHaveTextContent("Start chatting");
    });

    it("renders default empty state when no emptyState config provided", () => {
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      expect(screen.getByTestId("empty-title")).toHaveTextContent("No messages yet");
    });

    it("passes placeholder to prompt input", () => {
      const config: ChatConfig = {
        messages: [],
        ui: { placeholder: "Ask me anything..." },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("placeholder")).toHaveTextContent("Ask me anything...");
    });

    it("uses default placeholder when none provided", () => {
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("placeholder")).toHaveTextContent("What would you like to know?");
    });
  });

  describe("config.features", () => {
    it("passes tools.enabled to prompt input when true", () => {
      const config: ChatConfig = {
        messages: [],
        features: { tools: { enabled: true } },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("tools-enabled")).toHaveTextContent("true");
    });

    it("passes tools.enabled to prompt input when false", () => {
      const config: ChatConfig = {
        messages: [],
        features: { tools: { enabled: false } },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("tools-enabled")).toHaveTextContent("false");
    });

    it("stops reasoning streaming once assistant text starts streaming", () => {
      mockIsMessageStreaming.mockReturnValue(true);
      mockExtractMessageParts.mockReturnValue({
        textParts: [{ type: "text" as const, text: "Hello there" }],
        imageParts: [],
        reasoningParts: [{ type: "reasoning" as const, text: "Thinking..." }],
        toolCallParts: [],
        toolResultParts: [],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "Hello there")] as any,
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(reasoningPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isStreaming: false }),
      );
    });

    it("does not render reasoning blocks when disabled", () => {
      mockExtractMessageParts.mockReturnValue({
        textParts: [{ type: "text" as const, text: "Hello there" }],
        imageParts: [],
        reasoningParts: [{ type: "reasoning" as const, text: "Thinking..." }],
        toolCallParts: [],
        toolResultParts: [],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "Hello there")] as any,
        features: { reasoning: { enabled: false } },
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(reasoningPropsSpy).not.toHaveBeenCalled();
    });

    it("honors reasoning.defaultExpanded config", () => {
      mockExtractMessageParts.mockReturnValue({
        textParts: [{ type: "text" as const, text: "Hello there" }],
        imageParts: [],
        reasoningParts: [{ type: "reasoning" as const, text: "Thinking..." }],
        toolCallParts: [],
        toolResultParts: [],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "Hello there")] as any,
        features: { reasoning: { defaultExpanded: true } },
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(reasoningPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ defaultOpen: true }),
      );
    });

    it("keeps reasoning open while reasoning stream is active", () => {
      mockIsMessageStreaming.mockReturnValue(true);
      mockExtractMessageParts.mockReturnValue({
        textParts: [],
        imageParts: [],
        reasoningParts: [{ type: "reasoning" as const, text: "Thinking..." }],
        toolCallParts: [],
        toolResultParts: [],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "")] as any,
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(reasoningPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isStreaming: true, defaultOpen: true }),
      );
    });

    it("renders paired canonical tool-call/tool-result parts", () => {
      mockExtractMessageParts.mockReturnValue({
        textParts: [],
        imageParts: [],
        reasoningParts: [],
        toolCallParts: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "echo",
            args: { message: "hello" },
          },
        ],
        toolResultParts: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "echo",
            result: { ok: true },
            isError: false,
          },
        ],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "")] as any,
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(screen.getByTestId("tool-header")).toHaveTextContent(
        "echo:output-available",
      );
      expect(screen.getByTestId("tool-output")).toHaveTextContent(
        JSON.stringify({ ok: true }),
      );
    });

    it("renders orphan canonical tool results", () => {
      mockExtractMessageParts.mockReturnValue({
        textParts: [],
        imageParts: [],
        reasoningParts: [],
        toolCallParts: [],
        toolResultParts: [
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "echo",
            result: { error: "failed" },
            isError: true,
          },
        ],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "")] as any,
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      expect(screen.getByTestId("tool-header")).toHaveTextContent(
        "echo:output-error",
      );
      expect(screen.getByTestId("tool-output")).toHaveTextContent(
        JSON.stringify({ error: "failed" }),
      );
    });

    it("pairs duplicate toolCallId entries in consume-once order", () => {
      mockExtractMessageParts.mockReturnValue({
        textParts: [],
        imageParts: [],
        reasoningParts: [],
        toolCallParts: [
          {
            type: "tool-call",
            toolCallId: "call-dup",
            toolName: "echo",
            args: { message: "one" },
          },
          {
            type: "tool-call",
            toolCallId: "call-dup",
            toolName: "echo",
            args: { message: "two" },
          },
        ],
        toolResultParts: [
          {
            type: "tool-result",
            toolCallId: "call-dup",
            toolName: "echo",
            result: { ok: "first" },
            isError: false,
          },
          {
            type: "tool-result",
            toolCallId: "call-dup",
            toolName: "echo",
            result: { ok: "second" },
            isError: false,
          },
        ],
      });

      const config: ChatConfig = {
        messages: [createMessage("assistant", "")] as any,
        behavior: { onSubmit: vi.fn() },
      };

      render(<ChatInterface config={config} />);

      const outputs = screen
        .getAllByTestId("tool-output")
        .map((node) => node.textContent ?? "");
      expect(outputs).toEqual([
        JSON.stringify({ ok: "first" }),
        JSON.stringify({ ok: "second" }),
      ]);
    });
  });

  describe("config.context", () => {
    it("passes chatId to prompt input", () => {
      const config: ChatConfig = {
        messages: [],
        context: { chatId: "chat-123" },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("chat-id")).toHaveTextContent("chat-123");
    });

    it("passes workspaceId to prompt input", () => {
      const config: ChatConfig = {
        messages: [],
        context: { workspaceId: "ws-456" },
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("workspace-id")).toHaveTextContent("ws-456");
    });
  });

  describe("config.behavior", () => {
    it("renders back button when onBack is provided", () => {
      const onBack = vi.fn();
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn(), onBack },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("back-button")).toBeInTheDocument();
    });

    it("does NOT render back button when onBack is undefined", () => {
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.queryByTestId("back-button")).not.toBeInTheDocument();
    });

    it("does NOT render prompt input when onSubmit is undefined", () => {
      const config: ChatConfig = {
        messages: [],
      };
      render(<ChatInterface config={config} />);
      expect(screen.queryByTestId("prompt-input")).not.toBeInTheDocument();
    });

    it("renders prompt input when onSubmit is provided", () => {
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("prompt-input")).toBeInTheDocument();
    });
  });

  describe("config.projectContext", () => {
    it("renders project badge when projectContext is set", () => {
      const config: ChatConfig = {
        messages: [],
        projectContext: { id: "proj-1", name: "My Project" } as any,
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("project-badge")).toBeInTheDocument();
    });

    it("does NOT render project badge when projectContext is undefined", () => {
      const config: ChatConfig = {
        messages: [],
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.queryByTestId("project-badge")).not.toBeInTheDocument();
    });
  });

  describe("config.modelName", () => {
    it("renders model badge when modelName is set and no projectContext", () => {
      const config: ChatConfig = {
        messages: [],
        modelName: "gpt-4",
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.getByTestId("model-badge")).toHaveTextContent("gpt-4");
    });
  });

  describe("message rendering", () => {
    it("renders messages instead of empty state when messages exist", () => {
      const config: ChatConfig = {
        messages: [
          createMessage("user", "Hello"),
          createMessage("assistant", "Hi there"),
        ] as any,
        behavior: { onSubmit: vi.fn() },
      };
      render(<ChatInterface config={config} />);
      expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
      expect(screen.getByTestId("message-user")).toBeInTheDocument();
      expect(screen.getByTestId("message-assistant")).toBeInTheDocument();
    });
  });

  describe("config.className", () => {
    it("applies custom className to root container", () => {
      const config: ChatConfig = {
        messages: [],
        className: "my-custom-class",
        behavior: { onSubmit: vi.fn() },
      };
      const { container } = render(<ChatInterface config={config} />);
      expect(container.firstElementChild?.className).toContain("my-custom-class");
    });
  });
});
