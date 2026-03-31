import { eq, and, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import {
  messageMention,
  type NewMessageMention,
  type MessageMention,
} from "../schema/mention";
import { generateUUIDv7 } from "../schema/base";

export class MentionRepository {
  constructor(private db: BunSQLiteDatabase<typeof schema>) {}

  async createMany(
    mentions: Omit<NewMessageMention, "id" | "createdAt" | "updatedAt">[],
  ): Promise<MessageMention[]> {
    if (mentions.length === 0) return [];

    const now = new Date();
    const records = mentions.map((m) => ({
      ...m,
      id: generateUUIDv7(),
      createdAt: now,
      updatedAt: now,
    }));

    // Use returning() to get properly typed records from DB
    const inserted = await this.db
      .insert(messageMention)
      .values(records)
      .returning();

    return inserted;
  }

  async getByMessageId(messageId: string): Promise<MessageMention[]> {
    return this.db
      .select()
      .from(messageMention)
      .where(eq(messageMention.messageId, messageId))
      .orderBy(messageMention.position);
  }

  async getByMessageIds(
    messageIds: string[],
  ): Promise<Map<string, MessageMention[]>> {
    if (messageIds.length === 0) return new Map();

    const mentions = await this.db
      .select()
      .from(messageMention)
      .where(inArray(messageMention.messageId, messageIds));

    const byMessage = new Map<string, MessageMention[]>();
    for (const mention of mentions) {
      const existing = byMessage.get(mention.messageId) ?? [];
      existing.push(mention);
      byMessage.set(mention.messageId, existing);
    }

    return byMessage;
  }

  async getByEntity(
    entityType: string,
    entityId: string,
  ): Promise<MessageMention[]> {
    return this.db
      .select()
      .from(messageMention)
      .where(
        and(
          eq(messageMention.entityType, entityType),
          eq(messageMention.entityId, entityId),
        ),
      );
  }

  async deleteByMessageId(messageId: string): Promise<void> {
    await this.db
      .delete(messageMention)
      .where(eq(messageMention.messageId, messageId));
  }
}
