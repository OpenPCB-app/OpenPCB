//! Bun TypeScript Sidecar Module
//!
//! Provides Bun runtime management and bridge integration for Tauri

pub mod bun_bridge;
pub mod bun_runtime;

// Re-export commonly used types
pub use bun_bridge::{init_bun_bridge, shutdown_bun_bridge, BunBridge, BunBridgeState};
pub use bun_runtime::{BunRuntime, BunRuntimeStatus};
