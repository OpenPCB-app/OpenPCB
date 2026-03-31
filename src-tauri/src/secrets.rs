use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use iota_stronghold::{Client, ClientError};
use rand::RngCore;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::log::{info, warn};
use tauri_plugin_stronghold::stronghold::Stronghold;

const STRONGHOLD_CLIENT: &[u8] = b"openpcb";
const PROVIDER_KEY_PREFIX: &str = "provider.";
const PROVIDER_KEY_SUFFIX: &str = ".apiKey";
const ACCOUNT_SESSION_KEY: &str = "account.session";
const ENTITLEMENT_CACHE_KEY: &str = "account.entitlement.cache";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionSecret {
    pub session_token: String,
    pub refresh_token: Option<String>,
    pub account_id: String,
    pub device_id: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementCacheMetadata {
    pub entitlement_jws: String,
    pub cached_at_unix_ms: u64,
    pub expires_at_unix_ms: u64,
    pub last_trusted_time_unix_ms: u64,
}

const PROVIDER_ENV_MAP: &[(&str, &str)] = &[
    ("openai", "OPENAI_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("groq", "GROQ_API_KEY"),
];

#[derive(Clone)]
pub struct SecretsState {
    snapshot_path: PathBuf,
    key_path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl SecretsState {
    pub fn new<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .context("Failed to resolve app data dir")?;
        let app_local_dir = app
            .path()
            .app_local_data_dir()
            .context("Failed to resolve app local data dir")?;

        fs::create_dir_all(&app_data_dir).context("Failed to create app data dir")?;
        fs::create_dir_all(&app_local_dir).context("Failed to create app local data dir")?;

        Ok(Self {
            snapshot_path: app_data_dir.join("secrets.hold"),
            key_path: app_local_dir.join("stronghold.key"),
            lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn list_provider_keys(&self) -> Result<Vec<String>> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let keys = client
            .store()
            .keys()
            .context("Failed to list stronghold store keys")?;

        let mut providers = Vec::new();
        for key in keys {
            let key = match String::from_utf8(key) {
                Ok(key) => key,
                Err(_) => continue,
            };
            if let Some(provider_id) = parse_provider_key(&key) {
                providers.push(provider_id.to_string());
            }
        }

        providers.sort();
        providers.dedup();
        Ok(providers)
    }

    pub fn has_provider_key(&self, provider_id: &str) -> Result<bool> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let key = provider_store_key(provider_id);
        client
            .store()
            .contains_key(key.as_bytes())
            .context("Failed to check stronghold store")
    }

    pub fn set_provider_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let key = provider_store_key(provider_id);
        client
            .store()
            .insert(key.as_bytes().to_vec(), api_key.as_bytes().to_vec(), None)
            .context("Failed to store provider API key")?;
        stronghold.save().context("Failed to persist stronghold")?;
        let snapshot_path = resolve_snapshot_path(&self.snapshot_path)?;
        if !snapshot_path.exists() {
            return Err(anyhow!("Stronghold snapshot missing after save"));
        }
        Ok(())
    }

    pub fn get_provider_key(&self, provider_id: &str) -> Result<Option<String>> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let key = provider_store_key(provider_id);
        let value = client
            .store()
            .get(key.as_bytes())
            .context("Failed to read provider API key")?;

        match value {
            Some(bytes) => String::from_utf8(bytes)
                .map(Some)
                .context("Failed to decode provider API key"),
            None => Ok(None),
        }
    }

    pub fn remove_provider_key(&self, provider_id: &str) -> Result<bool> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let key = provider_store_key(provider_id);
        let removed = client
            .store()
            .delete(key.as_bytes())
            .context("Failed to remove provider API key")?
            .is_some();
        stronghold.save().context("Failed to persist stronghold")?;
        let snapshot_path = resolve_snapshot_path(&self.snapshot_path)?;
        if !snapshot_path.exists() {
            return Err(anyhow!("Stronghold snapshot missing after save"));
        }
        Ok(removed)
    }

    pub fn export_env(&self) -> Result<HashMap<String, String>> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let store = client.store();
        let mut env = HashMap::new();

        for (provider_id, env_key) in PROVIDER_ENV_MAP {
            let key = provider_store_key(provider_id);
            if let Some(value) = store
                .get(key.as_bytes())
                .context("Failed to read provider API key")?
            {
                if let Ok(value) = String::from_utf8(value) {
                    if !value.is_empty() {
                        env.insert(env_key.to_string(), value);
                    }
                }
            }
        }

        Ok(env)
    }

    pub fn set_account_session(&self, session: &AccountSessionSecret) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        insert_json_value(&client, ACCOUNT_SESSION_KEY, session)?;
        persist_snapshot(&stronghold, &self.snapshot_path)
    }

    pub fn get_account_session(&self) -> Result<Option<AccountSessionSecret>> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        read_json_value(&client, ACCOUNT_SESSION_KEY)
    }

    pub fn remove_account_session(&self) -> Result<bool> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let removed = delete_store_key(&client, ACCOUNT_SESSION_KEY)?;
        persist_snapshot(&stronghold, &self.snapshot_path)?;
        Ok(removed)
    }

    pub fn set_entitlement_cache(&self, cache: &EntitlementCacheMetadata) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        insert_json_value(&client, ENTITLEMENT_CACHE_KEY, cache)?;
        persist_snapshot(&stronghold, &self.snapshot_path)
    }

    pub fn get_entitlement_cache(&self) -> Result<Option<EntitlementCacheMetadata>> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        read_json_value(&client, ENTITLEMENT_CACHE_KEY)
    }

    pub fn remove_entitlement_cache(&self) -> Result<bool> {
        let _guard = self.lock.lock().unwrap();
        let stronghold = self.open_stronghold()?;
        let client = self.get_or_create_client(&stronghold)?;
        let removed = delete_store_key(&client, ENTITLEMENT_CACHE_KEY)?;
        persist_snapshot(&stronghold, &self.snapshot_path)?;
        Ok(removed)
    }

    fn open_stronghold(&self) -> Result<Stronghold> {
        let key = read_or_create_key(&self.key_path)?;
        let snapshot_path = resolve_snapshot_path(&self.snapshot_path)?;
        match Stronghold::new(&snapshot_path, key.clone()) {
            Ok(stronghold) => Ok(stronghold),
            Err(err) => {
                if snapshot_path.exists() {
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .map(|duration| duration.as_millis())
                        .unwrap_or(0);
                    let backup = snapshot_path.with_extension(format!("corrupt.{timestamp}"));
                    if let Err(rename_err) = fs::rename(&snapshot_path, &backup) {
                        warn!(
                            "Failed to quarantine stronghold snapshot {:?}: {}",
                            snapshot_path, rename_err
                        );
                    } else {
                        warn!(
                            "Quarantined corrupt stronghold snapshot {:?} -> {:?}",
                            snapshot_path, backup
                        );
                    }
                }

                Stronghold::new(&snapshot_path, key)
                    .with_context(|| format!("Failed to open stronghold snapshot: {err}"))
            }
        }
    }

    fn get_or_create_client(&self, stronghold: &Stronghold) -> Result<Client> {
        if let Ok(client) = stronghold.get_client(STRONGHOLD_CLIENT) {
            return Ok(client);
        }

        match stronghold.load_client(STRONGHOLD_CLIENT) {
            Ok(client) => Ok(client),
            Err(ClientError::ClientDataNotPresent) => stronghold
                .create_client(STRONGHOLD_CLIENT)
                .context("Failed to create stronghold client"),
            Err(ClientError::ClientAlreadyLoaded(_)) => stronghold
                .get_client(STRONGHOLD_CLIENT)
                .context("Failed to load stronghold client"),
            Err(err) => Err(err.into()),
        }
    }
}

pub fn load_provider_env<R: Runtime>(app: &AppHandle<R>) -> HashMap<String, String> {
    let state: tauri::State<'_, SecretsState> = app.state();
    match state.export_env() {
        Ok(env) => {
            if !env.is_empty() {
                let providers = env
                    .keys()
                    .map(|key| provider_from_env_key(key))
                    .collect::<Vec<_>>();
                info!("Loaded API keys for providers: {}", providers.join(", "));
            }
            env
        }
        Err(err) => {
            warn!("Failed to load API keys from stronghold: {}", err);
            HashMap::new()
        }
    }
}

fn read_or_create_key(path: &Path) -> Result<Vec<u8>> {
    if path.exists() {
        let key = fs::read(path).context("Failed to read stronghold key file")?;
        if key.len() != 32 {
            return Err(anyhow!("Invalid stronghold key length"));
        }
        return Ok(key);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("Failed to create stronghold key directory")?;
    }

    let mut key = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    write_key_file(path, &key)?;
    Ok(key)
}

#[cfg(unix)]
fn write_key_file(path: &Path, key: &[u8]) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .context("Failed to create stronghold key file")?;
    file.write_all(key)
        .context("Failed to write stronghold key file")
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, key: &[u8]) -> Result<()> {
    // Windows ACL hardening is not applied here; add platform-specific handling if needed.
    fs::write(path, key).context("Failed to write stronghold key file")
}

fn provider_store_key(provider_id: &str) -> String {
    format!("{PROVIDER_KEY_PREFIX}{provider_id}{PROVIDER_KEY_SUFFIX}")
}

fn persist_snapshot(stronghold: &Stronghold, snapshot_path: &Path) -> Result<()> {
    stronghold
        .save()
        .context("SECRETS_SAVE_FAILED: failed to persist stronghold")?;
    let snapshot_path = resolve_snapshot_path(snapshot_path)?;
    if !snapshot_path.exists() {
        return Err(anyhow!("SECRETS_SAVE_FAILED: snapshot missing after save"));
    }
    Ok(())
}

fn insert_json_value<T: Serialize>(client: &Client, key: &str, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec(value)
        .context("SECRETS_ENCODE_FAILED: failed to serialize stronghold value")?;
    client
        .store()
        .insert(key.as_bytes().to_vec(), bytes, None)
        .context("SECRETS_WRITE_FAILED: failed to write stronghold value")?;
    Ok(())
}

fn read_json_value<T: DeserializeOwned>(client: &Client, key: &str) -> Result<Option<T>> {
    let value = client
        .store()
        .get(key.as_bytes())
        .context("SECRETS_READ_FAILED: failed to read stronghold value")?;

    match value {
        Some(bytes) => {
            let decoded = serde_json::from_slice::<T>(&bytes)
                .context("SECRETS_DECODE_FAILED: failed to decode stronghold value")?;
            Ok(Some(decoded))
        }
        None => Ok(None),
    }
}

fn delete_store_key(client: &Client, key: &str) -> Result<bool> {
    let removed = client
        .store()
        .delete(key.as_bytes())
        .context("SECRETS_DELETE_FAILED: failed to delete stronghold value")?
        .is_some();
    Ok(removed)
}

fn parse_provider_key(key: &str) -> Option<&str> {
    if key.starts_with(PROVIDER_KEY_PREFIX) && key.ends_with(PROVIDER_KEY_SUFFIX) {
        let end = key.len() - PROVIDER_KEY_SUFFIX.len();
        let provider_id = &key[PROVIDER_KEY_PREFIX.len()..end];
        if !provider_id.is_empty() {
            return Some(provider_id);
        }
    }
    None
}

fn provider_from_env_key(key: &str) -> String {
    PROVIDER_ENV_MAP
        .iter()
        .find_map(|(provider, env)| {
            if *env == key {
                Some((*provider).to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| key.to_string())
}

fn snapshot_header_ok(path: &Path) -> Result<bool> {
    let mut file = fs::File::open(path).context("Failed to open snapshot file")?;
    let mut header = [0u8; 5];
    let bytes = file
        .read(&mut header)
        .context("Failed to read snapshot header")?;
    if bytes < header.len() {
        return Ok(false);
    }
    Ok(header == [0x50, 0x41, 0x52, 0x54, 0x49])
}

fn resolve_snapshot_path(base_path: &Path) -> Result<PathBuf> {
    if base_path.exists() && snapshot_header_ok(base_path).unwrap_or(false) {
        return Ok(base_path.to_path_buf());
    }

    let parent = base_path
        .parent()
        .ok_or_else(|| anyhow!("Snapshot path has no parent directory"))?;
    let base_name = base_path
        .file_name()
        .ok_or_else(|| anyhow!("Snapshot path has no filename"))?
        .to_string_lossy()
        .to_string();
    let prefix = format!("{base_name}.");

    let mut candidates: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    const MIN_SNAPSHOT_BYTES: u64 = 173;
    for entry in fs::read_dir(parent).context("Failed to read snapshot directory")? {
        let entry = entry.context("Failed to read snapshot directory entry")?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with(&prefix) {
            continue;
        }
        let metadata = entry
            .metadata()
            .context("Failed to read snapshot metadata")?;
        if !metadata.is_file() {
            continue;
        }
        if metadata.len() < MIN_SNAPSHOT_BYTES {
            continue;
        }
        if !snapshot_header_ok(&entry.path()).unwrap_or(false) {
            continue;
        }
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        candidates.push((entry.path(), modified));
    }

    if candidates.is_empty() {
        return Ok(base_path.to_path_buf());
    }

    candidates.sort_by_key(|(_, modified)| *modified);
    let (latest_path, _) = candidates.pop().unwrap();

    if let Err(err) = fs::rename(&latest_path, base_path) {
        warn!(
            "Failed to promote snapshot {:?} to {:?}: {}",
            latest_path, base_path, err
        );
        return Ok(latest_path);
    }

    Ok(base_path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct TestPaths {
        root: PathBuf,
        snapshot_path: PathBuf,
        key_path: PathBuf,
    }

    impl TestPaths {
        fn new() -> Self {
            let mut rng = rand::thread_rng();
            let root =
                std::env::temp_dir().join(format!("openpcb-secrets-test-{}", rng.next_u64()));
            let snapshot_path = root.join("secrets.hold");
            let key_path = root.join("stronghold.key");
            Self {
                root,
                snapshot_path,
                key_path,
            }
        }

        fn state(&self) -> SecretsState {
            SecretsState {
                snapshot_path: self.snapshot_path.clone(),
                key_path: self.key_path.clone(),
                lock: Arc::new(Mutex::new(())),
            }
        }
    }

    impl Drop for TestPaths {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn account_session_roundtrip_and_cleanup() {
        let paths = TestPaths::new();
        let state = paths.state();

        let session = AccountSessionSecret {
            session_token: "session-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            account_id: "acc_1".to_string(),
            device_id: "dev_1".to_string(),
            expires_at: "2026-01-01T00:00:00Z".to_string(),
        };

        state
            .set_account_session(&session)
            .expect("stores account session");

        let fetched = state
            .get_account_session()
            .expect("loads account session")
            .expect("session exists");
        assert_eq!(fetched, session);

        let removed = state
            .remove_account_session()
            .expect("removes account session");
        assert!(removed);

        let missing = state.get_account_session().expect("loads missing session");
        assert!(missing.is_none());
    }

    #[test]
    fn missing_records_return_none_without_error() {
        let paths = TestPaths::new();
        let state = paths.state();

        let session = state
            .get_account_session()
            .expect("session read should succeed");
        assert!(session.is_none());

        let entitlement = state
            .get_entitlement_cache()
            .expect("entitlement read should succeed");
        assert!(entitlement.is_none());

        let removed_session = state
            .remove_account_session()
            .expect("session remove should succeed");
        assert!(!removed_session);

        let removed_entitlement = state
            .remove_entitlement_cache()
            .expect("entitlement remove should succeed");
        assert!(!removed_entitlement);
    }

    #[test]
    fn entitlement_cache_roundtrip_includes_trusted_time_marker() {
        let paths = TestPaths::new();
        let state = paths.state();

        let cache = EntitlementCacheMetadata {
            entitlement_jws: "header.payload.signature".to_string(),
            cached_at_unix_ms: 1_700_000_000_000,
            expires_at_unix_ms: 1_700_000_100_000,
            last_trusted_time_unix_ms: 1_700_000_050_000,
        };

        state
            .set_entitlement_cache(&cache)
            .expect("stores entitlement cache");

        let fetched = state
            .get_entitlement_cache()
            .expect("loads entitlement cache")
            .expect("entitlement cache exists");
        assert_eq!(fetched, cache);

        let removed = state
            .remove_entitlement_cache()
            .expect("removes entitlement cache");
        assert!(removed);

        let missing = state
            .get_entitlement_cache()
            .expect("loads missing entitlement cache");
        assert!(missing.is_none());
    }
}
