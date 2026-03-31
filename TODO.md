# TODO

## Phase 1: Backend model + APIs
- [x] Add shared `DesignRecord` / create / update types and schema exports
- [x] Add `design` DB schema, repository, service, controller, DI registration
- [x] Add project status filtering to list API
- [x] Add project deletion detach semantics for chats/files/designs
- [x] Add knowledge-module endpoint/service support for detaching project notes

## Phase 2: Frontend state + navigation
- [x] Unify project state in app store
- [x] Add design state and API client
- [x] Add dedicated `project` screen + routing + hash state
- [x] Split design navigation to project/design

## Phase 3: Project hub
- [x] Build project hub with metadata, archive/delete, designs/chats/notes sections
- [x] Wire create project flow to open hub
- [x] Wire home/sidebar/live entry points to hub
- [x] Remove dead/duplicate project management flow
- [x] Normalize project icon ids

## Phase 4: Tests + verification
- [x] Backend tests for designs, project filtering, project delete semantics
- [x] Frontend tests for project hub/navigation/state consistency
- [x] Run TS-relevant targeted backend tests, React tests, and both typechecks

## Phase 5: Workspace-Level Designs
- [x] Allow `design.projectId` to be nullable in shared types, schema, and migrations
- [x] Add workspace-level design list/create API on `/api/designs`
- [x] Make frontend design caching/navigation handle workspace-scoped designs
- [x] Add Home-screen UI for create/open/rename/delete of workspace-level designs
- [x] Add targeted backend/frontend tests for workspace-level design flows

## Verification Notes
- [x] `cd src-ts && bun test tests/design-service.test.ts tests/project-service.test.ts test/project-api.test.ts`
- [x] `npm run test:react`
- [x] `npx tsc -p src-react/tsconfig.json --noEmit`
- [x] `cd src-ts && npx tsc --noEmit`
- [ ] `npm run test:ts` still fails in this environment due pre-existing unrelated failures:
- [ ] socket/listener-based API tests (`workspace-api`, `license-api`, `chat-api`, `mcp-controller.api`) cannot bind ports here
- [ ] unrelated existing failures remain in `StreamService`, OAuth callback server, and content-editor tool tests
