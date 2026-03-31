# AI Elements — Chat UI Components

32 specialized components for high-fidelity chat experiences: markdown rendering, file handling, @mentions, and streaming UI.

## Overview
Complex chat interface built on `shadcn/ui` primitives, implementing the "Messenger" design pattern with advanced AI capabilities.

## Where to Look

| Component | File | Responsibility |
|-----------|------|----------------|
| **Message** | `message.tsx` | Compound component: Content, Actions, Pagination |
| **Prompt** | `prompt-input.tsx` | Auto-resize, drag-drop, paste, @mentions |
| **Reasoning** | `reasoning.tsx` | Collapsible "thought" blocks for CoT models |
| **Code Block** | `code-block.tsx` | Syntax highlighting, copy-to-clipboard |
| **Mentions** | `MentionAutocomplete.tsx` | Floating entity picker (@agent, @file) |
| **Artifacts** | `artifact.tsx` | Side-panel content rendering (SVGs, code) |

## Component Patterns

### Compound Components
- **Message**: `Message` (root) > `MessageContent` > `MessageActions`.
- Uses `ButtonGroup` and `Tooltip` primitives for consistent action bars.
- Supports multi-turn rendering via `BranchSelectorPopover`.

### Render Props & Composition
- Built strictly on `src-react/src/components/ui/` primitives.
- **Composition**: `prompt-input.tsx` composes `Textarea`, `Button`, and `MentionAutocomplete`.
- **Validation**: File attachments validated in-component (size, type) before upload.

## Conventions

- **State Management**: Local state for drafts/attachments; global state for history.
- **Ref Handling**: `textareaRef` forwarded for external focus control (Cmd+L).
- **Styling**: `is-user` / `is-assistant` classes on parent for context-aware styling.
- **Markdown**: Handled via `Streamdown` in `message.tsx` for partial token rendering.

## Prompt Input Features
- **File Handling**: Recursive drag-drop + clipboard paste (images/text).
- **Mentions**: Triggered by `@` using `useMentions` hook.
- **Streaming**: `status` prop (streaming/submitting) toggles Stop/Send icon.
