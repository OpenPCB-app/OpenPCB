// Designer crash-recovery journal (OPENPCB-103 §3.4.2) over the native record
// journal bridge (`designer-recovery-<dbhash>`).
//
// Every operation on one record runs on that record's own promise chain, and a
// failed CAS attempt is retried unchanged before anything newer: the store
// accepts an identical token+value write idempotently and a remove of an absent
// record succeeds, so "renamed, then the directory fsync threw" resolves on the
// next operation instead of surfacing as a record conflict.

import type { DraftJournal } from "../../../../core/contracts/app/draft-journal";
import type { NativeJournalAvailability } from "../../../../shared/frontend/storage/native-record-journal";
import {
  DESIGNER_RECOVERY_SCHEMA,
  DESIGNER_RECOVERY_VERSION,
  decodeRecord,
  encodeRecord,
  recoveryKey,
  type DesignerRecoveryRecordV1,
  type RecoveredAction,
  type RecoveryCompat,
} from "./designer-recovery-record";

export type JournalStatus = "durable" | "volatile" | "error";
export interface JournalHandle {
  readonly key: string;
  readonly recordId: string;
  /** What the journal last acknowledged for this record. */
  record: DesignerRecoveryRecordV1;
}
export interface UnsupportedRecord {
  key: string;
  token: string;
  /** Exact stored value; null when the key itself is not a v1 record key. */
  raw: string | null;
  reason: string;
}
export interface LoadedJournal {
  /** Sorted by (seq, key). Records this journal already owns are returned as-is. */
  records: JournalHandle[];
  unsupported: UnsupportedRecord[];
  unreadableCount: number;
  /** Largest loaded `seq`, -1 when there is none. */
  maxSeq: number;
}
type LastKnown = DesignerRecoveryRecordV1["lastKnown"];

export const MISSING_BRIDGE_MESSAGE =
  "Recovery journal bridge missing — restart OpenPCB";
export const RECORD_TOO_LARGE_MESSAGE = "Edit too large for crash recovery";
/** AtomicRecordStore's value limit (UTF-8 bytes). */
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const PROBE_PREFIX = "v1/_probe/";
const PROBE_VALUE = '{"probe":true}';

type Attempt =
  | {
      kind: "write";
      input: Parameters<DraftJournal["write"]>[0];
      record: DesignerRecoveryRecordV1;
    }
  | { kind: "remove"; input: Parameters<DraftJournal["remove"]>[0] };

interface Slot {
  readonly handle: JournalHandle;
  /** Acknowledged token on disk; null = nothing of ours on disk. */
  token: string | null;
  /** The exact failed CAS operation, retried unchanged before anything newer. */
  attempt: Attempt | undefined;
  chain: Promise<void>;
  /** Latest coalesced note not yet written. */
  note: LastKnown | undefined;
  noteScheduled: boolean;
  /** Settle requested: nothing is written for this record any more. */
  closing: boolean;
  /** Its `prepare` failed, so no caller holds the handle. */
  abandoned: boolean;
  settled: boolean;
}

export class DesignerRecoveryJournal {
  status: JournalStatus;
  error: string | null = null;
  readonly mode: NativeJournalAvailability["kind"];
  private readonly bridge: DraftJournal | null;
  private readonly now: () => Date;
  private readonly changed: () => void;
  private readonly slots = new Map<string, Slot>();
  private readonly owners = new WeakMap<JournalHandle, Slot>();
  private nextSeq = 0;
  /** A `load()` succeeded since the last failure: `seq` base and disk records are known. */
  private loaded = false;

  constructor(
    availability: NativeJournalAvailability,
    opts: { now?: () => Date; onChange?: () => void } = {},
  ) {
    this.mode = availability.kind;
    this.bridge = availability.kind === "native" ? availability.journal : null;
    this.now = opts.now ?? (() => new Date());
    this.changed = opts.onChange ?? (() => undefined);
    if (availability.kind === "native") this.status = "durable";
    else if (availability.kind === "browser") this.status = "volatile";
    else {
      this.status = "error";
      this.error = MISSING_BRIDGE_MESSAGE;
    }
  }

  /** Journals a never-sent intent. A rejection means the edit must not be sent. */
  async prepare(
    designId: string,
    action: RecoveredAction,
    compat: RecoveryCompat,
  ): Promise<JournalHandle> {
    if (this.status === "error")
      throw new Error(this.error ?? "Recovery journal unavailable");
    if (this.bridge && !this.loaded)
      throw new Error("Recovery journal not loaded");
    const at = this.now().toISOString();
    const record: DesignerRecoveryRecordV1 = {
      schema: DESIGNER_RECOVERY_SCHEMA,
      version: DESIGNER_RECOVERY_VERSION,
      compat,
      recordId: crypto.randomUUID(),
      designId,
      createdAt: at,
      seq: this.nextSeq++,
      phase: "queued",
      action,
      lastKnown: { state: "queued", at },
    };
    if (!this.bridge) return this.createSlot(record, null).handle;
    const value = this.encode(record);
    const slot = this.createSlot(record, null);
    try {
      await this.run(slot, () => this.write(slot, record, value));
    } catch (error) {
      this.fail(error);
      this.abandon(slot);
      throw error;
    }
    return slot.handle;
  }

  /** Records the ids of the send about to happen. A rejection means it must not be sent. */
  async markSending(
    handle: JournalHandle,
    action: RecoveredAction,
  ): Promise<void> {
    const slot = this.slotOf(handle);
    if (slot.closing) throw new Error("Recovery record already settled");
    if (action.kind !== handle.record.action.kind)
      throw new Error("Recovery record action kind cannot change");
    if (this.status === "error")
      throw new Error(this.error ?? "Recovery journal unavailable");
    const next: DesignerRecoveryRecordV1 = {
      ...handle.record,
      phase: "sending",
      action,
      lastKnown: { state: "sending", at: this.now().toISOString() },
    };
    if (!this.bridge) {
      handle.record = next;
      return;
    }
    const value = this.encode(next);
    slot.note = undefined;
    try {
      await this.run(slot, async () => {
        await this.retryPending(slot);
        await this.write(slot, next, value);
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Best effort and coalesced: only the latest `lastKnown` is written; never blocks. */
  note(handle: JournalHandle, lastKnown: LastKnown): void {
    const slot = this.slotOf(handle);
    if (slot.closing) return;
    if (!this.bridge) {
      handle.record = { ...handle.record, lastKnown };
      return;
    }
    slot.note = lastKnown;
    if (slot.noteScheduled) return;
    slot.noteScheduled = true;
    void this.run(slot, async () => {
      slot.noteScheduled = false;
      const latest = slot.note;
      slot.note = undefined;
      if (!latest || slot.closing) return;
      await this.retryPending(slot);
      const next = { ...slot.handle.record, lastKnown: latest };
      await this.write(slot, next, this.encode(next));
    }).catch((error: unknown) => {
      console.warn("Designer recovery note not journaled", error);
    });
  }

  /** Removes the record. On rejection the exact attempt is kept: never claim removal. */
  async settle(handle: JournalHandle): Promise<void> {
    const slot = this.slotOf(handle);
    slot.closing = true;
    slot.note = undefined;
    if (!this.bridge) return this.drop(slot);
    await this.run(slot, () => this.remove(slot));
  }

  /** Explicit user discard of a record `load()` reported as unsupported (CAS by token). */
  async removeUnsupported(key: string, token: string): Promise<void> {
    if (this.slots.has(key))
      throw new Error("Not an unsupported recovery record");
    if (this.mode === "browser") return;
    await this.requireBridge().remove({ key, expectedToken: token });
  }

  async load(): Promise<LoadedJournal> {
    if (this.mode === "browser") return this.finishLoad(this.ownedHandles(), [], 0);
    const bridge = this.requireBridge();
    try {
      await this.withdrawAbandoned();
      const listing = await bridge.list();
      const records: JournalHandle[] = [];
      const unsupported: UnsupportedRecord[] = [];
      let unreadable = listing.unreadableCount;
      for (const { key, token } of listing.records) {
        const loaded = await this.loadOne(bridge, key, token);
        if (loaded === "unreadable") unreadable++;
        else if (loaded && "reason" in loaded) unsupported.push(loaded);
        else if (loaded) records.push(loaded);
      }
      return this.finishLoad(records, unsupported, unreadable);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Write + remove of a scratch record; success lifts the error status (the caller re-loads). */
  async probe(): Promise<void> {
    if (this.mode === "browser") return;
    const bridge = this.requireBridge();
    const key = `${PROBE_PREFIX}${crypto.randomUUID()}`;
    const token = crypto.randomUUID();
    try {
      const written = await bridge.write({
        key,
        token,
        expectedToken: null,
        value: PROBE_VALUE,
      });
      if (written.token !== token || written.value !== PROBE_VALUE)
        throw new Error("Recovery journal acknowledgement mismatch");
      await bridge.remove({ key, expectedToken: token });
    } catch (error) {
      this.fail(error);
      throw error;
    }
    this.status = "durable";
    this.error = null;
    this.changed();
  }

  private async loadOne(
    bridge: DraftJournal,
    key: string,
    token: string,
  ): Promise<JournalHandle | UnsupportedRecord | "unreadable" | null> {
    if (key.startsWith(PROBE_PREFIX)) {
      // A probe interrupted between its write and remove; never user data.
      await bridge.remove({ key, expectedToken: token }).catch(() => false);
      return null;
    }
    const owned = this.slots.get(key);
    if (owned) return owned.handle;
    if (!key.startsWith("v1/"))
      return { key, token, raw: null, reason: "unknown-key-schema" };
    let stored: Awaited<ReturnType<DraftJournal["read"]>>;
    try {
      stored = await bridge.read(key);
    } catch {
      return "unreadable";
    }
    if (!stored) return null;
    const decoded = decodeRecord(key, stored.value);
    if (!decoded.ok)
      return { key, token: stored.token, raw: stored.value, reason: decoded.reason };
    return (
      this.slots.get(key) ?? this.createSlot(decoded.record, stored.token)
    ).handle;
  }

  private finishLoad(
    records: JournalHandle[],
    unsupported: UnsupportedRecord[],
    unreadableCount: number,
  ): LoadedJournal {
    records.sort(
      (a, b) =>
        a.record.seq - b.record.seq ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    const maxSeq = records.reduce((max, h) => Math.max(max, h.record.seq), -1);
    this.nextSeq = Math.max(this.nextSeq, maxSeq + 1);
    this.loaded = true;
    return { records, unsupported, unreadableCount, maxSeq };
  }

  private ownedHandles(): JournalHandle[] {
    return [...this.slots.values()].map((slot) => slot.handle);
  }

  /**
   * A failed `prepare` may still have landed ("renamed, then fsync threw"). Its
   * caller holds no handle, so that record would resurface as a second "not
   * sent" copy of an intent the caller retains record-less: remove it iff it landed.
   */
  private abandon(slot: Slot): void {
    slot.closing = true;
    slot.abandoned = true;
    const pending = slot.attempt;
    if (pending?.kind === "write")
      slot.attempt = {
        kind: "remove",
        input: { key: slot.handle.key, expectedToken: pending.input.token },
      };
    void this.run(slot, () => this.remove(slot)).catch(() => undefined);
  }

  private async withdrawAbandoned(): Promise<void> {
    for (const slot of [...this.slots.values()])
      if (slot.abandoned) await this.run(slot, () => this.remove(slot));
  }

  private async remove(slot: Slot): Promise<void> {
    if (slot.settled) return;
    await this.retryPending(slot);
    if (slot.token !== null)
      await this.execute(slot, {
        kind: "remove",
        input: { key: slot.handle.key, expectedToken: slot.token },
      });
    this.drop(slot);
  }

  private write(
    slot: Slot,
    record: DesignerRecoveryRecordV1,
    value: string,
  ): Promise<void> {
    return this.execute(slot, {
      kind: "write",
      record,
      input: {
        key: slot.handle.key,
        token: crypto.randomUUID(),
        expectedToken: slot.token,
        value,
      },
    });
  }

  private retryPending(slot: Slot): Promise<void> {
    return slot.attempt ? this.execute(slot, slot.attempt) : Promise.resolve();
  }

  private async execute(slot: Slot, attempt: Attempt): Promise<void> {
    slot.attempt = attempt;
    const bridge = this.requireBridge();
    if (attempt.kind === "write") {
      const result = await bridge.write(attempt.input);
      if (
        result.token !== attempt.input.token ||
        result.value !== attempt.input.value
      )
        throw new Error("Recovery journal acknowledgement mismatch");
      slot.token = attempt.input.token;
      slot.handle.record = attempt.record;
    } else {
      await bridge.remove(attempt.input);
      slot.token = null;
    }
    slot.attempt = undefined;
  }

  private run<T>(slot: Slot, op: () => Promise<T>): Promise<T> {
    const result = slot.chain.then(op);
    slot.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private encode(record: DesignerRecoveryRecordV1): string {
    const value = encodeRecord(record);
    if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES)
      throw new Error(RECORD_TOO_LARGE_MESSAGE);
    return value;
  }

  private createSlot(
    record: DesignerRecoveryRecordV1,
    token: string | null,
  ): Slot {
    const handle: JournalHandle = {
      key: recoveryKey(record.designId, record.recordId),
      recordId: record.recordId,
      record,
    };
    const slot: Slot = {
      handle,
      token,
      attempt: undefined,
      chain: Promise.resolve(),
      note: undefined,
      noteScheduled: false,
      closing: false,
      abandoned: false,
      settled: false,
    };
    this.slots.set(handle.key, slot);
    this.owners.set(handle, slot);
    return slot;
  }

  private slotOf(handle: JournalHandle): Slot {
    const slot = this.owners.get(handle);
    if (!slot) throw new Error("Unknown recovery record handle");
    return slot;
  }

  private drop(slot: Slot): void {
    slot.settled = true;
    if (this.slots.get(slot.handle.key) === slot)
      this.slots.delete(slot.handle.key);
  }

  private requireBridge(): DraftJournal {
    if (!this.bridge)
      throw new Error(this.error ?? "Recovery journal unavailable");
    return this.bridge;
  }

  private fail(error: unknown): void {
    this.status = "error";
    this.error =
      error instanceof Error ? error.message : "Recovery journal failed";
    this.loaded = false;
    this.changed();
  }
}
