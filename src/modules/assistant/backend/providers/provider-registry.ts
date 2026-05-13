import type { AssistantProviderId } from "../../../../sdks/assistant";
import type { AIProvider } from "./types";
import { OpenAICompatibleProvider } from "./openai-compatible";

export function defaultModel(provider: AssistantProviderId): string {
  if (provider === "ollama") return process.env.OLLAMA_MODEL ?? "llama3.1";
  if (provider === "lmstudio") return process.env.LMSTUDIO_MODEL ?? "local-model";
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export function createProvider(provider: AssistantProviderId): AIProvider {
  if (provider === "ollama") {
    return new OpenAICompatibleProvider("ollama", {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
      apiKey: process.env.OLLAMA_API_KEY,
    });
  }
  if (provider === "lmstudio") {
    return new OpenAICompatibleProvider("lmstudio", {
      baseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
      apiKey: process.env.LMSTUDIO_API_KEY,
    });
  }
  return new OpenAICompatibleProvider("openai", {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  });
}
