import { initBackendSentry, captureBackendException } from "./sentry";
import { startBackendRuntime } from "./runtime";

initBackendSentry();

process.on("uncaughtException", (err) => {
  console.error("[core-backend] uncaughtException", err);
  captureBackendException(err, { phase: "uncaughtException" });
});
process.on("unhandledRejection", (reason) => {
  console.error("[core-backend] unhandledRejection", reason);
  captureBackendException(reason, { phase: "unhandledRejection" });
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

const runtime = await startBackendRuntime({
  host,
  port,
});
console.log(
  JSON.stringify({
    serverPort: runtime.port,
    startupContractVersion: 1,
    startupLicenseState: "active",
    startupLicenseCode: "CORE_BACKEND",
    loadedModules: runtime.snapshot.loadedModules,
  }),
);
console.log(
  `[core-backend] listening on ${runtime.url}`,
);
