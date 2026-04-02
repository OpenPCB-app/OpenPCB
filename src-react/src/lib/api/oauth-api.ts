import { customFetch } from "@shared/sdk/mutator";

interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export type OAuthProvider = 'codex' | 'github-copilot';

export interface OAuthStartResponse {
    success: boolean;
    error?: string;
}

export interface CodexStartResponse extends OAuthStartResponse {
    url: string;
    verifier: string;
    state: string;
    redirectUri: string;
}

export interface GitHubStartResponse extends OAuthStartResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
    expiresIn: number;
}

export interface OAuthStatusResponse {
    provider: string;
    hasCredentials: boolean;
    isExpired: boolean;
}

export interface OAuthCompleteResponse {
    provider: string;
    success: boolean;
}

export interface OAuthRevokeResponse {
    provider: string;
    success: boolean;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
    if (!response.ok || !response.data) {
        throw new Error(response.error?.message || 'API request failed');
    }
    return response.data;
}

export async function startOAuthFlow(
    provider: OAuthProvider,
    options?: { projectId?: string }
): Promise<CodexStartResponse | GitHubStartResponse> {
    const response = await customFetch<ApiResponse<CodexStartResponse | GitHubStartResponse>>(
        `/api/oauth/${provider}/start`,
        {
            method: 'POST',
            body: JSON.stringify(options || {}),
        }
    );
    return unwrapResponse(response);
}

export async function getOAuthStatus(provider: OAuthProvider): Promise<OAuthStatusResponse> {
    const response = await customFetch<ApiResponse<OAuthStatusResponse>>(`/api/oauth/${provider}/status`);
    return unwrapResponse(response);
}

export async function revokeOAuth(provider: OAuthProvider): Promise<OAuthRevokeResponse> {
    const response = await customFetch<ApiResponse<OAuthRevokeResponse>>(
        `/api/oauth/${provider}`,
        {
            method: 'DELETE',
        }
    );
    return unwrapResponse(response);
}

export async function completeCodexOAuth(data: {
    code: string;
    state: string;
    verifier: string;
    redirectUri: string;
}): Promise<OAuthCompleteResponse> {
    const response = await customFetch<ApiResponse<OAuthCompleteResponse>>(
        '/api/oauth/codex/complete',
        {
            method: 'POST',
            body: JSON.stringify(data),
        }
    );
    return unwrapResponse(response);
}

export async function completeGitHubOAuth(data: {
    deviceCode: string;
    interval: number;
}): Promise<OAuthCompleteResponse> {
    const response = await customFetch<ApiResponse<OAuthCompleteResponse>>(
        '/api/oauth/github-copilot/complete',
        {
            method: 'POST',
            body: JSON.stringify(data),
        }
    );
    return unwrapResponse(response);
}
