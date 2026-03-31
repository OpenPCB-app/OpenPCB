/**
 * Custom Fetch Mutator for Orval-Generated SDK
 * 
 * Wraps fetch calls with:
 * - Dynamic base URL for backend API (discovered at runtime)
 * - JSON content-type headers
 * - Error handling
 * 
 * Note: Orval calls this as customFetch(url, init)
 */

// Dynamic backend URL - will be set by setBackendURL()
let API_BASE: string | null = null;  // No fallback - must be set explicitly

/**
 * Update the API base URL (called from React context)
 */
export function setBackendURL(url: string) {
    API_BASE = url;
    console.log('[SDK] Updated API_BASE to:', url);
}

/**
 * Get current API base URL
 */
export function getBackendURL(): string | null {
    return API_BASE;
}

/**
 * Check if API base URL has been configured
 */
export function isBackendURLReady(): boolean {
    return API_BASE !== null;
}


export const customFetch = async <T>(
    url: string,
    init?: RequestInit
): Promise<T> => {
    // Validate that backend URL has been set
    if (!API_BASE) {
        throw new Error(
            '[SDK] Backend URL not initialized. This usually means the BackendURLContext ' +
            'has not finished discovering the dynamic port. Please ensure the app has fully loaded.'
        );
    }

    // Prepend base URL if path is relative, handling potential double slashes
    const baseUrl = API_BASE.replace(/\/$/, "");
    const path = url.startsWith('/') ? url : `/${url}`;
    const fullUrl = `${baseUrl}${path}`;

    const response = await fetch(fullUrl, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const rawMessage =
            error.error?.message || error.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(redactApiKey(rawMessage, init));
    }

    const json = await response.json();
    return json as T;
};

const redactApiKey = (message: string, init?: RequestInit): string => {
    if (!message || !init?.body || typeof init.body !== "string") {
        return message;
    }

    try {
        const parsed = JSON.parse(init.body);
        const apiKey = parsed?.apiKey;
        if (typeof apiKey === "string" && apiKey.length > 0) {
            return message.split(apiKey).join("[redacted]");
        }
    } catch {
        // Ignore non-JSON bodies.
    }

    return message;
};

export default customFetch;
