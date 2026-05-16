const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

module.exports = {
  packagerConfig: {
    name: "OpenPCB",
    executableName: "OpenPCB",
    appBundleId: "com.openpcb.electron",
    appCategoryType: "public.app-category.developer-tools",
    // Stem path — electron-packager picks the right ext per platform:
    //   macOS  → icon.icns, Windows → icon.ico, Linux → icon.png
    icon: path.join(__dirname, "icon"),
    asar: {
      unpack: "**/*.node",
    },
    prune: false,
    // Ad-hoc signing is handled in the packageAfterCopy hook via direct
    // codesign invocation. @electron/osx-sign's identity discovery
    // rejects the `-` identity, so we cannot use forge's osxSign here.
    osxSign: false,
    extraResource: [
      path.join(repoRoot, "src", "core", "frontend", "dist"),
      path.join(repoRoot, "src"),
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        format: "ULFO",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "OpenPCB",
        authors: "OpenPCB",
        description: "OpenPCB desktop application",
        setupIcon: path.join(__dirname, "icon.ico"),
        iconUrl: "https://raw.githubusercontent.com/andrejvysny/OpenPCB/master/electron/icon.ico",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "openpcb",
          productName: "OpenPCB",
          description: "OpenPCB desktop application",
          bin: "OpenPCB",
          categories: ["Development"],
          maintainer: "OpenPCB",
          homepage: "https://github.com/andrejvysny/OpenPCB",
          icon: path.join(__dirname, "icon.png"),
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          name: "openpcb",
          productName: "OpenPCB",
          description: "OpenPCB desktop application",
          bin: "OpenPCB",
          categories: ["Development"],
          homepage: "https://github.com/andrejvysny/OpenPCB",
          license: "PolyForm-Noncommercial-1.0.0",
          icon: path.join(__dirname, "icon.png"),
        },
      },
    },
    {
      name: "@reforged/maker-appimage",
      platforms: ["linux"],
      config: {
        options: {
          name: "openpcb",
          productName: "OpenPCB",
          genericName: "PCB Design Suite",
          categories: ["Development"],
          description: "OpenPCB desktop application",
          icon: path.join(__dirname, "icon.png"),
        },
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const modules = ["better-sqlite3", "bindings", "file-uri-to-path"];
      const targetRoot = path.join(buildPath, "node_modules");
      fs.mkdirSync(targetRoot, { recursive: true });
      for (const moduleName of modules) {
        fs.cpSync(
          path.join(repoRoot, "node_modules", moduleName),
          path.join(targetRoot, moduleName),
          { recursive: true, force: true },
        );
      }
    },
    // Ad-hoc sign the macOS app after packaging. Without any signature,
    // downloaded .app bundles get the "is damaged" message from
    // Gatekeeper; an ad-hoc signature replaces it with the standard
    // "cannot verify developer" dialog that has an Open Anyway path.
    // Skip on non-macOS platforms (Windows/Linux runners) where
    // codesign isn't available.
    postPackage: async (_config, packageResult) => {
      if (packageResult.platform !== "darwin") return;
      for (const appOutputPath of packageResult.outputPaths) {
        const appBundle = fs
          .readdirSync(appOutputPath)
          .find((entry) => entry.endsWith(".app"));
        if (!appBundle) continue;
        const appPath = path.join(appOutputPath, appBundle);
        // --deep recurses into nested helpers/frameworks/.node files.
        // --force overwrites the linker-applied default signature.
        // identity `-` = ad-hoc (no certificate needed).
        execFileSync(
          "codesign",
          ["--force", "--deep", "--sign", "-", appPath],
          { stdio: "inherit" },
        );
        console.log(`[forge] ad-hoc signed ${appPath}`);
      }
    },
  },
};
