import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ConversationStore } from "../../../modules/assistant/backend/conversation-store";

// F6: the UNIQUE(design_id, action_id) index + createWriteProposal's
// catch→return-existing makes a duplicate (designId, action_id) a no-op even
// under a concurrent submit, so a duplicate write can't create a second
// proposal. This exercises the real ConversationStore over an in-memory SQLite
// with just the assistant_write_proposal table (cols from 0003+0007+0010).
function makeStore(): { store: ConversationStore; db: Database } {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE assistant_write_proposal (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    tool_event_id TEXT,
    kind TEXT NOT NULL DEFAULT 'generic',
    status TEXT NOT NULL DEFAULT 'pending',
    design_id TEXT NOT NULL,
    base_revision INTEGER,
    proposal_json TEXT,
    apply_result_json TEXT,
    tool_name TEXT, title TEXT, summary TEXT, risk_level TEXT,
    operations_json TEXT, sources_json TEXT, warnings_json TEXT, envelope_json TEXT,
    action_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.run(
    `CREATE UNIQUE INDEX idx_action ON assistant_write_proposal(design_id, action_id) WHERE action_id IS NOT NULL`,
  );
  const ctx = {
    db: {
      rawSql: (q: string, p: unknown[] = []) =>
        db.query(q).all(...(p as never[])) as Record<string, unknown>[],
    },
  };
  return { store: new ConversationStore(ctx as never), db };
}

describe("F6 action_id dedup (DB backstop)", () => {
  test("a second proposal with the same (designId, action_id) returns the first — no duplicate row", () => {
    const { store, db } = makeStore();
    const input = {
      chatId: "c1",
      designId: "d1",
      baseRevision: 0,
      kind: "designer_schematic_wires",
      proposal: {},
      envelope: { actionId: "wire_U1.OUT__R1.1_d1" },
    };

    const first = store.createWriteProposal(input as never);
    const second = store.createWriteProposal(input as never);

    expect(second.id).toBe(first.id); // deduped to the existing proposal
    const rows = db
      .query("SELECT COUNT(*) AS n FROM assistant_write_proposal")
      .all() as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1); // the duplicate insert was rejected
  });

  test("proposals without an action_id are never deduped", () => {
    const { store, db } = makeStore();
    const base = {
      chatId: "c1",
      designId: "d1",
      baseRevision: 0,
      kind: "designer_schematic_edits",
      proposal: {},
      envelope: {},
    };
    const a = store.createWriteProposal(base as never);
    const b = store.createWriteProposal(base as never);
    expect(b.id).not.toBe(a.id);
    const rows = db
      .query("SELECT COUNT(*) AS n FROM assistant_write_proposal")
      .all() as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(2);
  });
});
