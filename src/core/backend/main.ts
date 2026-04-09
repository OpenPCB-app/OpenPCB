import {
  createHttpServer,
  DiagnosticsStore,
  ModuleRouterRegistry,
  ModuleRuntime,
} from "./index";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";

const diagnosticsStore = new DiagnosticsStore(100);
const moduleRegistry = new ModuleRouterRegistry();
const moduleRuntime = new ModuleRuntime({
  moduleRegistry,
});

await moduleRuntime.bootstrap();
const snapshot = moduleRuntime.snapshot();

const server = createHttpServer({
  host,
  port,
  diagnosticsStore,
  moduleRegistry,
  moduleRuntime,
});

const bunServer = server.start();
console.log(
  JSON.stringify({
    serverPort: bunServer.port,
    startupContractVersion: 1,
    startupLicenseState: "active",
    startupLicenseCode: "CORE_BACKEND",
    loadedModules: snapshot.loadedModules,
  }),
);
console.log(
  `[core-backend] listening on http://${bunServer.hostname}:${bunServer.port}`,
);
