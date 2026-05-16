const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// Ad-hoc sign the macOS .app so Gatekeeper shows "cannot verify developer"
// (with Open Anyway path) instead of "is damaged" on downloaded bundles.
// Mirrors the previous Forge `postPackage` hook. No-op on win/linux.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterSign] .app not found at ${appPath}; skipping`);
    return;
  }

  // identity `-` = ad-hoc; --deep recurses helpers/frameworks/.node files;
  // --force overwrites the linker's default signature.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  console.log(`[afterSign] ad-hoc signed ${appPath}`);
};
