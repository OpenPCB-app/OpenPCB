import path from "node:path";
import { captureCatalog, canonicalJson } from "../src/core/backend/tests/fixtures/assistant-parity/catalog";
import { isolatedDomain } from "../src/core/backend/tests/fixtures/assistant-parity/domain";

const output = path.resolve(import.meta.dir, "../src/core/backend/tests/fixtures/assistant-parity/catalog.current.json");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: bun scripts/assistant-parity-snapshot.ts --check | --write");
}
const domain = await isolatedDomain();
try {
  const snapshot = await captureCatalog(domain);
  if (mode === "--write") {
    await Bun.write(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  } else {
    const expected: unknown = await Bun.file(output).json();
    if (canonicalJson(snapshot) !== canonicalJson(expected)) {
      throw new Error("Assistant parity catalog changed. Review contract drift before regenerating.");
    }
  }
  console.log(JSON.stringify({ mode, sha256: snapshot.sha256,
    inAppTools: snapshot.data.inAppTools.length,
    mcpReadOnlyTools: snapshot.data.mcpReadOnly.tools.length,
    mcpWriteTools: snapshot.data.mcpWithWrites.tools.length,
    sqliteTables: snapshot.data.sqliteSchema.filter((item) => item.type === "table").length,
  }));
} finally {
  await domain.close();
}
