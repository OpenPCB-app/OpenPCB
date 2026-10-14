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
  MentionImageOmission,
  ResolvedMentionContent,
} from "./mention-resolver-types";
import type { PromptService } from "./prompt-service";
import type { ProviderMessageContext } from "./agentkit/provider-messages";
import type { SettingsStore } from "./settings-store";
import { parseImageDataUri } from "./tiptap-to-markdown";

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

export const MENTION_IMAGES_OMITTED_WARNING = "mention_images_omitted";

/** Adapt only app context; AgentKit retains branch assembly and correction passes. */
export async function providerContextMessages(input: {
  request: AiChatRequest;
  store: AssistantStore;
  resolver: ContextResolver;
  prompts: PromptService;
  readOnly: boolean;
}): Promise<ProviderMessageContext> {
  const { request, store, resolver, prompts } = input;
  request.signal?.throwIfAborted();
  const task = await store.tasks.getTask(request.runId);
  if (!task || typeof task.payload.chatId !== "string")
    throw new Error("Prompt run snapshot is missing");
  const preset = await runPreset(store, task.payload);
  const system = systemPrompt(
    prompts,
    preset,
    resolver,
    task.payload.chatId,
    request,
    input.readOnly,
  );
  const messages = request.messages.map((message, index) =>
    index === 0 && message.role === "system"
      ? { ...message, content: system }
      : message,
  );
  const resolved = await boundedMentions(messages, request.signal);
  request.signal?.throwIfAborted();
  const context = addMentionContext(messages, resolved);
  if (!context.userNotice) return { messages: context.messages, warnings: [] };
  // Every provider call in a run re-resolves mentions; the user needs the notice once.
  const warned = (await store.tasks.listEvents(request.runId)).some(
    (event) => event.type === "run.warning" &&
      (event as { data?: { code?: unknown } }).data?.code === MENTION_IMAGES_OMITTED_WARNING,
  );
  return {
    messages: context.messages,
    warnings: warned ? [] : [{ code: MENTION_IMAGES_OMITTED_WARNING, message: context.userNotice }],
  };
}

const UNBOUND_NOTE =
  "This chat has no design yet, so only read tools and designer_create_design are available in this turn. " +
  "If the user asked to build a circuit, resolve the BOM and create the design, then end the turn saying the design is ready; " +
  "placement and wiring tools become available on the user's next message.";

/** Write guidance follows the tools AgentKit actually staged for this run, not the full catalog. */
function systemPrompt(
  prompts: PromptService,
  preset: AssistantPromptPresetId,
  resolver: ContextResolver,
  chatId: string,
  request: AiChatRequest,
  readOnly: boolean,
): string {
  const bindings = resolver
    .listBindings(chatId)
    .filter((binding) => binding.status === "active");
  const blocks = bindings.map((binding, index) => ({
    id: `binding-${binding.id}`,
    title: `Bound ${binding.kind} (${binding.role})`,
    content: `${binding.label} (refId=${binding.refId})`,
    priority: 10 + index,
  }));
  const tools = request.tools ?? [];
  const editsStaged = tools.some(
    (tool) => tool.effect === "write" && tool.name !== "designer_create_design",
  );
  if (!readOnly && !editsStaged && tools.some((tool) => tool.name === "designer_create_design"))
    blocks.unshift({ id: "unbound-design", title: "No design bound", content: UNBOUND_NOTE, priority: 1 });
  return prompts.composeSystem(preset, blocks, {
    includeWriteTools: !readOnly && editsStaged,
  });
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

/** One group per recent user message, oldest first. */
async function boundedMentions(
  messages: AiChatMessage[],
  signal?: AbortSignal,
): Promise<ResolvedMentionContent[][]> {
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
  const timeout = new Promise<ResolvedMentionContent[][]>((resolve) => {
    timer = setTimeout(
      () =>
        resolve([[
          {
            entityType: "context",
            entityId: "mention-timeout",
            displayText: "Mention context unavailable",
            content:
              "Mention resolution timed out after 5000 ms. Do not infer the referenced document contents.",
            images: [],
            exists: false,
          },
        ]]),
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
      resolved,
      timeout,
      cancelled,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}

/**
 * Referenced documents ride on the latest user turn as untrusted data, never as
 * system authority. Images that cannot be sent are named in a model notice; the
 * user is told only about mentions in the message they just sent.
 */
function addMentionContext(
  messages: AiChatMessage[],
  groups: ResolvedMentionContent[][],
): { messages: AiChatMessage[]; userNotice: string | null } {
  const key = (mention: ResolvedMentionContent) => `${mention.entityType}:${mention.entityId}`;
  const latest = new Set((groups.at(-1) ?? []).map(key));
  const unique = [
    ...new Map(groups.flat().map((mention) => [key(mention), mention])).values(),
  ].slice(0, 10);
  const text = new MentionContentResolver().formatAsContextSection(unique);
  const omitted = unique.flatMap((mention) =>
    (mention.omittedImages ?? []).map((reason) => ({ key: key(mention), reason })));
  const images = boundedImages(
    unique.flatMap((mention) => mention.images.map((image) => ({ key: key(mention), image }))),
    omitted,
  );
  const detail = omissionDetail(omitted.map((item) => item.reason));
  const notice = detail &&
    `Image notice: ${detail} Do not describe or infer their contents.`;
  const userNotice = omissionDetail(
    omitted.filter((item) => latest.has(item.key)).map((item) => item.reason),
  );
  const extra = [text, notice].filter((item): item is string => !!item);
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  if (lastUser < 0 || (!extra.length && !images.length))
    return { messages, userNotice };
  const result = messages.map((message, index) =>
    index !== lastUser
      ? message
      : { ...message, content: withMentionContent(message.content, extra, images) },
  );
  return { messages: result, userNotice };
}

function withMentionContent(
  content: AiChatMessage["content"],
  extra: string[],
  images: Array<{ source: AiImageSource }>,
): AiChatMessage["content"] {
  if (typeof content === "string" && !images.length)
    return [content, ...extra].join("\n\n");
  return [
    ...(typeof content === "string"
      ? [{ type: "text" as const, text: content }]
      : content),
    ...extra.map((text) => ({ type: "text" as const, text })),
    ...images.map((image) => ({ type: "image" as const, source: image.source })),
  ];
}

function boundedImages(
  images: Array<{ key: string; image: MentionImage }>,
  omitted: Array<{ key: string; reason: MentionImageOmission }>,
): Array<{ source: AiImageSource }> {
  let remaining = 20 * 1024 * 1024;
  const sent: Array<{ source: AiImageSource }> = [];
  for (const { key, image } of images) {
    const source = imageSource(image);
    if (!source) omitted.push({ key, reason: "unsupported" });
    else if (image.byteSize > MENTION_LIMITS.MAX_IMAGE_BYTE_SIZE) omitted.push({ key, reason: "too_large" });
    else if (image.byteSize > remaining || sent.length >= MENTION_LIMITS.MAX_TOTAL_IMAGES)
      omitted.push({ key, reason: "over_limit" });
    else {
      remaining -= image.byteSize;
      sent.push({ source });
    }
  }
  return sent;
}

/** Fail closed: only allow-listed inline data images, never a URL the provider would fetch. */
function imageSource(image: MentionImage): AiImageSource | null {
  const parsed = parseImageDataUri(image.src);
  return parsed ? { kind: "data", mediaType: parsed.mimeType, base64: parsed.base64 } : null;
}

function omissionDetail(omitted: MentionImageOmission[]): string | null {
  if (!omitted.length) return null;
  const count = (reason: MentionImageOmission) =>
    omitted.filter((item) => item === reason).length;
  const reasons = [
    [count("unsupported"), "unsupported type or source (only inline PNG, JPEG, GIF and WebP are sent)"],
    [count("too_large"), "larger than the 5 MiB per-image limit"],
    [count("over_limit"), "over the per-message image budget"],
  ] as const;
  const detail = reasons
    .filter(([n]) => n > 0)
    .map(([n, reason]) => `${n} ${reason}`)
    .join("; ");
  return `${omitted.length} referenced image(s) were not sent to the model (${detail}).`;
}
