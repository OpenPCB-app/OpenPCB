

import { customFetch } from '@/../../src-ts/shared/sdk/mutator';
import type { ProviderInfo, ProviderDetail } from '@shared/types';

interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

interface ProvidersResponse {
    providers: ProviderInfo[];
}

interface ProviderResponse {
    provider: ProviderDetail;
}

interface ProviderApiKeyStatusResponse {
    provider: string;
    stored: boolean;
}

interface ProviderApiKeyUpdateResponse {
    provider: string;
    updated: boolean;
}

interface ProviderApiKeyRemoveResponse {
    provider: string;
    removed: boolean;
}

function unwrapResponse<T>(response: ApiResponse<T>): T {
    if (!response.ok || !response.data) {
        throw new Error(response.error?.message || 'API request failed');
    }
    return response.data;
}

export async function listProviders(): Promise<ProviderInfo[]> {
    const response = await customFetch<ApiResponse<ProvidersResponse>>('/api/providers');
    const data = unwrapResponse(response);
    return data.providers;
}

export async function getProviderResult(id: string): Promise<ProviderDetail> {
    const response = await customFetch<ApiResponse<ProviderResponse>>(`/api/providers/${id}`);
    const data = unwrapResponse(response);
    return data.provider;
}

export async function setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
    const response = await customFetch<ApiResponse<ProviderApiKeyUpdateResponse>>(
        `/api/providers/${providerId}/api-key`,
        {
            method: 'POST',
            body: JSON.stringify({ apiKey }),
        }
    );
    unwrapResponse(response);
}

export async function removeProviderApiKey(providerId: string): Promise<void> {
    const response = await customFetch<ApiResponse<ProviderApiKeyRemoveResponse>>(
        `/api/providers/${providerId}/api-key`,
        {
            method: 'DELETE',
        }
    );
    unwrapResponse(response);
}

export async function hasProviderApiKey(providerId: string): Promise<boolean> {
    const response = await customFetch<ApiResponse<ProviderApiKeyStatusResponse>>(
        `/api/providers/${providerId}/api-key`
    );
    const data = unwrapResponse(response);
    return data.stored;
}
