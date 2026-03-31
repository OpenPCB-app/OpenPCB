import { readSSEEvents } from "../integration/helpers/test-orchestrator";
import { DEFAULT_WORKSPACE_ID as GLOBAL_DEFAULT_WORKSPACE_ID } from "../../src/domain/constants";

const PROVIDER_ID = "ollama";
const MODEL_ID = "qwen3:8b";
const DEFAULT_PORT = "3000";
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_TIMEOUT_MS = 120000;

const TEST_WORKSPACE_ID =
  process.env.TEST_WORKSPACE_ID ??
  process.env.DEFAULT_WORKSPACE_ID ??
  GLOBAL_DEFAULT_WORKSPACE_ID ??
  "default";

const PROMPT = [
  "Create a knowledge page titled \"Ollama Tool Call Smoke Test\".",
  "Use the knowledge_create_page tool to create the page.",
  "Seed the page with Markdown: a short intro paragraph and 3 bullet points about this test.",
].join(" ");

function resolveBaseUrl(raw?: string): string {
  if (!raw) return DEFAULT_BASE_URL;

  try {
    const url = new URL(raw);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `http://127.0.0.1:${port}`;
  } catch {
    return raw;
  }
}

function parseEventData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function checkOllamaHealth(baseUrl: string): Promise<{ available: boolean; message?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/providers/${PROVIDER_ID}/health`);
    if (!response.ok) {
      return { available: false, message: `HTTP ${response.status}` };
    }

    const json = (await response.json()) as { data?: { available?: boolean; message?: string } };
    return {
      available: Boolean(json?.data?.available),
      message: json?.data?.message,
    };
  } catch (error) {
    return { available: false, message: error instanceof Error ? error.message : "Health check failed" };
  }
}

async function main(): Promise<void> {
  const baseUrl = resolveBaseUrl(process.env.TEST_API_URL).replace(/\/$/, "");
  const timeoutMs = Number(process.env.OLLAMA_TOOL_CALL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const health = await checkOllamaHealth(baseUrl);
  if (!health.available) {
    const reason = health.message ? ` (${health.message})` : "";
    console.log(`[Ollama tool-call] Skipping: provider unavailable${reason}.`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/stream/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: PROVIDER_ID,
        model: MODEL_ID,
        text: PROMPT,
        workspaceId: TEST_WORKSPACE_ID,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      console.log(`[Ollama tool-call] Request failed: HTTP ${response.status}.`);
      if (details) {
        console.log(details);
      }
      return;
    }

    let found = false;

    for await (const { event, data } of readSSEEvents(response)) {
      if (!data) continue;
      const payload = parseEventData(data);

      if (event === "tool_call" || event === "tool_result") {
        console.log(`[SSE ${event}]`);
        console.log(JSON.stringify(payload, null, 2));
        found = true;
        break;
      }

      if (event === "error") {
        console.log("[SSE error]");
        console.log(JSON.stringify(payload, null, 2));
        break;
      }
    }

    if (!found) {
      console.log("[Ollama tool-call] Stream ended before tool_call/tool_result.");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.log(`[Ollama tool-call] Timed out after ${timeoutMs}ms.`);
      return;
    }

    console.log(`[Ollama tool-call] Request failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

void main();
