use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use specta::Type;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub process_id: u32,
    pub last_checked_epoch: u32,
}

pub fn server_status() -> ServerStatus {
    ServerStatus {
        process_id: std::process::id(),
        last_checked_epoch: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_secs() as u32,
    }
}
