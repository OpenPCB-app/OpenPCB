import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { OllamaEngine } from "./ollama";
import type { KernelMessage } from "@shared/types";
import type { ChatRequest } from "../engine";

describe("OllamaEngine Model Loading", () => {
    let engine: OllamaEngine;
    let mockFetch: ReturnType<typeof mock>;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        // Save original fetch before overriding
        originalFetch = global.fetch;
        engine = new OllamaEngine();
        // Override fetch globally for tests
        mockFetch = mock(() => Promise.resolve(new Response()));
        global.fetch = mockFetch as any;
    });

    afterEach(() => {
        // Restore original fetch after each test
        global.fetch = originalFetch;
    });

    describe("getLoadedModels", () => {
        it("should return empty array when /api/ps returns empty models", async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ models: [] }), { status: 200 })
                )
            );

            const models = await engine.getLoadedModels();

            expect(models).toEqual([]);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should return loaded models with correct properties", async () => {
            const mockResponse = {
                models: [
                    {
                        name: "gpt-oss:20b",
                        model: "gpt-oss:20b",
                        size: 4661211648,
                        digest: "abc123",
                        details: {
                            parent_model: "",
                            format: "gguf",
                            family: "llama",
                            families: null,
                            parameter_size: "20B",
                            quantization_level: "Q4_K_M",
                        },
                        expires_at: "2024-11-20T11:00:00Z",
                        size_vram: 4294967296,
                    },
                ],
            };

            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify(mockResponse), { status: 200 })
                )
            );

            const models = await engine.getLoadedModels();

            expect(models).toHaveLength(1);
            expect(models[0]).toEqual({
                name: "gpt-oss:20b",
                size: 4661211648,
                sizeVram: 4294967296,
                expiresAt: "2024-11-20T11:00:00Z",
            });
        });

        it("should return empty array on fetch error", async () => {
            mockFetch.mockImplementation(() =>
                Promise.reject(new Error("Network error"))
            );

            const models = await engine.getLoadedModels();

            expect(models).toEqual([]);
        });

        it("should return empty array on non-200 response", async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(new Response("Error", { status: 500 }))
            );

            const models = await engine.getLoadedModels();

            expect(models).toEqual([]);
        });
    });

    describe("isModelLoaded", () => {
        it("should return true when model is in loaded list", async () => {
            const mockResponse = {
                models: [
                    {
                        name: "gpt-oss:20b",
                        model: "gpt-oss:20b",
                        size: 4661211648,
                        digest: "abc123",
                        details: {
                            parent_model: "",
                            format: "gguf",
                            family: "llama",
                            families: null,
                            parameter_size: "20B",
                            quantization_level: "Q4_K_M",
                        },
                        expires_at: "2024-11-20T11:00:00Z",
                        size_vram: 4294967296,
                    },
                ],
            };

            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify(mockResponse), { status: 200 })
                )
            );

            const isLoaded = await engine.isModelLoaded("gpt-oss:20b");

            expect(isLoaded).toBe(true);
        });

        it("should return true when model matches with :latest suffix", async () => {
            const mockResponse = {
                models: [
                    {
                        name: "llama3:latest",
                        model: "llama3:latest",
                        size: 4661211648,
                        digest: "abc123",
                        details: {
                            parent_model: "",
                            format: "gguf",
                            family: "llama",
                            families: null,
                            parameter_size: "7B",
                            quantization_level: "Q4_K_M",
                        },
                        expires_at: "2024-11-20T11:00:00Z",
                        size_vram: 4294967296,
                    },
                ],
            };

            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify(mockResponse), { status: 200 })
                )
            );

            // Query without :latest should still match
            const isLoaded = await engine.isModelLoaded("llama3");

            expect(isLoaded).toBe(true);
        });

        it("should return false when model is not loaded", async () => {
            const mockResponse = {
                models: [
                    {
                        name: "other-model:latest",
                        model: "other-model:latest",
                        size: 4661211648,
                        digest: "abc123",
                        details: {
                            parent_model: "",
                            format: "gguf",
                            family: "llama",
                            families: null,
                            parameter_size: "7B",
                            quantization_level: "Q4_K_M",
                        },
                        expires_at: "2024-11-20T11:00:00Z",
                        size_vram: 4294967296,
                    },
                ],
            };

            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify(mockResponse), { status: 200 })
                )
            );

            const isLoaded = await engine.isModelLoaded("gpt-oss:20b");

            expect(isLoaded).toBe(false);
        });

        it("should return false on error", async () => {
            mockFetch.mockImplementation(() =>
                Promise.reject(new Error("Network error"))
            );

            const isLoaded = await engine.isModelLoaded("gpt-oss:20b");

            expect(isLoaded).toBe(false);
        });
    });

    describe("preloadModel", () => {
        it("should return true on successful preload", async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ done: true }), { status: 200 })
                )
            );

            const result = await engine.preloadModel("gpt-oss:20b");

            expect(result).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Verify the request was made correctly
            const [url, options] = mockFetch.mock.calls[0] as any;
            expect(url).toBe("http://localhost:11434/api/chat");
            expect(options.method).toBe("POST");

            const body = JSON.parse(options.body);
            expect(body.model).toBe("gpt-oss:20b");
            expect(body.messages).toEqual([]);
        });

        it("should return false on failed preload", async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(new Response("Error", { status: 500 }))
            );

            const result = await engine.preloadModel("gpt-oss:20b");

            expect(result).toBe(false);
        });

        it("should return false on network error", async () => {
            mockFetch.mockImplementation(() =>
                Promise.reject(new Error("Network error"))
            );

            const result = await engine.preloadModel("gpt-oss:20b");

            expect(result).toBe(false);
        });
    });

    describe("tool-result message conversion", () => {
        it("forwards tool-result messages to Ollama with tool role and tool_call_id fallback marker", () => {
            const toolMessage: KernelMessage = {
                id: "msg-tool-1",
                role: "tool",
                parts: [
                    {
                        type: "tool-result",
                        toolCallId: "call-42",
                        toolName: "echo",
                        result: { ok: true },
                    },
                ],
                createdAt: new Date().toISOString(),
            };

            const converted = (engine as any).convertMessages([toolMessage]);

            expect(converted).toHaveLength(1);
            expect(converted[0]).toMatchObject({
                role: "tool",
            });
            expect(converted[0].content).toContain("[tool_call_id:call-42]");
            expect(converted[0].content).toContain("\"ok\":true");
        });
    });

    describe("streamed tool-call assembly", () => {
        const baseRequest: ChatRequest = {
            taskId: "task-stream-tools",
            model: "qwen3:8b",
            messages: [
                {
                    id: "m1",
                    role: "user",
                    parts: [{ type: "text", text: "Use tools" }],
                    createdAt: new Date().toISOString(),
                },
            ],
        };

        it("assembles multi-tool streamed calls by index with distinct IDs", async () => {
            const ndjson = [
                JSON.stringify({
                    model: "qwen3:8b",
                    done: false,
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            { index: 0, function: { name: "tool_a", arguments: "{\"a\":" } },
                            { index: 1, function: { name: "tool_b", arguments: "{\"b\":" } },
                        ],
                    },
                }),
                JSON.stringify({
                    model: "qwen3:8b",
                    done: false,
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            { index: 0, function: { arguments: "1}" } },
                            { index: 1, function: { arguments: "2}" } },
                        ],
                    },
                }),
                JSON.stringify({
                    model: "qwen3:8b",
                    done: true,
                    prompt_eval_count: 12,
                    eval_count: 4,
                }),
            ].join("\n") + "\n";

            mockFetch.mockImplementation(() =>
                Promise.resolve(new Response(ndjson, { status: 200 })),
            );

            const result = await engine.stream(baseRequest, {});

            expect(result.finishReason).toBe("tool_calls");
            expect(result.toolCalls).toEqual([
                {
                    id: "call_0",
                    type: "function",
                    function: { name: "tool_a", arguments: "{\"a\":1}" },
                },
                {
                    id: "call_1",
                    type: "function",
                    function: { name: "tool_b", arguments: "{\"b\":2}" },
                },
            ]);
        });

        it("replaces buffered argument fragments when object arguments arrive", async () => {
            const ndjson = [
                JSON.stringify({
                    model: "qwen3:8b",
                    done: false,
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            { index: 0, function: { name: "tool_a", arguments: "{\"a\":" } },
                        ],
                    },
                }),
                JSON.stringify({
                    model: "qwen3:8b",
                    done: false,
                    message: {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            { index: 0, function: { arguments: { a: 1, b: 2 } } },
                        ],
                    },
                }),
                JSON.stringify({
                    model: "qwen3:8b",
                    done: true,
                    prompt_eval_count: 8,
                    eval_count: 3,
                }),
            ].join("\n") + "\n";

            mockFetch.mockImplementation(() =>
                Promise.resolve(new Response(ndjson, { status: 200 })),
            );

            const result = await engine.stream(baseRequest, {});
            expect(result.finishReason).toBe("tool_calls");
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls?.[0]).toEqual({
                id: "call_0",
                type: "function",
                function: {
                    name: "tool_a",
                    arguments: JSON.stringify({ a: 1, b: 2 }),
                },
            });
        });
    });
});
