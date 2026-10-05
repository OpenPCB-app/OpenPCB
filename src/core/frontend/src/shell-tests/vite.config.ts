import { mergeConfig } from "vite";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import frontendConfig from "../../vite.config";

// Other agents may edit the workspace during timed shell checks.
export default mergeConfig(frontendConfig, {
  cacheDir: resolve(tmpdir(), "openpcb-h04-vite-cache"),
  server: { port: 15241, watch: { ignored: ["**/*"] } },
});
