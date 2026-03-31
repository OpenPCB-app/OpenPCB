OAuth subsystem — OpenPCB (developer documentation)
===============================================

This document describes the OAuth subsystem implemented in the Bun sidecar (src-ts). It is intended for contributors who need to understand, extend, or test OAuth integrations.

Overview
--------

- Location: src-ts/src/infrastructure/oauth/
- Purpose: Provide HTTP-exposed endpoints and internal services to perform OAuth authentication with supported providers, persist tokens encrypted, and surface status to the frontend.
- Supported flows in OpenPCB:
  - OpenAI Codex: Authorization Code + PKCE (RFC 7636) with a local callback server
  - GitHub Copilot: Device Code flow (RFC 8628)

Why HTTP-only?

OpenPCB keeps OAuth in the Bun HTTP kernel (not the Tauri bridge) for these reasons:
- Simplicity: OAuth is an HTTP-centric flow and lives naturally in the server layer.
- Security: Avoids exposing provider client interactions through the UI layer; secrets and token lifecycle live server-side.
- Consistency: All provider integrations (AI, OAuth) are implemented in the same process where tokens are used.

Main components
---------------

- types.ts
  - Type definitions for provider identifiers, OAuthCredentials, flow results and DeviceCode responses.

- config.ts
  - Centralized OAuth configuration (client IDs, redirect ports, constants).
  - Note: client IDs are currently stored in config.ts with TODO to migrate to env/stronghold. Do not commit secrets here.

- pkce.ts
  - PKCE utilities: code verifier generation, code challenge (SHA256 -> base64url), state generation.
  - Implements RFC 7636 requirements used by Codex flow.

- callback-server.ts
  - Local HTTP listener used for Codex redirect_uri handling.
  - Exposes startOAuthListener(port, path) which returns an OAuthListener with methods:
    - waitForCallback(): resolves when callback received or times out
    - close(): stop listener
  - Important: Listener binds to 127.0.0.1 and a port (CODEX_REDIRECT_PORT in config) and must be cleaned up; OAuthService manages active listeners and calls listener.close().

- providers/codex.ts
  - Functions:
    - authorizeCodex(): Creates PKCE verifier/challenge, builds authorization URL and returns { url, verifier, state, redirectUri }.
    - exchangeCodexCode(code, verifier, redirectUri): Exchanges authorization code for tokens (access_token, refresh_token, id_token, expires_in).
    - refreshCodexToken(refreshToken): Calls token endpoint to refresh access token.
    - extractCodexAccountId(id_token): Extracts account id from id_token (JWT) when available.

- providers/github.ts
  - Functions:
    - requestGitHubDeviceCode(): Requests a device code from GitHub and returns the device_code, user_code, verification_uri, interval, expires_in.
    - pollGitHubToken(deviceCode, interval): Polls token endpoint until authorization or timeout and returns tokenResponse.

- oauth-service.ts
  - Located at src-ts/src/infrastructure/oauth/oauth-service.ts
  - Primary orchestrator. Exposes methods used by transport layer controller:
    - startOAuthFlow(provider)
    - completeCodexOAuth(code, state, verifier, redirectUri)
    - completeGitHubOAuth(deviceCode, interval)
    - getValidToken(provider)
    - hasCredentials(provider), listAuthenticatedProviders(), revokeOAuth(provider)
  - Handles: PKCE lifecycle, starting/stopping callback listeners, token exchange, refresh, persistence via ProviderOAuthRepository, retry logic.

- Repository: src-ts/src/db/repositories/provider-oauth.ts
  - Responsible for encrypting tokens using ApiKeyCipher and persisting them in provider_oauth table. Methods: get, upsert, delete, listProviders, isExpired.

- Transport: src-ts/src/transport/controllers/oauth-controller.ts
  - HTTP endpoints that accept frontend requests and call OAuthService. Endpoints are:
    - POST /api/oauth/:provider/start     (start flow)
    - GET  /api/oauth/:provider/callback  (callback - note: public callback is not used; complete endpoint preferred)
    - POST /api/oauth/:provider/complete  (complete flow with verifier/device_code)
    - GET  /api/oauth/:provider/status    (check stored credentials)
    - DELETE /api/oauth/:provider         (revoke)

Flow diagrams (conceptual)
--------------------------

Codex (PKCE) flow
1. User clicks Connect in UI → POST /api/oauth/codex/start
2. OAuthService.authorizeCodex() generates verifier/challenge and URL
3. OAuthService starts local callback server (callback-server.startOAuthListener)
4. UI opens browser to authorization URL
5. User signs in and provider redirects to http://127.0.0.1:<port>/oauth/callback?code=...&state=...
6. Callback server captures code and state and returns to client (listener.waitForCallback)
7. OAuthService.completeCodexOAuth(code, state, verifier, redirectUri) exchanges code for tokens via providers/codex.exchangeCodexCode
8. OAuthService.storeCredentials(...) persists tokens encrypted via ProviderOAuthRepository.upsert

GitHub (Device Code) flow
1. User clicks Connect in UI → POST /api/oauth/github-copilot/start
2. OAuthService.requestGitHubDeviceCode() returns device_code, user_code, verification_uri, interval
3. UI displays user_code and verification_uri to user
4. User opens verification_uri and enters user_code
5. UI calls POST /api/oauth/github-copilot/complete with deviceCode and interval
6. OAuthService.pollGitHubToken polls until successful and stores access token via repository

Token refresh flow
------------------
- Codex: getValidToken(provider) checks repository.isExpired(provider, bufferSeconds=60). If expired, refreshCodexToken(refreshToken) is invoked which exchanges refresh token for new tokens and upserts repository.
- GitHub: tokens are considered long-lived by the app. If provider rotates/invalidates a token, calls to provider endpoints will fail and the UI should trigger re-authentication.

Startup hydration & background refresh
------------------------------------
- On Bun startup (main.ts) the service responsible for kernel initialization hydrates OAuth tokens by reading the provider_oauth table and caching records where appropriate.
- Background refresh: A scheduled background task runs every 5 minutes and checks tokens that are within a 2-minute buffer of expiry (configurable). If a refresh is needed it invokes refreshCodexToken.

Database schema
---------------

Migration file: src-ts/drizzle/migrations/0014_provider_oauth.sql

Key fields (see src-ts/src/db/schema/provider-oauth.ts):
- provider_id (text primary key)
- access_token (text) — encrypted
- refresh_token (text, nullable) — encrypted
- expires_at (timestamp, nullable)
- account_id (text, nullable)
- created_at, updated_at

Encryption
----------
- ApiKeyCipher is used to encrypt tokens before storage and decrypt on retrieval (see src-ts/src/db/repositories/provider-oauth.ts). Cipher uses local key material — follow project secret management guidelines to ensure keys are protected.

Transport API (HTTP)
--------------------
Base path: /api/oauth/:provider

- POST /api/oauth/:provider/start
  - Body: optional { projectId?: string }
  - Response (Codex): { success: true, provider: 'codex', url, verifier, state, redirectUri }
  - Response (GitHub): { success: true, provider: 'github-copilot', userCode, verificationUri, deviceCode, interval, expiresIn }

- GET /api/oauth/:provider/callback
  - Legacy: callback detection via query parameters (code, state). The controller currently returns 501 for Codex callback because the sidecar prefers the complete endpoint that accepts session data.

- POST /api/oauth/:provider/complete
  - Codex body: { code, state, verifier, redirectUri }
  - GitHub body: { deviceCode, interval }

- GET /api/oauth/:provider/status
  - Returns { provider, hasCredentials, isExpired }

- DELETE /api/oauth/:provider
  - Revokes stored credentials in the DB

Kernel integration
------------------
- Token hydration at startup: main.ts reads provider_oauth entries and ensures provider registry has necessary credentials available for outgoing provider calls.
- Background refresh: A scheduled job runs every 5 minutes and calls oauthService.getValidToken(provider) for registered providers to trigger refresh when necessary.
- Provider registry: OAuthService stores tokens via ProviderOAuthRepository — other services (AI provider engines) obtain tokens using OAuthService.getValidToken(provider) and use them in Authorization headers when calling provider APIs.

Testing
-------

- Unit tests: see src-ts/src/infrastructure/oauth/__tests__/oauth-service.test.ts. Tests cover basic start/complete flows, refresh, and repository interactions.
- Run tests: from repo root run `bun test src-ts/src/infrastructure/oauth` or `bun test` to run entire suite.
- Mocking flows: Tests mock network requests to provider endpoints (HTTP stubs). For device flow, tests simulate polling responses. For PKCE/callback flows tests stub callback-server and token endpoints.

Extension guide — adding a new provider
--------------------------------------

1. Add type in types.ts: provider id string union and any specific types for flow results.
2. Implement provider adapter in src-ts/src/infrastructure/oauth/providers/<your-provider>.ts exposing:
   - start flow helper (authorize or request device code)
   - token exchange function
   - refresh function (if supported)
3. Add configuration to config.ts (client ID, scopes, endpoints). Do NOT add secrets to the repo — use env or stronghold.
4. Update oauth-service.ts: add handling in startOAuthFlow, complete* methods, and getValidToken if provider has refresh behaviour.
5. Add transport controller routes or reuse existing endpoints (start, complete, status, revoke).
6. Add unit tests under __tests__ for the new provider; mock provider endpoints.

Error handling patterns
-----------------------
- Retry transient network errors using withRetry helper inside oauth-service.ts (exponential backoff).
- Fail fast for 4xx errors from provider endpoints and surface messages to UI.
- Ensure listener.close() is invoked in finally blocks to avoid orphaned ports.

Security considerations
-----------------------

- Client ID storage: config.ts currently contains client IDs with TODO to migrate to env/stronghold. Do not commit client secrets. For deployments, place client secrets in the Tauri stronghold or environment variables.
- Token encryption: Tokens are encrypted using ApiKeyCipher before persistence. ApiKeyCipher key material must be managed securely.
- CSRF: PKCE flow uses a state parameter and OAuthService validates state when completing flows.
- PKCE vs plain OAuth: PKCE prevents interception attacks for public clients. Always prefer PKCE for native apps.

Files of interest
-----------------

- src-ts/src/infrastructure/oauth/oauth-service.ts
- src-ts/src/infrastructure/oauth/providers/codex.ts
- src-ts/src/infrastructure/oauth/providers/github.ts
- src-ts/src/infrastructure/oauth/callback-server.ts
- src-ts/src/infrastructure/oauth/pkce.ts
- src-ts/src/infrastructure/oauth/types.ts
- src-ts/src/infrastructure/oauth/config.ts
- src-ts/src/db/repositories/provider-oauth.ts
- src-ts/src/transport/controllers/oauth-controller.ts
- src-ts/drizzle/migrations/0014_provider_oauth.sql

If you need help writing tests or adding a provider, open an issue or contact maintainers. Keep client secrets out of the repo and follow existing patterns for token lifecycle and retries.
