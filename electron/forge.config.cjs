const path = require("node:path");
const fs = require("node:fs");

const repoRoot = path.resolve(__dirname, "..");

module.exports = {
  packagerConfig: {
    name: "OpenPCB",
    executableName: "OpenPCB",
    appBundleId: "com.openpcb.electron",
    appCategoryType: "public.app-category.developer-tools",
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
      },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          maintainer: "OpenPCB",
          homepage: "https://github.com/andrejvysny/OpenPCB",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          homepage: "https://github.com/andrejvysny/OpenPCB",
        },
      },
    },
    {
      name: "@reforged/maker-appimage",
      platforms: ["linux"],
      config: {
        options: {
          productName: "OpenPCB",
          name: "openpcb",
          categories: ["Development"],
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
