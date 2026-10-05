import type {
  DraftJournal,
  DraftJournalRecord,
} from "../../../../core/contracts/app/draft-journal";

export type DraftDurability =
  "volatile" | "loading" | "writing" | "durable" | "error";
interface Desired {
  generation: number;
  value: string | null;
}
type Attempt = { generation: number } & (
  | { kind: "write"; input: Parameters<DraftJournal["write"]>[0] }
  | { kind: "remove"; input: Parameters<DraftJournal["remove"]>[0] }
);

/** A failed IPC acknowledgement retains the exact CAS operation for explicit, idempotent retry. */
export class PageDraftJournal {
  status: DraftDurability;
  error: string | null = null;
  private token: string | null = null;
  private desired: Desired | undefined;
  private attempt: Attempt | undefined;
  private running: Promise<void> | undefined;
  private generation = 0;
  private acknowledged = 0;
  private blocked = false;

  constructor(
    private bridge: DraftJournal | undefined,
    private key: string,
    private changed: () => void,
  ) {
    this.status = bridge ? "loading" : "volatile";
  }

  async load(): Promise<DraftJournalRecord | null> {
    if (!this.bridge) return null;
    try {
      const record = await this.bridge.read(this.key);
      this.token = record?.token ?? null;
      this.status = "durable";
      return record;
    } catch (error) {
      this.block(error);
      throw error;
    }
  }

  block(error: unknown): void {
    this.blocked = true;
    this.fail(error);
  }

  private fail(error: unknown): void {
    this.status = "error";
    this.error =
      error instanceof Error ? error.message : "Draft journal failed";
    this.changed();
  }

  set(value: string | null): void {
    if (!this.bridge || this.desired?.value === value) return;
    this.desired = { generation: ++this.generation, value };
    if (this.status !== "error") {
      this.status = "writing";
      this.changed();
      this.start();
    }
  }

  retry(): void {
    if (this.blocked || !this.bridge || this.status !== "error") return;
    this.error = null;
    this.start();
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
    if (this.status === "error")
      throw new Error(this.error ?? "Draft not durably retained");
  }

  private start(): void {
    if (this.running || !this.bridge || !this.desired) return;
    this.status = "writing";
    this.changed();
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (
        this.status !== "error" &&
        this.desired &&
        this.desired.generation !== this.acknowledged
      )
        this.start();
    });
  }

  private nextAttempt(desired: Desired): Attempt | undefined {
    if (desired.value !== null)
      return {
        generation: desired.generation,
        kind: "write",
        input: {
          key: this.key,
          token: crypto.randomUUID(),
          expectedToken: this.token,
          value: desired.value,
        },
      };
    if (this.token !== null)
      return {
        generation: desired.generation,
        kind: "remove",
        input: { key: this.key, expectedToken: this.token },
      };
    return undefined;
  }

  private async drain(): Promise<void> {
    try {
      while (this.desired) {
        const desired = this.desired;
        this.attempt ??= this.nextAttempt(desired);
        if (this.attempt) {
          const attempt = this.attempt;
          if (attempt.kind === "write") {
            const result = await this.bridge!.write(attempt.input);
            if (
              result.token !== attempt.input.token ||
              result.value !== attempt.input.value
            )
              throw new Error("Draft acknowledgement mismatch");
            this.token = result.token;
          } else {
            await this.bridge!.remove(attempt.input);
            this.token = null;
          }
          this.attempt = undefined;
          if (attempt.generation !== this.desired.generation) continue;
        }
        if (desired.generation !== this.desired.generation) continue;
        this.acknowledged = desired.generation;
        this.status = "durable";
        this.error = null;
        this.changed();
        return;
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
