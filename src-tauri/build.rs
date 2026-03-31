fn main() {
    // NOTE: Sidecar binary integrity verification uses runtime hash checking (see bun_runtime.rs).
    // The bun-backend sidecar is compiled as part of `npm run bun:compile` before Tauri bundles it.
    // Set OPENPCB_SIDECAR_HASH env var (SHA-256 hex) at build time or via CI to enable enforcement.
    tauri_build::build()
}
