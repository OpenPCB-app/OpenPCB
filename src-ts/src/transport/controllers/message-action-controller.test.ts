import { describe, expect, it, mock } from "bun:test";
import { MessageActionController } from "./message-action-controller";
import type { IMessageService } from "../../domain/services/message-service";
import type { RouteContext } from "../router";

function createContext(input: {
  id?: string;
  body?: unknown;
  jsonError?: boolean;
}): RouteContext {
  return {
    req: {
      json: async () => {
        if (input.jsonError) {
          throw new Error("invalid json");
        }
        return input.body;
      },
    } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id") {
          return input.id ?? "message-1";
        }
        throw new Error(`Unexpected param: ${key}`);
      },
    } as RouteContext["params"],
    query: new URLSearchParams(),
    url: new URL("http://localhost/api/messages/message-1/edit"),
  };
}

describe("MessageActionController", () => {
  it("accepts string edit content and delegates to service", async () => {
    const service = {
      editMessage: mock(async () => ({
        newMessageId: "m-2",
        chatId: "c-1",
        branchIndex: 1,
        taskId: "t-1",
      })),
      resendMessage: mock(async () => ({
        taskId: "t-1",
        messageId: "m-1",
        status: "retrying",
      })),
      regenerateMessage: mock(async () => ({
        newMessageId: "m-3",
        chatId: "c-1",
        branchIndex: 2,
        taskId: "t-2",
      })),
      createMessage: mock(async () => {
        throw new Error("not used");
      }),
      searchMessages: mock(async () => []),
    } as unknown as IMessageService;

    const controller = new MessageActionController(service);
    const response = await controller.editMessage(
      createContext({ body: { content: "Updated text" } }),
    );
    const payload = (await response.json()) as { ok: boolean; data: { newMessageId: string } };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.newMessageId).toBe("m-2");
  });

  it("accepts text-object edit content and delegates to service", async () => {
    const service = {
      editMessage: mock(async () => ({
        newMessageId: "m-4",
        chatId: "c-1",
        branchIndex: 3,
        taskId: "t-3",
      })),
      resendMessage: mock(async () => ({
        taskId: "t-1",
        messageId: "m-1",
        status: "retrying",
      })),
      regenerateMessage: mock(async () => ({
        newMessageId: "m-3",
        chatId: "c-1",
        branchIndex: 2,
        taskId: "t-2",
      })),
      createMessage: mock(async () => {
        throw new Error("not used");
      }),
      searchMessages: mock(async () => []),
    } as unknown as IMessageService;

    const controller = new MessageActionController(service);
    const response = await controller.editMessage(
      createContext({ body: { content: { type: "text", text: "Updated text" } } }),
    );

    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid edit payload", async () => {
    const service = {
      editMessage: mock(async () => ({
        newMessageId: "m-2",
        chatId: "c-1",
        branchIndex: 1,
        taskId: "t-1",
      })),
      resendMessage: mock(async () => ({
        taskId: "t-1",
        messageId: "m-1",
        status: "retrying",
      })),
      regenerateMessage: mock(async () => ({
        newMessageId: "m-3",
        chatId: "c-1",
        branchIndex: 2,
        taskId: "t-2",
      })),
      createMessage: mock(async () => {
        throw new Error("not used");
      }),
      searchMessages: mock(async () => []),
    } as unknown as IMessageService;

    const controller = new MessageActionController(service);
    const response = await controller.editMessage(
      createContext({ body: { content: "" } }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error: { message: string };
    };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toContain("content is required");
  });

  it("delegates resend and regenerate actions to service", async () => {
    const service = {
      editMessage: mock(async () => ({
        newMessageId: "m-2",
        chatId: "c-1",
        branchIndex: 1,
        taskId: "t-1",
      })),
      resendMessage: mock(async () => ({
        taskId: "t-9",
        messageId: "m-1",
        status: "retrying",
      })),
      regenerateMessage: mock(async () => ({
        newMessageId: "m-10",
        chatId: "c-1",
        branchIndex: 4,
        taskId: "t-10",
      })),
      createMessage: mock(async () => {
        throw new Error("not used");
      }),
      searchMessages: mock(async () => []),
    } as unknown as IMessageService;

    const controller = new MessageActionController(service);
    const resendResponse = await controller.resendMessage(createContext({}));
    const regenerateResponse = await controller.regenerateMessage(createContext({}));

    expect(resendResponse.status).toBe(200);
    expect(regenerateResponse.status).toBe(200);
  });
});
