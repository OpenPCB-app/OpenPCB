import type { RouteContext } from '../router';
import type { OAuthService } from '../../infrastructure/oauth/oauth-service';
import type { OAuthProvider } from '../../infrastructure/oauth/types';
import { ResponseBuilder } from '../../core/utils/response-builder';

const VALID_OAUTH_PROVIDERS: OAuthProvider[] = ['codex', 'github-copilot'];

function isValidOAuthProvider(provider: string): provider is OAuthProvider {
    return VALID_OAUTH_PROVIDERS.includes(provider as OAuthProvider);
}

export class OAuthController {
    constructor(private oauthService: OAuthService) { }

    async start(ctx: RouteContext): Promise<Response> {
        const providerParam = ctx.params.getOrThrow('provider');
        
        if (!isValidOAuthProvider(providerParam)) {
            return ResponseBuilder.badRequest(`Invalid OAuth provider: ${providerParam}. Supported: ${VALID_OAUTH_PROVIDERS.join(', ')}`);
        }

        const provider = providerParam;
        const body = await ctx.req.json().catch(() => ({}));

        const result = await this.oauthService.startOAuthFlow(provider, body);

        if (!result.success) {
            return ResponseBuilder.badRequest(result.error || 'Failed to start OAuth flow');
        }

        const { listener, ...sanitizedResult } = result as any;

        return ResponseBuilder.success(sanitizedResult);
    }

    async callback(ctx: RouteContext): Promise<Response> {
        const providerParam = ctx.params.getOrThrow('provider');
        
        if (!isValidOAuthProvider(providerParam)) {
            return ResponseBuilder.badRequest(`Invalid OAuth provider: ${providerParam}`);
        }

        const provider = providerParam;
        const code = ctx.query.get('code');
        const state = ctx.query.get('state');

        if (!code || !state) {
            return ResponseBuilder.badRequest('Missing code or state parameter');
        }

        if (provider !== 'codex') {
            return ResponseBuilder.badRequest('Callback only supported for Codex provider');
        }

        return ResponseBuilder.success({
            message: 'Codex callback detected. Use POST /api/oauth/codex/complete with code, state, verifier, and redirectUri to finalize authentication.',
            code,
            state,
            nextStep: 'POST /api/oauth/codex/complete',
        });
    }

    async complete(ctx: RouteContext): Promise<Response> {
        const providerParam = ctx.params.getOrThrow('provider');
        
        if (!isValidOAuthProvider(providerParam)) {
            return ResponseBuilder.badRequest(`Invalid OAuth provider: ${providerParam}`);
        }

        const provider = providerParam;
        const body = await ctx.req.json().catch(() => ({}));

        if (provider === 'github-copilot') {
            const { deviceCode, interval } = body;

            if (!deviceCode || !interval) {
                return ResponseBuilder.badRequest('Missing deviceCode or interval');
            }

            const result = await this.oauthService.completeGitHubOAuth(deviceCode, interval);

            if (!result.success) {
                return ResponseBuilder.badRequest(result.error || 'Device code flow failed');
            }

            return ResponseBuilder.success({ provider, success: true });
        }

        if (provider === 'codex') {
            const { code, state, verifier, redirectUri } = body;

            if (!code || !state || !verifier || !redirectUri) {
                return ResponseBuilder.badRequest('Missing code, state, verifier, or redirectUri');
            }

            const result = await this.oauthService.completeCodexOAuth(code, state, verifier, redirectUri);

            if (!result.success) {
                return ResponseBuilder.badRequest(result.error || 'OAuth completion failed');
            }

            return ResponseBuilder.success({ provider, success: true });
        }

        return ResponseBuilder.badRequest('Unknown provider');
    }

    async status(ctx: RouteContext): Promise<Response> {
        const providerParam = ctx.params.getOrThrow('provider');
        
        if (!isValidOAuthProvider(providerParam)) {
            return ResponseBuilder.badRequest(`Invalid OAuth provider: ${providerParam}`);
        }

        const provider = providerParam;

        const hasCredentials = await this.oauthService.hasCredentials(provider);
        const isExpired = hasCredentials
            ? await this.oauthService.isTokenExpired(provider)
            : false;

        return ResponseBuilder.success({
            provider,
            hasCredentials,
            isExpired,
        });
    }

    async revoke(ctx: RouteContext): Promise<Response> {
        const providerParam = ctx.params.getOrThrow('provider');
        
        if (!isValidOAuthProvider(providerParam)) {
            return ResponseBuilder.badRequest(`Invalid OAuth provider: ${providerParam}`);
        }

        const provider = providerParam;

        const success = await this.oauthService.revokeOAuth(provider);

        if (!success) {
            return ResponseBuilder.badRequest('Failed to revoke OAuth credentials');
        }

        return ResponseBuilder.success({ provider, success: true });
    }
}