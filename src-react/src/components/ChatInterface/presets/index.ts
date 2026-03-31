import type { ChatConfig } from "../types";
import type {
  ChatPreset,
  EmbeddedChatOptions,
  ProjectChatOptions,
  ModuleChatOptions,
} from "./types";

/**
 * Static preset configurations for common chat usage patterns.
 * Use these as base configs and override individual properties as needed.
 */
export const ChatInterfacePresets = {
  main: {
    name: "main" as const,
    description: "Full-featured main chat with all capabilities",
    ui: {
      mode: "full" as const,
      density: "comfortable" as const,
      showAvatars: true,
      showTimestamps: false,
      bubbleStyle: "default" as const,
      placeholder: "Type your message...",
    },
    features: {
      tools: {
        enabled: true,
        toolChoice: "auto" as const,
      },
      attachments: {
        enabled: true,
        multiple: true,
      },
      mentions: {
        enabled: true,
      },
      reasoning: {
        enabled: true,
        defaultExpanded: false,
      },
      imagePreview: {
        enabled: true,
      },
    },
    behavior: {
      autoFocus: true,
    },
  } satisfies ChatPreset,

  embedded: {
    name: "embedded" as const,
    description: "Compact chat embedded within another component",
    ui: {
      mode: "embedded" as const,
      density: "compact" as const,
      showAvatars: false,
      showTimestamps: false,
      bubbleStyle: "minimal" as const,
      placeholder: "Type a message...",
    },
    features: {
      tools: {
        enabled: false,
      },
      attachments: {
        enabled: false,
      },
      mentions: {
        enabled: false,
      },
      reasoning: {
        enabled: true,
        defaultExpanded: false,
      },
      imagePreview: {
        enabled: true,
      },
    },
    behavior: {
      autoFocus: false,
    },
  } satisfies ChatPreset,

  project: {
    name: "project" as const,
    description: "Project-scoped chat with back navigation and project badge",
    ui: {
      mode: "full" as const,
      density: "comfortable" as const,
      showAvatars: true,
      showTimestamps: false,
      bubbleStyle: "default" as const,
      placeholder: "Type your message...",
    },
    features: {
      tools: {
        enabled: true,
        toolChoice: "auto" as const,
      },
      attachments: {
        enabled: true,
        multiple: true,
      },
      mentions: {
        enabled: true,
      },
      reasoning: {
        enabled: true,
        defaultExpanded: false,
      },
      imagePreview: {
        enabled: true,
      },
    },
    behavior: {
      autoFocus: true,
    },
  } satisfies ChatPreset,

  module: {
    name: "module" as const,
    description: "Module-embedded chat with compact layout and restricted tools",
    ui: {
      mode: "embedded" as const,
      density: "compact" as const,
      showAvatars: false,
      showTimestamps: false,
      bubbleStyle: "minimal" as const,
      placeholder: "Ask about this...",
    },
    features: {
      tools: {
        enabled: false,
      },
      attachments: {
        enabled: false,
      },
      mentions: {
        enabled: false,
      },
      reasoning: {
        enabled: true,
        defaultExpanded: false,
      },
      imagePreview: {
        enabled: true,
      },
    },
    behavior: {
      autoFocus: false,
    },
  } satisfies ChatPreset,
} as const;

function mergeConfig(
  preset: ChatPreset,
  overrides?: Partial<ChatConfig>,
): ChatConfig {
  if (!overrides) return { ...preset };

  return {
    ...preset,
    ...overrides,
    ui: { ...preset.ui, ...overrides.ui },
    features: {
      ...preset.features,
      ...overrides.features,
      tools: { ...preset.features?.tools, ...overrides.features?.tools },
      attachments: {
        ...preset.features?.attachments,
        ...overrides.features?.attachments,
      },
      mentions: {
        ...preset.features?.mentions,
        ...overrides.features?.mentions,
      },
      reasoning: {
        ...preset.features?.reasoning,
        ...overrides.features?.reasoning,
      },
      imagePreview: {
        ...preset.features?.imagePreview,
        ...overrides.features?.imagePreview,
      },
    },
    context: { ...preset.context, ...overrides.context },
    behavior: {
      ...preset.behavior,
      ...overrides.behavior,
      modelLoading: {
        ...preset.behavior?.modelLoading,
        ...overrides.behavior?.modelLoading,
      },
    },
  };
}

export function createEmbeddedChat(
  options?: EmbeddedChatOptions & { overrides?: Partial<ChatConfig> },
): ChatConfig {
  const config = mergeConfig(
    ChatInterfacePresets.embedded,
    options?.overrides,
  );

  if (options?.maxHeight) {
    config.className = `max-h-[${options.maxHeight}] ${config.className ?? ""}`.trim();
  }

  return config;
}

export function createProjectChat(
  options: ProjectChatOptions & { overrides?: Partial<ChatConfig> },
): ChatConfig {
  const config = mergeConfig(ChatInterfacePresets.project, {
    ...options.overrides,
    projectContext: options.projectContext,
    context: {
      projectId: options.projectId,
      ...options.overrides?.context,
    },
    behavior: {
      onBack: options.onBack,
      ...options.overrides?.behavior,
    },
  });

  return config;
}

export function createModuleChat(
  options: ModuleChatOptions & { overrides?: Partial<ChatConfig> },
): ChatConfig {
  const config = mergeConfig(ChatInterfacePresets.module, {
    ...options.overrides,
    context: {
      moduleId: options.moduleId,
      spaceId: options.spaceId,
      systemPrompt: options.systemPrompt,
      ...options.overrides?.context,
    },
    features: {
      ...options.overrides?.features,
      tools: {
        ...options.overrides?.features?.tools,
        allowedTools: options.allowedTools,
      },
    },
  });

  return config;
}

export type { ChatPreset, PresetName } from "./types";
export type { EmbeddedChatOptions, ProjectChatOptions, ModuleChatOptions } from "./types";
