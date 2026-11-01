import { describe, expect, test } from "bun:test";
import { BASE_CORS_HEADERS } from "../http/cors";

// The renderer (Vite dev server or packaged app) is cross-origin to the backend's
// ephemeral port, so every custom request header a client sends must pass preflight.
const REQUIRED_REQUEST_HEADERS = [
  "Content-Type",
  "X-OpenPCB-Token",
  "Idempotency-Key", // AgentKit POST /v1/chats/:id/messages
  "Last-Event-ID", // AgentKit + MCP stream resumption
];

describe("CORS preflight allow-list", () => {
  test("allows every header the local API clients send", () => {
    const allowed = BASE_CORS_HEADERS["Access-Control-Allow-Headers"]!
      .split(",")
      .map((name) => name.trim().toLowerCase());
    for (const header of REQUIRED_REQUEST_HEADERS) {
      expect(allowed).toContain(header.toLowerCase());
    }
  });
});
