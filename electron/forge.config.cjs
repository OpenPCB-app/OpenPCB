const path = require("node:path");
const fs = require("node:fs");

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
  },
};
