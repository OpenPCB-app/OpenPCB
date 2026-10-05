[← index](README.md)

# Known findings (code recon) — status

## (b) Known findings (code recon K01–K45, N1, N2, spike)

| Ref | Status | TIDs | Known claim | Note |
|---|---|---|---|---|
| K01 | confirmed | T-003, T-361, T-384 | No React error boundary / no window error+unhandledrejection handlers (FE/main.tsx:36, App.tsx). Render crash… | Docs FixedToolbar + Tasks tasks.map crash blank #root; designer survived injections but 2 unhandled rejections |
| K02 | confirmed | T-156 | `window.prompt` for PCB Text tool (DSG/pcb/PcbCanvas.tsx:2996). |  |
| K03 | confirmed | T-147 | `window.prompt` for "Custom…" trace width and via diameter/drill (DSG/pcb/PcbTopToolbar.tsx:207,294). |  |
| K04 | confirmed | T-357 | `window.prompt` rename chat in dock (AST/DesignerChatDock.tsx:725). |  |
| K05 | confirmed | T-329 | `window.prompt` rename chat in Assistant space (AST/Space.tsx:893). |  |
| K06 | confirmed | T-014, T-054, T-058, T-257, T-293, T-329, T-357, T-369 | 8× `window.confirm`: FE/settings/panels/LibrariesPanel.tsx:221, AST/DesignerChatDock.tsx:748, AST/Space.tsx:8… |  |
| K07 | confirmed | T-256 | Library list fetches limit=60, no paging (LIB/Space.tsx:111); backend caps 100, no offset/total. |  |
| K08 | confirmed | T-254 | Library delete/ZIP-import error replaces the whole list with an error line, no retry (LIB/Space.tsx:290,405,7… |  |
| K09 | confirmed | T-101, T-160 | Schematic shows "Loading schematic..." forever when projection fails (DSG/Space.tsx:1151); error strip :1303… | Schematic confirmed; PCB analog shows 'projection unavailable' without retry (F1A-012) |
| K10 | confirmed | T-082 | Designer toast off-token (raw red/green/amber/slate, backdrop-blur, "×"), no role/aria-live (DSG/hooks/use-to… |  |
| K11 | confirmed | T-051 | Settings claims API keys "stored encrypted locally" / badge "Saved · encrypted locally" (FE/settings/panels/A… |  |
| K12 | confirmed | T-002, T-133 | PCB keymap only ignores <input>; fires while typing in <textarea>/<select>/contenteditable (DSG/pcb/PcbCanvas… |  |
| K13 | confirmed | T-206 | Bundle routing tool unreachable (no button/key/menu). | Downgraded S4: Tune/Bundle behind dev flags; Measure reachable via context menu |
| K14 | confirmed | T-189 | PCB Add menu advertises "Comment (C)" but C key does nothing on PCB. |  |
| K15 | confirmed | T-186 | PCB empty-space context menu shows "X" as route-mode key; real key is R. |  |
| K16 | partial | T-197 | Route hint says "T/B layer" while T = Text tool when idle (PcbCanvas.tsx:4490). | Hint 'T/B' never rendered; but T in idle Route quits Route and arms Text |
| K17 | confirmed | T-094 | Schematic has no Ctrl/Cmd+Z / Shift+Z undo/redo hotkeys (PCB has them). |  |
| K18 | confirmed | T-188 | PCB has no Ctrl/Cmd+A select all. |  |
| K19 | confirmed | T-085 | Designer no-tabs empty state never shows "Import KiCad project…" (DSG/Space.tsx:1381 vs :1144). |  |
| K20 | confirmed | T-056 | Settings → Assistant → MCP section not gated by `mcp.server` flag. | Code-confirmed (flag on in dev so not visible on dev stacks) |
| K21 | confirmed | T-099 | "Open in Library" (inspector) / "Browse library" (outline empty state) land on list, not the part (DSG/Space.… |  |
| K22 | confirmed | T-344 | Clicking an @page mention opens Docs but not the page. |  |
| K23 | confirmed | T-335 | Assistant "Pinned" filter always empty (nothing calls togglePin). |  |
| K24 | confirmed | T-260 | Library search shows "/" hint that does nothing; search box lacks aria-label (LIB/Space.tsx:619). |  |
| K25 | confirmed | T-034 | Home list header always reads "Modified ▾" regardless of sort (FE/screens/HomeScreen.tsx:379). |  |
| K26 | confirmed | T-030 | Home delete modal: no role=dialog, no Esc, unlabelled close X, global N/Enter hotkeys active behind it (HomeS… |  |
| K27 | refuted | T-395 | 3D Snapshot button has no accessible label. | Refuted: button named 'Snapshot' from visible text |
| K28 | confirmed | T-107 | Rotate direction labels disagree: symbol/footprint editors say R = "90° CCW", schematic says R = "clockwise";… | Schematic mislabels R as clockwise (it is CCW); editors correct |
| K29 | confirmed | T-309 | Esc may close the part wizard while drawing (wizard + editor tools both listen on window). |  |
| K30 | confirmed | T-152 | Export dialog "Include inner copper layers" enabled on 2-layer boards (DSG/pcb/PcbExportDialog.tsx:259-266). | Plus 4-layer variant: unchecking ships unmanufacturable bundle (F2B-006) |
| K31 | confirmed | T-226 | BOM says "No BOM lines match the current filter." even with filter=All on an empty design (DSG/components/Des… |  |
| K32 | confirmed | T-031 | Home load error shows the "No designs yet / Create your first" empty state under the error strip. |  |
| K33 | confirmed | T-024 | App right-click menu replaces the native menu everywhere incl. text inputs (only "Settings"; no Cut/Copy/Past… |  |
| K34 | confirmed | T-007, T-087, T-297, T-376 | Kit tabs, segmented control, dock tabs, chip, status-bar segment, panel section header have no visible keyboa… |  |
| K35 | confirmed | T-036, T-228 | Home list rows and BOM rows are not keyboard reachable (no tabIndex/role). |  |
| K36 | confirmed | T-015, T-075, T-266, T-301 | 27 uses of text < 10px (9px/9.5px) e.g. LibraryTable.tsx:227, LibraryPreviewPane.tsx:95, Board3DOverlay.tsx:8… |  |
| K37 | confirmed | T-004, T-011, T-199, T-301, T-378 | Input heights inconsistent (18px PcbBoardPanel/PcbSelectionInspector/PcbLayersPanel, 20px AreaToolOptionsBar,… |  |
| K38 | confirmed | T-115, T-194 | Canvas clear colours off-token: PCB #0e1116 vs token --surface-canvas-well #08090a; schematic light bg hardco… |  |
| K39 | confirmed | T-009, T-061 | Settings header 52px vs 34px elsewhere; Settings search is a 32px hand-rolled input. |  |
| K40 | confirmed | T-006, T-031, T-067, T-083, T-101, T-159, T-213, T-219, T-273, T-321, T-368 | 42 places show raw "HTTP ${status}" text to users. | Confirmed on Home, Library, Docs, Designer, BOM, cloud; not every one of 42 sites exercised |
| K41 | confirmed | T-212, T-271 | Silent catches: DesignerDrcView.tsx:114,121 (projection/result fetch), model-conversion.ts:101,154. |  |
| K42 | confirmed | T-385 | Tasks module unreachable from UI (hidden from rail). |  |
| K43 | confirmed | T-038, T-060, T-078, T-109, T-236, T-277 | Disabled "Coming soon" stubs: Home card menu Rename/Duplicate/Export (DesignCard.tsx:122-131), 3D Height heat… | Partial nuance: 3D Height heatmap is enabled and shows a fake legend |
| K44 | confirmed | T-095 | Grid snapping hard-disabled in both editors (DSG/Space.tsx:1166,1405 gridVisible={false}); no schematic grid… |  |
| K45 | confirmed | T-004, T-019, T-060, T-062, T-129, T-235, T-252, T-300, T-348, T-374, T-386, T-390 | Raw palette classes / native inputs+selects / hand-rolled modal overlays on non-redesigned surfaces (Assistan… |  |
| N1 | confirmed | T-095 | Schematic wire-segment drag always snaps to 2 mm even though snap is "off" (SchematicCanvas.tsx:1993,2027). |  |
| N2 | confirmed | T-095 | Library drops onto schematic snap to 2 mm (EdaCanvas gridSize) while other placement is free. | Latent: Library→schematic drop path unreachable (MIME mismatch, F1C-006) |
| spike | confirmed | T-145 | PCB toolbar DRC count differs from dock tab / status bar | Toolbar counts errors only; dock/status errors+warnings (Q4-001) |

Totals: confirmed 46 · partial 1 · refuted 1. Every known finding was exercised by at least one charter (none left untested); single-charter 'untested' marks (K10 in q3, K12 in f2a, N1 in f2a) were confirmed by other charters.


## Original recon catalog

Paths relative to repo. DSG = src/modules/designer/frontend, LIB = src/modules/library/frontend,
AST = src/modules/assistant/frontend, FE = src/core/frontend/src.

- K01 No React error boundary / no window error+unhandledrejection handlers (FE/main.tsx:36, App.tsx). Render crash blanks whole app.
- K02 `window.prompt` for PCB Text tool (DSG/pcb/PcbCanvas.tsx:2996).
- K03 `window.prompt` for "Custom…" trace width and via diameter/drill (DSG/pcb/PcbTopToolbar.tsx:207,294).
- K04 `window.prompt` rename chat in dock (AST/DesignerChatDock.tsx:725).
- K05 `window.prompt` rename chat in Assistant space (AST/Space.tsx:893).
- K06 8× `window.confirm`: FE/settings/panels/LibrariesPanel.tsx:221, AST/DesignerChatDock.tsx:748, AST/Space.tsx:852,869, LIB/import-wizard/ImportWizardPage.tsx:577, LIB/Space.tsx:266, knowledge PageEditor.tsx:192, TreeItem.tsx:80.
- K07 Library list fetches limit=60, no paging (LIB/Space.tsx:111); backend caps 100, no offset/total.
- K08 Library delete/ZIP-import error replaces the whole list with an error line, no retry (LIB/Space.tsx:290,405,735,748).
- K09 Schematic shows "Loading schematic..." forever when projection fails (DSG/Space.tsx:1151); error strip :1303 has no retry/dismiss.
- K10 Designer toast off-token (raw red/green/amber/slate, backdrop-blur, "×"), no role/aria-live (DSG/hooks/use-toast.tsx:81-88). Library has a separate NoticeViewport.
- K11 Settings claims API keys "stored encrypted locally" / badge "Saved · encrypted locally" (FE/settings/panels/AssistantPanel.tsx:328,710) — keys are stored plaintext in SQLite.
- K12 PCB keymap only ignores <input>; fires while typing in <textarea>/<select>/contenteditable (DSG/pcb/PcbCanvas.tsx:4342) — e.g. typing in dock Assistant composer on PCB view toggles tools.
- K13 Bundle routing tool unreachable (no button/key/menu).
- K14 PCB Add menu advertises "Comment (C)" but C key does nothing on PCB.
- K15 PCB empty-space context menu shows "X" as route-mode key; real key is R.
- K16 Route hint says "T/B layer" while T = Text tool when idle (PcbCanvas.tsx:4490).
- K17 Schematic has no Ctrl/Cmd+Z / Shift+Z undo/redo hotkeys (PCB has them).
- K18 PCB has no Ctrl/Cmd+A select all.
- K19 Designer no-tabs empty state never shows "Import KiCad project…" (DSG/Space.tsx:1381 vs :1144).
- K20 Settings → Assistant → MCP section not gated by `mcp.server` flag.
- K21 "Open in Library" (inspector) / "Browse library" (outline empty state) land on list, not the part (DSG/Space.tsx:1360,1536).
- K22 Clicking an @page mention opens Docs but not the page.
- K23 Assistant "Pinned" filter always empty (nothing calls togglePin).
- K24 Library search shows "/" hint that does nothing; search box lacks aria-label (LIB/Space.tsx:619).
- K25 Home list header always reads "Modified ▾" regardless of sort (FE/screens/HomeScreen.tsx:379).
- K26 Home delete modal: no role=dialog, no Esc, unlabelled close X, global N/Enter hotkeys active behind it (HomeScreen.tsx:46-100).
- K27 3D Snapshot button has no accessible label.
- K28 Rotate direction labels disagree: symbol/footprint editors say R = "90° CCW", schematic says R = "clockwise"; both rotate +90°. Verify actual direction.
- K29 Esc may close the part wizard while drawing (wizard + editor tools both listen on window).
- K30 Export dialog "Include inner copper layers" enabled on 2-layer boards (DSG/pcb/PcbExportDialog.tsx:259-266).
- K31 BOM says "No BOM lines match the current filter." even with filter=All on an empty design (DSG/components/DesignerBomView.tsx:404-407).
- K32 Home load error shows the "No designs yet / Create your first" empty state under the error strip.
- K33 App right-click menu replaces the native menu everywhere incl. text inputs (only "Settings"; no Cut/Copy/Paste) (FE/AppShell.tsx:36-46,63-83).
- K34 Kit tabs, segmented control, dock tabs, chip, status-bar segment, panel section header have no visible keyboard focus style.
- K35 Home list rows and BOM rows are not keyboard reachable (no tabIndex/role).
- K36 27 uses of text < 10px (9px/9.5px) e.g. LibraryTable.tsx:227, LibraryPreviewPane.tsx:95, Board3DOverlay.tsx:89,313, AssistantPanel.tsx:425,586,591, McpSection.tsx:141, import-wizard property panels.
- K37 Input heights inconsistent (18px PcbBoardPanel/PcbSelectionInspector/PcbLayersPanel, 20px AreaToolOptionsBar, 22px inspectors, 32px EdgeDimModal/Settings search/Docs search).
- K38 Canvas clear colours off-token: PCB #0e1116 vs token --surface-canvas-well #08090a; schematic light bg hardcoded #f0f4fb (blue cast) vs neutral light surfaces.
- K39 Settings header 52px vs 34px elsewhere; Settings search is a 32px hand-rolled input.
- K40 42 places show raw "HTTP ${status}" text to users.
- K41 Silent catches: DesignerDrcView.tsx:114,121 (projection/result fetch), model-conversion.ts:101,154.
- K42 Tasks module unreachable from UI (hidden from rail).
- K43 Disabled "Coming soon" stubs: Home card menu Rename/Duplicate/Export (DesignCard.tsx:122-131), 3D Height heatmap/STEP-STL/Measure (Board3DOverlay.tsx:111,280,356), AiCloudTeaser, AssistantPanel usage, BomResultCard, SelectionInspector "Replace component", Library detail "Place in design".
- K44 Grid snapping hard-disabled in both editors (DSG/Space.tsx:1166,1405 gridVisible={false}); no schematic grid drawn; parts/wires land off-grid.
- K45 Raw palette classes / native inputs+selects / hand-rolled modal overlays on non-redesigned surfaces (Assistant, part wizard & editors, KiCad import wizard, 3D overlay, comments popups, Settings banners, toasts, Docs).
- N1 Schematic wire-segment drag always snaps to 2 mm even though snap is "off" (SchematicCanvas.tsx:1993,2027).
- N2 Library drops onto schematic snap to 2 mm (EdaCanvas gridSize) while other placement is free.
- (spike) PCB toolbar DRC button shows 13 while DRC dock tab + status bar show 19 on 'Dual LED Blinker'.
