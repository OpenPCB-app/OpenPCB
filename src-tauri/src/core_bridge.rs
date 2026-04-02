use bridge_macros::{bridge_cmd, bridge_events, bridge_module};
use openpcb_bridge::BridgeResult;

use crate::commands;

// Register bridge events for the core namespace (empty — no events currently)
bridge_events!(("core",));

#[derive(Default)]
pub struct CoreBridge;

#[bridge_module(ns = "core")]
impl CoreBridge {
    #[bridge_cmd(name = "serverStatus")]
    fn server_status(&self, _args: ()) -> BridgeResult {
        let status = commands::server_status();
        serde_json::to_value(status).map_err(|e| {
            openpcb_bridge::BridgeError::handler_failed(
                "core",
                "serverStatus",
                anyhow::anyhow!("{}", e),
            )
        })
    }
}
