use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{
    parse_macro_input, punctuated::Punctuated, FnArg, ItemImpl, Lit, LitStr, Meta, PatType,
    ReturnType, Token, Type,
};

/// Attribute macro to mark an impl block as a bridge module.
///
/// Usage:
/// ```rust
/// #[bridge_module(ns = "space.hello")]
/// impl HelloModule {
///     #[bridge_cmd(name = "helloMessage")]
///     fn hello(args: HelloArgs) -> Result<HelloReply, String> { ... }
/// }
/// ```
#[proc_macro_attribute]
pub fn bridge_module(args: TokenStream, input: TokenStream) -> TokenStream {
    let args = parse_macro_input!(args with Punctuated<Meta, Token![,]>::parse_terminated);
    let mut namespace: Option<String> = None;

    for arg in args {
        if let Meta::NameValue(nv) = arg {
            if nv.path.is_ident("ns") {
                if let syn::Expr::Lit(syn::ExprLit {
                    lit: Lit::Str(s), ..
                }) = &nv.value
                {
                    namespace = Some(s.value());
                }
            }
        }
    }

    let ns = namespace.expect("bridge_module requires `ns = \"...\"`");
    let ast = parse_macro_input!(input as ItemImpl);

    // The type we're implementing for
    let self_ty = ast.self_ty.as_ref().clone();

    // Gather command methods annotated with #[bridge_cmd]
    #[derive(Clone)]
    struct Cmd {
        rust_fn: syn::Signature,
        exposed_name: String,
        stream: bool,
        long: bool,                  // long-running command
        item_ty: Option<Type>,       // item type for long commands (if specified)
        event_name: Option<String>,  // event name for long commands
        cancel_name: Option<String>, // cancel command name
        args_ty: Type,
        ret_ty: Type,
        is_async: bool,
        needs_app: bool,
    }

    let mut cmds: Vec<Cmd> = Vec::new();

    for item in &ast.items {
        if let syn::ImplItem::Fn(fun) = item {
            let mut cmd_name: Option<String> = None;
            let mut stream = false;
            let mut long = false;
            let mut item_str: Option<String> = None;
            let mut event_name: Option<String> = None;
            let mut cancel_name: Option<String> = None;

            for attr in &fun.attrs {
                if attr.path().is_ident("bridge_cmd") {
                    // Parse #[bridge_cmd(name = "...", stream = true, long = true, item = "Type", event = "...", cancel = "...")]
                    let meta = attr
                        .parse_args_with(|input: syn::parse::ParseStream| {
                            let mut n: Option<String> = None;
                            let mut s: bool = false;
                            let mut long: bool = false;
                            let mut item: Option<String> = None;
                            let mut event: Option<String> = None;
                            let mut cancel: Option<String> = None;

                            while !input.is_empty() {
                                let ident: syn::Ident = input.parse()?;
                                input.parse::<syn::Token![=]>()?;

                                if ident == "name" {
                                    let lit: LitStr = input.parse()?;
                                    n = Some(lit.value());
                                } else if ident == "stream" {
                                    let lit: syn::LitBool = input.parse()?;
                                    s = lit.value();
                                } else if ident == "long" {
                                    let lit: syn::LitBool = input.parse()?;
                                    long = lit.value();
                                } else if ident == "item" {
                                    let lit: LitStr = input.parse()?;
                                    item = Some(lit.value());
                                } else if ident == "event" {
                                    let lit: LitStr = input.parse()?;
                                    event = Some(lit.value());
                                } else if ident == "cancel" {
                                    let lit: LitStr = input.parse()?;
                                    cancel = Some(lit.value());
                                }

                                // Optional comma
                                let _ = input.parse::<syn::Token![,]>();
                            }

                            Ok((n, s, long, item, event, cancel))
                        })
                        .ok();

                    if let Some((n, s, l, it, ev, c)) = meta {
                        cmd_name = n;
                        stream = s;
                        long = l;
                        item_str = it;
                        event_name = ev;
                        cancel_name = c;
                    }
                }
            }

            if let Some(name) = cmd_name {
                let is_async = fun.sig.asyncness.is_some();

                // Check parameters: skip self, then check for args and app
                let mut inputs_iter = fun.sig.inputs.iter().skip(1); // Skip self
                let mut args_ty: Option<Type> = None;
                let mut needs_app = false;

                // First param after self is either args or app
                if let Some(arg) = inputs_iter.next() {
                    if let FnArg::Typed(PatType { ty, .. }) = arg {
                        // Check if it's AppHandle (could be AppHandle, &AppHandle, or tauri::AppHandle)
                        let is_app_handle = {
                            let inner_ty = if let Type::Reference(ref_ty) = &**ty {
                                &*ref_ty.elem
                            } else {
                                &**ty
                            };
                            if let Type::Path(path) = inner_ty {
                                path.path
                                    .segments
                                    .last()
                                    .map(|s| s.ident == "AppHandle")
                                    .unwrap_or(false)
                            } else {
                                false
                            }
                        };

                        if is_app_handle {
                            needs_app = true;
                            // Next param should be args
                            if let Some(arg) = inputs_iter.next() {
                                if let FnArg::Typed(PatType { ty, .. }) = arg {
                                    args_ty = Some((**ty).clone());
                                }
                            } else {
                                // No args, use unit type
                                args_ty = Some(syn::parse_quote!(()));
                            }
                        } else {
                            // First param is args
                            args_ty = Some((**ty).clone());
                            // Check if next is app
                            if let Some(arg) = inputs_iter.next() {
                                if let FnArg::Typed(PatType { ty, .. }) = arg {
                                    let inner_ty = if let Type::Reference(ref_ty) = &**ty {
                                        &*ref_ty.elem
                                    } else {
                                        &**ty
                                    };
                                    if let Type::Path(path) = inner_ty {
                                        if path
                                            .path
                                            .segments
                                            .last()
                                            .map(|s| s.ident == "AppHandle")
                                            .unwrap_or(false)
                                        {
                                            needs_app = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // No params after self, use unit type
                    args_ty = Some(syn::parse_quote!(()));
                }

                let args_ty = args_ty.expect("bridge_cmd method must have args or ()");

                // Return type
                let ret_ty: Type = match &fun.sig.output {
                    ReturnType::Default => syn::parse_quote!(()),
                    ReturnType::Type(_, ty) => (**ty).clone(),
                };

                // Parse item type if provided
                let item_ty = item_str.and_then(|s| syn::parse_str::<Type>(&s).ok());

                // Default event name to command name if not provided
                let final_event_name = event_name.unwrap_or_else(|| name.clone());
                // Default cancel name to "{command}_cancel" if not provided
                let final_cancel_name = cancel_name.unwrap_or_else(|| format!("{}_cancel", name));

                cmds.push(Cmd {
                    rust_fn: fun.sig.clone(),
                    exposed_name: name,
                    stream,
                    long,
                    item_ty,
                    event_name: Some(final_event_name),
                    cancel_name: Some(final_cancel_name),
                    args_ty,
                    ret_ty,
                    is_async,
                    needs_app,
                });
            }
        }
    }

    // Build match arms for dispatch()
    let mut match_arms = Vec::new();
    let mut cmd_specs = Vec::new();

    for c in &cmds {
        let call_ident = &c.rust_fn.ident;
        let exposed = &c.exposed_name;
        let args_ty = &c.args_ty;
        let ret_ty = &c.ret_ty;

        // Type names for manifest - use string representation
        // We'll use the type path as a string literal
        let args_ty_str = format!("{}", quote!(#args_ty));
        let ret_ty_str = format!("{}", quote!(#ret_ty));

        // Check if return type is Result<T, E> or just T
        let is_result = if let Type::Path(path) = ret_ty {
            path.path
                .segments
                .last()
                .map(|s| s.ident == "Result")
                .unwrap_or(false)
        } else {
            false
        };

        // In an impl block, methods always have self as first parameter
        // We always call as instance methods

        // Build method call with appropriate parameters
        // Note: app parameter should be &AppHandle
        let method_call = if c.needs_app {
            quote! { self.#call_ident(args, app) }
        } else {
            quote! { self.#call_ident(args) }
        };

        // Handle args deserialization - support unit type (no args)
        let is_unit_args = if let Type::Tuple(t) = &args_ty {
            t.elems.is_empty()
        } else {
            false
        };

        let args_deser = if is_unit_args {
            quote! {
                let args: #args_ty = ();
            }
        } else {
            quote! {
                let args: #args_ty = serde_json::from_value(payload)
                    .map_err(|e| openpcb_bridge::BridgeError::invalid_payload(
                        #ns, #exposed, e.to_string(), None
                    ))?;
            }
        };

        // Handle async vs sync
        let call_expr = if c.is_async {
            quote! { #method_call.await }
        } else {
            method_call
        };

        // Handle long-running commands differently
        if c.long {
            // Long-running command: spawn task, emit events, return immediately
            let event_name = c.event_name.as_ref().unwrap();
            let _cancel_cmd = c.cancel_name.as_ref().unwrap();

            // Check if return type is Iterator or similar
            // For now, assume it returns an iterator that we can iterate
            match_arms.push(quote! {
                #exposed => {
                    #args_deser

                    // Generate correlation ID
                    let cid = ctx.correlation_id.clone().unwrap_or_else(|| {
                        ::uuid::Uuid::new_v4().to_string()
                    });

                    // Clone context for task
                    let events = ctx.events.clone();
                    let ns_str = ctx.ns;
                    let event_base = #event_name;

                    // Spawn task to run the iterator/stream
                    let task = ::tauri::async_runtime::spawn(async move {
                        // Call the user function to get iterator
                        let iter = #call_expr;

                        // Emit data events for each item
                        // Note: This assumes the function returns an iterator
                        // For async streams, we'd need different handling
                        for item in iter {
                            let payload = ::serde_json::json!({
                                "correlationId": cid,
                                "chunk": item
                            });
                            events.emit(ns_str, &format!("{}:data", event_base), &payload);
                        }

                        // Emit end event
                        let end_payload = ::serde_json::json!({
                            "correlationId": cid
                        });
                        events.emit(ns_str, &format!("{}:end", event_base), &end_payload);
                    });

                    // Register abort handle for cancellation
                    {
                        let mut cancels = ctx.cancels.lock().await;
                        cancels.insert(cid.clone(), task.abort_handle());
                    }

                    // Return immediate acknowledgment
                    Ok(::serde_json::json!({
                        "started": true,
                        "correlationId": cid
                    }))
                }
            });
        } else {
            // Regular (short) command
            // Check if return type is already BridgeResult
            let is_bridge_result = if let Type::Path(path) = ret_ty {
                path.path
                    .segments
                    .last()
                    .map(|s| s.ident == "BridgeResult")
                    .unwrap_or(false)
            } else {
                false
            };

            if is_bridge_result {
                // Method already returns BridgeResult, just call it
                match_arms.push(quote! {
                    #exposed => {
                        #args_deser
                        #call_expr
                    }
                });
            } else if is_result {
                // Method returns Result<T, E>, convert to BridgeResult
                match_arms.push(quote! {
                    #exposed => {
                        #args_deser
                        let out = #call_expr;
                        match out {
                            Ok(ok) => serde_json::to_value(ok)
                                .map_err(|e| openpcb_bridge::BridgeError::handler_failed(
                                    #ns, #exposed, anyhow::anyhow!("serialization failed: {}", e)
                                )),
                            Err(e) => Err(openpcb_bridge::BridgeError::handler_failed(
                                #ns, #exposed, anyhow::anyhow!("{}", e)
                            )),
                        }
                    }
                });
            } else {
                // Method returns T directly, convert to BridgeResult
                match_arms.push(quote! {
                    #exposed => {
                        #args_deser
                        let out = #call_expr;
                        serde_json::to_value(out)
                            .map_err(|e| openpcb_bridge::BridgeError::handler_failed(
                                #ns, #exposed, anyhow::anyhow!("serialization failed: {}", e)
                            ))
                    }
                });
            }
        }

        let stream_val = c.stream;
        let long_val = c.long;
        let args_ty_lit = syn::LitStr::new(&args_ty_str, proc_macro2::Span::call_site());
        let ret_ty_lit = syn::LitStr::new(&ret_ty_str, proc_macro2::Span::call_site());

        // Item type string
        let item_rust_opt = if let Some(ty) = &c.item_ty {
            let ty_str = format!("{}", quote!(#ty));
            let lit = syn::LitStr::new(&ty_str, proc_macro2::Span::call_site());
            quote! { Some(#lit) }
        } else {
            quote! { None }
        };

        // Event and cancel names
        let event_name_opt = if let Some(s) = &c.event_name {
            let lit = syn::LitStr::new(s, proc_macro2::Span::call_site());
            quote! { Some(#lit) }
        } else {
            quote! { None }
        };

        let cancel_name_opt = if let Some(s) = &c.cancel_name {
            let lit = syn::LitStr::new(s, proc_macro2::Span::call_site());
            quote! { Some(#lit) }
        } else {
            quote! { None }
        };

        cmd_specs.push(quote! {
            openpcb_bridge::BridgeCommandSpec {
                name: #exposed,
                args_rust: #args_ty_lit,
                result_rust: #ret_ty_lit,
                stream: #stream_val,
                long: #long_val,
                item_rust: #item_rust_opt,
                event_name: #event_name_opt,
                cancel_name: #cancel_name_opt,
            }
        });
    }

    // Constants for spec + inventory registration
    let ns_str = ns.clone();
    let commands_ident = format_ident!(
        "__BRIDGE_COMMANDS_{}",
        ns_str.replace(['.', '-'], "_").to_uppercase()
    );
    let events_ident = format_ident!(
        "__BRIDGE_EVENTS_{}",
        ns_str.replace(['.', '-'], "_").to_uppercase()
    );
    let spec_ident = format_ident!(
        "__BRIDGE_SPEC_{}",
        ns_str.replace(['.', '-'], "_").to_uppercase()
    );

    // Build the final expanded tokens
    let expanded = quote! {
        #ast

        #[::async_trait::async_trait]
        impl<R: ::tauri::Runtime, E: ::openpcb_bridge::EventSink> ::openpcb_bridge::BridgeNamespaceHandler<R, E> for #self_ty {
            fn namespace(&self) -> &'static str {
                #ns_str
            }

            async fn handle(
                &self,
                app: &::tauri::AppHandle<R>,
                command: &str,
                payload: ::serde_json::Value,
                ctx: &::openpcb_bridge::BridgeCtx<E>,
            ) -> ::openpcb_bridge::BridgeResult {
                match command {
                    #(#match_arms,)*
                    other => Err(::openpcb_bridge::BridgeError::CommandNotFound {
                        namespace: #ns_str.to_string(),
                        command: other.to_string(),
                    }),
                }
            }
        }

        // Reference events from bridge_events! macro
        // bridge_events! creates a static with this exact name: #events_ident
        // bridge_module does NOT create the static - it only references it directly.
        // bridge_events! must be called (even with an empty list) for modules using bridge_module.
        // If bridge_events! wasn't called, we'll get a compile error (undefined symbol).
        // To support modules without events, they should call: bridge_events!(("namespace"));
        #[doc(hidden)]
        const __EVENTS: &'static [::openpcb_bridge::BridgeEventSpec] = &#events_ident;

        #[doc(hidden)]
        pub static #commands_ident: &[::openpcb_bridge::BridgeCommandSpec] = &[
            #(#cmd_specs),*
        ];

        #[doc(hidden)]
        pub static #spec_ident: ::openpcb_bridge::BridgeModuleSpec = ::openpcb_bridge::BridgeModuleSpec {
            namespace: #ns_str,
            commands: #commands_ident,
            events: __EVENTS,
        };

        // Use openpcb_bridge's re-export of inventory
        ::openpcb_bridge::__inventory_submit! {
            ::openpcb_bridge::BridgeModuleRegistration {
                ns: #ns_str,
                ctor: || {
                    use ::std::default::Default;
                    ::std::boxed::Box::new(#self_ty::default())
                },
                spec: &#spec_ident,
            }
        }
    };

    expanded.into()
}

/// Marker attribute for bridge commands.
/// Parsed by the parent #[bridge_module] macro.
#[proc_macro_attribute]
pub fn bridge_cmd(_args: TokenStream, input: TokenStream) -> TokenStream {
    // Marker only; parsed by parent #[bridge_module] on the impl
    input
}

/// Macro to register events for a namespace.
///
/// Usage:
/// ```rust
/// bridge_events!("space.hello",
///     ("backend-progress", ProgressPayload)
/// );
/// ```
#[proc_macro]
pub fn bridge_events(input: TokenStream) -> TokenStream {
    // Try to parse as tuple first, if that fails, try as a function call style
    let input = if let Ok(tuple) = syn::parse::<syn::ExprTuple>(input.clone()) {
        tuple
    } else {
        // Parse as a comma-separated list of expressions
        let parsed: syn::Expr = syn::parse(input)
            .expect("bridge_events! expects: (namespace, (event1, Type1), (event2, Type2), ...)");
        // If it's a tuple, use it; otherwise try to extract elements
        match parsed {
            syn::Expr::Tuple(t) => t,
            _ => panic!(
                "bridge_events! must be called with a tuple: (namespace, (event1, Type1), ...)"
            ),
        }
    };

    let ns_lit = match &input.elems[0] {
        syn::Expr::Lit(syn::ExprLit {
            lit: Lit::Str(s), ..
        }) => s.value(),
        _ => panic!("First item must be namespace string literal"),
    };

    let mut specs = Vec::new();

    for item in input.elems.iter().skip(1) {
        if let syn::Expr::Tuple(t) = item {
            let name_lit = match &t.elems[0] {
                syn::Expr::Lit(syn::ExprLit {
                    lit: Lit::Str(s), ..
                }) => s.value(),
                _ => panic!("Event name must be string literal"),
            };

            // Extract type as string - the type should be a path expression
            // For example: commands::BackendNotification or commands::BackendProgress
            let ty_name_str = match &t.elems[1] {
                syn::Expr::Path(p) => format!("{}", quote!(#p)),
                _ => {
                    // Fallback: try to format the whole expression
                    // This handles cases where the type might be written differently
                    format!("{}", quote!(#(&t.elems[1])))
                }
            };

            let ty_name_lit = syn::LitStr::new(&ty_name_str, proc_macro2::Span::call_site());

            specs.push(quote! {
                ::openpcb_bridge::BridgeEventSpec {
                    name: #name_lit,
                    payload_rust: #ty_name_lit,
                }
            });
        }
    }

    let events_ident = format_ident!(
        "__BRIDGE_EVENTS_{}",
        ns_lit.replace(['.', '-'], "_").to_uppercase()
    );

    // Create the events static
    let expanded = quote! {
        #[doc(hidden)]
        #[allow(non_upper_case_globals)]
        static #events_ident: &[::openpcb_bridge::BridgeEventSpec] = &[
            #(#specs),*
        ];
    };

    expanded.into()
}
