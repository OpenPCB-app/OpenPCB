import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TestServer } from "./helpers/test-server";
import { cleanTestDatabase } from "./setup";

const PORT = 3002;
const testServer = new TestServer(PORT);
const WORKSPACE_URL = `http://127.0.0.1:${PORT}/api/workspaces`;
const CHAT_URL = `http://127.0.0.1:${PORT}/api/chats`;

describe("Chat API", () => {
  let workspaceId: string;
  let chatId: string;

  beforeAll(async () => {
    await cleanTestDatabase();
    await testServer.start();

    // Create a workspace first
    const res = await fetch(WORKSPACE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Chat Test Workspace" })
    });
    const json = await res.json() as any;
    workspaceId = json.data.workspace.id;
  }, { timeout: 120000 });

  afterAll(async () => {
    await testServer.stop();
    await cleanTestDatabase();
  }, { timeout: 120000 });

  it("should create a new chat", async () => {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "Test Chat",
        config: {
            provider: "openai",
            model: "gpt-4o"
        }
      })
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.data.chat).toBeDefined();
    expect(json.data.chat.config.provider).toBe("openai");
    expect(json.data.chat.config.model).toBe("gpt-4o");

    chatId = json.data.chat.id;
  });

  it("should update chat config (model and provider)", async () => {
    const res = await fetch(`${CHAT_URL}/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
            provider: "anthropic",
            model: "claude-3-opus"
        }
      })
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    
    // This is what we want to fix:
    expect(json.data.chat.config.provider).toBe("anthropic");
    expect(json.data.chat.config.model).toBe("claude-3-opus");
  });

  it("should retrieve updated chat config", async () => {
    const res = await fetch(`${CHAT_URL}/${chatId}`);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.chat.config.provider).toBe("anthropic");
    expect(json.data.chat.config.model).toBe("claude-3-opus");
  });
});
