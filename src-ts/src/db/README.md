# Database Layer - Drizzle ORM with bun:sqlite

This directory contains the database access layer for the OpenPCB Bun TypeScript sidecar.

## Architecture

```
src-ts/src/db/
├── schema/           # Drizzle ORM schema definitions
│   └── index.ts     # Schema exports (currently empty)
├── index.ts         # DatabaseAccess singleton
├── migrate.ts       # Migration runner
└── README.md        # This file

src-ts/drizzle/
└── migrations/      # Generated migration files
```

## Configuration

### Environment Variables

```env
# .env file
DB_FILE_PATH=./data/OpenPCB.db  # SQLite database file path
NODE_ENV=development              # Enable query logging in dev
```

### Drizzle Config

See `drizzle.config.ts` in project root:

```typescript
export default defineConfig({
  dialect: 'sqlite',
  schema: './src-ts/src/db/schema',
  out: './src-ts/drizzle/migrations',
  dbCredentials: {
    url: process.env.DB_FILE_PATH || './data/OpenPCB.db',
  },
});
```

## Usage

### Initialize Database

```typescript
import { initializeDatabase, getDb } from './db';

// On startup
const dbAccess = initializeDatabase();

// Later, anywhere in the app
const db = getDb();
const results = await db.query.someTable.findMany();
```

### Run Migrations

**Programmatically:**
```typescript
import { runMigrationsIfNeeded } from './db/migrate';

await runMigrationsIfNeeded();
```

**Via CLI:**
```bash
npm run db:migrate    # Apply pending migrations
npm run db:generate   # Generate migration from schema changes
npm run db:push       # Push schema directly (dev only, no migrations)
npm run db:studio     # Open Drizzle Studio GUI
```

### Transactions

```typescript
const db = getDb();

await db.transaction(async (tx) => {
  await tx.insert(users).values({ name: 'Alice' });
  await tx.insert(posts).values({ userId: 1, title: 'Hello' });
  // Automatically rolled back on error
});
```

## Schema Definition

Schemas are defined in `schema/` directory and exported from `schema/index.ts`.

**Example schema file (schema/users.ts):**
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

**Export from schema/index.ts:**
```typescript
export * from './users';
export * from './projects';
// etc...
```

## Migration Workflow

1. **Define schema** in `schema/` directory
2. **Generate migration**: `npm run db:generate`
3. **Review migration** in `drizzle/migrations/`
4. **Apply migration**: `npm run db:migrate`

### Development Shortcuts

For rapid iteration (no migration tracking):
```bash
npm run db:push
```

This directly pushes schema changes to the database without creating migration files.

## SQLite Configuration

The DatabaseAccess class automatically configures SQLite for optimal performance:

- **WAL mode**: Write-Ahead Logging for better concurrency
- **Foreign keys**: Enabled (disabled by default in SQLite)
- **Busy timeout**: 5 seconds (prevents immediate SQLITE_BUSY errors)
- **Cache size**: 64 MB for better query performance
- **Synchronous mode**: NORMAL (balance between durability and speed)

## Database Location

Default paths (in priority order):
1. `DB_FILE_PATH` env var
2. `${APP_DATA_DIR}/OpenPCB.db` (set by Rust layer)
3. `./data/OpenPCB.db` (fallback)

## Singleton Pattern

DatabaseAccess uses singleton pattern to ensure single connection per process:

```typescript
// First call requires config
DatabaseAccess.getInstance({ filePath: './db.sqlite' });

// Subsequent calls reuse instance
DatabaseAccess.getInstance(); // ✓

// Reset for testing
DatabaseAccess.reset();
```

## Type Safety

Drizzle provides full TypeScript inference:

```typescript
const db = getDb();

// Fully typed results
const users = await db.query.users.findMany({
  where: (users, { eq }) => eq(users.email, 'test@example.com'),
  with: {
    posts: true, // Relational queries
  },
});

// users is typed as: Array<{ id: string, name: string, ... }>
```

## Drizzle Studio

Visual database browser:

```bash
npm run db:studio
```

Opens browser at `https://local.drizzle.studio` with live connection to your database.

## Best Practices

1. **Always use transactions** for multi-statement operations
2. **Define schemas in separate files** for maintainability
3. **Use migrations in production** (not `db:push`)
4. **Enable WAL mode** for better concurrency (enabled by default)
5. **Close connection on shutdown** via `DatabaseAccess.close()`

## Troubleshooting

### "Database locked" errors
- Check that only one process is accessing the database
- Increase busy timeout in DatabaseAccess config
- Ensure WAL mode is enabled

### Migration conflicts
- Run `npm run db:check` to verify migration integrity
- Use `npm run db:studio` to inspect current schema
- Manually resolve conflicts in migration files

### Type errors after schema changes
- Regenerate types: `npm run db:generate`
- Restart TypeScript server in your IDE

## References

- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Bun SQLite Adapter](https://orm.drizzle.team/docs/get-started/bun-sqlite-new)
- [Architecture Spec V3](../../../OpenPCB_Architecture_V3_Specification.md) - Part 7
