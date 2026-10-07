// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RendererCredentials } from "../../../../contracts/credentials/renderer";
import { AssistantPanel } from "./AssistantPanel";

vi.mock("../../providers/RuntimeProvider", () => ({ useRuntime: () => ({ backendURL: "http://127.0.0.1:3000" }) }));
vi.mock("../../cloud/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("./McpSection", () => ({ McpSection: () => null }));

const CANARY = "sk-react-draft-canary-78185c";
let container: HTMLDivElement;
let root: Root;
let configured: boolean;
let requests: Array<{ url: string; body?: string }>;
let credentials: RendererCredentials;

const provider = (id: string) => ({
  id, label: id, kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1",
  defaultModel: "fixture-model", enabled: true, isBuiltin: false,
  hasApiKey: id === "Provider A" && configured, apiKeyPreview: configured ? "••••" : null,
  capabilities: null, createdAt: "2026-10-06", updatedAt: configured ? "2026-10-07" : "2026-10-06",
});

async function click(text: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button missing: ${text}`);
  await act(async () => { button.click(); });
}

async function enterKey(): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("API key input missing");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, CANARY);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  configured = false;
  requests = [];
  credentials = {
    set: vi.fn(async () => { configured = true; return { ok: true as const, value: { configured: true } }; }),
    clear: vi.fn(async () => { configured = false; return { ok: true as const, value: { configured: false } }; }),
    status: vi.fn(async () => ({ ok: true as const, value: { configured } })),
  };
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { credentials } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.endsWith("/settings")) return Response.json({ defaultProviderId: "Provider A" });
    if (url.endsWith("/models")) return Response.json([]);
    if (url.endsWith("/tool-calling")) return Response.json({ mode: "auto" });
    if (url.endsWith("/providers")) return Response.json(init?.method === "POST" ? provider("Created provider") : [provider("Provider A"), provider("Provider B")]);
    return Response.json(provider("Provider A"));
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<AssistantPanel />); });
  await click("Provider A");
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  delete window.electronAPI;
  vi.unstubAllGlobals();
});

describe("AssistantPanel credential drafts", () => {
  test("successful save clears ephemeral key, reloads masked state, and never sends credentials over HTTP", async () => {
    await enterKey();
    await click("Save provider");
    expect(credentials.set).toHaveBeenCalledWith({ providerId: "Provider A", apiKey: CANARY });
    expect(container.textContent).toContain("Provider saved.");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await click("Replace");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(JSON.stringify(requests)).not.toContain(CANARY);
    expect(JSON.stringify(requests)).not.toContain("apiKey");
    expect(JSON.stringify(requests)).not.toContain("clearApiKey");
  });

  test("failed IPC preserves draft and shows error without claiming saved", async () => {
    credentials.set = vi.fn(async () => ({ ok: false, error: { code: "LOCKED", message: "Unlock the system keychain and retry." } }));
    await enterKey();
    await click("Save provider");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(CANARY);
    expect(container.textContent).toContain("LOCKED: Unlock the system keychain and retry.");
    expect(container.textContent).not.toContain("Provider saved.");
    expect(JSON.stringify(requests)).not.toContain(CANARY);
    expect(JSON.stringify(requests)).not.toContain("apiKey");
  });

  test("removal confirms IPC clear and public state without an HTTP credential mutation", async () => {
    await enterKey();
    await click("Save provider");
    const start = requests.length;
    await click("Remove");
    expect(credentials.clear).toHaveBeenCalledWith({ providerId: "Provider A" });
    expect(container.textContent).toContain("API key removed.");
    expect(container.textContent).not.toContain("Provider saved.");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(requests.slice(start).every((request) => request.body === undefined)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(CANARY);
    expect(JSON.stringify(requests)).not.toContain("clearApiKey");
  });

  test("failed removal clears prior success message and never uses HTTP fallback", async () => {
    await enterKey();
    await click("Save provider");
    credentials.clear = vi.fn(async () => ({ ok: false, error: { code: "LOCKED", message: "Unlock the system keychain and retry." } }));
    const start = requests.length;
    await click("Remove");
    expect(container.textContent).toContain("LOCKED: Unlock the system keychain and retry.");
    expect(container.textContent).not.toContain("API key removed.");
    expect(container.textContent).not.toContain("Provider saved.");
    expect(requests.slice(start)).toEqual([]);
  });

  test("selection and collapse clear drafts; empty provider creation excludes credential fields", async () => {
    await enterKey();
    await click("Provider B");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    await click("Provider A");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    await enterKey();
    await click("Provider A");
    await click("Provider A");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    await click("Add provider");
    expect(JSON.stringify(requests)).not.toContain(CANARY);
    expect(JSON.stringify(requests)).not.toContain("apiKey");
    expect(JSON.stringify(requests)).not.toContain("clearApiKey");
  });

  test("browser credential save gives desktop guidance and retains unsaved key", async () => {
    delete window.electronAPI;
    await enterKey();
    await click("Save provider");
    expect(container.textContent).toContain("Open OpenPCB desktop");
    expect(container.textContent).not.toContain("Provider saved.");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(CANARY);
    expect(requests.every((request) => request.body === undefined)).toBe(true);
  });
});
