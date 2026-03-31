use specta_typescript::Typescript;
use tauri::{Manager, State};
use tauri_plugin_log::log::{error, info};
use tauri_specta::{collect_commands, Builder as SpectaBuilder};
use one_mind_bridge::{BridgeRequest, BridgeResponse, BridgeRouter};

mod commands;
pub mod core_bridge;
pub mod entitlement_verifier;
pub mod secrets;
pub mod secrets_bridge;
pub mod sidecar;

// Ensure modules are registered via inventory (just importing them is enough)
#[allow(unused_imports)]
use core_bridge::CoreBridge as _;

#[allow(unused_imports)]
use sidecar::bun_ts::BunBridge as _;

#[allow(unused_imports)]
use secrets_bridge::SecretsBridge as _;

pub const SPECTA_EXPORT_PATH: &str = "../src-ts/core/generated/tauri-bindings.ts";

pub fn create_specta_builder() -> SpectaBuilder<tauri::Wry> {
    SpectaBuilder::<tauri::Wry>::new().commands(collect_commands![crate::bridge_invoke,])
}

#[tauri::command]
#[specta::specta]
async fn bridge_invoke(
    app: tauri::AppHandle,
    router: State<'_, BridgeRouter>,
    req: BridgeRequest,
) -> Result<BridgeResponse, String> {
    Ok(one_mind_bridge::dispatch_bridge_request(&app, &router, req).await)
}

fn create_bridge_router(app: &tauri::AppHandle<tauri::Wry>) -> BridgeRouter<tauri::Wry> {
    // Auto-register all modules via inventory
    let events = one_mind_bridge::TauriEventSink::new(app.clone());
    BridgeRouter::auto_with_events(events)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Everything after here runs in only the app process.

    let specta_builder = create_specta_builder();

    #[cfg(debug_assertions)]
    {
        // When running the dev app, the process cwd may be different depending on how
        // the app was launched. Build an absolute path based on the crate manifest
        // directory so the generated file lands in the intended `src-ts` package.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let export_path = std::path::Path::new(manifest_dir).join(SPECTA_EXPORT_PATH);

        specta_builder
            .export(Typescript::default(), &export_path)
            .expect("failed to export TypeScript bindings");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("Failed to resolve app local data dir")
                .join("stronghold.salt");
            app_handle
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())
                .expect("Failed to initialize stronghold plugin");

            #[cfg(desktop)]
            app_handle
                .plugin(tauri_plugin_updater::Builder::new().build())
                .expect("Failed to initialize updater plugin");

            let secrets_state = crate::secrets::SecretsState::new(&app_handle)
                .expect("Failed to initialize secrets state");
            app_handle.manage(secrets_state);

            let bridge_router = create_bridge_router(&app_handle);
            app.manage(bridge_router);
            specta_builder.mount_events(app);

            let bun_state = crate::sidecar::bun_ts::BunBridgeState::new();
            app_handle.manage(bun_state);

            // Initialize Bun sidecar
            let app_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                match crate::sidecar::bun_ts::init_bun_bridge(&app_clone).await {
                    Ok(()) => {
                        info!("Bun sidecar initialized successfully");
                    }
                    Err(e) => {
                        error!("Failed to initialize Bun sidecar: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
