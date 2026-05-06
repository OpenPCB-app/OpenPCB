import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  CommandHistory,
  CommandHistorySnapshot,
} from "../../../shared/domain/commands";
import type { DesignerCommand } from "../../../sdks";
import type { DesignerWorldComponent } from "./projection-world";
import { sessionHistories } from "./schema";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

function historyRowId(designId: string, sessionId: string): string {
  return `${designId}:${sessionId}`;
}

function parseHistorySnapshotJson(
  undoStackJson: string,
  redoStackJson: string,
): CommandHistorySnapshot<DesignerCommand, DesignerWorldComponent> | null {
  try {
    const undoStack = JSON.parse(undoStackJson) as unknown;
    const redoStack = JSON.parse(redoStackJson) as unknown;
    if (!Array.isArray(undoStack) || !Array.isArray(redoStack)) return null;
    return {
      undoDepth: undoStack.length,
      redoDepth: redoStack.length,
      undoStack: undoStack as CommandHistorySnapshot<DesignerCommand, DesignerWorldComponent>["undoStack"],
      redoStack: redoStack as CommandHistorySnapshot<DesignerCommand, DesignerWorldComponent>["redoStack"],
    };
  } catch {
    return null;
  }
}

export function hydrateSessionHistory(
  db: DbClient,
  designId: string,
  sessionId: string,
  history: CommandHistory<DesignerCommand, DesignerWorldComponent>,
): void {
  const persisted = db
    .select()
    .from(sessionHistories)
    .where(eq(sessionHistories.id, historyRowId(designId, sessionId)))
    .get();
  if (!persisted) return;
  const snapshot = parseHistorySnapshotJson(
    persisted.undoStackJson,
    persisted.redoStackJson,
  );
  if (snapshot) history.restore(snapshot);
}

export function persistSessionHistorySnapshot(params: {
  db: DbClient;
  designId: string;
  sessionId: string;
  history: CommandHistory<DesignerCommand, DesignerWorldComponent>;
  timestamp: string;
}): void {
  const { db, designId, sessionId, history, timestamp } = params;
  const snapshot = history.snapshot();
  db.delete(sessionHistories)
    .where(eq(sessionHistories.id, historyRowId(designId, sessionId)))
    .run();
  db.insert(sessionHistories)
    .values({
      id: historyRowId(designId, sessionId),
      designId,
      sessionId,
      undoStackJson: JSON.stringify(snapshot.undoStack),
      redoStackJson: JSON.stringify(snapshot.redoStack),
      updatedAt: timestamp,
    })
    .run();
}
