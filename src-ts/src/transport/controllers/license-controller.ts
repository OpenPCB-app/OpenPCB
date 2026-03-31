import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import { LicenseUtil } from "../../domain/services/license-util";
import type { LicenseStatus } from "../../kernel/license-types";

type LicenseStatusResponse = {
  state: LicenseStatus["state"];
  expiresAt: string | null;
  features: string[];
  reason?: string;
};

type ActivationResponse = {
  success: boolean;
  license: LicenseStatusResponse;
  devices: Array<{
    id: string;
    name: string;
    lastActive: string;
  }>;
  requiresReplacement: boolean;
};

const LICENSE_API_URL = process.env.OPENPCB_LICENSE_API_URL || "";
const LICENSE_API_KEY = process.env.OPENPCB_LICENSE_API_KEY || "";

const mapLicenseStatus = (status: LicenseStatus): LicenseStatusResponse => {
  const expiresAt =
    typeof status.expiresAt === "number" && Number.isFinite(status.expiresAt)
      ? new Date(status.expiresAt).toISOString()
      : null;

  return {
    state: status.state,
    expiresAt,
    features: status.features,
    reason: status.reason,
  };
};

const buildActivationResponse = (
  status: LicenseStatusResponse,
): ActivationResponse => {
  const allowed = status.state === "active" || status.state === "grace";
  return {
    success: allowed,
    license: status,
    devices: [],
    requiresReplacement: false,
  };
};

interface BackendEntitlementResponse {
  success: boolean;
  data?: {
    token: string;
    expiresAt: string;
    claims: {
      accountId: string;
      deviceId: string;
      licenseId: string;
      accessStatus: string;
      licenseStatus: string;
      exp: number;
    };
  };
  error?: {
    code: string;
    message: string;
    prompt?: {
      code: string;
      message: string;
      maxActiveDevices: number;
      activeDevices: Array<{
        deviceId: string;
        slotIndex: number;
        activatedAt: string;
      }>;
    };
  };
}

async function callBackendApi(
  path: string,
  payload: Record<string, unknown>,
): Promise<BackendEntitlementResponse | null> {
  if (!LICENSE_API_URL) return null;

  try {
    const resp = await fetch(`${LICENSE_API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": LICENSE_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    return (await resp.json()) as BackendEntitlementResponse;
  } catch (error) {
    console.error("License backend unreachable:", error);
    return null;
  }
}

function deviceId(): string {
  return process.env.OPENPCB_DEVICE_ID || "unknown";
}

export class LicenseController {
  async status(_ctx: RouteContext): Promise<Response> {
    const status = await LicenseUtil.getCurrentStatus();
    return ResponseBuilder.success(mapLicenseStatus(status));
  }

  async activate(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();
    if (!body || typeof body.key !== "string" || body.key.length === 0) {
      return ResponseBuilder.badRequest("License key is required");
    }

    const backendResult = await callBackendApi("/v1/license/entitlements/issue", {
      accountId: body.accountId || body.key,
      deviceId: deviceId(),
      licenseId: body.key,
    });

    if (backendResult) {
      if (backendResult.success && backendResult.data) {
        const claims = backendResult.data.claims;
        const isActive = claims.accessStatus === "active";
        return ResponseBuilder.success({
          success: isActive,
          license: {
            state: isActive ? "active" : "blocked",
            expiresAt: backendResult.data.expiresAt,
            features: isActive ? ["*"] : [],
          },
          devices: [],
          requiresReplacement: false,
        } satisfies ActivationResponse);
      }

      if (backendResult.error?.prompt) {
        const prompt = backendResult.error.prompt;
        return ResponseBuilder.success({
          success: false,
          license: { state: "blocked", expiresAt: null, features: [] },
          devices: prompt.activeDevices.map((d) => ({
            id: d.deviceId,
            name: `Device ${d.slotIndex + 1}`,
            lastActive: d.activatedAt,
          })),
          requiresReplacement: true,
        } satisfies ActivationResponse);
      }

      return ResponseBuilder.badRequest(
        backendResult.error?.message || "Activation failed",
      );
    }

    // Fallback: no backend URL configured, use env-based stub
    const status = await LicenseUtil.getCurrentStatus();
    return ResponseBuilder.success(buildActivationResponse(mapLicenseStatus(status)));
  }

  async replaceDevice(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();
    if (!body || typeof body.key !== "string" || body.key.length === 0) {
      return ResponseBuilder.badRequest("License key is required");
    }
    if (
      typeof body.deviceIdToReplace !== "string" ||
      body.deviceIdToReplace.length === 0
    ) {
      return ResponseBuilder.badRequest("deviceIdToReplace is required");
    }

    const backendResult = await callBackendApi("/v1/license/entitlements/issue", {
      accountId: body.accountId || body.key,
      deviceId: deviceId(),
      licenseId: body.key,
      replaceOldest: true,
    });

    if (backendResult) {
      if (backendResult.success && backendResult.data) {
        const claims = backendResult.data.claims;
        const isActive = claims.accessStatus === "active";
        return ResponseBuilder.success({
          success: isActive,
          license: {
            state: isActive ? "active" : "blocked",
            expiresAt: backendResult.data.expiresAt,
            features: isActive ? ["*"] : [],
          },
          devices: [],
          requiresReplacement: false,
        } satisfies ActivationResponse);
      }

      return ResponseBuilder.badRequest(
        backendResult.error?.message || "Device replacement failed",
      );
    }

    // Fallback: no backend URL configured
    const status = await LicenseUtil.getCurrentStatus();
    return ResponseBuilder.success(buildActivationResponse(mapLicenseStatus(status)));
  }
}
