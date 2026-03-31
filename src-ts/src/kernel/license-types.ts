export type LicenseState = "active" | "grace" | "restricted" | "blocked";

export interface LicenseStatus {
  state: LicenseState;
  expiresAt: number | null;
  features: string[];
  tier?: string;
  reason?: string;
}

export interface LicenseDenial {
  ok: false;
  error: {
    code:
      | "LICENSE_REQUIRED"
      | "LICENSE_EXPIRED"
      | "LICENSE_RESTRICTED"
      | "LICENSE_BLOCKED";
    message: string;
    status: LicenseStatus;
  };
}
