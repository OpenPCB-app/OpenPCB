import { app, crashReporter } from "electron";
import { join } from "node:path";

let started = false;

export function initCrashReporter(): string {
  const crashDumpsDir = join(app.getPath("userData"), "crashes");
  app.setPath("crashDumps", crashDumpsDir);

  if (started) return crashDumpsDir;
  started = true;

  // Sentry's sentryMinidumpIntegration reads the dumps Electron writes and
  // uploads them via the Sentry envelope endpoint with full breadcrumbs and
  // context. We therefore disable Electron's own uploader.
  crashReporter.start({
    productName: "OpenPCB",
    companyName: "OpenPCB",
    submitURL: "",
    uploadToServer: false,
    compress: true,
    ignoreSystemCrashHandler: false,
    globalExtra: {
      _productName: "OpenPCB",
      appVersion: app.getVersion(),
    },
  });

  return crashDumpsDir;
}

export function getCrashDumpsDir(): string {
  return app.getPath("crashDumps");
}
