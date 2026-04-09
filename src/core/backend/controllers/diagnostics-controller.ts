import type { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { success } from "../http/response";

export class DiagnosticsController {
  constructor(private readonly diagnosticsStore: DiagnosticsStore) {}

  async snapshot(): Promise<Response> {
    return success(this.diagnosticsStore.snapshot());
  }
}
