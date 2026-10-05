# docs — QA findings

[← index](../README.md) · 24 triage entries · S1 3 · S2 7 · S3 13 · S4 1

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-360](#t-360) | S1 | Title save wipes unsaved body text typed in the same second (editor reset to stale server content) | Q9-001 | fix-now | K1 / W2 | frontend | S |
| [T-361](#t-361) | S1 | App white-screens when opening a text page after a PDF page or after deleting the open page (FixedToolbar uses destroyed Tiptap editor) | Q9-008 | fix-now | K1 / W2 | frontend | S |
| [T-362](#t-362) | S1 | Undo after switching pages pastes the previous page's content into the current page and autosaves it (history shared across pages) | Q9-028 | fix-now | K1 / W2 | frontend | S |
| [T-363](#t-363) | S2 | Page title edits are silently dropped when switching page or leaving Docs within 1 s; no save feedback for titles | Q9-002 | fix-now | K1 / W2 | frontend | S |
| [T-364](#t-364) | S2 | Docs page tree doesn't refresh after New/Add subpage/Delete/move (two racing tree instances) | Q9-003, F1D-007 | fix-now | K1 / W2 | frontend | S |
| [T-365](#t-365) | S2 | Page tree order is scrambled: tree sorts order keys with localeCompare but keys are ASCII base62 | Q9-004 | decide (DEC-K) | K1 / W2 | backend | XS |
| [T-366](#t-366) | S2 | Single click on a link in the editor opens it in a new window (duplicate Link extension overrides openOnClick:false) | Q9-009 | fix-now | K1 / W2 | frontend | XS |
| [T-367](#t-367) | S2 | Failed body save shows a bare 'Error' pill, never retries, and the edit is silently discarded on page switch | Q9-011 | fix-now | K1 / W2 | frontend | M |
| [T-368](#t-368) | S2 | Docs failures are silent or show raw codes: import/create/delete/move errors only console.error; tree error shows 'HTTP_500' in raw red | Q9-012 | fix-now | K1 / W2 | frontend | S |
| [T-369](#t-369) | S2 | Docs page delete uses native window.confirm (tree + editor), doesn't mention subpages that are deleted too, and offers no undo | Q9-025 | fix-now | K1 / W2 | frontend | S |
| [T-370](#t-370) | S3 | Docs page tree is unreadable past ~5 levels: titles collapse to 1–3 characters in the fixed 260px sidebar, with no tooltip or resize | F1D-005 | fix-now | K1 / W2 | frontend | S |
| [T-371](#t-371) | S3 | Docs breadcrumbs truncate parents and meta line wraps into columns (1100 & 1440) | F1D-006, Q9-020 | fix-now | K1 / W2 | frontend | S |
| [T-372](#t-372) | S3 | Editor toolbar active/disabled states go stale (Bold stays highlighted outside bold text; Undo/Redo lag) | Q9-005 | fix-now | K1 / W2 | frontend | S |
| [T-373](#t-373) | S3 | Task list renders broken: bullet + checkbox on one line, item text on the next | Q9-006 | fix-now | K1 / W2 | frontend | XS |
| [T-374](#t-374) | S3 | Docs/Tasks on raw palette: Typography gray (blue cast), literal backticks around inline code, raw slate/violet/red | Q9-007, Q9-016 | fix-now | K1 / W2 | frontend | S |
| [T-375](#t-375) | S3 | Link dialog: Save with a collapsed caret silently does nothing; Esc drops focus to <body>; Remove always shown | Q9-010 | fix-now | K1 / W2 | frontend | S |
| [T-376](#t-376) | S3 | Docs page tree is not keyboard operable: rows unfocusable, chevrons nameless, row actions focusable while invisible, ghost buttons show no focus | Q9-013 | fix-now | K1 / W2 | frontend | M |
| [T-377](#t-377) | S3 | Editor meta line is stale: word count carries over from the previous page and 'edited Xm ago' never updates after saves | Q9-014 | fix-now | K1 / W2 | frontend | XS |
| [T-378](#t-378) | S3 | Docs search field is a 32px hand-rolled input (kit search fields are 22px in a 34px header) | Q9-015 | fix-now | K1 / W2 | frontend | XS |
| [T-379](#t-379) | S3 | Docs forgets the open page and tree expansion when leaving the module or reloading; search results don't reveal nested pages | Q9-018 | fix-now | K1 / W2 | frontend | S |
| [T-380](#t-380) | S3 | Docs search only matches titles — body text and imported .md/.txt content are not searchable | Q9-019 | defer | K1 / followup | backend | M |
| [T-381](#t-381) | S3 | Clearing a page title saves an empty title: tree shows a blank, unlabeled row; Enter in the title does nothing | Q9-024 | fix-now | K1 / W2 | frontend | XS |
| [T-382](#t-382) | S3 | Merely opening a page (first after load / new page) writes it back: spurious PATCH bumps revision and 'edited' time | Q9-026 | fix-now | K1 / W2 | frontend | S |
| [T-383](#t-383) | S4 | Docs layout ignores shell metrics: no 34px module header, 36px tree rows, inverted surfaces, misaligned header borders, 3 'New page' CTAs | Q9-017 | fix-now | K1 / W2 | frontend | M |

## T-360

**Title save wipes unsaved body text typed in the same second (editor reset to stale server content)**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-001

**Summary.** When PATCH /meta returns (~1 s) PageEditor calls onPageChange(updated) and the SSE meta_updated event triggers refreshPage(); both replace page.content_json with the server copy, and TiptapEditor's initialContent effect calls setContent() with it, wiping the new paragraph and the first 11 characters ('\nabcdefghijk'). Remaining keystrokes land in the stale paragraph. Final saved content: 'Body text that should persi…

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:161` — onPageChange(updated) replaces page (incl. stale content_json) after a title-only save

**Proposed fix.** Title save must not reset editor content; merge server response only for title/meta. — Detail: PageEditor.tsx:157-162: after a title save merge only title/updated_at (mutatePage(p => p && ({...p, title: updated.title, updated_at: updated.updated_at}))) instead of onPageChange(updated). Space.tsx:34-51: ignore 'meta_updated' for the open page (or send X-Request-Id on the meta PATCH and publish it in routes.ts:295 like content_updated) and defer refreshPage() while the autosave has pending/unsaved content. TiptapEditor.tsx:65-82: only push initialContent into the editor when the page id changes (see Q9-028 ke…

**Evidence.** `network: #321 PATCH /pages/d76ea8b4…/meta 200`

<details><summary>Q9-001 — Title save wipes unsaved body text typed in the same second (editor reset to stale server content) (S1, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > open any tiptap page (e.g. QA-q9 'Untitled' d76ea8b4)
  2. Click the title input, type 'Race' (title save debounced 1000 ms)
  3. Immediately click the body, press Enter and keep typing 'abcdefghijklmnopqrstuvwxyz0123456789' at ~90 ms/key
  4. Wait 3 s and read the body / GET the page
- Expected: Everything typed in the body is kept; a title save never touches body content
- Actual: When PATCH /meta returns (~1 s) PageEditor calls onPageChange(updated) and the SSE meta_updated event triggers refreshPage(); both replace page.content_json with the server copy, and TiptapEditor's initialContent effect calls setContent() with it, wiping the new paragraph and the first 11 characters ('\nabcdefghijk'). Remaining keystrokes land in the stale paragraph. Final saved content: 'Body text that should persist ZZZlmnopqrstuvwxyz0123456789' (paragraph break + 'abcdefghijk' lost).
- Network: `#321 PATCH /pages/d76ea8b4…/meta 200`; `#322 GET /pages/d76ea8b4… 200 (SSE-triggered refresh while body edits unsaved)`; `#325 PATCH /pages/d76ea8b4…/content 200 (saves the truncated text)`
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:161` — onPageChange(updated) replaces page (incl. stale content_json) after a title-only save
- Code: `src/modules/knowledge/frontend/Space.tsx:44` — meta_updated SSE event without requestId -> refreshPage() while idle
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:65` — any initialContent change != editor JSON -> setContent(), discarding local edits
- Code: `src/modules/knowledge/backend/routes.ts:295` — meta_updated published without requestId, so the editor's own title save echoes back as a refresh
- Code: `src/modules/knowledge/frontend/Space.tsx:21` — authorityModeRef is never set away from 'idle' — every SSE event for the open page refreshes it mid-typing
- Suggested fix: PageEditor.tsx:157-162: after a title save merge only title/updated_at (mutatePage(p => p && ({...p, title: updated.title, updated_at: updated.updated_at}))) instead of onPageChange(updated). Space.tsx:34-51: ignore 'meta_updated' for the open page (or send X-Request-Id on the meta PATCH and publish it in routes.ts:295 like content_updated) and defer refreshPage() while the autosave has pending/unsaved content. TiptapEditor.tsx:65-82: only push initialContent into the editor when the page id changes (see Q9-028 keying) or for a remote content_updated with no local pending edit.
- Verification (vq9): **confirmed** — Reproduced on stack A (own QA-q9-parent d76ea8b4) with a scripted run-code: typed 'X' in the title, clicked the body, Enter + 'abcdefghijklmnopqrstuvwxyz0123456789' at 90 ms/key. Result exactly as reported: the new paragraph and 'abcdefghijk' vanished, the rest was appended to the old paragraph and autosaved (server text '...0123456789lmnopqrstuvwxyz0123456789'). Root cause verified in code: PageEditor.tsx:161 onPageChange(updated) replaces the page (incl. stale content_json); backend routes.ts:295 publishes meta_updated WITHOUT requestId, so Space.tsx:44 also calls refreshPage() (authorityModeRef is never set to anything but 'idle', so every SSE event for the open page refreshes it — the same wipe happens when the assistant/MCP edits the page while the user types); TiptapEditor.tsx:65-82 then setContent()s the stale JSON. Not an environment artefact (no StrictMode, main.tsx). Page restored via API afterwards. S1 kept: silent loss of typed text in the common rename-then-write flow. · evidence: verify: run-code result 'Body text that should persist ZZZlmnopqrstuvwxyz0123456789lmnopqrstuvwxyz0123456789', GET /pages/d76ea8b4 after run: title 'QA-q9-parentX', paragraph break + 'abcdefghijk' lost

</details>


## T-361

**App white-screens when opening a text page after a PDF page or after deleting the open page (FixedToolbar uses destroyed Tiptap editor)**

- Severity **S1** · category crash · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-008 · known ref K01

**Summary.** Entire app goes blank (#root innerHTML length 0, playwright snapshot empty) in both paths. Console: 'TypeError: Cannot read properties of null (reading \'can\') at FixedToolbar (FixedToolbar.tsx:70)' + 'An error occurred in the <FixedToolbar> component'. Reload required. Also reproduced during exploration after deleting a page and opening a search result. Reproduced in light theme too (QA-q9-sample-md -> QA-q9-sampl…

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:67` — editor kept in state; never reset when TiptapEditor unmounts/destroys it

**Proposed fix.** FixedToolbar guards destroyed editor (key by page, null-check editor.isDestroyed). — Detail: TiptapEditor.tsx:90-94: in the destroy cleanup also call onReady(null) (widen the prop to Editor|null) — or in PageEditor setEditor(null) whenever pageId changes, page is null or pdfData is set; guard PageEditor.tsx:326 and :357 with `editor && !editor.isDestroyed`. Add an error boundary around ModuleSpaceHost spaces (K01) so a module render error cannot blank the whole app.

**Evidence.** [022-crash-pdf-to-text](../evidence/shots/q9/dark/022-crash-pdf-to-text.png), [003-crash-pdf-to-text](../evidence/shots/vq9/dark/003-crash-pdf-to-text.png)

<details><summary>Q9-008 — App white-screens when opening a text page after a PDF page or after deleting the open page (FixedToolbar uses destroyed Tiptap editor) (S1, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Path A (most common): Docs > open any text page (e.g. QA-q9-sample-txt), then click a PDF page (QA-q9-sample-pdf) — viewer renders — then click any text page again
  2. Path B: open QA-q9-B, click editor header '+' (New page), click 'Delete page' and accept the confirm, then click QA-q9-B in the tree
- Expected: QA-q9-B opens normally
- Actual: Entire app goes blank (#root innerHTML length 0, playwright snapshot empty) in both paths. Console: 'TypeError: Cannot read properties of null (reading \'can\') at FixedToolbar (FixedToolbar.tsx:70)' + 'An error occurred in the <FixedToolbar> component'. Reload required. Also reproduced during exploration after deleting a page and opening a search result. Reproduced in light theme too (QA-q9-sample-md -> QA-q9-sample-pdf -> QA-q9-B: #root length 0).
- Screenshots: [022-crash-pdf-to-text](../evidence/shots/q9/dark/022-crash-pdf-to-text.png), [017-crash-after-editor-delete](../evidence/shots/q9/dark/017-crash-after-editor-delete.png), [016-crash-white-screen](../evidence/shots/q9/dark/016-crash-white-screen.png), [012-crash-pdf-to-text](../evidence/shots/q9/light/012-crash-pdf-to-text.png), [003-crash-pdf-to-text](../evidence/shots/vq9/dark/003-crash-pdf-to-text.png), [003-crash-pdf-to-text](../evidence/shots/vq9/light/003-crash-pdf-to-text.png)
- Console: `TypeError: Cannot read properties of null (reading 'can') at FixedToolbar (src/modules/knowledge/frontend/components/Editor/FixedToolbar.tsx:70:27)`; `An error occurred in the <FixedToolbar> component. Consider adding an error boundary…`
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:67` — editor kept in state; never reset when TiptapEditor unmounts/destroys it
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:326` — {editor && !pdfData && <FixedToolbar editor={editor}/>} renders with the destroyed instance while the next page loads
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:90` — cleanup editor.destroy() without notifying parent
- Suggested fix: TiptapEditor.tsx:90-94: in the destroy cleanup also call onReady(null) (widen the prop to Editor|null) — or in PageEditor setEditor(null) whenever pageId changes, page is null or pdfData is set; guard PageEditor.tsx:326 and :357 with `editor && !editor.isDestroyed`. Add an error boundary around ModuleSpaceHost spaces (K01) so a module render error cannot blank the whole app.
- Verification (vq9): **confirmed** — Reproduced Path A in both themes (dark: txt→pdf→QA-q9-B; light: B→pdf→sample-md) and Path B in dark (editor 'Delete page' + accept → click QA-q9-B): #root innerHTML length 0, console 'TypeError: Cannot read properties of null (reading 'can') at FixedToolbar (FixedToolbar.tsx:70)'. Not a dev artefact: no StrictMode (main.tsx renders <App/> directly) and no error boundary (K01). Mechanism: the TiptapEditor unmounts (PDF branch / no-page branch) and destroys its editor (TiptapEditor.tsx:90-94) but PageEditor keeps it in state (:67); on the next text page render `editor && !pdfData` (:326) renders FixedToolbar with the destroyed instance before the new editor's onCreate. · evidence: [003-crash-pdf-to-text](../evidence/shots/vq9/dark/003-crash-pdf-to-text.png), [003-crash-pdf-to-text](../evidence/shots/vq9/light/003-crash-pdf-to-text.png), console: TypeError: Cannot read properties of null (reading 'can') at FixedToolbar (FixedToolbar.tsx:70:27)

</details>


## T-362

**Undo after switching pages pastes the previous page's content into the current page and autosaves it (history shared across pages)**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-028

**Summary.** First Cmd+Z replaces the txt page body with the md page's content ('QA sample / Some markdown text. / item 1 / item 2 / mdedit'); second Cmd+Z undoes 'mdedit'. Autosave then PATCHes that into QA-q9-sample-txt: its stored content is now the markdown document — original text 'Plain text QA sample.' overwritten. The same Tiptap instance is reused across pages and setContent() is recorded in history. (QA page restored a…

**Root cause.** `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:72` — setContent(newData, { emitUpdate:false }) on page switch — goes into the undo stack

**Proposed fix.** Per-page editor instance/history (key editor by page id) — undo never crosses pages. — Detail: PageEditor.tsx:347: <TiptapEditor key={page.id} …/> for a fresh editor + history per page — but this MUST land together with the Q9-008 fix (setEditor(null)/isDestroyed guard), otherwise FixedToolbar renders with the destroyed previous editor on every switch. Alternative without remount: on switch replace the state via editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins })) which drops history. Add a regression test: switch page, Cmd+Z leaves content unchanged.

**Evidence.** [015-undo-cross-page](../evidence/shots/q9/light/015-undo-cross-page.png), [004-undo-cross-page](../evidence/shots/vq9/dark/004-undo-cross-page.png)

<details><summary>Q9-028 — Undo after switching pages pastes the previous page's content into the current page and autosaves it (history shared across pages) (S1, confirmed)</summary>

- Area docs · stack A · design None · themes light, dark · viewports 1440x900
- Repro:
  1. Docs > open QA-q9-sample-md, type ' mdedit' at the end, wait for Saved
  2. Click QA-q9-sample-txt (content 'Plain text QA sample.')
  3. Click into its body and press Cmd+Z (or the toolbar Undo, which is enabled)
  4. Wait 1.5 s; GET /api/modules/knowledge/pages/876ec896…
- Expected: Undo history is per page; on a freshly opened page Undo is disabled/no-op
- Actual: First Cmd+Z replaces the txt page body with the md page's content ('QA sample / Some markdown text. / item 1 / item 2 / mdedit'); second Cmd+Z undoes 'mdedit'. Autosave then PATCHes that into QA-q9-sample-txt: its stored content is now the markdown document — original text 'Plain text QA sample.' overwritten. The same Tiptap instance is reused across pages and setContent() is recorded in history. (QA page restored afterwards with Cmd+Shift+Z twice; a real user would not know to do that.)
- Screenshots: [015-undo-cross-page](../evidence/shots/q9/light/015-undo-cross-page.png), [004-undo-cross-page](../evidence/shots/vq9/dark/004-undo-cross-page.png)
- Network: `PATCH /pages/876ec896…/content 200 (with QA-q9-sample-md's content)`
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:72` — setContent(newData, { emitUpdate:false }) on page switch — goes into the undo stack
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:347` — TiptapEditor not keyed by page id, so one editor/history serves every page
- Suggested fix: PageEditor.tsx:347: <TiptapEditor key={page.id} …/> for a fresh editor + history per page — but this MUST land together with the Q9-008 fix (setEditor(null)/isDestroyed guard), otherwise FixedToolbar renders with the destroyed previous editor on every switch. Alternative without remount: on switch replace the state via editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins })) which drops history. Add a regression test: switch page, Cmd+Z leaves content unchanged.
- Verification (vq9): **confirmed** — Reproduced (dark): opened QA-q9-mention-target, then QA-q9-sample-md without typing — editor.can().undo() already true. Cmd+Z in sample-md replaced its body with mention-target's text and autosave persisted it (GET sample-md: 'Mention target page for QA q9…', revision 8). Restored with Cmd+Shift+Z (verified server content back to the markdown doc). Root cause confirmed: one TiptapEditor/history serves all text pages (PageEditor.tsx:347 not keyed) and the page-switch setContent (TiptapEditor.tsx:72-77) is recorded in history. S1 kept: one natural keystroke silently overwrites a page with another page's content. · evidence: [004-undo-cross-page](../evidence/shots/vq9/dark/004-undo-cross-page.png), GET /pages/17bb733b after Cmd+Z: content = mention-target paragraph, revision 8

</details>


## T-363

**Page title edits are silently dropped when switching page or leaving Docs within 1 s; no save feedback for titles**

- Severity **S2** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-002

**Summary.** Tree/API still show 'Untitled'; no PATCH /meta was sent. The title debounce timer is cleared on pageId change and on unmount. The Saving…/Saved pill only tracks body content — a title edit shows nothing (MutationObserver log over 3 s: no status change).

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:202` — pageId effect clears titleTimerRef without flushing

**Proposed fix.** Flush pending title save on page switch/unmount; show saved state for titles. — Detail: PageEditor.tsx: keep {pageId,title} of the pending rename in a ref; on pageId change / unmount / title blur / Enter call the PATCH immediately (flush) instead of clearTimeout at :100-102 and :204-206; route title saves through the same Saving…/Saved/Error pill (:256-270).

**Evidence.** `network: no PATCH /pages/d76ea8b4…/meta after the title fill`

<details><summary>Q9-002 — Page title edits are silently dropped when switching page or leaving Docs within 1 s; no save feedback for titles (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > New page (editor header +)
  2. Type 'QA-q9-title-loss' in the title
  3. Within ~300 ms click another page in the tree (QA-q9-mention-target)
  4. Wait 2.5 s; GET /api/modules/knowledge/workspaces/default/tree
- Expected: Pending title is flushed (like body content, which useAutosave flushes on switch) and a Saving…/Saved indicator covers title edits
- Actual: Tree/API still show 'Untitled'; no PATCH /meta was sent. The title debounce timer is cleared on pageId change and on unmount. The Saving…/Saved pill only tracks body content — a title edit shows nothing (MutationObserver log over 3 s: no status change).
- Network: `no PATCH /pages/d76ea8b4…/meta after the title fill`
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:202` — pageId effect clears titleTimerRef without flushing
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:98` — unmount clears title timer without flushing
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:256` — status pill driven only by content autosave
- Suggested fix: PageEditor.tsx: keep {pageId,title} of the pending rename in a ref; on pageId change / unmount / title blur / Enter call the PATCH immediately (flush) instead of clearTimeout at :100-102 and :204-206; route title saves through the same Saving…/Saved/Error pill (:256-270).
- Verification (vq9): **confirmed** — Reproduced: QA-q9-B title + '-renamed', clicked QA-q9-mention-target within ~100 ms, waited 2.5 s: GET still 'QA-q9-B' and 0 PATCH /meta requests for 96d2aa15. Code: PageEditor.tsx:202-208 (pageId effect) and :98-104 (unmount) clearTimeout the 1000 ms title timer without flushing; the status pill (:256-270) is driven only by useAutosave content status. S2 kept (silent loss of a rename). · evidence: network: no PATCH /api/modules/knowledge/pages/96d2aa15…/meta after the title edit

</details>


## T-364

**Docs page tree doesn't refresh after New/Add subpage/Delete/move (two racing tree instances)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-003, F1D-007

**Summary.** Only title saves, editor-header New page, editor Delete and import call requestRefresh(); Sidebar.handleCreatePage, PageTree.handleCreate, TreeItem.handleCreateChild/handleDelete/handleDrop never refresh. Tree is stale until reload or an unrelated title edit. | Also covers: F1D-007: Docs fetches the page tree twice on every visit (two usePageTree instances race)

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:88` — handleCreatePage: no requestRefresh()

**Proposed fix.** Single tree store instance; refresh after create/subpage/delete/move. — Detail: Call useTreeStore.getState().requestRefresh() after every successful mutation in Sidebar.tsx:96 (handleCreatePage), PageTree.tsx:33, TreeItem.tsx:63 (create child), :84 (delete), :150 (move). Better: in Space.tsx handle SSE page events for ANY page (created/deleted/moved/meta_updated/restored) by calling requestRefresh() (debounced) before the selectedPageId filter at :36-37, so API/assistant/MCP changes also appear. Clear selection when the selected page (or an ancestor) is deleted.

**Evidence.** [002-new-page-tree-stale](../evidence/shots/q9/dark/002-new-page-tree-stale.png), [004-sidebar-new-page-tree-stale](../evidence/shots/vq9/light/004-sidebar-new-page-tree-stale.png), [016-lat-docs-revisit-first](../evidence/shots/f1d/dark/016-lat-docs-revisit-first.png)

<details><summary>Q9-003 — Page tree does not refresh after New page (sidebar +), Add subpage, Delete from tree, or drag-move (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs with 0 pages: click the sidebar header '+' (New page) -> editor opens 'Untitled' but the sidebar still says 'No pages yet'
  2. Hover QA-q9-parent > Add subpage -> child is created (API tree shows it) and opened, but the tree shows no child/chevron
  3. Hover a page > Delete > accept -> DELETE 204, row stays in the tree; clicking it shows raw 'PAGE_NOT_FOUND'
  4. Drag QA-q9-B onto the lower quarter of QA-q9-mention-target (or drag C into parent) -> POST /move 200, tree order unchanged until reload
- Expected: Tree reflects every create/delete/move immediately (it already does for title edits and imports, which call requestRefresh)
- Actual: Only title saves, editor-header New page, editor Delete and import call requestRefresh(); Sidebar.handleCreatePage, PageTree.handleCreate, TreeItem.handleCreateChild/handleDelete/handleDrop never refresh. Tree is stale until reload or an unrelated title edit.
- Screenshots: [002-new-page-tree-stale](../evidence/shots/q9/dark/002-new-page-tree-stale.png), [003-add-subpage-tree-stale](../evidence/shots/q9/dark/003-add-subpage-tree-stale.png), [005-deleted-page-click](../evidence/shots/q9/dark/005-deleted-page-click.png), [008-after-drag-inside](../evidence/shots/q9/dark/008-after-drag-inside.png), [013-new-page-tree-stale](../evidence/shots/q9/light/013-new-page-tree-stale.png), [004-sidebar-new-page-tree-stale](../evidence/shots/vq9/light/004-sidebar-new-page-tree-stale.png), [005-add-subpage-tree-stale](../evidence/shots/vq9/dark/005-add-subpage-tree-stale.png), [022-tree-delete-stale](../evidence/shots/vq9/dark/022-tree-delete-stale.png), [023-deleted-row-click](../evidence/shots/vq9/dark/023-deleted-row-click.png)
- Console: `404 GET /pages/945437d3… after clicking the stale deleted row`
- Network: `#292 POST /pages 201 with no following GET /tree`; `#499 DELETE /pages/945437d3… 204, tree not refetched`; `#519 POST /pages/96d2aa15…/move 200, tree not refetched`
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:88` — handleCreatePage: no requestRefresh()
- Code: `src/modules/knowledge/frontend/components/Sidebar/PageTree.tsx:25` — empty-state New page: no refresh
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:52` — handleCreateChild / handleDelete (76) / handleDrop (120): no refresh
- Suggested fix: Call useTreeStore.getState().requestRefresh() after every successful mutation in Sidebar.tsx:96 (handleCreatePage), PageTree.tsx:33, TreeItem.tsx:63 (create child), :84 (delete), :150 (move). Better: in Space.tsx handle SSE page events for ANY page (created/deleted/moved/meta_updated/restored) by calling requestRefresh() (debounced) before the selectedPageId filter at :36-37, so API/assistant/MCP changes also appear. Clear selection when the selected page (or an ancestor) is deleted.
- Verification (vq9): **confirmed** — Reproduced three paths: (1) light, sidebar '+' New page: API root pages 8→9, tree rows stayed 8; (2) dark, hover QA-q9-sample-txt > Add subpage: API shows child 'Untitled', tree shows no chevron/child; (3) dark, tree Delete on API-created QA-vq9-del-parent: DELETE ok (parent+child 404) but the row stays; clicking it shows 'PAGE_NOT_FOUND'. Also observed: a title changed through the API (SSE meta_updated) is not reflected in the tree ('QA-q9-parentX' stayed) — tree never listens to SSE. Code confirmed: only Sidebar import (:128) and PageEditor create/delete/title (:162,:180,:196) call requestRefresh; Sidebar.tsx:88-104, PageTree.tsx:25-39, TreeItem.tsx:52-74/76-92/120-154 do not. Drag-move not re-run in headless (HTML5 DnD) — code path identical (TreeItem.tsx:150 no refresh). Test pages cleaned up. · evidence: [004-sidebar-new-page-tree-stale](../evidence/shots/vq9/light/004-sidebar-new-page-tree-stale.png), [005-add-subpage-tree-stale](../evidence/shots/vq9/dark/005-add-subpage-tree-stale.png), [022-tree-delete-stale](../evidence/shots/vq9/dark/022-tree-delete-stale.png), [023-deleted-row-click](../evidence/shots/vq9/dark/023-deleted-row-click.png)

</details>

<details><summary>F1D-007 — Docs fetches the page tree twice on every visit (two usePageTree instances race) (S4, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Wrap window.fetch to log requests
  2. Navigate Home → Docs (in memory)
  3. Inspect the request log
- Expected: One GET /api/modules/knowledge/workspaces/default/tree per visit.
- Actual: Two identical GETs fire in the same millisecond on every Docs mount (log: '30958 GET …/tree' ×2, '185698 GET …/tree' ×2). The Retry button fetches once.
- Screenshots: [016-lat-docs-revisit-first](../evidence/shots/f1d/dark/016-lat-docs-revisit-first.png)
- Network: `GET /api/modules/knowledge/workspaces/default/tree ×2 at t=30958 and t=185698`
- Code: `src/modules/knowledge/frontend/Space.tsx:23` — usePageTree(designId) for the breadcrumb
- Code: `src/modules/knowledge/frontend/components/Sidebar/PageTree.tsx:21` — second usePageTree(designId)
- Code: `src/modules/knowledge/frontend/hooks/usePageTree.ts:56` — per-instance hasFetchedRef + render-time isLoading guard lets both instances fetch in the same commit
- Suggested fix: knowledge Space.tsx:23: read the tree from the store (const tree = useTreeStore(s => s.tree)) instead of a second usePageTree(designId); or move the fetch-on-scope logic into the tree store (ensureLoaded(scope) guarded by a store-level in-flight promise) so any number of hook instances fetch once. usePageTree.ts:57 guard is per-instance and reads the render-time isLoading, so both instances fetch in the same commit.
- Verification (vf1d): **confirmed** — Reproduced on the real stack (no mocks, logging only): two identical GET /api/modules/knowledge/workspaces/default/tree within 1 ms on each Docs visit (243318/243319 and 251135 x2). No StrictMode in main.tsx, so the double comes from the two usePageTree instances (Space.tsx:23, PageTree.tsx:21) with per-instance hasFetchedRef (usePageTree.ts:57). S4 kept: harmless duplicate read (~1 ms each). · evidence: network: GET …/workspaces/default/tree x2 at t=251135

</details>


## T-365

**Page tree order is scrambled: tree sorts order keys with localeCompare but keys are ASCII base62**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-K · owner K1 · wave W2 · scope backend · estimate XS
- Findings: Q9-004

**Summary.** Tree order after the drop is B, parent, mention-target — B jumped to the TOP (backend assigned key 'c' between 'V' and 'k' in binary order, but localeCompare sorts 'c' before 'k' and 'V' after 's'). Order depends on letter case of generated keys.

**Root cause.** `src/modules/knowledge/backend/db/repositories/page-repository.ts:346` — list.sort((a,b) => a.order_key.localeCompare(b.order_key))

**Proposed fix.** Backend: tree sort by order key with byte/ASCII compare (not localeCompare). — Detail: page-repository.ts:346: list.sort((a,b) => a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0) (binary, matching SQLite BINARY collation and the generator's ASCII alphabet). Add a repo test with mixed-case keys.

**Evidence.** [006-drag-after-wrong-order](../evidence/shots/q9/dark/006-drag-after-wrong-order.png), [001-tree-order](../evidence/shots/vq9/dark/001-tree-order.png)

<details><summary>Q9-004 — Page tree order is scrambled: tree sorts order keys with localeCompare but keys are ASCII base62 (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Create pages in this order: QA-q9-mention-target (key 'V'), QA-q9-parent ('k'), QA-q9-B ('s'), QA-q9-C ('w')
  2. Observe tree: parent, B, mention-target, C — the 2nd page appears above the 1st
  3. Drag QA-q9-B onto the lower quarter of QA-q9-mention-target ('after')
  4. Reload Docs
- Expected: New pages append at the end; 'drop after X' puts the page directly after X
- Actual: Tree order after the drop is B, parent, mention-target — B jumped to the TOP (backend assigned key 'c' between 'V' and 'k' in binary order, but localeCompare sorts 'c' before 'k' and 'V' after 's'). Order depends on letter case of generated keys.
- Screenshots: [006-drag-after-wrong-order](../evidence/shots/q9/dark/006-drag-after-wrong-order.png), [001-tree-order](../evidence/shots/vq9/dark/001-tree-order.png)
- Network: `GET /workspaces/default/tree -> [B 'c', parent 'k', mention 'V', C 'w']`
- Code: `src/modules/knowledge/backend/db/repositories/page-repository.ts:346` — list.sort((a,b) => a.order_key.localeCompare(b.order_key))
- Code: `src/modules/knowledge/backend/services/order-key-generator.ts:1` — ALPHABET 0-9A-Za-z (ASCII order); siblings for key generation use SQL binary ORDER BY
- Suggested fix: page-repository.ts:346: list.sort((a,b) => a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0) (binary, matching SQLite BINARY collation and the generator's ASCII alphabet). Add a repo test with mixed-case keys.
- Verification (vq9): **confirmed** — Verified via API and code: GET /workspaces/default/tree returns root order c(QA-q9-B), k(parent), s(sample-md), V(mention-target), w, y, z — mention-target (created first, key 'V' = MID_CHAR) sorts after pages created later. node: ['c','k','s','V','w'].sort(localeCompare) → c,k,s,V,w vs binary sort → V,c,k,s,w. page-repository.ts:346 uses localeCompare while ALPHABET 0-9A-Za-z (order-key-generator.ts:1) and all sibling queries (asc(order_key), SQLite BINARY) assume ASCII order, so 'drop after X' (key 'c' between 'V' and 'k') lands B at the top. Screenshot shows the scrambled tree. · evidence: [001-tree-order](../evidence/shots/vq9/dark/001-tree-order.png), GET /workspaces/default/tree → order keys [c,k,s,V,w,y,z,zV]

</details>


## T-366

**Single click on a link in the editor opens it in a new window (duplicate Link extension overrides openOnClick:false)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-009

**Summary.** A new tab/window to https://example.com opens on every plain click (context pages 1 -> 2), making link text practically uneditable with the mouse. Console on every editor mount: '[tiptap warn]: Duplicate extension names found: [\'link\']'. StarterKit 3.27.1 already registers Link with openOnClick:true; the separately added Link.configure({openOnClick:false}) loses.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/tiptap-extensions.ts:18` — StarterKit.configure({heading}) keeps its bundled Link

**Proposed fix.** Remove duplicate Link extension so openOnClick:false holds. — Detail: tiptap-extensions.ts:18-28: StarterKit.configure({ heading: { levels: [1,2,3] }, link: { openOnClick: false, autolink: true } }) and remove the separate Link import/entry (also fixes the markdown importer which shares the list). Optional: Cmd/Ctrl+click opens via window.open.

**Evidence.** `console: [tiptap warn]: Duplicate extension names found: ['link']. This can lead to issues.`

<details><summary>Q9-009 — Single click on a link in the editor opens it in a new window (duplicate Link extension overrides openOnClick:false) (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > QA-q9-C, select 'ordered', Link > https://example.com > Enter
  2. Click once on the linked word to place the caret/edit it
- Expected: Caret is placed in the link (openOnClick:false is configured); links open only on an explicit action
- Actual: A new tab/window to https://example.com opens on every plain click (context pages 1 -> 2), making link text practically uneditable with the mouse. Console on every editor mount: '[tiptap warn]: Duplicate extension names found: [\'link\']'. StarterKit 3.27.1 already registers Link with openOnClick:true; the separately added Link.configure({openOnClick:false}) loses.
- Console: `[tiptap warn]: Duplicate extension names found: ['link']. This can lead to issues.`
- Code: `src/modules/knowledge/frontend/components/Editor/tiptap-extensions.ts:18` — StarterKit.configure({heading}) keeps its bundled Link
- Code: `src/modules/knowledge/frontend/components/Editor/tiptap-extensions.ts:28` — second Link.configure({ openOnClick: false })
- Suggested fix: tiptap-extensions.ts:18-28: StarterKit.configure({ heading: { levels: [1,2,3] }, link: { openOnClick: false, autolink: true } }) and remove the separate Link import/entry (also fixes the markdown importer which shares the list). Optional: Cmd/Ctrl+click opens via window.open.
- Verification (vq9): **confirmed** — Reproduced: single click on the linked word 'ordered' in QA-q9-C opened a second tab https://example.com (tab-list 1→2). editor.extensionManager has two 'link' extensions with openOnClick [true,false]; StarterKit 3.27.1 bundles Link (starter-kit dist :69-70) and tiptap warns '[tiptap warn]: Duplicate extension names found: ['link']'. In Electron the same click goes through setWindowOpenHandler → shell.openExternal (electron/src/main/index.ts:171), i.e. every plain click launches the system browser. · evidence: tab-list after click: 0 OpenPCB, 1 Example Domain, console: [tiptap warn]: Duplicate extension names found: ['link']

</details>


## T-367

**Failed body save shows a bare 'Error' pill, never retries, and the edit is silently discarded on page switch**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate M
- Findings: Q9-011

**Summary.** Pill reads only 'Error' (no tooltip/cause/retry). No retry happens after the backend recovers (GET page still 'Plain text QA sample.'). Switching pages resets pending state and the edit 'unsaved-edit' is gone. Same for 409 conflicts (PageContentConflictError is thrown and just shows 'Error'). Same with network offline (light theme): 'Error' pill, and after going back online for 5 s the text ' offline-edit' is still…

**Root cause.** `src/modules/knowledge/frontend/hooks/useAutosave.ts:64` — catch -> status 'error', pending content already cleared, no retry

**Proposed fix.** Failed body save: retry with backoff, error Banner with Retry, block page switch until saved or discarded. — Detail: useAutosave.ts: on failure restore pendingRef.current = content (if nothing newer is pending) and schedule retries with backoff (2/5/15 s) plus retry on window 'online'/visibilitychange; expose the error; PageEditor.tsx:256-270 render 'Not saved — Retry' as a button with the message in title; on pageId change with pending/failed content flush (or warn) instead of resetPending() at :203; on 409 (PageContentConflictError) offer Reload/Overwrite.

**Evidence.** [025-save-error](../evidence/shots/q9/dark/025-save-error.png), [010-save-error](../evidence/shots/vq9/dark/010-save-error.png)

<details><summary>Q9-011 — Failed body save shows a bare 'Error' pill, never retries, and the edit is silently discarded on page switch (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. route '**/api/modules/knowledge/pages/*/content' -> 500
  2. Docs > QA-q9-sample-txt, type ' unsaved-edit' -> pill shows 'Error'
  3. unroute (backend healthy again), wait 4 s
  4. Click QA-q9-B then back to QA-q9-sample-txt
- Expected: Clear message ('Couldn't save — retrying…' / Retry action), automatic retry with backoff once the backend is reachable, and a warning/flush before leaving a page with unsaved changes
- Actual: Pill reads only 'Error' (no tooltip/cause/retry). No retry happens after the backend recovers (GET page still 'Plain text QA sample.'). Switching pages resets pending state and the edit 'unsaved-edit' is gone. Same for 409 conflicts (PageContentConflictError is thrown and just shows 'Error'). Same with network offline (light theme): 'Error' pill, and after going back online for 5 s the text ' offline-edit' is still not saved.
- Screenshots: [025-save-error](../evidence/shots/q9/dark/025-save-error.png), [011-offline-save](../evidence/shots/q9/light/011-offline-save.png), [010-save-error](../evidence/shots/vq9/dark/010-save-error.png)
- Console: `Failed to save page content: KnowledgeApiError: boom`
- Network: `PATCH /pages/{txt}/content -> 500 (injected)`; `GET /pages/{txt} after switch -> content without the edit`
- Code: `src/modules/knowledge/frontend/hooks/useAutosave.ts:64` — catch -> status 'error', pending content already cleared, no retry
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:268` — 'Error' label only
- Suggested fix: useAutosave.ts: on failure restore pendingRef.current = content (if nothing newer is pending) and schedule retries with backoff (2/5/15 s) plus retry on window 'online'/visibilitychange; expose the error; PageEditor.tsx:256-270 render 'Not saved — Retry' as a button with the message in title; on pageId change with pending/failed content flush (or warn) instead of resetPending() at :203; on 409 (PageContentConflictError) offer Reload/Overwrite.
- Verification (vq9): **confirmed** — Reproduced (dark): route PATCH …/pages/*/content → 500, typed ' vq9-unsaved' in QA-q9-sample-txt → pill 'Error' (no title/role/retry). After unroute and 5 s the server still had 'Plain text QA sample.' (no retry). Switching to QA-q9-B and back: editor shows the server text — edit silently gone. Code: useAutosave.ts:54 clears pendingRef before the request and :64-67 only sets status 'error'; PageEditor.tsx:268 label 'Error'. Rated S2 (not S1) because a loopback backend failure is rare and an Error indicator is visible. · evidence: [010-save-error](../evidence/shots/vq9/dark/010-save-error.png), GET /pages/876ec896 after 5 s and after page switch: content without the edit

</details>


## T-368

**Docs failures are silent or show raw codes: import/create/delete/move errors only console.error; tree error shows 'HTTP_500' in raw red**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-012 · known ref K40
- Depends on: ['T-006']

**Summary.** Import and create failures: no UI feedback at all (only console 'Failed to import document: KnowledgeApiError: File is not a PDF…', 'Failed to create page: KnowledgeApiError: boom'); spinner stops and nothing happens. Delete/move failures likewise only console.error. Tree load failure shows 'HTTP_500' + 'Retry' in raw text-red-600 (#e6000b, dE 21.7 from nearest token; --status-danger is #e0705f). Page load failure s…

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:130` — import catch: console.error only

**Proposed fix.** Docs errors via problem.ts in Banner/Toast (no raw 'HTTP_500'/PAGE_NOT_FOUND). — Detail: Map KnowledgeApiError codes to copy in one helper (PAGE_NOT_FOUND → 'This page was deleted', NETWORK_ERROR/HTTP_5xx → 'Couldn't reach the Docs service', import 400 → use payload message 'Couldn't import <file>: not a valid PDF'); surface failures from Sidebar/TreeItem/PageTree/PageEditor via the app notice/toast kit or an inline bg-status-danger-soft banner with a kit Button Retry; PageTree.tsx:53 text-red-600 → text-status-danger.

**Evidence.** [023-import-bad-pdf](../evidence/shots/q9/dark/023-import-bad-pdf.png), [011-import-bad-pdf](../evidence/shots/vq9/dark/011-import-bad-pdf.png)

<details><summary>Q9-012 — Docs failures are silent or show raw codes: import/create/delete/move errors only console.error; tree error shows 'HTTP_500' in raw red (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Import document > choose a .pdf that is not a PDF (QA-q9-fake.pdf) -> backend 400 'File is not a PDF (missing %PDF- header)'
  2. route POST '**/api/modules/knowledge/pages' -> 500, click New page
  3. route '**/workspaces/default/tree' -> 500, reload, open Docs
  4. Click a deleted-but-still-listed tree row (see Q9-003)
- Expected: Human-readable inline error/toast ('Couldn't import QA-q9-fake.pdf: not a valid PDF'), token-coloured, with Retry where relevant
- Actual: Import and create failures: no UI feedback at all (only console 'Failed to import document: KnowledgeApiError: File is not a PDF…', 'Failed to create page: KnowledgeApiError: boom'); spinner stops and nothing happens. Delete/move failures likewise only console.error. Tree load failure shows 'HTTP_500' + 'Retry' in raw text-red-600 (#e6000b, dE 21.7 from nearest token; --status-danger is #e0705f). Page load failure shows raw 'PAGE_NOT_FOUND'. Offline: New page click does nothing and shows nothing.
- Screenshots: [023-import-bad-pdf](../evidence/shots/q9/dark/023-import-bad-pdf.png), [026-create-fail](../evidence/shots/q9/dark/026-create-fail.png), [024-tree-load-error](../evidence/shots/q9/dark/024-tree-load-error.png), [005-deleted-page-click](../evidence/shots/q9/dark/005-deleted-page-click.png), [011-import-bad-pdf](../evidence/shots/vq9/dark/011-import-bad-pdf.png), [012-tree-load-error](../evidence/shots/vq9/dark/012-tree-load-error.png), [013-create-fail](../evidence/shots/vq9/dark/013-create-fail.png), [023-deleted-row-click](../evidence/shots/vq9/dark/023-deleted-row-click.png)
- Console: `Failed to import document: KnowledgeApiError: File is not a PDF (missing %PDF- header)`; `Failed to create page: KnowledgeApiError: boom`
- Network: `POST /pages/import/pdf -> 400`; `POST /pages -> 500 (injected)`; `GET /workspaces/default/tree -> 500 (injected)`
- Pixel probes: {"file": "shots/q9/dark/024-tree-load-error.png", "x": 131, "y": 97, "hex": "#e6000b", "nearestToken": "--net-power", "deltaE": 21.7}; {"file": "shots/vq9/dark/012-tree-load-error.png", "x": 131, "y": 97, "hex": "#e6000b", "nearestToken": "--net-power", "deltaE": 27.9}
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:130` — import catch: console.error only
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:99` — create catch: console.error only
- Code: `src/modules/knowledge/frontend/components/Sidebar/PageTree.tsx:53` — text-red-600, raw error code, hand-rolled Retry button
- Code: `src/modules/knowledge/frontend/hooks/useKnowledgeApi.ts:125` — code falls back to `HTTP_${status}` and is used as the message
- Suggested fix: Map KnowledgeApiError codes to copy in one helper (PAGE_NOT_FOUND → 'This page was deleted', NETWORK_ERROR/HTTP_5xx → 'Couldn't reach the Docs service', import 400 → use payload message 'Couldn't import <file>: not a valid PDF'); surface failures from Sidebar/TreeItem/PageTree/PageEditor via the app notice/toast kit or an inline bg-status-danger-soft banner with a kit Button Retry; PageTree.tsx:53 text-red-600 → text-status-danger.
- Verification (vq9): **confirmed** — Reproduced: (a) Import document → vq9-fake.pdf: 400 'File is not a PDF (missing %PDF- header)' only in console, no role=alert/status and no visible text; (b) route GET tree → 500: sidebar shows raw 'HTTP_500' + 'Retry' in #e6000b (probe dE 27.9 from nearest token; --status-danger dark is #e0705f); (c) route POST /pages → 500 + sidebar New page: console 'Failed to create page: KnowledgeApiError: HTTP_500', nothing in UI; (d) clicking a stale deleted row shows raw 'PAGE_NOT_FOUND'. Code: useKnowledgeApi.ts:118-125 builds `HTTP_${status}` codes used as messages; Sidebar.tsx:99/130, TreeItem.tsx:86/152 console.error only; PageTree.tsx:53 text-red-600. · evidence: [011-import-bad-pdf](../evidence/shots/vq9/dark/011-import-bad-pdf.png), [012-tree-load-error](../evidence/shots/vq9/dark/012-tree-load-error.png), [013-create-fail](../evidence/shots/vq9/dark/013-create-fail.png), [023-deleted-row-click](../evidence/shots/vq9/dark/023-deleted-row-click.png), probe 131,97 #e6000b

</details>


## T-369

**Docs page delete uses native window.confirm (tree + editor), doesn't mention subpages that are deleted too, and offers no undo**

- Severity **S2** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-025 · known ref K06
- Depends on: ['T-014']

**Summary.** Native dialogs: spy log ['confirm: Delete "Untitled"?'] from the tree and ['confirm: Delete this page?'] from the editor (inconsistent copy). softDeletePage also soft-deletes all children silently. No undo/trash UI.

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:80` — window.confirm(`Delete "${node.title}"?`)

**Proposed fix.** kit confirmDialog naming page + subpage count; undo toast optional. — Detail: Replace TreeItem.tsx:80 and PageEditor.tsx:192 window.confirm with the shared kit confirm dialog: 'Delete "<title>" and N subpages?' (count from the tree); after delete show a notice with Undo calling api.restorePage (make restore also restore children deleted in the same operation).

**Evidence.** [004-delete-tree-stale](../evidence/shots/q9/dark/004-delete-tree-stale.png), [022-tree-delete-stale](../evidence/shots/vq9/dark/022-tree-delete-stale.png)

<details><summary>Q9-025 — Docs page delete uses native window.confirm (tree + editor), doesn't mention subpages that are deleted too, and offers no undo (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Install dialog spy; Docs > hover a page row > Delete (trash)
  2. Docs > open a page > editor header 'Delete page'
  3. Delete a page that has subpages (e.g. QA-q9-parent)
- Expected: Kit confirm dialog (role=dialog, Esc/Enter, focus return) naming the page and the number of subpages that will also be deleted; an Undo toast (backend POST /pages/:id/restore already exists)
- Actual: Native dialogs: spy log ['confirm: Delete "Untitled"?'] from the tree and ['confirm: Delete this page?'] from the editor (inconsistent copy). softDeletePage also soft-deletes all children silently. No undo/trash UI.
- Screenshots: [004-delete-tree-stale](../evidence/shots/q9/dark/004-delete-tree-stale.png), [022-tree-delete-stale](../evidence/shots/vq9/dark/022-tree-delete-stale.png)
- Network: `DELETE /api/modules/knowledge/pages/945437d3… -> 204`
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:80` — window.confirm(`Delete "${node.title}"?`)
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:192` — window.confirm("Delete this page?")
- Code: `src/modules/knowledge/backend/services/page-service.ts:254` — softDeleteChildren
- Suggested fix: Replace TreeItem.tsx:80 and PageEditor.tsx:192 window.confirm with the shared kit confirm dialog: 'Delete "<title>" and N subpages?' (count from the tree); after delete show a notice with Undo calling api.restorePage (make restore also restore children deleted in the same operation).
- Verification (vq9): **confirmed** — Reproduced both entry points with the dialog spy: editor 'Delete page' → 'confirm: Delete this page?'; tree trash on API-created QA-vq9-del-parent → 'confirm: Delete "QA-vq9-del-parent"?' (inconsistent copy, no subpage mention). After accept both parent and child returned 404 (page-service.ts:254 softDeleteChildren); no undo/notice although POST /pages/:id/restore exists (routes.ts:388). Native confirm = S2 per protocol (breaks the Electron look, no kit dialog). · evidence: dialog spy: ["confirm: Delete this page?"], ["confirm: Delete \"QA-vq9-del-parent\"?"], GET parent/child after delete → 404 404, [022-tree-delete-stale](../evidence/shots/vq9/dark/022-tree-delete-stale.png)

</details>


## T-370

**Docs page tree is unreadable past ~5 levels: titles collapse to 1–3 characters in the fixed 260px sidebar, with no tooltip or resize**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: F1D-005

**Summary.** Measured title widths per depth: 139, 123, 107, 91, 75, 59, 43, 27, 11 px. Depth 7–8 rows show '02…', '0.', '03…', '08…'. Each row still reserves 48 px for the invisible (opacity-0) Add-subpage/Delete buttons. Indent is 16 px per level. The sidebar is fixed at 260 px and not resizable. Rows have no title attribute. Rows are 36 px tall (shell rows are 22 px).

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:156` — paddingLeft = level*16+4, uncapped

**Proposed fix.** Resizable Docs sidebar + title tooltip; cap indentation. — Detail: TreeItem.tsx:156: cap/compress indent (e.g. min(level,4)*12 + max(0,level-4)*6 px) or draw indent guides. TreeItem.tsx:209: make the action group absolutely positioned (absolute right-1, bg matches row) and visible on group-hover/focus-within so it takes no width at rest. TreeItem.tsx:207: add title={node.title}. knowledge Space.tsx:99: make the 260 px sidebar resizable (reuse the Designer left-panel resizer, 240–520, persisted). Adopt the kit 22–24 px tree row height (see Q9-017).

**Evidence.** [041-docs300-chain-expanded](../evidence/shots/f1d/dark/041-docs300-chain-expanded.png), [030-docs300-deep-chain](../evidence/shots/vf1d/dark/030-docs300-deep-chain.png)

<details><summary>F1D-005 — Docs page tree is unreadable past ~5 levels: titles collapse to 1–3 characters in the fixed 260px sidebar, with no tooltip or resize (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. In-page mock: the page tree returns 300 pages, a chain nested 8 deep, titles up to 150 chars
  2. Open Docs and expand the chain 000 › 020 › 021 › … › 026
- Expected: Deep pages stay identifiable: tighter indent or indentation capped, the sidebar is resizable, action buttons take no space until hover, and a full-title tooltip is available.
- Actual: Measured title widths per depth: 139, 123, 107, 91, 75, 59, 43, 27, 11 px. Depth 7–8 rows show '02…', '0.', '03…', '08…'. Each row still reserves 48 px for the invisible (opacity-0) Add-subpage/Delete buttons. Indent is 16 px per level. The sidebar is fixed at 260 px and not resizable. Rows have no title attribute. Rows are 36 px tall (shell rows are 22 px).
- Screenshots: [041-docs300-chain-expanded](../evidence/shots/f1d/dark/041-docs300-chain-expanded.png), [042-docs300-expanded-all](../evidence/shots/f1d/dark/042-docs300-expanded-all.png), [046-docs300-1100](../evidence/shots/f1d/dark/046-docs300-1100.png), [140-docs300-chain-expanded](../evidence/shots/f1d/light/140-docs300-chain-expanded.png), [030-docs300-deep-chain](../evidence/shots/vf1d/dark/030-docs300-deep-chain.png), [103-docs300-deep-chain-1100](../evidence/shots/vf1d/light/103-docs300-deep-chain-1100.png)
- Census: `census/f1d-docs300-dark-1440.json`
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:156` — paddingLeft = level*16+4, uncapped
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:209` — action group uses opacity-0 (keeps width) instead of hidden/absolute
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:207` — truncate title with no title= tooltip
- Code: `src/modules/knowledge/frontend/Space.tsx:99` — fixed w-[260px] sidebar
- Suggested fix: TreeItem.tsx:156: cap/compress indent (e.g. min(level,4)*12 + max(0,level-4)*6 px) or draw indent guides. TreeItem.tsx:209: make the action group absolutely positioned (absolute right-1, bg matches row) and visible on group-hover/focus-within so it takes no width at rest. TreeItem.tsx:207: add title={node.title}. knowledge Space.tsx:99: make the 260 px sidebar resizable (reuse the Designer left-panel resizer, 240–520, persisted). Adopt the kit 22–24 px tree row height (see Q9-017).
- Verification (vf1d): **confirmed** — Reproduced with the f1d tree mock (300 pages, chain 8 deep): measured title widths 139/123/107/91/75/59/43/27/11 px for depth 0..8, paddingLeft level*16+4, action group 48 px wide at opacity 0 on every row, no title attribute, row height 36 px; same 11 px at depth 8 in light at 1100×720. Code matches (TreeItem.tsx:156,207,209; Space.tsx:99 fixed w-[260px]). S3 kept: even top-level rows lose 48 px to invisible buttons, and deep pages cannot be identified with no tooltip. · evidence: [030-docs300-deep-chain](../evidence/shots/vf1d/dark/030-docs300-deep-chain.png), [103-docs300-deep-chain-1100](../evidence/shots/vf1d/light/103-docs300-deep-chain-1100.png)

</details>


## T-371

**Docs breadcrumbs truncate parents and meta line wraps into columns (1100 & 1440)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: F1D-006, Q9-020

**Summary.** The breadcrumb is one plain string truncated at the end, so it shows the root title and cuts off the immediate parent. The meta items get squeezed: 'edited 1h ago' wraps onto 3 lines and '3 words' onto 2, at 1440 as well as 1100. The crumbs are not links. Search results do the same: the breadcrumb line under each result truncates from the end, so for deep pages only the root title is visible and results can't be tol… | Also covers: Q9-020: At 1100 px the editor meta line wraps ('edited 3m / ago', '0 / words') when a breadcrumb…

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:302` — breadcrumb.join(' / ') in a truncate span; siblings lack shrink-0/whitespace-nowrap

**Proposed fix.** Breadcrumb truncates middle; meta line nowrap. — Detail: PageEditor.tsx:300-303: render crumbs as buttons calling onSelectPage, collapse to 'Root / … / Parent' beyond 3 levels with per-crumb max-width + title tooltip. PageEditor.tsx:305-320: give the 'edited …' and 'N words' spans shrink-0 whitespace-nowrap (this is also the Q9-020 fix). Sidebar.tsx:231: show 'Root / … / Parent' for search-result breadcrumbs (or truncate from the start) so deep results are distinguishable.

**Evidence.** [045-docs300-deep-page-open](../evidence/shots/f1d/dark/045-docs300-deep-page-open.png), [031-docs300-search-deep](../evidence/shots/vf1d/dark/031-docs300-search-deep.png), [032-1100-editor-breadcrumb](../evidence/shots/q9/dark/032-1100-editor-breadcrumb.png)

<details><summary>F1D-006 — Deep-page breadcrumbs truncate away the parent and push the editor meta line into 3-line columns ('edited / 1h / ago', '3 / words'), even at 1440px (S4, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. In-page mock: 300-page tree, 8-deep chain with long titles
  2. Docs search '027' → click the result (a page 8 levels deep)
- Expected: The breadcrumb shows the nearest ancestors (collapse the middle as '… /'), each crumb is clickable, and the 'edited … · N words' meta keeps a single line.
- Actual: The breadcrumb is one plain string truncated at the end, so it shows the root title and cuts off the immediate parent. The meta items get squeezed: 'edited 1h ago' wraps onto 3 lines and '3 words' onto 2, at 1440 as well as 1100. The crumbs are not links. Search results do the same: the breadcrumb line under each result truncates from the end, so for deep pages only the root title is visible and results can't be told apart.
- Screenshots: [045-docs300-deep-page-open](../evidence/shots/f1d/dark/045-docs300-deep-page-open.png), [046-docs300-1100](../evidence/shots/f1d/dark/046-docs300-1100.png), [043-docs300-search-deep](../evidence/shots/f1d/dark/043-docs300-search-deep.png), [141-docs300-search-deep](../evidence/shots/f1d/light/141-docs300-search-deep.png), [142-docs300-deep-page-open](../evidence/shots/f1d/light/142-docs300-deep-page-open.png), [031-docs300-search-deep](../evidence/shots/vf1d/dark/031-docs300-search-deep.png), [032-docs300-deep-page-meta](../evidence/shots/vf1d/dark/032-docs300-deep-page-meta.png)
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:302` — breadcrumb.join(' / ') in a truncate span; siblings lack shrink-0/whitespace-nowrap
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:231` — search result breadcrumb joined + end-truncated
- Suggested fix: PageEditor.tsx:300-303: render crumbs as buttons calling onSelectPage, collapse to 'Root / … / Parent' beyond 3 levels with per-crumb max-width + title tooltip. PageEditor.tsx:305-320: give the 'edited …' and 'N words' spans shrink-0 whitespace-nowrap (this is also the Q9-020 fix). Sidebar.tsx:231: show 'Root / … / Parent' for search-result breadcrumbs (or truncate from the start) so deep results are distinguishable.
- Verification (vf1d): **confirmed** — Reproduced at 1440×900 with the tree mock: opening the depth-8 page '027 power' from search shows the breadcrumb as one end-truncated span starting at the root, so the immediate parent is cut off; the meta row is 62 px tall with 'edited 1h ago' 50 px (3 lines) and '3 words' 33 px (2 lines). Search result breadcrumb scrollWidth 3534 vs clientWidth 203, truncated from the end (root only visible). Crumbs are plain text. The meta-wrap half has the same root cause as Q9-020 (no shrink-0/whitespace-nowrap on the meta spans) and should be fixed there; this finding extends Q9-020 to 1440 with long breadcrumbs. The remaining unique part (breadcrumb truncation direction, non-clickable crumbs) is polish -> S3 lowered to S4. The 'Error' save pill in the screenshot is a shim artefact (Q9-026 PATCH blocked). · evidence: [031-docs300-search-deep](../evidence/shots/vf1d/dark/031-docs300-search-deep.png), [032-docs300-deep-page-meta](../evidence/shots/vf1d/dark/032-docs300-deep-page-meta.png)

</details>

<details><summary>Q9-020 — At 1100 px the editor meta line wraps ('edited 3m / ago', '0 / words') when a breadcrumb is present (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1100x720
- Repro:
  1. resize 1100x720
  2. Docs > expand 'QA-q9-long Title…' > open child 'QA-q9-child of long'
- Expected: Breadcrumb truncates; 'edited …' and word count stay on one line; header height stays constant
- Actual: Breadcrumb takes the width and the trailing spans wrap onto two lines, growing the header from 58px to ~74px and pushing the toolbar down.
- Screenshots: [032-1100-editor-breadcrumb](../evidence/shots/q9/dark/032-1100-editor-breadcrumb.png), [017-1100-meta-wrap](../evidence/shots/vq9/dark/017-1100-meta-wrap.png)
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:299` — meta spans lack whitespace-nowrap/shrink-0; breadcrumb span needs min-w-0
- Suggested fix: PageEditor.tsx:299-323: row 'flex min-w-0 items-center'; breadcrumb span 'min-w-0 flex-1 truncate' (or shrink); other spans 'shrink-0 whitespace-nowrap'; optionally make breadcrumb segments buttons that select the ancestor page.
- Verification (vq9): **confirmed** — Reproduced at 1100×720 (Electron minimum) on 'QA-q9-child of long': breadcrumb span 17px, 'edited 1h ago' and '19 words' spans 33px (wrapped to two lines), meta row 45px, title block 74px instead of 58px, toolbar pushed down. · evidence: [017-1100-meta-wrap](../evidence/shots/vq9/dark/017-1100-meta-wrap.png), DOM: metaH 45, headerH 74, spans [[breadcrumb,17],[edited 1h ago,33],[19 words,33]]

</details>


## T-372

**Editor toolbar active/disabled states go stale (Bold stays highlighted outside bold text; Undo/Redo lag)**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-005

**Summary.** Bold stays highlighted (bg-accent-soft) with the caret in plain text; immediately after clicking Bold the button is NOT highlighted. Undo/Redo disabled state only updates when some unrelated React state changes (autosave status), e.g. Redo reported disabled right after 4 undos.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:50` — shouldRerenderOnTransaction: false

**Proposed fix.** Toolbar state via useEditorState selector. — Detail: FixedToolbar.tsx: derive state with useEditorState({ editor, selector: ({editor}) => ({ bold: editor.isActive('bold'), …, canUndo: editor.can().undo(), canRedo: editor.can().redo() }) }) from @tiptap/react; add aria-pressed={active} to ToolbarButton (:26-51).

**Evidence.** [009-toolbar-stale-bold](../evidence/shots/q9/dark/009-toolbar-stale-bold.png), [007-toolbar-bold-stale](../evidence/shots/vq9/dark/007-toolbar-bold-stale.png)

<details><summary>Q9-005 — Editor toolbar active/disabled states go stale (Bold stays highlighted outside bold text; Undo/Redo lag) (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > QA-q9-B, type 'alpha beta gamma', double-click 'beta', click Bold
  2. Click at the very start of 'alpha' (plain text) and wait 1.5 s
  3. Observe the Bold toolbar button
- Expected: Bold/Italic/Heading/etc. reflect the mark/node at the caret; Undo/Redo disabled state follows history
- Actual: Bold stays highlighted (bg-accent-soft) with the caret in plain text; immediately after clicking Bold the button is NOT highlighted. Undo/Redo disabled state only updates when some unrelated React state changes (autosave status), e.g. Redo reported disabled right after 4 undos.
- Screenshots: [009-toolbar-stale-bold](../evidence/shots/q9/dark/009-toolbar-stale-bold.png), [007-toolbar-bold-stale](../evidence/shots/vq9/dark/007-toolbar-bold-stale.png)
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:50` — shouldRerenderOnTransaction: false
- Code: `src/modules/knowledge/frontend/components/Editor/FixedToolbar.tsx:74` — editor.isActive()/can() read at render time; nothing re-renders on selectionUpdate/transaction
- Suggested fix: FixedToolbar.tsx: derive state with useEditorState({ editor, selector: ({editor}) => ({ bold: editor.isActive('bold'), …, canUndo: editor.can().undo(), canRedo: editor.can().redo() }) }) from @tiptap/react; add aria-pressed={active} to ToolbarButton (:26-51).
- Verification (vq9): **confirmed** — Reproduced (inverse direction of the report, same cause): caret inside <strong>strong</strong> → editor.isActive('bold') true but the Bold button has no bg-accent-soft; after typing 'q' the Undo button stayed disabled while editor.can().undo() was true (100 ms), and only enabled ~1.5 s later when the autosave status re-rendered PageEditor. Code: TiptapEditor.tsx:50 shouldRerenderOnTransaction:false; FixedToolbar.tsx reads isActive()/can() at render only. S3 kept. · evidence: [007-toolbar-bold-stale](../evidence/shots/vq9/dark/007-toolbar-bold-stale.png), run-code: {inBold:{cls:false, edBold:true}}, {after100ms:{undoBtnDisabled:true, canUndo:true}}

</details>


## T-373

**Task list renders broken: bullet + checkbox on one line, item text on the next**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-006

**Summary.** The <ul data-type=taskList> gets prose list-disc bullets; the <label> and <div> inside the <li> stack vertically, so the row shows a grey bullet + checkbox and the text drops to the next line.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/tiptap-extensions.ts:25` — TaskList/TaskItem added without any styles

**Proposed fix.** Fix task list item CSS (checkbox + text inline). — Detail: Add editor styles (e.g. in index.css or a knowledge editor CSS file): .ProseMirror ul[data-type=taskList]{list-style:none;padding-left:0} ul[data-type=taskList] li{display:flex;gap:.5rem;align-items:flex-start} li>label{margin-top:.2rem;flex:none} li>div{flex:1;min-width:0} li>div>p{margin:0}; input[type=checkbox]{accent-color:var(--selection)}.

**Evidence.** [010-editor-formatting](../evidence/shots/q9/dark/010-editor-formatting.png), [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png)

<details><summary>Q9-006 — Task list renders broken: bullet + checkbox on one line, item text on the next (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > any page, click Task list (or type '[ ] ') and type an item
  2. Observe the rendered item
- Expected: Checkbox and item text inline on one row, no list bullet (standard task list)
- Actual: The <ul data-type=taskList> gets prose list-disc bullets; the <label> and <div> inside the <li> stack vertically, so the row shows a grey bullet + checkbox and the text drops to the next line.
- Screenshots: [010-editor-formatting](../evidence/shots/q9/dark/010-editor-formatting.png), [011-md-shortcuts-task](../evidence/shots/q9/dark/011-md-shortcuts-task.png), [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png), [001-editor-formatting](../evidence/shots/vq9/light/001-editor-formatting.png)
- Pixel probes: {"file": "shots/q9/dark/011-md-shortcuts-task.png", "x": 554, "y": 371, "hex": "#4a5565", "nearestToken": "--text-disabled", "deltaE": 7.9}
- Code: `src/modules/knowledge/frontend/components/Editor/tiptap-extensions.ts:25` — TaskList/TaskItem added without any styles
- Code: `src/core/frontend/src/index.css:2` — no ul[data-type=taskList] rules anywhere
- Suggested fix: Add editor styles (e.g. in index.css or a knowledge editor CSS file): .ProseMirror ul[data-type=taskList]{list-style:none;padding-left:0} ul[data-type=taskList] li{display:flex;gap:.5rem;align-items:flex-start} li>label{margin-top:.2rem;flex:none} li>div{flex:1;min-width:0} li>div>p{margin:0}; input[type=checkbox]{accent-color:var(--selection)}.
- Verification (vq9): **confirmed** — Reproduced both themes on QA-q9-B: ul[data-type=taskList] list-style-type 'disc', li display 'list-item'; label box y=573 and text div y=602 (text on the next line); checkbox accent-color 'auto' (browser blue). Marker colour oklch(0.446 0.03 256.8) = Tailwind gray-600. No taskList CSS in index.css. · evidence: [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png), [001-editor-formatting](../evidence/shots/vq9/light/001-editor-formatting.png), probe dark 554,582 #4a5565 nearest --text-disabled dE 7.9

</details>


## T-374

**Docs/Tasks on raw palette: Typography gray (blue cast), literal backticks around inline code, raw slate/violet/red**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-007, Q9-016 · known ref K45

**Summary.** Blockquote bar and <hr> are #364153 (Tailwind gray-700, blue cast, dE 12.8 from nearest token), list markers #4a5565 (gray-600, blue cast); the theme remaps slate/violet but not the prose 'gray' palette. Inline code renders as `code span` with visible backtick glyphs (prose code::before/::after), and quotes get auto curly quotes + italic. Light theme: code block background #1e2939 (gray-800 navy), body text #364153… | Also covers: Q9-016: Docs (and Tasks) still use raw palette classes and hand-rolled controls instead of tokens…

**Root cause.** `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:60` — class 'prose prose-sm dark:prose-invert' -> default gray theme

**Proposed fix.** Docs/Tasks prose + controls to tokens (neutral prose colors, no literal backticks around code). — Detail: TiptapEditor.tsx:60: use 'prose prose-sm prose-neutral dark:prose-invert' and map --tw-prose-body/headings/bullets/hr/quote-borders/code/pre-code/pre-bg (and --tw-prose-invert-*) to the index.css tokens (--text, --text-strong, --text-tertiary, --border, --surface-canvas-well); add prose-code:before:content-none prose-code:after:content-none prose-blockquote:not-italic and style inline code with bg-surface-raised px-1 rounded-control.

**Evidence.** [010-editor-formatting](../evidence/shots/q9/dark/010-editor-formatting.png), [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png), [005-deleted-page-click](../evidence/shots/q9/dark/005-deleted-page-click.png)

<details><summary>Q9-007 — Editor prose uses Tailwind Typography default gray (blue-slate cast) and adds literal backticks around inline code (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > page with a blockquote, horizontal rule ('---'), bullet list and `inline code`
  2. Pixel-probe the quote bar / hr / bullets
- Expected: Neutral token colours (--border/--divider/--text-tertiary); inline code shown as a chip without literal backticks
- Actual: Blockquote bar and <hr> are #364153 (Tailwind gray-700, blue cast, dE 12.8 from nearest token), list markers #4a5565 (gray-600, blue cast); the theme remaps slate/violet but not the prose 'gray' palette. Inline code renders as `code span` with visible backtick glyphs (prose code::before/::after), and quotes get auto curly quotes + italic. Light theme: code block background #1e2939 (gray-800 navy), body text #364153 and headings #101828 (blue-gray instead of --text #26262b/--text-strong #111114); task checkbox uses the browser's default blue accent.
- Screenshots: [010-editor-formatting](../evidence/shots/q9/dark/010-editor-formatting.png), [011-md-shortcuts-task](../evidence/shots/q9/dark/011-md-shortcuts-task.png), [002-editor-formatting](../evidence/shots/q9/light/002-editor-formatting.png), [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png), [001-editor-formatting](../evidence/shots/vq9/light/001-editor-formatting.png)
- Pixel probes: {"file": "shots/q9/dark/011-md-shortcuts-task.png", "x": 800, "y": 554, "hex": "#364153", "nearestToken": "--surface-control", "deltaE": 12.8}; {"file": "shots/q9/dark/010-editor-formatting.png", "x": 548, "y": 657, "hex": "#364153", "nearestToken": "--surface-control", "deltaE": 12.8}; {"file": "shots/q9/dark/010-editor-formatting.png", "x": 554, "y": 503, "hex": "#4a5565", "nearestToken": "--text-disabled", "deltaE": 7.9}; {"file": "shots/q9/light/002-editor-formatting.png", "x": 800, "y": 496, "hex": "#1e2939", "nearestToken": "--text", "deltaE": 8.6}; {"file": "shots/q9/light/002-editor-formatting.png", "x": 600, "y": 291, "hex": "#364153", "nearestToken": "--text (#26262b)"}
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:60` — class 'prose prose-sm dark:prose-invert' -> default gray theme
- Suggested fix: TiptapEditor.tsx:60: use 'prose prose-sm prose-neutral dark:prose-invert' and map --tw-prose-body/headings/bullets/hr/quote-borders/code/pre-code/pre-bg (and --tw-prose-invert-*) to the index.css tokens (--text, --text-strong, --text-tertiary, --border, --surface-canvas-well); add prose-code:before:content-none prose-code:after:content-none prose-blockquote:not-italic and style inline code with bg-surface-raised px-1 rounded-control.
- Verification (vq9): **confirmed** — Pixel-verified both themes. Dark: quote bar #364153 (dE 12.8 to --surface-control), list markers #4a5565 (dE 7.9). Light (computed + probe): body text #364153 (dE 12.3 to --text-secondary; token --text is #26262b), h1 #101828 (dE 10.3), code block bg #1e2939 navy (dE 8.6), blockquote border gray-200. Inline code renders with literal backticks and quotes get curly quotes + italic (visible in screenshots). D1 remaps only slate/violet, not Tailwind Typography's gray theme, so this is a gap in the token re-skin rather than an intentional choice. · evidence: [008-editor-formatting](../evidence/shots/vq9/dark/008-editor-formatting.png), [001-editor-formatting](../evidence/shots/vq9/light/001-editor-formatting.png), probe light 559,249 #364153; 549,343 #101828; 800,717 #1e2939

</details>

<details><summary>Q9-016 — Docs (and Tasks) still use raw palette classes and hand-rolled controls instead of tokens/kit (S4, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. grep the knowledge frontend for slate-/violet-/red-/bg-white/rounded-md
  2. Compare rendered colours with tokens (pixel probes)
- Expected: Semantic tokens (border-border, bg-surface-hover, text-status-danger, bg-selection …) and kit components only
- Actual: Knowledge module: border-slate-200/800 on every divider, hover:bg-slate-100/800 rows, focus:border-violet-500/ring-violet-500 search, drop indicators bg-violet-500, skeleton bg-slate-200/800 rounded-md, error text-red-600 (#e6000b, dE 21.7) + hand-rolled Retry, LinkDialog bg-white/text-slate-900/dark:bg-slate-800, PdfViewer well bg-slate-100/900, toolbar dividers bg-slate-200/700, status pill bg-slate-100. Most render close to tokens only because index.css remaps slate/violet to neutrals (e.g. dividers #1c1c1f vs --border #1e1e21), so they will drift the moment the remap changes; red and the prose 'gray' palette are visibly off (see Q9-007, Q9-012). Tasks space is entirely raw (see Q9-019).
- Screenshots: [005-deleted-page-click](../evidence/shots/q9/dark/005-deleted-page-click.png), [024-tree-load-error](../evidence/shots/q9/dark/024-tree-load-error.png)
- Pixel probes: {"file": "shots/q9/dark/005-deleted-page-click.png", "x": 339, "y": 300, "hex": "#1c1c1f", "nearestToken": "--surface-raised (expected --border #1e1e21)", "deltaE": 0.0}; {"file": "shots/q9/dark/024-tree-load-error.png", "x": 131, "y": 97, "hex": "#e6000b", "nearestToken": "--net-power", "deltaE": 21.7}
- Code: `src/modules/knowledge/frontend/Space.tsx:99` — border-slate-200 dark:border-slate-800
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:171` — hover:bg-slate-100 dark:hover:bg-slate-800; drop lines bg-violet-500 (177,180)
- Code: `src/modules/knowledge/frontend/components/Sidebar/PageTree.tsx:44` — skeleton bg-slate-200 rounded-md; error text-red-600
- Code: `src/modules/knowledge/frontend/components/Editor/LinkDialog.tsx:50` — raw white/slate/violet input
- Code: `src/modules/knowledge/frontend/components/Editor/PdfViewer.tsx:171` — bg-slate-100 dark:bg-slate-900 well
- Suggested fix: As part of the PLAN §9 migration: swap border-slate-*/hover:bg-slate-* → border-border / hover:bg-surface-hover, bg-violet-500 drop lines → bg-selection, rounded-md skeletons → rounded-control bg-surface-hover, PdfViewer well → bg-surface-canvas-well or bg-surface-section, LinkDialog input → kit input; delete dark: pairs the tokens already handle.
- Verification (vq9): **confirmed** — Code-verified (grep of knowledge/tasks frontend) and consistent with PLAN run log ('knowledge 59, tasks 12 raw palette classes — documented remap-stopgap bucket', §9 follow-up 'Migrate remaining files … Knowledge'). Most slate/violet classes render on-token via the D1 remap; the visibly off-token parts are already carried by Q9-007 (prose gray), Q9-012 (text-red-600 #e6000b) and Q9-023 (Tasks bg-red-50). Kept as the K45 umbrella for the code migration but downgraded S3→S4 because what remains is a documented, intentional stopgap with no visible defect of its own. · evidence: PLAN.md §9 + Run log 2026-09-05 FINAL GATES, src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:171,177,180, src/modules/knowledge/frontend/components/Editor/PdfViewer.tsx:171

</details>


## T-375

**Link dialog: Save with a collapsed caret silently does nothing; Esc drops focus to <body>; Remove always shown**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-010

**Summary.** Enter closes the dialog and nothing is inserted, no feedback (html unchanged '<p>md bullet</p>'). After Esc document.activeElement is BODY, so typing goes nowhere. 'Remove' button is always rendered. Radix warns 'Missing Description or aria-describedby for {DialogContent}' on each open; the URL input has no label (placeholder only).

**Root cause.** `src/modules/knowledge/frontend/components/Editor/LinkDialog.tsx:26` — setLink on empty selection is a no-op

**Proposed fix.** Link dialog: Save with collapsed caret inserts link text; Esc restores focus; Remove only when link exists. — Detail: LinkDialog.tsx:26-33: if editor.state.selection.empty insertContent({type:'text', text:url, marks:[{type:'link', attrs:{href:url}}]}); DialogContent (:42) add onCloseAutoFocus={e => { e.preventDefault(); editor.commands.focus(); }} and aria-describedby={undefined} or a DialogDescription; render Remove (:66) only when editor.isActive('link'); aria-label='Link URL' on the input and use the kit input.

**Evidence.** [012-link-dialog](../evidence/shots/q9/dark/012-link-dialog.png), [009-link-dialog](../evidence/shots/vq9/dark/009-link-dialog.png)

<details><summary>Q9-010 — Link dialog: Save with a collapsed caret silently does nothing; Esc drops focus to <body>; Remove always shown (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > QA-q9-C, click at end of 'md bullet' (no selection)
  2. Click Link, type https://nothing.example, press Enter
  3. Open Link again on an existing link and press Esc, then type
- Expected: With no selection the URL is inserted as linked text (or Link is disabled with a hint); after Esc/Cancel focus returns to the editor at the previous selection; 'Remove' only when a link exists
- Actual: Enter closes the dialog and nothing is inserted, no feedback (html unchanged '<p>md bullet</p>'). After Esc document.activeElement is BODY, so typing goes nowhere. 'Remove' button is always rendered. Radix warns 'Missing Description or aria-describedby for {DialogContent}' on each open; the URL input has no label (placeholder only).
- Screenshots: [012-link-dialog](../evidence/shots/q9/dark/012-link-dialog.png), [009-link-dialog](../evidence/shots/vq9/dark/009-link-dialog.png)
- Console: `Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.`
- Code: `src/modules/knowledge/frontend/components/Editor/LinkDialog.tsx:26` — setLink on empty selection is a no-op
- Code: `src/modules/knowledge/frontend/components/Editor/LinkDialog.tsx:42` — no onCloseAutoFocus -> focus not returned to editor; no DialogDescription
- Suggested fix: LinkDialog.tsx:26-33: if editor.state.selection.empty insertContent({type:'text', text:url, marks:[{type:'link', attrs:{href:url}}]}); DialogContent (:42) add onCloseAutoFocus={e => { e.preventDefault(); editor.commands.focus(); }} and aria-describedby={undefined} or a DialogDescription; render Remove (:66) only when editor.isActive('link'); aria-label='Link URL' on the input and use the kit input.
- Verification (vq9): **confirmed** — Reproduced on QA-q9-C: caret at end of 'md bullet', Link → URL → Enter: editor JSON unchanged (only a stored link mark, nothing visible, no feedback). Dialog buttons [Cancel, Remove, Save, Close] — Remove shown with no link present. Esc → document.activeElement BODY. Radix warning 'Missing Description or aria-describedby' logged; URL input has placeholder only. S3 kept. · evidence: [009-link-dialog](../evidence/shots/vq9/dark/009-link-dialog.png), console: Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}

</details>


## T-376

**Docs page tree is not keyboard operable: rows unfocusable, chevrons nameless, row actions focusable while invisible, ghost buttons show no focus**

- Severity **S3** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate M
- Findings: Q9-013 · known ref K34

**Summary.** Tab order: Import document, New page, then per row: nameless BUTTON (chevron, present even on leaf rows where it does nothing), 'Add subpage' (opacity 0), 'Delete' (opacity 0). Page rows themselves (div onClick) can never be focused, so a page cannot be opened from the keyboard. Focused kit ghost buttons (Import/New page/toolbar) have border 0 + outline none -> no visible focus indicator (focus-visible:border-select…

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:160` — row is a div with onClick; no tabIndex/role/onKeyDown

**Proposed fix.** Tree keyboard operable (treeitem roles, arrows, Enter), named chevrons, actions visible on focus. — Detail: TreeItem.tsx:160-231: role=treeitem with aria-level/aria-expanded/aria-selected, roving tabIndex and onKeyDown (Up/Down/Left/Right/Enter/Delete) inside a role=tree container in PageTree.tsx:96; chevron (:183) aria-label='Expand <title>'/aria-expanded and not rendered (or aria-hidden, tabIndex -1) for leaves; actions (:209) add group-focus-within:opacity-100; Sidebar.tsx:158 clear button aria-label='Clear search'; button.tsx:55 give ghost/primary a visible focus-visible ring (outline 1px var(--selection) / box-shad…

**Evidence.** [029-tree-keyboard-focus](../evidence/shots/q9/dark/029-tree-keyboard-focus.png)

<details><summary>Q9-013 — Docs page tree is not keyboard operable: rows unfocusable, chevrons nameless, row actions focusable while invisible, ghost buttons show no focus (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs, focus the Search field, press Tab repeatedly
  2. Watch document.activeElement and the screen
- Expected: Tree is a role=tree/treeitem list: Tab into it, arrows move, Enter opens, Right/Left expand/collapse, row actions revealed on focus; every focused control has a visible ring
- Actual: Tab order: Import document, New page, then per row: nameless BUTTON (chevron, present even on leaf rows where it does nothing), 'Add subpage' (opacity 0), 'Delete' (opacity 0). Page rows themselves (div onClick) can never be focused, so a page cannot be opened from the keyboard. Focused kit ghost buttons (Import/New page/toolbar) have border 0 + outline none -> no visible focus indicator (focus-visible:border-selection needs a border).
- Screenshots: [029-tree-keyboard-focus](../evidence/shots/q9/dark/029-tree-keyboard-focus.png), [030-import-btn-focus](../evidence/shots/q9/dark/030-import-btn-focus.png)
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:160` — row is a div with onClick; no tabIndex/role/onKeyDown
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:183` — chevron button has no aria-label/aria-expanded, rendered for leaves
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:209` — opacity-0 group-hover:opacity-100 without group-focus-within
- Code: `src/shared/frontend/ui/button.tsx:55` — ghost variant focus-visible:border-selection with no border -> invisible
- Suggested fix: TreeItem.tsx:160-231: role=treeitem with aria-level/aria-expanded/aria-selected, roving tabIndex and onKeyDown (Up/Down/Left/Right/Enter/Delete) inside a role=tree container in PageTree.tsx:96; chevron (:183) aria-label='Expand <title>'/aria-expanded and not rendered (or aria-hidden, tabIndex -1) for leaves; actions (:209) add group-focus-within:opacity-100; Sidebar.tsx:158 clear button aria-label='Clear search'; button.tsx:55 give ghost/primary a visible focus-visible ring (outline 1px var(--selection) / box-shadow) — kit-wide K34.
- Verification (vq9): **confirmed** — Reproduced: Tab from Search goes Import document → New page → per row: nameless chevron BUTTON (also on leaves) → 'Add subpage' (opacity 0) → 'Delete' (opacity 0); row divs tabIndex -1, no role=tree/treeitem. Kit ghost buttons report outline none, border 0, no box-shadow when focused (button.tsx:55 focus-visible:border-selection has no border to colour). The search clear 'X' button is also nameless. Severity recalibrated S2→S3: not a keyboard trap and there is a keyboard workaround — search results are <button>s (Search 'sample-txt' → Tab → Enter opened the page); consistent with vq1's Q1-011/Q1-012 (S3). · evidence: run-code tab sequence: BUTTON[Import document] outline none/border 0 … BUTTON[] (chevron) … BUTTON[Add subpage] opacity 0, rows tabIndex [-1,-1,-1], role null, workaround: search result BUTTON 'QA-q9-sample-txt' + Enter opened the page

</details>


## T-377

**Editor meta line is stale: word count carries over from the previous page and 'edited Xm ago' never updates after saves**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-014

**Summary.** New empty page shows '6 words' (previous page's count; also '5 words' after other switches) — setContent(emitUpdate:false) never fires 'update'. 'edited 3m ago' / '4m ago' shown on pages edited seconds earlier because page.updated_at is not refreshed after content saves.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:106` — word count only recomputed on editor 'update'

**Proposed fix.** Meta line recalculates on page switch/save. — Detail: PageEditor.tsx:106-117: also listen to 'transaction' (tr.docChanged) or recompute in the TiptapEditor after setContent; :131-134 after a successful save mutatePage(p => p && p.id===result.page.id ? {...p, updated_at: result.page.updated_at} : p) (do not touch content_json); re-render the relative time on a 30-60 s interval.

**Evidence.** [003-add-subpage-tree-stale](../evidence/shots/q9/dark/003-add-subpage-tree-stale.png), [005-add-subpage-tree-stale](../evidence/shots/vq9/dark/005-add-subpage-tree-stale.png)

<details><summary>Q9-014 — Editor meta line is stale: word count carries over from the previous page and 'edited Xm ago' never updates after saves (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open QA-q9-parent (6 words), then hover it > Add subpage (new empty page opens)
  2. Read the meta line under the title
  3. Type in any page, wait for 'Saved', read 'edited …'
- Expected: Empty new page shows '0 words'; 'edited just now' after each save
- Actual: New empty page shows '6 words' (previous page's count; also '5 words' after other switches) — setContent(emitUpdate:false) never fires 'update'. 'edited 3m ago' / '4m ago' shown on pages edited seconds earlier because page.updated_at is not refreshed after content saves.
- Screenshots: [003-add-subpage-tree-stale](../evidence/shots/q9/dark/003-add-subpage-tree-stale.png), [027-long-title](../evidence/shots/q9/dark/027-long-title.png), [010-editor-formatting](../evidence/shots/q9/dark/010-editor-formatting.png), [011-md-shortcuts-task](../evidence/shots/q9/dark/011-md-shortcuts-task.png), [017-1100-meta-wrap](../evidence/shots/vq9/dark/017-1100-meta-wrap.png), [005-add-subpage-tree-stale](../evidence/shots/vq9/dark/005-add-subpage-tree-stale.png)
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:106` — word count only recomputed on editor 'update'
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:72` — setContent(..., { emitUpdate: false })
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:131` — save result updated_at kept in a ref only, page state not updated
- Suggested fix: PageEditor.tsx:106-117: also listen to 'transaction' (tr.docChanged) or recompute in the TiptapEditor after setContent; :131-134 after a successful save mutatePage(p => p && p.id===result.page.id ? {...p, updated_at: result.page.updated_at} : p) (do not touch content_json); re-render the relative time on a 30-60 s interval.
- Verification (vq9): **confirmed** — Reproduced: after Add subpage the empty 'Untitled' page showed '6 words'; at 1100px the empty 'QA-q9-child of long' showed '19 words' (QA-q9-C's count, the page opened before). Typing ' Extra' in QA-q9-mention-target → Saved, meta still 'edited 9m ago'. Code: PageEditor.tsx:106-117 recomputes only on 'update'; TiptapEditor.tsx:72-77 setContent(…, {emitUpdate:false}); :131-134 keeps the save result's updated_at in a ref only. · evidence: [017-1100-meta-wrap](../evidence/shots/vq9/dark/017-1100-meta-wrap.png) (empty page shows '19 words'), [005-add-subpage-tree-stale](../evidence/shots/vq9/dark/005-add-subpage-tree-stale.png), meta before/after save: 'edited 9m ago·10 words' → 'edited 9m ago·11 words'

</details>


## T-378

**Docs search field is a 32px hand-rolled input (kit search fields are 22px in a 34px header)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-015 · known ref K37
- Depends on: ['T-004']

**Summary.** Docs 'Search...' input is 32px tall, 12px text, own border/violet focus ring, inside a 48px (p-2) bar; Home 'Search designs…' and Library 'Search name, MPN, package…' use a 22px wrapper in a 34px header. Link dialog URL input is likewise hand-rolled (px-3 py-2, ~34px). DOM census docs-editor-dark-1440: oddControls [{h:32}].

**Root cause.** `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:150` — h-8 input with border-slate-300 focus:border-violet-500 focus:ring-violet-500

**Proposed fix.** Docs search -> kit SearchField 22px. — Detail: Sidebar.tsx:148-165: replace the hand-rolled input with the kit SearchField (src/shared/frontend/ui) used by HomeScreen/Library, aria-label='Search pages', placeholder 'Search pages…'; LinkDialog.tsx:45-57 use the kit input.

**Evidence.** [031-compare-Docs](../evidence/shots/q9/dark/031-compare-Docs.png), [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png)

<details><summary>Q9-015 — Docs search field is a 32px hand-rolled input (kit search fields are 22px in a 34px header) (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Open Home, Library and Docs; measure the search inputs
- Expected: Same kit SearchField as Home/Library: 22px control, 11px text, inside the 34px module header
- Actual: Docs 'Search...' input is 32px tall, 12px text, own border/violet focus ring, inside a 48px (p-2) bar; Home 'Search designs…' and Library 'Search name, MPN, package…' use a 22px wrapper in a 34px header. Link dialog URL input is likewise hand-rolled (px-3 py-2, ~34px). DOM census docs-editor-dark-1440: oddControls [{h:32}].
- Screenshots: [031-compare-Docs](../evidence/shots/q9/dark/031-compare-Docs.png), [031-compare-Home](../evidence/shots/q9/dark/031-compare-Home.png), [031-compare-Library](../evidence/shots/q9/dark/031-compare-Library.png), [012-link-dialog](../evidence/shots/q9/dark/012-link-dialog.png), [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png)
- Census: `census/docs-editor-dark-1440.json`
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:150` — h-8 input with border-slate-300 focus:border-violet-500 focus:ring-violet-500
- Code: `src/modules/knowledge/frontend/components/Editor/LinkDialog.tsx:45` — hand-rolled input px-3 py-2 bg-white/slate-800
- Suggested fix: Sidebar.tsx:148-165: replace the hand-rolled input with the kit SearchField (src/shared/frontend/ui) used by HomeScreen/Library, aria-label='Search pages', placeholder 'Search pages…'; LinkDialog.tsx:45-57 use the kit input.
- Verification (vq9): **confirmed** — Measured: Docs 'Search...' input 32px tall, 12px text, in a 49px bar, no aria-label, focus classes border-violet-500/ring-violet-500 (remapped); Home 'Search designs…' and Library 'Search name, MPN, package…' use a 22px wrapper with 11px text. Docs was scoped 'token re-skin only' in PLAN §0, so this is an un-migrated surface rather than a regression, but K37 inconsistency stands. S3 kept. · evidence: DOM: Docs {h:32,font:12px,bar:49,aria:null}; Home {wrap:22,font:11px}; Library {wrap:22,font:11px}, [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png)

</details>


## T-379

**Docs forgets the open page and tree expansion when leaving the module or reloading; search results don't reveal nested pages**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-018

**Summary.** Returns to 'No page selected' after a module switch or reload (tree expansion survives a module switch via the zustand store but is lost on reload). Selecting a nested search result opens it but the parent stays collapsed, so the page is not visible/highlighted in the tree (expandAncestors exists in tree-store but is never called).

**Root cause.** `src/modules/knowledge/frontend/Space.tsx:17` — selectedPageId is component state only

**Proposed fix.** Persist open page + expansion; search reveals nested results. — Detail: Space.tsx:17: keep selectedPageId in the navigation store params or localStorage (try/catch, per workspace/design scope) and restore it on mount; persist expandedIds likewise; call useTreeStore.getState().expandAncestors(id) in the onSelectPage path (Space.tsx:102/118) so search results and @page mentions (K22) reveal the row.

**Evidence.** [031-compare-Docs](../evidence/shots/q9/dark/031-compare-Docs.png), [016-nested-result-not-revealed](../evidence/shots/vq9/dark/016-nested-result-not-revealed.png)

<details><summary>Q9-018 — Docs forgets the open page and tree expansion when leaving the module or reloading; search results don't reveal nested pages (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > open QA-q9-B (QA-q9-parent expanded)
  2. Click Library in the rail, then Docs again (or reload)
  3. Search 'q9-C' and click the nested result
- Expected: Last page re-opens with its tree branch expanded (as Designer tabs persist); opening a nested search result expands and highlights it in the tree
- Actual: Returns to 'No page selected' after a module switch or reload (tree expansion survives a module switch via the zustand store but is lost on reload). Selecting a nested search result opens it but the parent stays collapsed, so the page is not visible/highlighted in the tree (expandAncestors exists in tree-store but is never called).
- Screenshots: [031-compare-Docs](../evidence/shots/q9/dark/031-compare-Docs.png), [016-nested-result-not-revealed](../evidence/shots/vq9/dark/016-nested-result-not-revealed.png)
- Code: `src/modules/knowledge/frontend/Space.tsx:17` — selectedPageId is component state only
- Code: `src/modules/knowledge/frontend/stores/tree-store.ts:159` — expandAncestors never used
- Suggested fix: Space.tsx:17: keep selectedPageId in the navigation store params or localStorage (try/catch, per workspace/design scope) and restore it on mount; persist expandedIds likewise; call useTreeStore.getState().expandAncestors(id) in the onSelectPage path (Space.tsx:102/118) so search results and @page mentions (K22) reveal the row.
- Verification (vq9): **confirmed** — Partially confirmed. Selected page is lost on module switch and on reload (Library → Docs: title input gone, 'No page selected'). Nested search result: collapsed QA-q9-parent, searched 'q9-C', clicked result — page opened but the parent stayed collapsed, row not visible; expandAncestors (tree-store.ts:159) has no callers. Correction: tree EXPANSION survives a module switch (zustand store; QA-q9-parent stayed expanded Library→Docs) and is lost only on reload. S3 kept. · evidence: [016-nested-result-not-revealed](../evidence/shots/vq9/dark/016-nested-result-not-revealed.png), module switch: before {rows incl. 'QA-q9-C', title 'QA-q9-C'} after {rows incl. 'QA-q9-C', title null}

</details>


## T-380

**Docs search only matches titles — body text and imported .md/.txt content are not searchable**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **defer** · owner K1 · wave followup · scope backend · estimate M
- Findings: Q9-019

**Summary.** 'No pages found for "ordered"'. Backend SearchService.searchByTitle does LIKE on title only (also unescaped % and _ wildcards). Imported documents are therefore unfindable by content.

**Root cause.** `src/modules/knowledge/backend/services/search-service.ts:7` — searchByTitle only

**Proposed fix.** Backend: full-text body search. — Detail: Short term: Sidebar.tsx:152 placeholder 'Search page titles…'; escape %/_ in page-repository.ts:241 (like … ESCAPE '\\'). Proper: maintain a plain-text column (tiptap getText on save / imported text) and query it via SQLite FTS5 in SearchService.

**Evidence.** [014-search-empty](../evidence/shots/q9/dark/014-search-empty.png)

<details><summary>Q9-019 — Docs search only matches titles — body text and imported .md/.txt content are not searchable (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Page QA-q9-C contains the words 'md ordered' in its body
  2. Type 'ordered' in the Docs 'Search...' field
- Expected: Pages whose content contains the term are found (or the field says 'Search titles')
- Actual: 'No pages found for "ordered"'. Backend SearchService.searchByTitle does LIKE on title only (also unescaped % and _ wildcards). Imported documents are therefore unfindable by content.
- Screenshots: [014-search-empty](../evidence/shots/q9/dark/014-search-empty.png)
- Network: `GET /api/modules/knowledge/search?q=ordered&scope=all -> results []`
- Code: `src/modules/knowledge/backend/services/search-service.ts:7` — searchByTitle only
- Code: `src/modules/knowledge/backend/db/repositories/page-repository.ts:241` — like(title, %query%)
- Suggested fix: Short term: Sidebar.tsx:152 placeholder 'Search page titles…'; escape %/_ in page-repository.ts:241 (like … ESCAPE '\\'). Proper: maintain a plain-text column (tiptap getText on save / imported text) and query it via SQLite FTS5 in SearchService.
- Verification (vq9): **confirmed** — Verified via API: GET /search?q=ordered → {results:[]} although QA-q9-C's body contains 'md ordered'; 'q9-C' finds by title. search-service.ts:7 searchByTitle → page-repository.ts:241 like(title,'%q%') (also unescaped %/_). Not a PLAN decision; placeholder just says 'Search...'. S3 kept (content search gap + misleading copy). · evidence: GET /api/modules/knowledge/search?q=ordered&scope=all → {"results":[]}

</details>


## T-381

**Clearing a page title saves an empty title: tree shows a blank, unlabeled row; Enter in the title does nothing**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-024

**Summary.** PATCH /meta saves title '' and the tree row renders only an icon (blank label) — unidentifiable, and unfindable via search. Enter keeps focus in the title input.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:149` — handleTitleChange saves any value

**Proposed fix.** Empty title falls back to 'Untitled'; Enter in title moves focus to body. — Detail: PageEditor.tsx:149-168: trim and, if empty, persist 'Untitled' on blur (or render fallback); TreeItem.tsx:207, Sidebar search result (:226) and breadcrumb use `title || 'Untitled'` in text-tertiary; title input onKeyDown Enter → editor?.commands.focus('start').

**Evidence.** [039-empty-title](../evidence/shots/q9/dark/039-empty-title.png), [021-empty-title](../evidence/shots/vq9/dark/021-empty-title.png)

<details><summary>Q9-024 — Clearing a page title saves an empty title: tree shows a blank, unlabeled row; Enter in the title does nothing (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > QA-q9-sample-md, select the title and delete all text
  2. Wait 1.5 s; look at the tree and search
  3. Press Enter in the title field
- Expected: Empty title falls back to 'Untitled' (display and/or persisted); Enter moves the caret into the body
- Actual: PATCH /meta saves title '' and the tree row renders only an icon (blank label) — unidentifiable, and unfindable via search. Enter keeps focus in the title input.
- Screenshots: [039-empty-title](../evidence/shots/q9/dark/039-empty-title.png), [021-empty-title](../evidence/shots/vq9/dark/021-empty-title.png)
- Network: `PATCH /pages/17bb733b…/meta {title:''} -> 200`
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:149` — handleTitleChange saves any value
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:207` — {node.title} without fallback
- Suggested fix: PageEditor.tsx:149-168: trim and, if empty, persist 'Untitled' on blur (or render fallback); TreeItem.tsx:207, Sidebar search result (:226) and breadcrumb use `title || 'Untitled'` in text-tertiary; title input onKeyDown Enter → editor?.commands.focus('start').
- Verification (vq9): **confirmed** — Reproduced on QA-q9-light-new: title filled with '' → after 1.8 s the API tree lists title '' and the tree row renders icon-only (text ''); Enter kept focus in the title input. Title restored afterwards. · evidence: [021-empty-title](../evidence/shots/vq9/dark/021-empty-title.png), GET /workspaces/default/tree last title ''

</details>


## T-382

**Merely opening a page (first after load / new page) writes it back: spurious PATCH bumps revision and 'edited' time**

- Severity **S3** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-026

**Summary.** A PATCH /content is sent without user input (also right after creating a page): updated_at -> 10:44:45, revision 7 -> 8, 'Saved' pill flashes and the page shows 'edited just now'. With pages being edited by the assistant/MCP concurrently this can trigger conflicts or overwrite normalisation-only differences.

**Root cause.** `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:86` — editor.setEditable(!readOnly) emits 'update' (tiptap core default emitUpdate=true) → onUpdate → autosave PATCH

**Proposed fix.** Don't PATCH on initial editor mount (compare normalized content). — Detail: TiptapEditor.tsx:84-88: `if (editor && editor.isEditable !== !readOnly) editor.setEditable(!readOnly, false)` (or pass `editable` only via useEditor options). Defensive: in PageEditor/useAutosave skip saves whose JSON equals the last loaded/saved JSON.

**Evidence.** [002-editor-formatting](../evidence/shots/q9/light/002-editor-formatting.png)

<details><summary>Q9-026 — Merely opening a page (first after load / new page) writes it back: spurious PATCH bumps revision and 'edited' time (S3, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. GET /api/modules/knowledge/pages/5bec1891… -> updated_at 10:17:51, revision 7
  2. Reload, open Docs, click QA-q9-mention-target, do not type, wait 2.5 s
  3. GET again
- Expected: Viewing a page never writes it
- Actual: A PATCH /content is sent without user input (also right after creating a page): updated_at -> 10:44:45, revision 7 -> 8, 'Saved' pill flashes and the page shows 'edited just now'. With pages being edited by the assistant/MCP concurrently this can trigger conflicts or overwrite normalisation-only differences.
- Screenshots: [002-editor-formatting](../evidence/shots/q9/light/002-editor-formatting.png)
- Network: `#293 PATCH /pages/49a03725…/content 200 right after GET, no typing`; `dark session #294 PATCH /pages/5bec1891…/content 200 right after POST /pages`
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:86` — editor.setEditable(!readOnly) emits 'update' (tiptap core default emitUpdate=true) → onUpdate → autosave PATCH
- Code: `src/modules/knowledge/frontend/components/Editor/TiptapEditor.tsx:51` — onUpdate forwards every update event to autosave
- Suggested fix: TiptapEditor.tsx:84-88: `if (editor && editor.isEditable !== !readOnly) editor.setEditable(!readOnly, false)` (or pass `editable` only via useEditor options). Defensive: in PageEditor/useAutosave skip saves whose JSON equals the last loaded/saved JSON.
- Verification (vq9): **confirmed** — Reproduced: QA-q9-mention-target revision 8 → 9 (updated_at 10:44:45 → 11:31:44) just by opening it after reload; the PATCH body equals the GET content exactly. Root cause corrected: not a normalisation transaction — TiptapEditor.tsx:84-88 calls editor.setEditable(!readOnly) whenever a new editor instance appears, and @tiptap/core setEditable(editable, emitUpdate = true) emits 'update' (core dist :5802-5806), which onUpdate forwards to triggerSave. Proven in-page: calling editor.setEditable(true) fired 1 'update' and bumped the revision 13 → 14. Happens on every fresh editor (first open after load, after PDF, after delete, after module switch). S3 kept. · evidence: network: GET /pages/5bec1891 → PATCH /pages/5bec1891/content with identical body, in-page: setEditable(true) → 'updates fired: 1', revision 13→14

</details>


## T-383

**Docs layout ignores shell metrics: no 34px module header, 36px tree rows, inverted surfaces, misaligned header borders, 3 'New page' CTAs**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate M
- Findings: Q9-017

**Summary.** No module header/title; sidebar top bar 48px while the editor title block is 58px, so the two bottom borders are offset by 10px; tree rows 36px (py-1.5), editor font 14px. Sidebar is --surface-app (#0c0c0d) and the editor --surface-panel (#111113) — the reverse of Home/Library (side #111113, main #0c0c0d, header #0f0f10). Empty Docs shows three 'New page' buttons at once (header '+', sidebar card, editor card). Sear…

**Root cause.** `src/modules/knowledge/frontend/Space.tsx:98` — sidebar bg-surface-app, editor bg-surface-card

**Proposed fix.** Docs to shell metrics: 34px header, 22px tree rows, surface tokens, single New page CTA. — Detail: Follow-up design pass for Docs: shared 34px module header ('Docs' + page count + SearchField + Import/New page), 22px tree rows, sidebar bg-surface-panel / editor bg-surface-app (Space.tsx:98-107), equal header heights, a single empty-state CTA, title left-aligned with the body column (PageEditor.tsx:246-253 vs TiptapEditor.tsx:60 mx-auto max-w-[46rem]), drop the last breadcrumb segment in search results (search-service/getBreadcrumb includes the page itself).

**Evidence.** [001-docs-empty](../evidence/shots/q9/dark/001-docs-empty.png), [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png)

<details><summary>Q9-017 — Docs layout ignores shell metrics: no 34px module header, 36px tree rows, inverted surfaces, misaligned header borders, 3 'New page' CTAs (S4, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open Docs next to Home/Library in dark theme
  2. Measure/probe
- Expected: Like Home/Library: 34px header with title + count and search, 22px rows at 11-12px, side panel --surface-panel, main --surface-app, one primary create action
- Actual: No module header/title; sidebar top bar 48px while the editor title block is 58px, so the two bottom borders are offset by 10px; tree rows 36px (py-1.5), editor font 14px. Sidebar is --surface-app (#0c0c0d) and the editor --surface-panel (#111113) — the reverse of Home/Library (side #111113, main #0c0c0d, header #0f0f10). Empty Docs shows three 'New page' buttons at once (header '+', sidebar card, editor card). Search results rows (48px, breadcrumb repeats the page's own title) differ from tree rows. Page body column (max-w 46rem centred) does not align with the left-aligned title.
- Screenshots: [001-docs-empty](../evidence/shots/q9/dark/001-docs-empty.png), [031-compare-Docs](../evidence/shots/q9/dark/031-compare-Docs.png), [031-compare-Library](../evidence/shots/q9/dark/031-compare-Library.png), [013-search-results](../evidence/shots/q9/dark/013-search-results.png), [009-toolbar-stale-bold](../evidence/shots/q9/dark/009-toolbar-stale-bold.png), [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png), [015-search-results](../evidence/shots/vq9/dark/015-search-results.png)
- Pixel probes: {"file": "shots/q9/dark/031-compare-Docs.png", "x": 190, "y": 850, "hex": "#0c0c0d", "nearestToken": "--surface-app", "deltaE": 0.0}; {"file": "shots/q9/dark/031-compare-Library.png", "x": 190, "y": 850, "hex": "#111113", "nearestToken": "--surface-panel", "deltaE": 0.0}; {"file": "shots/q9/dark/031-compare-Docs.png", "x": 700, "y": 600, "hex": "#111113", "nearestToken": "--surface-panel", "deltaE": 0.0}
- Code: `src/modules/knowledge/frontend/Space.tsx:98` — sidebar bg-surface-app, editor bg-surface-card
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:168` — py-1.5 text-sm rows
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:147` — p-2 top bar, no module header
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:246` — 58px title block
- Suggested fix: Follow-up design pass for Docs: shared 34px module header ('Docs' + page count + SearchField + Import/New page), 22px tree rows, sidebar bg-surface-panel / editor bg-surface-app (Space.tsx:98-107), equal header heights, a single empty-state CTA, title left-aligned with the body column (PageEditor.tsx:246-253 vs TiptapEditor.tsx:60 mx-auto max-w-[46rem]), drop the last breadcrumb segment in search results (search-service/getBreadcrumb includes the page itself).
- Verification (vq9): **confirmed** — Measured (dark): tree rows 36px/12px, sidebar top bar bottom 49px vs editor title block 58px (borders offset 10px), editor font 14px, title x=356 vs body text x=546; sidebar #0c0c0d (--surface-app) and editor #111113 (--surface-panel) — inverted vs Home/Library side panels. Empty state with three 'New page' CTAs confirmed from q9 shot + code (Sidebar '+', PageTree.tsx:74-88, PageEditor.tsx:219-231); search results breadcrumb repeats the page's own title ('QA-q9-parent / QA-q9-C'). Recalibrated S3→S4, fixScope design-decision: PLAN §0 explicitly limited Knowledge/Docs to a token re-skin with 'no structural changes', so adopting the 34px module header/22px rows is new design work, not a regression. · evidence: [014-docs-layout](../evidence/shots/vq9/dark/014-docs-layout.png), [015-search-results](../evidence/shots/vq9/dark/015-search-results.png), [001-docs-empty](../evidence/shots/q9/dark/001-docs-empty.png), probe 190,850 #0c0c0d --surface-app; 900,850 #111113 --surface-panel

</details>

