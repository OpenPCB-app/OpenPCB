import type { DiagnosticErrorEntry, DiagnosticsPayload } from "../contracts/diagnostics";
import { ErrorBuffer } from "./error-buffer";

export class DiagnosticsStore {
  private readonly startedAt = new Date();
  private errorCount = 0;
  private readonly errorBuffer: ErrorBuffer;

  constructor(maxErrors = 100) {
    this.errorBuffer = new ErrorBuffer(maxErrors);
  }

  recordError(entry: DiagnosticErrorEntry): void {
    this.errorCount += 1;
    this.errorBuffer.add(entry);
  }

  snapshot(): DiagnosticsPayload {
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeMs: Math.max(0, Date.now() - this.startedAt.getTime()),
      errorCount: this.errorCount,
      recentErrors: this.errorBuffer.listNewestFirst(),
    };
  }
}
