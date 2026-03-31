use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::{datatype::DataType, Generics, Type, TypeCollection};
use strsim::normalized_levenshtein;
use tauri::{AppHandle, Emitter, Runtime, Wry};
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    pub namespace: String,
    pub command: String,
    #[serde(default)]
    pub payload: BridgeValue,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct BridgeValue(Value);

impl From<Value> for BridgeValue {
    fn from(value: Value) -> Self {
        Self(value)
    }
}

impl From<BridgeValue> for Value {
    fn from(value: BridgeValue) -> Self {
        value.0
    }
}

impl Type for BridgeValue {
    fn inline(_: &mut TypeCollection, _: Generics) -> DataType {
        DataType::Any
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BridgeResponse {
    Ok {
        result: BridgeValue,
        #[serde(skip_serializing_if = "Option::is_none", rename = "correlationId")]
        correlation_id: Option<String>,
    },
    Error {
        error: BridgeErrorPayload,
        #[serde(skip_serializing_if = "Option::is_none", rename = "correlationId")]
        correlation_id: Option<String>,
    },
}

impl BridgeResponse {
    pub fn ok(result: impl Into<BridgeValue>, correlation_id: Option<String>) -> Self {
        Self::Ok {
            result: result.into(),
            correlation_id,
        }
    }

    pub fn error(error: BridgeError, correlation_id: Option<String>) -> Self {
        Self::Error {
            error: error.into_payload(),
            correlation_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BridgeErrorPayload {
    pub code: BridgeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<BridgeValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum BridgeErrorCode {
    #[serde(rename = "ENO_MODULE")]
    EnoModule,
    #[serde(rename = "ENO_CMD")]
    EnoCmd,
    #[serde(rename = "EVALID")]
    Evalid,
    #[serde(rename = "ERUNTIME")]
    Eruntime,
}

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("namespace '{namespace}' is not registered")]
    NamespaceNotFound { namespace: String },
    #[error("command '{command}' does not exist in namespace '{namespace}'")]
    CommandNotFound { namespace: String, command: String },
    #[error("invalid payload for {namespace}.{command}: {message}")]
    InvalidPayload {
        namespace: String,
        command: String,
        message: String,
        details: Option<BridgeValue>,
    },
    #[error("handler for {namespace}.{command} failed: {source}")]
    HandlerFailed {
        namespace: String,
        command: String,
        #[source]
        source: anyhow::Error,
    },
}

impl BridgeError {
    pub fn invalid_payload(
        namespace: impl Into<String>,
        command: impl Into<String>,
        message: impl Into<String>,
        details: Option<Value>,
    ) -> Self {
        Self::InvalidPayload {
            namespace: namespace.into(),
            command: command.into(),
            message: message.into(),
            details: details.map(Into::into),
        }
    }

    pub fn handler_failed(
        namespace: impl Into<String>,
        command: impl Into<String>,
        source: anyhow::Error,
    ) -> Self {
        Self::HandlerFailed {
            namespace: namespace.into(),
            command: command.into(),
            source,
        }
    }

    fn into_payload(self) -> BridgeErrorPayload {
        match self {
            Self::NamespaceNotFound { namespace } => BridgeErrorPayload {
                code: BridgeErrorCode::EnoModule,
                message: format!("namespace '{namespace}' is not registered"),
                details: None,
            },
            Self::CommandNotFound { namespace, command } => BridgeErrorPayload {
                code: BridgeErrorCode::EnoCmd,
                message: format!("command '{command}' does not exist in namespace '{namespace}'"),
                details: None,
            },
            Self::InvalidPayload {
                namespace,
                command,
                message,
                details,
            } => BridgeErrorPayload {
                code: BridgeErrorCode::Evalid,
                message: format!("invalid payload for {namespace}.{command}: {message}"),
                details,
            },
            Self::HandlerFailed {
                namespace,
                command,
                source,
            } => BridgeErrorPayload {
                code: BridgeErrorCode::Eruntime,
                message: format!("handler for {namespace}.{command} failed"),
                details: Some(Value::String(source.to_string()).into()),
            },
        }
    }
}

pub type BridgeResult = Result<Value, BridgeError>;

/// Event sink for emitting bridge events (used by long-running commands)
pub trait EventSink: Send + Sync + Clone + 'static {
    fn emit<S: Serialize>(&self, ns: &str, ev: &str, payload: &S);
}

/// Context passed to bridge handlers, providing event emission and cancellation
pub struct BridgeCtx<E: EventSink> {
    pub ns: &'static str,
    pub correlation_id: Option<String>,
    pub events: E,
    pub cancels: Arc<Mutex<HashMap<String, AbortHandle>>>,
}

#[async_trait]
pub trait BridgeNamespaceHandler<R: Runtime = Wry, E: EventSink = TauriEventSink<R>>:
    Send + Sync
{
    fn namespace(&self) -> &'static str;

    async fn handle(
        &self,
        app: &AppHandle<R>,
        command: &str,
        payload: Value,
        ctx: &BridgeCtx<E>,
    ) -> BridgeResult;
}

/// Tauri-specific EventSink implementation
pub struct TauriEventSink<R: Runtime> {
    app: Arc<AppHandle<R>>,
}

impl<R: Runtime> Clone for TauriEventSink<R> {
    fn clone(&self) -> Self {
        Self {
            app: Arc::clone(&self.app),
        }
    }
}

impl<R: Runtime> TauriEventSink<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app: Arc::new(app) }
    }
}

impl<R: Runtime> EventSink for TauriEventSink<R> {
    fn emit<S: Serialize>(&self, ns: &str, ev: &str, payload: &S) {
        let event_name = format!("{}:{}", ns, ev);
        if let Err(e) = self.app.emit(&event_name, payload) {
            warn!("Failed to emit event {}: {}", event_name, e);
        }
    }
}

pub struct BridgeRouter<R: Runtime = Wry, E: EventSink = TauriEventSink<R>> {
    handlers: HashMap<String, Arc<dyn BridgeNamespaceHandler<R, E>>>,
    _specs: Vec<&'static BridgeModuleSpec>,
    events: E,
    cancels: Arc<Mutex<HashMap<String, AbortHandle>>>,
}

impl<R: Runtime, E: EventSink> BridgeRouter<R, E> {
    pub fn builder() -> BridgeRouterBuilder<R, E> {
        BridgeRouterBuilder::default()
    }

    pub async fn route(&self, app: &AppHandle<R>, req: BridgeRequest) -> BridgeResponse {
        let BridgeRequest {
            namespace,
            command,
            payload,
            correlation_id,
        } = req;
        let payload: Value = payload.into();

        match self.handlers.get(&namespace) {
            Some(handler) => {
                let ctx = BridgeCtx {
                    ns: handler.namespace(),
                    correlation_id: correlation_id.clone(),
                    events: self.events.clone(),
                    cancels: self.cancels.clone(),
                };
                match handler.handle(app, &command, payload, &ctx).await {
                    Ok(result) => BridgeResponse::ok(result, correlation_id),
                    Err(error) => {
                        log_bridge_error(&error);
                        BridgeResponse::error(error, correlation_id)
                    }
                }
            }
            None => {
                self.log_unknown_namespace(&namespace);
                BridgeResponse::error(BridgeError::NamespaceNotFound { namespace }, correlation_id)
            }
        }
    }

    fn log_unknown_namespace(&self, namespace: &str) {
        if let Some(suggestion) = self.closest_namespace(namespace) {
            warn!(
                "bridge router: namespace '{namespace}' is not registered (closest match: '{suggestion}')"
            );
        } else {
            warn!("bridge router: namespace '{namespace}' is not registered");
        }
    }

    fn closest_namespace(&self, missing: &str) -> Option<String> {
        self.handlers
            .keys()
            .filter_map(|candidate| {
                let score = normalized_levenshtein(candidate, missing);
                (score >= 0.5).then_some((candidate.clone(), score))
            })
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal))
            .map(|(candidate, _)| candidate)
    }
}

impl<R: Runtime, E: EventSink> Default for BridgeRouter<R, E>
where
    E: Default,
{
    fn default() -> Self {
        Self {
            handlers: HashMap::new(),
            _specs: Vec::new(),
            events: E::default(),
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub struct BridgeRouterBuilder<R: Runtime = Wry, E: EventSink = TauriEventSink<R>> {
    handlers: HashMap<String, Arc<dyn BridgeNamespaceHandler<R, E>>>,
    events: Option<E>,
}

impl<R: Runtime, E: EventSink> Default for BridgeRouterBuilder<R, E> {
    fn default() -> Self {
        Self {
            handlers: HashMap::new(),
            events: None,
        }
    }
}

impl<R: Runtime, E: EventSink> BridgeRouterBuilder<R, E> {
    pub fn register<H>(&mut self, handler: H) -> Result<&mut Self, BridgeBuilderError>
    where
        H: BridgeNamespaceHandler<R, E> + 'static,
    {
        let namespace = handler.namespace();
        if self.handlers.contains_key(namespace) {
            return Err(BridgeBuilderError::DuplicateNamespace(
                namespace.to_string(),
            ));
        }

        self.handlers
            .insert(namespace.to_string(), Arc::new(handler));

        Ok(self)
    }

    pub fn with_events(mut self, events: E) -> Self {
        self.events = Some(events);
        self
    }

    pub fn build(self) -> BridgeRouter<R, E>
    where
        E: Default,
    {
        BridgeRouter {
            handlers: self.handlers,
            _specs: Vec::new(),
            events: self.events.unwrap_or_default(),
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Error)]
pub enum BridgeBuilderError {
    #[error("namespace '{0}' already registered")]
    DuplicateNamespace(String),
}

pub async fn dispatch_bridge_request<R: Runtime>(
    app: &AppHandle<R>,
    router: &BridgeRouter<R>,
    req: BridgeRequest,
) -> BridgeResponse {
    router.route(app, req).await
}

fn log_bridge_error(error: &BridgeError) {
    match error {
        BridgeError::CommandNotFound { namespace, command } => {
            warn!("bridge router: command '{command}' does not exist in namespace '{namespace}'")
        }
        BridgeError::InvalidPayload {
            namespace,
            command,
            message,
            ..
        } => warn!("bridge router: invalid payload for {namespace}.{command}: {message}"),
        BridgeError::HandlerFailed {
            namespace,
            command,
            source,
        } => warn!("bridge router: handler failure for {namespace}.{command}: {source}"),
        BridgeError::NamespaceNotFound { namespace } => {
            warn!("bridge router: namespace '{namespace}' is not registered")
        }
    }
}

// ============================================================================
// Manifest types for code generation
// ============================================================================

/// Specification for a bridge command (used for TS codegen).
#[derive(Debug, Clone, Serialize)]
pub struct BridgeCommandSpec {
    pub name: &'static str,
    pub args_rust: &'static str,   // e.g. "my_crate::HelloArgs"
    pub result_rust: &'static str, // e.g. "my_crate::HelloReply"
    pub stream: bool,
    pub long: bool,                        // long-running command
    pub item_rust: Option<&'static str>,   // item type for long commands
    pub event_name: Option<&'static str>,  // event name for long commands
    pub cancel_name: Option<&'static str>, // cancel command name
}

/// Specification for a bridge event (used for TS codegen).
#[derive(Debug, Clone, Serialize)]
pub struct BridgeEventSpec {
    pub name: &'static str,         // "backend-progress"
    pub payload_rust: &'static str, // e.g. "my_crate::ProgressPayload"
}

/// Complete specification for a bridge module (used for TS codegen).
#[derive(Debug, Clone, Serialize)]
pub struct BridgeModuleSpec {
    pub namespace: &'static str,
    pub commands: &'static [BridgeCommandSpec],
    pub events: &'static [BridgeEventSpec],
}

/// Registration entry for auto-discovery via inventory.
/// Note: Currently assumes all handlers use Wry runtime and TauriEventSink.
pub struct BridgeModuleRegistration {
    pub ns: &'static str,
    pub ctor: fn() -> Box<dyn BridgeNamespaceHandler<Wry, TauriEventSink<Wry>>>,
    pub spec: &'static BridgeModuleSpec,
}

// Global registry (linker fills this slice at link time).
inventory::collect!(BridgeModuleRegistration);

// Re-export inventory::submit for use in macros
#[doc(hidden)]
pub use inventory::submit as __inventory_submit;

impl BridgeRouter<Wry, TauriEventSink<Wry>> {
    /// Build router with a provided event sink (typically from AppHandle)
    /// This is the recommended way to create a router for use with long-running commands
    pub fn auto_with_events(events: TauriEventSink<Wry>) -> Self {
        let mut handlers = HashMap::new();
        let mut specs = Vec::new();

        for reg in inventory::iter::<BridgeModuleRegistration> {
            let handler = (reg.ctor)();
            handlers.insert(reg.ns.to_string(), Arc::from(handler));
            specs.push(reg.spec);
        }

        BridgeRouter {
            handlers,
            _specs: specs,
            events,
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl<R: Runtime, E: EventSink> BridgeRouter<R, E> {
    /// Get all module specs (for introspection/codegen).
    pub fn specs(&self) -> Vec<&'static BridgeModuleSpec> {
        inventory::iter::<BridgeModuleRegistration>()
            .map(|reg| reg.spec)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::test::{mock_app, MockRuntime};

    struct EchoHandler;

    #[async_trait]
    impl<R: Runtime> BridgeNamespaceHandler<R> for EchoHandler {
        fn namespace(&self) -> &'static str {
            "echo"
        }

        async fn handle(&self, _app: &AppHandle<R>, command: &str, payload: Value) -> BridgeResult {
            match command {
                "ping" => Ok(payload),
                other => Err(BridgeError::CommandNotFound {
                    namespace: "echo".into(),
                    command: other.to_string(),
                }),
            }
        }
    }

    #[test]
    fn propagates_correlation_id_on_success() {
        let mut builder = BridgeRouter::<MockRuntime>::builder();
        builder.register(EchoHandler).unwrap();
        let router = builder.build();
        let app = mock_app();
        let handle = app.handle();
        let payload = json!({ "echo": true });
        let response = tauri::async_runtime::block_on(router.route(
            &handle,
            BridgeRequest {
                namespace: "echo".into(),
                command: "ping".into(),
                payload: payload.clone().into(),
                correlation_id: Some("trace-123".into()),
            },
        ));

        match response {
            BridgeResponse::Ok {
                result,
                correlation_id,
            } => {
                assert_eq!(correlation_id.as_deref(), Some("trace-123"));
                let actual: Value = result.into();
                assert_eq!(actual, payload);
            }
            other => panic!("expected success response, got {other:?}"),
        }
    }

    #[test]
    fn unknown_namespace_sets_error_code() {
        let router = BridgeRouter::<MockRuntime>::builder().build();
        let app = mock_app();
        let handle = app.handle();
        let response = tauri::async_runtime::block_on(router.route(
            &handle,
            BridgeRequest {
                namespace: "ghost".into(),
                command: "noop".into(),
                payload: Value::Null.into(),
                correlation_id: Some("cid-1".into()),
            },
        ));

        match response {
            BridgeResponse::Error {
                error,
                correlation_id,
            } => {
                assert_eq!(error.code, BridgeErrorCode::EnoModule);
                assert_eq!(correlation_id.as_deref(), Some("cid-1"));
            }
            other => panic!("expected error response, got {other:?}"),
        }
    }

    #[test]
    fn unknown_command_sets_error_code() {
        let mut builder = BridgeRouter::<MockRuntime>::builder();
        builder.register(EchoHandler).unwrap();
        let router = builder.build();
        let app = mock_app();
        let handle = app.handle();
        let response = tauri::async_runtime::block_on(router.route(
            &handle,
            BridgeRequest {
                namespace: "echo".into(),
                command: "unknown".into(),
                payload: Value::Null.into(),
                correlation_id: Some("cid-2".into()),
            },
        ));

        match response {
            BridgeResponse::Error {
                error,
                correlation_id,
            } => {
                assert_eq!(error.code, BridgeErrorCode::EnoCmd);
                assert_eq!(correlation_id.as_deref(), Some("cid-2"));
            }
            other => panic!("expected error response, got {other:?}"),
        }
    }
}
