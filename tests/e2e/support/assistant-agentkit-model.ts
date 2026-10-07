import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

interface ModelMessage { role: string; content: string; name?: string }
interface ModelRequest { stream?: boolean; messages: ModelMessage[]; tools?: Array<{ function: { name: string } }> }

/** The transport is real HTTP; only deterministic model output is scripted. */
export async function startFixtureModel() {
  let componentId = "";
  const requests: ModelRequest[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-native" }] }));
      return;
    }
    const body = JSON.parse(await readBody(req)) as ModelRequest;
    requests.push(body);
    if (!body.stream) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "echo", arguments: '{"text":"ok"}' } }] }, finish_reason: "tool_calls" }] }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    let userIndex = body.messages.length - 1;
    while (userIndex >= 0 && body.messages[userIndex]?.role !== "user") userIndex--;
    const prompt = body.messages[userIndex]?.content ?? "";
    if (prompt.includes("Keep streaming")) {
      sendDelta(res, { content: "Fixture waiting for Stop." });
      return;
    }
    if (prompt.includes("Place two fixture capacitors") && !body.messages.slice(userIndex + 1).some((message) => message.role === "tool")) {
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      const designId = /refId=([a-f0-9-]{36})/.exec(system)?.[1];
      if (!designId) throw new Error("Fixture placement requires a real bound design");
      sendDelta(res, { tool_calls: [{ index: 0, id: "fixture-place-two", type: "function", function: {
        name: "designer_place_components", arguments: JSON.stringify({ action_id: `place_fixture_${designId}`, components: [{ componentId, quantity: 2 }] }),
      } }] });
      finish(res, "tool_calls");
      return;
    }
    sendDelta(res, { content: "Fixture placed C1 and C2. Native readback verified." });
    finish(res, "stop");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture model has no TCP address");
  return { url: `http://127.0.0.1:${address.port}/v1`, requests,
    setComponentId: (id: string) => { componentId = id; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }) };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let result = "";
  for await (const chunk of req) result += String(chunk);
  return result;
}

function sendDelta(res: ServerResponse, delta: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify({ id: "fixture-completion", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
}

function finish(res: ServerResponse, finishReason: string): void {
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}
