use bridge_macros::{bridge_cmd, bridge_events, bridge_module};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use one_mind_bridge::BridgeResult;

use crate::entitlement_verifier::{now_unix_ms, EntitlementVerifier};
use crate::secrets::{AccountSessionSecret, EntitlementCacheMetadata, SecretsState};
use crate::sidecar::bun_ts::bun_bridge::BunBridgeState;

#[derive(Default)]
pub struct SecretsBridge;

bridge_events!(("secrets",));

#[bridge_module(ns = "secrets")]
impl SecretsBridge {
    #[bridge_cmd(name = "listProviderApiKeys")]
    async fn list_provider_api_keys<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let providers = state.list_provider_keys().map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "listProviderApiKeys",
                anyhow::anyhow!("{}", e),
            )
        })?;

        let response = ProviderKeyListResponse { providers };
        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "listProviderApiKeys",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "hasProviderApiKey")]
    async fn has_provider_api_key<R: Runtime>(
        &self,
        args: ProviderKeyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let has = state.has_provider_key(&args.provider_id).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "hasProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })?;

        let response = ProviderKeyStatusResponse {
            provider_id: args.provider_id,
            has_key: has,
        };
        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "hasProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "setProviderApiKey")]
    async fn set_provider_api_key<R: Runtime>(
        &self,
        args: SetProviderKeyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        state
            .set_provider_key(&args.provider_id, &args.api_key)
            .map_err(|e| {
                one_mind_bridge::BridgeError::handler_failed(
                    "secrets",
                    "setProviderApiKey",
                    anyhow::anyhow!("{}", e),
                )
            })?;

        let stored = state.has_provider_key(&args.provider_id).unwrap_or(false);
        let (synced, sync_error) =
            match sync_provider_key(app, &args.provider_id, Some(&args.api_key)).await {
                Ok(result) => (result, None),
                Err(err) => (false, Some(err.to_string())),
            };

        let response = ProviderKeyMutationResponse {
            provider_id: args.provider_id,
            stored,
            synced,
            sync_error,
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "setProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "removeProviderApiKey")]
    async fn remove_provider_api_key<R: Runtime>(
        &self,
        args: ProviderKeyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        state.remove_provider_key(&args.provider_id).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "removeProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })?;

        let stored = state.has_provider_key(&args.provider_id).unwrap_or(false);
        let (synced, sync_error) = match sync_provider_key_removal(app, &args.provider_id).await {
            Ok(result) => (result, None),
            Err(err) => (false, Some(err.to_string())),
        };

        let response = ProviderKeyMutationResponse {
            provider_id: args.provider_id,
            stored,
            synced,
            sync_error,
        };
        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "removeProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })
    }
    #[bridge_cmd(name = "syncProviderApiKey")]
    async fn sync_provider_api_key<R: Runtime>(
        &self,
        args: ProviderKeyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let stored = {
            let state: tauri::State<'_, SecretsState> = app.state();
            state.has_provider_key(&args.provider_id).unwrap_or(false)
        };
        let (synced, sync_error) = match sync_provider_key(app, &args.provider_id, None).await {
            Ok(result) => (result, None),
            Err(err) => (false, Some(err.to_string())),
        };

        let response = ProviderKeyMutationResponse {
            provider_id: args.provider_id,
            stored,
            synced,
            sync_error,
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "syncProviderApiKey",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "syncProviderApiKeyRemoval")]
    async fn sync_provider_api_key_removal<R: Runtime>(
        &self,
        args: ProviderKeyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let stored = {
            let state: tauri::State<'_, SecretsState> = app.state();
            state.has_provider_key(&args.provider_id).unwrap_or(false)
        };
        let (synced, sync_error) = match sync_provider_key_removal(app, &args.provider_id).await {
            Ok(result) => (result, None),
            Err(err) => (false, Some(err.to_string())),
        };

        let response = ProviderKeyMutationResponse {
            provider_id: args.provider_id,
            stored,
            synced,
            sync_error,
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "syncProviderApiKeyRemoval",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "setAccountSession")]
    async fn set_account_session<R: Runtime>(
        &self,
        args: SetAccountSessionArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let session = AccountSessionSecret {
            session_token: args.session_token,
            refresh_token: args.refresh_token,
            account_id: args.account_id,
            device_id: args.device_id,
            expires_at: args.expires_at,
        };

        state
            .set_account_session(&session)
            .map_err(|e| map_secrets_bridge_error("setAccountSession", e))?;

        serde_json::to_value(SetAccountSessionResponse { stored: true }).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "setAccountSession",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "getAccountSession")]
    async fn get_account_session<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let session = state
            .get_account_session()
            .map_err(|e| map_secrets_bridge_error("getAccountSession", e))?;

        let response = AccountSessionLookupResponse {
            found: session.is_some(),
            session,
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "getAccountSession",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "removeAccountSession")]
    async fn remove_account_session<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let removed = state
            .remove_account_session()
            .map_err(|e| map_secrets_bridge_error("removeAccountSession", e))?;

        serde_json::to_value(DeleteSecretResponse { removed }).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "removeAccountSession",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "setEntitlementCache")]
    async fn set_entitlement_cache<R: Runtime>(
        &self,
        args: SetEntitlementCacheArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let cache = EntitlementCacheMetadata {
            entitlement_jws: args.entitlement_jws,
            cached_at_unix_ms: args.cached_at_unix_ms,
            expires_at_unix_ms: args.expires_at_unix_ms,
            last_trusted_time_unix_ms: args.last_trusted_time_unix_ms,
        };

        state
            .set_entitlement_cache(&cache)
            .map_err(|e| map_secrets_bridge_error("setEntitlementCache", e))?;

        serde_json::to_value(SetEntitlementCacheResponse { stored: true }).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "setEntitlementCache",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "getEntitlementCache")]
    async fn get_entitlement_cache<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let cache = state
            .get_entitlement_cache()
            .map_err(|e| map_secrets_bridge_error("getEntitlementCache", e))?;
        let response = EntitlementCacheLookupResponse {
            found: cache.is_some(),
            cache,
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "getEntitlementCache",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "removeEntitlementCache")]
    async fn remove_entitlement_cache<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let removed = state
            .remove_entitlement_cache()
            .map_err(|e| map_secrets_bridge_error("removeEntitlementCache", e))?;

        serde_json::to_value(DeleteSecretResponse { removed }).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "removeEntitlementCache",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "evaluateEntitlementState")]
    async fn evaluate_entitlement_state<R: Runtime>(
        &self,
        args: EvaluateEntitlementArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state: tauri::State<'_, SecretsState> = app.state();
        let current_cache = state
            .get_entitlement_cache()
            .map_err(|e| map_secrets_bridge_error("evaluateEntitlementState", e))?;

        let verifier = EntitlementVerifier::from_env();
        let evaluation = verifier.evaluate(
            args.entitlement_jws.as_deref(),
            current_cache.as_ref(),
            now_unix_ms(),
        );

        if evaluation.cache_updated {
            match &evaluation.cache {
                Some(next_cache) => {
                    state
                        .set_entitlement_cache(next_cache)
                        .map_err(|e| map_secrets_bridge_error("evaluateEntitlementState", e))?;
                }
                None => {
                    state
                        .remove_entitlement_cache()
                        .map_err(|e| map_secrets_bridge_error("evaluateEntitlementState", e))?;
                }
            }
        }

        let response = EvaluateEntitlementResponse {
            state: evaluation.state,
            code: evaluation.code,
            trusted_time_unix_ms: evaluation.trusted_time_unix_ms,
            cache_updated: evaluation.cache_updated,
            cache_expires_at_unix_ms: evaluation.cache.as_ref().map(|c| c.expires_at_unix_ms),
        };

        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "secrets",
                "evaluateEntitlementState",
                anyhow::anyhow!("{}", e),
            )
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyArgs {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyArgs {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProviderKeyArgs {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyListResponse {
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatusResponse {
    pub provider_id: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyMutationResponse {
    pub provider_id: String,
    pub stored: bool,
    pub synced: bool,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountSessionArgs {
    pub session_token: String,
    pub refresh_token: Option<String>,
    pub account_id: String,
    pub device_id: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountSessionResponse {
    pub stored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionLookupResponse {
    pub found: bool,
    pub session: Option<AccountSessionSecret>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEntitlementCacheArgs {
    pub entitlement_jws: String,
    pub cached_at_unix_ms: u64,
    pub expires_at_unix_ms: u64,
    pub last_trusted_time_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEntitlementCacheResponse {
    pub stored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementCacheLookupResponse {
    pub found: bool,
    pub cache: Option<EntitlementCacheMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSecretResponse {
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateEntitlementArgs {
    pub entitlement_jws: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateEntitlementResponse {
    pub state: crate::entitlement_verifier::EntitlementState,
    pub code: String,
    pub trusted_time_unix_ms: u64,
    pub cache_updated: bool,
    pub cache_expires_at_unix_ms: Option<u64>,
}

fn map_secrets_bridge_error(command: &str, err: anyhow::Error) -> one_mind_bridge::BridgeError {
    let text = err.to_string();
    let code = if text.contains("SECRETS_ENCODE_FAILED") {
        "SECRETS_ENCODE_FAILED"
    } else if text.contains("SECRETS_DECODE_FAILED") {
        "SECRETS_DECODE_FAILED"
    } else if text.contains("SECRETS_READ_FAILED") {
        "SECRETS_READ_FAILED"
    } else if text.contains("SECRETS_WRITE_FAILED") {
        "SECRETS_WRITE_FAILED"
    } else if text.contains("SECRETS_DELETE_FAILED") {
        "SECRETS_DELETE_FAILED"
    } else if text.contains("SECRETS_SAVE_FAILED") {
        "SECRETS_SAVE_FAILED"
    } else {
        "SECRETS_STORAGE_FAILED"
    };

    one_mind_bridge::BridgeError::handler_failed(
        "secrets",
        command,
        anyhow::anyhow!("{}: {}", code, text),
    )
}

fn provider_api_key_url(port: u16, provider_id: &str) -> anyhow::Result<Url> {
    let mut url = Url::parse(&format!("http://127.0.0.1:{}/api/providers/", port))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Failed to construct provider API key URL"))?;
        segments.push(provider_id);
        segments.push("api-key");
    }
    Ok(url)
}

async fn sync_provider_key<R: Runtime>(
    app: &AppHandle<R>,
    provider_id: &str,
    api_key: Option<&str>,
) -> anyhow::Result<bool> {
    let state = match app.try_state::<BunBridgeState>() {
        Some(state) => state,
        None => return Ok(false),
    };

    let runtime_arc = state.runtime();
    let port = {
        let runtime = runtime_arc.lock().await;
        runtime.port()
    };

    let port = match port {
        Some(port) => port,
        None => return Ok(false),
    };

    let api_key = if let Some(api_key) = api_key {
        api_key.to_string()
    } else {
        let secrets: tauri::State<'_, SecretsState> = app.state();
        secrets
            .get_provider_key(provider_id)?
            .ok_or_else(|| anyhow::anyhow!("No stored API key for provider"))?
    };

    let url = provider_api_key_url(port, provider_id)?;
    let client = reqwest::Client::new();
    let mut request = client
        .post(url)
        .json(&serde_json::json!({ "apiKey": api_key }));

    if let Ok(token) = std::env::var("KERNEL_TOKEN") {
        request = request.header("X-OpenPCB-Token", token);
    }

    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Backend sync failed: {} {}", status, body));
    }

    Ok(true)
}

async fn sync_provider_key_removal<R: Runtime>(
    app: &AppHandle<R>,
    provider_id: &str,
) -> anyhow::Result<bool> {
    let state = match app.try_state::<BunBridgeState>() {
        Some(state) => state,
        None => return Ok(false),
    };

    let runtime_arc = state.runtime();
    let port = {
        let runtime = runtime_arc.lock().await;
        runtime.port()
    };

    let port = match port {
        Some(port) => port,
        None => return Ok(false),
    };

    let url = provider_api_key_url(port, provider_id)?;
    let client = reqwest::Client::new();
    let mut request = client.delete(url);

    if let Ok(token) = std::env::var("KERNEL_TOKEN") {
        request = request.header("X-OpenPCB-Token", token);
    }

    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Backend sync failed: {} {}", status, body));
    }

    Ok(true)
}
