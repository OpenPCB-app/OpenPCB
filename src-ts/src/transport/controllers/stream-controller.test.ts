import { afterEach, describe, expect, it, mock } from "bun:test";
import { StreamController } from "./stream-controller";
import type { IStreamService } from "../../domain/services/stream-service";
import type { RouteContext } from "../router";
import { LicenseUtil } from "../../domain/services/license-util";

describe("StreamController", () => {
    const originalGetCurrentStatus = LicenseUtil.getCurrentStatus;
    const originalStartupState = process.env.OPENPCB_STARTUP_LICENSE_STATE;
    const originalStartupCode = process.env.OPENPCB_STARTUP_LICENSE_CODE;

    afterEach(() => {
        LicenseUtil.getCurrentStatus = originalGetCurrentStatus;
        if (originalStartupState === undefined) {
            delete process.env.OPENPCB_STARTUP_LICENSE_STATE;
        } else {
            process.env.OPENPCB_STARTUP_LICENSE_STATE = originalStartupState;
        }

        if (originalStartupCode === undefined) {
            delete process.env.OPENPCB_STARTUP_LICENSE_CODE;
        } else {
            process.env.OPENPCB_STARTUP_LICENSE_CODE = originalStartupCode;
        }
    });

    function createControllerHarness() {
        const mockStreamService = {
            createChatStream: mock(async () => ({
                stream: new ReadableStream(),
                taskId: "task-123",
                chatId: "chat-1",
                userMessageId: "user-1",
                assistantMessageId: "assistant-1",
            })),
            abortStream: mock(() => true),
            replayProgress: mock(async () => ({
                stream: new ReadableStream(),
                taskId: "task-123",
                status: "running",
            })),
            getActiveChatTask: mock(async () => null),
        } as unknown as IStreamService;

        const controller = new StreamController(mockStreamService);
        const mockCtx = {
            req: {
                json: async () => ({
                    provider: "openai",
                    model: "gpt-4o",
                    text: "Hello",
                }),
            },
        } as unknown as RouteContext;

        return { controller, mockCtx, mockStreamService };
    }

    it("returns 402 denial and does not call stream service when blocked", async () => {
        LicenseUtil.getCurrentStatus = async () => ({
            state: "blocked",
            expiresAt: null,
            features: [],
            reason: "Blocked by policy",
        });

        const { controller, mockCtx, mockStreamService } = createControllerHarness();
        const response = await controller.chat(mockCtx);
        const payload = await response.json();

        expect(response.status).toBe(402);
        expect(payload).toEqual({
            ok: false,
            error: {
                code: "LICENSE_BLOCKED",
                message: "Blocked by policy",
                status: {
                    state: "blocked",
                    expiresAt: null,
                    features: [],
                    reason: "Blocked by policy",
                },
            },
        });
        expect(mockStreamService.createChatStream).not.toHaveBeenCalled();
    });

    it("returns 402 denial and does not call stream service when restricted", async () => {
        LicenseUtil.getCurrentStatus = async () => ({
            state: "restricted",
            expiresAt: null,
            features: [],
            reason: "Restricted by policy",
        });

        const { controller, mockCtx, mockStreamService } = createControllerHarness();
        const response = await controller.chat(mockCtx);
        const payload = await response.json();

        expect(response.status).toBe(402);
        expect(payload).toEqual({
            ok: false,
            error: {
                code: "LICENSE_RESTRICTED",
                message: "Restricted by policy",
                status: {
                    state: "restricted",
                    expiresAt: null,
                    features: [],
                    reason: "Restricted by policy",
                },
            },
        });
        expect(mockStreamService.createChatStream).not.toHaveBeenCalled();
    });

    it("allows grace state and returns SSE response", async () => {
        LicenseUtil.getCurrentStatus = async () => ({
            state: "grace",
            expiresAt: null,
            features: ["*"],
        });

        const { controller, mockCtx, mockStreamService } = createControllerHarness();
        const response = await controller.chat(mockCtx);

        expect(response.status).toBe(200);
        expect(mockStreamService.createChatStream).toHaveBeenCalledTimes(1);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Vary")).toBe("Origin");
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("blocks paid task creation from startup blocked state without side effects", async () => {
        process.env.OPENPCB_STARTUP_LICENSE_STATE = "blocked";
        process.env.OPENPCB_STARTUP_LICENSE_CODE = "ACCESS_BLOCKED";

        const { controller, mockCtx, mockStreamService } = createControllerHarness();
        const response = await controller.chat(mockCtx);
        const payload = await response.json();

        expect(response.status).toBe(402);
        expect(payload).toEqual({
            ok: false,
            error: {
                code: "LICENSE_BLOCKED",
                message: "ACCESS_BLOCKED",
                status: {
                    state: "blocked",
                    expiresAt: null,
                    features: [],
                    reason: "ACCESS_BLOCKED",
                },
            },
        });
        expect(mockStreamService.createChatStream).not.toHaveBeenCalled();
    });

    it("allows grace temporarily and denies after grace expiry state transition", async () => {
        process.env.OPENPCB_STARTUP_LICENSE_STATE = "grace";
        process.env.OPENPCB_STARTUP_LICENSE_CODE = "TOKEN_EXPIRED_GRACE";

        const { controller, mockCtx, mockStreamService } = createControllerHarness();
        const graceResponse = await controller.chat(mockCtx);

        expect(graceResponse.status).toBe(200);
        expect(mockStreamService.createChatStream).toHaveBeenCalledTimes(1);

        process.env.OPENPCB_STARTUP_LICENSE_STATE = "blocked";
        process.env.OPENPCB_STARTUP_LICENSE_CODE = "GRACE_EXPIRED";

        const expiredResponse = await controller.chat(mockCtx);
        const expiredPayload = await expiredResponse.json();

        expect(expiredResponse.status).toBe(402);
        expect(expiredPayload).toEqual({
            ok: false,
            error: {
                code: "LICENSE_BLOCKED",
                message: "GRACE_EXPIRED",
                status: {
                    state: "blocked",
                    expiresAt: null,
                    features: [],
                    reason: "GRACE_EXPIRED",
                },
            },
        });
        expect(mockStreamService.createChatStream).toHaveBeenCalledTimes(1);
    });
});
