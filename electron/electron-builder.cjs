const path = require("node:path");
const fs = require("node:fs");
const repoRoot = path.resolve(__dirname, "..");
const downloadedCoreLibrary = path.join(repoRoot, ".build", "core-library");
const localCoreLibrary = path.join(repoRoot, "resources", "core-library");
const bundledCoreLibrary = fs.existsSync(downloadedCoreLibrary)
  ? downloadedCoreLibrary
  : localCoreLibrary;

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

  // npm workspace hoisting: better-sqlite3 + transitive native deps live in
  // the repo-root node_modules. Pull them into the package explicitly via
  // `files` from/to entries. The native .node binary is asarUnpacked below.
  files: [
    "dist/**/*",
    "package.json",
    {
      from: "../node_modules/better-sqlite3",
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
  mac: {
    category: "public.app-category.developer-tools",
    icon: "icon.icns",
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
    icon: "icon.ico",
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
    icon: "icon.png",
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
