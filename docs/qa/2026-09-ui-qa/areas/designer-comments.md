# designer.comments — QA findings

[← index](../README.md) · 8 triage entries · S1 0 · S2 3 · S3 3 · S4 2

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-124](#t-124) | S2 | Comments fail silently: failed post discards text (uncaught TypeError); failed list load hides every pin | F1A-004, F2C-008 | fix-now | D1+D2 / W2 | frontend | S |
| [T-125](#t-125) | S2 | New-comment composer does not take focus — first keystrokes trigger canvas tools (G → GND placement, H → Hole) | Q5-025 | fix-now | D2 / W2 | frontend | XS |
| [T-126](#t-126) | S2 | Thread status menu (Todo / In progress / Done / Archive) does nothing when clicked — popup closes before the item fires | Q5-026 | fix-now | D2 / W2 | frontend | XS |
| [T-127](#t-127) | S3 | Posting a reply in a long comment thread gives no visible confirmation: the list stays scrolled at the top and the reply lands ~2400 px below the fold | F2C-009 | fix-now | D2 / W2 | frontend | S |
| [T-128](#t-128) | S3 | Comment pins near the canvas edge are half-clipped instead of becoming edge chips, and nearby pins stack unreadably (no clustering) | F2C-010 | fix-now | D2 / W2 | frontend | M |
| [T-129](#t-129) | S3 | Comment pins/popups on raw violet/orange/slate palette; 2.0–2.4:1 meta text in light | Q3-023, Q5-030, F1B-023 | fix-now | D2 / W2 | frontend | S |
| [T-130](#t-130) | S4 | Comment list for a cloud-linked design blocks on an un-timed cloud fetch (12 s per request when the cloud host doesn't answer) | Q10-009 | defer | followup / followup | backend | S |
| [T-131](#t-131) | S4 | Comment a11y/UX gaps: pins named only by number, unlabelled attachment-remove button, image-only reply impossible, recenter jumps zoom to 80% | Q5-031 | fix-now | D2 / W2 | frontend | XS |

## T-124

**Comments fail silently: failed post discards text (uncaught TypeError); failed list load hides every pin**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner D1+D2 · wave W2 · scope frontend · estimate S
- Findings: F1A-004, F2C-008

**Summary.** The composer closes immediately, the text is gone, and no pin or message appears; the only signal is an uncaught 'TypeError: Failed to fetch' in the console. The server has 0 threads. The Comment tool stays pressed, so the next canvas click opens a new 'Add a comment…' composer; Esc does not leave the mode (Q5-027). The mode can be left via the schematic 'Comment' toggle or PCB 'Comment ▾' > 'Comment C'. | Also covers: F2C-008: If the comment list fails to load, every pin silently disappears; you can still post, and…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1177` — `void comments.createThread(anchor, body)`: no catch, no user-facing error (also :1420)

**Proposed fix.** Comments: post failure keeps draft + error + retry and exits comment mode cleanly; list-load failure shows error chip with Retry instead of hiding pins. — Detail: Change onCreateComment to return a Promise (Space.tsx:1176/1419: `(anchor, body) => comments.createThread(anchor, body)`), and in SchematicCanvas.tsx:3329 / PcbCanvas.tsx:6009 await it: clear the draft only on success; on failure keep the composer open with its text and an inline role='alert' 'Couldn't post comment — Retry'. Esc handling belongs to Q5-027.

**Evidence.** [106-offline-comment-post](../evidence/shots/f1a/dark/106-offline-comment-post.png), [061-offline-comment-post](../evidence/shots/vf1a/dark/061-offline-comment-post.png), [089-comments-list-500](../evidence/shots/f2c/dark/089-comments-list-500.png)

<details><summary>F1A-004 — A failed comment post silently discards the typed comment (uncaught TypeError) and leaves comment mode armed (S2, confirmed)</summary>

- Area designer.comments · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. Schematic: click toolbar 'Comment', click the canvas, type 'QA f1a offline comment'
  2. network-state-set offline (or route '**/comments/commands' → 500), press Cmd+Enter
  3. network-state-set online; click anywhere on the schematic or PCB canvas; press Esc
  4. GET /designs/{id}/comments?surface=schematic
- Expected: The composer stays open with the text and an error plus Retry, and comment mode ends only after a successful post.
- Actual: The composer closes immediately, the text is gone, and no pin or message appears; the only signal is an uncaught 'TypeError: Failed to fetch' in the console. The server has 0 threads. The Comment tool stays pressed, so the next canvas click opens a new 'Add a comment…' composer; Esc does not leave the mode (Q5-027). The mode can be left via the schematic 'Comment' toggle or PCB 'Comment ▾' > 'Comment C'.
- Screenshots: [106-offline-comment-post](../evidence/shots/f1a/dark/106-offline-comment-post.png), [110-k10-error-toast-1440](../evidence/shots/f1a/dark/110-k10-error-toast-1440.png), [114-pcb-drcdock-before-move](../evidence/shots/f1a/dark/114-pcb-drcdock-before-move.png), [115-pcb-comment-mode-stuck](../evidence/shots/f1a/dark/115-pcb-comment-mode-stuck.png)
- Console: `TypeError: Failed to fetch at fetchData (api.ts:19) at Object.dispatchCommentCommand (api.ts:162) at useDesignerComments.ts:104 at Object.createThread (useDesignerComments.ts:124) at onCreateComment (`
- Network: `POST /designs/91573bb6…/comments/commands → net::ERR_INTERNET_DISCONNECTED`; `GET /comments?surface=schematic → {threads:[]}`
- Code: `src/modules/designer/frontend/Space.tsx:1177` — `void comments.createThread(anchor, body)`: no catch, no user-facing error (also :1420)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3331` — setCommentDraft(null) runs synchronously before the post resolves (same in PcbCanvas.tsx:6011)
- Code: `src/modules/designer/frontend/hooks/useDesignerComments.ts:175` — setCommentMode(false) only on the success path
- Suggested fix: Change onCreateComment to return a Promise (Space.tsx:1176/1419: `(anchor, body) => comments.createThread(anchor, body)`), and in SchematicCanvas.tsx:3329 / PcbCanvas.tsx:6009 await it: clear the draft only on success; on failure keep the composer open with its text and an inline role='alert' 'Couldn't post comment — Retry'. Esc handling belongs to Q5-027.
- Verification (vf1a): **confirmed** — Reproduced on the schematic: Comment tool, click canvas, type 'VF1A offline comment', go offline, Cmd+Enter -> composer closed, text gone, no pin, no role=alert, pageerror 'TypeError: Failed to fetch' (unhandled); GET /comments?surface=schematic -> threads []. After going back online the Comment tool stays pressed (aria-pressed=true), Esc does not change it, and a canvas click opens a new 'Add a comment…' composer. Code: Space.tsx:1177/1420 `void comments.createThread(...)` with no catch; SchematicCanvas.tsx:3331 / PcbCanvas.tsx:6011 clear the draft synchronously; useDesignerComments.ts:175 exits comment mode only on success. Refuted part: 'PCB has no way out' is wrong. On PCB the toolbar shows 'Comment ▾' pressed, and choosing 'Comment C' in that menu toggles the mode off (toolbar returned to 'Add'). The Esc-does-not-exit part is already Q5-027. Environment note: browser 'offline' does not block a loopback backend in Electron; the real trigger is a local backend error (500) or an unreachable backend. S2 kept for the silent discard of user-written text (same class as Q9-012). · evidence: [061-offline-comment-post](../evidence/shots/vf1a/dark/061-offline-comment-post.png), [062-comment-mode-stuck](../evidence/shots/vf1a/dark/062-comment-mode-stuck.png), [064-pcb-add-menu-comment-active](../evidence/shots/vf1a/dark/064-pcb-add-menu-comment-active.png), pageerror: TypeError: Failed to fetch (uncaught in promise), network: GET /comments?surface=schematic -> {threads:[]}

</details>

<details><summary>F2C-008 — If the comment list fails to load, every pin silently disappears; you can still post, and the new comment shows as '1' — no error, no Retry (S2, confirmed)</summary>

- Area designer.comments · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2c-board has 31 schematic threads
  2. route '**/designs/*/comments?**' → 500 (only the list GET, not thread detail/commands)
  3. Home → Designer (design opens on Schem), Fit schematic
  4. Comment tool → click canvas → 'QA-f2c posted while list failed' → Cmd+Enter
  5. unroute; wait 3 s; then Schem → PCB → Schem
- Expected: A visible 'Comments couldn't load · Retry' notice, e.g. a chip on the Comment toolbar button or a banner over the canvas. Posting is disabled, or clearly flagged, while the list is unknown. Pin numbers stay stable.
- Actual: The canvas shows 0 pins, with no banner, toast or indicator. The only trace is a console 500. The design looks as if it had no comments. The Comment tool still works, and the new thread is created (POST 200) and drawn as pin '1'; once the list loads it becomes '32', so the numbers aren't stable identifiers. After unroute nothing refetches (still 1 pin after 3 s). The 31 threads come back only after switching view tabs or reopening the design. useDesignerComments sets `error`, but nothing renders it.
- Screenshots: [089-comments-list-500](../evidence/shots/f2c/dark/089-comments-list-500.png), [090-comments-500-new-pin](../evidence/shots/f2c/dark/090-comments-500-new-pin.png), [084-comments-30-threads](../evidence/shots/f2c/dark/084-comments-30-threads.png), [218-comments-list-500](../evidence/shots/vf2c/dark/218-comments-list-500.png), [219-comments-500-new-pin](../evidence/shots/vf2c/dark/219-comments-500-new-pin.png)
- Console: `Failed to load resource: 500 @ /api/modules/designer/designs/284f64fc…/comments?surface=schematic`
- Network: `GET …/comments?surface=schematic → 500`; `POST …/comments/commands → 200 (new thread rendered as #1)`
- Code: `src/modules/designer/frontend/hooks/useDesignerComments.ts:78` — catch → setError only; `error` is never consumed by Space.tsx:361
- Code: `src/modules/designer/frontend/components/comments/CanvasCommentLayer.tsx:103` — pin number = array index + 1 → renumbers when the list is partial
- Suggested fix: designer/frontend/Space.tsx:361 read comments.error and render it: a danger dot on the Comment toolbar button plus a dismissible canvas banner 'Couldn't load comments · Retry' calling comments.refresh() (useDesignerComments.ts:59-83); also refresh on window focus/online. In CanvasCommentLayer.tsx:103 number pins from a stable per-design sequence (server-side ordinal or createdAt rank) instead of the array index.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): route **/designs/*/comments?** → 500, Designer › QA-f2c-board › Schem: 0 pins, no banner/toast/alert, only a console 500. Comment tool › click › 'vf2c r2 posted while list failed' › Cmd+Enter: posted and drawn as pin '1'. Unroute + 3 s: still 1 pin. Schem → PCB → Schem: 34 pins (1–34), so the new thread was renumbered. grep: comments.error is not read anywhere. Note: the backend swallows cloud comment errors (routes.ts:296-313), so the realistic trigger is a local backend failure. S2 kept for consistency with F1D-003 / F1A-004: the design silently shows no comments (wrong data) and pin numbers are unstable. · evidence: [218-comments-list-500](../evidence/shots/vf2c/dark/218-comments-list-500.png), [219-comments-500-new-pin](../evidence/shots/vf2c/dark/219-comments-500-new-pin.png), GET …/designs/284f64fc…/comments?surface=schematic → 500 (routed), POST …/comments/commands → ok (drawn as #1, later part of 1–34)

</details>


## T-125

**New-comment composer does not take focus — first keystrokes trigger canvas tools (G → GND placement, H → Hole)**

- Severity **S2** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q5-025

**Summary.** Focus stays on BODY (the canvas pointer-up steals it after the useEffect focus()). Typing 'good…' starts GND-port placement (hint 'Click to place · Esc cancel', ghost GND under the cursor); on PCB 'h' activates the Hole tool. Users must click into the box first; otherwise their text drives the editor.

**Root cause.** `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:44` — focus() in mount effect, lost to canvas pointerup

**Proposed fix.** Autofocus the comment composer textarea on open. — Detail: Focus in requestAnimationFrame/setTimeout after the opening pointerup (or use autoFocus + preventDefault on the canvas pointerup in comment mode); while a draft exists, suspend canvas shortcuts.

**Evidence.** [061-schem-comment-composer](../evidence/shots/q5/dark/061-schem-comment-composer.png), [020-pcb-composer-open-focus-body](../evidence/shots/vq5/dark/020-pcb-composer-open-focus-body.png)

<details><summary>Q5-025 — New-comment composer does not take focus — first keystrokes trigger canvas tools (G → GND placement, H → Hole) (S2, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Schem: press C (or click Comment), click empty canvas → composer appears
  2. document.activeElement is BODY; press 'g'
  3. PCB: Add ▾ → Comment, click board → composer; press 'h'
- Expected: Composer textarea is focused immediately (placeholder even says '⌘/Ctrl+Enter to post'), so the user can type right away.
- Actual: Focus stays on BODY (the canvas pointer-up steals it after the useEffect focus()). Typing 'good…' starts GND-port placement (hint 'Click to place · Esc cancel', ghost GND under the cursor); on PCB 'h' activates the Hole tool. Users must click into the box first; otherwise their text drives the editor.
- Screenshots: [061-schem-comment-composer](../evidence/shots/q5/dark/061-schem-comment-composer.png), [062-schem-composer-unfocused-g-hotkey](../evidence/shots/q5/dark/062-schem-composer-unfocused-g-hotkey.png), [076-pcb-composer-unfocused-h-hotkey](../evidence/shots/q5/dark/076-pcb-composer-unfocused-h-hotkey.png)
- Console: `activeElement after composer open: BODY (schematic and PCB)`
- Code: `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:44` — focus() in mount effect, lost to canvas pointerup
- Suggested fix: Focus in requestAnimationFrame/setTimeout after the opening pointerup (or use autoFocus + preventDefault on the canvas pointerup in comment mode); while a draft exists, suspend canvas shortcuts.
- Verification (vq5): **confirmed** — Reproduced on both canvases: after the composer opens, document.activeElement is BODY (PCB and schematic). PCB: pressing 'h' switched the toolbar to 'Hole' with the composer still open. Schematic: pressing 'g' armed GND placement ('Click to place · Esc cancel'). CommentComposerPopup.tsx:47-49 focuses in a mount effect, which the canvas pointer-up steals back. Different root cause from Q5-024 (focus vs. keymap guard); both need fixing. · evidence: [020-pcb-composer-open-focus-body](../evidence/shots/vq5/dark/020-pcb-composer-open-focus-body.png), [021-pcb-composer-unfocused-h](../evidence/shots/vq5/dark/021-pcb-composer-unfocused-h.png), [024-schem-composer-unfocused-g](../evidence/shots/vq5/dark/024-schem-composer-unfocused-g.png)

</details>


## T-126

**Thread status menu (Todo / In progress / Done / Archive) does nothing when clicked — popup closes before the item fires**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q5-026

**Summary.** The popup's document mousedown click-away handler treats the portalled Radix menu as 'outside' and closes the popup; the menu unmounts before onSelect, so no command is sent — API still reports todoStatus 'none' after two attempts. Selecting the same item with the keyboard (↓↓ Enter) works (todoStatus → 'todo', header '2m · Todo'), proving the handler itself is fine.

**Root cause.** `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:199` — onDown click-away ignores portalled menu content

**Proposed fix.** Status menu inside popup: ignore outside-click for Radix popper content (onInteractOutside) so items fire. — Detail: Ignore mousedown targets inside [data-radix-popper-content-wrapper] / use Radix Popover's onInteractOutside, or render the menu with portal={false} inside the popup.

**Evidence.** [069-comment-more-menu](../evidence/shots/q5/dark/069-comment-more-menu.png), [026-comment-more-menu](../evidence/shots/vq5/dark/026-comment-more-menu.png)

<details><summary>Q5-026 — Thread status menu (Todo / In progress / Done / Archive) does nothing when clicked — popup closes before the item fires (S2, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open comment thread #1 on the schematic
  2. Click '…' (More) → click 'In progress' (or 'Todo', 'Archive thread')
  3. GET …/comments?surface=schematic
- Expected: todoStatus becomes in_progress, header shows '· In progress', pin turns to the todo colour; popup stays open.
- Actual: The popup's document mousedown click-away handler treats the portalled Radix menu as 'outside' and closes the popup; the menu unmounts before onSelect, so no command is sent — API still reports todoStatus 'none' after two attempts. Selecting the same item with the keyboard (↓↓ Enter) works (todoStatus → 'todo', header '2m · Todo'), proving the handler itself is fine.
- Screenshots: [069-comment-more-menu](../evidence/shots/q5/dark/069-comment-more-menu.png), [070-comment-status-inprogress](../evidence/shots/q5/dark/070-comment-status-inprogress.png), [071-comment-reopened-todo](../evidence/shots/q5/dark/071-comment-reopened-todo.png)
- Network: `after mouse select: GET …/comments?surface=schematic → 2b9abcd6 resolved none`; `after keyboard select: → 2b9abcd6 resolved todo`
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:199` — onDown click-away ignores portalled menu content
- Suggested fix: Ignore mousedown targets inside [data-radix-popper-content-wrapper] / use Radix Popover's onInteractOutside, or render the menu with portal={false} inside the popup.
- Verification (vq5): **confirmed** — Reproduced: thread #1 -> More -> mouse click 'In progress' -> popup closes, GET …/comments still todoStatus 'todo'. Same item via keyboard (focus + Enter) -> todoStatus 'in_progress'. Root cause CommentThreadPopup.tsx:199-201 document mousedown click-away treats the portalled Radix menu content as outside. Status restored to 'todo' afterwards. · evidence: [026-comment-more-menu](../evidence/shots/vq5/dark/026-comment-more-menu.png), [027-comment-status-click-noop](../evidence/shots/vq5/dark/027-comment-status-click-noop.png), network: after mouse select todoStatus=todo; after keyboard select todoStatus=in_progress

</details>


## T-127

**Posting a reply in a long comment thread gives no visible confirmation: the list stays scrolled at the top and the reply lands ~2400 px below the fold**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: F2C-009

**Summary.** The popup (320×570px, max-h 70%) opens with scrollTop 0 on the 2000-char opening message; the 25 replies are below (scrollHeight 2689 vs 429 visible). After posting, the composer clears but scrollTop stays 0. The new reply's top is at y=3051 while the list's visible range is 348–777, so there's no visible sign the reply posted. Each one-line reply takes ~70px (author row, text, and an always-visible 👍 reaction chip)…

**Root cause.** `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:314` — overflow-y-auto message list; no scroll-to-bottom on open or after addMessage

**Proposed fix.** After posting a reply, scroll thread to bottom and highlight the new reply. — Detail: CommentThreadPopup.tsx: put a ref on the message list (:314) and, after a successful addMessage, scroll the new message into view (listRef.current.scrollTop = listRef.current.scrollHeight). Optionally scroll to the newest/first-unread on open once a thread has more than N messages, add 'N replies' to the header, and show the reaction chip only when a message has reactions (add-reaction on hover).

**Evidence.** [081-comment-thread-2000](../evidence/shots/f2c/dark/081-comment-thread-2000.png), [220-comment-thread-open](../evidence/shots/vf2c/dark/220-comment-thread-open.png)

<details><summary>F2C-009 — Posting a reply in a long comment thread gives no visible confirmation: the list stays scrolled at the top and the reply lands ~2400 px below the fold (S3, confirmed)</summary>

- Area designer.comments · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2c-board › Schem: thread #1 has a 2000-char first message, a 300-char URL reply and 25 short replies
  2. Click pin 1
  3. Scroll the thread to the top, type 'QA-f2c newest reply 26' in 'Reply to thread…', Cmd+Enter
- Expected: The thread opens scrolled to the newest message (or a 'N earlier messages' collapse), and posting a reply scrolls it into view. Short replies are compact, without a permanent reaction chip on each one.
- Actual: The popup (320×570px, max-h 70%) opens with scrollTop 0 on the 2000-char opening message; the 25 replies are below (scrollHeight 2689 vs 429 visible). After posting, the composer clears but scrollTop stays 0. The new reply's top is at y=3051 while the list's visible range is 348–777, so there's no visible sign the reply posted. Each one-line reply takes ~70px (author row, text, and an always-visible 👍 reaction chip), so 25 replies make ~1800px of scroll. The header shows only 'Local · 3m', with no message count. Long text and the unbroken 300-char URL wrap correctly (no horizontal overflow), and the wheel scrolls the popup, not the canvas (good).
- Screenshots: [081-comment-thread-2000](../evidence/shots/f2c/dark/081-comment-thread-2000.png), [083-comment-long-url](../evidence/shots/f2c/dark/083-comment-long-url.png), [085-comment-thread-27-msgs](../evidence/shots/f2c/dark/085-comment-thread-27-msgs.png), [086-comment-thread-27-bottom](../evidence/shots/f2c/dark/086-comment-thread-27-bottom.png), [087-comment-reply-not-scrolled](../evidence/shots/f2c/dark/087-comment-reply-not-scrolled.png), [220-comment-thread-open](../evidence/shots/vf2c/dark/220-comment-thread-open.png), [221-comment-reply-not-scrolled](../evidence/shots/vf2c/dark/221-comment-reply-not-scrolled.png)
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:314` — overflow-y-auto message list; no scroll-to-bottom on open or after addMessage
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:247` — popup max-h-[70%] w-80
- Suggested fix: CommentThreadPopup.tsx: put a ref on the message list (:314) and, after a successful addMessage, scroll the new message into view (listRef.current.scrollTop = listRef.current.scrollHeight). Optionally scroll to the newest/first-unread on open once a thread has more than N messages, add 'N replies' to the header, and show the reaction chip only when a message has reactions (add-reaction on hover).
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): QA-f2c-board › Schem › pin 1 (2008-char opener + replies, 29 items): scrollTop 0, scrollHeight 2828 vs clientHeight 429 (visible 348–777). Posted 'vf2c r2 newest reply' with Cmd+Enter: composer cleared, scrollTop stayed 0, the new reply's top at y=3176 — nothing visible changed. Narrowed: opening at the original message is a defensible convention (GitHub/Figma show the opener first), so the defect is the missing scroll/confirmation after posting (plus no message count). S3 kept. · evidence: [220-comment-thread-open](../evidence/shots/vf2c/dark/220-comment-thread-open.png), [221-comment-reply-not-scrolled](../evidence/shots/vf2c/dark/221-comment-reply-not-scrolled.png)

</details>


## T-128

**Comment pins near the canvas edge are half-clipped instead of becoming edge chips, and nearby pins stack unreadably (no clustering)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate M
- Findings: F2C-010

**Summary.** Threads 2–10 and 12 render as a 60×80px stack over U1's pins and body. Numbers 3, 4, 5 and 7 are fully covered and 6/9 half-covered, so only the topmost thread is clickable without zooming in, and the pins also cover the U1 pin endpoints (clicking there opens a comment instead of starting a wire). On the right edge pins 28 (x 1119–1147) and 11 (1115–1143) are cut in half by the canvas edge at x=1139. On the left edg…

**Root cause.** `src/modules/designer/frontend/components/comments/CanvasCommentLayer.tsx:101` — layer is overflow-hidden; the on-screen test uses the anchor point, not the pin's 28px box → half-clipped pins

**Proposed fix.** Clamp pins to canvas edge as edge chips; offset overlapping pins (simple cluster count badge). — Detail: CanvasCommentLayer.tsx: decide on-screen with the pin box, not the anchor point — treat anchors within the pin size (28 px) of the canvas edge as off-screen so clampToEdge turns them into edge chips (inset by the pin size). Cluster pins whose screen positions fall within ~20 px into one count bubble that zooms/fans out on click. A thread list (menu on the Comment button) would make every thread reachable.

**Evidence.** [084-comments-30-threads](../evidence/shots/f2c/dark/084-comments-30-threads.png), [222-comment-pins-fit](../evidence/shots/vf2c/dark/222-comment-pins-fit.png)

<details><summary>F2C-010 — Comment pins near the canvas edge are half-clipped instead of becoming edge chips, and nearby pins stack unreadably (no clustering) (S3, confirmed)</summary>

- Area designer.comments · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. QA-f2c-board › Schem with 31 threads (10 anchored within ±3 mm of U1, the rest spread over ±45 × ±30 mm)
  2. Fit schematic (zoom 20%)
  3. Inspect the pin cluster on U1 and the right canvas edge
- Expected: Overlapping pins collapse into a count bubble ('10') that expands or zooms on click, or at least stay individually readable. Pins whose anchors are near an edge are fully drawn or turned into edge chips like the left side. Fit can include comment anchors, or offers a 'Fit comments' option.
- Actual: Threads 2–10 and 12 render as a 60×80px stack over U1's pins and body. Numbers 3, 4, 5 and 7 are fully covered and 6/9 half-covered, so only the topmost thread is clickable without zooming in, and the pins also cover the U1 pin endpoints (clicking there opens a comment instead of starting a wire). On the right edge pins 28 (x 1119–1147) and 11 (1115–1143) are cut in half by the canvas edge at x=1139. On the left edge, threads 19 and 30 correctly turn into round off-screen chips, so the two sides behave differently. Fit schematic frames only the parts, which leaves 2 threads off-screen. Pins have no accessible name beyond the number (Q5-031). Dragging a pin works and persists (thread revision 2, new anchor). At 1100×720 (light), after the window shrinks, the U1 cluster's off-screen chips pile into one vertical stack of overlapping circles at the left edge (30, 24, 9, 29 and more hidden underneath). Pins 10, 12 and 4 are half-cut at the left edge and pin 23 at the right edge, and the chips never de-overlap.
- Screenshots: [084-comments-30-threads](../evidence/shots/f2c/dark/084-comments-30-threads.png), [084b-comment-cluster-crop](../evidence/shots/f2c/dark/084b-comment-cluster-crop.png), [084c-comment-right-edge-crop](../evidence/shots/f2c/dark/084c-comment-right-edge-crop.png), [088-comment-pin-drag](../evidence/shots/f2c/dark/088-comment-pin-drag.png), [113-1100-dock-comments-light](../evidence/shots/f2c/light/113-1100-dock-comments-light.png), [222-comment-pins-fit](../evidence/shots/vf2c/dark/222-comment-pins-fit.png), [223-comment-cluster-crop](../evidence/shots/vf2c/dark/223-comment-cluster-crop.png), [224-comment-right-edge-crop](../evidence/shots/vf2c/dark/224-comment-right-edge-crop.png), [233-1100-comment-pins](../evidence/shots/vf2c/light/233-1100-comment-pins.png)
- Code: `src/modules/designer/frontend/components/comments/CanvasCommentLayer.tsx:101` — layer is overflow-hidden; the on-screen test uses the anchor point, not the pin's 28px box → half-clipped pins
- Code: `src/modules/designer/frontend/components/comments/CanvasCommentLayer.tsx:103` — every thread rendered as an individual pin, no clustering
- Suggested fix: CanvasCommentLayer.tsx: decide on-screen with the pin box, not the anchor point — treat anchors within the pin size (28 px) of the canvas edge as off-screen so clampToEdge turns them into edge chips (inset by the pin size). Cluster pins whose screen positions fall within ~20 px into one count bubble that zooms/fans out on click. A thread list (menu on the Comment button) would make every thread reachable.
- Verification (vf2c): **confirmed** — Reproduced on stack B. Dark 1440x900 (dock open, canvas x 341–1139) after Fit: pins 2–10 and 12 sit within x 467–531 / y 429–509 on U1 with several numbers covered; pins 11 (1115–1143) and 28 (1119–1147) are cut by the canvas edge while threads 19 and 30 on the left become round edge chips. Light 1100x720 (canvas 341–799): 11 (779–807) and 28 (781–809) clipped, chip 19 overlaps pin 15. Dropped sub-claim: 'Fit ignores comments' is expected (Fit schematic frames drawing content, as in KiCad/Figma). The 10-thread cluster was seeded via API, so crowding is the weaker half; edge clipping is the clear defect. S3 kept. · evidence: [222-comment-pins-fit](../evidence/shots/vf2c/dark/222-comment-pins-fit.png), [223-comment-cluster-crop](../evidence/shots/vf2c/dark/223-comment-cluster-crop.png), [224-comment-right-edge-crop](../evidence/shots/vf2c/dark/224-comment-right-edge-crop.png), [233-1100-comment-pins](../evidence/shots/vf2c/light/233-1100-comment-pins.png)

</details>


## T-129

**Comment pins/popups on raw violet/orange/slate palette; 2.0–2.4:1 meta text in light**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-023, Q5-030, F1B-023 · known ref K45

**Summary.** Open pin probes #895bf3 (violet, ΔE 69 from nearest token), resolved pin slate-blue #64748b, todo orange #fb923c, done green #22c55e — all hard-coded hex. Popup avatar/links/send icon use bg-violet-600 / text-violet-* classes (only neutral by accident of the palette remap). Avatar shows a '·' placeholder instead of the author's initial; status-bar hint does not change in comment mode. | Also covers: Q5-030: Comment pins/popups use raw violet/orange/green/slate palette, rounded-xl + shadow-2xl ca…; F1B-023: Light theme: PCB comment thread popup timestamps and meta text are 10 px slate-400 on whi…

**Root cause.** `src/modules/designer/frontend/components/comments/comment-style.ts:9` — commentStatusColor returns raw #64748b/#22c55e/#fb923c/#8b5cf6

**Proposed fix.** Comment pins/popups on tokens (no violet/orange), kit card radius/shadow, text-secondary meta (≥4.5:1 light). — Detail: Map commentStatusColor to CSS variables (var(--selection), var(--status-warning), var(--status-success), var(--status-neutral)) and replace violet utility classes in CommentThreadPopup/comment-markdown with token classes; render the author initial in the avatar.

**Evidence.** [084-comment-posted](../evidence/shots/q3/dark/084-comment-posted.png), [024-comment-posted](../evidence/shots/vq3/dark/024-comment-posted.png), [063-schem-comment-thread](../evidence/shots/q5/dark/063-schem-comment-thread.png)

<details><summary>Q3-023 — Schematic comment pins/popups use raw violet/slate/orange/green hex instead of tokens (open pin renders #8b5cf6 violet) (S3, confirmed)</summary>

- Area designer.comments · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: press C, click the canvas, type a comment, ⌘Enter
  2. Look at the pin marker; resolve the thread and look again
- Expected: Pins/avatars/accents use the neutral redesign tokens (e.g. --selection / --text-strong for open, --status-* for todo/done, --status-neutral for resolved)
- Actual: Open pin probes #895bf3 (violet, ΔE 69 from nearest token), resolved pin slate-blue #64748b, todo orange #fb923c, done green #22c55e — all hard-coded hex. Popup avatar/links/send icon use bg-violet-600 / text-violet-* classes (only neutral by accident of the palette remap). Avatar shows a '·' placeholder instead of the author's initial; status-bar hint does not change in comment mode.
- Screenshots: [084-comment-posted](../evidence/shots/q3/dark/084-comment-posted.png), [085-comment-resolved](../evidence/shots/q3/dark/085-comment-resolved.png)
- Pixel probes: {"file": "shots/q3/dark/084-comment-posted.png", "x": 781, "y": 400, "hex": "#895bf3", "nearestToken": "--status-info", "deltaE": 69.5}
- Code: `src/modules/designer/frontend/components/comments/comment-style.ts:9` — commentStatusColor returns raw #64748b/#22c55e/#fb923c/#8b5cf6
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:78` — bg-violet-600 avatar; :140 and :381 violet accents
- Suggested fix: Map commentStatusColor to CSS variables (var(--selection), var(--status-warning), var(--status-success), var(--status-neutral)) and replace violet utility classes in CommentThreadPopup/comment-markdown with token classes; render the author initial in the avatar.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a: posted comment pin probes #895bf3 / #8759ef (ΔE ≈ 69 from the nearest token, --status-info), and the avatar shows a '·' placeholder. Code: commentStatusColor returns raw hex (comment-style.ts:8-13), and CommentThreadPopup uses bg-violet-600 and violet accents (:78, :140). The violet/slate utility classes are neutralised by the D1 remap, but the inline hex is not, so the pin stays visibly violet. K45 confirmed for comments. S3. Side observation, attached to Q3-033: the composer textarea was not focused after opening. · evidence: [024-comment-posted](../evidence/shots/vq3/dark/024-comment-posted.png)

</details>

<details><summary>Q5-030 — Comment pins/popups use raw violet/orange/green/slate palette, rounded-xl + shadow-2xl cards and a '·' placeholder avatar (S3, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark, light · viewports 1440x900
- Repro:
  1. Create a schematic comment (pin #1), open it; set status Todo; resolve; compare dark and light themes
- Expected: Pins and popups follow the neutral EDA tokens: selection/status tokens for state, 2px radii, 1px border, no drop shadows; a meaningful local-user avatar.
- Actual: Pin fills are hard-coded hex in comment-style.ts: open #8b5cf6 (violet, ΔE 70 from nearest token), todo #fb923c (probed #f9913b), done #22c55e, resolved #64748b. Popups carry shadow-2xl (light: #caced4 shadow band under the card on the #f0f4fb canvas) and a raw white background in light theme; avatar initials render '·' when not signed in; author 'Local' repeated in header and first message; error text rose-500. (Radius and the violet avatar/link/Send classes render as 2px/neutral through the PLAN D1 remap.)
- Screenshots: [063-schem-comment-thread](../evidence/shots/q5/dark/063-schem-comment-thread.png), [072-comment-offscreen-chip](../evidence/shots/q5/dark/072-comment-offscreen-chip.png), [107-schem-thread-popup](../evidence/shots/q5/light/107-schem-thread-popup.png)
- Pixel probes: {"file": "shots/q5/dark/063-schem-comment-thread.png", "x": 693, "y": 404, "hex": "#8a5bf4", "nearestToken": "--status-info", "deltaE": 70.0}; {"file": "shots/q5/light/107-schem-thread-popup.png", "x": 700, "y": 400, "hex": "#f8903b", "nearestToken": "--net-bus", "deltaE": 25.7}; {"file": "shots/q5/light/107-schem-thread-popup.png", "x": 876, "y": 842, "hex": "#caced4", "nearestToken": "shadow band vs canvas #f0f4fb", "deltaE": 0}
- Code: `src/modules/designer/frontend/components/comments/comment-style.ts:8` — hex palette
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:268` — rounded-xl shadow-2xl slate classes
- Code: `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:80` — rounded-xl shadow-2xl
- Code: `src/modules/designer/frontend/components/comments/comment-format.ts:29` — initialsFrom(null) → '·'
- Suggested fix: Map pin states to tokens (open=--selection, todo=--status-warning, done=--status-success, resolved=--status-neutral); restyle popups with --menu-bg/--menu-border, 2px radius, no shadow; show a user glyph (e.g. lucide User) for the local author and drop the duplicated header author.
- Verification (vq5): **confirmed** — Partially re-scoped. Confirmed off-token: pin fills are raw hex in comment-style.ts:8-13 (open #8b5cf6 violet — the accent the redesign removed, todo #fb923c probed #f9913b in light, done #22c55e, resolved #64748b); popups carry shadow-2xl (computed '0 25px 50px -12px rgba(0,0,0,.25)', light probe #caced4 band on #f0f4fb canvas); light popup bg is raw white; avatar initials '·' for the local author (comment-format.ts:29); 'Local' repeated; error text rose-500. Refuted by the D1 remap (computed styles): popups are 2px radius (rounded-xl -> --radius-xl 2px), avatars/links/Send use remapped violet-600 = rgb(58,58,64) neutral, not violet. · evidence: [025-schem-thread-popup](../evidence/shots/vq5/dark/025-schem-thread-popup.png), [007-schem-thread-popup](../evidence/shots/vq5/light/007-schem-thread-popup.png), computed: popup border-radius 2px, avatar bg rgb(58,58,64), box-shadow 0 25px 50px -12px rgba(0,0,0,0.25), probe: light pin #f9913b

</details>

<details><summary>F1B-023 — Light theme: PCB comment thread popup timestamps and meta text are 10 px slate-400 on white — 2.0–2.4:1 contrast (unreadable 'now' / '9m') (S3, duplicate)</summary>

- Area designer.comments · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes light, dark · viewports 1440x900
- Repro:
  1. QA-f1b-long → PCB → Add ▾ → Comment, click the board, post a comment
  2. Switch to light theme (localStorage theme=light, reload), open the design → PCB, click the pin '1'
  3. Read the header/message timestamps ('9m'), 'deleted' and 'No messages yet.' labels
- Expected: Meta text uses --text-tertiary/--text-secondary tokens and reaches ≥4.5:1 (or ≥3:1 at minimum) on the popup background in both themes.
- Actual: Popup body is #ffffff; timestamps render #b5b5b9–#bcbcc0 (text-[10px] text-slate-400 → remapped #a8a8ad) = 2.04–2.37:1. In dark the same span is #a1a1a6 on #111113 (≈7:1), so the problem is light-only. The avatar is a fixed dark disc (#3a3a40 light / #505056 dark, bg-violet-600 remapped) with a '·' placeholder; the pin stays violet #895bf3 in both themes (raw palette already reported in Q5-030/Q3-023 — this finding is the measured light-theme contrast failure).
- Screenshots: [011-comment-popup](../evidence/shots/f1b/light/011-comment-popup.png), [091-pcb-comment-posted](../evidence/shots/f1b/dark/091-pcb-comment-posted.png)
- Pixel probes: {"file": "shots/f1b/light/011-comment-popup.png", "x": 700, "y": 600, "hex": "#ffffff", "nearestToken": "--surface-input", "deltaE": 0}; {"file": "shots/f1b/light/011-comment-popup.png", "x": 628, "y": 543, "hex": "#b5b5b9", "nearestToken": "--text-disabled", "deltaE": 3.0}; {"file": "shots/f1b/light/011-comment-popup.png", "x": 554, "y": 548, "hex": "#895bf3", "nearestToken": "--status-info", "deltaE": 59.8}
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:105` — timestamp 'shrink-0 text-[10px] text-slate-400'
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:257` — 'text-[10px] text-slate-400' meta line
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:78` — avatar bg-violet-600
- Suggested fix: Replace text-slate-400 with text-text-tertiary (or text-text-secondary for 10 px), raise to text-2xs (10 px min is fine) and migrate the popup to tokens (bg-menu-bg/border-menu-border, avatar bg-surface-control text-text-secondary) as part of Q5-030.
- Verification (vf1b): **duplicate** — Measurement reproduced in light on QA-f1b-long: the comment popup body is #ffffff and the timestamps '2h' are computed rgb(168,168,173) (text-slate-400 remapped by D1) at 10 px = 2.37:1. The root cause is the unmigrated raw-palette CommentThreadPopup, already verified as Q5-030 (K45: comment popups on raw palette / raw white light background; fix = restyle with tokens). Fold the contrast measurement into Q5-030. When migrating, use text-text-secondary for the 10 px meta text, since --text-tertiary on white is only 3.9:1. Side note: the stored comment text on this pin is missing its hotkey letters ('QA cen: cec e lng ne…'). That is the textarea-hotkey defect already verified as Q4-019/Q5-024, not a new issue. · evidence: [003-comment-popup](../evidence/shots/vf1b/light/003-comment-popup.png), [003b-comment-popup-zoom](../evidence/shots/vf1b/light/003b-comment-popup-zoom.png), DOM: timestamp color rgb(168,168,173) 10px on #ffffff

</details>


## T-130

**Comment list for a cloud-linked design blocks on an un-timed cloud fetch (12 s per request when the cloud host doesn't answer)**

- Severity **S4** · category perf · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope backend · estimate S
- Findings: Q10-009

**Summary.** 200 after 12.08 s (baseline without cloud headers: 0.001 s). pullCloudCommentsIntoLocal is awaited before listing local threads, with no AbortSignal timeout, and then does one more awaited fetch per thread. The frontend sends these headers on every comments GET whenever the user is signed in with project sync on, so every surface switch / refresh of a linked design's comments stalls while the network is black-holed.…

**Root cause.** `src/modules/designer/backend/routes.ts:3062` — await pullCloudCommentsIntoLocal(...) before listing local threads

**Proposed fix.** Comment list: timeout cloud pull, don't block local list (dev flag cloud.comments). — Detail: In routes.ts serve local threads immediately and run pullCloudCommentsIntoLocal in the background (void … .catch()), pushing updates via the existing comment refresh/broadcast; or at minimum add signal: AbortSignal.timeout(2500) to both fetches and parallelise the per-thread detail fetches.

**Note.** Dev-only flag; becomes S2 when cloud.comments graduates.

**Evidence.** `network: GET /api/modules/designer/designs/3f9e4e24…/comments?surface=schematic (x-cloud-api-url: http://10.255.255.1) → 200 in 12.08 s`

<details><summary>Q10-009 — Comment list for a cloud-linked design blocks on an un-timed cloud fetch (12 s per request when the cloud host doesn't answer) (S4, confirmed)</summary>

- Area designer.comments · stack C1 · design 3f9e4e24 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1 backend; design 3f9e4e24 has a cloud link row
  2. curl -H 'x-cloud-bearer: fake' -H 'x-cloud-api-url: http://10.255.255.1' 'http://127.0.0.1:3300/api/modules/designer/designs/3f9e4e24-…/comments?surface=schematic' (a non-refusing, unreachable host = typical captive-portal / no-route offline)
  3. Compare with the same request without cloud headers
- Expected: Local comments are returned immediately; the cloud pull is either backgrounded or bounded by a short timeout (≈2–3 s) and skipped while offline.
- Actual: 200 after 12.08 s (baseline without cloud headers: 0.001 s). pullCloudCommentsIntoLocal is awaited before listing local threads, with no AbortSignal timeout, and then does one more awaited fetch per thread. The frontend sends these headers on every comments GET whenever the user is signed in with project sync on, so every surface switch / refresh of a linked design's comments stalls while the network is black-holed. (With the C1 dead port the connection is refused instantly, so the UI stays fast there.)
- Network: `GET /api/modules/designer/designs/3f9e4e24…/comments?surface=schematic (x-cloud-api-url: http://10.255.255.1) → 200 in 12.08 s`; `same without cloud headers → 200 in 0.001 s`; `POST /designs/:id/commands with cloud headers is fire-and-forget (store.ts:898 `void mirrorCommand`) — not affected`
- Code: `src/modules/designer/backend/routes.ts:3062` — await pullCloudCommentsIntoLocal(...) before listing local threads
- Code: `src/modules/designer/backend/routes.ts:296` — fetch without AbortSignal.timeout; per-thread sequential fetches
- Code: `src/modules/designer/frontend/Space.tsx:358` — comment requests carry cloud headers only when cloud.comments (dev) is on
- Suggested fix: In routes.ts serve local threads immediately and run pullCloudCommentsIntoLocal in the background (void … .catch()), pushing updates via the existing comment refresh/broadcast; or at minimum add signal: AbortSignal.timeout(2500) to both fetches and parallelise the per-thread detail fetches.
- Verification (vq10): **confirmed** — Re-measured with a local TCP listener that accepts and never answers (x-cloud-api-url http://127.0.0.1:18999): GET /designs/3f9e4e24…/comments did not return within curl's 40 s limit (worse than q10's 12 s), versus 0.001 s with no cloud headers. The 10.255.255.1 black-hole q10 used is now rejected in 15 ms on this network. Code confirmed: routes.ts:3062 awaits pullCloudCommentsIntoLocal before listing, and :296 fetches have no timeout plus sequential per-thread fetches. Downgraded S3→S4 because the frontend only sends cloud headers on comments requests when cloud.comments is enabled (Space.tsx commentsCloudHeaders), and that flag is 'dev', so release builds are unaffected. This becomes S2 (comments never load on flaky networks) when the flag graduates. · evidence: curl: hanging host → 000 after 40.00 s (timeout); no cloud headers → 200 in 0.0012 s, src/modules/designer/frontend/Space.tsx:358 commentsCloudHeaders gated by cloud.comments

</details>


## T-131

**Comment a11y/UX gaps: pins named only by number, unlabelled attachment-remove button, image-only reply impossible, recenter jumps zoom to 80%**

- Severity **S4** · category a11y · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q5-031

**Summary.** Pins and edge chips expose only '1' (details are in title only); the attachment remove (X) button has no name; Send stays disabled with an image attached until text is typed (no hint); non-image files (sample.md) are rejected with 'Only PNG, JPEG, or WebP images.' (fine) but the attach button tooltip doesn't say so; clicking the off-screen chip recentres and changes zoom from 11% to 80%.

**Root cause.** `src/modules/designer/frontend/components/comments/CommentPin.tsx:58` — no aria-label (name '1', title only)

**Proposed fix.** Pins named 'Comment by X: excerpt', label attachment remove, allow image-only reply, recenter keeps zoom. — Detail: aria-label on pins/chips; aria-label='Remove attachment'; allow submit when file is set; keep zoom when recentring.

**Evidence.** [064-comment-attach-md-rejected](../evidence/shots/q5/dark/064-comment-attach-md-rejected.png), [025-schem-thread-popup](../evidence/shots/vq5/dark/025-schem-thread-popup.png)

<details><summary>Q5-031 — Comment a11y/UX gaps: pins named only by number, unlabelled attachment-remove button, image-only reply impossible, recenter jumps zoom to 80% (S4, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open thread → Attach image → choose a PNG → leave text empty
  2. Inspect pin/offscreen chip accessible names
  3. Pan until pin is off-screen, click the edge chip
- Expected: Pins announce 'Comment 1 by Local, 3 messages'; the attachment chip's remove button is labelled; an image can be posted without text; recenter keeps the current zoom.
- Actual: Pins and edge chips expose only '1' (details are in title only); the attachment remove (X) button has no name; Send stays disabled with an image attached until text is typed (no hint); non-image files (sample.md) are rejected with 'Only PNG, JPEG, or WebP images.' (fine) but the attach button tooltip doesn't say so; clicking the off-screen chip recentres and changes zoom from 11% to 80%.
- Screenshots: [064-comment-attach-md-rejected](../evidence/shots/q5/dark/064-comment-attach-md-rejected.png), [065-comment-attach-png-send-disabled](../evidence/shots/q5/dark/065-comment-attach-png-send-disabled.png), [073-comment-offscreen-recenter](../evidence/shots/q5/dark/073-comment-offscreen-recenter.png)
- Code: `src/modules/designer/frontend/components/comments/CommentPin.tsx:58` — no aria-label (name '1', title only)
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:331` — attachment remove button unlabelled
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:231` — submit requires non-empty body even with a file
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1011` — recenter forces zoom >= 40 and skips onZoomChange
- Suggested fix: aria-label on pins/chips; aria-label='Remove attachment'; allow submit when file is set; keep zoom when recentring.
- Verification (vq5): **confirmed** — Code + a11y tree confirmed: pin button accessible name '1' (title 'Local · 3 messages', no aria-label); attachment remove button has only an X icon (CommentThreadPopup.tsx:331-337); submit() returns early when body is empty even with a file (:231-233). Recenter: SchematicCanvas.tsx:1002-1015 forces camera.zoom >= 40 (80% readout) and does not call onZoomChange, so the status-bar zoom readout also goes stale. Attach-tooltip wording not re-checked (S4, accepted from q5 screenshots). · evidence: [025-schem-thread-popup](../evidence/shots/vq5/dark/025-schem-thread-popup.png), snapshot: button "1" title='Local · 3 messages'

</details>

