const path = require("node:path");
const fs = require("node:fs");
const repoRoot = path.resolve(__dirname, "..");
const downloadedCoreLibrary = path.join(repoRoot, ".build", "core-library");
const localCoreLibrary = path.join(repoRoot, "resources", "core-library");

function listOpclibs(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".opclib"));
  } catch {
    return [];
  }
}

// Pick whichever source has a .opclib; .build/ wins over resources/ when both
// exist (CI release path). Throw loudly if neither has one — silently shipping
// no library, or a stale stub, is the failure mode this guards against.
const downloaded = listOpclibs(downloadedCoreLibrary);
const local = listOpclibs(localCoreLibrary);
const bundledCoreLibrary =
  downloaded.length > 0
    ? downloadedCoreLibrary
    : local.length > 0
      ? localCoreLibrary
      : null;

if (!bundledCoreLibrary) {
  throw new Error(
    "electron-builder.cjs: no .opclib found in .build/core-library/ or resources/core-library/. " +
      "Run `npm run corelib:fetch` locally, or rely on release.yml's Fetch CoreLibrary step in CI. " +
      "Refusing to package without a bundled CoreLibrary.",
  );
}

console.error(
  `[electron-builder] bundling CoreLibrary from ${path.relative(repoRoot, bundledCoreLibrary)} (${(downloaded.length > 0 ? downloaded : local).join(", ")})`,
);

// When publishing from CI, override artifact version token with the git tag
// (RELEASE_NAME=${GITHUB_REF_NAME}) so filenames reflect the release, not the
// stale package.json version. Falls back to the electron-builder ${version}
// placeholder for local builds.
const versionToken = process.env.RELEASE_NAME || "${version}";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.openpcb.electron",
  productName: "OpenPCB",
  copyright: "© OpenPCB",

  protocols: [
    {
      name: "OpenPCB",
      schemes: ["openpcb"],
    },
  ],

  // electron is hoisted to the repo-root node_modules by npm workspaces, so
  // electron-builder can't infer the version from electron/node_modules.
  // Read it from the hoisted install at config-load time.
  electronVersion: require(require("node:path").resolve(
    __dirname,
    "..",
    "node_modules/electron/package.json",
  )).version,

  directories: {
    buildResources: ".",
    output: "out",
  },

  // Native better-sqlite3 is rebuilt into electron/node_modules for Electron's
  // Node ABI. Keep host/Bun's hoisted root build separate.
  files: [
    "dist/**/*",
    "package.json",
    {
      from: "node_modules/better-sqlite3",
      to: "node_modules/better-sqlite3",
      filter: ["**/*"],
    },
    {
      from: "../node_modules/bindings",
      to: "node_modules/bindings",
      filter: ["**/*"],
    },
    {
      from: "../node_modules/file-uri-to-path",
      to: "node_modules/file-uri-to-path",
      filter: ["**/*"],
    },
  ],

  asar: true,
  asarUnpack: ["**/*.node"],

  // Direct port of Forge's `extraResource` array. `from` is relative to this
  // config file's directory. Files arrive at process.resourcesPath/{to}.
  extraResources: [
    {
      from: path.relative(
        __dirname,
        path.join(repoRoot, "src", "core", "frontend", "dist"),
      ),
      to: "dist",
    },
    {
      from: path.relative(__dirname, bundledCoreLibrary),
      to: "core-library",
      filter: ["*.opclib"],
    },
    {
      from: path.relative(__dirname, path.join(repoRoot, "resources", "keys")),
      to: "keys",
      filter: ["*.pub"],
    },
    {
      from: path.relative(__dirname, path.join(repoRoot, "src")),
      to: "src",
      filter: [
        "**/*",
        "!**/node_modules/**",
        "!**/*.test.ts",
        "!**/*.spec.ts",
        "!**/tests/**",
      ],
    },
  ],

  // -------- macOS --------
  // Targets listed without arch so CLI `--arm64` / `--x64` filters per matrix
  // job; otherwise electron-builder builds both archs in each job and the
  // upload step collides on duplicate filenames.
  // Bundle the dark-mode icon for both appearances for now (no runtime
  // light/dark swap yet). Light set stays as icon.{icns,ico,png} for later.
  mac: {
    category: "public.app-category.developer-tools",
    icon: "icon-dark.icns",
    target: ["dmg", "zip"],
    identity: null,
    gatekeeperAssess: false,
    hardenedRuntime: false,
    artifactName: `\${productName}-${versionToken}-\${arch}.\${ext}`,
  },
  dmg: {
    format: "ULFO",
    writeUpdateInfo: false,
  },

  // -------- Windows --------
  win: {
    icon: "icon-dark.ico",
    target: ["nsis", "portable"],
    artifactName: `\${productName}-${versionToken}-\${arch}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    deleteAppDataOnUninstall: false,
    shortcutName: "OpenPCB",
    artifactName: `\${productName}-Setup-${versionToken}.\${ext}`,
  },
  portable: {
    artifactName: `\${productName}-Portable-${versionToken}.\${ext}`,
  },

  // -------- Linux --------
  linux: {
    icon: "icon-dark.png",
    // Drives the binary name in /usr/bin and the AppImage executable; keeps
    // mac/win bundles named "OpenPCB" while linux gets lowercase "openpcb".
    executableName: "openpcb",
    category: "Development",
    maintainer: "OpenPCB",
    vendor: "OpenPCB",
    synopsis: "PCB Design Suite",
    description: "OpenPCB desktop application",
    target: ["AppImage", "deb", "rpm"],
    desktop: {
      entry: {
        Name: "OpenPCB",
        GenericName: "PCB Design Suite",
        Categories: "Development;Electronics;",
        MimeType: "x-scheme-handler/openpcb;",
      },
    },
    // ${name} resolves to package.json#name ("openpcb-electron") — override
    // here so linux packages are "openpcb_*.deb" / "openpcb-*.rpm".
    artifactName: `openpcb_${versionToken}_\${arch}.\${ext}`,
  },
  deb: { fpm: ["--deb-no-default-config-files"], packageName: "openpcb" },
  rpm: {
    fpm: ["--rpm-rpmbuild-define=_build_id_links none"],
    packageName: "openpcb",
  },
  appImage: {
    artifactName: `\${productName}-${versionToken}-\${arch}.AppImage`,
  },

  // -------- Hooks --------
  afterSign: "./build/afterSign.cjs",

  // -------- Publish (GitHub Releases as source of truth) --------
  // Workflow uploads artifacts via `gh release create`; this block is
  // consumed by electron-builder to emit `app-update.yml` (bundled into
  // resources) and `latest*.yml` (uploaded with binaries) so electron-updater
  // knows where to look.
  publish: {
    provider: "github",
    owner: "andrejvysny",
    repo: "OpenPCB",
    vPrefixedTagName: true,
    releaseType: "prerelease",
    publishAutoUpdate: true,
  },
};
