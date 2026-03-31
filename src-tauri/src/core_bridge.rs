use bridge_macros::{bridge_cmd, bridge_events, bridge_module};
use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use one_mind_bridge::BridgeResult;

use crate::commands;

// Register bridge events for the core namespace
bridge_events!((
    "core",
    ("backend-notification", commands::BackendNotification),
    ("backend-progress", commands::BackendProgress)
));

#[derive(Default)]
pub struct CoreBridge;

#[bridge_module(ns = "core")]
impl CoreBridge {
    #[bridge_cmd(name = "greet")]
    fn greet(&self, args: GreetArgs) -> BridgeResult {
        let response = commands::greet(&args.name);
        serde_json::to_value(response).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed("core", "greet", anyhow::anyhow!("{}", e))
        })
    }

    #[bridge_cmd(name = "serverStatus")]
    fn server_status(&self, _args: ()) -> BridgeResult {
        let status = commands::server_status();
        serde_json::to_value(status).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "core",
                "serverStatus",
                anyhow::anyhow!("{}", e),
            )
        })
    }

    #[bridge_cmd(name = "startBackendProgress")]
    async fn start_backend_progress<R: Runtime>(
        &self,
        _args: (),
        app: &AppHandle<R>,
    ) -> BridgeResult {
        commands::start_backend_progress(app).map_err(|e| {
            one_mind_bridge::BridgeError::handler_failed(
                "core",
                "startBackendProgress",
                anyhow::anyhow!("{}", e),
            )
        })?;
        Ok(serde_json::Value::Null)
    }
}

// --- Helper Functions ---

// --- Argument Types ---

#[derive(Deserialize)]
struct GreetArgs {
    name: String,
}
