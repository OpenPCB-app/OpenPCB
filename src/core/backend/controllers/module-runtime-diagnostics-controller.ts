import type { ModuleRuntimeSnapshotProvider } from "../modules/module-loader";
import { success } from "../http/response";

export class ModuleRuntimeDiagnosticsController {
  constructor(private readonly moduleRuntime: ModuleRuntimeSnapshotProvider) {}

  async snapshot(): Promise<Response> {
    return success(this.moduleRuntime.debugSnapshot());
  }
}
