export interface DiagnosticErrorEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  title: string;
  detail: string;
}

export interface DiagnosticsPayload {
  startedAt: string;
  uptimeMs: number;
  errorCount: number;
  recentErrors: DiagnosticErrorEntry[];
}
