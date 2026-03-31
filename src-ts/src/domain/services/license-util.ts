import type { LicenseStatus, LicenseDenial } from '../../kernel/license-types';

const LICENSE_STATES = new Set(['active', 'grace', 'restricted', 'blocked']);

const resolveStartupState = (): LicenseStatus['state'] => {
  if (process.env.NODE_ENV === 'development') {
    return 'active';
  }
  const raw = process.env.OPENPCB_STARTUP_LICENSE_STATE;
  if (raw && LICENSE_STATES.has(raw)) {
    return raw as LicenseStatus['state'];
  }
  return 'blocked';
};

const resolveStartupReason = (): string | undefined => {
  if (process.env.NODE_ENV === 'development') {
    return undefined;
  }
  const code = process.env.OPENPCB_STARTUP_LICENSE_CODE;
  if (!code) {
    return 'STARTUP_LICENSE_MISSING';
  }
  return code;
};

export class LicenseDeniedError extends Error {
  constructor(public readonly denial: LicenseDenial) {
    super(denial.error.message);
    this.name = 'LicenseDeniedError';
  }
}

export class LicenseUtil {
  static isAllowed(status: LicenseStatus): boolean {
    return status.state === 'active' || status.state === 'grace';
  }

  static createDenial(status: LicenseStatus): LicenseDenial {
    let code: LicenseDenial['error']['code'] = 'LICENSE_REQUIRED';
    let message = 'A valid license is required to perform this action.';

    switch (status.state) {
      case 'blocked':
        code = 'LICENSE_BLOCKED';
        message = status.reason || 'License is blocked.';
        break;
      case 'restricted':
        code = 'LICENSE_RESTRICTED';
        message = status.reason || 'License is restricted.';
        break;
      case 'grace':
        code = 'LICENSE_EXPIRED';
        message = 'License is in grace period.';
        break;
    }

    return {
      ok: false,
      error: {
        code,
        message,
        status,
      },
    };
  }

  static async getDenialIfNotAllowed(): Promise<LicenseDenial | null> {
    const status = await this.getCurrentStatus();
    if (this.isAllowed(status)) {
      return null;
    }
    return this.createDenial(status);
  }

  static async enforceAllowed(): Promise<void> {
    const denial = await this.getDenialIfNotAllowed();
    if (denial) {
      throw new LicenseDeniedError(denial);
    }
  }

  // Async for forward compatibility — will call backend API when OPENPCB_LICENSE_API_URL is set
  static async getCurrentStatus(): Promise<LicenseStatus> {
    const state = resolveStartupState();
    return {
      state,
      expiresAt: null,
      features: state === 'active' || state === 'grace' ? ['*'] : [],
      reason: state === 'blocked' || state === 'restricted' ? resolveStartupReason() : undefined,
    };
  }
}
