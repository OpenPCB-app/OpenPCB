import { describe, expect, it, mock } from "bun:test";
import { OAuthService } from "../oauth-service";
import type { ProviderOAuthRepository } from "../../../db/repositories/provider-oauth";
import type { OAuthProvider } from "../../oauth/types";

describe("OAuthService", () => {
  const createMockRepository = (): ProviderOAuthRepository => ({
    get: mock((_provider: OAuthProvider) => Promise.resolve(null)),
    upsert: mock((_provider: OAuthProvider, _data: unknown) => Promise.resolve()),
    delete: mock((_provider: OAuthProvider) => Promise.resolve(true)),
    listProviders: mock(() => Promise.resolve([])),
    isExpired: mock((_provider: OAuthProvider, _bufferSeconds?: number) => Promise.resolve(false)),
  } as unknown as ProviderOAuthRepository);

  it("creates service instance", () => {
    const service = new OAuthService(createMockRepository());
    expect(service).toBeDefined();
  });

  it("lists authenticated providers", async () => {
    const mockRepo = createMockRepository();
    mockRepo.listProviders = mock(() => Promise.resolve(["codex", "github-copilot"]));
    const service = new OAuthService(mockRepo);
    const providers = await service.listAuthenticatedProviders();
    expect(providers).toEqual(["codex", "github-copilot"]);
  });

  it("checks credentials existence", async () => {
    const mockRepo = createMockRepository();
    const now = new Date();
    mockRepo.get = mock(() => Promise.resolve({
      providerId: "codex",
      accessToken: "token",
      refreshToken: null,
      expiresAt: null,
      accountId: null,
      createdAt: now,
      updatedAt: now,
    }));
    const service = new OAuthService(mockRepo);
    const has = await service.hasCredentials("codex");
    expect(has).toBe(true);
  });

  it("revokes OAuth credentials", async () => {
    const mockRepo = createMockRepository();
    const service = new OAuthService(mockRepo);
    await service.revokeOAuth("codex");
    expect(mockRepo.delete).toHaveBeenCalledWith("codex");
  });
});
