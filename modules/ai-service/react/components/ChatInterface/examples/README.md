# ChatInterface Usage Examples

Copy-paste templates for common ChatInterface usage patterns.

## Examples

### MainChatExample
Full-featured main chat. Uses `ChatConfig` directly with tools, mentions, and dynamic empty state. See `src-react/src/layout/Home.tsx` for production usage.

### EmbeddedChatExample
Compact chat embedded in another component. Uses `createEmbeddedChat()` factory — no tools, no attachments, minimal layout.

### ProjectChatExample
Project-scoped chat with back button and project badge. Uses `createProjectChat()` factory. See `src-react/src/screens/ChatScreen.tsx` for production usage.

### ModuleChatExample
Module-embedded chat using `useModuleChat` hook for lazy initialization and auto chat creation. See `modules/brainstorming/react/components/NodeDetail.tsx` for production usage.

## Quick Reference

| Pattern | Preset/Factory | When to Use |
|---------|---------------|-------------|
| Direct config | None | Full control, dynamic values |
| `createEmbeddedChat()` | embedded | Compact inline chat |
| `createProjectChat()` | project | Project-scoped with badge |
| `createModuleChat()` | module | Module plugin chat |

## Config Structure

```typescript
<ChatInterface config={{
  messages, status, modelName,    // Data
  ui: { placeholder, emptyState },  // Visual
  features: { tools, mentions },    // Capabilities
  context: { chatId, workspaceId }, // Identifiers
  behavior: { onSubmit, onStop },   // Callbacks
}} />
```
