/**
 * Resolve the `@openpcb/kicad-parsers` package's `tests/__fixtures__` directory
 * via the package manifest. Works under npm hoisting, yarn, and pnpm symlink
 * layouts — unlike deep `../../../../node_modules/...` relative paths.
 */
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

let cachedFixtureDir: string | undefined;

export function getKicadFixtureDir(): string {
  if (cachedFixtureDir === undefined) {
    const pkgManifest = require.resolve("@openpcb/kicad-parsers/package.json");
    cachedFixtureDir = path.resolve(
      path.dirname(pkgManifest),
      "tests",
      "__fixtures__",
    );
  }
  return cachedFixtureDir;
}

export function getKicadFixturePath(fileName: string): string {
  return path.join(getKicadFixtureDir(), fileName);
}
