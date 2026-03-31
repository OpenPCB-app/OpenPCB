import { CORS_HEADERS } from '../http/helpers';
import type { RouteContext } from '../router';
import type { IStreamService, ReplayMode } from '../../domain/services/stream-service';
import { ResponseBuilder } from '../../core/utils/response-builder';
import { ValidationError } from '../../core/errors';
import { LicenseUtil } from '../../domain/services/license-util';

/**
 * StreamController - Thin HTTP handler for streaming
 * All business logic delegated to StreamService
 * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1, 8.2
 */
export class StreamController {
    constructor(private streamService: IStreamService) { }

    /**
     * POST /api/stream/chat
     */
    async chat(ctx: RouteContext): Promise<Response> {
        const denial = await LicenseUtil.getDenialIfNotAllowed();
        if (denial) {
            return ResponseBuilder.json(denial, { status: 402 });
        }

        const body = await ctx.req.json();

        // Create stream
        const result = await this.streamService.createChatStream(body);

        // Return SSE response
        return new Response(result.stream, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    }

    /**
     * POST /api/stream/abort/:taskId
     */
    async abort(ctx: RouteContext): Promise<Response> {
        const taskId = ctx.params.getOrThrow('taskId');
        const aborted = this.streamService.abortStream(taskId);
        return ResponseBuilder.success({ aborted, taskId });
    }

    /**
     * GET /api/stream/replay/:taskId
     * Replay task progress for reconnection
     * Query param: mode='full'|'final' (default: 'full')
     * See: TASK_SYSTEM_SPECIFICATION.md Section 8.2
     */
    async replay(ctx: RouteContext): Promise<Response> {
        const taskId = ctx.params.getOrThrow('taskId');
        const modeParam = ctx.query.get('mode') || 'full';

        // Validate replay mode
        if (modeParam !== 'full' && modeParam !== 'final') {
            throw new ValidationError(`Invalid replay mode: ${modeParam}. Must be 'full' or 'final'`);
        }
        const mode: ReplayMode = modeParam;

        // Replay progress
        const result = await this.streamService.replayProgress({
            taskId,
            mode,
        });

        // Return SSE response with replay stream
        return new Response(result.stream, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Task-Status': result.status,
            },
        });
    }

    /**
     * GET /api/chats/:id/active-task
     * Check if chat has an active (running) task
     * Returns task info or 204 if no active task
     */
    async getActiveTask(ctx: RouteContext): Promise<Response> {
        const chatId = ctx.params.getOrThrow('id');
        const taskInfo = await this.streamService.getActiveChatTask(chatId);

        if (!taskInfo) {
            // 204 No Content - but MUST include CORS headers
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS,
            });
        }

        return ResponseBuilder.success(taskInfo);
    }
}
