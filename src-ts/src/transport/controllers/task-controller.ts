import type { RouteContext } from '../router';
import type { ITaskService } from '../../domain/services';
import { ResponseBuilder } from '../../core/utils/response-builder';

/**
 * TaskController - Thin HTTP handler for tasks
 * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
 */
export class TaskController {
    constructor(private taskService: ITaskService) { }

    /**
     * GET /api/tasks
     */
    async list(_ctx: RouteContext): Promise<Response> {
        const tasks = this.taskService.list({});
        return ResponseBuilder.success({ tasks });
    }

    /**
     * GET /api/tasks/:id
     */
    async get(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const task = this.taskService.get(id);
        return ResponseBuilder.success({ task });
    }

    /**
     * GET /api/tasks/:id/meta
     */
    async getMeta(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const meta = this.taskService.getMeta(id);
        return ResponseBuilder.success({ meta });
    }

    /**
     * POST /api/tasks/:id/cancel
     */
    async cancel(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const cancelled = this.taskService.cancel(id);
        return ResponseBuilder.success({ cancelled });
    }

    /**
     * POST /api/tasks/:id/retry
     * Retry a failed or paused task
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     */
    async retry(ctx: RouteContext): Promise<Response> {
        const id = ctx.params.getOrThrow('id');
        const result = await this.taskService.retry(id);
        return ResponseBuilder.success({
            taskId: id,
            status: result.status,
            retryCount: result.retryCount,
        });
    }

    /**
     * POST /api/tasks/cleanup
     */
    async cleanup(_ctx: RouteContext): Promise<Response> {
        this.taskService.cleanup();
        return ResponseBuilder.success({ cleaned: true });
    }
}
