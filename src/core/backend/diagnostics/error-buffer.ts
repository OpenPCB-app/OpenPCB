import type { DiagnosticErrorEntry } from "../contracts/diagnostics";

export class ErrorBuffer {
  private readonly items: DiagnosticErrorEntry[] = [];

  constructor(private readonly maxSize = 100) {}

  add(entry: DiagnosticErrorEntry): void {
    this.items.push(entry);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  listNewestFirst(): DiagnosticErrorEntry[] {
    return [...this.items].reverse();
  }
}
