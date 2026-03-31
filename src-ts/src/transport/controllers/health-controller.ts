import type { RouteContext } from '../router';
import { ResponseBuilder } from '../../core/utils/response-builder';

/**
 * HealthController - Minimal health check handler
 */
export class HealthController {
    /**
     * GET /api/health
     */
    static async check(_ctx: RouteContext): Promise<Response> {
        return ResponseBuilder.success({
            status: 'ok',
            timestamp: Date.now(),
        });
    }
}
