//! Bun Runtime Manager for Tauri Sidecar
//!
//! Manages the lifecycle of the Bun TypeScript backend sidecar:
//! - Process spawning with environment variables
//! - Health check and port discovery
//! - stdout/stderr monitoring
//! - Graceful shutdown

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_log::log::{error, info, warn};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc::unbounded_channel;

use crate::entitlement_verifier::{now_unix_ms, EntitlementState, EntitlementVerifier};
use crate::secrets::SecretsState;

/// Payload for backend-ready Tauri event
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendReadyPayload {
    pub url: String,
    pub port: u16,
    pub startup_contract_version: u16,
    pub startup_license_state: String,
    pub startup_license_code: String,
}

#[derive(Debug, Clone)]
struct StartupLicenseMetadata {
    contract_version: u16,
    state: String,
    code: String,
}

#[derive(Debug, Clone)]
struct StartupOutputMetadata {
    port: u16,
    license: StartupLicenseMetadata,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseAuditEvent {
    event_type: String,
    account_id: Option<String>,
    device_id: Option<String>,
    state_from: Option<String>,
    state_to: Option<String>,
    reason_code: Option<String>,
    details: Value,
    timestamp: String,
}

/// Status of the Bun runtime sidecar
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BunRuntimeStatus {
    /// Runtime is starting up
    Starting,
    /// Runtime is running and healthy
    Running,
    /// Runtime is stopped
    Stopped,
    /// Runtime failed with error message
    Failed(String),
}

/// Bun runtime manager
pub struct BunRuntime {
    /// Child process handle
    child: Option<CommandChild>,
    /// HTTP server port (discovered via health check)
    port: Option<u16>,
    /// Current runtime status
    status: Arc<Mutex<BunRuntimeStatus>>,
    startup_license: Option<StartupLicenseMetadata>,
}

impl BunRuntime {
    const AUDIT_REDACTION: &'static str = "[REDACTED]";

    #[cfg(target_os = "macos")]
    fn mark_spotlight_noindex(path: &Path) {
        let marker = path.join(".metadata_never_index");
        if let Err(e) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(marker)
        {
            warn!("Failed to create .metadata_never_index: {}", e);
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn mark_spotlight_noindex(_path: &Path) {}

    /// Create a new BunRuntime instance
    pub fn new() -> Self {
        Self {
            child: None,
            port: None,
            status: Arc::new(Mutex::new(BunRuntimeStatus::Stopped)),
            startup_license: None,
        }
    }

    fn map_entitlement_state(state: EntitlementState) -> &'static str {
        match state {
            EntitlementState::Active => "active",
            EntitlementState::Grace => "grace",
            EntitlementState::Restricted => "restricted",
            EntitlementState::Blocked => "blocked",
        }
    }

    fn should_redact_key(key: &str) -> bool {
        let normalized = key.to_ascii_lowercase();
        [
            "token",
            "secret",
            "session",
            "authorization",
            "cookie",
            "entitlementjws",
        ]
        .iter()
        .any(|sensitive| normalized.contains(sensitive))
    }

    fn looks_like_jwt(value: &str) -> bool {
        let segments: Vec<&str> = value.split('.').collect();
        segments.len() == 3 && segments.iter().all(|segment| !segment.is_empty())
    }

    fn redact_value(value: Value) -> Value {
        match value {
            Value::Array(items) => Value::Array(
                items
                    .into_iter()
                    .map(Self::redact_value)
                    .collect::<Vec<Value>>(),
            ),
            Value::Object(entries) => {
                let mut next = Map::new();
                for (key, nested) in entries {
                    if Self::should_redact_key(&key) {
                        next.insert(
                            key,
                            Value::String(Self::AUDIT_REDACTION.to_string()),
                        );
                    } else {
                        next.insert(key, Self::redact_value(nested));
                    }
                }
                Value::Object(next)
            }
            Value::String(raw) if Self::looks_like_jwt(&raw) => {
                Value::String(Self::AUDIT_REDACTION.to_string())
            }
            other => other,
        }
    }

    fn emit_license_audit_event(
        event_type: &str,
        account_id: Option<String>,
        device_id: Option<String>,
        state_from: Option<String>,
        state_to: Option<String>,
        reason_code: Option<String>,
        details: Value,
    ) {
        let payload = LicenseAuditEvent {
            event_type: event_type.to_string(),
            account_id,
            device_id,
            state_from,
            state_to,
            reason_code,
            details: Self::redact_value(details),
            timestamp: now_unix_ms().to_string(),
        };

        match serde_json::to_string(&payload) {
            Ok(json) => info!("{}", json),
            Err(error) => warn!("Failed to serialize license audit event: {}", error),
        }
    }

    fn evaluate_startup_license<R: Runtime>(app: &AppHandle<R>) -> StartupLicenseMetadata {
        let default_blocked = StartupLicenseMetadata {
            contract_version: 1,
            state: "blocked".to_string(),
            code: "SECRETS_STATE_UNAVAILABLE".to_string(),
        };

        let Some(state) = app.try_state::<SecretsState>() else {
            return default_blocked;
        };

        let current_cache = match state.get_entitlement_cache() {
            Ok(cache) => cache,
            Err(_) => {
                return StartupLicenseMetadata {
                    contract_version: 1,
                    state: "blocked".to_string(),
                    code: "ENTITLEMENT_CACHE_UNAVAILABLE".to_string(),
                }
            }
        };

        let verifier = EntitlementVerifier::from_env();
        let now = now_unix_ms();
        let evaluation = verifier.evaluate(None, current_cache.as_ref(), now);

        let state_from = current_cache.as_ref().map(|cache| {
            let grace_limit = cache
                .expires_at_unix_ms
                .saturating_add(verifier.policy.grace_period_ms);
            if now <= cache.expires_at_unix_ms {
                "active".to_string()
            } else if now <= grace_limit {
                "grace".to_string()
            } else {
                "blocked".to_string()
            }
        });

        if evaluation.cache_updated {
            let cache_result = match &evaluation.cache {
                Some(next_cache) => state.set_entitlement_cache(next_cache),
                None => state.remove_entitlement_cache().map(|_| ()),
            };

            if let Err(err) = cache_result {
                warn!("Failed to update entitlement cache during startup evaluation: {}", err);
            }
        }

        Self::emit_license_audit_event(
            "license.entitlement.validation",
            None,
            None,
            state_from,
            Some(Self::map_entitlement_state(evaluation.state).to_string()),
            Some(evaluation.code.clone()),
            serde_json::json!({
                "cacheUpdated": evaluation.cache_updated,
                "trustedTimeUnixMs": evaluation.trusted_time_unix_ms,
                "cachedEntitlementJws": current_cache.as_ref().map(|v| v.entitlement_jws.clone()),
            }),
        );

        StartupLicenseMetadata {
            contract_version: 1,
            state: Self::map_entitlement_state(evaluation.state).to_string(),
            code: evaluation.code,
        }
    }

    /// Spawn the Bun sidecar process
    ///
    /// # Arguments
    /// * `app` - Tauri app handle
    ///
    /// # Returns
    /// Result containing the discovered port number
    ///
    /// # Behavior
    /// - Development mode (debug builds): Runs `bun --watch src-ts/src/main.ts` for hot reloading
    /// - Production mode (release builds): Uses compiled `bun-backend` sidecar binary
    pub async fn spawn<R: Runtime>(&mut self, app: &AppHandle<R>) -> Result<u16> {
        // Set status to starting
        {
            let mut status = self.status.lock().unwrap();
            *status = BunRuntimeStatus::Starting;
        }

        // Detect if running in development mode
        let is_dev = cfg!(debug_assertions);

        // Keep runtime data outside the repository to avoid Spotlight indexing churn
        // from active dev logs/build artifacts.
        let mut app_data_dir = app
            .path()
            .app_data_dir()
            .context("Failed to get app data directory")?;
        if is_dev {
            app_data_dir = app_data_dir.join("dev");
        }

        let app_log_dir = app_data_dir.join("logs");

        // Ensure directories exist
        std::fs::create_dir_all(&app_data_dir).context("Failed to create app data directory")?;
        std::fs::create_dir_all(&app_log_dir).context("Failed to create log directory")?;
        Self::mark_spotlight_noindex(&app_data_dir);
        Self::mark_spotlight_noindex(&app_log_dir);

        let backend_port = "0"; // OS will assign a free port
        let startup_license = if is_dev {
            info!("DEV MODE: Bypassing license evaluation, defaulting to active");
            StartupLicenseMetadata {
                contract_version: 1,
                state: "active".to_string(),
                code: "DEV_MODE_BYPASS".to_string(),
            }
        } else {
            Self::evaluate_startup_license(app)
        };

        info!(
            "Starting Bun sidecar (mode: {})...",
            if is_dev { "development" } else { "production" }
        );
        info!("  APP_DATA_DIR: {}", app_data_dir.display());
        info!("  APP_LOG_DIR: {}", app_log_dir.display());

        let (mut rx, child) = if is_dev {
            // Development: Run bun with --watch for hot reloading
            info!("DEV MODE: Using bun --watch for hot reloading");

            // Get current directory and try to find src-ts/src/main.ts
            let current_dir = std::env::current_dir().context("Failed to get current directory")?;

            // Try multiple possible locations for the TypeScript entrypoint
            let mut possible_paths = vec![
                current_dir.join("src-ts").join("src").join("main.ts"), // From project root
            ];

            // Add parent directory path if it exists
            if let Some(parent) = current_dir.parent() {
                possible_paths.push(parent.join("src-ts").join("src").join("main.ts"));
            }

            let ts_entrypoint = possible_paths.into_iter().find(|p| p.exists()).context(
                "TypeScript entrypoint (src-ts/src/main.ts) not found in any expected location",
            )?;

            info!("  TypeScript entrypoint: {}", ts_entrypoint.display());

            // Spawn bun with --watch
            let command = app
                .shell()
                .command("bun")
                .args(["--watch", ts_entrypoint.to_str().unwrap()])
                .env("PORT", backend_port)
                .env("APP_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                .env("APP_LOG_DIR", app_log_dir.to_string_lossy().to_string())
                .env("NODE_ENV", "development")
                .env(
                    "OPENPCB_STARTUP_CONTRACT_VERSION",
                    startup_license.contract_version.to_string(),
                )
                .env("OPENPCB_STARTUP_LICENSE_STATE", startup_license.state.clone())
                .env("OPENPCB_STARTUP_LICENSE_CODE", startup_license.code.clone());

            command.spawn().context("Failed to spawn bun --watch")?
        } else {
            // Production: Use compiled sidecar binary
            info!("PROD MODE: Using compiled bun-backend sidecar");

            #[cfg(not(debug_assertions))]
            if let Err(e) = Self::verify_sidecar_integrity(app) {
                warn!("Sidecar integrity check failed: {}", e);
                // Non-fatal in this iteration; enforcement can be hardened once hash pipeline is set up
            }

            let command = app
                .shell()
                .sidecar("bun-backend")
                .context("Failed to create bun-backend sidecar command")?
                .env("PORT", backend_port)
                .env("APP_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                .env("APP_LOG_DIR", app_log_dir.to_string_lossy().to_string())
                .env("NODE_ENV", "production")
                .env(
                    "OPENPCB_STARTUP_CONTRACT_VERSION",
                    startup_license.contract_version.to_string(),
                )
                .env("OPENPCB_STARTUP_LICENSE_STATE", startup_license.state.clone())
                .env("OPENPCB_STARTUP_LICENSE_CODE", startup_license.code.clone());

            command
                .spawn()
                .context("Failed to spawn bun-backend sidecar")?
        };

        info!("Bun sidecar spawned with PID: {}", child.pid());

        // Store child process
        self.child = Some(child);

        // Spawn async task to monitor stdout/stderr and discover port
        let status_clone = Arc::clone(&self.status);
        let (metadata_tx, mut metadata_rx) = unbounded_channel();
        let app_clone = app.clone();

        tauri::async_runtime::spawn(async move {
            info!("Starting stdout/stderr monitor...");

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        info!("[Bun stdout] {}", line.trim());

                        if let Some(metadata) = Self::extract_startup_metadata_from_output(&line) {
                            info!("Discovered Bun server port: {}", metadata.port);
                            let _ = metadata_tx.send(metadata.clone());

                            // Emit Tauri event to notify frontend
                            let backend_url = format!("http://127.0.0.1:{}", metadata.port);
                            if let Err(e) = app_clone.emit(
                                "backend-ready",
                                BackendReadyPayload {
                                    url: backend_url.clone(),
                                    port: metadata.port,
                                    startup_contract_version: metadata.license.contract_version,
                                    startup_license_state: metadata.license.state.clone(),
                                    startup_license_code: metadata.license.code.clone(),
                                },
                            ) {
                                warn!("Failed to emit backend-ready event: {}", e);
                            } else {
                                info!("Emitted backend-ready event: {}", backend_url);
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        warn!("[Bun stderr] {}", line.trim());
                    }
                    CommandEvent::Error(err) => {
                        error!("[Bun error] {}", err);
                        let mut status = status_clone.lock().unwrap();
                        *status = BunRuntimeStatus::Failed(err);
                    }
                    CommandEvent::Terminated(payload) => {
                        warn!(
                            "[Bun terminated] code: {:?}, signal: {:?}",
                            payload.code, payload.signal
                        );
                        let mut status = status_clone.lock().unwrap();
                        *status = BunRuntimeStatus::Stopped;
                        break;
                    }
                    _ => {}
                }
            }

            info!("Bun stdout/stderr monitor stopped");
        });

        let startup = tokio::time::timeout(Duration::from_secs(10), metadata_rx.recv())
            .await
            .context("Timeout waiting for Bun server to start")?
            .context("Startup metadata channel closed unexpectedly")?;

        let port = startup.port;

        self.port = Some(port);
        self.startup_license = Some(startup.license);

        // Perform health check
        self.health_check().await?;

        // Update status to running
        {
            let mut status = self.status.lock().unwrap();
            *status = BunRuntimeStatus::Running;
        }

        info!("Bun sidecar is ready at http://127.0.0.1:{}", port);

        Ok(port)
    }

    fn extract_startup_metadata_from_output(line: &str) -> Option<StartupOutputMetadata> {
        // Try to parse as JSON
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            let port_num = json.get("serverPort")?.as_u64()?;
            let contract_version = json
                .get("startupContractVersion")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u16;
            let state = json
                .get("startupLicenseState")
                .and_then(|v| v.as_str())
                .unwrap_or("blocked")
                .to_string();
            let code = json
                .get("startupLicenseCode")
                .and_then(|v| v.as_str())
                .unwrap_or("STARTUP_LICENSE_MISSING")
                .to_string();

            return Some(StartupOutputMetadata {
                port: port_num as u16,
                license: StartupLicenseMetadata {
                    contract_version,
                    state,
                    code,
                },
            });
        }
        None
    }

    /// Perform health check on the Bun server
    async fn health_check(&self) -> Result<()> {
        let port = self.port.context("Port not set")?;
        let url = format!("http://127.0.0.1:{}/api/health", port);

        info!("Performing health check: {}", url);

        // Retry health check up to 5 times with exponential backoff
        let mut retries = 5;
        let mut delay = Duration::from_millis(100);

        loop {
            match reqwest::get(&url).await {
                Ok(response) => {
                    if response.status().is_success() {
                        info!("Health check passed: {}", response.status());
                        return Ok(());
                    } else {
                        warn!("Health check returned status: {}", response.status());
                    }
                }
                Err(e) => {
                    warn!("Health check failed: {}", e);
                }
            }

            retries -= 1;
            if retries == 0 {
                anyhow::bail!("Health check failed after 5 retries");
            }

            tokio::time::sleep(delay).await;
            delay *= 2; // Exponential backoff
        }
    }

    /// Get current status of the runtime
    pub fn status(&self) -> BunRuntimeStatus {
        self.status.lock().unwrap().clone()
    }

    /// Get the port number (if available)
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// Check if the runtime is running
    pub fn is_running(&self) -> bool {
        matches!(*self.status.lock().unwrap(), BunRuntimeStatus::Running)
    }

    pub fn startup_license(&self) -> Option<(u16, String, String)> {
        self.startup_license
            .as_ref()
            .map(|m| (m.contract_version, m.state.clone(), m.code.clone()))
    }

    /// Verify the sidecar binary SHA-256 hash against OPENPCB_SIDECAR_HASH env var (if set).
    ///
    /// Only compiled in release builds. If OPENPCB_SIDECAR_HASH is unset, logs a warning
    /// and returns Ok — hash enforcement requires the build pipeline to produce the expected value.
    #[cfg(not(debug_assertions))]
    fn verify_sidecar_integrity<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
        use ring::digest::{Context, SHA256};

        let sidecar_path = app
            .path()
            .resolve("binaries/bun-backend", tauri::path::BaseDirectory::Resource)
            .context("Failed to resolve sidecar resource path")?;

        let expected_hash = match std::env::var("OPENPCB_SIDECAR_HASH") {
            Ok(h) if !h.is_empty() => h,
            _ => {
                // TODO: embed hash via build pipeline (set OPENPCB_SIDECAR_HASH in CI after bun:compile)
                warn!("OPENPCB_SIDECAR_HASH not set; skipping sidecar integrity enforcement");
                return Ok(());
            }
        };

        let bytes = std::fs::read(&sidecar_path)
            .with_context(|| format!("Failed to read sidecar binary: {}", sidecar_path.display()))?;

        let mut ctx = Context::new(&SHA256);
        ctx.update(&bytes);
        let digest = ctx.finish();
        let actual_hash = digest
            .as_ref()
            .iter()
            .fold(String::with_capacity(64), |mut s, b| {
                use std::fmt::Write;
                let _ = write!(s, "{:02x}", b);
                s
            });

        if actual_hash != expected_hash.to_ascii_lowercase() {
            anyhow::bail!(
                "Sidecar integrity check failed: expected {}, got {}",
                expected_hash,
                actual_hash
            );
        }

        info!("Sidecar integrity verified (SHA-256: {})", actual_hash);
        Ok(())
    }

    /// Shutdown the Bun runtime gracefully
    pub async fn shutdown(&mut self) -> Result<()> {
        info!("Shutting down Bun runtime...");

        if let Some(child) = self.child.take() {
            // Try graceful shutdown via SIGTERM
            if let Err(e) = child.kill() {
                error!("Failed to kill Bun process: {}", e);
            } else {
                info!("Sent SIGTERM to Bun process");
            }

            // Wait a bit for graceful shutdown
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        self.port = None;
        self.startup_license = None;

        {
            let mut status = self.status.lock().unwrap();
            *status = BunRuntimeStatus::Stopped;
        }

        info!("Bun runtime stopped");
        Ok(())
    }
}

impl Drop for BunRuntime {
    fn drop(&mut self) {
        // Ensure child process is killed on drop
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_port_from_output() {
        let json_output = r#"{"serverAddress":"http://localhost:3456","serverPort":3456,"status":"Server is running","startupContractVersion":1,"startupLicenseState":"active","startupLicenseCode":"TOKEN_VALID"}"#;
        let metadata = BunRuntime::extract_startup_metadata_from_output(json_output)
            .expect("metadata should parse");
        assert_eq!(metadata.port, 3456);
        assert_eq!(metadata.license.contract_version, 1);
        assert_eq!(metadata.license.state, "active");
        assert_eq!(metadata.license.code, "TOKEN_VALID");

        let invalid_output = "Some random text";
        assert!(BunRuntime::extract_startup_metadata_from_output(invalid_output).is_none());
    }

    #[test]
    fn test_extract_startup_metadata_defaults_to_blocked() {
        let json_output =
            r#"{"serverAddress":"http://localhost:4567","serverPort":4567,"status":"Server is running"}"#;
        let metadata = BunRuntime::extract_startup_metadata_from_output(json_output)
            .expect("metadata should parse");

        assert_eq!(metadata.port, 4567);
        assert_eq!(metadata.license.contract_version, 1);
        assert_eq!(metadata.license.state, "blocked");
        assert_eq!(metadata.license.code, "STARTUP_LICENSE_MISSING");
    }

    #[test]
    fn test_extract_startup_metadata_preserves_grace_and_expiry_code() {
        let json_output = r#"{"serverAddress":"http://localhost:5678","serverPort":5678,"status":"Server is running","startupContractVersion":1,"startupLicenseState":"grace","startupLicenseCode":"GRACE_EXPIRED"}"#;
        let metadata = BunRuntime::extract_startup_metadata_from_output(json_output)
            .expect("metadata should parse");

        assert_eq!(metadata.port, 5678);
        assert_eq!(metadata.license.contract_version, 1);
        assert_eq!(metadata.license.state, "grace");
        assert_eq!(metadata.license.code, "GRACE_EXPIRED");
    }

    #[test]
    fn test_runtime_status() {
        let runtime = BunRuntime::new();
        assert_eq!(runtime.status(), BunRuntimeStatus::Stopped);
        assert!(!runtime.is_running());
    }

    #[test]
    fn redacts_sensitive_license_audit_values() {
        let payload = serde_json::json!({
            "token": "header.payload.signature",
            "sessionSecret": "abc",
            "nested": {
                "authorization": "Bearer value",
                "entitlementJws": "aaa.bbb.ccc"
            }
        });
        let redacted = BunRuntime::redact_value(payload);

        assert_eq!(redacted["token"], "[REDACTED]");
        assert_eq!(redacted["sessionSecret"], "[REDACTED]");
        assert_eq!(redacted["nested"]["authorization"], "[REDACTED]");
        assert_eq!(redacted["nested"]["entitlementJws"], "[REDACTED]");
    }
}
