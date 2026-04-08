# Domain Layer

Business logic following DDD patterns. Provider-agnostic, framework-agnostic.

## Structure

```
domain/
├── services/     # Business logic services
├── mappers/      # Entity ↔ DTO transformations
├── utils/        # Domain utilities
└── constants.ts  # Domain constants
```

## Services Directory

Key services in `services/`:

| Service              | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `queue/`             | Task execution queue (provider-agnostic) |
| `tools/`             | AI tool system (function calling)        |
| `content-editor/`    | Block-based content editing              |
| `ai-chat/`           | Chat session management                  |
| `component-library/` | Component CRUD                           |
| `project/`           | Project management                       |

See `services/tools/AGENTS.md` and `services/queue/AGENTS.md` for details.

## Service Pattern

Services are injected via DI container:

```typescript
class ProjectService {
  constructor(
    private projectRepo: ProjectRepository,
    private eventBus: EventBus,
  ) {}

  async createProject(dto: CreateProjectDto): Promise<Project> {
    // Business logic here
  }
}
```

## Mappers

Transform between layers:

```typescript
// mappers/project.mapper.ts
export function toProjectDto(entity: ProjectEntity): ProjectDto {
  return { id: entity.id, name: entity.name };
}
```

## DDD Principles

1. **Services** contain business rules
2. **Repositories** (in `db/`) handle persistence
3. **Controllers** (in `transport/`) handle HTTP
4. **Mappers** convert between representations

## Anti-Patterns

- **Don't** import from `transport/` or `infrastructure/`
- **Don't** use framework-specific types (Hono, React)
- **Don't** access database directly (use repositories)
- **Don't** throw HTTP-specific errors (use domain errors)

## Testing

Services tested in isolation:

```typescript
const service = new ProjectService(mockRepo, mockEventBus);
const result = await service.createProject({ name: "Test" });
```
