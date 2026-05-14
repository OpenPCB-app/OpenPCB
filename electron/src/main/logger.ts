import log from "electron-log/main";
import { app } from "electron";
import { join } from "node:path";

let initialized = false;

export function initLogger(): typeof log {
  if (initialized) return log;
  initialized = true;

  log.initialize();

  log.transports.file.resolvePathFn = (variables) => {
    const fileName = variables.fileName ?? "main.log";
    return join(app.getPath("logs"), fileName);
  };
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}";
  log.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}";

  log.transports.file.level = app.isPackaged ? "info" : "debug";
  log.transports.console.level = app.isPackaged ? "warn" : "debug";

  log.errorHandler.startCatching({ showDialog: false });
  log.eventLogger.startLogging({
    events: {
      app: {
        "certificate-error": true,
        "child-process-gone": true,
        "render-process-gone": true,
        "renderer-process-crashed": true,
      },
      webContents: {
        "did-fail-load": true,
        "did-fail-provisional-load": true,
        "plugin-crashed": true,
        "preload-error": true,
        "render-process-gone": true,
        unresponsive: true,
        responsive: true,
      },
    },
  });

  Object.assign(console, log.functions);

  log.info(
    `[logger] electron-log initialized; logs directory: ${app.getPath("logs")}`,
  );

  return log;
}

export { log };
