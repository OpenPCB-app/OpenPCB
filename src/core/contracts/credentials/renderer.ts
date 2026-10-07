export interface ProviderCredentialRequest {
  providerId: string;
}

export interface SetProviderCredentialRequest extends ProviderCredentialRequest {
  apiKey: string;
}

export interface ProviderCredentialStatus {
  configured: boolean;
}

export type CredentialResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: import("./secret-store").CredentialErrorCode; message: string } };

export interface RendererCredentials {
  set(request: SetProviderCredentialRequest): Promise<CredentialResult<ProviderCredentialStatus>>;
  clear(request: ProviderCredentialRequest): Promise<CredentialResult<ProviderCredentialStatus>>;
  status(request: ProviderCredentialRequest): Promise<CredentialResult<ProviderCredentialStatus>>;
}

/** Implemented by the trusted provider configuration service, never by renderer code. */
export interface ProviderCredentialAccess {
  set(providerId: string, apiKey: string): Promise<ProviderCredentialStatus>;
  clear(providerId: string): Promise<ProviderCredentialStatus>;
  status(providerId: string): Promise<ProviderCredentialStatus>;
}
