import { customFetch } from "@/../../src-ts/shared/sdk/mutator";

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface LicenseStatus {
  state: "active" | "grace" | "restricted" | "blocked";
  expiresAt: string | null;
  features: string[];
  reason?: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  lastActive: string;
}

export interface ActivationResponse {
  success: boolean;
  license?: LicenseStatus;
  devices?: DeviceInfo[];
  requiresReplacement?: boolean;
}

export const getLicenseStatus = async (): Promise<LicenseStatus> => {
  const response = await customFetch<ApiResponse<LicenseStatus>>(
    "/api/license/status",
  );
  if (!response.data) {
    throw new Error("Failed to fetch license status");
  }
  return response.data;
};

export const activateLicense = async (
  key: string,
): Promise<ActivationResponse> => {
  const response = await customFetch<ApiResponse<ActivationResponse>>(
    "/api/license/activate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    },
  );

  if (!response.data) {
    throw new Error("Activation failed");
  }
  return response.data;
};

export const replaceDevice = async (
  key: string,
  deviceIdToReplace: string,
): Promise<ActivationResponse> => {
  const response = await customFetch<ApiResponse<ActivationResponse>>(
    "/api/license/replace-device",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, deviceIdToReplace }),
    },
  );

  if (!response.data) {
    throw new Error("Device replacement failed");
  }
  return response.data;
};

export interface AlphaRegisterResponse {
  success: boolean;
  data?: {
    accountId: string;
    token: string;
    expiresAt: string;
    tier: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

const licenseBackendUrl = import.meta.env.VITE_LICENSE_BACKEND_URL ?? "";

export const registerAlpha = async (
  email: string,
  deviceId?: string,
): Promise<AlphaRegisterResponse> => {
  const res = await fetch(`${licenseBackendUrl}/v1/auth/alpha-register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, deviceId }),
  });
  return res.json() as Promise<AlphaRegisterResponse>;
};
