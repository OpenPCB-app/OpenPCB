import { success } from "../http/response";
import type { HealthPayload } from "../contracts/health";

export class HealthController {
  static async check(): Promise<Response> {
    const payload: HealthPayload = { status: "ok" };
    return success(payload);
  }
}
