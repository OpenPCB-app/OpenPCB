# Transport Layer

HTTP/WebSocket server using Hono framework.

## Structure

```
transport/
├── controllers/   # Route handlers (one per domain)
├── router/        # Route registration, core-router
├── middleware/    # Auth, logging, error handling
├── http/          # HTTP utilities
└── ws/            # WebSocket handlers
```

## Controllers

Each controller = one domain, mounted on router:

```typescript
// controllers/project.controller.ts
export const projectController = new Hono()
  .get("/", listProjects)
  .get("/:id", getProject)
  .post("/", createProject);

// router/core-router.ts
app.route("/api/projects", projectController);
```

## Adding Routes

1. Create/edit controller in `controllers/`
2. Define route handlers with typed request/response
3. Mount on `core-router.ts`
4. Run `npm run gen:openapi` to update OpenAPI spec
5. Run `npm run gen:sdk:orval` to regenerate React client

## Middleware Stack

Applied in order:

1. `cors` - CORS headers
2. `requestId` - Adds X-Request-ID
3. `logger` - Request logging
4. `errorHandler` - Catch-all error response
5. `auth` - JWT validation (protected routes)

## WebSocket

Real-time updates via `ws/`:

- Task progress streaming
- AI chat streaming
- Design sync (planned)

## Request Validation

Use Zod schemas:

```typescript
const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

app.post("/", zValidator("json", createProjectSchema), handler);
```

## Response Types

Generated TypeScript types from OpenAPI:

```typescript
// src-react/src/generated/api/
import type { Project } from "@/generated/api";
```

## core-router.ts

Main entry point (2500+ lines). Contains:

- All route registrations
- OpenAPI spec generation
- Health check endpoint

## Anti-Patterns

- **Don't** put business logic in controllers (use domain services)
- **Don't** skip validation (use Zod)
- **Don't** forget to regenerate SDK after route changes
- **Don't** return raw errors (use error middleware format)
