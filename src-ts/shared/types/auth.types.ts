// Future cross-layer auth contract. Not yet consumed by sidecar/frontend.
export const AuthErrorCodes = {
  AUTH_FAILED: "AUTH_FAILED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",

  LICENSE_REQUIRED: "LICENSE_REQUIRED",
  LICENSE_EXPIRED: "LICENSE_EXPIRED",
  LICENSE_INVALID: "LICENSE_INVALID",
  DEVICE_LIMIT_REACHED: "DEVICE_LIMIT_REACHED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",

  AUTH_SERVICE_UNAVAILABLE: "AUTH_SERVICE_UNAVAILABLE",
  INTERNAL_AUTH_ERROR: "INTERNAL_AUTH_ERROR",
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

export const LicenseStatus = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  TRIAL: "TRIAL",
  REVOKED: "REVOKED",
  NONE: "NONE",
} as const;

export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus];

export interface Entitlement {
  featureId: string;
  granted: boolean;
  reason?: AuthErrorCode;
}

export interface LicenseInfo {
  status: LicenseStatus;
  tier?: string;
  licenseKey?: string;
  expiresAt?: string;
  trialExpiresAt?: string;
  entitlements: Entitlement[];
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  email: string;
  deviceId: string;
  deviceName?: string;
  issuedAt: string;
  expiresAt: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  session?: AuthSession;
  license?: LicenseInfo;
  error?: {
    code: AuthErrorCode;
    message: string;
  };
}

export function validateAuthState(
  data: any,
): { success: true; data: AuthState } | { success: false; error: string } {
  if (typeof data !== "object" || data === null) {
    return { success: false, error: "Data must be an object" };
  }

  if (typeof data.isAuthenticated !== "boolean") {
    return { success: false, error: "isAuthenticated must be a boolean" };
  }

  if (data.session !== undefined) {
    if (typeof data.session !== "object" || data.session === null) {
      return { success: false, error: "session must be an object" };
    }
    const s = data.session;
    if (
      typeof s.sessionId !== "string" ||
      typeof s.userId !== "string" ||
      typeof s.email !== "string" ||
      typeof s.deviceId !== "string" ||
      typeof s.issuedAt !== "string" ||
      typeof s.expiresAt !== "string"
    ) {
      return { success: false, error: "Invalid session structure" };
    }
  }

  if (data.license !== undefined) {
    if (typeof data.license !== "object" || data.license === null) {
      return { success: false, error: "license must be an object" };
    }
    const l = data.license;
    if (!Object.values(LicenseStatus).includes(l.status)) {
      return { success: false, error: "Invalid license status" };
    }
    if (!Array.isArray(l.entitlements)) {
      return { success: false, error: "entitlements must be an array" };
    }
    for (const e of l.entitlements) {
      if (typeof e.featureId !== "string" || typeof e.granted !== "boolean") {
        return { success: false, error: "Invalid entitlement structure" };
      }
    }
  }

  if (data.error !== undefined) {
    if (typeof data.error !== "object" || data.error === null) {
      return { success: false, error: "error must be an object" };
    }
    if (!Object.values(AuthErrorCodes).includes(data.error.code)) {
      return { success: false, error: "Invalid auth error code" };
    }
    if (typeof data.error.message !== "string") {
      return { success: false, error: "error message must be a string" };
    }
  }

  return { success: true, data: data as AuthState };
}
