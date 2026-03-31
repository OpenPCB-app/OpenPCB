import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { withQueryLogging } from "../decorators";
import {
  type McpServer,
  type McpServerTransport,
  type NewMcpServer,
  mcpServer,
} from "../schema/mcp-server";
import { generateUUIDv7 } from "../schema/base";

type CreateMcpServerInput = Omit<
  NewMcpServer,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

type UpdateMcpServerInput = Partial<
  Omit<NewMcpServer, "id" | "createdAt" | "updatedAt">
>;

export class McpServerRepository {
  private entityName = "McpServer";

  constructor(
    private db: BunSQLiteDatabase<typeof schema>,
    private logger: QueryLogger,
  ) {}

  async findAll(): Promise<McpServer[]> {
    return withQueryLogging(this.logger, this.entityName, "findAll", async () => {
      return await this.db.select().from(mcpServer).orderBy(mcpServer.alias);
    });
  }

  async findById(id: string): Promise<McpServer | null> {
    return withQueryLogging(this.logger, this.entityName, "findById", async () => {
      const rows = await this.db
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.id, id))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async findByAlias(alias: string): Promise<McpServer | null> {
    return withQueryLogging(this.logger, this.entityName, "findByAlias", async () => {
      const rows = await this.db
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.alias, alias))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async create(input: CreateMcpServerInput): Promise<McpServer> {
    return withQueryLogging(this.logger, this.entityName, "create", async () => {
      const now = new Date();
      const id = input.id ?? generateUUIDv7();
      const values = this.normalizeForWrite({ ...input, id, createdAt: now, updatedAt: now });

      await this.db.insert(mcpServer).values(values);

      const created = await this.findById(id);
      if (!created) {
        throw new Error("MCP server create failed");
      }
      return created;
    });
  }

  async update(id: string, patch: UpdateMcpServerInput): Promise<McpServer> {
    return withQueryLogging(this.logger, this.entityName, "update", async () => {
      const current = await this.findById(id);
      if (!current) {
        throw new Error(`MCP server not found: ${id}`);
      }

      const values = this.normalizeForWrite({
        ...current,
        ...patch,
        id,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      });

      await this.db.update(mcpServer).set(values).where(eq(mcpServer.id, id));

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error(`MCP server update failed: ${id}`);
      }
      return updated;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withQueryLogging(this.logger, this.entityName, "delete", async () => {
      const existing = await this.findById(id);
      if (!existing) {
        return false;
      }

      await this.db.delete(mcpServer).where(eq(mcpServer.id, id));
      return true;
    });
  }

  private normalizeForWrite(values: NewMcpServer): NewMcpServer {
    const alias = values.alias.trim();
    if (!alias) {
      throw new Error("mcp_server alias is required");
    }

    const transport = values.transport;
    this.assertTransportFields(transport, values.command, values.url);

    return {
      ...values,
      alias,
      command:
        transport === "stdio"
          ? values.command?.trim()
          : null,
      args: transport === "stdio" ? values.args ?? [] : null,
      env: transport === "stdio" ? values.env ?? null : null,
      url: transport === "http" ? values.url?.trim() : null,
      headers: transport === "http" ? values.headers ?? null : null,
    };
  }

  private assertTransportFields(
    transport: McpServerTransport,
    command?: string | null,
    url?: string | null,
  ): void {
    if (transport === "stdio") {
      if (!command?.trim()) {
        throw new Error("mcp_server stdio transport requires command");
      }
      return;
    }

    if (!url?.trim()) {
      throw new Error("mcp_server http transport requires url");
    }
  }
}
