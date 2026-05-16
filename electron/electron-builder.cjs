const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.openpcb.electron",
  productName: "OpenPCB",
  copyright: "© OpenPCB",

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
  mac: {
    category: "public.app-category.developer-tools",
    icon: "icon.icns",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    identity: null,
    gatekeeperAssess: false,
    hardenedRuntime: false,
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  dmg: {
    format: "ULFO",
    writeUpdateInfo: false,
  },

  // -------- Windows --------
  win: {
    icon: "icon.ico",
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "portable", arch: ["x64"] },
    ],
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    deleteAppDataOnUninstall: false,
    shortcutName: "OpenPCB",
    artifactName: "${productName}-Setup-${version}.${ext}",
  },
  portable: {
    artifactName: "${productName}-Portable-${version}.${ext}",
  },

  // -------- Linux --------
  linux: {
    icon: "icon.png",
    category: "Development",
    maintainer: "OpenPCB",
    vendor: "OpenPCB",
    synopsis: "PCB Design Suite",
    description: "OpenPCB desktop application",
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
      { target: "rpm", arch: ["x64"] },
    ],
    desktop: {
      entry: {
        Name: "OpenPCB",
        GenericName: "PCB Design Suite",
        Categories: "Development;Electronics;",
      },
    },
    artifactName: "${name}_${version}_${arch}.${ext}",
  },
  deb: { fpm: ["--deb-no-default-config-files"] },
  rpm: { fpm: ["--rpm-rpmbuild-define=_build_id_links none"] },
  appImage: {
    artifactName: "${productName}-${version}-${arch}.AppImage",
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
