// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::{
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Runtime};

pub const BACKEND_NOTIFICATION_EVENT: &str = "core:backend-notification";
pub const BACKEND_PROGRESS_EVENT: &str = "core:backend-progress";

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub process_id: u32,
    pub last_checked_epoch: u32,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendNotification {
    pub message: String,
    pub timestamp_epoch: u32,
}

impl BackendNotification {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            timestamp_epoch: now_epoch_seconds(),
        }
    }
}

fn now_epoch_seconds() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs() as u32
}

pub fn greet(name: &str) -> String {
    format!("Hello, {}! Example response from Rust!!", name)
}

pub fn server_status() -> ServerStatus {
    ServerStatus {
        process_id: std::process::id(),
        last_checked_epoch: now_epoch_seconds(),
    }
}

pub fn start_backend_progress<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Emit initial progress
    app.emit(BACKEND_PROGRESS_EVENT, 0)
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    thread::spawn(move || {
        let steps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        for step in steps {
            thread::sleep(Duration::from_millis(350));
            if let Err(error) = app_handle.emit(BACKEND_PROGRESS_EVENT, step) {
                eprintln!("failed to emit {BACKEND_PROGRESS_EVENT}: {error}");
                return;
            }
        }

        let _ = app_handle.emit(
            BACKEND_NOTIFICATION_EVENT,
            BackendNotification::new("Background progress completed"),
        );
    });

    Ok(())
}
