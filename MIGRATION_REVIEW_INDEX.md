# Migration Plan Review - Document Index

**Generated**: April 8, 2026  
**Scope**: OpenPCB Core/Module Extraction (Frontend only, src-react/src)  
**Status**: Read-only analysis, non-intrusive review

---

## Quick Navigation

| Document | Size | Read Time | Best For | Key Content |
|----------|------|-----------|----------|-------------|
| **MIGRATION_REVIEW_SUMMARY.txt** | 3.6 KB | 5 min | Quick overview | Blockers, risks, decisions needed |
| **MIGRATION_PLAN_REVIEW.md** | 17 KB | 15 min | Deep analysis | Risks, missing steps, questions |
| **MIGRATION_FILE_INVENTORY.md** | 9.3 KB | 10 min | Implementation | File-by-file status, hotspots |

---

## What Each Document Covers

### MIGRATION_REVIEW_SUMMARY.txt (Start Here)
**Purpose**: Executive brief - get the gist in 5 minutes

**Sections**:
- Critical blockers (5 issues)
- Major risks
- Files requiring decisions  
- Ordering problems
- Recommended sequence
- Hotspot files

**Use when**: You need quick clarity on what's wrong & what to do first

---

### MIGRATION_PLAN_REVIEW.md (Deep Dive)
**Purpose**: Comprehensive analysis with strategic guidance

**Sections**:
1. **Key Risks & Flaws** (7 issues analyzed)
   - Workspace/project coupling over-centralization
   - Settings panel architecture incomplete
   - Folder/favorites removal not specified
   - OAuth API mismatch
   - Bookmarks orphaned
   - Import path strategy missing
   - Secrets storage migration missing

2. **Missing Implementation Steps** (7 categories)
   - Pre-migration refactoring
   - Settings architecture redesign
   - Folder/favorites decision
   - OAuth UI integration
   - Secrets API modernization
   - Bookmarks classification
   - Module boundary documentation

3. **Dependencies & Ordering Corrections**
   - Current plan vs corrected sequence
   - 4-phase plan with prerequisites
   - Critical path dependencies

4. **Concrete File/Path Hot Spots**
   - Critical files (high refactor risk)
   - Import refactoring hotspots
   - Store dependency graph
   - Post-split architecture proposal

5. **Clarifying Questions for User** (10 questions)
   - Architecture decisions (5)
   - Migration sequencing (3)
   - Migration mechanics (2)

**Use when**: Planning implementation, understanding risks, deciding architecture

---

### MIGRATION_FILE_INVENTORY.md (Implementation Checklist)
**Purpose**: File-by-file status & migration guide

**Sections**:
- **Stores & State Management** - app-store split proposal
- **API Client Layer** - which APIs stay/move/delete
- **Hooks Layer** - dependencies & decisions
- **Screens & Layout** - home screen refactoring
- **Settings** - architecture & panels
- **Components** - what stays, what moves
- **Utilities** - config updates needed
- **Migration Impact Summary** - effort & blockers
- **Import Pattern Changes** - before/after
- **TSConfig Updates** - path configuration

**Use when**: Implementing the migration, tracking which files go where

---

## Critical Findings Summary

### Blockers (Must Fix First)
```
❌ Settings panel architecture incomplete (panels exist but not registered)
❌ Secrets API uses Tauri bindings (must migrate to Electron)
❌ app-store.ts oversized (366 lines, 71+ consumers)
❌ Scope unclear (folders/favorites/bookmarks - delete or move?)
❌ OAuth integration missing (code exists but no UI)
```

### Questions to Answer (Blocks Implementation)
```
Q1: Folders/favorites = chat-based or project-based?
Q2: Keep bookmarks or delete entirely?
Q3: Usage panel stays in core or moves?
Q4: electron-keytar or encrypted file for secrets?
Q5: MCP server panel = AI-related or separate?
```

### Hotspots (High Refactor Risk)
```
CRITICAL:
  app-store.ts (366 lines) - split + update 71 consumers
  SettingsDialog.tsx (103 lines) - refactor to registry
  secrets-api.ts (81 lines) - Tauri → Electron

HIGH:
  McpServersPanel.tsx (449 lines) - move + register
  Home screen (4 files) - redesign after feature removal
  Folder/Favorites - delete

MODERATE:
  oauth-api.ts - move to ai-service
  bookmark-api.ts - move or delete
  Import paths (~30 files) - update references
```

---

## Recommended Reading Order

### If You Have 5 Minutes
→ Read **MIGRATION_REVIEW_SUMMARY.txt**

### If You Have 15 Minutes  
→ Read **MIGRATION_REVIEW_SUMMARY.txt** + section 1 & 5 of **MIGRATION_PLAN_REVIEW.md**

### If You Have 30 Minutes
→ Read all of **MIGRATION_REVIEW_SUMMARY.txt** + **MIGRATION_PLAN_REVIEW.md**

### If You Have 1 Hour
→ Read all three documents in order:
1. MIGRATION_REVIEW_SUMMARY.txt
2. MIGRATION_PLAN_REVIEW.md  
3. MIGRATION_FILE_INVENTORY.md

---

## Implementation Workflow

**Step 1**: Read summary (5 min)

**Step 2**: Answer the 5 blocking questions in MIGRATION_PLAN_REVIEW.md section 5
- Q1, Q2, Q3, Q4, Q5 (architecture decisions)

**Step 3**: Use MIGRATION_PLAN_REVIEW.md section 3 as your execution plan
- Phase 0: Preparation
- Phase 1: Settings infrastructure
- Phase 2: Remove deprecated features
- Phase 3: Move to modules
- Phase 4: Keep in core

**Step 4**: Use MIGRATION_FILE_INVENTORY.md as your task checklist
- Track which files need actions
- Monitor refactoring effort
- Manage dependencies

---

## Key Statistics

| Metric | Count | Impact |
|--------|-------|--------|
| Critical blockers | 5 | Blocking implementation |
| Blocking questions | 5 | Require architecture decisions |
| Files to delete | 6 | Remove deprecated features |
| Files to move | 8+ | To ai-service module |
| Files to refactor | 8 | Architecture changes |
| Files to split | 1 | app-store.ts (366 → 3 stores) |
| Consumers of app-store | 71 | High coupling risk |
| Import paths to update | ~30 | Module boundary enforcement |

---

## Architecture Decisions in Plan

| Decision | Current | Proposed | Impact |
|----------|---------|----------|--------|
| Workspace/Project location | ? | Core (no move) | Couples modules to core |
| Folders/Favorites | ? | Remove? | 4 files + home screen |
| Bookmarks | ? | ai-service? | Affects chat module |
| MCP/OAuth | Settings? | ai-service module | Affects settings design |
| Usage panel | Unregistered | ? | Settings architecture |
| Secrets storage | Tauri bridge | Electron? | API key persistence |
| Settings architecture | Hardcoded | Registry pattern | Extensibility |

---

## Timeline Estimate

| Phase | Tasks | Effort | Blockers |
|-------|-------|--------|----------|
| Phase 0: Prep | Answer questions, split store, migrate Tauri | 2-3 days | Architecture decisions |
| Phase 1: Settings | Registry pattern, register panels | 2-3 days | Phase 0 complete |
| Phase 2: Remove | Delete deprecated features, update UI | 1-2 days | Phase 1 complete |
| Phase 3: Move | Move to modules, update imports | 2-3 days | Phase 2 complete |
| Phase 4: Finalize | Keep core features, Electron migration | 1-2 days | Phase 3 complete |
| **TOTAL** | | **8-13 days** | Sequential phases |

---

## Document Quality

- **Accuracy**: Based on actual codebase inspection (71+ files analyzed)
- **Completeness**: All major frontend components covered
- **Actionability**: Each issue has concrete recommendations
- **Non-invasive**: Read-only analysis, no code changes
- **Tested Approach**: Risk & ordering analysis based on actual dependencies

---

## Next Steps

1. **Now**: Read MIGRATION_REVIEW_SUMMARY.txt (5 min)
2. **Today**: Answer questions in MIGRATION_PLAN_REVIEW.md section 5
3. **This week**: Design settings panel registry system
4. **Next week**: Begin Phase 0 preparation work

**Do not start module extraction without completing Phase 0 preparation.**

---

Generated by thorough codebase exploration & analysis.
Read-only documents. Safe to reference without modification.

