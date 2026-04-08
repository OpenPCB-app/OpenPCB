# Database Layer

Drizzle ORM with bun:sqlite. See `README.md` for full documentation.

## Structure

```
db/
├── schema/        # Drizzle table definitions
├── repositories/  # Data access objects (DAO pattern)
├── seed/          # Initial data seeding
├── decorators/    # TypeScript decorators for repos
├── helpers/       # Query utilities
├── migrations.*.test.ts  # Migration tests
├── index.ts       # DatabaseAccess singleton
├── migrate.ts     # Migration runner
└── transaction.ts # Transaction helpers
```

## Schema Definition

Define in `schema/`, export from `schema/index.ts`:

```typescript
// schema/projects.ts
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

## Repository Pattern

Repositories in `repositories/` wrap Drizzle queries:

```typescript
class ProjectRepository {
  constructor(private db: DrizzleInstance) {}

  findById(id: string) {
    return this.db.query.projects.findFirst({ where: eq(projects.id, id) });
  }
}
```

## Commands

```bash
npm run db:generate  # Generate migration from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:push      # Push schema directly (dev only)
npm run db:studio    # Open Drizzle Studio GUI
```

## SQLite Config

Auto-configured for performance:

- WAL mode (Write-Ahead Logging)
- Foreign keys enabled
- 5s busy timeout
- 64MB cache

## Testing

Colocated tests use isolated test databases:

```typescript
// *.test.ts
beforeEach(() => {
  DatabaseAccess.reset();
  initializeDatabase({ filePath: ":memory:" });
});
```

## Anti-Patterns

- **Don't** use `db:push` in production
- **Don't** skip transactions for multi-statement ops
- **Don't** access DatabaseAccess directly from controllers (use DI)
- **Don't** forget to export new schemas from `schema/index.ts`
