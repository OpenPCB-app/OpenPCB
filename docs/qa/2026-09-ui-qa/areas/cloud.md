# cloud — QA findings

[← index](../README.md) · 4 triage entries · S1 0 · S2 2 · S3 0 · S4 2

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-387](#t-387) | S2 | Sign out does nothing while the cloud is unreachable — session stays, no feedback | Q10-002 | fix-now | C2 / W2 | frontend | XS |
| [T-388](#t-388) | S2 | No offline state: perpetual 'cloud: …' badge / 'Cloud sync on' while cloud unreachable; developer-style badge text | Q10-006, Q10-018 | fix-now | D1+C1 / W2 | frontend | M |
| [T-389](#t-389) | S4 | Realtime websocket reconnect loop logs a console error every ~10 s forever while a linked design is open offline | Q10-008 | defer | followup / followup | frontend | S |
| [T-390](#t-390) | S4 | 'Open from Cloud' dialog offline: raw 'Failed to fetch' above a contradictory empty state pointing to a non-existent 'Link to Cloud' button; no retry, no Esc, no dialog semantics | Q10-010 | defer | followup / followup | frontend | S |

## T-387

**Sign out does nothing while the cloud is unreachable — session stays, no feedback**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q10-002

**Summary.** Nothing changes: page still says 'Signed in as qa-q10@example.test · Plan: Pro', localStorage session still present, no error or toast. Network: POST <supabase>/auth/v1/logout?scope=global fails ×2; console 'TypeError: Failed to fetch' from SupabaseAuthClient._signOut. A user who cannot reach the cloud cannot sign out at all (e.g. to hand the machine to someone else, or to stop sync attempts).

**Root cause.** `src/core/frontend/src/cloud/AuthProvider.tsx:198` — signOut(): await sb.auth.signOut(); the returned { error } is ignored

**Proposed fix.** Sign out always clears local session (ignore network error from signOut) and confirms with toast. — Detail: In AuthProvider.signOut: const { error } = await sb.auth.signOut(); if (error) await sb.auth.signOut({ scope: 'local' }); (or always sign out with scope 'local' and fire the global revoke best-effort). Show a pending state on the button and a non-blocking note if server revocation failed.

**Note.** File FE/cloud/AuthProvider.tsx (unowned) assigned to C2.

**Evidence.** [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [021-account-signedin-offline](../evidence/shots/vq10/dark/021-account-signedin-offline.png)

<details><summary>Q10-002 — Sign out does nothing while the cloud is unreachable — session stays, no feedback (S2, confirmed)</summary>

- Area cloud · stack C1 · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack C1 (cloud URLs dead). Be signed in: a session previously established (simulated here by writing a valid-shaped Supabase session to localStorage 'openpcb.auth' — equivalent to a user who signed in yesterday and is now offline)
  2. Settings → Account
  3. Click 'Sign out', wait 4 s
- Expected: Sign-out always succeeds locally (clears the session and returns to the signed-out Account view), even with no network; server-side revocation is best-effort.
- Actual: Nothing changes: page still says 'Signed in as qa-q10@example.test · Plan: Pro', localStorage session still present, no error or toast. Network: POST <supabase>/auth/v1/logout?scope=global fails ×2; console 'TypeError: Failed to fetch' from SupabaseAuthClient._signOut. A user who cannot reach the cloud cannot sign out at all (e.g. to hand the machine to someone else, or to stop sync attempts).
- Screenshots: [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [084-C1-account-signout-offline](../evidence/shots/q10/dark/084-C1-account-signout-offline.png)
- Console: `[ERROR] Failed to load resource: net::ERR_UNSAFE_PORT @ http://127.0.0.1:9/auth/v1/logout?scope=global`; `[ERROR] TypeError: Failed to fetch at SupabaseAuthClient._useSession / _signOut`
- Network: `POST http://127.0.0.1:9/auth/v1/logout?scope=global → FAILED (×2)`
- Code: `src/core/frontend/src/cloud/AuthProvider.tsx:198` — signOut(): await sb.auth.signOut(); the returned { error } is ignored
- Code: `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3190` — non-401/403/404 errors return before _removeSession()
- Code: `src/core/frontend/src/settings/panels/account/AccountSignedIn.tsx:48` — Sign out button: no pending/error state
- Suggested fix: In AuthProvider.signOut: const { error } = await sb.auth.signOut(); if (error) await sb.auth.signOut({ scope: 'local' }); (or always sign out with scope 'local' and fire the global revoke best-effort). Show a pending state on the button and a non-blocking note if server revocation failed.
- Verification (vq10): **confirmed** — Reproduced with the simulated session: Settings → Account → Sign out; after 4 s the panel still reads 'Signed in as qa-q10@example.test', localStorage 'openpcb.auth' still present, no feedback; console TypeError: Failed to fetch in GoTrueAdminApi.signOut/_signOut. Not a fake-session artefact: auth-js _signOut returns early without _removeSession() for any error that is not an AuthApiError 401/403/404, and a real user whose 1-hour access token has expired hits the same early return from the failed refresh inside _useSession. AuthProvider.signOut ignores the returned error. · evidence: [021-account-signedin-offline](../evidence/shots/vq10/dark/021-account-signedin-offline.png), [024-account-after-signout-offline](../evidence/shots/vq10/dark/024-account-after-signout-offline.png), console: TypeError: Failed to fetch at GoTrueAdminApi.signOut → SupabaseAuthClient._signOut

</details>


## T-388

**No offline state: perpetual 'cloud: …' badge / 'Cloud sync on' while cloud unreachable; developer-style badge text**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1+C1 · wave W2 · scope frontend · estimate M
- Findings: Q10-006, Q10-018

**Summary.** Home footer: 'Cloud sync on' + 'Manage sync'; Home status bar simultaneously says 'Local' (hardcoded). Designer header badge: 'cloud: …' with tooltip 'Syncing to cloud…' forever (link POST failed with 500 once, a 3-s toast appeared, badge never changes, no retry — auto-link is attempted once per mount). Account page: 'Signed in to OpenPCB Cloud · Plan: Pro' with no connectivity status. Assistant model pill shows a g… | Also covers: Q10-018: Designer cloud status is developer-style text ('cloud: …', 'cloud: rev 33', 'cloud: error…

**Root cause.** `src/modules/designer/frontend/components/CloudSyncBadge.tsx:124` — !link && !linking → 'cloud: …' titled 'Syncing to cloud…' even after the link attempt failed; attemptedRef prevents any retry

**Proposed fix.** Cloud reachability store; CloudSyncBadge states Offline/Error/Synced in user copy, focusable with Retry; Home footer + rail glyph read same store (C1). — Detail: Add a small cloud-reachability store (probe cloudApi.health() on sign-in, on window 'online'/'offline' events and after any cloud request failure with backoff). Drive HomeSidebar footer, LeftSidebar glyph, CloudSyncBadge and Account from it: badge states 'cloud: offline' (warning token, tooltip with last error + Retry) instead of 'cloud: …'; retry linking when reachability returns. Replace the hardcoded Home status 'Local' with the same status. Memoize the designer api/cloudHeaders so cloud-link is fetched once.

**Evidence.** [040-C1-home-signedin-offline](../evidence/shots/q10/dark/040-C1-home-signedin-offline.png), [020-home-signedin-offline](../evidence/shots/vq10/dark/020-home-signedin-offline.png), [020-C1-designer-schem-signedout](../evidence/shots/q10/dark/020-C1-designer-schem-signedout.png)

<details><summary>Q10-006 — No offline state anywhere: 'Cloud sync on' and a perpetual 'cloud: …' (Syncing to cloud…) badge while the cloud is unreachable (S2, confirmed)</summary>

- Area cloud · stack C1 · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1, signed in (simulated session), project sync on (default)
  2. Home: look at the filters sidebar footer and the status bar
  3. Open 'Dual LED Blinker' in Designer; wait 30 s; hover the 'cloud: …' text next to 'Open from Cloud'
  4. Settings → Account
  5. Linked variant: give a design a cloud link (here: row inserted into designer_cloud_link for 3f9e4e24), open it, select R1 in Outline, press R; watch the badge; reload
- Expected: When the cloud cannot be reached the UI says so (e.g. 'Offline — changes stay local, will sync when reconnected' / 'Cloud unreachable · Retry'), consistently in Home footer, designer badge, rail and Account page.
- Actual: Home footer: 'Cloud sync on' + 'Manage sync'; Home status bar simultaneously says 'Local' (hardcoded). Designer header badge: 'cloud: …' with tooltip 'Syncing to cloud…' forever (link POST failed with 500 once, a 3-s toast appeared, badge never changes, no retry — auto-link is attempted once per mount). Account page: 'Signed in to OpenPCB Cloud · Plan: Pro' with no connectivity status. Assistant model pill shows a green status dot for the OpenPCB Cloud provider. The rail's 'Local only' glyph disappears once a session exists, so nothing in the shell hints at offline. Opening the design also fires 8 duplicate GET /cloud-link requests. Linked design (555 Timer LED Blinker with a cloud link row, last_synced_revision 33): every edit applies locally (POST /commands 200 in 14 ms — good) but the fire-and-forget mirror fails (backend log 'cloud-sync: network error'); the badge keeps showing green 'cloud: rev 33' (tooltip 'Cloud rev: 33 (linked 11111111…)') for the rest of the session. Only after a full reload does it switch to 'cloud: error (1×)' with tooltip 'Last error: Unable to connect. Is the computer able to access the url?', and the count then stays at 1× while the DB already has failed_attempts=2. There is no queued-changes indication and no way to retry.
- Screenshots: [040-C1-home-signedin-offline](../evidence/shots/q10/dark/040-C1-home-signedin-offline.png), [041-C1-designer-signedin-offline](../evidence/shots/q10/dark/041-C1-designer-signedin-offline.png), [043-C1-sync-badge-stuck](../evidence/shots/q10/dark/043-C1-sync-badge-stuck.png), [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [094-C1-copilot-send-13s](../evidence/shots/q10/dark/094-C1-copilot-send-13s.png), [100-C1-linked-design-open](../evidence/shots/q10/dark/100-C1-linked-design-open.png), [101-C1-linked-after-edit-badge-stale](../evidence/shots/q10/dark/101-C1-linked-after-edit-badge-stale.png), [102-C1-linked-badge-error-after-reload](../evidence/shots/q10/dark/102-C1-linked-badge-error-after-reload.png)
- Console: `Failed to load resource: 500 @ /designs/c2c58a19…/cloud-link`
- Network: `POST /designs/c2c58a19…/cloud-link → 500 'Unable to connect…' (once)`; `GET /designs/c2c58a19…/cloud-link ×8 on one design open`
- Pixel probes: {"file": "shots/q10/dark/101-C1-linked-after-edit-badge-stale.png", "x": 1288, "y": 19, "hex": "#66ae70", "nearestToken": "--status-success", "deltaE": 7.0}; {"file": "shots/q10/dark/102-C1-linked-badge-error-after-reload.png", "x": 1258, "y": 19, "hex": "#d4a040", "nearestToken": "--status-warning", "deltaE": 2.0}
- Code: `src/modules/designer/frontend/components/CloudSyncBadge.tsx:124` — !link && !linking → 'cloud: …' titled 'Syncing to cloud…' even after the link attempt failed; attemptedRef prevents any retry
- Code: `src/core/frontend/src/screens/home/HomeSidebar.tsx:33` — status derived from prefs + session only, no reachability
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:527` — status bar hardcodes 'Local'
- Code: `src/modules/designer/frontend/components/CloudSyncBadge.tsx:53` — refresh() only runs on mount/designId/api change — never after commands
- Code: `src/modules/designer/backend/cloud-sync.ts:128` — recordSyncOutcome stores failed_attempts/last_error but nothing pushes it to the UI
- Suggested fix: Add a small cloud-reachability store (probe cloudApi.health() on sign-in, on window 'online'/'offline' events and after any cloud request failure with backoff). Drive HomeSidebar footer, LeftSidebar glyph, CloudSyncBadge and Account from it: badge states 'cloud: offline' (warning token, tooltip with last error + Retry) instead of 'cloud: …'; retry linking when reachability returns. Replace the hardcoded Home status 'Local' with the same status. Memoize the designer api/cloudHeaders so cloud-link is fetched once.
- Verification (vq10): **confirmed** — Reproduced with the simulated session. Home: sidebar footer 'Cloud sync on / Manage sync' while the status bar says 'Local'; the rail's 'Local only' glyph is gone. Designer (Dual LED Blinker, no link): after the auto-link POST /cloud-link → 500 the badge reads 'cloud: …' titled 'Syncing to cloud…' and was unchanged after 30 s; opening the design fired 9 GET /cloud-link plus 1 POST. Linked design 555 Timer (designer_cloud_link row): the badge showed 'cloud: error (2×)' (#d9a441 warning, 10 px); rotating R1 (POST /commands 200) raised the DB's failed_attempts to 3 (backend log 'cloud-sync: network error'), but the badge stayed at '2×'. It is stale for the rest of the session because refresh() only runs on mount/designId/api change. Code-confirmed: attemptedRef blocks retries, and there is no reachability state anywhere. The dock model pill shows a green dot for openpcb-fast. Ships (cloud.sync is 'all'). · evidence: [020-home-signedin-offline](../evidence/shots/vq10/dark/020-home-signedin-offline.png), [040-linked-design-open](../evidence/shots/vq10/dark/040-linked-design-open.png), [035-designer-badge-after30s](../evidence/shots/vq10/dark/035-designer-badge-after30s.png), [035-badge-zoom](../evidence/shots/vq10/dark/035-badge-zoom.png), [041-linked-design-open](../evidence/shots/vq10/dark/041-linked-design-open.png), [080-dock-paused-task](../evidence/shots/vq10/dark/080-dock-paused-task.png), DB (read-only): designer_cloud_link.failed_attempts 2 → 3 after edit; badge text still 'cloud: error (2×)', network: GET …/cloud-link ×9 + POST …/cloud-link 500 on one design open

</details>

<details><summary>Q10-018 — Designer cloud status is developer-style text ('cloud: …', 'cloud: rev 33', 'cloud: error (1×)') and neither it nor the signed-out 'Local' chip is actionable (S4, confirmed)</summary>

- Area designer.shell · stack C1 · design c2c58a19 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack C1 signed out: designer header shows 'Local' (title 'Not signed in — local only'); click it
  2. Signed in (simulated): header shows 'Open from Cloud' + 'cloud: …' / 'cloud: rev 33' / 'cloud: error (1×)'; click it
- Expected: A kit status chip with an icon and sentence-case label (e.g. 'Synced', 'Syncing…', 'Offline', 'Sync error') that opens a small popover/Settings → Account with details and Retry; the signed-out chip offers 'Sign in to sync' like the Home footer does.
- Actual: Plain 10 px lowercase 'cloud: …' strings with state only in the title tooltip (raw error text), not focusable/clickable; 'Local' chip is a non-interactive span even when cloud sign-in is available (Home footer has a 'Sign in to sync' link; rail glyph is role=img). Same fact is expressed differently in Home footer ('Cloud sync on'), status bar ('Local') and designer ('cloud: …'). Related: Q1-019 covers the 'not signed in' wording when cloud is disabled.
- Screenshots: [020-C1-designer-schem-signedout](../evidence/shots/q10/dark/020-C1-designer-schem-signedout.png), [041-C1-designer-signedin-offline](../evidence/shots/q10/dark/041-C1-designer-signedin-offline.png), [100-C1-linked-design-open](../evidence/shots/q10/dark/100-C1-linked-design-open.png), [102-C1-linked-badge-error-after-reload](../evidence/shots/q10/dark/102-C1-linked-badge-error-after-reload.png)
- Code: `src/modules/designer/frontend/components/CloudSyncBadge.tsx:104` — 'cloud: signed-out' / 'sync off' / '…' / 'rev N' / 'error (N×)' spans
- Code: `src/modules/designer/frontend/Space.tsx:1261` — 'Local' span, not interactive
- Suggested fix: Replace CloudSyncBadge output with the kit StatusChip (icon + label: Synced / Syncing… / Offline / Sync error / Sync off) as a button opening openSettings('account') (or a popover with last error + Retry); make the signed-out 'Local' chip a button 'Local · Sign in' when readCloudConfig().enabled.
- Verification (vq10): **confirmed** — Confirmed: the badge is a non-focusable span (tabIndex -1), 10 px, lowercase 'cloud: …' / 'cloud: error (2×)' with state only in the title. The signed-out 'Local' chip is a plain span titled 'Not signed in — local only'. The same fact is worded three ways across Home footer / status bar / designer. Related but distinct: Q10-006 (no offline state / stale badge) and Q1-019 (three local indicators). · evidence: [001-pcb-signedout](../evidence/shots/vq10/dark/001-pcb-signedout.png), [035-badge-zoom](../evidence/shots/vq10/dark/035-badge-zoom.png), [041-linked-design-open](../evidence/shots/vq10/dark/041-linked-design-open.png), dom: SPAN 'cloud: …' title 'Syncing to cloud…' tabIndex=-1 font-size 10px

</details>


## T-389

**Realtime websocket reconnect loop logs a console error every ~10 s forever while a linked design is open offline**

- Severity **S4** · category console · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope frontend · estimate S
- Findings: Q10-008

**Summary.** 'WebSocket connection to ws://<supabase>/realtime/v1/websocket?apikey=<anon>&vsn=… failed' — 5 → 8 → 11 errors over 60 s (≈6/min, ≈360/hour) with no end; the channels are opened by CloudPresenceIndicator (cloud.presence) and the comment-broadcast subscription in designer Space.

**Root cause.** `src/core/frontend/src/cloud/use-presence.ts:47` — sb.channel(...) … .subscribe(status) only handles SUBSCRIBED

**Proposed fix.** Realtime reconnect backoff + status handling (dev flag cloud.presence/comments). — Detail: In use-presence.ts and the Space.tsx comment channel, pass a subscribe((status) => …) handler: on CHANNEL_ERROR/TIMED_OUT after N attempts call sb.removeChannel(channel) and re-subscribe only on window 'online' or when the reachability store (see Q10-006) reports the cloud back; optionally configure realtime reconnectAfterMs with a longer cap.

**Note.** Dev-only flags; fix before graduation.

**Evidence.** [100-C1-linked-design-open](../evidence/shots/q10/dark/100-C1-linked-design-open.png)

<details><summary>Q10-008 — Realtime websocket reconnect loop logs a console error every ~10 s forever while a linked design is open offline (S4, confirmed)</summary>

- Area cloud · stack C1 · design 3f9e4e24 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1, signed in (simulated), open a cloud-linked design (555 Timer LED Blinker with a designer_cloud_link row)
  2. Leave it open; read console errors at t=0, +30 s, +60 s
- Expected: Realtime (presence/comment broadcast) backs off and stops after a few failures while offline, resuming on the 'online' event; no unbounded console noise.
- Actual: 'WebSocket connection to ws://<supabase>/realtime/v1/websocket?apikey=<anon>&vsn=… failed' — 5 → 8 → 11 errors over 60 s (≈6/min, ≈360/hour) with no end; the channels are opened by CloudPresenceIndicator (cloud.presence) and the comment-broadcast subscription in designer Space.
- Screenshots: [100-C1-linked-design-open](../evidence/shots/q10/dark/100-C1-linked-design-open.png)
- Console: `[ERROR] WebSocket connection to 'ws://127.0.0.1:9/realtime/v1/websocket?apikey=<anon key redacted>…' failed (repeats ~every 10 s)`
- Code: `src/core/frontend/src/cloud/use-presence.ts:47` — sb.channel(...) … .subscribe(status) only handles SUBSCRIBED
- Code: `src/modules/designer/frontend/Space.tsx:393` — comment broadcast channel .subscribe() with no status handler
- Code: `src/core/contracts/feature-flags/registry.ts:56` — cloud.presence / cloud.comments availability 'dev'
- Suggested fix: In use-presence.ts and the Space.tsx comment channel, pass a subscribe((status) => …) handler: on CHANNEL_ERROR/TIMED_OUT after N attempts call sb.removeChannel(channel) and re-subscribe only on window 'online' or when the reachability store (see Q10-006) reports the cloud back; optionally configure realtime reconnectAfterMs with a longer cap.
- Verification (vq10): **confirmed** — Reproduced: with the linked 555 design open, console WebSocket errors to ws://127.0.0.1:9/realtime/v1/websocket went 4 → 10 in about 65 s (≈6/min, no backoff cap). Downgraded S3→S4 because both channels are behind dev-only flags and never open in release builds: CloudPresenceIndicator (cloud.presence 'dev') and the Space.tsx comment-broadcast effect (cloud.comments 'dev'), registry.ts availability 'dev'. The bare .subscribe() with no status handling is confirmed in code, so this becomes real console/reconnect noise once those flags graduate. · evidence: verify/vq10-console1.txt, verify/vq10-console2.txt, console: [ERROR] WebSocket connection to 'ws://127.0.0.1:9/realtime/v1/websocket?…' failed (4 → 10 in ~65 s)

</details>


## T-390

**'Open from Cloud' dialog offline: raw 'Failed to fetch' above a contradictory empty state pointing to a non-existent 'Link to Cloud' button; no retry, no Esc, no dialog semantics**

- Severity **S4** · category error-handling · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope frontend · estimate S
- Findings: Q10-010 · known ref K45

**Summary.** Red banner 'Failed to fetch' AND below it 'No cloud designs in your personal workspace yet. Use “Link to Cloud” on a local design first.' — contradictory (we don't know what's in the cloud) and 'Link to Cloud' no longer exists (designs auto-link). No Retry (must close and reopen). Esc does nothing; container has no role=dialog/aria-modal; focus stays on the header button so Tab walks the page behind the overlay. Pan…

**Root cause.** `src/modules/designer/frontend/components/CloudDesignBrowser.tsx:230` — hand-rolled overlay: no role/aria-modal/Esc/focus; bg-white dark:bg-slate-900 shadow-xl

**Proposed fix.** Open from Cloud offline state (dev flag cloud.designBrowser). — Detail: Rebuild CloudDesignBrowser on the shared kit Dialog (role=dialog, focus trap, Esc) with auto height; render the empty state only when !error; replace copy with 'Designs you sync from this or other devices appear here.'; show the shared cloud-unreachable message + 'Try again' button calling refresh(); swap raw red/slate classes for status-danger / surface tokens.

**Note.** cloud.designBrowser is 'dev' — not in release.

**Evidence.** [044-C1-open-from-cloud-loading](../evidence/shots/q10/dark/044-C1-open-from-cloud-loading.png), [090-open-from-cloud-offline](../evidence/shots/vq10/dark/090-open-from-cloud-offline.png)

<details><summary>Q10-010 — 'Open from Cloud' dialog offline: raw 'Failed to fetch' above a contradictory empty state pointing to a non-existent 'Link to Cloud' button; no retry, no Esc, no dialog semantics (S4, confirmed)</summary>

- Area cloud · stack C1 · design c2c58a19 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack C1, signed in (simulated session); open any design
  2. Click 'Open from Cloud' in the designer header
  3. Wait for the request to fail; press Esc; press Tab
- Expected: Offline message ('Can't reach OpenPCB Cloud') with Retry, no empty-state claim; modal with role=dialog, focus moved inside and trapped, Esc closes; sized to content; flat neutral tokens.
- Actual: Red banner 'Failed to fetch' AND below it 'No cloud designs in your personal workspace yet. Use “Link to Cloud” on a local design first.' — contradictory (we don't know what's in the cloud) and 'Link to Cloud' no longer exists (designs auto-link). No Retry (must close and reopen). Esc does nothing; container has no role=dialog/aria-modal; focus stays on the header button so Tab walks the page behind the overlay. Panel is 720 px tall (max-h-[80vh] h-full) for one line of text. Error banner uses raw red palette: dark text #f49797 on #460809 (nearest --status-danger ΔE 20.3 / --status-danger-soft ΔE 25.7); light text #c51118 (ΔE 16.3) on #fef2f2; light modal background pure #ffffff instead of --surface-panel; bg-black/50 scrim, shadow-xl.
- Screenshots: [044-C1-open-from-cloud-loading](../evidence/shots/q10/dark/044-C1-open-from-cloud-loading.png), [045-C1-open-from-cloud-error](../evidence/shots/q10/dark/045-C1-open-from-cloud-error.png), [045-C1-open-from-cloud-error](../evidence/shots/q10/light/045-C1-open-from-cloud-error.png)
- Console: `Failed to load resource: net::ERR_UNSAFE_PORT @ http://127.0.0.1:9/v1/workspaces/me/personal (dead cloud host)`
- Network: `GET <cloud>/v1/workspaces/me/personal → FAILED`
- Pixel probes: {"file": "shots/q10/dark/045-C1-open-from-cloud-error.png", "x": 408, "y": 151, "hex": "#f49797", "nearestToken": "--status-danger", "deltaE": 20.3}; {"file": "shots/q10/dark/045-C1-open-from-cloud-error.png", "x": 500, "y": 152, "hex": "#460809", "nearestToken": "--status-danger-soft@app", "deltaE": 25.7}; {"file": "shots/q10/light/045-C1-open-from-cloud-error.png", "x": 408, "y": 151, "hex": "#c51118", "nearestToken": "--status-danger", "deltaE": 16.3}
- Code: `src/modules/designer/frontend/components/CloudDesignBrowser.tsx:230` — hand-rolled overlay: no role/aria-modal/Esc/focus; bg-white dark:bg-slate-900 shadow-xl
- Code: `src/modules/designer/frontend/components/CloudDesignBrowser.tsx:251` — raw red-50/red-700/red-950/red-300 banner
- Code: `src/modules/designer/frontend/components/CloudDesignBrowser.tsx:259` — empty state rendered even when error is set; stale 'Link to Cloud' copy
- Code: `tests/e2e/cloud-sync.spec.ts:109` — only remaining 'Link to Cloud' reference
- Code: `src/core/contracts/feature-flags/registry.ts:52` — cloud.designBrowser availability 'dev'
- Suggested fix: Rebuild CloudDesignBrowser on the shared kit Dialog (role=dialog, focus trap, Esc) with auto height; render the empty state only when !error; replace copy with 'Designs you sync from this or other devices appear here.'; show the shared cloud-unreachable message + 'Try again' button calling refresh(); swap raw red/slate classes for status-danger / surface tokens.
- Verification (vq10): **confirmed** — Reproduced: Open from Cloud shows 'Failed to fetch' above 'No cloud designs in your personal workspace yet. Use “Link to Cloud” on a local design first.' 'Link to Cloud' exists only in the stale e2e tests/e2e/cloud-sync.spec.ts:109, not in src. There are 0 role=dialog elements, activeElement stays on the header button, Esc leaves it open, and the panel is 768×720. Error text probes #f49797 (ΔE 20.3 to --status-danger) on #460809 (ΔE 25.7). Correction: the dark modal body is #111113 = --surface-panel (remapped slate-900), so only the light #ffffff body is off-token. Downgraded S3→S4 because the whole surface is gated by cloud.designBrowser, which is 'dev' and hidden in release builds. Raw 'Failed to fetch' is also listed in Q10-004. · evidence: [090-open-from-cloud-offline](../evidence/shots/vq10/dark/090-open-from-cloud-offline.png), [045-C1-open-from-cloud-error](../evidence/shots/q10/light/045-C1-open-from-cloud-error.png), probe: err text #f49797 (--status-danger ΔE20.3), err bg #460809 (ΔE25.7), modal bg #111113 (--surface-panel ΔE0)

</details>

