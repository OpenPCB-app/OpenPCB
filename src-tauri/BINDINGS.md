# Generating TypeScript bindings (tauri-specta)

This project uses `tauri-specta` / `specta` to generate TypeScript bindings for the Rust Tauri commands.

Why the explicit binary exists
- The `export_bindings` binary calls the same Specta builder used by the app and writes a `.ts` file with typed wrappers that the frontend imports.

How to generate bindings locally
- From the repository root (recommended):

```bash
npm run bindings:generate
```

This runs:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin export_bindings
```

Notes on working directory and path resolution
- The exporter writes to a path declared in `src-tauri/src/lib.rs` (`SPECTA_EXPORT_PATH`).
- The export binary resolves that path relative to the crate's `CARGO_MANIFEST_DIR`, so the generated file will reliably be written to `src-ts/src/tauri-bindings.ts` regardless of your current working directory when running the script.

CI recommendation
- Use the npm script (`bindings:generate`) in CI before typechecking or building the frontend to ensure the generated types are present.

Troubleshooting
- If you still don't see `src-ts/src/tauri-bindings.ts` after running the command, check:
  - That `cargo` succeeded and did not print errors.
  - File permissions in the `src-ts/src/` directory.
  - That the `src-ts` package exists at the expected relative path.

If you'd like, I can add a `bindings:generate:release` npm script that runs the exporter in `--release` mode for deterministic CI artifacts.
