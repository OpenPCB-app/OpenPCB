use inventory;
use openpcb_bridge::BridgeModuleRegistration;
use serde_json::json;

// Import modules to trigger inventory registration
// Import the modules from OpenPCB to ensure they're registered
#[allow(unused_imports)]
use OpenPCB::core_bridge::CoreBridge as _;
#[allow(unused_imports)]
use OpenPCB::sidecar::bun_ts::BunBridge as _;

fn main() {
    let mut modules = Vec::new();

    for reg in inventory::iter::<BridgeModuleRegistration> {
        let spec = reg.spec;
        let commands: Vec<_> = spec
            .commands
            .iter()
            .map(|c| {
                json!({
                    "name": c.name,
                    "args_rust": c.args_rust,
                    "result_rust": c.result_rust,
                    "stream": c.stream,
                    "long": c.long,
                    "item_rust": c.item_rust,
                    "event_name": c.event_name,
                    "cancel_name": c.cancel_name,
                })
            })
            .collect();

        let events: Vec<_> = spec
            .events
            .iter()
            .map(|e| {
                json!({
                    "name": e.name,
                    "payload_rust": e.payload_rust,
                })
            })
            .collect();

        modules.push(json!({
            "namespace": spec.namespace,
            "commands": commands,
            "events": events,
        }));
    }

    let output = json!({
        "modules": modules,
    });

    println!("{}", serde_json::to_string_pretty(&output).unwrap());
}
