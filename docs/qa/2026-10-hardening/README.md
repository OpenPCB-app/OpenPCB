# QA reconciliation evidence

`reconciliation.json` records all 395 September QA roots and 480 raw aliases, with one primary
H-task and Plane identity per root. Plane remains the authoritative task and knowledge system.
This directory contains code-coupled qualification data, not a release-completion claim.

`reconciliation-owners.json` preserves the reviewed owner mapping. `reconciliation-sources.json`
is a pinned projection of canonical triage, approval, raw and verified fields plus 89 source
fingerprints. Raw severity remains distinct from verified severity. The projection omits complete
reproduction payloads, screenshots and database contents; historical evidence references remain
references. Both snapshots have SHA-256 pins in the loader.

From the repository root:

```sh
node scripts/qa-reconciliation.mjs
node --test scripts/qa-reconciliation.test.mjs
```

These commands work in a clean checkout without the gitignored September archive. Default
validation checks the checked-in projection and manifest; it explicitly reports that original
archive files were not inspected. To verify the originals locally:

```sh
node scripts/qa-reconciliation.mjs --verify-archive
```

This mode rebuilds the projection from `docs/qa/2026-09-ui-qa/` and compares canonical fields
and all 89 fingerprints. Missing or changed originals fail; verification is never silently skipped.
An optional manifest path can follow either command form.

Each root preserves original severity, scope, decision and approval, its raw relationships,
programme disposition and scope expansion. Fresh reproduction state, implementation commit,
behavioral regression, local evidence and remaining blocker are separate qualification fields.
The baseline has 395 unverified reproductions and zero qualified fixes. T-304/T-305/T-308 retain
unapproved P6 proposals; T-391–T-394 retain intentional decisions; T-395 retains its refutation.
The historical F1B-014/T-164 duplicate link to T-152 is retained as a contradiction.

A `fixed` record requires a reachable full implementation SHA, a passing behavioral regression
whose test source matches its reachable commit, and hashed post-fix evidence under `evidence/`.
Evidence HEAD must contain both implementation and regression commits; no remaining blocker may
remain. These structural checks do not prove behavioral correctness or replace fresh release gates.
