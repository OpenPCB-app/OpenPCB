import * as React from "react";
import { KeyRound, Plus, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { PROVIDERS } from "@shared/types";

import {
  hasProviderApiKey,
  setProviderApiKey,
  removeProviderApiKey,
} from "@/lib/api/provider-api";

import {
  getOAuthStatus,
  revokeOAuth,
  type OAuthProvider,
} from "@/lib/api/oauth-api";

import { ProviderStatusBadge, OAuthButton } from "./components";

type ProviderStatus = {
  id: string;
  name: string;
  hasKey: boolean;
};

type OAuthStatus = {
  hasCredentials: boolean;
  isExpired?: boolean;
};

export function ApiKeysPanel() {
  const { toast } = useToast();

  // Track which providers the user wants to manage
  const [selectedProviders, setSelectedProviders] = React.useState<Set<string>>(
    new Set(["openai", "openrouter"]), // Default to current providers
  );

  // Which provider is currently being set up
  const [setupProviderId, setSetupProviderId] = React.useState<string | null>(
    null,
  );

  // Which configured provider is being managed
  const [manageProviderId, setManageProviderId] = React.useState<string | null>(
    null,
  );

  // Whether the provider selector is expanded
  const [isSelectorExpanded, setIsSelectorExpanded] = React.useState(false);

  const [statuses, setStatuses] = React.useState<ProviderStatus[]>([]);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<Record<string, boolean>>({});
  const [oauthStatuses, setOAuthStatuses] = React.useState<
    Record<string, OAuthStatus>
  >({});
  const { isReady } = useBackendURL();

  // Computed values
  const userProviders = React.useMemo(
    () => PROVIDERS.filter((p) => selectedProviders.has(p.id)),
    [selectedProviders],
  );

  const availableProviders = React.useMemo(
    () =>
      PROVIDERS.filter((p) => !selectedProviders.has(p.id) && p.requiresApiKey),
    [selectedProviders],
  );

  const configuredProviders = React.useMemo(
    () =>
      userProviders.filter((p) =>
        statuses.find((s) => s.id === p.id && s.hasKey),
      ),
    [userProviders, statuses],
  );

  const unconfiguredProviders = React.useMemo(
    () =>
      userProviders.filter(
        (p) =>
          p.requiresApiKey && !statuses.find((s) => s.id === p.id && s.hasKey),
      ),
    [userProviders, statuses],
  );

  const loadStatuses = React.useCallback(async () => {
    if (!isReady) {
      return;
    }

    try {
      const results = await Promise.all(
        PROVIDERS.map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          hasKey: provider.requiresApiKey
            ? await hasProviderApiKey(provider.id)
            : false,
        })),
      );
      setStatuses(results);
    } catch (error) {
      toast({
        title: "Unable to load API key status",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [isReady, toast]);

  const loadOAuthStatus = React.useCallback(
    async (providerId: string) => {
      try {
        const status = await getOAuthStatus(providerId as OAuthProvider);
        setOAuthStatuses((prev) => ({
          ...prev,
          [providerId]: {
            hasCredentials: status.hasCredentials,
            isExpired: status.isExpired,
          },
        }));
      } catch {
        // Ignore if provider doesn't support OAuth
      }
    },
    [],
  );

  const loadAllOAuthStatuses = React.useCallback(async () => {
    for (const provider of PROVIDERS) {
      if (provider.supportsOAuth) {
        await loadOAuthStatus(provider.id);
      }
    }
  }, [loadOAuthStatus]);

  const handleOAuthSuccess = React.useCallback(async () => {
    await loadStatuses();
    await loadAllOAuthStatuses();
    toast({
      title: "OAuth connected successfully",
    });
  }, [loadStatuses, loadAllOAuthStatuses, toast]);

  const handleOAuthError = React.useCallback(
    (error: string) => {
      toast({
        title: "OAuth connection failed",
        description: error,
      });
    },
    [toast],
  );

  const handleOAuthDisconnect = React.useCallback(
    async (providerId: string) => {
      setPendingFor(providerId, true);
      try {
        await revokeOAuth(providerId as OAuthProvider);
        await loadOAuthStatus(providerId);
        await loadStatuses();
        toast({
          title: "OAuth disconnected",
        });
      } catch (error) {
        toast({
          title: "Failed to disconnect OAuth",
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setPendingFor(providerId, false);
      }
    },
    [loadOAuthStatus, loadStatuses, toast],
  );

  React.useEffect(() => {
    if (isReady) {
      loadStatuses();
      loadAllOAuthStatuses();
    }
  }, [isReady, loadStatuses, loadAllOAuthStatuses]);

  const updateInput = (id: string, value: string) => {
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const setPendingFor = (id: string, value: boolean) => {
    setPending((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = async (providerId: string) => {
    const apiKey = inputs[providerId]?.trim();
    if (!apiKey) {
      toast({
        title: "API key required",
        description: "Enter a key to save.",
      });
      return;
    }

    if (!isReady) {
      toast({
        title: "Backend not ready",
        description: "Wait for the backend to start before saving keys.",
      });
      return;
    }

    setPendingFor(providerId, true);
    try {
      await setProviderApiKey(providerId, apiKey);
      updateInput(providerId, "");
      await loadStatuses();
      setSetupProviderId(null);
      setManageProviderId(null);
      toast({
        title: "API key saved",
        description: "The key is stored locally and ready to use.",
      });
    } catch (error) {
      toast({
        title: "Failed to save API key",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setPendingFor(providerId, false);
    }
  };

  const handleRemove = async (providerId: string) => {
    if (!isReady) {
      toast({
        title: "Backend not ready",
        description: "Wait for the backend to start before removing keys.",
      });
      return;
    }

    setPendingFor(providerId, true);
    try {
      await removeProviderApiKey(providerId);
      await loadStatuses();
      setManageProviderId(null);
      toast({
        title: "API key removed",
        description: "You can add a new key anytime.",
      });
    } catch (error) {
      toast({
        title: "Failed to remove API key",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setPendingFor(providerId, false);
    }
  };

  const handleAddProvider = (providerId: string) => {
    setSelectedProviders((prev) => new Set([...prev, providerId]));
    setSetupProviderId(providerId);
    setIsSelectorExpanded(false);
  };

  const handleRemoveFromList = (providerId: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
    setManageProviderId(null);
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold">API Keys</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Keys are stored locally and encrypted. Existing keys cannot be viewed,
          only replaced or removed.
        </p>
      </div>

      {/* Section 1: Configured Providers */}
      {configuredProviders.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Configured Providers
          </h4>
          <div className="space-y-2">
            {configuredProviders.map((provider) => {
              const isManaging = manageProviderId === provider.id;
              const oauthStatus = oauthStatuses[provider.id];
              const isOAuthActive =
                provider.supportsOAuth && oauthStatus?.hasCredentials;
              const isOAuthExpired =
                provider.supportsOAuth &&
                oauthStatus?.hasCredentials &&
                oauthStatus?.isExpired;

              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-border/60 bg-card overflow-hidden"
                >
                  {/* Compact card view */}
                  <div className="flex items-center justify-between gap-4 p-4">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{provider.name}</p>
                          {isOAuthActive ? (
                            <ProviderStatusBadge
                              variant={
                                isOAuthExpired ? "oauth-expired" : "oauth-active"
                              }
                            />
                          ) : (
                            <ProviderStatusBadge variant="active" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isOAuthActive
                            ? isOAuthExpired
                              ? "OAuth expired - reconnect needed"
                              : "Connected via OAuth"
                            : "Key configured"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setManageProviderId(isManaging ? null : provider.id)
                      }
                    >
                      {isManaging ? "Close" : "Manage"}
                    </Button>
                  </div>

                  {/* Expanded management view */}
                  {isManaging && (
                    <div className="border-t border-border/60 bg-muted/30 p-4 space-y-3">
                      {isOAuthActive ? (
                        <>
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              This provider is connected via OAuth.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() =>
                                handleOAuthDisconnect(provider.id)
                              }
                              disabled={pending[provider.id] || !isReady}
                            >
                              Disconnect OAuth
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleRemoveFromList(provider.id)
                              }
                            >
                              Remove from list
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`update-key-${provider.id}`}>
                              Update API key
                            </Label>
                            <Input
                              id={`update-key-${provider.id}`}
                              type="password"
                              value={inputs[provider.id] ?? ""}
                              onChange={(event) =>
                                updateInput(provider.id, event.target.value)
                              }
                              placeholder="Paste a new key"
                              autoComplete="off"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleSave(provider.id)}
                              disabled={pending[provider.id] || !isReady}
                            >
                              Save key
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemove(provider.id)}
                              disabled={pending[provider.id] || !isReady}
                            >
                              Remove key
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleRemoveFromList(provider.id)
                              }
                            >
                              Remove from list
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 2: Unconfigured Providers (in user's list) */}
      {unconfiguredProviders.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Needs Setup
          </h4>
          <div className="space-y-2">
            {unconfiguredProviders.map((provider) => {
              const isSetup = setupProviderId === provider.id;
              const supportsOAuth = provider.supportsOAuth;
              const oauthProvider = provider.oauthProvider;

              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-amber-500/30 bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{provider.name}</p>
                      <ProviderStatusBadge variant="missing" />
                    </div>
                    {!isSetup && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFromList(provider.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  {isSetup && (
                    <div className="space-y-3">
                      {provider.requiresApiKey && (
                        <div className="space-y-2">
                          <Label htmlFor={`api-key-${provider.id}`}>
                            API key
                          </Label>
                          <Input
                            id={`api-key-${provider.id}`}
                            type="password"
                            value={inputs[provider.id] ?? ""}
                            onChange={(event) =>
                              updateInput(provider.id, event.target.value)
                            }
                            placeholder="Paste your API key"
                            autoComplete="off"
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        {provider.requiresApiKey && (
                          <Button
                            type="button"
                            onClick={() => handleSave(provider.id)}
                            disabled={pending[provider.id] || !isReady}
                          >
                            Save key
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setSetupProviderId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {!isSetup && (
                    <div className="space-y-2">
                      {provider.requiresApiKey && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setSetupProviderId(provider.id)}
                        >
                          Set up API key
                        </Button>
                      )}
                      {supportsOAuth && oauthProvider && (
                        <>
                          {provider.requiresApiKey && (
                            <div className="relative py-2">
                              <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-border/60" />
                              </div>
                              <div className="relative flex justify-center">
                                <span className="bg-card px-2 text-xs text-muted-foreground">
                                  Or
                                </span>
                              </div>
                            </div>
                          )}
                          <OAuthButton
                            provider={oauthProvider}
                            onSuccess={handleOAuthSuccess}
                            onError={handleOAuthError}
                            className="w-full"
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 3: Add Provider */}
      {availableProviders.length > 0 && (
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => setIsSelectorExpanded(!isSelectorExpanded)}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Provider
            </span>
            {isSelectorExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          {isSelectorExpanded && (
            <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
              {availableProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className="w-full flex items-center justify-between p-3 rounded-md hover:bg-muted/50 transition-colors text-left"
                  onClick={() => handleAddProvider(provider.id)}
                >
                  <span className="text-sm font-medium">{provider.name}</span>
                  <ProviderStatusBadge variant="missing" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {configuredProviders.length === 0 &&
        unconfiguredProviders.length === 0 &&
        availableProviders.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">All available providers are configured.</p>
          </div>
        )}
    </div>
  );
}
