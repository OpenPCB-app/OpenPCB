//! Bun Bridge - High-level interface for Bun runtime integration
//!
//! Provides:
//! - Bridge commands for status and port discovery
//! - Managed state for Bun runtime
//! - Integration with Tauri app lifecycle

use anyhow::Result;
use bridge_macros::{bridge_cmd, bridge_events, bridge_module};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_log::log::{error, info};
use tokio::sync::Mutex;
use openpcb_bridge::BridgeResult;

use super::bun_runtime::{BunRuntime, BunRuntimeStatus};

// Register events for the bun namespace
bridge_events!(("bun",));

/// Shared state for Bun runtime
pub struct BunBridgeState {
    runtime: Arc<Mutex<BunRuntime>>,
}

impl BunBridgeState {
    /// Create new BunBridgeState
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(BunRuntime::new())),
        }
    }

    /// Get runtime reference
    pub fn runtime(&self) -> Arc<Mutex<BunRuntime>> {
        Arc::clone(&self.runtime)
    }
}

/// Bun bridge handler
#[derive(Default)]
pub struct BunBridge;

#[bridge_module(ns = "bun")]
impl BunBridge {
    /// Get the current status of the Bun runtime
    #[bridge_cmd(name = "status")]
    async fn status<R: Runtime>(&self, _args: EmptyArgs, app: &AppHandle<R>) -> BridgeResult {
        let state = app.try_state::<BunBridgeState>().ok_or_else(|| {
            openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "status",
                anyhow::anyhow!("Bun bridge not initialized"),
            )
        })?;
        let runtime = state.runtime.lock().await;

        let status = match runtime.status() {
            BunRuntimeStatus::Starting => "starting",
            BunRuntimeStatus::Running => "running",
            BunRuntimeStatus::Stopped => "stopped",
            BunRuntimeStatus::Failed(ref _msg) => "failed",
        };

        let response = StatusResponse {
            status: status.to_string(),
            port: runtime.port(),
            is_running: runtime.is_running(),
        };

        serde_json::to_value(response).map_err(|e| {
            openpcb_bridge::BridgeError::handler_failed("bun", "status", anyhow::anyhow!("{}", e))
        })
    }

    /// Get the backend URL (for HTTP connections)
    #[bridge_cmd(name = "getBackendUrl")]
    async fn get_backend_url<R: Runtime>(
        &self,
        _args: EmptyArgs,
        app: &AppHandle<R>,
    ) -> BridgeResult {
        let state = app.try_state::<BunBridgeState>().ok_or_else(|| {
            openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "getBackendUrl",
                anyhow::anyhow!("Bun bridge not initialized"),
            )
        })?;
        let runtime = state.runtime.lock().await;

        let url = if let Some(port) = runtime.port() {
            format!("http://127.0.0.1:{}", port)
        } else {
            return Err(openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "getBackendUrl",
                anyhow::anyhow!("Bun runtime not running or port not discovered"),
            ));
        };

        let (startup_contract_version, startup_license_state, startup_license_code) = runtime
            .startup_license()
            .unwrap_or((1, "blocked".to_string(), "STARTUP_LICENSE_MISSING".to_string()));

        let response = BackendUrlResponse {
            url,
            startup_contract_version,
            startup_license_state,
            startup_license_code,
        };

        serde_json::to_value(response).map_err(|e| {
            openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "getBackendUrl",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    /// Restart the Bun runtime
    #[bridge_cmd(name = "restart")]
    async fn restart<R: Runtime>(&self, _args: EmptyArgs, app: &AppHandle<R>) -> BridgeResult {
        let state = app.try_state::<BunBridgeState>().ok_or_else(|| {
            openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "restart",
                anyhow::anyhow!("Bun bridge not initialized"),
            )
        })?;
        let runtime_arc = state.runtime();

        // Shutdown existing runtime
        {
            let mut runtime = runtime_arc.lock().await;
            if let Err(e) = runtime.shutdown().await {
                error!("Failed to shutdown Bun runtime: {}", e);
            }
        }

        // Spawn new runtime
        let app_clone = app.clone();
        let port = {
            let mut runtime = runtime_arc.lock().await;
            runtime.spawn(&app_clone).await.map_err(|e| {
                openpcb_bridge::BridgeError::handler_failed(
                    "bun",
                    "restart",
                    anyhow::anyhow!("Failed to restart Bun runtime: {}", e),
                )
            })?
        };

        let response = RestartResponse { port };

        serde_json::to_value(response).map_err(|e| {
            openpcb_bridge::BridgeError::handler_failed(
                "bun",
                "restart",
                anyhow::anyhow!("{}", e),
            )
        })
    }
}

// --- Argument & Response Types ---

/// Empty args for commands that don't require parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyArgs {}

/// Response for status command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub status: String,
    pub port: Option<u16>,
    pub is_running: bool,
}

/// Response for getBackendUrl command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendUrlResponse {
    pub url: String,
    pub startup_contract_version: u16,
    pub startup_license_state: String,
    pub startup_license_code: String,
}

/// Response for restart command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestartResponse {
    pub port: u16,
}

// --- Helper Functions ---

/// Initialize Bun bridge and spawn runtime
pub async fn init_bun_bridge<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    info!("Initializing Bun bridge...");

    let state: State<BunBridgeState> = app
        .try_state()
        .ok_or_else(|| anyhow::anyhow!("BunBridgeState not managed; call app.manage(BunBridgeState::new()) before init_bun_bridge"))?;
    let runtime_arc = state.runtime();

    // Spawn the Bun runtime
    let app_clone = app.clone();
    let port = {
        let mut runtime = runtime_arc.lock().await;
        runtime.spawn(&app_clone).await?
    };

    info!("Bun bridge initialized successfully on port {}", port);

    Ok(())
}

/// Shutdown Bun bridge and runtime
pub async fn shutdown_bun_bridge(state: &BunBridgeState) -> Result<()> {
    info!("Shutting down Bun bridge...");

    let mut runtime = state.runtime.lock().await;
    runtime.shutdown().await?;

    info!("Bun bridge shut down successfully");
    Ok(())
}
