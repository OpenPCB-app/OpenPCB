import { describe, it, expect } from "bun:test";
import { AuthErrorCodes, LicenseStatus, validateAuthState, type AuthState } from "../shared/types/auth.types";

describe("Auth & License Contracts", () => {
  it("should have deterministic error codes", () => {
    expect(AuthErrorCodes.AUTH_FAILED).toBe("AUTH_FAILED");
    expect(AuthErrorCodes.LICENSE_EXPIRED).toBe("LICENSE_EXPIRED");
    expect(AuthErrorCodes.DEVICE_LIMIT_REACHED).toBe("DEVICE_LIMIT_REACHED");
  });

  it("should have valid license statuses", () => {
    expect(LicenseStatus.ACTIVE).toBe("ACTIVE");
    expect(LicenseStatus.EXPIRED).toBe("EXPIRED");
    expect(LicenseStatus.TRIAL).toBe("TRIAL");
    expect(LicenseStatus.NONE).toBe("NONE");
  });

  it("should validate valid AuthState structure", () => {
    const validState = {
      isAuthenticated: true,
      session: {
        sessionId: "sess_123",
        userId: "user_123",
        email: "test@example.com",
        deviceId: "dev_123",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
      license: {
        status: LicenseStatus.ACTIVE,
        entitlements: [
          { featureId: "pro_features", granted: true }
        ]
      }
    };
    const result = validateAuthState(validState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAuthenticated).toBe(true);
      expect(result.data.session?.sessionId).toBe("sess_123");
    }
  });

  it("should reject invalid AuthState (missing isAuthenticated)", () => {
    const invalidState = {
      session: {
        sessionId: "sess_123"
      }
    };
    const result = validateAuthState(invalidState);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("isAuthenticated must be a boolean");
    }
  });

  it("should reject invalid AuthState (invalid license status)", () => {
    const invalidState = {
      isAuthenticated: true,
      license: {
        status: "INVALID_STATUS",
        entitlements: []
      }
    };
    const result = validateAuthState(invalidState);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid license status");
    }
  });

  it("should reject invalid AuthState (invalid error code)", () => {
    const invalidState = {
      isAuthenticated: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Something went wrong"
      }
    };
    const result = validateAuthState(invalidState);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid auth error code");
    }
  });

  it("should handle error states in AuthState", () => {
    const errorState = {
      isAuthenticated: false,
      error: {
        code: AuthErrorCodes.LICENSE_EXPIRED,
        message: "Your license has expired"
      }
    };
    const result = validateAuthState(errorState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAuthenticated).toBe(false);
      expect(result.data.error?.code).toBe("LICENSE_EXPIRED");
    }
  });
});
