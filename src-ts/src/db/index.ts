/// <reference path="../types/bun-globals.d.ts" />
/**
 * DatabaseAccess - Unified Database Access Layer
 *
 * Provides type-safe SQLite access via Drizzle ORM for the Bun TypeScript layer.
 * Implements singleton pattern for single connection management.
 *
 * Architecture: Part 7 - Database Access Layer
 * - Single SQLite connection per process
 * - Transaction coordination
 * - Migration management
 */

import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";
import { QueryLogger, type QueryMetrics } from "./query-logger";
import {
  Transaction,
  type TransactionClient,
  type TransactionOptions,
} from "./transaction";
import { parseSQLiteError, DatabaseError } from "./errors";
import { WorkspaceRepository } from "./repositories/workspace";
import { ProjectRepository } from "./repositories/project";
import { DesignRepository } from "./repositories/design";
import { ChatRepository } from "./repositories/chat";
import { MessageRepository } from "./repositories/message";
import { TaskRepository } from "./repositories/task";
import { TaskChunkRepository } from "./repositories/task-chunk";
import { TaskToolEventRepository } from "./repositories/task-tool-event";
import { FileBlobRepository } from "./repositories/file-blob";
import { FileRepository } from "./repositories/file";
import { FileVersionRepository } from "./repositories/file-version";
import { UploadSessionRepository } from "./repositories/upload-session";
import { FileRetentionPolicyRepository } from "./repositories/file-retention-policy";
import { ModuleDbHandle } from "./module-handle";
import { ProviderApiKeyRepository } from "./repositories/provider-api-key";
import { ProviderRepository } from "./repositories/provider";
import { FolderRepository } from "./repositories/folder";
import { FavoriteRepository } from "./repositories/favorite";
import { TagRepository } from "./repositories/tag";
import { BookmarkRepository } from "./repositories/bookmark";
import {
  UsageRecordRepository,
  UsageBudgetRepository,
} from "./repositories/usage";
import { MentionRepository } from "./repositories/mention";
import { ContentEditSnapshotRepository } from "./repositories/content-edit-snapshot";
import { ContentEditLockRepository } from "./repositories/content-edit-lock";
import { McpServerRepository } from "./repositories/mcp-server";

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  /**
   * Path to SQLite database file
   * Default: APP_DATA_DIR/OpenPCB.db or ./data/OpenPCB.db
   */
  filePath: string;

  /**
   * Enable query logging for debugging
   * Default: false in production, true in development
   */
  logger?: boolean;

  /**
   * SQLite connection options
   */
  options?: {
    /**
     * Enable Write-Ahead Logging for better concurrency
     * Default: true
     */
    enableWAL?: boolean;

    /**
     * Set busy timeout in milliseconds
     * Default: 5000
     */
    busyTimeout?: number;
  };
}

/**
 * DatabaseAccess singleton class
 *
 * Manages SQLite connection lifecycle and provides Drizzle ORM instance.
 * Thread-safe with single connection per process.
 *
 * @example
 * const db = DatabaseAccess.getInstance();
 * const results = await db.query.someTable.findMany();
 */
export class DatabaseAccess {
  private static instance: DatabaseAccess | null = null;
  private sqlite: Database;
  private db: BunSQLiteDatabase<typeof schema>;
  private config: DatabaseConfig;
  private queryLogger: QueryLogger;
  private retryConfig = { maxAttempts: 3, delayMs: 50 };

  // Repository instances (lazy-initialized)
  private _workspaces?: WorkspaceRepository;
  private _projects?: ProjectRepository;
  private _designs?: DesignRepository;
  private _chats?: ChatRepository;
  private _messages?: MessageRepository;
  private _tasks?: TaskRepository;
  private _taskChunks?: TaskChunkRepository;
  private _taskToolEvents?: TaskToolEventRepository;
  private _fileBlobs?: FileBlobRepository;
  private _fileRecords?: FileRepository;
  private _fileVersions?: FileVersionRepository;
  private _uploadSessions?: UploadSessionRepository;
  private _retentionPolicies?: FileRetentionPolicyRepository;
  private _providerApiKeys?: ProviderApiKeyRepository;
  private _providers?: ProviderRepository;
  private _folders?: FolderRepository;
  private _favorites?: FavoriteRepository;
  private _tags?: TagRepository;
  private _bookmarks?: BookmarkRepository;
  private _usageRecords?: UsageRecordRepository;
  private _usageBudgets?: UsageBudgetRepository;
  private _mentions?: MentionRepository;
  private _contentEditSnapshots?: ContentEditSnapshotRepository;
  private _contentEditLocks?: ContentEditLockRepository;
  private _mcpServers?: McpServerRepository;

  /**
   * Private constructor - use getInstance()
   */
  private constructor(config: DatabaseConfig) {
    this.config = config;

    // Initialize query logger
    this.queryLogger = new QueryLogger({
      slowQueryThreshold: 100,
      enableLogging: config.logger ?? process.env.NODE_ENV === "development",
    });

    // Initialize bun:sqlite Database
    this.sqlite = new Database(config.filePath, {
      create: true,
      readwrite: true,
    });

    // Configure SQLite pragmas for optimal performance
    this.configurePragmas();

    // Initialize Drizzle ORM instance
    this.db = drizzle(this.sqlite, {
      schema,
      logger: config.logger ?? process.env.NODE_ENV === "development",
    });
  }

  /**
   * Get or create DatabaseAccess singleton instance
   *
   * @param config - Database configuration (required on first call)
   * @returns DatabaseAccess instance
   */
  public static getInstance(config?: DatabaseConfig): DatabaseAccess {
    if (!DatabaseAccess.instance) {
      if (!config) {
        throw new Error(
          "DatabaseAccess: config required on first getInstance() call",
        );
      }
      DatabaseAccess.instance = new DatabaseAccess(config);
    }
    return DatabaseAccess.instance;
  }

  /**
   * Check if DatabaseAccess is initialized
   */
  public static isInitialized(): boolean {
    return DatabaseAccess.instance !== null;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static reset(): void {
    if (DatabaseAccess.instance) {
      DatabaseAccess.instance.close();
      DatabaseAccess.instance = null;
    }
  }

  /**
   * Get Drizzle ORM database instance
   *
   * @example
   * const db = DatabaseAccess.getInstance().getDb();
   * const users = await db.query.users.findMany();
   */
  public getDb(): BunSQLiteDatabase<typeof schema> {
    return this.db;
  }

  /**
   * Get raw bun:sqlite Database instance
   * Use sparingly - prefer Drizzle queries
   */
  public getRawDb(): Database {
    return this.sqlite;
  }

  /**
   * Configure SQLite pragmas for performance and reliability
   */
  private configurePragmas(): void {
    const { enableWAL = true, busyTimeout = 5000 } = this.config.options ?? {};

    // Enable Write-Ahead Logging for better concurrency
    if (enableWAL) {
      this.sqlite.exec("PRAGMA journal_mode = WAL;");
    }

    // Set busy timeout to prevent immediate SQLITE_BUSY errors
    this.sqlite.exec(`PRAGMA busy_timeout = ${busyTimeout};`);

    // Enable foreign keys (disabled by default in SQLite)
    this.sqlite.exec("PRAGMA foreign_keys = ON;");

    // Synchronous mode for durability (FULL is safest, NORMAL is faster)
    this.sqlite.exec("PRAGMA synchronous = NORMAL;");

    // Increase cache size for better performance (default is -2000 KB)
    this.sqlite.exec("PRAGMA cache_size = -64000;"); // 64 MB
  }

  /**
   * Execute a transaction with enhanced logging and error handling
   *
   * @example
   * await db.transaction(async (tx) => {
   *   await tx.getClient().insert(users).values({ name: 'Alice' });
   *   await tx.getClient().insert(posts).values({ userId: 1, title: 'Hello' });
   * });
   */
  public async transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const start = performance.now();
    const isolationLevel = options?.isolationLevel ?? "immediate";

    try {
      const result = await this.withRetry(
        async () => {
          return this.db.transaction(async (bunTx) => {
            const tx = new Transaction(
              bunTx as TransactionClient,
              this.queryLogger,
              isolationLevel,
            );
            try {
              const result = await fn(tx);
              await tx.commit();
              return result;
            } catch (err) {
              await tx.rollback().catch(() => {}); // Ignore rollback errors
              throw err;
            }
          });
        },
        options?.maxRetries,
        options?.retryDelay,
      );

      const duration = performance.now() - start;
      this.queryLogger.logQuery("[TRANSACTION]", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.queryLogger.logQuery("[TRANSACTION FAILED]", duration);
      throw this.wrapError(err, "Transaction failed");
    }
  }

  /**
   * Wrap database errors with typed error classes
   */
  private wrapError(err: unknown, context: string): DatabaseError {
    return parseSQLiteError(err, context);
  }

  /**
   * Auto-retry for SQLITE_BUSY errors
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts?: number,
    delayMs?: number,
  ): Promise<T> {
    const attempts = maxAttempts ?? this.retryConfig.maxAttempts;
    const delay = delayMs ?? this.retryConfig.delayMs;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);

        // Only retry on SQLITE_BUSY errors
        if (
          message.includes("SQLITE_BUSY") ||
          message.includes("database is locked")
        ) {
          if (attempt < attempts) {
            await new Promise((resolve) =>
              setTimeout(resolve, delay * attempt),
            );
            continue;
          }
        }

        // Non-retryable error or max attempts reached
        throw err;
      }
    }

    throw lastError;
  }

  /**
   * Get query metrics
   */
  public getQueryMetrics(): Map<string, QueryMetrics> {
    return this.queryLogger.getMetrics();
  }

  /**
   * Get query metrics summary
   */
  public getQuerySummary() {
    return this.queryLogger.getSummary();
  }

  /**
   * Get slowest queries
   */
  public getSlowestQueries(limit = 10) {
    return this.queryLogger.getSlowestQueries(limit);
  }

  /**
   * Get most frequent queries
   */
  public getMostFrequentQueries(limit = 10) {
    return this.queryLogger.getMostFrequentQueries(limit);
  }

  /**
   * Reset query metrics
   */
  public resetMetrics(): void {
    this.queryLogger.resetMetrics();
  }

  /**
   * Get QueryLogger instance
   */
  public getLogger(): QueryLogger {
    return this.queryLogger;
  }

  /**
   * Get workspace repository
   */
  get workspaces(): WorkspaceRepository {
    if (!this._workspaces) {
      this._workspaces = new WorkspaceRepository(this.db, this.queryLogger);
    }
    return this._workspaces;
  }

  /**
   * Get project repository
   */
  get projects(): ProjectRepository {
    if (!this._projects) {
      this._projects = new ProjectRepository(this.db, this.queryLogger);
    }
    return this._projects;
  }

  get designs(): DesignRepository {
    if (!this._designs) {
      this._designs = new DesignRepository(this.db, this.queryLogger);
    }
    return this._designs;
  }

  /**
   * Get chat repository
   */
  get chats(): ChatRepository {
    if (!this._chats) {
      this._chats = new ChatRepository(this.db, this.queryLogger);
    }
    return this._chats;
  }

  /**
   * Get message repository
   */
  get messages(): MessageRepository {
    if (!this._messages) {
      this._messages = new MessageRepository(this.db, this.queryLogger);
    }
    return this._messages;
  }

  /**
   * Get task repository
   */
  get tasks(): TaskRepository {
    if (!this._tasks) {
      this._tasks = new TaskRepository(this.db, this.queryLogger);
    }
    return this._tasks;
  }

  /**
   * Get task chunk repository
   */
  get taskChunks(): TaskChunkRepository {
    if (!this._taskChunks) {
      this._taskChunks = new TaskChunkRepository(this.db, this.queryLogger);
    }
    return this._taskChunks;
  }

  get taskToolEvents(): TaskToolEventRepository {
    if (!this._taskToolEvents) {
      this._taskToolEvents = new TaskToolEventRepository(
        this.db,
        this.queryLogger,
      );
    }
    return this._taskToolEvents;
  }

  get fileBlobs(): FileBlobRepository {
    if (!this._fileBlobs) {
      this._fileBlobs = new FileBlobRepository(this.db, this.queryLogger);
    }
    return this._fileBlobs;
  }

  get fileRecords(): FileRepository {
    if (!this._fileRecords) {
      this._fileRecords = new FileRepository(this.db, this.queryLogger);
    }
    return this._fileRecords;
  }

  get fileVersions(): FileVersionRepository {
    if (!this._fileVersions) {
      this._fileVersions = new FileVersionRepository(this.db, this.queryLogger);
    }
    return this._fileVersions;
  }

  get uploadSessions(): UploadSessionRepository {
    if (!this._uploadSessions) {
      this._uploadSessions = new UploadSessionRepository(this.db, this.queryLogger);
    }
    return this._uploadSessions;
  }

  get retentionPolicies(): FileRetentionPolicyRepository {
    if (!this._retentionPolicies) {
      this._retentionPolicies = new FileRetentionPolicyRepository(this.db, this.queryLogger);
    }
    return this._retentionPolicies;
  }

  /**
   * Get provider API key repository
   */
  get providerApiKeys(): ProviderApiKeyRepository {
    if (!this._providerApiKeys) {
      this._providerApiKeys = new ProviderApiKeyRepository(
        this.db,
        this.queryLogger,
      );
    }
    return this._providerApiKeys;
  }

  get providers(): ProviderRepository {
    if (!this._providers) {
      this._providers = new ProviderRepository(this.db, this.queryLogger);
    }
    return this._providers;
  }

  get folders(): FolderRepository {
    if (!this._folders) {
      this._folders = new FolderRepository(this.db, this.queryLogger);
    }
    return this._folders;
  }

  get favorites(): FavoriteRepository {
    if (!this._favorites) {
      this._favorites = new FavoriteRepository(this.db, this.queryLogger);
    }
    return this._favorites;
  }

  get tags(): TagRepository {
    if (!this._tags) {
      this._tags = new TagRepository(this.db, this.queryLogger);
    }
    return this._tags;
  }

  get bookmarks(): BookmarkRepository {
    if (!this._bookmarks) {
      this._bookmarks = new BookmarkRepository(this.db, this.queryLogger);
    }
    return this._bookmarks;
  }

  get usageRecords(): UsageRecordRepository {
    if (!this._usageRecords) {
      this._usageRecords = new UsageRecordRepository(this.db, this.queryLogger);
    }
    return this._usageRecords;
  }

  get usageBudgets(): UsageBudgetRepository {
    if (!this._usageBudgets) {
      this._usageBudgets = new UsageBudgetRepository(this.db, this.queryLogger);
    }
    return this._usageBudgets;
  }

  get mentions(): MentionRepository {
    if (!this._mentions) {
      this._mentions = new MentionRepository(this.db);
    }
    return this._mentions;
  }

  get contentEditSnapshots(): ContentEditSnapshotRepository {
    if (!this._contentEditSnapshots) {
      this._contentEditSnapshots = new ContentEditSnapshotRepository(this.db, this.queryLogger);
    }
    return this._contentEditSnapshots;
  }

  get contentEditLocks(): ContentEditLockRepository {
    if (!this._contentEditLocks) {
      this._contentEditLocks = new ContentEditLockRepository(this.db, this.queryLogger);
    }
    return this._contentEditLocks;
  }

  get mcpServers(): McpServerRepository {
    if (!this._mcpServers) {
      this._mcpServers = new McpServerRepository(this.db, this.queryLogger);
    }
    return this._mcpServers;
  }

  public getModuleHandle(moduleId: string): ModuleDbHandle {
    return new ModuleDbHandle(moduleId, this.db, this.queryLogger);
  }

  /**
   * Close database connection
   * Should be called on application shutdown
   */
  public close(): void {
    if (this.sqlite) {
      this.sqlite.close();
    }
  }

  /**
   * Get database file path
   */
  public getFilePath(): string {
    return this.config.filePath;
  }

  /**
   * Check if database file exists
   */
  public fileExists(): boolean {
    try {
      return Bun.file(this.config.filePath).size > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Initialize database with configuration from environment
 *
 * @param customConfig - Optional custom configuration
 * @returns DatabaseAccess instance
 */
export function initializeDatabase(
  customConfig?: Partial<DatabaseConfig>,
): DatabaseAccess {
  const defaultPath = process.env.DB_FILE_PATH
    ? process.env.DB_FILE_PATH
    : process.env.APP_DATA_DIR
      ? `${process.env.APP_DATA_DIR}/OpenPCB.db`
      : "./data/OpenPCB.db";

  const config: DatabaseConfig = {
    filePath: defaultPath,
    logger: process.env.NODE_ENV === "development",
    options: {
      enableWAL: true,
      busyTimeout: 5000,
    },
    ...customConfig,
  };

  return DatabaseAccess.getInstance(config);
}

/**
 * Get database instance (throws if not initialized)
 *
 * @example
 * const db = getDb();
 * const results = await db.query.users.findMany();
 */
export function getDb(): BunSQLiteDatabase<typeof schema> {
  if (!DatabaseAccess.isInitialized()) {
    throw new Error(
      "DatabaseAccess not initialized. Call initializeDatabase() first.",
    );
  }
  return DatabaseAccess.getInstance().getDb();
}

// Export schema for external use
export { schema };
export type { BunSQLiteDatabase };
