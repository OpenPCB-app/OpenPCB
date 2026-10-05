export const meta = {
  name: 'ui-fix-wave-a',
  description: 'Fix wave A: kit+tokens foundation (F0a) in parallel with designer backend (DB) and library backend (LB); each implement -> adversarial review -> fix loop',
  phases: [
    { title: 'Implement', detail: 'F0a kit+tokens, DB designer backend, LB library backend (disjoint files)' },
    { title: 'Review', detail: 'reviewer-critical per owner diff, up to 2 fix rounds' },
  ],
}

const R = '/Users/andrejvysny/workspace/openpcb/OpenPCB'
const FIX = `${R}/docs/qa/2026-09-ui-qa/fix`

const REPORT = {
  type: 'object',
  properties: {
    owner: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    entriesDone: { type: 'array', items: { type: 'string' } },
    entriesPartial: { type: 'array', items: { type: 'object', properties: { tid: { type: 'string' }, why: { type: 'string' } } } },
    entriesSkipped: { type: 'array', items: { type: 'object', properties: { tid: { type: 'string' }, why: { type: 'string' } } } },
    crossOwner: { type: 'array', items: { type: 'object', properties: { to: { type: 'string' }, tid: { type: 'string' }, need: { type: 'string' } } } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    checks: { type: 'object', properties: { typecheckFrontend: { type: 'string' }, modulesTscOwnFiles: { type: 'string' }, tests: { type: 'string' } } },
    notes: { type: 'string' },
  },
  required: ['owner', 'files', 'entriesDone', 'checks', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    blocking: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['issue', 'fix'] } },
    nonBlocking: { type: 'array', items: { type: 'string' } },
    entriesNotActuallyFixed: { type: 'array', items: { type: 'string' } },
    ownershipViolations: { type: 'array', items: { type: 'string' } },
    checksRun: { type: 'string' },
  },
  required: ['verdict', 'blocking', 'checksRun'],
}

const OWNERS = [
  {
    id: 'F0a', agentType: 'impl-critical',
    extra: `You build the design-system FOUNDATION every later wave depends on. Implement ${FIX}/KIT_SPEC.md completely (tokens, all listed primitives, edits to existing primitives, problem.ts, shortcut-guard.ts, the ui-discipline ratchet test + baseline, design-tokens.md) AND every entry in your brief (${FIX}/owners/F0a.md). Keep every existing export/prop backward compatible (other code imports them). Export everything from src/shared/frontend/ui/index.ts. Move the Radix dialog wrapper into the kit and leave src/core/frontend/src/components/ui/dialog.tsx as a re-export shim. Do NOT mount <Toaster/>/<DialogHost/>/ErrorBoundary in the app — wave F0b does that. Add unit tests (Vitest, node env: pure helpers + renderToStaticMarkup aria checks). Finally write ${FIX}/contracts/F0a.md: the exact exported API of every new/changed primitive/helper with 1-line usage examples (later implementers read this instead of guessing).`,
  },
  {
    id: 'DB', agentType: 'impl-critical',
    extra: `Designer BACKEND owner. Also allowed: src/shared/domain/** ONLY if the one-step multi-delete undo genuinely needs history/batch infrastructure there. NOT allowed: src/shared/drc/**, src/shared/pcb-*/**, src/shared/schematic-routing/** (wave G), designer/backend/layout/{schematic-autoplace,body-extent}.ts (wave G). Entries: see ${FIX}/owners/DB.md — refdes rename propagation to PCB/BOM (T-217), one undoable step for multi-delete (T-096: a batch/composite command or a grouped history entry so ONE undo restores everything; the frontend (D2/D3a) will dispatch it), net-label connectivity (T-097: labels connect to wires they touch within tolerance incl. along segments/at endpoints, same-name labels merge nets; keep existing projection contracts), net-class management commands/settings (T-162: add/rename/delete net classes + per-class via diameter/drill, validated; board settings go through the S15 one-serializer rule — read src/modules/designer/AGENTS.md), design-named manufacturing/BOM downloads (T-164: sanitised design name in ZIP/file names/.gbrjob ProjectId, fallback to id), trace/via edit commands for the P4 inspector (T-174: set trace width, set trace/via net? (only if safe), set via diameter/drill/type/layer span — validated, undoable), and inspect endpoints returning 400/422 problem+json for invalid user files instead of 500 (T-251, designer side: KiCad project inspect). Every new command: DesignerCommand union (src/sdks/designer/types.ts) + routes.ts parser + handler + inverse patch + bun tests. Run the designer-related bun tests (cd src/core/backend && bun test designer) and make sure you add no new failures versus the known 22 environment failures. Regenerate SDK stubs with npm run gen if types changed and check gen:contracts. Finally write ${FIX}/contracts/DB.md describing every new/changed command/endpoint/response for the frontend owners (D2, D3a, D3b, D4).`,
  },
  {
    id: 'LB', agentType: 'impl-careful',
    extra: `Library BACKEND owner. Entries: ${FIX}/owners/LB.md — list paging (T-256: offset + total count on the components list route, raise/keep a sane max page size, stable ordering; frontend L1 will page), ONE shared predicate for list and facets (T-253), never install an .opclib without library.kind as read-only core (T-049), guard against removing the user.local 'Local Library' source (T-055 backend side; return a 409/422 problem), 'Duplicate to edit' copies footprint options, pin map, metadata and makes the copy editable so STEP upload works (T-270), library inspect endpoints return 400/422 problem+json for invalid user files instead of 500 (T-251 library side). Bun tests for each. Run cd src/core/backend && bun test library and report failures vs the known environment failures (CoreLibrary pack cap). npm run gen if SDK types change. Write ${FIX}/contracts/LB.md for the frontend owners (L1, C2).`,
  },
]

function implPrompt(o, feedback) {
  return `You are implementer ${o.id} in the OpenPCB UI QA hardening pass. Read ${FIX}/FIX_PROTOCOL.md (binding rules, ownership map, report format), ${FIX}/KIT_SPEC.md, and your brief ${FIX}/owners/${o.id}.md (every approved entry with root cause, proposed fix, repro and evidence). Evidence screenshots can be opened with the Read tool (layout only).
${o.extra}
${feedback ? `\nREVIEW FEEDBACK TO ADDRESS (fix every blocking item, re-run your checks):\n${feedback}\n` : ''}
Work through every entry; do not stop early. Return the JSON report.`
}

function reviewPrompt(o, report) {
  return `You are the adversarial code reviewer for implementer ${o.id} (OpenPCB UI QA hardening pass). Read ${FIX}/FIX_PROTOCOL.md, ${FIX}/KIT_SPEC.md and the brief ${FIX}/owners/${o.id}.md. The implementer's report: ${JSON.stringify(report || {}).slice(0, 3000)}
Review ONLY this owner's change: run \`git -C ${R} status --porcelain\` and \`git -C ${R} diff\` restricted to the owner's paths from the ownership map (other owners are editing other files concurrently — ignore those). Check:
1. every entry in the brief is ACTUALLY fixed at the root cause (list any that are not in entriesNotActuallyFixed);
2. correctness bugs, regressions, broken contracts (props/exports kept backward compatible? DesignerCommand union + routes.ts parser for new command fields? inverse patches/undo? migrations?), edge cases;
3. design-system rules (no raw palette, no window.prompt/confirm, describeError, shortcut guard, a11y, focus, sizes) for frontend files;
4. tests exist for new pure logic and pass — RUN them (vitest for frontend, cd src/core/backend && bun test <pattern> for backend) and run the typechecks from the protocol, attributing errors to files;
5. ownership violations (files outside the owner's map).
Do NOT edit files. verdict=approve only if there are no blocking issues. Return JSON.`
}

async function runOwner(o) {
  let report = await agent(implPrompt(o, null), { label: `impl:${o.id}`, phase: 'Implement', schema: REPORT, agentType: o.agentType })
  let review = null
  for (let round = 0; round < 3; round++) {
    review = await agent(reviewPrompt(o, report), { label: `review:${o.id}:${round + 1}`, phase: 'Review', schema: REVIEW, agentType: 'reviewer-critical' })
    if (!review || review.verdict === 'approve' || round === 2) break
    const fb = JSON.stringify({ blocking: review.blocking, entriesNotActuallyFixed: review.entriesNotActuallyFixed, ownershipViolations: review.ownershipViolations }, null, 1)
    log(`${o.id}: review round ${round + 1} requested changes (${review.blocking.length} blocking)`)
    report = await agent(implPrompt(o, fb), { label: `fix:${o.id}:${round + 1}`, phase: 'Review', schema: REPORT, agentType: o.agentType })
  }
  return { owner: o.id, report, review }
}

phase('Implement')
const results = await parallel(OWNERS.map(o => () => runOwner(o)))
return results.filter(Boolean).map(r => ({ owner: r.owner, verdict: r.review?.verdict, blocking: r.review?.blocking?.length, files: r.report?.files, done: r.report?.entriesDone, partial: r.report?.entriesPartial, skipped: r.report?.entriesSkipped, crossOwner: r.report?.crossOwner, checks: r.report?.checks, notes: r.report?.notes, reviewNotes: r.review?.nonBlocking }))
