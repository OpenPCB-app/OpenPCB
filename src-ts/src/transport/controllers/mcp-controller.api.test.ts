import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestServer } from "../../../test/helpers/test-server";
import { cleanTestDatabase } from "../../../test/setup";

const PORT = 3012;
const TOKEN = "mcp-test-token";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_URL = `${BASE_URL}/api/mcp/servers`;
const ALLOWED_ORIGIN = "http://localhost:1420";
const DENIED_ORIGIN = "https://evil.example";

const testServer = new TestServer(PORT, TOKEN);

function authHeaders(contentType = true): Record<string, string> {
  const headers: Record<string, string> = {
    "X-OpenPCB-Token": TOKEN,
    Origin: ALLOWED_ORIGIN,
  };
  if (contentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function createFixtureScript(): string {
  return `
const encoder = new TextEncoder();
let buffer = "";

function writeFrame(payload) {
  const json = JSON.stringify(payload);
  const bytes = encoder.encode(json);
  process.stdout.write("Content-Length: " + bytes.length + "\\r\\n\\r\\n" + json);
}

async function handleRequest(message) {
  if (!message || typeof message !== "object") return;
  if (message.jsonrpc !== "2.0") return;

  if (message.method === "initialize") {
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "fixture", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "echo",
          description: "echo tool",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        }],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const text = message.params?.arguments?.text;
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: String(text ?? "") }],
      },
    });
    return;
  }
}

async function drain() {
  while (true) {
    const sep = buffer.indexOf("\\r\\n\\r\\n");
    if (sep < 0) return;
    const header = buffer.slice(0, sep);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      buffer = "";
      return;
    }
    const length = Number(match[1]);
    const bodyStart = sep + 4;
    if (buffer.length < bodyStart + length) return;

    const body = buffer.slice(bodyStart, bodyStart + length);
    buffer = buffer.slice(bodyStart + length);

    try {
      await handleRequest(JSON.parse(body));
    } catch {
      continue;
    }
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  await drain();
});
`;
}

describe("MCP API endpoints", () => {
  let serverId = "";

  beforeAll(async () => {
    await cleanTestDatabase();
    await testServer.start();
  }, { timeout: 120000 });

  afterAll(async () => {
    await testServer.stop();
    await cleanTestDatabase();
  }, { timeout: 120000 });

  it("enforces X-OpenPCB-Token auth", async () => {
    const noToken = await fetch(API_URL, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    const badToken = await fetch(API_URL, {
      headers: { "X-OpenPCB-Token": "wrong-token", Origin: ALLOWED_ORIGIN },
    });
    const withToken = await fetch(API_URL, {
      headers: authHeaders(false),
    });

    expect(noToken.status).toBe(401);
    expect(badToken.status).toBe(401);
    expect(withToken.status).toBe(200);

    const noTokenPayload = (await noToken.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    const badTokenPayload = (await badToken.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(noTokenPayload).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing KERNEL_TOKEN",
      },
    });
    expect(badTokenPayload).toEqual(noTokenPayload);
  });

  it("denies local API misuse on protected route without token", async () => {
    const response = await fetch(API_URL);
    expect(response.status).toBe(401);

    const payload = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(payload).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing KERNEL_TOKEN",
      },
    });
  });

  it("allows trusted origin and emits explicit CORS origin header", async () => {
    const response = await fetch(API_URL, {
      headers: authHeaders(false),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("denies untrusted origin on protected route", async () => {
    const response = await fetch(API_URL, {
      headers: {
        "X-OpenPCB-Token": TOKEN,
        Origin: DENIED_ORIGIN,
      },
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN_ORIGIN",
        message: "Origin is not allowed",
      },
    });
  });

  it("supports CRUD + connect + disconnect + list-tools + test-call", async () => {
    const createRes = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        alias: "fixture",
        displayName: "Fixture",
        transport: "stdio",
        command: "bun",
        args: ["-e", createFixtureScript()],
      }),
    });

    expect(createRes.status).toBe(201);
    const createPayload = (await createRes.json()) as {
      ok: boolean;
      data: { server: { id: string } };
    };
    expect(createPayload.ok).toBe(true);
    serverId = createPayload.data.server.id;

    const listRes = await fetch(API_URL, { headers: authHeaders(false) });
    expect(listRes.status).toBe(200);

    const getRes = await fetch(`${API_URL}/${serverId}`, { headers: authHeaders(false) });
    expect(getRes.status).toBe(200);

    const patchRes = await fetch(`${API_URL}/${serverId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ displayName: "Fixture Updated" }),
    });
    expect(patchRes.status).toBe(200);

    const connectRes = await fetch(`${API_URL}/${serverId}/connect`, {
      method: "POST",
      headers: authHeaders(false),
    });
    expect(connectRes.status).toBe(200);

    const toolsRes = await fetch(`${API_URL}/${serverId}/tools`, {
      headers: authHeaders(false),
    });
    expect(toolsRes.status).toBe(200);
    const toolsPayload = (await toolsRes.json()) as {
      ok: boolean;
      data: { tools: Array<{ name: string }> };
    };
    expect(toolsPayload.ok).toBe(true);
    expect(toolsPayload.data.tools[0]?.name).toBe("echo");

    const testCallRes = await fetch(`${API_URL}/${serverId}/test-call`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ toolName: "echo", args: { text: "hello" } }),
    });
    expect(testCallRes.status).toBe(200);
    const testCallPayload = (await testCallRes.json()) as {
      ok: boolean;
      data: { result: { content: Array<{ text: string }> } };
    };
    expect(testCallPayload.ok).toBe(true);
    expect(testCallPayload.data.result.content[0]?.text).toBe("hello");

    const disconnectRes = await fetch(`${API_URL}/${serverId}/disconnect`, {
      method: "POST",
      headers: authHeaders(false),
    });
    expect(disconnectRes.status).toBe(200);

    const deleteRes = await fetch(`${API_URL}/${serverId}`, {
      method: "DELETE",
      headers: authHeaders(false),
    });
    expect(deleteRes.status).toBe(200);
  });

  it("returns deterministic 400 payload for invalid body", async () => {
    const invalidCreate = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ alias: "", transport: "stdio" }),
    });

    expect(invalidCreate.status).toBe(400);
    const payload = (await invalidCreate.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(payload.error.message).toBe("alias is required and cannot be empty");
  });
});
