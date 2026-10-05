# settings — QA findings

[← index](../README.md) · 33 triage entries · S1 0 · S2 8 · S3 19 · S4 5

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-049](#t-049) | S2 | A .opclib that omits library.kind installs as an undeletable read-only 'core' source | F1C-002 | decide (DEC-L) | C2 / W2 | backend | S |
| [T-050](#t-050) | S2 | Account 'Sync projects to cloud' switch knob is mispositioned: sits on the right when OFF and overflows the track/card when ON | Q10-007 | fix-now | C2 / W2 | frontend | XS |
| [T-051](#t-051) | S2 | API keys are stored in plaintext while Settings claims they are 'encrypted locally' | Q2-001 | fix-now (DEC-S1) | C2 / W2 | frontend | M |
| [T-052](#t-052) | S2 | Provider Re-test failure is shown with a green success check | Q2-002 | fix-now | C2 / W2 | frontend | XS |
| [T-053](#t-053) | S2 | Provider form: toggles discard unsaved edits (incl. typed key) while Re-test/Models silently save them | Q2-003, Q2-018 | fix-now | C2 / W2 | frontend | S |
| [T-054](#t-054) | S2 | Library 'Remove' uses a native window.confirm | Q2-004 | fix-now | C2 / W2 | frontend | S |
| [T-055](#t-055) | S2 | Settings lets the user remove 'Local Library' (user.local), wiping every custom/imported part | Q2-005 | fix-now (DEC-L) | C2 / W2 | frontend | S |
| [T-056](#t-056) | S2 | MCP section is shown and persisted regardless of the mcp.server feature flag | Q2-006 | fix-now | C2 / W2 | frontend | XS |
| [T-057](#t-057) | S3 | Install from file gives no progress or result feedback, and silently downgrades the core library | F1C-003 | fix-now (DEC-L) | C2 / W2 | frontend | M |
| [T-058](#t-058) | S3 | Removing a library source never says its parts are placed in designs, and those parts quietly lose their library link | F1C-004 | decide (DEC-L) | C2 / W2 | backend | M |
| [T-059](#t-059) | S3 | 'Sign in to OpenPCB Cloud' gives no feedback and no way out when the cloud is unreachable | Q10-011 | fix-now | C2 / W2 | frontend | S |
| [T-060](#t-060) | S3 | Account page uses raw emerald/amber/red palette, pill badges and 36 px buttons; 'OpenPCB AI Cloud — Coming soon' contradicts the shipped OpenPCB Cloud assistant provider | Q10-013 | fix-now | C2 / W2 | frontend | S |
| [T-061](#t-061) | S3 | Settings header is 52px with a 32px hand-rolled search and 36px nav rows (other screens: 34px header, 22px controls) | Q2-007 | fix-now | C2 / W2 | frontend | S |
| [T-062](#t-062) | S3 | Settings banners, chips and checkboxes use raw amber/red/emerald/blue palette instead of status tokens | Q2-008 | fix-now | C2 / W2 | frontend | M |
| [T-063](#t-063) | S3 | Settings controls hand-rolled: 23–43px heights, no visible focus, toggles expose no pressed state | Q2-009, Q2-011 | fix-now | C2 / W2 | frontend | M |
| [T-064](#t-064) | S3 | Settings status/error banners render at the top of the page, off-screen from the action, never clear and can show success+error together | Q2-010 | fix-now | C2 / W2 | frontend | S |
| [T-065](#t-065) | S3 | Esc closes Settings from anywhere — while typing in search, editing a provider (unsaved edits lost) or dismissing the context menu | Q2-012 | fix-now | C2 / W2 | frontend | XS |
| [T-066](#t-066) | S3 | Settings search only matches the five tab names ('theme', 'mcp', 'api key', 'provider', 'update' → No matches) | Q2-013 | fix-now | C2 / W2 | frontend | S |
| [T-067](#t-067) | S3 | Libraries: a failed sources fetch leaves the core card and table on 'Loading…' forever with no retry | Q2-014 | fix-now | C2 / W2 | frontend | S |
| [T-068](#t-068) | S3 | Install from URL: developer-facing errors far from the input, Enter does nothing, no label/cancel/progress | Q2-015 | fix-now | C2 / W2 | frontend | S |
| [T-069](#t-069) | S3 | Core library card: dead-end 'Download <version>' for bundled updates, silent 'Check for updates', misleading 'Latest stable' | Q2-016 | fix-now | C2 / W2 | frontend | S |
| [T-070](#t-070) | S3 | Delete provider and Remove API key act immediately with no confirmation or undo | Q2-017 | fix-now | C2 / W2 | frontend | S |
| [T-071](#t-071) | S3 | 'Add provider' instantly persists an 'Active' placeholder provider; new card not scrolled/focused; untested providers labelled Active | Q2-019 | fix-now | C2 / W2 | frontend | M |
| [T-072](#t-072) | S3 | Privacy 'SECURITY.md' link is a 404 and Settings/rail links point to the old andrejvysny/OpenPCB repo | Q2-020 | fix-now | C2 / W2 | frontend | XS |
| [T-073](#t-073) | S3 | Privacy copy claims no design data ever leaves the computer, contradicting BYOK cloud providers and MCP | Q2-021 | decide (DEC-S2) | C2 / W2 | frontend | XS |
| [T-074](#t-074) | S3 | Settings panels use inconsistent title sizes and section styles | Q2-022 | fix-now | C2 / W2 | frontend | S |
| [T-075](#t-075) | S3 | 9px text in Settings (DEFAULT/LOCAL pills, 'Advanced', 'Caution') | Q2-023 | fix-now | C2 / W2 | frontend | XS |
| [T-076](#t-076) | S4 | Long provider labels are cut off in the provider list and the Default provider select, with no tooltip | F1C-018 | fix-now | C2 / W2 | frontend | XS |
| [T-077](#t-077) | S4 | Theme toggle (Settings › General › Appearance) is a hand-rolled control: no aria-pressed, 35px tall, grows to 53px when 'System' is active | Q1-022 | fix-now | C1 / W2 | frontend | XS |
| [T-078](#t-078) | S4 | Every provider form shows a placeholder 'This month' usage block with '—' tiles and a disabled 'View details →' | Q2-024 | fix-now | C2 / W2 | frontend | XS |
| [T-079](#t-079) | S4 | 'Show key hint' duplicates the last 4 chars and never changes its label | Q2-027 | fix-now | C2 / W2 | frontend | XS |
| [T-080](#t-080) | S4 | Provider form: changing Type doesn't update Base URL or key requirement; 'local/self-hosted' hint shown for cloud endpoints; Replace has no Cancel | Q2-028 | fix-now | C2 / W2 | frontend | S |
| [T-392](#t-392) | S4 | Enabling MCP in a non-Electron build shows no connection details or explanation | Q2-029 | wont-fix | — / followup | frontend | XS |

## T-049

**A .opclib that omits library.kind installs as an undeletable read-only 'core' source**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner C2 · wave W2 · scope backend · estimate S
- Findings: F1C-002

**Summary.** The row shows 'core' plus an amber 'read-only' chip and has no Remove button. The backend refuses deletion with 400 'cannot delete core source qa.f1c.nokind; ship a new bundled package to replace it'. At the same time its part is isBuiltin=false and shows an Edit button on the detail page, so a 'read-only' source contains editable parts. The only way out is to craft another pack with the same id and kind 'team', ins…

**Root cause.** `src/modules/library/backend/sync/opclib-importer.ts:372` — kind: lib.kind ?? "core" is taken from the untrusted manifest

**Proposed fix.** Backend: default missing library.kind to 'third-party' (never core) on .opclib import. — Detail: In importOpclib (opclib-importer.ts:258, :372/:382), do not take kind from the manifest for user installs. installOpclibFromBytes (install-source.ts:40) should pass a trusted kind: 'core' only when lib.id === 'openpcb.core' (and, once the core is signed, only when the signature verifies); otherwise use manifest kind 'team'/'user', and treat a missing or 'core' kind as 'team'. Base isReadOnly and the deleteSource guard (queries.ts:2034) on sourceId === 'openpcb.core', not on kind. LibrariesPanel.tsx:421 then shows…

**Evidence.** [015-settings-nokind-pack-core-readonly](../evidence/shots/f1c/dark/015-settings-nokind-pack-core-readonly.png), [004-settings-nokind-pack-core-readonly](../evidence/shots/vf1c/dark/004-settings-nokind-pack-core-readonly.png)

<details><summary>F1C-002 — A .opclib that omits library.kind installs as an undeletable read-only 'core' source (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B. Build a valid pack 'qa.f1c.nokind' with no 'kind' in library.json. The schema marks it optional with default 'core' (f1c/qa-f1c-nokind.opclib)
  2. Settings → Libraries → Install from file… → pick it
  3. Look at its row in the sources table
  4. curl -X DELETE /api/modules/library/sources/qa.f1c.nokind
  5. Library → open 'QA-f1c pack LED'
- Expected: Only the bundled OpenPCB core, verified by id and signature, can be kind 'core'. A user-installed pack is always removable.
- Actual: The row shows 'core' plus an amber 'read-only' chip and has no Remove button. The backend refuses deletion with 400 'cannot delete core source qa.f1c.nokind; ship a new bundled package to replace it'. At the same time its part is isBuiltin=false and shows an Edit button on the detail page, so a 'read-only' source contains editable parts. The only way out is to craft another pack with the same id and kind 'team', install that, then Remove (which I did to clean up).
- Screenshots: [015-settings-nokind-pack-core-readonly](../evidence/shots/f1c/dark/015-settings-nokind-pack-core-readonly.png), [016-nokind-pack-part-editable](../evidence/shots/f1c/dark/016-nokind-pack-part-editable.png)
- Network: `DELETE /api/modules/library/sources/qa.f1c.nokind → 400 cannot delete core source`
- Code: `src/modules/library/backend/sync/opclib-importer.ts:372` — kind: lib.kind ?? "core" is taken from the untrusted manifest
- Code: `src/modules/library/backend/sync/opclib-importer.ts:258` — isReadOnly derived from the same default
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` — Remove hidden for kind==='core'
- Code: `src/modules/library/backend/queries.ts:2034` — deleteSource refuses any kind==='core'
- Suggested fix: In importOpclib (opclib-importer.ts:258, :372/:382), do not take kind from the manifest for user installs. installOpclibFromBytes (install-source.ts:40) should pass a trusted kind: 'core' only when lib.id === 'openpcb.core' (and, once the core is signed, only when the signature verifies); otherwise use manifest kind 'team'/'user', and treat a missing or 'core' kind as 'team'. Base isReadOnly and the deleteSource guard (queries.ts:2034) on sourceId === 'openpcb.core', not on kind. LibrariesPanel.tsx:421 then shows Remove for every non-core source.
- Verification (vf1c): **confirmed** — Reproduced on stack B. Installing f1c/qa-f1c-nokind.opclib (no library.kind) made the sources row read 'QA-f1c No-Kind Pack · qa.f1c.nokind · core read-only · 1.0.0' with no Remove button. DELETE /sources/qa.f1c.nokind -> 400 'cannot delete core source qa.f1c.nokind; ship a new bundled package to replace it'. At the same time, the pack part's detail page offers an enabled Edit button (isBuiltin:false). Root cause: the opclib-pack library.schema.json declares kind with default 'core', and the importer applies lib.kind ?? 'core' (opclib-importer.ts:258, :372). The schema default makes this reachable for any third-party pack that omits kind. It is not an artefact: packaged builds use the same importer. Cleaned up by reinstalling the same id as kind 'team' (1.0.1), then DELETE -> removed:1. S2 kept: misleading read-only/core claim, and the source cannot be removed from the UI. · evidence: [004-settings-nokind-pack-core-readonly](../evidence/shots/vf1c/dark/004-settings-nokind-pack-core-readonly.png), [005-nokind-part-detail-editable](../evidence/shots/vf1c/dark/005-nokind-part-detail-editable.png), DELETE /api/modules/library/sources/qa.f1c.nokind -> 400 cannot delete core source, node_modules/@openpcb/opclib-pack/dist/schemas/library.schema.json: kind {enum:[core,user,team], default:'core'}

</details>


## T-050

**Account 'Sync projects to cloud' switch knob is mispositioned: sits on the right when OFF and overflows the track/card when ON**

- Severity **S2** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q10-007
- Depends on: ['T-004']

**Summary.** Track spans x=1102–1146. ON: knob at x=1146–1166 — fully outside the track and past the card's right border. OFF: knob at x=1126–1146 — on the right half of the track, i.e. the conventional 'on' position. For a privacy switch that decides whether project data leaves the machine, the OFF state reads as ON.

**Root cause.** `src/core/frontend/src/settings/panels/account/AccountSignedIn.tsx:83` — knob `absolute top-0.5 … translate-x-*` with no left-0; button text-align:center

**Proposed fix.** Replace hand-rolled switch with kit Switch (correct knob positions, visible ON contrast). — Detail: AccountSignedIn.tsx:83 add `left-0` to the knob span (keep translate-x-0.5 / translate-x-[22px]); make the ON knob contrast with the track (e.g. knob bg-primary-foreground when on). Better: add a small kit Switch to src/shared/frontend/ui (role=switch, 2px-radius flat style per tokens) and use it here.

**Evidence.** [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [021-account-signedin-offline](../evidence/shots/vq10/dark/021-account-signedin-offline.png)

<details><summary>Q10-007 — Account 'Sync projects to cloud' switch knob is mispositioned: sits on the right when OFF and overflows the track/card when ON (S2, confirmed)</summary>

- Area settings · stack C1 · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack C1, signed in (simulated session)
  2. Settings → Account → 'Sync projects to cloud' switch
  3. Measure/zoom the switch in both states (click to toggle; it's a local pref)
- Expected: Knob inside a 44×24 track: left when off, right when on.
- Actual: Track spans x=1102–1146. ON: knob at x=1146–1166 — fully outside the track and past the card's right border. OFF: knob at x=1126–1146 — on the right half of the track, i.e. the conventional 'on' position. For a privacy switch that decides whether project data leaves the machine, the OFF state reads as ON.
- Screenshots: [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [081-C1-account-sync-toggle-zoom](../evidence/shots/q10/dark/081-C1-account-sync-toggle-zoom.png), [082-C1-account-sync-off](../evidence/shots/q10/dark/082-C1-account-sync-off.png), [083-C1-account-sync-toggle-off-zoom](../evidence/shots/q10/dark/083-C1-account-sync-toggle-off-zoom.png)
- Code: `src/core/frontend/src/settings/panels/account/AccountSignedIn.tsx:83` — knob `absolute top-0.5 … translate-x-*` with no left-0; button text-align:center
- Code: `src/core/frontend/src/settings/panels/account/AccountSignedIn.tsx:77` — ON track bg-primary (#e8e8e8 dark) vs bg-white knob
- Suggested fix: AccountSignedIn.tsx:83 add `left-0` to the knob span (keep translate-x-0.5 / translate-x-[22px]); make the ON knob contrast with the track (e.g. knob bg-primary-foreground when on). Better: add a small kit Switch to src/shared/frontend/ui (role=switch, 2px-radius flat style per tokens) and use it here.
- Verification (vq10): **confirmed** — Measured: track x1102–1146. ON: knob x1146–1166, fully outside the track and past the card border. OFF: knob x1126–1146, in the right half, i.e. the conventional 'on' position. aria-checked is correct (true/false). Root cause as stated: the knob span is absolute with no left-*, the button's text-align is center (computed), so the static x is the track centre (22 px) and translate-x-0.5 / translate-x-[22px] land at 24 / 44 px. Extra issue: in dark the ON track is --primary #e8e8e8 and the knob is #ffffff, so even when correctly placed the knob barely contrasts. This is the only role=switch in the app; there is no kit switch. Positioning is theme-independent, so both themes are affected. Kept at S2 because this is the privacy control for whether designs leave the machine, and the OFF state reads as ON. · evidence: [021-account-signedin-offline](../evidence/shots/vq10/dark/021-account-signedin-offline.png), [022-sync-switch-on-zoom](../evidence/shots/vq10/dark/022-sync-switch-on-zoom.png), [023-account-sync-off](../evidence/shots/vq10/dark/023-account-sync-off.png), [023-sync-switch-off-zoom](../evidence/shots/vq10/dark/023-sync-switch-off-zoom.png), probe: track-on #e8e8e8 (--primary ΔE0), knob #ffffff; track-off #2c2c31 (--surface-control ΔE0)

</details>


## T-051

**API keys are stored in plaintext while Settings claims they are 'encrypted locally'**

- Severity **S2** · category copy · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-S1 · owner C2 · wave W2 · scope frontend · estimate M
- Findings: Q2-001 · known ref K11

**Summary.** Panel subtitle reads 'Bring your own key. Free on desktop — keys stored encrypted locally.' and the key badge reads 'Saved · encrypted locally', but the api_key column holds the exact plaintext value (query returned 1).

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:328` — 'keys stored encrypted locally'

**Proposed fix.** Now: change copy to 'stored locally on this computer (not encrypted)'; badge 'Saved locally'. Real encryption (Electron safeStorage) = backend decision. — Detail: Immediate: AssistantPanel.tsx:328 -> 'Bring your own key. Keys are stored locally on this machine.' and :710 badge -> 'Saved locally'. Proper: route provider keys through Electron safeStorage (reuse electron/src/main/secure-storage.ts via an IPC the backend can call, or encrypt in provider-store.ts createProvider/updateProvider and decrypt in rowToInternal), plus a migration that re-encrypts existing api_key rows; only then restore the 'encrypted' wording.

**Evidence.** [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [034-provider-saved](../evidence/shots/vq2/dark/034-provider-saved.png)

<details><summary>Q2-001 — API keys are stored in plaintext while Settings claims they are 'encrypted locally' (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B: Settings > Assistant
  2. Add provider, paste key 'sk-qa-dummy-000', Save provider
  3. Read header copy and the badge above the API key field
  4. Inspect DB: SELECT (api_key = 'sk-qa-dummy-000') FROM assistant_provider_config WHERE label='QA-q2 Dummy' (boolean only, key never printed)
- Expected: Either keys are encrypted at rest (Electron safeStorage / OS keychain) or the UI does not claim encryption.
- Actual: Panel subtitle reads 'Bring your own key. Free on desktop — keys stored encrypted locally.' and the key badge reads 'Saved · encrypted locally', but the api_key column holds the exact plaintext value (query returned 1).
- Screenshots: [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [020-assistant](../evidence/shots/q2/dark/020-assistant.png)
- Network: `PUT /api/modules/assistant/providers/{id} → 200`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:328` — 'keys stored encrypted locally'
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:710` — 'Saved · encrypted locally' badge
- Code: `src/modules/assistant/backend/provider-store.ts:303` — UPDATE ... api_key=? stores raw input
- Code: `src/modules/assistant/backend/provider-store.ts:261` — INSERT stores input.apiKey raw
- Suggested fix: Immediate: AssistantPanel.tsx:328 -> 'Bring your own key. Keys are stored locally on this machine.' and :710 badge -> 'Saved locally'. Proper: route provider keys through Electron safeStorage (reuse electron/src/main/secure-storage.ts via an IPC the backend can call, or encrypt in provider-store.ts createProvider/updateProvider and decrypt in rowToInternal), plus a migration that re-encrypts existing api_key rows; only then restore the 'encrypted' wording.
- Verification (vq2): **CONFIRMED** — Reproduced on B: added provider 'QA-vq2 Dummy', typed dummy key, Save provider; read-only DB check (api_key = entered dummy) returned 1 while subtitle reads 'keys stored encrypted locally' and badge 'Saved · encrypted locally'. provider-store.ts INSERT/UPDATE bind the raw string; rowToInternal (:426) reads it back verbatim; no encryption anywhere in assistant backend (token-crypto.ts only covers cloud task payloads). Electron already has safeStorage in electron/src/main/secure-storage.ts but it is not used for provider keys. Not a secret exposure (local file), so S2 misleading security claim, not S1. Provider deleted afterwards. · evidence: [034-provider-saved](../evidence/shots/vq2/dark/034-provider-saved.png), [030-assistant](../evidence/shots/vq2/dark/030-assistant.png), db: SELECT label,(api_key='<dummy>') -> 'QA-vq2 Dummy|1'

</details>


## T-052

**Provider Re-test failure is shown with a green success check**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-002

**Summary.** Summary line shows a green CircleCheck + green text 'List models failed: Unable to connect. Is the computer able to access the url?' (truncated, no tooltip). Backend returns HTTP 200 with ok:false in the body; frontend ignores result.ok and always records ok:true.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:310` — setLastTest({ ok: true, ... }) regardless of result.ok

**Proposed fix.** Re-test failure shows danger status (icon + message), never the success check. — Detail: AssistantPanel.tsx:299 read `readJson<{ ok: boolean; message: string }>` and set `setLastTest({ providerId, ok: result.ok, text: result.message })`; add `title={lastTest.text}` on the span at :598 (or let it wrap).

**Evidence.** [029-retest-result](../evidence/shots/q2/dark/029-retest-result.png), [036-retest-result](../evidence/shots/vq2/dark/036-retest-result.png)

<details><summary>Q2-002 — Provider Re-test failure is shown with a green success check (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant
  2. Expand a provider whose server is not reachable (e.g. built-in oMLX at 127.0.0.1:8000, or a new OpenAI-compatible provider at 127.0.0.1:1234)
  3. Click 'Re-test'
- Expected: Failure is shown in danger styling (red icon/text) with the full error readable.
- Actual: Summary line shows a green CircleCheck + green text 'List models failed: Unable to connect. Is the computer able to access the url?' (truncated, no tooltip). Backend returns HTTP 200 with ok:false in the body; frontend ignores result.ok and always records ok:true.
- Screenshots: [029-retest-result](../evidence/shots/q2/dark/029-retest-result.png), [106-omlx-retest](../evidence/shots/q2/light/106-omlx-retest.png), [106b-omlx-retest-crop](../evidence/shots/q2/light/106b-omlx-retest-crop.png)
- Network: `POST /api/modules/assistant/providers/{id}/test → 200 (body ok:false)`
- Pixel probes: {"file": "shots/q2/light/106-omlx-retest.png", "x": 700, "y": 485, "hex": "#609a6f", "nearestToken": "green (success hue)", "deltaE": 12.0}
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:310` — setLastTest({ ok: true, ... }) regardless of result.ok
- Code: `src/modules/assistant/backend/assistant-service.ts:772` — returns ok: modelsAvailable > 0 with 200
- Suggested fix: AssistantPanel.tsx:299 read `readJson<{ ok: boolean; message: string }>` and set `setLastTest({ providerId, ok: result.ok, text: result.message })`; add `title={lastTest.text}` on the span at :598 (or let it wrap).
- Verification (vq2): **CONFIRMED** — Reproduced: provider at unreachable 127.0.0.1:1234, Re-test -> POST /test 200 with ok:false; summary renders class text-status-success + lucide-circle-check with 'List models failed: Unable to connect…'. Glyph probe #6fbf7a = --status-success dE 0. Text overflows (scrollWidth 395 > 322) with no title. Root cause AssistantPanel.tsx:299-310 types the response as {message} and hard-codes ok:true; backend assistant-service.ts:772 returns ok: modelsAvailable>0 with HTTP 200. · evidence: [036-retest-result](../evidence/shots/vq2/dark/036-retest-result.png), [036b-retest-crop](../evidence/shots/vq2/dark/036b-retest-crop.png), network: POST /providers/{id}/test -> 200 (ok:false), probe 036-retest-result.png 964,228 #6fbf7a --status-success dE0

</details>


## T-053

**Provider form: toggles discard unsaved edits (incl. typed key) while Re-test/Models silently save them**

- Severity **S2** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-003, Q2-018

**Summary.** Tool-calling mode is PUT immediately, then load() refreshes providers; the effect keyed on expanded.updatedAt re-seeds the draft, so Label reverts to 'Custom OpenAI-compatible' and the typed key is cleared (pwLen 0). Same path for 'Remove' key. List order also changes under the user. | Also covers: Q2-018: Re-test / Models / Refresh models silently save unsaved provider edits; unreachable serve…

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:166` — draft reset effect depends on expanded?.updatedAt

**Proposed fix.** Provider form is one draft: Tool calling/Remove key/Re-test/Models act on draft with explicit Save/Discard; backend 500 on unreachable -> 502 with message (XS, include if approved). — Detail: AssistantPanel.tsx:166 drop `expanded?.updatedAt` from the effect deps (re-seed only when expanded.id changes); after removeProviderKey/updateToolCalling patch only the affected field (setDraft(d => ({...d, apiKey: ''})) is already there). Optionally make tool-calling part of the draft saved by 'Save provider'.

**Evidence.** [024-provider-form](../evidence/shots/q2/dark/024-provider-form.png), [032-provider-form-dirty](../evidence/shots/vq2/dark/032-provider-form-dirty.png), [029-retest-result](../evidence/shots/q2/dark/029-retest-result.png)

<details><summary>Q2-003 — Clicking Tool calling Auto/On/Off (or Remove key) silently discards unsaved provider edits incl. a typed API key (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant > Add provider (card expands)
  2. Change Label to 'QA-q2 Dummy' and type an API key (do not save)
  3. Click Tool calling 'On'
- Expected: Unsaved Label/API key/Base URL edits are preserved (or the mode is part of the Save).
- Actual: Tool-calling mode is PUT immediately, then load() refreshes providers; the effect keyed on expanded.updatedAt re-seeds the draft, so Label reverts to 'Custom OpenAI-compatible' and the typed key is cleared (pwLen 0). Same path for 'Remove' key. List order also changes under the user.
- Screenshots: [024-provider-form](../evidence/shots/q2/dark/024-provider-form.png), [025-after-toolcalling-on](../evidence/shots/q2/dark/025-after-toolcalling-on.png)
- Network: `PUT /providers/{id}/tool-calling → 200`; `GET /providers → 200`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:166` — draft reset effect depends on expanded?.updatedAt
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:189` — updateToolCalling PUT + load()
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:168` — removeProviderKey
- Suggested fix: AssistantPanel.tsx:166 drop `expanded?.updatedAt` from the effect deps (re-seed only when expanded.id changes); after removeProviderKey/updateToolCalling patch only the affected field (setDraft(d => ({...d, apiKey: ''})) is already there). Optionally make tool-calling part of the draft saved by 'Save provider'.
- Verification (vq2): **CONFIRMED** — Reproduced: new provider card, Label -> 'QA-vq2 Dummy', key typed (19 chars), clicked Tool calling 'on' -> Label reverted to 'Custom OpenAI-compatible', key field emptied (pwLen 0); DB shows tool_calling_override=1 and label/key unchanged. Cause: updateToolCalling (:189) calls load(), provider.updatedAt changes, effect at :144-166 re-seeds draft. Same for removeProviderKey (:168, updates provider -> updatedAt). Kept S2: silent loss of typed input (incl. a pasted secret) in the primary provider-setup flow; workaround = save first. · evidence: [032-provider-form-dirty](../evidence/shots/vq2/dark/032-provider-form-dirty.png), [033-after-toolcalling-on](../evidence/shots/vq2/dark/033-after-toolcalling-on.png), db: label 'Custom OpenAI-compatible', tool_calling_override=1, api_key NULL after click

</details>

<details><summary>Q2-018 — Re-test / Models / Refresh models silently save unsaved provider edits; unreachable server returns HTTP 500 (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Expand oMLX or OpenRouter (never click Save), click Re-test
  2. DB updated_at for omlx/openrouter changes (pristine 2026-05-29/06-01 → 2026-09-25T10:37/10:27) — the draft was PUT before testing
  3. Click header 'Models' on a provider pointing to 127.0.0.1:1234 → POST /models/refresh → 500 Internal Server Error
- Expected: Testing does not persist edits (test the draft without saving, or ask); connection failures return a 4xx/502 problem with a clear detail.
- Actual: testProvider/refreshModels call saveProviderDraft() first, so experimenting with a Base URL/key and pressing Re-test commits it; backend maps a network failure to 500.
- Screenshots: [029-retest-result](../evidence/shots/q2/dark/029-retest-result.png), [030-models-refresh-error](../evidence/shots/q2/dark/030-models-refresh-error.png)
- Network: `PUT /providers/{id} → 200 (before /test)`; `POST /providers/{id}/models/refresh → 500`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:297` — testProvider saves draft
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:277` — refreshModels saves draft
- Code: `src/modules/assistant/backend/routes.ts:395` — models/refresh error → 500
- Suggested fix: Either disable Re-test/Models while the draft is dirty ('Save first') or send the draft in the /test body (backend testProvider builds a client from overrides without persisting). Backend: assistant-service refreshProviderModels / routes.ts:395 catch provider network errors and throw a problem with status 502 and 'Provider unreachable at <baseUrl>'.
- Verification (vq2): **CONFIRMED** — Reproduced: edited Label to 'QA-vq2 Dummy EDIT-unsaved' without saving, clicked Re-test -> DB label and updated_at changed (11:19:15 -> 11:19:42). Models header button -> PUT then POST /models/refresh -> 500 problem 'internal-error' with detail 'Unable to connect…' (should be a 502/4xx). AssistantPanel.tsx:277 and :297 call saveProviderDraft() first. · evidence: [036-retest-result](../evidence/shots/vq2/dark/036-retest-result.png), [037-models-refresh-error](../evidence/shots/vq2/dark/037-models-refresh-error.png), db: label persisted by Re-test, network: POST /providers/{id}/models/refresh -> 500

</details>


## T-054

**Library 'Remove' uses a native window.confirm**

- Severity **S2** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-004 · known ref K06
- Depends on: ['T-014']

**Summary.** Native confirm: 'Remove library "user.local" and all its components? This cannot be undone.' (dialog spy confirm=1). Dismissed; library intact.

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:221` — window.confirm

**Proposed fix.** Replace window.confirm with kit confirmDialog naming the library and part count. — Detail: Add a ConfirmDialog built on src/core/frontend/src/components/ui/dialog.tsx (Radix: focus trap, Esc, return focus, danger primary) and use it in LibrariesPanel.tsx:218-226 with the source NAME and componentCount ('Remove Local Library (46 parts)?'); reuse for Q2-017.

**Evidence.** [010-libraries](../evidence/shots/q2/dark/010-libraries.png), [010-libraries](../evidence/shots/vq2/dark/010-libraries.png)

<details><summary>Q2-004 — Library 'Remove' uses a native window.confirm (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Libraries
  2. Click 'Remove' on the 'Local Library' row
- Expected: In-app confirmation dialog (kit styling, focus trap, Esc/Enter) that works identically in Electron.
- Actual: Native confirm: 'Remove library "user.local" and all its components? This cannot be undone.' (dialog spy confirm=1). Dismissed; library intact.
- Screenshots: [010-libraries](../evidence/shots/q2/dark/010-libraries.png)
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:221` — window.confirm
- Suggested fix: Add a ConfirmDialog built on src/core/frontend/src/components/ui/dialog.tsx (Radix: focus trap, Esc, return focus, danger primary) and use it in LibrariesPanel.tsx:218-226 with the source NAME and componentCount ('Remove Local Library (46 parts)?'); reuse for Q2-017.
- Verification (vq2): **CONFIRMED** — Reproduced: Settings > Libraries > Remove on 'Local Library' -> native confirm 'Remove library "user.local" and all its components? This cannot be undone.' (dialog spy confirm=1), dismissed, library intact (46 parts). Kept S2 per protocol rubric (native confirm). Note: there is no shared in-app confirm component yet; Home delete modal is itself hand-rolled (K26). · evidence: [010-libraries](../evidence/shots/vq2/dark/010-libraries.png), dialogSpy: confirm=1 'Remove library "user.local"…'

</details>


## T-055

**Settings lets the user remove 'Local Library' (user.local), wiping every custom/imported part**

- Severity **S2** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-L · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-005

**Summary.** Same 'Remove' affordance as a third-party pack; backend deleteSource only protects kind==='core' and deletes all components/symbols/footprints with sourceId user.local without checking design references. Confirm text uses the raw id 'user.local', not 'your 4 custom parts'.

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` — only kind==='core' hides Remove

**Proposed fix.** Hide Remove for user.local (kind user) source; backend guard is a decision item. — Detail: LibrariesPanel.tsx:421 render Remove only when kind is not 'core' and not 'user' (or id !== 'user.local'); queries.ts:2034 deleteSource throw ValidationError for kind==='user'. If clearing custom parts is wanted, add a separate guarded 'Delete all custom parts' flow that lists count and designs referencing them.

**Evidence.** [010-libraries](../evidence/shots/q2/dark/010-libraries.png), [010-libraries](../evidence/shots/vq2/dark/010-libraries.png)

<details><summary>Q2-005 — Settings lets the user remove 'Local Library' (user.local), wiping every custom/imported part (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Libraries
  2. Sources table shows 'Local Library / user.local / user' with 4 components and a red 'Remove' button
  3. Click Remove (confirm dialog shown; NOT accepted in this test)
- Expected: The built-in user library (destination of every KiCad import, drawn part and duplicate) is not removable, or removal is strongly guarded (name the parts, warn about designs that reference them, offer export first).
- Actual: Same 'Remove' affordance as a third-party pack; backend deleteSource only protects kind==='core' and deletes all components/symbols/footprints with sourceId user.local without checking design references. Confirm text uses the raw id 'user.local', not 'your 4 custom parts'.
- Screenshots: [010-libraries](../evidence/shots/q2/dark/010-libraries.png), [101-libraries](../evidence/shots/q2/light/101-libraries.png)
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` — only kind==='core' hides Remove
- Code: `src/modules/library/backend/queries.ts:2034` — deleteSource guards only core
- Code: `src/modules/library/backend/sync/bootstrap.ts:236` — user.local seeded as the default user source
- Code: `src/modules/library/backend/import/commit-kicad.ts:292` — imports land in user.local
- Suggested fix: LibrariesPanel.tsx:421 render Remove only when kind is not 'core' and not 'user' (or id !== 'user.local'); queries.ts:2034 deleteSource throw ValidationError for kind==='user'. If clearing custom parts is wanted, add a separate guarded 'Delete all custom parts' flow that lists count and designs referencing them.
- Verification (vq2): **CONFIRMED** — Reproduced UI: 'Local Library / user.local / user' row shows the same red Remove as a third-party pack; confirm text uses raw id. Code: LibrariesPanel.tsx:421 hides Remove only for kind==='core'; queries.ts:2034 deleteSource guards only kind==='core' and deletes components/footprints/symbols/releases and the source row itself; commit-kicad.ts:292/305/325 imports target user.local; bootstrap re-seeds the source row only on next boot (ensureUserLocalSource). Not accepted in test (would wipe other agents' parts on B). Guarded by a confirm, so S2 not S1. · evidence: [010-libraries](../evidence/shots/vq2/dark/010-libraries.png), [101-libraries-error](../evidence/shots/vq2/light/101-libraries-error.png)

</details>


## T-056

**MCP section is shown and persisted regardless of the mcp.server feature flag**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-006 · known ref K20

**Summary.** Release builds would show a working-looking toggle and copyable Claude Code/Desktop/HTTP snippets that point to a 404 route. In this dev stack the flag is on, so the visual difference cannot be reproduced; confirmed by code.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:431` — McpSection rendered unconditionally

**Proposed fix.** Render McpSection only when isFeatureEnabled('mcp.server'). — Detail: AssistantPanel.tsx:431 wrap in `{useFeatureFlag('mcp.server') ? <McpSection …/> : null}` (hook from @/feature-flags); in electron/src/main/diagnostics-ipc.ts:57 return null (and skip the mcp.json portfile) when OPENPCB_FEATURE_MCP_SERVER/NODE_ENV say the flag is off.

**Evidence.** [021-mcp-enabled](../evidence/shots/q2/dark/021-mcp-enabled.png), [041-mcp-enabled](../evidence/shots/vq2/dark/041-mcp-enabled.png)

<details><summary>Q2-006 — MCP section is shown and persisted regardless of the mcp.server feature flag (S2, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant: 'MCP server' section with 'Enable MCP server' / 'Allow writes' is always rendered
  2. Code: AssistantPanel renders <McpSection> unconditionally; backend registers /mcp routes only if isFeatureEnabled('mcp.server') (availability 'dev')
  3. Electron 'mcp:config' IPC returns the /api/modules/assistant/mcp URL + token regardless of the flag
- Expected: In builds where mcp.server is off, the section is hidden (or shows 'not available in this build').
- Actual: Release builds would show a working-looking toggle and copyable Claude Code/Desktop/HTTP snippets that point to a 404 route. In this dev stack the flag is on, so the visual difference cannot be reproduced; confirmed by code.
- Screenshots: [021-mcp-enabled](../evidence/shots/q2/dark/021-mcp-enabled.png), [103-assistant](../evidence/shots/q2/light/103-assistant.png)
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:431` — McpSection rendered unconditionally
- Code: `src/modules/assistant/backend/routes.ts:468` — backend gate
- Code: `src/core/contracts/feature-flags/registry.ts:116` — mcp.server availability dev
- Code: `electron/src/main/diagnostics-ipc.ts:57` — mcp:config not gated
- Suggested fix: AssistantPanel.tsx:431 wrap in `{useFeatureFlag('mcp.server') ? <McpSection …/> : null}` (hook from @/feature-flags); in electron/src/main/diagnostics-ipc.ts:57 return null (and skip the mcp.json portfile) when OPENPCB_FEATURE_MCP_SERVER/NODE_ENV say the flag is off.
- Verification (vq2): **CONFIRMED** — Code-confirmed (flag is on in dev stacks so not visually reproducible): AssistantPanel.tsx:431 renders <McpSection> unconditionally; routes.ts:468 registers /mcp only if isFeatureEnabled('mcp.server'); registry.ts:116 availability 'dev' (off in release); electron diagnostics-ipc.ts:57 'mcp:config' returns url+token regardless. In a release build the toggle persists and Electron renders copyable snippets for a route that 404s. S2 (misleading control shipped to release users). · evidence: [041-mcp-enabled](../evidence/shots/vq2/dark/041-mcp-enabled.png)

</details>


## T-057

**Install from file gives no progress or result feedback, and silently downgrades the core library**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-L · owner C2 · wave W2 · scope frontend · estimate M
- Findings: F1C-003

**Summary.** The only UI change during each install is that every button is disabled for about 50 ms (observer: t=1175 all [dis] → t=1228 enabled). No progress, success or 'already installed' text appears, although the API returns a rich result ({reimport:true, updated:{components:17,…}}). The downgrade beta.2 → beta.1 is applied silently. Any unsigned file claiming id openpcb.core replaces the official core, and packaged builds…

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:186` — handleFile: setBusy → install → refresh; the result is discarded, no notice

**Proposed fix.** Install from file: progress + result message (installed version); warn before installing an older core version (backend guard = decision). — Detail: LibrariesPanel.tsx handleFile (:186): keep the returned ImportResult and render a role=status line under the install buttons, e.g. 'Installed OpenPCB Core Library 0.1.0-beta.2 · 17 components updated' or 'Reinstalled (no changes)' when reimport is true. While busy, show 'Installing <file name>…'. Backend installOpclibFromBytes: when lib.id already has a newer installed release, return 409 {code:'downgrade', installed, incoming} unless ?force=1, and have the UI confirm through a kit dialog (not window.confirm). Cor…

**Evidence.** [003-settings-libraries-after-beta1-reinstall](../evidence/shots/f1c/dark/003-settings-libraries-after-beta1-reinstall.png), [001-settings-after-downgrade-beta1](../evidence/shots/vf1c/light/001-settings-after-downgrade-beta1.png)

<details><summary>F1C-003 — Install from file gives no progress or result feedback, and silently downgrades the core library (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Settings → Libraries (core 0.1.0-beta.1 bundled)
  2. Install from file… → openpcb-core-library-0.1.0-beta.1.opclib (reinstall), then beta.2 (upgrade), then beta.1 (downgrade), then beta.2 twice
  3. A MutationObserver on <main> records every UI change
  4. Light: Install from file… → sample.txt, then a valid pack with one byte of library.json changed
- Expected: While installing, a visible 'Installing <file>…' state. Afterwards a result line such as 'Installed OpenPCB Core Library 0.1.0-beta.2 (17 components updated)' or 'already installed, nothing changed'. An explicit confirm before replacing the signed/bundled core with an older or unsigned file. The core card agrees with what is installed.
- Actual: The only UI change during each install is that every button is disabled for about 50 ms (observer: t=1175 all [dis] → t=1228 enabled). No progress, success or 'already installed' text appears, although the API returns a rich result ({reimport:true, updated:{components:17,…}}). The downgrade beta.2 → beta.1 is applied silently. Any unsigned file claiming id openpcb.core replaces the official core, and packaged builds never set OPENPCB_REQUIRE_SIGNED_OPCLIB. After the upgrade the card reads 'Up to date · Installed 0.1.0-beta.2 · Latest stable 0.1.0-beta.1', so 'latest' is older than what is installed. Install time and origin ('manual-import') are never shown. Reinstalling the same version is idempotent (no duplicates), which is correct. Invalid files show raw developer errors in a red banner that never names the file: 'invalid .opclib: Invalid ZIP archive: central directory not found' and 'invalid .opclib: manifest digest mismatch: declared=9b5e…80b9 recomputed=e0fd…5db2' (64-hex hashes). There is no hint such as 'This file isn't a valid OpenPCB library or it was modified' (compare Q2-015 for URL installs).
- Screenshots: [003-settings-libraries-after-beta1-reinstall](../evidence/shots/f1c/dark/003-settings-libraries-after-beta1-reinstall.png), [004-settings-after-beta2-upgrade](../evidence/shots/f1c/dark/004-settings-after-beta2-upgrade.png), [005-settings-after-beta1-downgrade](../evidence/shots/f1c/dark/005-settings-after-beta1-downgrade.png), [017-settings-after-reinstall-beta2](../evidence/shots/f1c/light/017-settings-after-reinstall-beta2.png), [018-settings-install-invalid-file](../evidence/shots/f1c/light/018-settings-install-invalid-file.png), [019-settings-install-tampered](../evidence/shots/f1c/light/019-settings-install-tampered.png)
- Console: `observer log: [{t:1175,btns:'…Install from file…[dis]…'},{t:1228,btns:'…Install from file…'}]`
- Network: `POST /sources/install → 201 {version:'0.1.0-beta.1', reimport:true, updated:{symbols:15,footprints:36,components:17,variants:42}}`
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:186` — handleFile: setBusy → install → refresh; the result is discarded, no notice
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:499` — 'Latest stable' falls back to the bundled version even when the installed one is newer
- Code: `src/modules/library/backend/sync/opclib-importer.ts:260` — requireSignature defaults off; no version comparison against the installed release
- Suggested fix: LibrariesPanel.tsx handleFile (:186): keep the returned ImportResult and render a role=status line under the install buttons, e.g. 'Installed OpenPCB Core Library 0.1.0-beta.2 · 17 components updated' or 'Reinstalled (no changes)' when reimport is true. While busy, show 'Installing <file name>…'. Backend installOpclibFromBytes: when lib.id already has a newer installed release, return 409 {code:'downgrade', installed, incoming} unless ?force=1, and have the UI confirm through a kit dialog (not window.confirm). CoreLibraryCard (:499): show 'Latest stable' only when a remote check ran, or use max(installed, bundled). Map 'invalid .opclib: …' to 'This file isn't a valid OpenPCB library (or it was modified).' plus the file name, with the raw text in a details disclosure.
- Verification (vf1c): **confirmed** — Reproduced in vf1c-light. A MutationObserver on <main> recorded only two states during Install from file (core beta.1 over beta.2): all buttons [dis] at t=1216 ms, re-enabled at t=1271 ms. There was no busy text, no success or result text, and no role=status/alert/aria-live region in <main>. The downgrade beta.2 -> beta.1 applied silently ('Installed 0.1.0-beta.1'). After reinstalling beta.2 the card reads 'Up to date · Installed 0.1.0-beta.2 · Latest stable 0.1.0-beta.1'. sample.txt gave 'invalid .opclib: Invalid ZIP archive: central directory not found', and the tampered pack gave 'invalid .opclib: manifest digest mismatch: declared=9b5e… recomputed=e0fd…' (full 64-hex hashes), with no file name. Recalibrated S2 -> S3. Install works; the defect is missing feedback plus an unguarded downgrade that the user explicitly chose. Part refuted/weakened: the 'unsigned replacement of the official core' angle is not a regression today, because the official core is itself unsigned (card 'Signature unsigned' for the installed and bundled core; resources/core-library ships signaturePresent:false; scripts/fetch-core-library.ts only warns on an unsigned manifest), so enforcing OPENPCB_REQUIRE_SIGNED_OPCLIB would reject the real core. Overlaps: raw invalid-file errors are also in Q2-015, and the misleading 'Latest stable' is also in Q2-016. The unique parts here are the missing install feedback and the silent downgrade. Stack B core left at 0.1.0-beta.2 as f1c left it. · evidence: [001-settings-after-downgrade-beta1](../evidence/shots/vf1c/light/001-settings-after-downgrade-beta1.png), [002-settings-after-upgrade-beta2-latest-older](../evidence/shots/vf1c/light/002-settings-after-upgrade-beta2-latest-older.png), [003-settings-install-invalid-file](../evidence/shots/vf1c/light/003-settings-install-invalid-file.png), observer: [{t:1216, all buttons [dis]}, {t:1271, re-enabled}]; no live regions in <main>, tampered pack -> 'invalid .opclib: manifest digest mismatch: declared=9b5e…80b9 recomputed=e0fd…5db2'

</details>


## T-058

**Removing a library source never says its parts are placed in designs, and those parts quietly lose their library link**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner C2 · wave W2 · scope backend · estimate M
- Findings: F1C-004 · known ref K06

**Summary.** The native confirm uses the raw id 'qa.f1c.pack' and has no usage information. The DELETE returns {removed:3}. The design still renders from its snapshots, which is good. But R1's inspector silently drops the Footprint variant row: the resistor had 9 variants and now none can be chosen. 'Open in Library' lands on the unfiltered list with no 'part no longer exists' message. Nothing in the design, BOM or ERC mentions…

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:221` — window.confirm with raw id, no usage info

**Proposed fix.** Remove-source confirm lists placed-part/design count (needs backend count endpoint). — Detail: Backend: add GET /api/modules/library/sources/:id/usage that returns placement counts per design (the designer can register a usage query through the library SDK, or the library can ask the designer SDK through ctx.sdk). Frontend LibrariesPanel.handleDelete (:217): replace window.confirm with a kit ConfirmDialog that names the source by display name and lists usage, e.g. 'Remove QA-f1c Team Pack? 3 parts, 2 placed in QA-f1c-drop. Placed parts keep their snapshot but can no longer switch footprint.'. Designer PartI…

**Evidence.** [011-drop-design-after-source-removed](../evidence/shots/f1c/dark/011-drop-design-after-source-removed.png), [006-inspector-R1-pack-installed](../evidence/shots/vf1c/dark/006-inspector-R1-pack-installed.png)

<details><summary>F1C-004 — Removing a library source never says its parts are placed in designs, and those parts quietly lose their library link (S3, confirmed)</summary>

- Area settings · stack B · design 7c22a0f9-faf8-4d2d-9da7-95c117eac147 · themes dark · viewports 1440x900
- Repro:
  1. Stack B: install team pack 'QA-f1c Team Pack' (3 parts) from file
  2. Create design QA-f1c-drop and place 'QA-f1c pack LED' and 'QA-f1c pack Resistor' via the Components palette
  3. Settings → Libraries → Remove on 'QA-f1c Team Pack'. A native confirm appears (dialog spy confirm=1): 'Remove library "qa.f1c.pack" and all its components? This cannot be undone.' → accept
  4. Open QA-f1c-drop: select R1 and check the inspector; click 'Open in Library'
- Expected: The confirm is a kit dialog that names the pack by display name and says '2 parts are used in 1 design (QA-f1c-drop)'. Afterwards, placed parts whose component is gone are flagged ('library part missing') with a way to relink or replace them.
- Actual: The native confirm uses the raw id 'qa.f1c.pack' and has no usage information. The DELETE returns {removed:3}. The design still renders from its snapshots, which is good. But R1's inspector silently drops the Footprint variant row: the resistor had 9 variants and now none can be chosen. 'Open in Library' lands on the unfiltered list with no 'part no longer exists' message. Nothing in the design, BOM or ERC mentions the orphaned parts. Library counts do update (70 → 67 parts, 4 → 3 sources) because the space remounts. Selecting the orphaned R1 fires 2× 404 GET …/library/components/qa.f1c.pack.passive.resistor/placement (console only).
- Screenshots: [011-drop-design-after-source-removed](../evidence/shots/f1c/dark/011-drop-design-after-source-removed.png), [012-inspector-removed-source-part](../evidence/shots/f1c/dark/012-inspector-removed-source-part.png), [013-open-in-library-removed-part](../evidence/shots/f1c/dark/013-open-in-library-removed-part.png)
- Console: `__qaDialogCalls.confirm=1`; `GET /api/modules/designer/library/components/qa.f1c.pack.passive.resistor/placement → 404 (x2) when R1 is selected; not surfaced in UI`
- Network: `DELETE /api/modules/library/sources/qa.f1c.pack → 200 {removed:3}`
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:221` — window.confirm with raw id, no usage info
- Code: `src/modules/library/backend/queries.ts:2021` — deleteSource has no reference check against designer placements
- Suggested fix: Backend: add GET /api/modules/library/sources/:id/usage that returns placement counts per design (the designer can register a usage query through the library SDK, or the library can ask the designer SDK through ctx.sdk). Frontend LibrariesPanel.handleDelete (:217): replace window.confirm with a kit ConfirmDialog that names the source by display name and lists usage, e.g. 'Remove QA-f1c Team Pack? 3 parts, 2 placed in QA-f1c-drop. Placed parts keep their snapshot but can no longer switch footprint.'. Designer PartInspectorPanel: when the placement/detail fetch 404s, render a 'Library part missing' warning row in place of the Footprint row (today the row is silently dropped). Make 'Open in Library' show 'This part is no longer in the library' (K21).
- Verification (vf1c): **confirmed** — Reproduced on stack B with design QA-f1c-drop (inherited ownership). With qa.f1c.pack reinstalled, R1 (qa.f1c.pack.passive.resistor) shows a Footprint picker row '0603 (1608 metric) SMD' in the inspector. Settings > Libraries > Remove on 'QA-f1c Team Pack' opened a native confirm 'Remove library "qa.f1c.pack" and all its components? This cannot be undone.' (dialog spy confirm count +1), with no usage info. After accepting and returning to the design, R1's inspector has no Footprint row at all. The console shows 2x 404 GET /api/modules/designer/library/components/qa.f1c.pack.passive.resistor/placement, and nothing in the UI mentions the missing part. 'Open in Library' lands on the unfiltered list ('Library 70 parts · 3 sources…') with no message. The design still renders from snapshots, which is correct. The native-confirm sub-item is K06 (also Q2-004), and the 'Open in Library' sub-item is K21 (also Q3-016). The unique defect is the missing usage check and the silent loss of the footprint row. S3 kept. · evidence: [006-inspector-R1-pack-installed](../evidence/shots/vf1c/dark/006-inspector-R1-pack-installed.png), [007-inspector-R1-after-pack-removed](../evidence/shots/vf1c/dark/007-inspector-R1-after-pack-removed.png), [008-open-in-library-orphan](../evidence/shots/vf1c/dark/008-open-in-library-orphan.png), console: 404 GET /api/modules/designer/library/components/qa.f1c.pack.passive.resistor/placement (x2)

</details>


## T-059

**'Sign in to OpenPCB Cloud' gives no feedback and no way out when the cloud is unreachable**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q10-011

**Summary.** The app opens a new browser tab/window to <webUrl>/desktop-auth?challenge=…&state=… which fails with 'This site can’t be reached'. The Account card is unchanged: no pending state, no error (loginError stays null), no cancel. Repeated clicks just open more dead tabs. In Electron this is the system browser showing an error page with nothing in the app explaining it.

**Root cause.** `src/core/frontend/src/cloud/AuthProvider.tsx:172` — beginCloudLogin: no probe, no pending state

**Proposed fix.** Sign-in shows 'Waiting for browser…' with Cancel; reachability probe first, offline message if unreachable. — Detail: In beginCloudLogin, probe `${apiUrl}/v1/health` (AbortSignal.timeout(3000)) first and set loginError('Can't reach OpenPCB Cloud. Check your connection and try again.') on failure; after opening the browser set a 'waitingForBrowser' state rendered in SignInCard as 'Finish signing in in your browser… · Cancel · Reopen browser'.

**Evidence.** [012-C1-account-signedout](../evidence/shots/q10/dark/012-C1-account-signedout.png), [010-account-signedout](../evidence/shots/vq10/dark/010-account-signedout.png)

<details><summary>Q10-011 — 'Sign in to OpenPCB Cloud' gives no feedback and no way out when the cloud is unreachable (S3, confirmed)</summary>

- Area settings · stack C1 · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack C1 (cloud URLs dead), signed out
  2. Home → sidebar footer 'Sign in to sync' (lands on Settings → Account)
  3. Click 'Sign in to OpenPCB Cloud'
- Expected: Either a quick reachability check with an inline 'Can't reach OpenPCB Cloud right now' error, or at least a pending state ('Waiting for sign-in in your browser… Cancel') so the user knows what is happening and can retry.
- Actual: The app opens a new browser tab/window to <webUrl>/desktop-auth?challenge=…&state=… which fails with 'This site can’t be reached'. The Account card is unchanged: no pending state, no error (loginError stays null), no cancel. Repeated clicks just open more dead tabs. In Electron this is the system browser showing an error page with nothing in the app explaining it.
- Screenshots: [012-C1-account-signedout](../evidence/shots/q10/dark/012-C1-account-signedout.png), [013-C1-account-after-signin-click](../evidence/shots/q10/dark/013-C1-account-after-signin-click.png), [014-C1-signin-popup-deadurl](../evidence/shots/q10/dark/014-C1-signin-popup-deadurl.png)
- Network: `window.open http://127.0.0.1:9/desktop-auth?challenge=…&state=… → chrome-error://chromewebdata ('This site can’t be reached')`
- Code: `src/core/frontend/src/cloud/AuthProvider.tsx:172` — beginCloudLogin: no probe, no pending state
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:26` — Sign-in button has no busy/pending UI
- Suggested fix: In beginCloudLogin, probe `${apiUrl}/v1/health` (AbortSignal.timeout(3000)) first and set loginError('Can't reach OpenPCB Cloud. Check your connection and try again.') on failure; after opening the browser set a 'waitingForBrowser' state rendered in SignInCard as 'Finish signing in in your browser… · Cancel · Reopen browser'.
- Verification (vq10): **confirmed** — Reproduced signed out: 'Sign in to OpenPCB Cloud' opened a second tab at chrome-error://chromewebdata (the dead 127.0.0.1:9 web URL), and the Account card was unchanged: no pending state, no error, no cancel. Code: beginCloudLogin opens the URL with no reachability probe and sets no 'waiting' state; loginError is only set on a missing webUrl or a failed token exchange. In Electron the system browser shows its own offline page, which partly explains the failure, so S3 stands (a UX gap, not a blocker). Ships (cloud.auth 'all'). · evidence: [010-account-signedout](../evidence/shots/vq10/dark/010-account-signedout.png), [011-account-after-signin-click](../evidence/shots/vq10/dark/011-account-after-signin-click.png), tab-list: 1: [127.0.0.1](chrome-error://chromewebdata/)

</details>


## T-060

**Account page uses raw emerald/amber/red palette, pill badges and 36 px buttons; 'OpenPCB AI Cloud — Coming soon' contradicts the shipped OpenPCB Cloud assistant provider**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q10-013 · known ref K45,K43

**Summary.** Plan banner text dark #5ee9b5 (emerald-300; nearest token ΔE 14.5) / light #007a55 (ΔE 8.1); 'Coming soon' pill dark #ffd130 (amber-300, ΔE 8.8 to nearest, 30+ from --status-warning #d9a441) / light #bb4d00 (ΔE 16.9); 'Paid'/'Coming soon'/feature chips are rounded-full pills; 'Sign in to OpenPCB Cloud' and 'Sign out' are 36 px (h-9); loginError banner uses red-50/red-700 raw classes. Copy: signed-out teaser says 'Op…

**Root cause.** `src/core/frontend/src/settings/panels/AccountPanel.tsx:62` — bg-emerald-50 text-emerald-700 dark:…emerald-300

**Proposed fix.** Account panel to status tokens/kit Button 22px; remove AiCloudTeaser 'Coming soon' block. — Detail: Replace emerald/amber/red classes with text-status-success / bg-status-success-soft, text-status-warning / bg-status-warning-soft, text-status-danger / bg-status-danger-soft; use the kit Chip/Badge (2 px radius) and kit Button (22 px). Update AiCloudTeaser copy to describe the Pro-tier OpenPCB Cloud assistant (or hide the teaser when cloud.copilot is on).

**Note.** Binding: remove Coming-soon stubs.

**Evidence.** [012-C1-account-signedout](../evidence/shots/q10/dark/012-C1-account-signedout.png), [010-account-signedout](../evidence/shots/vq10/dark/010-account-signedout.png)

<details><summary>Q10-013 — Account page uses raw emerald/amber/red palette, pill badges and 36 px buttons; 'OpenPCB AI Cloud — Coming soon' contradicts the shipped OpenPCB Cloud assistant provider (S3, confirmed)</summary>

- Area settings · stack C1 · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack C1 → Settings → Account (signed out), then with a (simulated) Pro session
  2. Pixel-probe the plan banner, 'Coming soon' pill, 'Plan: Pro' line; measure buttons
  3. Assistant → model pill → Provider list
- Expected: Status colours from --status-success/--status-warning tokens, 2 px radii, 22 px controls; teaser copy consistent with what the build offers.
- Actual: Plan banner text dark #5ee9b5 (emerald-300; nearest token ΔE 14.5) / light #007a55 (ΔE 8.1); 'Coming soon' pill dark #ffd130 (amber-300, ΔE 8.8 to nearest, 30+ from --status-warning #d9a441) / light #bb4d00 (ΔE 16.9); 'Paid'/'Coming soon'/feature chips are rounded-full pills; 'Sign in to OpenPCB Cloud' and 'Sign out' are 36 px (h-9); loginError banner uses red-50/red-700 raw classes. Copy: signed-out teaser says 'OpenPCB AI Cloud — Coming soon … Cloud will add it on a subscription', while cloud.copilot is graduated ('all') and a Pro session gets an 'OpenPCB Cloud' provider in the Assistant.
- Screenshots: [012-C1-account-signedout](../evidence/shots/q10/dark/012-C1-account-signedout.png), [012-C1-account-signedout](../evidence/shots/q10/light/012-C1-account-signedout.png), [080-C1-account-signedin-offline](../evidence/shots/q10/dark/080-C1-account-signedin-offline.png), [115-C1-account-signedin-1100](../evidence/shots/q10/light/115-C1-account-signedin-1100.png), [091-C1-assistant-model-pill](../evidence/shots/q10/dark/091-C1-assistant-model-pill.png)
- Pixel probes: {"file": "shots/q10/dark/012-C1-account-signedout.png", "x": 661, "y": 144, "hex": "#5ee9b5", "nearestToken": "--net-ground", "deltaE": 14.5}; {"file": "shots/q10/dark/012-C1-account-signedout.png", "x": 1074, "y": 386, "hex": "#ffd130", "nearestToken": "--net-bus", "deltaE": 8.8}; {"file": "shots/q10/light/012-C1-account-signedout.png", "x": 661, "y": 144, "hex": "#007a55", "nearestToken": "--net-ground", "deltaE": 8.1}; {"file": "shots/q10/light/012-C1-account-signedout.png", "x": 1074, "y": 387, "hex": "#bb4d00", "nearestToken": "--net-power", "deltaE": 16.9}
- Census: `census/cloud-account-dark-1440.json`
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:62` — bg-emerald-50 text-emerald-700 dark:…emerald-300
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:15` — amber raw classes
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:27` — h-9 button
- Code: `src/core/frontend/src/settings/panels/account/AiCloudTeaser.tsx:26` — amber rounded-full 'Coming soon' pill; copy
- Code: `src/core/frontend/src/settings/panels/account/AccountSignedIn.tsx:41` — emerald plan line; h-9 Sign out at :49
- Code: `src/core/frontend/src/settings/panels/account/CloudValueCard.tsx:28` — rounded-full 'Paid' pill
- Suggested fix: Replace emerald/amber/red classes with text-status-success / bg-status-success-soft, text-status-warning / bg-status-warning-soft, text-status-danger / bg-status-danger-soft; use the kit Chip/Badge (2 px radius) and kit Button (22 px). Update AiCloudTeaser copy to describe the Pro-tier OpenPCB Cloud assistant (or hide the teaser when cloud.copilot is on).
- Verification (vq10): **confirmed** — Re-probed: dark plan text #5ee9b5 (ΔE 14.5), 'Coming soon' #ffd130 (ΔE 8.8); light plan #007a55 (ΔE 8.1), 'Coming soon' #bb4d00 (ΔE 16.9). Sign in button 36 px. Raw classes confirmed at AccountPanel.tsx:15,62 (amber/emerald), :34 (red loginError), AccountSignedIn.tsx:41 (emerald), AiCloudTeaser.tsx:26 (amber rounded-full), CloudValueCard.tsx:28 (rounded-full 'Paid', colour is the --selection token). PLAN.md scoped Settings as token re-skin only and lists 'Settings panels keep raw amber/red/emerald banner colours' as a follow-up, so this is a known open item (K45), not a regression, but it is still off-token for release. Copy contradiction confirmed: cloud.copilot is 'all' and a Pro session gets an 'OpenPCB Cloud' provider, while the teaser says 'Coming soon'. · evidence: [010-account-signedout](../evidence/shots/vq10/dark/010-account-signedout.png), [010-account-signedout](../evidence/shots/vq10/light/010-account-signedout.png), [021-account-signedin-offline](../evidence/shots/vq10/dark/021-account-signedin-offline.png)

</details>


## T-061

**Settings header is 52px with a 32px hand-rolled search and 36px nav rows (other screens: 34px header, 22px controls)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-007 · known ref K39
- Depends on: ['T-004']

**Summary.** header=52, search=32 (w200), back=32, navBtn=36; no status bar unlike Home/Library.

**Root cause.** `src/core/frontend/src/screens/SettingsScreen.tsx:53` — h-[52px] header

**Proposed fix.** Settings header 34px, kit SearchField 22px, 22–24px nav rows. — Detail: SettingsScreen.tsx:53 h-[34px]; Back -> kit IconButton; replace the label/input at :64-76 with <SearchField> from @shared/frontend/ui/search-field; SettingsSidebar.tsx:61 h-6 rows like Home sidebar filters.

**Evidence.** [001-home](../evidence/shots/q2/dark/001-home.png), [001-settings-general](../evidence/shots/vq2/dark/001-settings-general.png)

<details><summary>Q2-007 — Settings header is 52px with a 32px hand-rolled search and 36px nav rows (other screens: 34px header, 22px controls) (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Home: header 34px (measured). Library: 34px
  2. Open Settings (rail gear / Cmd+, / right-click)
  3. Measure: header 52px, Back button 32px, search input 32px (native type=search with WebKit clear x), sidebar nav buttons 36px
- Expected: Settings shell follows the neutral-EDA metrics: 34px header, kit SearchField (22px), 22–24px nav rows like the Home sidebar filters.
- Actual: header=52, search=32 (w200), back=32, navBtn=36; no status bar unlike Home/Library.
- Screenshots: [001-home](../evidence/shots/q2/dark/001-home.png), [002-settings-general](../evidence/shots/q2/dark/002-settings-general.png), [004-search-nomatch](../evidence/shots/q2/dark/004-search-nomatch.png)
- Census: `census/settings-general-dark-1440.json`
- Code: `src/core/frontend/src/screens/SettingsScreen.tsx:53` — h-[52px] header
- Code: `src/core/frontend/src/screens/SettingsScreen.tsx:75` — h-8 hand-rolled search input
- Code: `src/core/frontend/src/settings/SettingsSidebar.tsx:61` — h-9 nav rows
- Suggested fix: SettingsScreen.tsx:53 h-[34px]; Back -> kit IconButton; replace the label/input at :64-76 with <SearchField> from @shared/frontend/ui/search-field; SettingsSidebar.tsx:61 h-6 rows like Home sidebar filters.
- Verification (vq2): **CONFIRMED** — Measured on B: header 52px, Back 32px, search 32px native type=search, nav rows 36px (SettingsScreen.tsx:53,75; SettingsSidebar.tsx:61). Settings was explicitly 'token re-skin only' in PLAN §0 non-goals, so this is a documented, not intentional-final, gap; still valid for release polish. · evidence: [001-settings-general](../evidence/shots/vq2/dark/001-settings-general.png)

</details>


## T-062

**Settings banners, chips and checkboxes use raw amber/red/emerald/blue palette instead of status tokens**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate M
- Findings: Q2-008 · known ref K45
- Depends on: ['T-004']

**Summary.** Informational 'desktop-only' notes are styled as amber warnings (bg-amber-50/amber-900/30); banners are rounded-xl with raw red/emerald borders; checked native checkboxes render Chromium accent blue.

**Root cause.** `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` — DesktopOnlyNote amber

**Proposed fix.** Banners/chips/checkboxes -> kit Banner/Badge/Checkbox (status tokens). — Detail: Add a <Notice tone='info|success|warning|danger'> to src/shared/frontend/ui built on --status-*-soft bg + --status-* text + rounded-control; use it for LibrariesPanel.tsx:279, AssistantPanel.tsx:333/338, PrivacyPanel.tsx:87/93/99, GeneralPanel.tsx:19 (tone=neutral/info, not warning). Replace amber/emerald chips (LibrariesPanel.tsx:388,411,415; McpSection.tsx:141) with kit <Pill tone>. Replace native checkboxes with kit <Checkbox> (src/shared/frontend/ui/checkbox.tsx).

**Evidence.** [002-settings-general](../evidence/shots/q2/dark/002-settings-general.png), [001-settings-general](../evidence/shots/vq2/dark/001-settings-general.png)

<details><summary>Q2-008 — Settings banners, chips and checkboxes use raw amber/red/emerald/blue palette instead of status tokens (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. General: 'Updates are managed by the OpenPCB desktop app' / 'Local file locations…' notes
  2. Libraries: trigger an error (bogus Install URL) → red banner; 'read-only' chip; 'unsigned'/'verified'
  3. Assistant: toggle any default → green 'Assistant defaults saved.' banner; OpenAI/OpenRouter warning cards; 'Caution' chip; native checkboxes
  4. Privacy: amber desktop-only note (blue 'Restart' and red error variants in code)
- Expected: Status colours only via tokens (--status-*-soft backgrounds, --status-* text), 2px radii, kit Checkbox.
- Actual: Informational 'desktop-only' notes are styled as amber warnings (bg-amber-50/amber-900/30); banners are rounded-xl with raw red/emerald borders; checked native checkboxes render Chromium accent blue.
- Screenshots: [002-settings-general](../evidence/shots/q2/dark/002-settings-general.png), [100-general](../evidence/shots/q2/light/100-general.png), [013-core-check-error](../evidence/shots/q2/dark/013-core-check-error.png), [102-libraries-url-error](../evidence/shots/q2/light/102-libraries-url-error.png), [021-mcp-enabled](../evidence/shots/q2/dark/021-mcp-enabled.png), [103-assistant](../evidence/shots/q2/light/103-assistant.png), [040-privacy](../evidence/shots/q2/dark/040-privacy.png)
- Pixel probes: {"file": "shots/q2/light/100-general.png", "x": 1000, "y": 335, "hex": "#fffbeb", "nearestToken": "--surface-input", "deltaE": 8.4}; {"file": "shots/q2/dark/002-settings-general.png", "x": 1000, "y": 335, "hex": "#311b0f", "nearestToken": "--status-warning-soft@app", "deltaE": 8.8}; {"file": "shots/q2/light/102-libraries-url-error.png", "x": 700, "y": 171, "hex": "#c3080f", "nearestToken": "--status-danger", "deltaE": 18.5}; {"file": "shots/q2/dark/013-core-check-error.png", "x": 600, "y": 170, "hex": "#e1afaf", "nearestToken": "--text-secondary", "deltaE": 20.9}; {"file": "shots/q2/dark/021-mcp-enabled.png", "x": 567, "y": 160, "hex": "#004f3b", "nearestToken": "--status-success-soft@app", "deltaE": 27.6}; {"file": "shots/q2/light/103-assistant.png", "x": 567, "y": 160, "hex": "#5ee9b5", "nearestToken": "--net-ground", "deltaE": 35.9}; {"file": "shots/q2/dark/021-mcp-enabled.png", "x": 1000, "y": 600, "hex": "#6c5426", "nearestToken": "--text-disabled", "deltaE": 33.2}; {"file": "shots/q2/light/102-libraries-url-error.png", "x": 660, "y": 690, "hex": "#fef3c6", "nearestToken": "--status-warning-soft@app", "deltaE": 18.8}; {"file": "shots/q2/dark/021-mcp-enabled.png", "x": 571, "y": 429, "hex": "#99c8ff", "nearestToken": "--status-info", "deltaE": 12.2}; {"file": "shots/q2/light/103-assistant.png", "x": 572, "y": 431, "hex": "#0075ff", "nearestToken": "--status-info", "deltaE": 46.0}; {"file": "shots/vq2/dark/011-install-url-error.png", "x": 760, "y": 173, "hex": "#ffc9c9", "nearestToken": "--text", "deltaE": 20.5}; {"file": "shots/vq2/dark/011-install-url-error.png", "x": 567, "y": 175, "hex": "#82181a", "nearestToken": "--status-danger", "deltaE": 32.2}; {"file": "shots/vq2/light/101-libraries-error.png", "x": 584, "y": 169, "hex": "#c2060d", "nearestToken": "--status-danger", "deltaE": 18.8}; {"file": "shots/vq2/light/103-assistant-checkbox.png", "x": 582, "y": 614, "hex": "#0075ff", "nearestToken": "--status-info", "deltaE": 46.0}; {"file": "shots/vq2/dark/011-install-url-error.png", "x": 678, "y": 693, "hex": "#fce484", "nearestToken": "--status-warning", "deltaE": 25.5}
- Census: `census/settings-assistant-dark-1440.json`
- Code: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` — DesktopOnlyNote amber
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:279` — rounded-xl red banner
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:388` — amber read-only chip
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:411` — emerald/amber signature text
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:333` — red/emerald banners
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:1001` — border-emerald-400/30
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:141` — amber Caution chip
- Code: `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:86` — amber/blue/red notes
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:62` — emerald plan strip (cloud builds)
- Suggested fix: Add a <Notice tone='info|success|warning|danger'> to src/shared/frontend/ui built on --status-*-soft bg + --status-* text + rounded-control; use it for LibrariesPanel.tsx:279, AssistantPanel.tsx:333/338, PrivacyPanel.tsx:87/93/99, GeneralPanel.tsx:19 (tone=neutral/info, not warning). Replace amber/emerald chips (LibrariesPanel.tsx:388,411,415; McpSection.tsx:141) with kit <Pill tone>. Replace native checkboxes with kit <Checkbox> (src/shared/frontend/ui/checkbox.tsx).
- Verification (vq2): **CONFIRMED** — Pixel probes (vq2): dark General desktop-only note #311b0f (warning-soft dE8.8); light #fffbeb dE8.4; Libraries error banner dark text #ffc9c9 dE20.5, border #82181a dE32.2, light text #c2060d dE18.8, border #ffa2a2 dE34.6; 'read-only' chip text #fce484 dE25.5; 'unsigned' #f8cc2f / light #bc5208 dE16.7; checked native checkbox #0075ff dE46. Caveat: the amber DesktopOnlyNote only renders in the browser harness (Electron has window.updater/electronAPI), so that sub-item does not ship; banners, chips, signature colours, Caution chip and native checkboxes do. PLAN Run-1/Run-2 follow-ups list 'Settings raw amber/red/emerald banner colours' as known debt. · evidence: [001-settings-general](../evidence/shots/vq2/dark/001-settings-general.png), [100-general](../evidence/shots/vq2/light/100-general.png), [011-install-url-error](../evidence/shots/vq2/dark/011-install-url-error.png), [101-libraries-error](../evidence/shots/vq2/light/101-libraries-error.png), [103-assistant-checkbox](../evidence/shots/vq2/light/103-assistant-checkbox.png)

</details>


## T-063

**Settings controls hand-rolled: 23–43px heights, no visible focus, toggles expose no pressed state**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate M
- Findings: Q2-009, Q2-011
- Depends on: ['T-004']

**Summary.** Four different button heights and three input heights across 5 panels; theme toggle has no aria-pressed and changes height when System is selected. | Also covers: Q2-011: No visible keyboard focus on Assistant settings selects/inputs; toggles expose no pressed…

**Root cause.** `src/core/frontend/src/components/ThemeToggle.tsx:44` — hand-rolled segmented; System subtitle at :52

**Proposed fix.** Migrate Settings inputs/selects/toggles to kit Input/Select/Switch/SegmentedControl (22px, focus ring, aria-pressed/checked). — Detail: ThemeToggle.tsx -> kit SegmentedControl (show resolved System mode as trailing caption, not a second line); AssistantPanel.tsx:819 tool-calling -> SegmentedControl; LibrariesPanel.tsx:304-340/510-532 and AssistantPanel.tsx:865 -> kit Button size md/sm; add kit Input/Select at 22px to src/shared/frontend/ui and use in AssistantPanel.tsx:930-981 and LibrariesPanel.tsx:326; kit Checkbox for all boolean prefs.

**Evidence.** [003b-theme-system-crop](../evidence/shots/q2/dark/003b-theme-system-crop.png), [002-theme-system](../evidence/shots/vq2/dark/002-theme-system.png), [038-select-kbd-focus-invisible](../evidence/shots/q2/dark/038-select-kbd-focus-invisible.png)

<details><summary>Q2-009 — Settings controls are hand-rolled with inconsistent heights (23–43px) instead of kit components (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. General: theme toggle buttons 25px; choosing 'System' grows that button to 43px (second line 'Light'/'Dark') and shifts the card
  2. Libraries: Check/Download/Install buttons ~34px (py-2), Remove ~24px, URL input 30px
  3. Assistant: native <select> 30px, text inputs 29px, Tool calling segmented 23px, Save provider 27px, header buttons ~22px
  4. Privacy: 20px native checkbox used as a toggle (signed-in Account uses a custom switch)
- Expected: Kit Button/SegmentedControl/Checkbox/Select at 22px (sm 20px) as elsewhere in the redesigned app.
- Actual: Four different button heights and three input heights across 5 panels; theme toggle has no aria-pressed and changes height when System is selected.
- Screenshots: [003b-theme-system-crop](../evidence/shots/q2/dark/003b-theme-system-crop.png), [010-libraries](../evidence/shots/q2/dark/010-libraries.png), [024-provider-form](../evidence/shots/q2/dark/024-provider-form.png), [040-privacy](../evidence/shots/q2/dark/040-privacy.png)
- Census: `census/settings-assistant-provider-dark-1440.json`
- Code: `src/core/frontend/src/components/ThemeToggle.tsx:44` — hand-rolled segmented; System subtitle at :52
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:308` — py-2 buttons
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:958` — native Select
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:930` — TextInput
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:819` — tool-calling segments
- Code: `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:75` — h-5 native checkbox
- Suggested fix: ThemeToggle.tsx -> kit SegmentedControl (show resolved System mode as trailing caption, not a second line); AssistantPanel.tsx:819 tool-calling -> SegmentedControl; LibrariesPanel.tsx:304-340/510-532 and AssistantPanel.tsx:865 -> kit Button size md/sm; add kit Input/Select at 22px to src/shared/frontend/ui and use in AssistantPanel.tsx:930-981 and LibrariesPanel.tsx:326; kit Checkbox for all boolean prefs.
- Verification (vq2): **CONFIRMED** — Measured: theme buttons 25px, System active 43px (grows card); Libraries buttons 34px, Remove 25px, URL input 30px; Assistant selects 30px, text inputs 29px, tool-calling segments 23px, Save/Re-test/Models 27px, Add provider 25px, checkboxes 14px (Privacy 20px). Kit SegmentedControl/Checkbox/SearchField/Button exist; kit Input/Select/Switch do not yet (PLAN Run-2 follow-up). Overlap: the theme-toggle sub-item is also filed as Q1-022 (S4) — triage should fold Q1-022 into this. · evidence: [002-theme-system](../evidence/shots/vq2/dark/002-theme-system.png), [010-libraries](../evidence/shots/vq2/dark/010-libraries.png), [042-opencode-expanded](../evidence/shots/vq2/dark/042-opencode-expanded.png)

</details>

<details><summary>Q2-011 — No visible keyboard focus on Assistant settings selects/inputs; toggles expose no pressed state (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant
  2. Click the search box, press Tab repeatedly
  3. When focus reaches Default provider / Prompt preset / Context per tool / Tool policy selects (and provider form inputs), nothing changes visually
- Expected: Token focus ring (like the Settings search's ring-selection) on every focusable control; segmented toggles expose aria-pressed.
- Actual: Selects/inputs: outline none, border unchanged, box-shadow none while :focus-visible. Theme Light/Dark/System and tool-calling Auto/On/Off buttons have no aria-pressed; the fetched 'Default model' select has no accessible name; API key input is named only by placeholder.
- Screenshots: [038-select-kbd-focus-invisible](../evidence/shots/q2/dark/038-select-kbd-focus-invisible.png), [038b-crop](../evidence/shots/q2/dark/038b-crop.png)
- Census: `census/settings-assistant-provider-dark-1440.json`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:951` — TextInput outline-none
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:974` — Select outline-none
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:705` — <label> not associated with input
- Code: `src/core/frontend/src/components/ThemeToggle.tsx:38` — no aria-pressed
- Suggested fix: AssistantPanel.tsx:951/974 add `focus-visible:border-selection focus-visible:ring-1 focus-visible:ring-selection` (match SettingsScreen search); :705/:776 turn the sibling <label> into <label htmlFor> + id on the input/select; :821 and ThemeToggle.tsx:38 add aria-pressed (or use kit SegmentedControl).
- Verification (vq2): **CONFIRMED** — Tab walk: 4 Default-assistant selects fv=true, outline none, box-shadow none, border stays --border (#1e1e21 probe dE0) — no focus indication. Snapshot: API key textbox named only by placeholder, fetched Default model combobox has no name, auto/on/off and Light/Dark/System expose no pressed state. Overlaps Q1-022 (theme toggle aria-pressed) and K34 family. · evidence: [039-select-kbd-focus-invisible](../evidence/shots/vq2/dark/039-select-kbd-focus-invisible.png), [039b-crop](../evidence/shots/vq2/dark/039b-crop.png), a11y snapshot: textbox 'Leave empty — no key required', combobox [unnamed], button 'auto'/'on'/'off' no [pressed]

</details>


## T-064

**Settings status/error banners render at the top of the page, off-screen from the action, never clear and can show success+error together**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-010

**Summary.** Error 'Unable to connect. Is the computer able to access the url?' doesn't say which provider/action; success message stays forever beside it; same pattern in Libraries (error above core card while URL input is below).

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:332` — error/message banners at panel top, message never cleared

**Proposed fix.** Inline status next to the triggering action; auto-clear on success; never show success+error together. — Detail: AssistantPanel.tsx: clear `message` in every action start (setMessage(null) next to setError(null)); render per-provider error/success inside the StackedCard body (below the header actions) with role=alert/status; auto-dismiss success after ~3s; prefix errors ('Couldn't refresh models for <label>: …'). LibrariesPanel.tsx:278: render install errors under the URL row.

**Evidence.** [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [034-provider-saved](../evidence/shots/vq2/dark/034-provider-saved.png)

<details><summary>Q2-010 — Settings status/error banners render at the top of the page, off-screen from the action, never clear and can show success+error together (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant, scroll down to a provider card (e.g. QA provider)
  2. Click 'Save provider' → 'Provider saved.' is rendered above 'Default assistant' (scrolled out of view)
  3. Click header 'Models' on an unreachable provider → red 'Unable to connect…' banner also at the top (top=-514px), while the green 'Provider saved.' stays
  4. Banners never auto-dismiss and push the whole form down ~62px each; no role=status/alert
- Expected: Feedback appears next to the control that triggered it (or as a toast) with role=status/alert, auto-dismisses success, and names what failed.
- Actual: Error 'Unable to connect. Is the computer able to access the url?' doesn't say which provider/action; success message stays forever beside it; same pattern in Libraries (error above core card while URL input is below).
- Screenshots: [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [030-models-refresh-error](../evidence/shots/q2/dark/030-models-refresh-error.png), [031-banners-top](../evidence/shots/q2/dark/031-banners-top.png), [015-install-url-error](../evidence/shots/q2/dark/015-install-url-error.png)
- Network: `POST /providers/{id}/models/refresh → 500`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:332` — error/message banners at panel top, message never cleared
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:278` — error banner detached from inputs
- Suggested fix: AssistantPanel.tsx: clear `message` in every action start (setMessage(null) next to setError(null)); render per-provider error/success inside the StackedCard body (below the header actions) with role=alert/status; auto-dismiss success after ~3s; prefix errors ('Couldn't refresh models for <label>: …'). LibrariesPanel.tsx:278: render install errors under the URL row.
- Verification (vq2): **CONFIRMED** — Reproduced: after Save provider, 'Provider saved.' top=-483 while scrollTop=613; then Models on unreachable provider -> red 'Unable to connect…' also at top=-545, green success remains; neither has role=status/alert. Error text does not name provider or action. Libraries same pattern (error banner top=150 vs URL input top=477). · evidence: [034-provider-saved](../evidence/shots/vq2/dark/034-provider-saved.png), [037-models-refresh-error](../evidence/shots/vq2/dark/037-models-refresh-error.png), [011-install-url-error](../evidence/shots/vq2/dark/011-install-url-error.png)

</details>


## T-065

**Esc closes Settings from anywhere — while typing in search, editing a provider (unsaved edits lost) or dismissing the context menu**

- Severity **S3** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-012
- Depends on: ['T-002']

**Summary.** useSettingsHotkeys listens on window and calls closeSettings() for every Escape regardless of target/defaultPrevented.

**Root cause.** `src/core/frontend/src/settings/hooks/useSettingsHotkeys.ts:21` — Escape handler ignores event target

**Proposed fix.** Esc closes Settings only when focus is not in an input/dirty form (shortcut guard); first Esc clears search. — Detail: useSettingsHotkeys.ts:21 return early when event.defaultPrevented, when event.target is input/textarea/select/[contenteditable] (blur it / clear search instead), or when a [role=menu]/[role=dialog] is open; register the context-menu Esc handler to preventDefault.

**Evidence.** [004-search-nomatch](../evidence/shots/q2/dark/004-search-nomatch.png), [014-search-nomatch](../evidence/shots/vq2/dark/014-search-nomatch.png)

<details><summary>Q2-012 — Esc closes Settings from anywhere — while typing in search, editing a provider (unsaved edits lost) or dismissing the context menu (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings: type 'lib' in Search settings, press Esc → returns to Home (search not cleared first)
  2. Settings > Assistant > expand OpenCode Zen, change Label to 'OpenCode Zen EDITED', press Esc → Settings closes; reopening shows the edit discarded with no prompt
  3. Settings: right-click → app menu opens; press Esc → menu AND Settings close together
- Expected: Esc first clears/blur the focused field or closes the open menu; only an Esc with no focused editable closes Settings; unsaved provider edits prompt.
- Actual: useSettingsHotkeys listens on window and calls closeSettings() for every Escape regardless of target/defaultPrevented.
- Screenshots: [004-search-nomatch](../evidence/shots/q2/dark/004-search-nomatch.png)
- Code: `src/core/frontend/src/settings/hooks/useSettingsHotkeys.ts:21` — Escape handler ignores event target
- Suggested fix: useSettingsHotkeys.ts:21 return early when event.defaultPrevented, when event.target is input/textarea/select/[contenteditable] (blur it / clear search instead), or when a [role=menu]/[role=dialog] is open; register the context-menu Esc handler to preventDefault.
- Verification (vq2): **CONFIRMED** — Reproduced three ways: Esc while typing 'lib' in Search settings -> back to Home ('Designs'); Esc while caret in provider Label input (unsaved edit) -> Settings closed to Designer, reopened with card collapsed and edit discarded; app context menu open + Esc -> menu and Settings both closed. useSettingsHotkeys.ts:21 ignores target/defaultPrevented. · evidence: [014-search-nomatch](../evidence/shots/vq2/dark/014-search-nomatch.png), [015-context-menu](../evidence/shots/vq2/dark/015-context-menu.png)

</details>


## T-066

**Settings search only matches the five tab names ('theme', 'mcp', 'api key', 'provider', 'update' → No matches)**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-013

**Summary.** All those queries show 'No matches' (only labels General/Libraries/Assistant/Privacy/About are filtered); the right-hand panel still shows the previous tab; Enter does nothing.

**Root cause.** `src/core/frontend/src/settings/SettingsSidebar.tsx:32` — item.label.includes(needle) only

**Proposed fix.** Add keywords per settings section and search section contents (theme, api key, mcp, provider, update…). — Detail: Add `keywords: string[]` to SETTINGS_NAV items (appearance/theme/dark/light, updates/logs/files, opclib/core library/install, provider/api key/model/mcp/tool, telemetry/sentry/crash, license/version) and match on them in SettingsSidebar.tsx:32; onKeyDown Enter in SettingsScreen.tsx search selects the first visible item.

**Evidence.** [004-search-nomatch](../evidence/shots/q2/dark/004-search-nomatch.png), [014-search-nomatch](../evidence/shots/vq2/dark/014-search-nomatch.png)

<details><summary>Q2-013 — Settings search only matches the five tab names ('theme', 'mcp', 'api key', 'provider', 'update' → No matches) (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings: type 'theme' / 'mcp' / 'api key' / 'provider' / 'update' / 'telemetry' in Search settings
  2. Type 'lib' and press Enter
- Expected: Search matches section and setting names/keywords and jumps to them; Enter opens the first match.
- Actual: All those queries show 'No matches' (only labels General/Libraries/Assistant/Privacy/About are filtered); the right-hand panel still shows the previous tab; Enter does nothing.
- Screenshots: [004-search-nomatch](../evidence/shots/q2/dark/004-search-nomatch.png)
- Code: `src/core/frontend/src/settings/SettingsSidebar.tsx:32` — item.label.includes(needle) only
- Suggested fix: Add `keywords: string[]` to SETTINGS_NAV items (appearance/theme/dark/light, updates/logs/files, opclib/core library/install, provider/api key/model/mcp/tool, telemetry/sentry/crash, license/version) and match on them in SettingsSidebar.tsx:32; onKeyDown Enter in SettingsScreen.tsx search selects the first visible item.
- Verification (vq2): **CONFIRMED** — Reproduced: 'theme', 'mcp', 'api key', 'update' all -> 'No matches' (Updates is a General section); Enter has no handler. SettingsSidebar.tsx:32 filters on item.label only. · evidence: [014-search-nomatch](../evidence/shots/vq2/dark/014-search-nomatch.png)

</details>


## T-067

**Libraries: a failed sources fetch leaves the core card and table on 'Loading…' forever with no retry**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-014 · known ref K40
- Depends on: ['T-006']

**Summary.** Banner 'Internal error'; core card pill 'Loading…' with all facts '—'; table row 'Loading…' indefinitely; no retry. refresh() uses Promise.all so one failure discards both results.

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:173` — Promise.all couples sources + core status

**Proposed fix.** Libraries fetch failure -> error state + Retry (problem.ts); no infinite 'Loading…'. — Detail: LibrariesPanel.tsx:170-182 use Promise.allSettled and separate sourcesError/coreError state; :356 render an error row ('Couldn't load installed libraries' + Retry button calling refresh) instead of Loading…; CoreLibraryCard renders from its own result.

**Evidence.** [019-sources-500](../evidence/shots/q2/dark/019-sources-500.png), [013-sources-500](../evidence/shots/vq2/dark/013-sources-500.png)

<details><summary>Q2-014 — Libraries: a failed sources fetch leaves the core card and table on 'Loading…' forever with no retry (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Inject: route **/api/modules/library/sources → 500 problem+json 'Internal error' (unrouted after)
  2. Settings > General, then Libraries
- Expected: Core library card still renders (its own request succeeded); table shows an error row with Retry; message says what failed.
- Actual: Banner 'Internal error'; core card pill 'Loading…' with all facts '—'; table row 'Loading…' indefinitely; no retry. refresh() uses Promise.all so one failure discards both results.
- Screenshots: [019-sources-500](../evidence/shots/q2/dark/019-sources-500.png)
- Console: `Failed to load resource: 500 @ /api/modules/library/sources`
- Network: `GET /api/modules/library/sources → 500 (injected)`; `GET /api/modules/library/core-library/status → 200`
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:173` — Promise.all couples sources + core status
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:356` — sources===null renders Loading… (no error state)
- Suggested fix: LibrariesPanel.tsx:170-182 use Promise.allSettled and separate sourcesError/coreError state; :356 render an error row ('Couldn't load installed libraries' + Retry button calling refresh) instead of Loading…; CoreLibraryCard renders from its own result.
- Verification (vq2): **CONFIRMED** — Reproduced with route-injected 500 on /library/sources (unrouted after): banner 'Internal error', core card pill 'Loading…' with all facts '—' although /core-library/status succeeded, table 'Loading…' forever. LibrariesPanel.tsx:173 Promise.all couples both. Switching tabs remounts and retries (only workaround). · evidence: [013-sources-500](../evidence/shots/vq2/dark/013-sources-500.png), network: GET /api/modules/library/sources -> 500 (injected)

</details>


## T-068

**Install from URL: developer-facing errors far from the input, Enter does nothing, no label/cancel/progress**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-015

**Summary.** Errors appear in the page-top banner: 'host not in allowlist: example.invalid. Configure OPENPCB_LIBRARY_INSTALL_ALLOWLIST to add hosts.' (env var a desktop user cannot set), 'invalid url: not a url', 'only https:// URLs are accepted', 'fetch https://github.com/… returned HTTP 404'; garbage file → 'invalid .opclib: Invalid ZIP archive: central directory not found'. Input has no accessible name (placeholder only), no…

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:324` — URL row: no form/onSubmit, no label, no cancel

**Proposed fix.** Install-from-URL: labelled input, Enter submits, progress + Cancel, errors inline in user copy. — Detail: LibrariesPanel.tsx:324-341 wrap in <form onSubmit={handleUrl}>, autoFocus + aria-label='Library package URL', add Cancel, show 'Installing…' on the button while busy, render the error inline under the field; map install-source.ts:77 errors to user copy ('Only GitHub release URLs (github.com) are allowed') without the env-var name.

**Evidence.** [014-install-url-open](../evidence/shots/q2/dark/014-install-url-open.png), [011-install-url-error](../evidence/shots/vq2/dark/011-install-url-error.png)

<details><summary>Q2-015 — Install from URL: developer-facing errors far from the input, Enter does nothing, no label/cancel/progress (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Libraries > Install from URL…
  2. Input is not focused; type 'https://example.invalid/bogus.opclib', press Enter (no request sent)
  3. Click Install → 400
  4. Try 'not a url', 'http://github.com/x.opclib', 'https://github.com/OpenPCB-app/does-not-exist/releases/download/v0/bogus.opclib'
- Expected: Enter submits; inline error under the field in user language (e.g. 'Only GitHub release URLs are allowed', 'File not found (404)'); Cancel button; spinner while downloading; labelled input.
- Actual: Errors appear in the page-top banner: 'host not in allowlist: example.invalid. Configure OPENPCB_LIBRARY_INSTALL_ALLOWLIST to add hosts.' (env var a desktop user cannot set), 'invalid url: not a url', 'only https:// URLs are accepted', 'fetch https://github.com/… returned HTTP 404'; garbage file → 'invalid .opclib: Invalid ZIP archive: central directory not found'. Input has no accessible name (placeholder only), no Cancel, no busy indicator.
- Screenshots: [014-install-url-open](../evidence/shots/q2/dark/014-install-url-open.png), [015-install-url-error](../evidence/shots/q2/dark/015-install-url-error.png), [016-install-url-404](../evidence/shots/q2/dark/016-install-url-404.png), [017-install-file-garbage](../evidence/shots/q2/dark/017-install-file-garbage.png), [102-libraries-url-error](../evidence/shots/q2/light/102-libraries-url-error.png)
- Console: `400 @ /api/modules/library/sources/install ×5`
- Network: `POST /api/modules/library/sources/install → 400 (problem+json detail shown verbatim)`
- Census: `census/settings-libraries-light-1440.json`
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:324` — URL row: no form/onSubmit, no label, no cancel
- Code: `src/modules/library/backend/sync/install-source.ts:77` — env-var message surfaced to UI
- Suggested fix: LibrariesPanel.tsx:324-341 wrap in <form onSubmit={handleUrl}>, autoFocus + aria-label='Library package URL', add Cancel, show 'Installing…' on the button while busy, render the error inline under the field; map install-source.ts:77 errors to user copy ('Only GitHub release URLs (github.com) are allowed') without the env-var name.
- Verification (vq2): **CONFIRMED** — Reproduced: Install from URL… opens row with unfocused, unlabelled input (no aria-label, no <label>, no <form>); Enter sends nothing; Install -> 'host not in allowlist: example.invalid. Configure OPENPCB_LIBRARY_INSTALL_ALLOWLIST to add hosts.' rendered at top=150 while input is at top=477; 'not a url' -> 'invalid url: not a url'. No cancel, no busy label. Placement sub-item overlaps Q2-010. · evidence: [011-install-url-error](../evidence/shots/vq2/dark/011-install-url-error.png), [101-libraries-error](../evidence/shots/vq2/light/101-libraries-error.png)

</details>


## T-069

**Core library card: dead-end 'Download <version>' for bundled updates, silent 'Check for updates', misleading 'Latest stable'**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-016

**Summary.** Disabled download button labelled with a version the user cannot obtain; no feedback after a successful check; pill/banner contradict each other.

**Root cause.** `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:460` — updateVersion set for bundled state but canUpdate only for remote

**Proposed fix.** Show check result ('You have the latest'), 'Latest stable' = remote or '—', bundled update -> 'Restart to install'. — Detail: LibrariesPanel.tsx: after handleCoreCheck show 'Checked just now — you have the latest version' when state is up_to_date and remote null; :500 'Latest stable' -> remote?.version ?? '—'; :524 tooltip only before the first check ('No update available' after); for bundled_update_available show 'Restart OpenPCB to install the bundled update' instead of a disabled 'Download <bundled version>'.

**Evidence.** [012-core-checked](../evidence/shots/q2/dark/012-core-checked.png), [012-core-checked](../evidence/shots/vq2/dark/012-core-checked.png)

<details><summary>Q2-016 — Core library card: dead-end 'Download <version>' for bundled updates, silent 'Check for updates', misleading 'Latest stable' (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Settings > Libraries > Check for updates → POST /core-library/check 200 with remote:null; UI unchanged, no 'no updates found / checked at' feedback
  2. 'Latest stable' shows 0.1.0-beta.1 (bundled beta) although no remote release was found
  3. Inject status state=bundled_update_available (route mock, unrouted after) → pill 'Bundled update available' + disabled 'Download 0.1.0-beta.2' with tooltip 'Run check first; updates install latest stable remote release.'
  4. Inject check → 502: red banner 'GitHub releases check failed' while pill still says 'Up to date'
- Expected: Every state offers a working action or explanation (bundled update → 'Install bundled 0.1.0-beta.2' or 'applies on restart'); check reports its result; 'Latest stable' shows '—/unknown' when remote is unavailable; error state reflected in the pill.
- Actual: Disabled download button labelled with a version the user cannot obtain; no feedback after a successful check; pill/banner contradict each other.
- Screenshots: [012-core-checked](../evidence/shots/q2/dark/012-core-checked.png), [018-core-bundled-update-mock](../evidence/shots/q2/dark/018-core-bundled-update-mock.png), [013-core-check-error](../evidence/shots/q2/dark/013-core-check-error.png)
- Network: `POST /api/modules/library/core-library/check → 200 {state:'up_to_date', remote:null}`
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:460` — updateVersion set for bundled state but canUpdate only for remote
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:500` — Latest stable falls back to bundled
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:524` — 'Run check first' tooltip
- Suggested fix: LibrariesPanel.tsx: after handleCoreCheck show 'Checked just now — you have the latest version' when state is up_to_date and remote null; :500 'Latest stable' -> remote?.version ?? '—'; :524 tooltip only before the first check ('No update available' after); for bundled_update_available show 'Restart OpenPCB to install the bundled update' instead of a disabled 'Download <bundled version>'.
- Verification (vq2): **CONFIRMED (partial)** — Partially confirmed. Real: Check for updates -> POST 200 {state:'up_to_date', remote:null} (no stable remote release; prereleases are filtered) and the UI shows no result; Download stays disabled with tooltip 'Run check first…' even after a check; 'Latest stable' shows the bundled 0.1.0-beta.1 (a beta labelled stable). Refuted sub-item: the '502 banner while pill says Up to date' came from a route mock — the real route returns 200 with state 'error' and CoreLibraryCard shows 'Check failed' + inline status.error. Bundled-update dead-end is real in code (canUpdate only for remote) but reachable only when the boot-time bundled import failed (bootstrap imports newer bundled packs every boot). · evidence: [012-core-checked](../evidence/shots/vq2/dark/012-core-checked.png), curl POST /core-library/check -> up_to_date remote=None error=None

</details>


## T-070

**Delete provider and Remove API key act immediately with no confirmation or undo**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-017
- Depends on: ['T-014']

**Summary.** No confirmation (dialog spy: no new confirm), no undo; disabled trash title is empty for built-ins.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:263` — deleteProvider no confirm

**Proposed fix.** confirmDialog before Delete provider / Remove API key. — Detail: AssistantPanel.tsx:263 and :743 go through the shared ConfirmDialog proposed in Q2-004 (or an Undo toast); :499 title={provider.isBuiltin ? "Built-in providers can't be deleted" : isDefault ? … : undefined}.

**Evidence.** [033-after-delete-provider](../evidence/shots/q2/dark/033-after-delete-provider.png), [040-builtin-delete-disabled](../evidence/shots/vq2/dark/040-builtin-delete-disabled.png)

<details><summary>Q2-017 — Delete provider and Remove API key act immediately with no confirmation or undo (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Settings > Assistant, expand a user provider with a saved key
  2. Click 'Remove' next to the masked key → key deleted at once ('API key removed.')
  3. Click the trash 'Delete provider' → provider and key deleted at once ('Provider deleted.')
  4. For built-in providers the trash is disabled with no tooltip explaining why
- Expected: Destructive actions confirm via an in-app dialog (consistent with library Remove) or offer Undo; disabled delete explains 'Built-in providers can't be deleted'.
- Actual: No confirmation (dialog spy: no new confirm), no undo; disabled trash title is empty for built-ins.
- Screenshots: [033-after-delete-provider](../evidence/shots/q2/dark/033-after-delete-provider.png), [034-openrouter-expanded](../evidence/shots/q2/dark/034-openrouter-expanded.png)
- Network: `PUT /providers/{id} {clearApiKey:true} → 200`; `DELETE /providers/{id} → 200`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:263` — deleteProvider no confirm
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:743` — Remove key no confirm
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:499` — title only for default provider
- Suggested fix: AssistantPanel.tsx:263 and :743 go through the shared ConfirmDialog proposed in Q2-004 (or an Undo toast); :499 title={provider.isBuiltin ? "Built-in providers can't be deleted" : isDefault ? … : undefined}.
- Verification (vq2): **CONFIRMED** — Reproduced: 'Remove' next to the masked key cleared api_key immediately (DB NULL), trash 'Delete provider' deleted the row immediately (count 0); dialog-spy confirm count unchanged; no undo. Built-in OpenAI card: trash disabled with title "" (no explanation). Consistency with Library Remove (native confirm, Q2-004). · evidence: [040-builtin-delete-disabled](../evidence/shots/vq2/dark/040-builtin-delete-disabled.png), db: api_key NULL then row count 0 after clicks

</details>


## T-071

**'Add provider' instantly persists an 'Active' placeholder provider; new card not scrolled/focused; untested providers labelled Active**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate M
- Findings: Q2-019

**Summary.** Orphan providers are easy to create; 'Active' means only enabled=true; list order also re-sorts after reload.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:248` — addProvider POSTs emptyProvider

**Proposed fix.** Add provider opens an unsaved draft card (scrolled + focused); persist on Save; status 'Not tested' not 'Active'. — Detail: AssistantPanel.tsx:248 keep a client-side draft (id 'new') and POST only on Save; scrollIntoView + focus Label after expanding; :618 derive status from provider.capabilities / last test ('Not tested', 'Unreachable') instead of 'Active' for any enabled; :356 suffix options with '(needs key)' / '(disabled)' and warn on selection.

**Evidence.** [023-add-provider](../evidence/shots/q2/dark/023-add-provider.png), [031-add-provider](../evidence/shots/vq2/dark/031-add-provider.png)

<details><summary>Q2-019 — 'Add provider' instantly persists an 'Active' placeholder provider; new card not scrolled/focused; untested providers labelled Active (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Settings > Assistant > Add provider (two buttons: header and dashed footer)
  2. A server record 'Custom OpenAI-compatible · Active · local-model' is created immediately (Providers · 6) and expanded at the bottom, below the fold; focus stays on the Add button
  3. Leave without saving → the placeholder remains forever
  4. Default provider oMLX shows green 'Active · Qwen…' although Re-test proves it's unreachable; Default provider select accepts OpenAI (needs key) or disabled LM Studio without warning
- Expected: Add opens an unsaved draft (Save creates it), scrolls into view and focuses Label; status 'Not tested/Unreachable' instead of 'Active' until a test passes; warn when choosing a default that needs a key or is disabled.
- Actual: Orphan providers are easy to create; 'Active' means only enabled=true; list order also re-sorts after reload.
- Screenshots: [023-add-provider](../evidence/shots/q2/dark/023-add-provider.png), [022-default-openai-nokey](../evidence/shots/q2/dark/022-default-openai-nokey.png), [106-omlx-retest](../evidence/shots/q2/light/106-omlx-retest.png)
- Network: `POST /api/modules/assistant/providers → 200 on click`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:248` — addProvider POSTs emptyProvider
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:618` — 'Active' shown for any enabled provider
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:350` — default select lists all providers
- Suggested fix: AssistantPanel.tsx:248 keep a client-side draft (id 'new') and POST only on Save; scrollIntoView + focus Label after expanding; :618 derive status from provider.capabilities / last test ('Not tested', 'Unreachable') instead of 'Active' for any enabled; :356 suffix options with '(needs key)' / '(disabled)' and warn on selection.
- Verification (vq2): **CONFIRMED** — Reproduced: Add provider -> POST creates 'Custom OpenAI-compatible' immediately (DB row 6, 'Providers · 6'), card expanded at y≈833 of 900, focus stays on 'Add provider'. Summary shows 'Active · local-model' for the never-tested provider and 'Active · Qwen…' for unreachable oMLX. Default provider select accepted OpenRouter (needs key) without warning (observed when a select mis-hit changed it; restored to omlx). · evidence: [031-add-provider](../evidence/shots/vq2/dark/031-add-provider.png), [030-assistant](../evidence/shots/vq2/dark/030-assistant.png)

</details>


## T-072

**Privacy 'SECURITY.md' link is a 404 and Settings/rail links point to the old andrejvysny/OpenPCB repo**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-020

**Summary.** Privacy link 404; three hard-coded REPO_URL copies with the stale owner.

**Root cause.** `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:107` — blob/main → 404

**Proposed fix.** Fix SECURITY.md link and point Settings/rail links to the OpenPCB-app org repo. — Detail: PrivacyPanel.tsx:107 -> https://github.com/OpenPCB-app/OpenPCB/blob/master/SECURITY.md; add src/core/frontend/src/lib/links.ts (REPO_URL='https://github.com/OpenPCB-app/OpenPCB') and use it in GeneralPanel.tsx:6, AboutPanel.tsx:8, LeftSidebar.tsx:144, PrivacyPanel.tsx:107.

**Evidence.** [040-privacy](../evidence/shots/q2/dark/040-privacy.png), [104-privacy](../evidence/shots/vq2/light/104-privacy.png)

<details><summary>Q2-020 — Privacy 'SECURITY.md' link is a 404 and Settings/rail links point to the old andrejvysny/OpenPCB repo (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Privacy: 'See SECURITY.md' → https://github.com/OpenPCB-app/OpenPCB/blob/main/SECURITY.md
  2. curl: 404 (default branch is master)
  3. About (Repository, Report a bug, Request a feature, Security policy, License), General (GitHub Releases) and the rail bug icon use https://github.com/andrejvysny/OpenPCB/... (301 redirect to OpenPCB-app)
- Expected: One canonical repo constant (OpenPCB-app/OpenPCB, branch master) shared by all links; no 404s.
- Actual: Privacy link 404; three hard-coded REPO_URL copies with the stale owner.
- Screenshots: [040-privacy](../evidence/shots/q2/dark/040-privacy.png), [041-about](../evidence/shots/q2/dark/041-about.png)
- Network: `GET https://github.com/OpenPCB-app/OpenPCB/blob/main/SECURITY.md → 404`; `GET https://github.com/andrejvysny/OpenPCB → 301 OpenPCB-app/OpenPCB`
- Code: `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:107` — blob/main → 404
- Code: `src/core/frontend/src/settings/panels/AboutPanel.tsx:8` — REPO_URL andrejvysny
- Code: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:6` — REPO_URL andrejvysny
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:144` — bug link andrejvysny
- Suggested fix: PrivacyPanel.tsx:107 -> https://github.com/OpenPCB-app/OpenPCB/blob/master/SECURITY.md; add src/core/frontend/src/lib/links.ts (REPO_URL='https://github.com/OpenPCB-app/OpenPCB') and use it in GeneralPanel.tsx:6, AboutPanel.tsx:8, LeftSidebar.tsx:144, PrivacyPanel.tsx:107.
- Verification (vq2): **CONFIRMED** — curl: https://github.com/OpenPCB-app/OpenPCB/blob/main/SECURITY.md -> 404, blob/master -> 200 (local SECURITY.md exists, default branch master). About/General/rail links use andrejvysny/OpenPCB which 301-redirect correctly (cosmetic). Only the Privacy link is actually broken. · evidence: [104-privacy](../evidence/shots/vq2/light/104-privacy.png), [105-about](../evidence/shots/vq2/light/105-about.png), curl blob/main/SECURITY.md 404; blob/master 200; andrejvysny/OpenPCB 301 -> OpenPCB-app/OpenPCB

</details>


## T-073

**Privacy copy claims no design data ever leaves the computer, contradicting BYOK cloud providers and MCP**

- Severity **S3** · category copy · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-S2 · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-021

**Summary.** Absolute 'ever leave' claim with no mention of assistant/MCP data flows.

**Root cause.** `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:49` — offline claim

**Proposed fix.** Reword Privacy copy: data leaves only via configured AI providers, MCP, crash reporting. — Detail: PrivacyPanel.tsx:50 reword: 'OpenPCB works offline. Design data leaves this computer only when you enable it: Assistant providers you configure receive the design context you send; the MCP server (if enabled) lets local agents read open designs; crash reporting below.' Link to Settings > Assistant; mention local session capture if dataset.capture stays on.

**Evidence.** [040-privacy](../evidence/shots/q2/dark/040-privacy.png), [104-privacy](../evidence/shots/vq2/light/104-privacy.png)

<details><summary>Q2-021 — Privacy copy claims no design data ever leaves the computer, contradicting BYOK cloud providers and MCP (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Privacy: 'OpenPCB runs fully offline by default — no project data, no schematics, and no design files ever leave your computer.'
  2. Settings > Assistant offers OpenAI / OpenRouter / OpenCode Zen providers that receive design context, and an MCP server that exposes designs to external agents
- Expected: Privacy page states that the Assistant sends design context to the configured provider (and MCP clients) when used, and links to those settings.
- Actual: Absolute 'ever leave' claim with no mention of assistant/MCP data flows.
- Screenshots: [040-privacy](../evidence/shots/q2/dark/040-privacy.png), [020-assistant](../evidence/shots/q2/dark/020-assistant.png)
- Code: `src/core/frontend/src/settings/panels/PrivacyPanel.tsx:49` — offline claim
- Suggested fix: PrivacyPanel.tsx:50 reword: 'OpenPCB works offline. Design data leaves this computer only when you enable it: Assistant providers you configure receive the design context you send; the MCP server (if enabled) lets local agents read open designs; crash reporting below.' Link to Settings > Assistant; mention local session capture if dataset.capture stays on.
- Verification (vq2): **CONFIRMED** — Confirmed copy at PrivacyPanel.tsx:50-52. 'by default' softens it (default provider is local oMLX, cloud off), so S3 not S2, but 'no design files ever leave your computer' is contradicted once a cloud BYOK provider (OpenAI/OpenRouter/OpenCode Zen) or MCP is enabled. Additional context: dataset.capture is ON in packaged builds (registry availability 'prod') and spools full command logs locally (uploads only if OPENPCB_DATASET_INGEST_URL is set, which Electron does not set) — also undisclosed here. · evidence: [104-privacy](../evidence/shots/vq2/light/104-privacy.png), [030-assistant](../evidence/shots/vq2/dark/030-assistant.png)

</details>


## T-074

**Settings panels use inconsistent title sizes and section styles**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-022

**Summary.** Titles: General 13px/600, Privacy 13px/600, Libraries 15px/600, Assistant 15px/600, About 20px/600. Sections: General/Privacy/About use bordered cards p-5 with 12px bold titles; Assistant uses flat 10px uppercase caps groups; Libraries has no section headers and a cyan-tinted core card; Account (cloud builds) uses text-lg/500.

**Root cause.** `src/core/frontend/src/settings/panels/GeneralPanel.tsx:229` — text-base

**Proposed fix.** One panel title style (13/600) and one section style (caps section header) across panels; About hero unchanged. — Detail: Extract SettingsPanelHeader (title text-base/600 + description) and use it in GeneralPanel.tsx:229, LibrariesPanel.tsx:270, AssistantPanel.tsx:326, PrivacyPanel.tsx:46, AccountPanel.tsx:55; use one section primitive (kit PanelSectionHeader or the General Section card) across panels.

**Evidence.** [100-general](../evidence/shots/q2/light/100-general.png), [100-general](../evidence/shots/vq2/light/100-general.png)

<details><summary>Q2-022 — Settings panels use inconsistent title sizes and section styles (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Open each Settings tab and compare the panel title and section headers
- Expected: One panel header style (title + description) and one section header style across tabs (e.g. PanelSectionHeader caps 10–11px or card title), same spacing.
- Actual: Titles: General 13px/600, Privacy 13px/600, Libraries 15px/600, Assistant 15px/600, About 20px/600. Sections: General/Privacy/About use bordered cards p-5 with 12px bold titles; Assistant uses flat 10px uppercase caps groups; Libraries has no section headers and a cyan-tinted core card; Account (cloud builds) uses text-lg/500.
- Screenshots: [100-general](../evidence/shots/q2/light/100-general.png), [101-libraries](../evidence/shots/q2/light/101-libraries.png), [103-assistant](../evidence/shots/q2/light/103-assistant.png), [104-privacy](../evidence/shots/q2/light/104-privacy.png), [105-about](../evidence/shots/q2/light/105-about.png)
- Code: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:229` — text-base
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:270` — text-lg
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:326` — text-lg; caps sections :345
- Code: `src/core/frontend/src/settings/panels/AboutPanel.tsx:145` — text-xl
- Code: `src/core/frontend/src/settings/panels/AccountPanel.tsx:55` — text-lg font-medium
- Suggested fix: Extract SettingsPanelHeader (title text-base/600 + description) and use it in GeneralPanel.tsx:229, LibrariesPanel.tsx:270, AssistantPanel.tsx:326, PrivacyPanel.tsx:46, AccountPanel.tsx:55; use one section primitive (kit PanelSectionHeader or the General Section card) across panels.
- Verification (vq2): **CONFIRMED (partial)** — Measured: panel h2 General 13px/600, Libraries 15px/600, Assistant 15px/600, Privacy 13px/600; section styles differ (bordered cards vs caps groups vs none). Refuted sub-item: About's 20px 'OpenPCB' is an app-identity hero with logo + channel pill (typical About layout), not a panel title. Remaining 13-vs-15px + section-style drift is a real sibling-screen inconsistency. · evidence: [100-general](../evidence/shots/vq2/light/100-general.png), [104-privacy](../evidence/shots/vq2/light/104-privacy.png), [105-about](../evidence/shots/vq2/light/105-about.png), [030-assistant](../evidence/shots/vq2/dark/030-assistant.png)

</details>


## T-075

**9px text in Settings (DEFAULT/LOCAL pills, 'Advanced', 'Caution')**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-023 · known ref K36

**Summary.** DOM census: 5 elements at 9px (Advanced, Caution, LOCAL ×2, DEFAULT); many 10–11px labels.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:425` — text-[9px] Advanced

**Proposed fix.** Raise 9px pills/labels to ≥10px (kit Badge). — Detail: AssistantPanel.tsx:586/591 drop className text-[9px]; :425 and McpSection.tsx:141 replace the spans with <Pill tone='neutral'> / <Pill tone='warning'>.

**Evidence.** [020-assistant](../evidence/shots/q2/dark/020-assistant.png), [030-assistant](../evidence/shots/vq2/dark/030-assistant.png)

<details><summary>Q2-023 — 9px text in Settings (DEFAULT/LOCAL pills, 'Advanced', 'Caution') (S3, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings > Assistant: provider pills DEFAULT/LOCAL, 'Advanced' next to Allow raw tool data, 'Caution' next to Allow writes
- Expected: No text below 10px.
- Actual: DOM census: 5 elements at 9px (Advanced, Caution, LOCAL ×2, DEFAULT); many 10–11px labels.
- Screenshots: [020-assistant](../evidence/shots/q2/dark/020-assistant.png)
- Census: `census/settings-assistant-dark-1440.json`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:425` — text-[9px] Advanced
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:586` — text-[9px] pills
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:141` — text-[9px] Caution
- Suggested fix: AssistantPanel.tsx:586/591 drop className text-[9px]; :425 and McpSection.tsx:141 replace the spans with <Pill tone='neutral'> / <Pill tone='warning'>.
- Verification (vq2): **CONFIRMED** — DOM scan on Assistant (dark): 9px text 'Advanced', 'Caution', 'LOCAL'×2, 'DEFAULT'. Kit Pill default is text-2xs (≥10px); the overrides force 9px. · evidence: [030-assistant](../evidence/shots/vq2/dark/030-assistant.png), dom: Advanced:9, Caution:9, LOCAL:9, DEFAULT:9, LOCAL:9

</details>


## T-076

**Long provider labels are cut off in the provider list and the Default provider select, with no tooltip**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: F1C-018

**Summary.** Card titles end in '…Settings Assist…' with no title attribute. The closed native Default-provider select shows 'QA-f1c-prov-01 Extremely Long Provider Label For' with no way to see the rest except opening it. 15 providers render as a flat 34 px list with no search. Every dummy provider with a dead base URL (127.0.0.1:9) is shown as 'Active' (see Q2-019). Layout otherwise holds at 1100×720 with no horizontal overflo…

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:584` — <span className='truncate …'>{provider.label}</span> without title

**Proposed fix.** Truncate with tooltip in provider list and Default provider select. — Detail: In the provider card header, add title={provider.label} to the truncated label span. Consider a text filter once there are more than 8 providers.

**Evidence.** [062-settings-providers-list-long-labels](../evidence/shots/f1c/dark/062-settings-providers-list-long-labels.png)

<details><summary>F1C-018 — Long provider labels are cut off in the provider list and the Default provider select, with no tooltip (S4, confirmed)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B, Settings → Assistant
  2. Add 10 providers with 126-char labels (1 via 'Add provider' + Label + Save provider, 9 via POST /providers with fake keys)
  3. Look at the Providers list and the Default provider <select>; pick one as default
  4. Delete them afterwards (done; the default was restored to oMLX first — Delete is correctly disabled for the default provider with the tooltip 'Set another provider as default first.')
- Expected: Truncated labels expose the full text (title attribute) and the select shows a readable label. The list stays usable at 15 providers (e.g. a filter).
- Actual: Card titles end in '…Settings Assist…' with no title attribute. The closed native Default-provider select shows 'QA-f1c-prov-01 Extremely Long Provider Label For' with no way to see the rest except opening it. 15 providers render as a flat 34 px list with no search. Every dummy provider with a dead base URL (127.0.0.1:9) is shown as 'Active' (see Q2-019). Layout otherwise holds at 1100×720 with no horizontal overflow.
- Screenshots: [062-settings-providers-list-long-labels](../evidence/shots/f1c/dark/062-settings-providers-list-long-labels.png), [064-settings-assistant-1100](../evidence/shots/f1c/dark/064-settings-assistant-1100.png), [022-settings-providers-long-labels](../evidence/shots/f1c/light/022-settings-providers-long-labels.png), [023-settings-providers-1100](../evidence/shots/f1c/light/023-settings-providers-1100.png)
- Census: `census/f1c-settings-assistant-15providers-light-1440.json`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:584` — <span className='truncate …'>{provider.label}</span> without title
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:358` — Default provider <option>{p.label}</option> in native select
- Suggested fix: In the provider card header, add title={provider.label} to the truncated label span. Consider a text filter once there are more than 8 providers.
- Verification (vf1c): **confirmed** — S4, verified by code plus f1c's screenshot (per protocol). I did not re-create 10 providers or open provider requests (key-safety rule). AssistantPanel.tsx:584 <span className='truncate …'>{provider.label}</span> has no title. The Default provider select (:350-360) is a native Select with the raw label. f1c's 062 screenshot shows 'QA-f1c-prov-01 Extremely Long Provider Label For Layout Stress Testing In Settings Assist…' cut off with no tooltip. The 'Active' label for unreachable dummy providers is Q2-019. S4 kept. · evidence: [062-settings-providers-list-long-labels](../evidence/shots/f1c/dark/062-settings-providers-list-long-labels.png), [022-settings-providers-long-labels](../evidence/shots/f1c/light/022-settings-providers-long-labels.png)

</details>


## T-077

**Theme toggle (Settings › General › Appearance) is a hand-rolled control: no aria-pressed, 35px tall, grows to 53px when 'System' is active**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-022

**Summary.** Buttons expose no pressed state (snapshot shows Light/Dark/System without [pressed]); control is 35px tall (kit standard 22px) and jumps to 53px when System shows its second line 'Light', shifting the card below by 18px. Functionally theme switching and persistence across reload work (localStorage 'theme', html class).

**Root cause.** `src/core/frontend/src/components/ThemeToggle.tsx:38` — plain buttons, no aria-pressed; two-line System label

**Proposed fix.** ThemeToggle -> kit SegmentedControl (aria-pressed, 22px, fixed width). — Detail: ThemeToggle.tsx: add aria-pressed={isActive} (:38) as a minimum; ideally swap to kit SegmentedControl and show the resolved mode inline ('System · Light') instead of the second line (:52-56).

**Evidence.** [018-settings-theme-system](../evidence/shots/vq1/dark/018-settings-theme-system.png)

<details><summary>Q1-022 — Theme toggle (Settings › General › Appearance) is a hand-rolled control: no aria-pressed, 35px tall, grows to 53px when 'System' is active (S4, confirmed)</summary>

- Area settings · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings → General → Appearance
  2. Click Light, then System, inspect the control box and a11y tree
- Expected: Kit SegmentedControl (22px, role=group, aria-pressed options) with the resolved mode shown without changing height.
- Actual: Buttons expose no pressed state (snapshot shows Light/Dark/System without [pressed]); control is 35px tall (kit standard 22px) and jumps to 53px when System shows its second line 'Light', shifting the card below by 18px. Functionally theme switching and persistence across reload work (localStorage 'theme', html class).
- Screenshots: [018-settings-theme-system](../evidence/shots/vq1/dark/018-settings-theme-system.png), [041-settings-light](../evidence/shots/q1/light/041-settings-light.png), [042-settings-system](../evidence/shots/q1/light/042-settings-system.png), [040-settings-general](../evidence/shots/q1/dark/040-settings-general.png)
- Code: `src/core/frontend/src/components/ThemeToggle.tsx:38` — plain buttons, no aria-pressed; two-line System label
- Suggested fix: ThemeToggle.tsx: add aria-pressed={isActive} (:38) as a minimum; ideally swap to kit SegmentedControl and show the resolved mode inline ('System · Light') instead of the second line (:52-56).
- Verification (vq1): **confirmed** — Reproduced in Settings › General: Light/Dark/System buttons aria-pressed=null; group 35px tall, 53px with System active (second line 'Light'). PLAN D3 deliberately left ThemeToggle untouched (Settings = token re-skin only, §0), so the off-kit look is out of the redesign's scope — but the missing pressed state and the height jump are real release-polish issues. S4 kept, fixScope noted. · evidence: [018-settings-theme-system](../evidence/shots/vq1/dark/018-settings-theme-system.png)

</details>


## T-078

**Every provider form shows a placeholder 'This month' usage block with '—' tiles and a disabled 'View details →'**

- Severity **S4** · category stub · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-024 · known ref K43

**Summary.** Tokens/Spend/Calls tiles show '—'; 'View details →' disabled with title 'Usage tracking — coming soon'.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:874` — usage tiles (layout now, data Phase 2)

**Proposed fix.** Remove 'This month' usage placeholder block. — Detail: AssistantPanel.tsx:874-906 remove the usage block (or gate behind a dev feature flag) until usage data exists.

**Note.** Binding: remove Coming-soon stubs.

**Evidence.** [039-opencode-expanded](../evidence/shots/q2/dark/039-opencode-expanded.png), [040-builtin-delete-disabled](../evidence/shots/vq2/dark/040-builtin-delete-disabled.png)

<details><summary>Q2-024 — Every provider form shows a placeholder 'This month' usage block with '—' tiles and a disabled 'View details →' (S4, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Settings > Assistant, expand any provider
- Expected: Hide unfinished usage UI until data exists.
- Actual: Tokens/Spend/Calls tiles show '—'; 'View details →' disabled with title 'Usage tracking — coming soon'.
- Screenshots: [039-opencode-expanded](../evidence/shots/q2/dark/039-opencode-expanded.png)
- Census: `census/settings-assistant-provider-dark-1440.json`
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:874` — usage tiles (layout now, data Phase 2)
- Suggested fix: AssistantPanel.tsx:874-906 remove the usage block (or gate behind a dev feature flag) until usage data exists.
- Verification (vq2): **CONFIRMED** — Reproduced on OpenAI card: 'THIS MONTH / View details → / TOKENS — / SPEND — / CALLS —', button disabled title 'Usage tracking — coming soon'. Violates the spirit of PLAN D6 ('no disabled placeholders') though Settings was out of D6 scope; K43. · evidence: [040-builtin-delete-disabled](../evidence/shots/vq2/dark/040-builtin-delete-disabled.png)

</details>


## T-079

**'Show key hint' duplicates the last 4 chars and never changes its label**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate XS
- Findings: Q2-027

**Summary.** Row becomes '••••••••••••••••-000 -000' (hint twice); aria-label stays 'Show key hint'.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:718` — dots+hint when showKey

**Proposed fix.** 'Show key hint' toggles label (Show/Hide) and shows masked key once. — Detail: AssistantPanel.tsx:718-734 remove the eye button (hint is already shown at :720), or render the hint only once and toggle aria-label Show/Hide + aria-pressed.

**Evidence.** [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [035-key-hint-shown](../evidence/shots/vq2/dark/035-key-hint-shown.png)

<details><summary>Q2-027 — 'Show key hint' duplicates the last 4 chars and never changes its label (S4, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Settings > Assistant, provider with saved key (dummy 'sk-qa-dummy-000')
  2. Masked row already shows '••••…' + '-000'
  3. Click the eye 'Show key hint'
- Expected: Hint shown once; eye toggles between Show/Hide with matching aria-label/aria-pressed.
- Actual: Row becomes '••••••••••••••••-000  -000' (hint twice); aria-label stays 'Show key hint'.
- Screenshots: [026-provider-saved](../evidence/shots/q2/dark/026-provider-saved.png), [027-key-hint-shown](../evidence/shots/q2/dark/027-key-hint-shown.png)
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:718` — dots+hint when showKey
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:720` — hint always rendered
- Suggested fix: AssistantPanel.tsx:718-734 remove the eye button (hint is already shown at :720), or render the hint only once and toggle aria-label Show/Hide + aria-pressed.
- Verification (vq2): **CONFIRMED** — Reproduced: masked row '•••…/-000', eye click -> '••••••••••••••••-000 / -000' (hint twice), aria-label stays 'Show key hint', no aria-pressed. The eye reveals nothing new. · evidence: [035-key-hint-shown](../evidence/shots/vq2/dark/035-key-hint-shown.png)

</details>


## T-080

**Provider form: changing Type doesn't update Base URL or key requirement; 'local/self-hosted' hint shown for cloud endpoints; Replace has no Cancel**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner C2 · wave W2 · scope frontend · estimate S
- Findings: Q2-028

**Summary.** Draft kind ignored until saved (keyOptional uses provider.kind); generic local hint; one-way Replace.

**Root cause.** `src/core/frontend/src/settings/panels/AssistantPanel.tsx:668` — keyOptional(provider.kind) not draft.kind

**Proposed fix.** Changing Type resets Base URL + key requirement; hint text per type; Replace has Cancel. — Detail: AssistantPanel.tsx:680-684 on Type change, if baseUrl equals the old kind's preset, set the new preset URL; :668 use keyOptional(draft.kind); :767 show the local hint only for local kinds / loopback URLs; :736 replace mode gets autoFocus + a Cancel link that sets replacingKey(false).

**Evidence.** [032-replace-key](../evidence/shots/q2/dark/032-replace-key.png), [038-type-openrouter-replace](../evidence/shots/vq2/dark/038-type-openrouter-replace.png)

<details><summary>Q2-028 — Provider form: changing Type doesn't update Base URL or key requirement; 'local/self-hosted' hint shown for cloud endpoints; Replace has no Cancel (S4, confirmed)</summary>

- Area settings · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Expand a provider (Base URL http://127.0.0.1:1234/v1), set Type=OpenRouter → Base URL unchanged, label still 'API key (optional)'
  2. Expand OpenCode Zen (https://opencode.ai/zen/v1) → hint 'Optional for local / self-hosted servers (vLLM, Ollama, LM Studio)'
  3. Click 'Replace' on a saved key → empty input, not focused, no Cancel to go back to the masked key
- Expected: Type change offers the preset Base URL and updates the key requirement; hint wording matches the endpoint; Replace can be cancelled.
- Actual: Draft kind ignored until saved (keyOptional uses provider.kind); generic local hint; one-way Replace.
- Screenshots: [032-replace-key](../evidence/shots/q2/dark/032-replace-key.png), [039-opencode-expanded](../evidence/shots/q2/dark/039-opencode-expanded.png)
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:668` — keyOptional(provider.kind) not draft.kind
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:767` — local-server hint
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:736` — Replace without cancel
- Suggested fix: AssistantPanel.tsx:680-684 on Type change, if baseUrl equals the old kind's preset, set the new preset URL; :668 use keyOptional(draft.kind); :767 show the local hint only for local kinds / loopback URLs; :736 replace mode gets autoFocus + a Cancel link that sets replacingKey(false).
- Verification (vq2): **CONFIRMED** — Reproduced: Type -> OpenRouter keeps Base URL http://127.0.0.1:1234/v1 and label 'API key (optional)' with the local-server hint (keyOptional uses provider.kind at :668, not draft.kind); OpenCode Zen (https://opencode.ai/zen/v1) shows 'Optional for local / self-hosted servers…'; Replace -> empty input, not focused, no Cancel. · evidence: [038-type-openrouter-replace](../evidence/shots/vq2/dark/038-type-openrouter-replace.png), [042-opencode-expanded](../evidence/shots/vq2/dark/042-opencode-expanded.png)

</details>


## T-392

**Enabling MCP in a non-Electron build shows no connection details or explanation**

- Severity **S4** · category copy · status rejected · themes dark, light
- Recommendation **wont-fix** · owner — · wave followup · scope frontend · estimate XS
- Findings: Q2-029

**Summary.** REJECTED — Environment artefact (browser vs Electron). The shipped product is the Electron app, where window.electronAPI.getMcpConfig exists and McpSection renders the Claude Code/Desktop/HTTP snippets (and the dev-shim note). In the browser dev harness the MCP endpoint is not usable anyway (POST /mcp -> 503 with no Electron-issued token). Reproduced the missing note, but it affects only developers running the bare Vite stack;…

**Root cause.** `src/core/frontend/src/settings/panels/McpSection.tsx:94` — no electronAPI → config null, nothing rendered

**Proposed fix.** None — browser-harness artefact; Electron renders MCP details.

**Evidence.** [021-mcp-enabled](../evidence/shots/q2/dark/021-mcp-enabled.png), [041-mcp-enabled](../evidence/shots/vq2/dark/041-mcp-enabled.png)

<details><summary>Q2-029 — Enabling MCP in a non-Electron build shows no connection details or explanation (S4, rejected)</summary>

- Area settings · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Browser build: Settings > Assistant > check 'Enable MCP server'
- Expected: A note such as 'Connection snippets are available in the desktop app' (like the General/Privacy desktop-only notes).
- Actual: Only the read-only sentence appears; no snippets, no desktop-only note (the shim note needs a config object).
- Screenshots: [021-mcp-enabled](../evidence/shots/q2/dark/021-mcp-enabled.png), [103-assistant](../evidence/shots/q2/light/103-assistant.png)
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:94` — no electronAPI → config null, nothing rendered
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:180` — note requires config
- Suggested fix: When window.electronAPI?.getMcpConfig is missing and enabled, render a desktop-only note.
- Verification (vq2): **REJECTED** — Environment artefact (browser vs Electron). The shipped product is the Electron app, where window.electronAPI.getMcpConfig exists and McpSection renders the Claude Code/Desktop/HTTP snippets (and the dev-shim note). In the browser dev harness the MCP endpoint is not usable anyway (POST /mcp -> 503 with no Electron-issued token). Reproduced the missing note, but it affects only developers running the bare Vite stack; at most a dev nicety. · evidence: [041-mcp-enabled](../evidence/shots/vq2/dark/041-mcp-enabled.png), curl POST /api/modules/assistant/mcp -> 503 on B

</details>

