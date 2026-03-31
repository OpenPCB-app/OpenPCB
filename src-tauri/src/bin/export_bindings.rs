use specta_typescript::Typescript;
use std::path::PathBuf;

fn main() {
    let builder = openpcb_lib::create_specta_builder();

    // Ensure the export path is interpreted relative to the crate manifest directory
    // (CARGO_MANIFEST_DIR), not the current working directory that cargo was invoked from.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let export_path: PathBuf = PathBuf::from(manifest_dir).join(openpcb_lib::SPECTA_EXPORT_PATH);

    if let Err(error) = builder.export(Typescript::default(), &export_path) {
        eprintln!("failed to export TypeScript bindings: {error}");
        std::process::exit(1);
    }
}
