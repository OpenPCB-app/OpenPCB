# KiCAD Import in Component Wizard

## Phase 1: Discovery / wiring
- [x] Review current symbol + footprint toolbar/store wiring
- [x] Review wizard 3D model step data path

## Phase 2: Symbol import
- [x] Add Symbol toolbar import button + hidden file input
- [x] Implement `.kicad_sym` parsing endpoint integration
- [x] Convert parsed KiCAD symbol into editable symbol draft
- [x] Render imported symbol graphics on canvas

## Phase 3: Footprint import
- [x] Add Footprint toolbar import button + hidden file input
- [x] Wire existing `.kicad_mod` parser for replace-import
- [x] Persist 3D model reference from imported footprint

## Phase 4: 3D model step
- [x] Display referenced 3D model path from footprint import
- [x] Keep separate actual 3D file upload flow

## Phase 5: Validation
- [x] Typecheck targeted packages
- [x] Smoke check wizard import flow

## Phase 6: Review / fix planning
- [x] Run subagent review of frontend import implementation
- [x] Run subagent review of backend/API import implementation
- [x] Run subagent review of wizard publish/data-flow integration
- [x] Synthesize findings into fix plan

## Planned fix waves
- [x] Fix wizard/editor state ownership and step remount data loss
- [x] Fix autosave/publish payload shape mismatch
- [x] Fix footprint import fidelity and remove duplicate local parsing
- [x] Fix symbol/footprint post-import editability gaps
- [x] Fix 3D upload flow to persist real assets and validate refs correctly
- [ ] Fix backend confirm-import contract, transactions, and multi-symbol handling
- [ ] Add frontend unit tests for symbol import, footprint import, and wizard store sync
- [ ] Add frontend integration tests for wizard import render/persistence/publish flow
- [ ] Add backend parser format tests for KiCad symbol/footprint variants and real fixtures
- [ ] Add backend controller/API integration tests for parse/preview/confirm/publish flows

## Current bugfix
- [x] Reproduce/analyze maximum update depth loop in wizard
- [x] Fix wizard hydration/sync infinite update loop
- [x] Validate typecheck and rerun relevant frontend tests

## Unresolved
- `npm run test:react -- --run` has 2 pre-existing failures in `src/screens/LibraryScreen.test.tsx` (backend URL init in tests)
