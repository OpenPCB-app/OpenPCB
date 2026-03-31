# src-ts/src/infrastructure/ai-providers/engines/

AI provider engine implementations for OpenAI, Ollama, and OpenRouter.

## WHERE TO LOOK

| Engine | File | Notes |
|--------|------|-------|
| OpenAI | `openai.ts` | SDK-based, supports vision/tools/reasoning |
| Ollama | `ollama.ts` | HTTP-based, manual NDJSON streaming + tag parsing |
| OpenRouter | `openrouter.ts` | OpenAI-compatible adapter |
| Registry | `mod.ts` | Engine factory mapping and registration |
| Base Class | `../engine.ts` | `BaseProviderEngine` abstract base |

## PROVIDER PATTERNS

- **Abstraction**: All engines implement `KernelProviderEngine` via `BaseProviderEngine`.
- **Streaming**: Uses `StreamCallbacks` (`onToken`, `onReasoning`, `onToolCall`, `onComplete`).
- **Ollama Specific**: Manual parsing for `<think>` tags and native `reasoning`/`thinking` fields.
- **Switching**: Lazy instantiation via `ProviderRegistry` using `ENGINE_FACTORIES`.
- **Validation**: Engines validate model existence and capabilities (vision, reasoning) before chat.
- **Model Cache**: 60s TTL for dynamic model lists fetched from provider APIs.

## CONVENTIONS

- **BaseURL**: Engines provide `defaultBaseURL` but allow override via `ProviderConfig`.
- **Initialization**: `initialize(config)` is required before use; sets up clients/keys.
- **Error Handling**: `detectErrorCode` (Ollama) classifies network/timeout vs auth errors.
- **Abort Logic**: Uses `TaskId`-keyed `AbortController` map for stream cancellation.
- **Model Preloading**: Ollama supports `preloadModel` via `/api/chat` with empty messages.
