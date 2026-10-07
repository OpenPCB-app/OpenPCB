import type { AiChatMessage, AiChatRequest } from "agentkit/core";
import type { AiImageSource } from "agentkit/contracts";
import type {
  AssistantStore,
  SubmitMessageInput,
  RegenerateMessageInput,
} from "agentkit/host";
import { messageContentToText } from "agentkit/core";
import { ValidationError } from "../../../core/contracts/errors";
import type { AssistantPromptPresetId } from "../../../sdks/assistant";
import type { ContextResolver } from "./context-resolver";
import {
  MentionContentResolver,
  MENTION_LIMITS,
} from "./mention-content-resolver";
import type {
  MentionImage,
  ResolvedMentionContent,
} from "./mention-resolver-types";
import type { PromptService } from "./prompt-service";
import type { SettingsStore } from "./settings-store";

const PROMPT_KEY = "__openpcbPromptPreset";
const PRESETS = [
  "strict-grounded",
  "friendly-tutorial",
  "minimal-concise",
] as const;

export async function snapshotPrompt(
  input: SubmitMessageInput | RegenerateMessageInput,
  store: AssistantStore,
  settings: SettingsStore,
): Promise<Record<string, unknown>> {
  const chat = await store.conversations.getChat(input.chatId);
  const preset =
    input.metadata?.promptPresetId ??
    chat?.metadata.promptPresetId ??
    settings.getSettings().defaultPromptPresetId;
  if (
    typeof preset !== "string" ||
    !PRESETS.includes(preset as AssistantPromptPresetId)
  ) {
    throw new ValidationError("Unknown prompt preset");
  }
  return { [PROMPT_KEY]: preset };
}

/** Adapt only app context; AgentKit retains branch assembly and correction passes. */
export async function providerContextMessages(input: {
  request: AiChatRequest;
  store: AssistantStore;
  resolver: ContextResolver;
  prompts: PromptService;
  readOnly: boolean;
}): Promise<AiChatMessage[]> {
  const { request, store, resolver, prompts } = input;
  request.signal?.throwIfAborted();
  const task = await store.tasks.getTask(request.runId);
  if (!task || typeof task.payload.chatId !== "string")
    throw new Error("Prompt run snapshot is missing");
  const preset = await runPreset(store, task.payload);
  const bindings = resolver
    .listBindings(task.payload.chatId)
    .filter((binding) => binding.status === "active");
  const blocks = bindings.map((binding, index) => ({
    id: `binding-${binding.id}`,
    title: `Bound ${binding.kind} (${binding.role})`,
    content: `${binding.label} (refId=${binding.refId})`,
    priority: 10 + index,
  }));
  const system = prompts.composeSystem(preset, blocks, {
    includeWriteTools: !input.readOnly,
  });
  const messages = request.messages.map((message, index) =>
    index === 0 && message.role === "system"
      ? { ...message, content: system }
      : message,
  );
  const resolved = await boundedMentions(messages, request.signal);
  request.signal?.throwIfAborted();
  return addMentionContext(messages, resolved);
}

async function runPreset(
  store: AssistantStore,
  payload: Record<string, unknown>,
): Promise<AssistantPromptPresetId> {
  for (const key of ["assistantMessageId", "userMessageId"]) {
    const id = payload[key];
    if (typeof id !== "string") continue;
    const value = (await store.conversations.getMessage(id))?.metadata[
      PROMPT_KEY
    ];
    if (
      typeof value === "string" &&
      PRESETS.includes(value as AssistantPromptPresetId)
    )
      return value as AssistantPromptPresetId;
  }
  throw new Error("Prompt run snapshot is missing");
}

async function boundedMentions(
  messages: AiChatMessage[],
  signal?: AbortSignal,
): Promise<ResolvedMentionContent[]> {
  const resolver = new MentionContentResolver();
  const users = messages
    .filter((message) => message.role === "user")
    .slice(-10);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    aborted = () =>
      reject(signal?.reason ?? new Error("Mention resolution cancelled"));
    signal?.addEventListener("abort", aborted, { once: true });
  });
  const timeout = new Promise<ResolvedMentionContent[]>((resolve) => {
    timer = setTimeout(
      () =>
        resolve([
          {
            entityType: "context",
            entityId: "mention-timeout",
            displayText: "Mention context unavailable",
            content:
              "Mention resolution timed out after 5000 ms. Do not infer the referenced document contents.",
            images: [],
            exists: false,
          },
        ]),
      MENTION_LIMITS.RESOLUTION_TIMEOUT_MS,
    );
  });
  try {
    signal?.throwIfAborted();
    const resolved = Promise.all(
      users.map((message) =>
        resolver.resolveMessageMentions(
          messageContentToText(message.content),
          "default",
        ),
      ),
    );
    return await Promise.race([
      resolved.then((groups) => groups.flat()),
      timeout,
      cancelled,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}

function addMentionContext(
  messages: AiChatMessage[],
  resolved: ResolvedMentionContent[],
): AiChatMessage[] {
  const unique = [
    ...new Map(
      resolved.map((mention) => [
        `${mention.entityType}:${mention.entityId}`,
        mention,
      ]),
    ).values(),
  ].slice(0, 10);
  const text = new MentionContentResolver()
    .formatAsContextSection(unique)
    .slice(0, MENTION_LIMITS.MAX_TOTAL_CONTEXT_CHARS);
  const images = boundedImages(unique.flatMap((mention) => mention.images));
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  const result = messages.map((message, index) =>
    index !== lastUser || !images.length
      ? message
      : {
          ...message,
          content: [
            ...(typeof message.content === "string"
              ? [{ type: "text" as const, text: message.content }]
              : message.content),
            ...images.map((image) => ({
              type: "image" as const,
              source: imageSource(image),
            })),
          ],
        },
  );
  if (text) result.splice(1, 0, { role: "system", content: text });
  return result;
}

function boundedImages(images: MentionImage[]): MentionImage[] {
  let remaining = 20 * 1024 * 1024;
  return images
    .filter((image) => {
      if (
        image.byteSize > MENTION_LIMITS.MAX_IMAGE_BYTE_SIZE ||
        image.byteSize > remaining
      )
        return false;
      remaining -= image.byteSize;
      return true;
    })
    .slice(0, MENTION_LIMITS.MAX_TOTAL_IMAGES);
}

function imageSource(image: MentionImage): AiImageSource {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(image.src);
  return match
    ? { kind: "data", mediaType: match[1]!, base64: match[2]! }
    : { kind: "url", url: image.src };
}
